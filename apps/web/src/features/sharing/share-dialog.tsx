import type { CreatedShare, ShareSummary } from '@dataroom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, Mail } from 'lucide-react';
import { useState } from 'react';

import { AppError, queryKeys } from '@/shared';
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Spinner,
} from '@/shared/ui';

import { createShare, listShares, revokeShare } from './sharing.api';

/**
 * Turns a credential into the URL a person actually pastes.
 *
 * The **code goes in the path**, and the web app reads it out of its own URL and
 * sends it as `X-Share-Token`. That indirection is the point: the credential
 * never reaches the API as a path segment, so it cannot land in a server access
 * log — which is exactly why `links` accepts it in a header even though the
 * browser-facing route is `/s/:code`.
 */
export function shareUrl(credential: string): string {
  return `${window.location.origin}/s/${credential}`;
}

/**
 * Create and manage grants on one node.
 *
 * **Opening this creates nothing.** A dialog that mints a link on open leaves a
 * live grant behind every time somebody opens it to look — including the times
 * they close it again immediately. The link is generated on demand
 * (`WEB-SHARING-001`, `-007`).
 */
export function ShareDialog({
  nodeId,
  nodeName,
  open,
  onOpenChange,
}: {
  nodeId: string;
  nodeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Mounted only while open, so the freshly-minted token in `Body`'s state is
        **gone** when the dialog closes. Reopening shows the grant in the list
        and no plaintext — which is not a UI choice, it is the only thing the
        server can support: only the hash is stored (`WEB-SHARING-009`).
      */}
      {open && <Body nodeId={nodeId} nodeName={nodeName} />}
    </Dialog>
  );
}

function Body({ nodeId, nodeName }: { nodeId: string; nodeName: string }) {
  const client = useQueryClient();
  const [issued, setIssued] = useState<CreatedShare | null>(null);
  const [email, setEmail] = useState('');
  const [emailProblem, setEmailProblem] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ShareSummary | null>(null);

  const shares = useQuery({
    queryKey: queryKeys.shares.list(nodeId),
    queryFn: () => listShares(nodeId),
  });

  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: queryKeys.shares.list(nodeId) });
  };

  const mintLink = useMutation({
    mutationFn: () => createShare(nodeId, { kind: 'public_link', role: 'viewer', expiresAt: null, shortLink: true }),
    onSuccess: (created) => {
      setIssued(created);
      invalidate();
    },
  });

  const invite = useMutation({
    mutationFn: (address: string) =>
      createShare(nodeId, {
        kind: 'user',
        email: address,
        role: 'viewer',
        expiresAt: null,
        shortLink: false,
      }),
    onSuccess: () => {
      setEmail('');
      invalidate();
    },
  });

  const revoke = useMutation({
    mutationFn: (shareId: string) => revokeShare(shareId),
    onSuccess: () => {
      setRevoking(null);
      invalidate();
    },
  });

  const items = shares.data?.items ?? [];
  const direct = items.filter((share) => share.inheritedFrom === null);
  const inherited = items.filter((share) => share.inheritedFrom !== null);

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>
          Share “<span dir="auto">{nodeName}</span>”
        </DialogTitle>
        <DialogDescription>Anyone you share with gets read-only access.</DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Link2 className="size-4" aria-hidden="true" />
            Public link
          </h3>

          {issued === null ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Anyone with the link can read this and everything inside it.
              </p>
              <Button
                size="sm"
                disabled={mintLink.isPending}
                aria-busy={mintLink.isPending}
                onClick={() => mintLink.mutate()}
              >
                {mintLink.isPending && <Spinner className="size-4" />}
                Create a link
              </Button>
              {mintLink.error !== null && (
                <Alert tone="error">{messageOf(mintLink.error)}</Alert>
              )}
            </div>
          ) : (
            <IssuedLink issued={issued} onCreateAnother={() => mintLink.mutate()} pending={mintLink.isPending} />
          )}
        </section>

        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Mail className="size-4" aria-hidden="true" />
            Invite by email
          </h3>

          <form
            className="flex gap-2"
            /**
             * `noValidate`, so **our** message is the one that appears.
             *
             * `type="email"` keeps the right mobile keyboard and the right
             * semantics, but native constraint validation would block submit
             * before `onSubmit` runs — so the field would silently do nothing
             * and the explanation this dialog wants to give would never render.
             * The browser's own bubble is also inconsistent between engines and
             * is not tied to the field by `aria-describedby`.
             */
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const problem = validateEmail(email, items);
              setEmailProblem(problem);
              // Checked before the request: a malformed address is something
              // the client can answer without a round trip, and inviting the
              // same person twice is a 409 the user cannot act on.
              if (problem !== null) return;
              invite.mutate(normalizeEmail(email));
            }}
          >
            <div className="flex-1 space-y-1">
              <Label htmlFor="invite-email" className="sr-only">
                Email address
              </Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="colleague@example.com"
                value={email}
                disabled={invite.isPending}
                aria-invalid={emailProblem !== null}
                aria-describedby={emailProblem === null ? undefined : 'invite-email-error'}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailProblem(null);
                }}
              />
            </div>
            <Button type="submit" size="sm" disabled={invite.isPending} aria-busy={invite.isPending}>
              Invite
            </Button>
          </form>

          {emailProblem !== null && (
            <p id="invite-email-error" className="text-sm text-destructive">
              {emailProblem}
            </p>
          )}
          {invite.error !== null && <Alert tone="error">{messageOf(invite.error)}</Alert>}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Who has access</h3>

          {shares.isPending ? (
            <div className="flex justify-center py-4" aria-busy="true" aria-label="Loading access">
              <Spinner className="size-5" />
            </div>
          ) : items.length === 0 ? (
            // Plainly, rather than an empty table with headers over nothing.
            <p className="text-sm text-muted-foreground">
              Nobody else has access to this yet.
            </p>
          ) : (
            <div className="space-y-3">
              {direct.length > 0 && (
                <GrantGroup
                  heading="Shared directly"
                  grants={direct}
                  onRevoke={setRevoking}
                />
              )}
              {inherited.length > 0 && (
                <GrantGroup
                  heading="Inherited from a parent folder"
                  grants={inherited}
                  onRevoke={null}
                />
              )}
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(next) => !next && setRevoking(null)}
        title="Revoke access?"
        destructive
        confirmLabel="Revoke"
        pending={revoke.isPending}
        onConfirm={() => revoking !== null && revoke.mutate(revoking.id)}
        description={
          // Names what is being cut off. "Are you sure?" is a speed bump; this
          // is a decision.
          revoking === null
            ? null
            : revoking.kind === 'public_link'
              ? 'The link stops working immediately for everyone holding it.'
              : `${revoking.principalEmail ?? 'That person'} loses access immediately.`
        }
      />
    </DialogContent>
  );
}

