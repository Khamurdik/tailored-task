import {
  InitUploadResponseSchema,
  NodeDetailSchema,
  type InitUploadResponse,
  type NodeDetail,
} from '@dataroom/shared';
import axios, { type AxiosInstance } from 'axios';

import { api } from '@/shared/api/client';
import { request } from '@/shared/api/request';
import { installMockTransport } from '@/shared/mock';

/**
 * The three calls of the upload lifecycle.
 *
 * The **bytes do not pass through here**. `init` returns a presigned URL and the
 * browser PUTs straight to it — which is the whole reason presigning exists, and
 * is why `uploadBytes` below uses a bare `XMLHttpRequest` rather than the app's
 * axios client: that client attaches a credential to every request, and sending
 * a bearer token to a storage host is how a session token ends up in somebody
 * else's access log.
 */

export async function initUpload(
  body: { parentId: string; name: string; sizeBytes: number; contentType: string },
  client: AxiosInstance = api,
): Promise<InitUploadResponse> {
  return request(InitUploadResponseSchema, { method: 'POST', url: '/uploads/init', data: body }, client);
}

export async function completeUpload(
  nodeId: string,
  client: AxiosInstance = api,
): Promise<NodeDetail> {
  return request(
    NodeDetailSchema,
    { method: 'POST', url: `/uploads/${nodeId}/complete`, data: {} },
    client,
  );
}

/**
 * Best-effort. A failed abort leaves a pending row, which the reaper collects
 * within the hour — so it is never worth failing a cancel over.
 */
export async function abortUpload(nodeId: string, client: AxiosInstance = api): Promise<void> {
  await client.post(`/uploads/${nodeId}/abort`, {}).catch(() => undefined);
}

export interface TransferHandle {
  done: Promise<void>;
  abort: () => void;
}

/**
 * The client the **bytes** travel on, and it is deliberately not `api`.
 *
 * Two properties it must have and `api` cannot:
 *
 *   - **no credential.** `api` attaches a bearer token or a share token to
 *     every request. The presigned PUT goes to a storage host that is not this
 *     application, and sending a session token there puts it in somebody else's
 *     access log — the signature in the URL is the entire authorization, which
 *     is the point of presigning;
 *   - **no `baseURL`, no envelope handling.** The response is S3's, not the
 *     API's, so none of the error mapping applies.
 *
 * It still goes through `installMockTransport`, so the placeholder data layer's
 * fake `mock://uploads/...` URL is answered here exactly as the real one would
 * be. That matters more than it sounds: the first version of this used a bare
 * `XMLHttpRequest`, which bypasses the axios adapter entirely — so every upload
 * worked against a real bucket and failed silently in mock mode, which is the
 * only mode anyone can run today.
 */
export const transfer = axios.create({ timeout: 0, withCredentials: false });
installMockTransport(transfer);

/**
 * PUT the bytes, with **real** progress.
 *
 * `onUploadProgress` is axios's wrapper over the XHR `upload.progress` event —
 * a real byte count from the browser, not a simulated timer (`WEB-UPLOADS-027`).
 * `fetch` is not an option here at all: it has no upload-progress event, and
 * streaming request bodies are still not available everywhere.
 *
 * `timeout: 0` because a 50 MB file on a slow connection legitimately takes
 * longer than the API client's 30 seconds, and a timeout mid-transfer is
 * indistinguishable to the user from the upload simply failing.
 */
export function uploadBytes(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
): TransferHandle {
  const controller = new AbortController();

  const done = transfer
    .put(url, file, {
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      signal: controller.signal,
      onUploadProgress: (event) => {
        // `total` is undefined for a body whose length the browser cannot
        // determine. Reporting a fabricated number there is exactly the
        // simulated progress this is supposed not to be.
        if (event.total !== undefined && event.total > 0) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      },
    })
    .then(() => undefined)
    .catch((cause: unknown) => {
      // Axios reports an aborted request as `ERR_CANCELED`; the runner
      // distinguishes a cancel from a failure by the `AbortError` name, so it is
      // normalised here rather than in three places there.
      if (axios.isCancel(cause)) throw new DOMException('Aborted', 'AbortError');
      throw cause;
    });

  return { done, abort: () => controller.abort() };
}
