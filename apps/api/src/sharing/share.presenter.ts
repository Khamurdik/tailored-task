import {
  CreatedShareSchema,
  ShareSummarySchema,
  type CreatedShare,
  type ShareSummary,
} from '@dataroom/shared';

import { AppError } from '../common';
import type { IssuedShare, ShareWithSource } from './sharing.service';

/**
 * Grant rows onto the wire.
 *
 * The one rule that matters here: **no hash ever crosses this boundary.**
 * `token_hash` and `short_code_hash` are not secrets in the way the plaintext
 * is, but publishing them would hand an attacker the exact value to search for
 * if the database ever leaked, and there is no reason a client needs either.
 * `hasShortCode` is the entire truth a client has any use for.
 */
export function toShareSummary(entry: ShareWithSource): ShareSummary {
  const { share } = entry;

  const parsed = ShareSummarySchema.safeParse({
    id: share.id,
    nodeId: share.nodeId,
    kind: share.kind,
    role: share.role,
    principalEmail: share.principalEmail,
    hasShortCode: share.shortCodeHash !== null,
    expiresAt: share.expiresAt?.toISOString() ?? null,
    revokedAt: share.revokedAt?.toISOString() ?? null,
    createdAt: share.createdAt.toISOString(),
    inheritedFrom: entry.inheritedFrom,
  });

  if (!parsed.success) throw new AppError('INTERNAL', 'ShareSummary failed its own contract', 500);
  return parsed.data;
}

/**
 * The one response in the system carrying a plaintext credential.
 *
 * `token` is null for a `user` grant because the database refuses to store one
 * — `shares_kind_shape` — and a grant addressed to a person must not also be a
 * bearer link.
 */
export function toCreatedShare(issued: IssuedShare): CreatedShare {
  const parsed = CreatedShareSchema.safeParse({
    share: toShareSummary({ share: issued.share, inheritedFrom: null }),
    token: issued.token,
    shortCode: issued.shortCode,
  });

  if (!parsed.success) throw new AppError('INTERNAL', 'CreatedShare failed its own contract', 500);
  return parsed.data;
}
