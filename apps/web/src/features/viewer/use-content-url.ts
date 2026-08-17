import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/shared';

import { getContentUrl } from './viewer.api';

/**
 * How long before the stated expiry we stop trusting a URL.
 *
 * A URL that expires while a request is in flight is indistinguishable from one
 * that was never valid, so the margin is what turns "expired" into "refetch"
 * rather than into a broken frame.
 */
const EXPIRY_MARGIN_MS = 5_000;

/**
 * The signed URL, **fetched on open and never cached**.
 *
 * `gcTime: 0` and `staleTime: 0` together are the rule: the URL is a bearer
 * credential that anyone holding can use for sixty seconds, and it is
 * unrevocable once issued — revoking a share does not kill a URL already handed
 * out, so the TTL is the entire mitigation and keeping a copy around undermines
 * it directly.
 *
 * `gcTime: 0` is the half that is easy to miss. Without it the entry survives
 * unmount, so closing a viewer and reopening it five minutes later renders a
 * long-dead URL from cache into an `<iframe>` — which is `WEB-VIEWER-014`, and
 * it presents as "sometimes the preview is blank".
 */
export function useContentUrl(nodeId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.nodes.content(nodeId ?? ''),
    enabled: enabled && nodeId !== undefined,
    queryFn: () => getContentUrl(nodeId ?? ''),
    staleTime: 0,
    gcTime: 0,
    // Refetched whenever the component asks again, rather than served from a
    // cache that should not exist in the first place.
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** Whether a URL is close enough to its stated expiry to be worth replacing. */
export function isExpiring(expiresAt: string | undefined, now = Date.now()): boolean {
  if (expiresAt === undefined) return true;
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return true;
  return at - now <= EXPIRY_MARGIN_MS;
}

export { EXPIRY_MARGIN_MS };
