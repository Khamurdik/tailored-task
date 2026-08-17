import {
  ChildrenPageSchema,
  NodeDetailSchema,
  NodeStatsSchema,
  type ChildrenPage,
  type NodeDetail,
  type NodeStats,
} from '@dataroom/shared';
import type { AxiosInstance } from 'axios';

import { api } from '@/shared/api/client';
import { request } from '@/shared/api/request';

/**
 * The tree, as the explorer sees it.
 *
 * Every call parses its response against the shared schema — a server one deploy
 * ahead produces a failed request rather than an `undefined` rendered into a
 * table cell.
 *
 * **No function here knows about a share token.** The credential is attached by
 * the client's request interceptor, which sends exactly one of it or a bearer
 * token; a feature that passed a token explicitly would be a second place that
 * decides which credential a request carries, and the point of that interceptor
 * is that there is only one.
 */

export async function listRooms(client: AxiosInstance = api): Promise<ChildrenPage> {
  return request(ChildrenPageSchema, { method: 'GET', url: '/nodes' }, client);
}

export async function getNode(id: string, client: AxiosInstance = api): Promise<NodeDetail> {
  return request(NodeDetailSchema, { method: 'GET', url: `/nodes/${id}` }, client);
}

/**
 * One keyset page. `cursor` is opaque and is handed back exactly as received —
 * a client that constructs one has taken a dependency on the server's collation.
 */
export async function listChildren(
  id: string,
  cursor?: string | null,
  client: AxiosInstance = api,
): Promise<ChildrenPage> {
  return request(
    ChildrenPageSchema,
    {
      method: 'GET',
      url: `/nodes/${id}/children`,
      ...(cursor === undefined || cursor === null ? {} : { params: { cursor } }),
    },
    client,
  );
}

/**
 * Live counts, for the delete confirmation.
 *
 * Fetched when the dialog opens rather than kept on the row: telling someone
 * they are about to delete 14 files when a stale number says 14 and the truth is
 * 400 is worse than showing nothing.
 */
export async function getStats(id: string, client: AxiosInstance = api): Promise<NodeStats> {
  return request(NodeStatsSchema, { method: 'GET', url: `/nodes/${id}/stats` }, client);
}

export async function createRoom(name: string, client: AxiosInstance = api): Promise<NodeDetail> {
  return request(NodeDetailSchema, { method: 'POST', url: '/nodes', data: { name } }, client);
}

export async function createFolder(
  parentId: string,
  name: string,
  client: AxiosInstance = api,
): Promise<NodeDetail> {
  return request(
    NodeDetailSchema,
    { method: 'POST', url: '/nodes/folders', data: { parentId, name } },
    client,
  );
}

export async function renameNode(
  id: string,
  name: string,
  client: AxiosInstance = api,
): Promise<NodeDetail> {
  return request(
    NodeDetailSchema,
    { method: 'PATCH', url: `/nodes/${id}/name`, data: { name } },
    client,
  );
}

export async function moveNode(
  id: string,
  parentId: string,
  client: AxiosInstance = api,
): Promise<NodeDetail> {
  return request(
    NodeDetailSchema,
    { method: 'PATCH', url: `/nodes/${id}/parent`, data: { parentId } },
    client,
  );
}

export async function deleteNode(id: string, client: AxiosInstance = api): Promise<void> {
  await client.delete(`/nodes/${id}`);
}
