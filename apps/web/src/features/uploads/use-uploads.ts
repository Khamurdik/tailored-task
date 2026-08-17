import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { queryKeys, toAppError } from '@/shared';

import { abortUpload, completeUpload, initUpload, uploadBytes } from './uploads.api';
import { CONCURRENCY, isActive, useUploadQueue, type UploadItem } from './upload-queue';

/**
 * Transfer bookkeeping, **module-level rather than in a ref**.
 *
 * Two things need to reach a running transfer: the runner, which registers the
 * abort handle, and whatever renders the cancel button, which is a different
 * component in a different part of the tree. A `useRef` inside the runner is
 * private to it — the first version of this file had exactly that plus a second
 * map for the cancel path, and the two were never connected, so cancelling
 * marked an item cancelled while its bytes kept going.
 *
 * `started` is here for the same reason and one more: React runs effects twice
 * in development, and without it a strict-mode remount uploads every queued file
 * a second time.
 */
const abortHandles = new Map<string, () => void>();
const started = new Set<string>();

/**
 * Drives the queue.
 *
 * Mounted **once, above the router**, so a transfer survives navigation — the
 * single most important property of this feature (`WEB-UPLOADS-001`). Inside the
 * explorer, walking into a folder would unmount it and kill every upload, which
 * is the bug that makes people re-drop files and end up with duplicates.
 */
export function useUploadRunner(): void {
  const items = useUploadQueue((state) => state.items);
  const update = useUploadQueue((state) => state.update);
  const client = useQueryClient();

  useEffect(() => {
    const running = items.filter((item) => isActive(item.status)).length;
    const free = CONCURRENCY - running;
    if (free <= 0) return;

    const next = items
      .filter((item) => item.status === 'queued' && !started.has(item.id))
      .slice(0, free);

    for (const item of next) {
      started.add(item.id);
      void run(item);
    }

    async function run(item: UploadItem): Promise<void> {
      let nodeId: string | null = null;

      try {
        update(item.id, { status: 'initializing', error: null });

        const initiated = await initUpload({
          parentId: item.parentId,
          name: item.file.name,
          sizeBytes: item.file.size,
          // An empty `type` happens for extensionless files. The server reads
          // the object's bytes regardless; this only gets pinned into the
          // signature so the browser cannot PUT something else.
          contentType: item.file.type || 'application/octet-stream',
        });
        nodeId = initiated.nodeId;

        update(item.id, {
          status: 'uploading',
          nodeId: initiated.nodeId,
          // Surfaced while it happens rather than at the end, so "report (2).pdf"
          // is something the user watches rather than something they discover.
          finalName: initiated.finalName,
          progress: 0,
        });

        const transfer = uploadBytes(initiated.uploadUrl, item.file, (percent) => {
          update(item.id, { progress: percent });
        });
        abortHandles.set(item.id, transfer.abort);
        await transfer.done;

        /**
         * The gap between a full bar and a finished upload.
         *
         * `/complete` does a `HeadObject` and reads the object's leading bytes,
         * which takes long enough to notice. Without its own state the bar sits
         * at 100% while nothing appears to happen, and people close the tab.
         */
        update(item.id, { status: 'completing', progress: 100 });
        await completeUpload(initiated.nodeId);

        update(item.id, { status: 'done' });

        /**
         * Invalidated **per completion**, not once at the end of the batch.
         *
         * Twenty files dropped together should appear one by one. Waiting for
         * the batch means a folder that looks empty for a minute and then
         * blinks — and if the last upload fails, nothing refreshes at all.
         */
        void client.invalidateQueries({ queryKey: queryKeys.nodes.all });
      } catch (cause) {
        const aborted = cause instanceof DOMException && cause.name === 'AbortError';
        update(
          item.id,
          aborted
            ? { status: 'cancelled' }
            : { status: 'error', error: toAppError(cause).message },
        );

        // The pending row goes either way. Leaving it holds the file's name
        // against the unique index until the reaper catches up an hour later,
        // so a user retrying in the meantime would get `report (1).pdf`.
        if (nodeId !== null) await abortUpload(nodeId);
        void client.invalidateQueries({ queryKey: queryKeys.nodes.all });
      } finally {
        abortHandles.delete(item.id);
      }
    }
  }, [items, update, client]);

  /**
   * The tab-close warning, and **only** while something is actually moving.
   *
   * A handler that is always registered makes every navigation away from the app
   * show a browser confirm, which trains people to click through it — so by the
   * time it means something, it no longer does.
   */
  useEffect(() => {
    const inFlight = items.some((item) => isActive(item.status) || item.status === 'queued');
    if (!inFlight) return;

    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [items]);
}

/**
 * Cancel one transfer.
 *
 * Aborting the request is what stops the bytes; the runner's `catch` is what
 * calls `/abort` and cleans the pending row. Splitting it that way means
 * cancellation has one definition — a failure and a cancel take the same exit.
 */
export function cancelUpload(id: string): void {
  const { items, update } = useUploadQueue.getState();
  const item = items.find((each) => each.id === id);
  if (item === undefined) return;

  if (item.status === 'queued') {
    // Never started: nothing to abort, and no pending row to clean up.
    started.add(id);
    update(id, { status: 'cancelled' });
    return;
  }

  abortHandles.get(id)?.();
}

export function cancelAll(): void {
  for (const item of useUploadQueue.getState().items) {
    if (item.status === 'queued' || isActive(item.status)) cancelUpload(item.id);
  }
}

/**
 * Retry, **from `init`** rather than from the presigned URL.
 *
 * A URL that expired mid-transfer is the common reason a retry is needed, so
 * reusing it would fail the same way forever. Starting again also means a fresh
 * pending row, which is why the previous one was aborted on failure — otherwise
 * this would resolve to a suffixed name.
 */
export function retryUpload(id: string): void {
  started.delete(id);
  useUploadQueue
    .getState()
    .update(id, { status: 'queued', progress: 0, error: null, nodeId: null, finalName: null });
}

/** Test-only. The module-level maps outlive a component tree by design. */
export function resetUploadRunner(): void {
  abortHandles.clear();
  started.clear();
}
