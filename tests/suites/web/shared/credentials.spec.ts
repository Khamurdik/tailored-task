import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { AxiosHeaders, type AxiosAdapter, type AxiosResponse } from 'axios';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApiClient } from '@web/shared/api/client';
import { setShareToken } from '@web/shared/auth/share-session';
import * as tokenStore from '@web/shared/auth/token-store';

/**
 * Records what the client actually put on the wire. Every assertion below is
 * about the request as it left, not about what the code intended.
 */
function recordingClient() {
  const sent: { url: string; headers: Record<string, string>; data: unknown }[] = [];

  const adapter: AxiosAdapter = (config) => {
    sent.push({
      url: config.url ?? '',
      headers:
        config.headers instanceof AxiosHeaders
          ? (config.headers.toJSON() as Record<string, string>)
          : {},
      data: config.data,
    });
    const response: AxiosResponse = {
      data: {},
      status: 200,
      statusText: '200',
      headers: new AxiosHeaders(),
      config: config as AxiosResponse['config'],
    };
    return Promise.resolve(response);
  };

  const client = createApiClient();
  client.defaults.adapter = adapter;
  return { client, sent };
}

const PAIR = { accessToken: 'access-1', refreshToken: 'refresh-1' };

beforeEach(() => {
  globalThis.localStorage.clear();
  setShareToken(null);
});

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

describe('credentials on the wire', () => {
  it('WEB-SHARED-001 the request interceptor attaches Authorization: Bearer from the token store', async () => {
    tokenStore.set(PAIR);
    const { client, sent } = recordingClient();

    await client.get('/nodes');

    expect(sent[0]?.headers['Authorization']).toBe('Bearer access-1');
  });

  it('WEB-SHARED-002 the client sends no cookies', () => {
    const { client } = recordingClient();

    expect(client.defaults.withCredentials).toBe(false);

    // Not merely absent — explicitly false. `undefined` would inherit whatever
    // a future global default becomes, and this is a security property rather
    // than a preference.
    expect(client.defaults.withCredentials).not.toBeUndefined();
  });

  it('WEB-SHARED-006 the refresh token is sent in the body and never in a URL', async () => {
    tokenStore.set(PAIR);
    const { client, sent } = recordingClient();

    await client.post('/auth/refresh', { refreshToken: PAIR.refreshToken });

    const request = sent[0];
    expect(request?.url).not.toContain('refresh-1');
    expect(JSON.parse(String(request?.data))).toEqual({ refreshToken: 'refresh-1' });
  });

  it('WEB-SHARED-007 X-Share-Token is attached automatically on share routes only', async () => {
    const { client, sent } = recordingClient();

    await client.get('/nodes/abc');
    expect(sent[0]?.headers['X-Share-Token']).toBeUndefined();

    setShareToken('a-share-credential');
    await client.get('/nodes/abc');
    expect(sent[1]?.headers['X-Share-Token']).toBe('a-share-credential');

    // Leaving the share route stops sending it. A credential that outlives its
    // route is one that gets attached to a request nobody meant it for.
    setShareToken(null);
    await client.get('/nodes/abc');
    expect(sent[2]?.headers['X-Share-Token']).toBeUndefined();
  });

  it('WEB-SHARED-013 an owner request never carries a share token', async () => {
    tokenStore.set(PAIR);
    const { client, sent } = recordingClient();

    await client.get('/nodes');

    expect(sent[0]?.headers['Authorization']).toBe('Bearer access-1');
    expect(sent[0]?.headers['X-Share-Token']).toBeUndefined();
  });

  it('WEB-SHARED-014 a share request never carries the owner bearer token', async () => {
    // The case that matters: a signed-in owner opening someone's share link.
    // Both credentials exist, and sending both would let the server resolve
    // whichever it recognises first.
    tokenStore.set(PAIR);
    setShareToken('a-share-credential');
    const { client, sent } = recordingClient();

    await client.get('/nodes/abc');

    expect(sent[0]?.headers['X-Share-Token']).toBe('a-share-credential');
    expect(sent[0]?.headers['Authorization']).toBeUndefined();
  });

  it('WEB-SHARED-008 localStorage is touched in exactly one module', () => {
    // `process.cwd()` rather than `import.meta.url`: under jsdom the module
    // URL is `http://localhost:3000/...`, not a file URL, so `fileURLToPath`
    // throws. Vitest runs this project with its own root as the cwd.
    const root = resolve(process.cwd(), '../apps/web/src');
    expect(existsSync(root), `expected web source at ${root}`).toBe(true);

    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(full)) continue;
        if (full.endsWith(join('auth', 'token-store.ts'))) continue;
        // Comments are not code. Two modules explain in prose *why* they stay
        // out of `localStorage`, and a scan that counts those as violations
        // punishes exactly the documentation that keeps the rule alive. (The
        // registry scanner learned the same lesson from the other direction —
        // see tests/src/registry/scan.ts.)
        if (/\blocalStorage\b/.test(stripComments(readFileSync(full, 'utf8')))) {
          offenders.push(full.slice(root.length + 1));
        }
      }
    };
    walk(root);

    expect(offenders, 'only auth/token-store.ts may touch localStorage').toEqual([]);
  });

  it('WEB-SHARED-009 a malformed stored token reads as logged-out, not as an error', () => {
    for (const corrupt of ['not json', '{}', '[]', 'null', '{"accessToken":"a"}', '']) {
      globalThis.localStorage.setItem('dataroom.tokens', corrupt);
      // Anything could be under this key — a half-written value from a killed
      // tab, an older format, something pasted into devtools. All of them mean
      // "no session", and throwing here would break the app before any screen
      // exists to explain why.
      expect(() => tokenStore.get(), corrupt).not.toThrow();
      expect(tokenStore.get(), corrupt).toBeNull();
    }
  });
});
