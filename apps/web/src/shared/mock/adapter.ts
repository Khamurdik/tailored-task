import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosRequestConfig, type AxiosResponse } from 'axios';

import { mockDb } from './db';
import { route } from './router';

/**
 * The fake transport, as an axios **adapter**.
 *
 * Axios lets you replace the function that performs the request. Everything
 * above it — the request interceptor attaching `Authorization`, the response
 * interceptor that refreshes on 401 and retries once, schema parsing, react-query
 * — runs exactly as it will in production. Only the trip to the network is
 * replaced.
 *
 * That placement is the whole design. Faking one layer higher would leave the
 * refresh path unrun until the API exists, and the refresh path is where the
 * two `P0` declarations in `web/shared` live.
 */

export interface MockAdapterOptions {
  /**
   * Simulated round trip. Instant responses make loading and empty states
   * invisible during development, so they get discovered in staging instead.
   */
  latencyMs?: { min: number; max: number };
}

const DEFAULT_LATENCY = { min: 120, max: 400 };

export function createMockAdapter(options: MockAdapterOptions = {}): AxiosAdapter {
  const latency = options.latencyMs ?? DEFAULT_LATENCY;

  return async function mockAdapter(config: AxiosRequestConfig): Promise<AxiosResponse> {
    const url = new URL(config.url ?? '/', 'http://mock.local');
    const method = (config.method ?? 'get').toUpperCase();

    // A PUT to the URL `/uploads/init` handed out. This is the browser's
    // direct-to-bucket upload, which in production never touches the API at
    // all — so it is handled here rather than in the route table.
    if (url.protocol === 'mock:' || (config.url ?? '').startsWith('mock://')) {
      return await after(latency, storeUploadedBytes(config, config.url ?? ''));
    }

    const response = route({
      method,
      // The client is configured with `baseURL: '/api'`, so strip it: the route
      // table is written in terms of the API's own paths.
      path: url.pathname.replace(/^\/api/, ''),
      query: url.searchParams,
      body: parseBody(config.data),
      headers: normalizeHeaders(config.headers),
    });

    const axiosResponse: AxiosResponse = {
      data: response.body,
      status: response.status,
      statusText: String(response.status),
      headers: new AxiosHeaders({ 'content-type': 'application/json' }),
      config: config as AxiosResponse['config'],
    };

    const settled = await after(latency, axiosResponse);

    /**
     * Reject or resolve exactly the way a real adapter does — by asking
     * `validateStatus`, not by testing the status directly.
     *
     * Two reasons, and the first is the one that matters. Axios rejects on a
     * non-2xx, and the response interceptor is what turns a 401 into a refresh
     * and a retry; an adapter that resolved everything would leave that path
     * dead code. But `validateStatus` is also a per-request option, and a
     * caller that sets it — a test asserting on a 404 body, say — is entitled
     * to have it honoured. Hard-coding `>= 400` quietly ignores it.
     */
    const validateStatus = settled.config.validateStatus;
    if (validateStatus === null || validateStatus === undefined || validateStatus(settled.status)) {
      return settled;
    }

    throw new AxiosError(
      `Request failed with status code ${settled.status}`,
      String(settled.status),
      settled.config,
      null,
      settled,
    );
  };
}

function storeUploadedBytes(config: AxiosRequestConfig, url: string): AxiosResponse {
  const nodeId = url.split('/').at(-1) ?? '';
  mockDb().blobs.set(nodeId, toBytes(config.data));

  return {
    data: null,
    status: 200,
    statusText: '200',
    headers: new AxiosHeaders({ etag: `"mock-${nodeId}"` }),
    config: config as AxiosResponse['config'],
  };
}

/**
 * Coerce whatever axios handed us into bytes, **without `instanceof`**.
 *
 * Two traps here, and the second cost an afternoon. Axios's default
 * `transformRequest` replaces a `Uint8Array` body with its underlying
 * `ArrayBuffer`, so the type that arrives is not the type that was sent. And
 * under jsdom the test file and this module can hold different `ArrayBuffer`
 * constructors, so `data instanceof ArrayBuffer` is `false` for an object that
 * genuinely is one — the upload silently stored zero bytes and `/complete`
 * rejected it as not-a-PDF, which reads as a bug in the magic-byte check.
 *
 * `ArrayBuffer.isView` and the `toStringTag` are both realm-independent.
 */
function toBytes(data: unknown): Uint8Array {
  if (data === null || data === undefined) return new Uint8Array();
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') {
    return new Uint8Array(data as ArrayBuffer);
  }
  return new Uint8Array();
}

function parseBody(data: unknown): unknown {
  if (typeof data !== 'string') return data ?? null;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function normalizeHeaders(headers: AxiosRequestConfig['headers']): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (headers === undefined) return normalized;

  const source = headers instanceof AxiosHeaders ? headers.toJSON() : headers;
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) continue;
    // Lower-cased, because HTTP header names are case-insensitive and a
    // handler reading `x-share-token` should not care how axios spelled it.
    normalized[key.toLowerCase()] = String(value);
  }
  return normalized;
}

async function after<T>(latency: { min: number; max: number }, value: T): Promise<T> {
  const span = Math.max(latency.max - latency.min, 0);
  const delay = latency.min + Math.random() * span;
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  return value;
}
