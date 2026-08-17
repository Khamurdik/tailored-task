import { ResolveShareResponseSchema, type ResolveShareResponse } from '@dataroom/shared';
import { useQuery } from '@tanstack/react-query';
import { FileWarning } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { Explorer, useNode } from '@/features/explorer';
import { FileViewer } from '@/features/viewer';
import { api, queryKeys, setShareToken } from '@/shared';
import { request } from '@/shared/api/request';
import { EmptyState, Spinner } from '@/shared/ui';

/**
 * `/s/:code` — what a recipient sees.
 *
 * The only route in the application that serves someone who was never
 * authenticated, and the only one outside `<ProtectedRoute>`.
 */
export function PublicViewPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [openFileId, setOpenFileId] = useState<string | null>(null);

  /**
   * The credential goes into the request **header**, never into a request URL.
   *
   * The web app reads it out of its own address bar and hands it to the client,
   * which sends `X-Share-Token`. That is the whole reason the API accepts it in
   * a header while the browser-facing route is `/s/:code`: the code never
   * reaches the server as a path segment, so it cannot land in an access log.
   */
  useEffect(() => {
    if (code !== undefined) setShareToken(code);
    // Deliberately not cleared on unmount — a visitor navigating within the
    // share view still needs it, and it is scoped to the tab either way.
  }, [code]);

  const resolved = useQuery({
    // Namespaced by the credential, so a share view and an owner view can never
    // read each other's cache entries. That collision is the mechanism by which
    // private data reaches a public page.
    queryKey: queryKeys.share(code ?? '').resolve,
    enabled: code !== undefined,
    queryFn: () =>
      request(ResolveShareResponseSchema, { method: 'GET', url: '/shares/resolve' }, api),
    retry: false,
    staleTime: 30_000,
  });

  const root = useNode(resolved.data?.rootNodeId);
  const openFile = useNode(openFileId ?? undefined);

  if (resolved.isPending) {
    return (
      <Shell>
        <div className="flex justify-center py-16" aria-busy="true" aria-label="Opening link">
          <Spinner className="size-6" />
        </div>
      </Shell>
    );
  }

  /**
   * **One screen for every failure.**
   *
   * Invalid, revoked, expired, pointing at a deleted node, and never-existed all
   * land here, because the API answers all of them with one byte-identical 404 —
   * deliberately. "This link expired on 3 March" and "this link was revoked"
   * both confirm the token was real, which turns the endpoint into an oracle for
   * guessed tokens; "revoked" additionally leaks that somebody looked at the
   * sharing settings and shut this link down, to whoever holds the link.
   *
   * Four screens are better product design and the cost falls on legitimate
   * recipients. Taking that trade needs a written decision from the product
   * owner — see `public-view/TODO.md`. Until then, one screen.
   */
  if (resolved.error !== null || resolved.data === undefined) {
    return (
      <Shell>
        <EmptyState
          icon={FileWarning}
          title="This link is not available"
          description="It may have been turned off, or it may never have existed. Ask whoever shared it for a new one."
        />
      </Shell>
    );
  }

  return (
    <Shell name={root.data?.name}>
      {/*
        The **same** `Explorer` the owner uses, with `readOnly`. Not a second
        read-only implementation: two components rendering one tree is how a
        mutating affordance survives in the copy nobody is looking at.

        Breadcrumbs arrive already truncated at the shared node — the server
        stops them there, so this component is never the thing deciding what a
        visitor may know about the tree above them.
      */}
      <Explorer
        nodeId={resolved.data.rootNodeId}
        readOnly
        onNavigate={(id) => void navigate(`/s/${code ?? ''}?at=${id}`, { replace: false })}
        onOpenNode={(node) => setOpenFileId(node.id)}
      />

      <FileViewer
        file={openFile.data ?? null}
        open={openFileId !== null}
        readOnly
        onClose={() => setOpenFileId(null)}
      />
    </Shell>
  );
}

/**
 * A minimal header: what was shared, and that it was shared with you.
 *
 * **No account menu, no sign-in prompt, and no redirect to login.** A visitor
 * who happens to be signed in still gets this view rather than being silently
 * upgraded into the owner UI — the credential in the URL is what they came with,
 * and honouring it is the difference between previewing what you shared and
 * seeing your own data.
 */
function Shell({ name, children }: { name?: string; children?: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-5xl px-6 py-3">
          <p className="text-sm text-muted-foreground">Shared with you</p>
          {name !== undefined && (
            <h1 dir="auto" className="font-semibold">
              {name}
            </h1>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-6">{children}</main>
    </div>
  );
}

export type { ResolveShareResponse };
