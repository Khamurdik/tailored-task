import { PAGE_SIZE, type Breadcrumb, type NodeSummary } from '@dataroom/shared';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { AppError, queryKeys } from '@/shared';

import * as explorerApi from './explorer.api';

/**
 * The data layer of the explorer.
 *
 * Two things are deliberately **not** here: no component imports
 * `explorer.api.ts` directly, and no hook spells a query key by hand. Both rules
 * exist for the same reason — a share view and an owner view must never share a
 * cache entry, and the key factory is what makes that structural rather than
 * remembered.
 */

/** Every mutation invalidates `['nodes']` through the shared `MutationCache`. */
function withInvalidation(client: QueryClient): { meta: Record<string, unknown> } {
  return { meta: { queryClient: client } };
}

export interface ChildrenView {
  items: NodeSummary[];
  breadcrumbs: Breadcrumb[];
  hasMore: boolean;
  isLoading: boolean;
  isFetchingMore: boolean;
  error: AppError | null;
  loadMore: () => void;
}

/**
 * The listing, paged on the server's opaque cursor.
 *
 * `getNextPageParam` returns `nextCursor`, which is `null` on the last page and
 * **never an empty string** — the contract is explicit about that because an
 * empty string reads as "there is more" to a truthiness check, which is the
 * classic pagination bug and the one that shows up as an infinite spinner at the
 * bottom of every folder.
 */
export function useChildren(nodeId: string | undefined): ChildrenView {
  const query = useInfiniteQuery({
    queryKey: queryKeys.nodes.children(nodeId ?? ''),
    enabled: nodeId !== undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => explorerApi.listChildren(nodeId ?? '', pageParam),
    getNextPageParam: (last) => last.nextCursor,
  });

  const pages = query.data?.pages ?? [];

  return {
    items: pages.flatMap((page) => page.items),
    // Breadcrumbs ride along with every page and are identical across them, so
    // the first is as good as the last — and for a share visitor the trail is
    // already truncated at the shared node by the server.
    breadcrumbs: pages[0]?.breadcrumbs ?? [],
    hasMore: query.hasNextPage,
    isLoading: query.isPending && nodeId !== undefined,
    isFetchingMore: query.isFetchingNextPage,
    error: query.error instanceof AppError ? query.error : null,
    loadMore: () => {
      // Guarded here rather than at the call site: an intersection observer
      // fires repeatedly while the sentinel is on screen, and without this the
      // same page is requested several times over (`WEB-EXPLORER-011`).
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
  };
}

export function useNode(nodeId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.nodes.detail(nodeId ?? ''),
    enabled: nodeId !== undefined,
    queryFn: () => explorerApi.getNode(nodeId ?? ''),
  });
}

export function useRooms() {
  return useQuery({
    queryKey: queryKeys.nodes.children('rooms'),
    queryFn: () => explorerApi.listRooms(),
  });
}

/**
 * Subtree counts, fetched only when something asks.
 *
 * `enabled` rather than a prefetch: this is the delete confirmation's number,
 * and computing it for every row in a five-hundred-row folder to support the
 * one the user might delete is a lot of aggregate queries for nothing.
 */
export function useStats(nodeId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.nodes.stats(nodeId ?? ''),
    enabled: enabled && nodeId !== undefined,
    queryFn: () => explorerApi.getStats(nodeId ?? ''),
  });
}

/**
 * **None of these is optimistic yet**, and the spec asks for two of them to be.
 *
 * `explorer/TODO.md` specifies create and rename as optimistic with rollback,
 * and move and delete as deliberately not — the reasoning being that a create
 * touches one row in one list so the rollback is "put it back", while a move
 * touches the source listing, the destination listing, both ancestor chains and
 * every open page of each. That reasoning still holds and the second half is
 * implemented as specified.
 *
 * The first half is not. Every mutation here closes its dialog on success and
 * lets the shared `MutationCache` invalidate `['nodes']`, so the row appears
 * after a refetch rather than immediately. It is correct and it is a visible
 * flash on a slow connection. Left for the same change that adds
 * `WEB-EXPLORER-004` and `-034` rather than half-built now, because an
 * optimistic update whose rollback is untested is worse than none: the failure
 * mode is a row that exists only on the client.
 */
export function useCreateFolder(parentId: string) {
  const client = useQueryClient();

  return useMutation({
    ...withInvalidation(client),
    mutationFn: (name: string) => explorerApi.createFolder(parentId, name),
  });
}

export function useCreateRoom() {
  const client = useQueryClient();

  return useMutation({
    ...withInvalidation(client),
    mutationFn: (name: string) => explorerApi.createRoom(name),
  });
}

export function useRenameNode() {
  const client = useQueryClient();

  return useMutation({
    ...withInvalidation(client),
    mutationFn: ({ id, name }: { id: string; name: string }) => explorerApi.renameNode(id, name),
  });
}

export function useMoveNode() {
  const client = useQueryClient();

  return useMutation({
    ...withInvalidation(client),
    mutationFn: ({ id, parentId }: { id: string; parentId: string }) =>
      explorerApi.moveNode(id, parentId),
  });
}

export function useDeleteNode() {
  const client = useQueryClient();

  return useMutation({
    ...withInvalidation(client),
    mutationFn: (id: string) => explorerApi.deleteNode(id),
  });
}

export { PAGE_SIZE };
