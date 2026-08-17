import { CheckCircle2, RotateCcw, X, XCircle } from 'lucide-react';

import { Button, Spinner } from '@/shared/ui';

import { cancelAll, cancelUpload, retryUpload } from './use-uploads';
import { isActive, isFinished, useUploadQueue, type UploadItem } from './upload-queue';

/**
 * The docked transfer panel.
 *
 * Rendered **above the router**, so it persists across navigation — the queue
 * outlives the folder it was started from, and a panel that unmounted with the
 * page would make that invisible even though the transfer kept going.
 */
export function UploadPanel() {
  const items = useUploadQueue((state) => state.items);
  const dismissed = useUploadQueue((state) => state.panelDismissed);
  const setDismissed = useUploadQueue((state) => state.setPanelDismissed);
  const clearFinished = useUploadQueue((state) => state.clearFinished);

  if (items.length === 0 || dismissed) return null;

  const remaining = items.filter((item) => isActive(item.status) || item.status === 'queued');

  return (
    <aside
      className="fixed bottom-4 right-4 z-30 w-80 rounded-lg border bg-background shadow-lg"
      aria-label="Uploads"
    >
      <header className="flex items-center justify-between border-b px-3 py-2">
        <p className="text-sm font-medium">
          {remaining.length > 0
            ? `Uploading ${remaining.length} file${remaining.length === 1 ? '' : 's'}`
            : 'Uploads finished'}
        </p>
        <div className="flex items-center gap-1">
          {remaining.length > 0 && (
            <Button variant="ghost" size="sm" className="px-2" onClick={() => cancelAll()}>
              Cancel all
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Dismiss uploads panel"
            onClick={() => {
              // Dismissed, never cancelled. Hiding the panel must not stop the
              // transfers — and it reappears on the next drop because
              // `enqueue` clears this flag.
              setDismissed(true);
            }}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </header>

      <ul className="max-h-72 divide-y overflow-y-auto">
        {items.map((item) => (
          <UploadRow key={item.id} item={item} />
        ))}
      </ul>

      {items.some((item) => isFinished(item.status)) && (
        <footer className="border-t px-3 py-2">
          <Button variant="ghost" size="sm" className="px-1" onClick={() => clearFinished()}>
            Clear finished
          </Button>
        </footer>
      )}
    </aside>
  );
}

function UploadRow({ item }: { item: UploadItem }) {
  return (
    <li className="space-y-1 px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span dir="auto" className="truncate" title={item.file.name}>
          {/* The **resolved** name once the server has one, because that is what
              the file is actually called now. Showing the dropped name would be
              showing something that no longer exists. */}
          {item.finalName ?? item.file.name}
        </span>
        <StatusIcon item={item} />
      </div>

      {item.finalName !== null && item.finalName !== item.file.name && (
        <p className="text-xs text-muted-foreground">uploaded as {item.finalName}</p>
      )}

      {(item.status === 'uploading' || item.status === 'completing') && (
        <div
          role="progressbar"
          aria-valuenow={item.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Uploading ${item.file.name}`}
          className="h-1.5 w-full overflow-hidden rounded bg-muted"
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${item.progress}%` }} />
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label(item)}</span>

        {(item.status === 'error' || item.status === 'cancelled') && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1 text-xs"
            onClick={() => retryUpload(item.id)}
          >
            <RotateCcw className="size-3" aria-hidden="true" />
            Retry
          </Button>
        )}

        {(isActive(item.status) || item.status === 'queued') && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1 text-xs"
            aria-label={`Cancel ${item.file.name}`}
            onClick={() => cancelUpload(item.id)}
          >
            Cancel
          </Button>
        )}
      </div>

      {item.error !== null && <p className="text-xs text-destructive">{item.error}</p>}
    </li>
  );
}

/** Done, failed and cancelled are distinguishable at a glance, not by reading. */
function StatusIcon({ item }: { item: UploadItem }) {
  if (item.status === 'done') {
    return <CheckCircle2 className="size-4 shrink-0 text-green-600" aria-label="Done" />;
  }
  if (item.status === 'error') {
    return <XCircle className="size-4 shrink-0 text-destructive" aria-label="Failed" />;
  }
  if (item.status === 'cancelled') {
    return <XCircle className="size-4 shrink-0 text-muted-foreground" aria-label="Cancelled" />;
  }
  return <Spinner className="size-4 shrink-0" />;
}

function label(item: UploadItem): string {
  switch (item.status) {
    case 'queued':
      return 'Waiting';
    case 'initializing':
      return 'Preparing';
    case 'uploading':
      return `${item.progress}%`;
    // Its own label, because a full bar that says "100%" and does not finish
    // reads as stuck.
    case 'completing':
      return 'Finalizing';
    case 'done':
      return 'Done';
    case 'error':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
  }
}
