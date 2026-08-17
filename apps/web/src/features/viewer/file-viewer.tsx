import type { NodeDetail } from '@dataroom/shared';
import { Download, FileWarning } from 'lucide-react';
import { useEffect } from 'react';

import { AppError, describeError } from '@/shared';
import {
  Alert,
  Button,
  buttonVariants,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Spinner,
} from '@/shared/ui';

import { isExpiring, useContentUrl } from './use-content-url';

/**
 * The **only** content type that is ever framed.
 *
 * This is the client half of a rule the server already enforces: uploads are
 * served from the storage origin, and only `application/pdf` is sent `inline`
 * — everything else is `attachment`, under both values of `UPLOAD_FILE_POLICY`.
 * Framing an `attachment` would not execute it, but framing is not a decision
 * worth making on a type this component did not verify. Under `all-files` an
 * uploaded `.html` on the bucket origin is outside the web app's CSP, and the
 * CSP is the mitigation the entire `localStorage` token decision rests on.
 *
 * So the check is a positive match on one type rather than a blocklist of the
 * dangerous ones. A blocklist is wrong the day a new type is added.
 */
const FRAMEABLE = 'application/pdf';

function isFrameable(contentType: string | null): boolean {
  // `application/pdf; charset=binary` is still a PDF — compare the media type.
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() === FRAMEABLE;
}

/**
 * A PDF, in a modal.
 *
 * The browser's own viewer rather than `react-pdf`: page navigation, text
 * selection, search, print and zoom all come free and all of them would be
 * half-built otherwise. Reach for a rendering library only when page navigation
 * is genuinely wanted.
 */
export function FileViewer({
  file,
  open,
  onClose,
  readOnly = false,
}: {
  file: Pick<NodeDetail, 'id' | 'name' | 'contentType' | 'sizeBytes'> | null;
  open: boolean;
  onClose: () => void;
  /** A share view passes true. There are no mutating affordances here either way. */
  readOnly?: boolean;
}) {
  const frameable = file !== null && isFrameable(file.contentType);

  /**
   * The URL is only requested for something that will actually be shown or
   * downloaded — but it *is* requested for a non-PDF, because the download
   * action needs it. What a non-PDF never gets is a frame.
   */
  const content = useContentUrl(file?.id, open && file !== null);

  /**
   * Recovery on interaction rather than on a timer.
   *
   * A `setInterval` refreshing a signed URL keeps a credential alive for as long
   * as the tab is open, which is the opposite of what a sixty-second TTL is for.
   * A modal left open for five minutes should recover when someone comes back to
   * it — so expiry is noticed on interaction and the refetch happens then.
   *
   * The handler refetches **directly** rather than flipping a `stale` flag that
   * an effect then reacts to. That first version was a cascading render, and the
   * indirection bought nothing: the event already is the interaction.
   */
  const { refetch } = content;
  const expiresAt = content.data?.expiresAt;

  useEffect(() => {
    if (!open) return;

    const check = (): void => {
      if (isExpiring(expiresAt)) void refetch();
    };

    window.addEventListener('focus', check);
    window.addEventListener('pointerdown', check);
    return () => {
      window.removeEventListener('focus', check);
      window.removeEventListener('pointerdown', check);
    };
  }, [open, expiresAt, refetch]);

  if (file === null) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {/* Radix closes on Escape and returns focus for us — WEB-VIEWER-009. */}
      <DialogContent className="flex h-[85vh] w-[min(90vw,64rem)] max-w-none flex-col">
        <DialogHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <div className="min-w-0">
            <DialogTitle dir="auto" className="truncate">
              {file.name}
            </DialogTitle>
            {file.sizeBytes !== null && (
              <p className="text-sm text-muted-foreground">{formatBytes(file.sizeBytes)}</p>
            )}
          </div>

          {/*
            Reuses the URL already fetched rather than asking for a second one.
            Every issued URL is another unrevocable sixty-second credential, so
            minting one per button press is a real cost, not a tidiness point.
          */}
          {/*
            Only for something that is actually being previewed. An unsupported
            type puts its download in the body as the single prominent action —
            two links with the same accessible name in one dialog is ambiguous
            to a screen reader and to anyone scripting it.
          */}
          {content.data !== undefined && frameable && (
            <a
              href={content.data.url}
              download={file.name}
              rel="noopener"
              // `buttonVariants` on an anchor rather than a `Button` wrapping
              // one: this navigates, so it has to be a link for middle-click,
              // for "save as", and for a screen reader to announce it as one.
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Download className="size-4" aria-hidden="true" />
              Download
            </a>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
          <Body
            file={file}
            frameable={frameable}
            url={content.data?.url}
            loading={content.isPending}
            error={content.error instanceof AppError ? content.error : null}
            onRetry={() => void content.refetch()}
            readOnly={readOnly}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Body({
  file,
  frameable,
  url,
  loading,
  error,
  onRetry,
  readOnly,
}: {
  file: Pick<NodeDetail, 'name' | 'contentType'>;
  frameable: boolean;
  url: string | undefined;
  loading: boolean;
  error: AppError | null;
  onRetry: () => void;
  readOnly: boolean;
}) {
  /**
   * The unsupported-type state comes **first**, before loading and before the
   * error branch.
   *
   * Ordering it that way is the point: no sequence of loading states, retries or
   * races can reach the `<iframe>` for a type that is not a PDF, because the
   * component returns before that branch exists. `WEB-VIEWER-018` is `P0` and
   * this early return is what makes it structural rather than conditional.
   */
  if (!frameable) {
    return (
      <EmptyState
        icon={FileWarning}
        title="No preview for this file type"
        description={
          readOnly
            ? 'Download it to open it in an application that understands it.'
            : `${file.contentType ?? 'This file'} cannot be previewed here. Download it to open it.`
        }
        action={
          url === undefined ? undefined : (
            <a
              href={url}
              download={file.name}
              rel="noopener"
              className={buttonVariants({ size: 'sm' })}
            >
              <Download className="size-4" aria-hidden="true" />
              Download
            </a>
          )
        }
      />
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center" aria-busy="true">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (error !== null) {
    const recovery = describeError(error);
    return (
      <div className="p-4">
        <Alert tone="error">
          <div className="space-y-2">
            {/* Never a blank frame. A viewer that fails silently reads as a
                broken file rather than a failed request. */}
            <p>{recovery.message}</p>
            <Button size="sm" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </Alert>
      </div>
    );
  }

  if (url === undefined) return null;

  return (
    <iframe
      // `title` is required for a frame to be reachable by a screen reader at
      // all, and the file's name is the only useful thing to call it.
      title={file.name}
      src={url}
      className="size-full"
      // Belt and braces on top of the type check: even a PDF is served from the
      // storage origin, and there is no reason for a preview to run scripts or
      // navigate the top-level page.
      sandbox=""
    />
  );
}

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${UNITS[unit] ?? 'B'}`;
}

export { isFrameable, formatBytes };
