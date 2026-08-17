/**
 * The query-key factory.
 *
 * Every key starts with a namespace, and the share-view keys are namespaced by
 * **token**. That second rule is the one doing real work: sharing a cache entry
 * between the owner view and a share view is the mechanism by which private
 * data leaks onto a public page, and it happens by accident the moment both
 * call `nodes.children(id)` for the same id.
 *
 * Making the factory the only source of keys is what turns that from a
 * convention into something structural — a feature that cannot spell a key by
 * hand cannot spell the wrong one.
 */

export const queryKeys = {
  /**
   * The prefix every mutation invalidates. Wholesale, deliberately: a precise
   * invalidation graph for move and delete has to know about the source
   * parent, the destination parent, both ancestor chains, and every open page
   * of each — and getting one wrong is a stale row that survives a refresh.
   * Over-invalidating costs a refetch and is always correct.
   */
  nodes: {
    all: ['nodes'] as const,
    detail: (id: string) => ['nodes', 'detail', id] as const,
    children: (id: string, cursor?: string) =>
      cursor === undefined
        ? (['nodes', 'children', id] as const)
        : (['nodes', 'children', id, cursor] as const),
    stats: (id: string) => ['nodes', 'stats', id] as const,
    /**
     * The signed download URL, keyed by **node id and nothing else**.
     *
     * The URL itself is a bearer credential with a 60-second life, and a query
     * key is the one structure react-query will happily serialise into a
     * devtools panel. Keying by it would also make every refetch a different
     * cache entry, so the "never cached" rule would be enforced by accident
     * rather than on purpose — see `WEB-VIEWER-013`.
     */
    content: (id: string) => ['nodes', 'content', id] as const,
  },

  shares: {
    all: ['shares'] as const,
    list: (nodeId: string) => ['shares', 'list', nodeId] as const,
  },

  session: {
    me: ['session', 'me'] as const,
  },

  jobs: {
    all: ['jobs'] as const,
    list: () => ['jobs', 'list'] as const,
    detail: (id: string) => ['jobs', 'detail', id] as const,
    runs: (id: string) => ['jobs', 'runs', id] as const,
  },

  /**
   * Everything a share visitor reads, namespaced by the credential.
   *
   * Two different tokens are two different caches, and neither can collide
   * with the owner's. The token is a cache key here and nowhere else — it is
   * never a URL, never logged, and this is the one structure it appears in.
   */
  share: (token: string) => ({
    resolve: ['share', token, 'resolve'] as const,
    detail: (id: string) => ['share', token, 'nodes', 'detail', id] as const,
    children: (id: string, cursor?: string) =>
      cursor === undefined
        ? (['share', token, 'nodes', 'children', id] as const)
        : (['share', token, 'nodes', 'children', id, cursor] as const),
  }),
} as const;