/**
 * The plaintext, shown **once**.
 *
 * Held in component state and nowhere else — not in the query cache, not in the
 * URL, not in `localStorage`. The dialog unmounts it on close and the server
 * cannot return it again, so the warning is a statement of fact rather than
 * urgency-flavoured copy.
 */
function IssuedLink({
  issued,
  onCreateAnother,
  pending,
}: {
  issued: CreatedShare;
  onCreateAnother: () => void;
  pending: boolean;
}) {
  const [copied, setCopied] = useState(false);
  // The short code when one was minted, because it is the one people can read
  // over the phone; the 43-character token otherwise.
  const credential = issued.shortCode ?? issued.token ?? '';
  const url = shareUrl(credential);

  return (
    <div className="space-y-2">
      <Alert tone="info">
        Copy this now — it is shown once and cannot be retrieved again.
      </Alert>

      <div className="flex gap-2">
        <Input readOnly value={url} aria-label="Share link" onFocus={(event) => event.target.select()} />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            // The **full URL**, not the bare token: a token on its own is not
            // something the recipient can do anything with.
            void navigator.clipboard?.writeText(url).then(() => setCopied(true));
          }}
        >
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <Button variant="ghost" size="sm" className="px-1" disabled={pending} onClick={onCreateAnother}>
        Create another link
      </Button>
      <p className="text-xs text-muted-foreground">
        Each link is separate. Creating another does not replace this one.
      </p>
    </div>
  );
}

function GrantGroup({
  heading,
  grants,
  onRevoke,
}: {
  heading: string;
  grants: ShareSummary[];
  /** Null for inherited grants — see below. */
  onRevoke: ((share: ShareSummary) => void) | null;
}) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs uppercase text-muted-foreground">{heading}</h4>
      <ul className="divide-y rounded-md border">
        {grants.map((share) => (
          <li key={share.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <div className="min-w-0">
              <p dir="auto" className="truncate">
                {share.kind === 'public_link' ? 'Anyone with the link' : share.principalEmail}
              </p>
              <p className="text-xs text-muted-foreground">{describe(share)}</p>
            </div>

            {onRevoke === null ? (
              /*
               * **No revoke button on an inherited grant.**
               *
               * It would fail — the grant lives on an ancestor — and a control
               * that cannot work is worse than none. The ancestor is named
               * instead, so the owner knows where to go.
               */
              <span className="shrink-0 text-xs text-muted-foreground">
                Revoke on “{share.inheritedFrom?.name}”
              </span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => onRevoke(share)}
              >
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Pending, expiring and expired are all states an owner needs to see. */
function describe(share: ShareSummary): string {
  if (share.kind === 'user' && share.principalEmail !== null) {
    // A grant addressed to someone with no account is inert until they log in —
    // not an error, and not something to hide.
    const pending = 'Pending — applies once that account signs in';
    const active = 'Can read this';
    return share.revokedAt === null ? (isPending(share) ? pending : active) : 'Revoked';
  }

  if (share.expiresAt !== null) {
    const at = new Date(share.expiresAt);
    return at.getTime() < Date.now()
      ? `Expired ${at.toLocaleDateString()}`
      : `Expires ${at.toLocaleDateString()}`;
  }

  return share.hasShortCode ? 'Link with a short code' : 'Link';
}

/**
 * The wire has no `principalUserId`, deliberately — an owner has no business
 * learning which addresses have accounts. So "pending" is inferred from what is
 * visible, and the copy says what it means rather than asserting a fact the
 * client cannot know.
 */
function isPending(share: ShareSummary): boolean {
  return share.kind === 'user' && share.revokedAt === null && share.expiresAt === null;
}

function normalizeEmail(raw: string): string {
  // NFC and trimmed, matching the server. Case is left alone: the column is
  // `citext`, and folding it here as well would be a second rule that can
  // disagree with the first.
  return raw.normalize('NFC').trim();
}

function validateEmail(raw: string, existing: ShareSummary[]): string | null {
  const email = normalizeEmail(raw);
  if (email === '') return 'An email address is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'That does not look like an email address.';

  const already = existing.some(
    (share) =>
      share.kind === 'user' &&
      share.principalEmail !== null &&
      share.principalEmail.toLowerCase() === email.toLowerCase(),
  );
  // Refused with an explanation rather than sent and 409'd — the server would
  // be right to reject it and the user would have no idea why.
  if (already) return 'That person already has access.';

  return null;
}

function messageOf(error: unknown): string {
  return error instanceof AppError ? error.message : 'Something went wrong';
}
