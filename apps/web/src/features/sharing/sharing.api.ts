import {
  CreatedShareSchema,
  ShareSummarySchema,
  type CreateShareRequest,
  type CreatedShare,
  type ShareSummary,
} from '@dataroom/shared';
import type { AxiosInstance } from 'axios';
import { z } from 'zod';

import { api } from '@/shared/api/client';
import { request } from '@/shared/api/request';

const ShareListSchema = z.strictObject({
  items: z.array(ShareSummarySchema),
  nextCursor: z.string().nullable(),
});

export async function listShares(
  nodeId: string,
  client: AxiosInstance = api,
): Promise<{ items: ShareSummary[] }> {
  return request(ShareListSchema, { method: 'GET', url: `/nodes/${nodeId}/shares` }, client);
}

/**
 * The one response in the system that carries a plaintext credential.
 *
 * It carries it **exactly once** — there is no endpoint that reads a token back,
 * because only its SHA-256 is stored. That is what makes "copy it now" an honest
 * instruction rather than a UI convention, and it is why the caller must not
 * throw the response away before the user has acted on it.
 */
export async function createShare(
  nodeId: string,
  body: CreateShareRequest,
  client: AxiosInstance = api,
): Promise<CreatedShare> {
  return request(
    CreatedShareSchema,
    { method: 'POST', url: `/nodes/${nodeId}/shares`, data: body },
    client,
  );
}

export async function revokeShare(shareId: string, client: AxiosInstance = api): Promise<void> {
  await client.delete(`/shares/${shareId}`);
}
