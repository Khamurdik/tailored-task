import { ContentUrlResponseSchema, type ContentUrlResponse } from '@dataroom/shared';
import type { AxiosInstance } from 'axios';

import { api } from '@/shared/api/client';
import { request } from '@/shared/api/request';

/**
 * The signed download URL.
 *
 * One call, and the credential the client sends is whatever the request
 * interceptor attaches — a bearer for an owner, `X-Share-Token` for a visitor.
 * **The same endpoint serves both**, which is the whole reason the viewer works
 * identically inside a share view: the guard decides, not the component.
 */
export async function getContentUrl(
  nodeId: string,
  client: AxiosInstance = api,
): Promise<ContentUrlResponse> {
  return request(
    ContentUrlResponseSchema,
    { method: 'GET', url: `/nodes/${nodeId}/content-url` },
    client,
  );
}
