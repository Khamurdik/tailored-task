import { MAX_FILE_SIZE } from '@dataroom/shared';
import { create } from 'zustand';

/**
 * `queued → initializing → uploading → completing → done | error | cancelled`
 *
 * Every one of these is a state a user can see and act on, which is why they are
 * named rather than collapsed into a boolean. "Uploading" and "completing" look
 * identical on a progress bar and are completely different to wait through: the
 * first has a number that moves, and the second is the one where a full bar sits
 * still while `/complete` verifies the object.
 */
export type UploadStatus =
  | 'queued'
  | 'initializing'
  | 'uploading'
  | 'completing'
  | 'done'
  | 'error'
  | 'cancelled';

export interface UploadItem {
  id: string;
  file: File;
  /** The folder this was dropped into, captured at drop time. */
  parentId: string;
  status: UploadStatus;
  /** 0–100, from real transfer events. */
  progress: number;
  /** The pending node, once `/uploads/init` has answered. */
  nodeId: string | null;
  /**
   * The name the server actually used, which may differ from the file's.
   * Surfaced as "uploaded as report (2).pdf" rather than silently renaming.
   */
  finalName: string | null;
  error: string | null;
}

/**
 * The transfer queue.
 *
 * **Zustand, deliberately not react-query.** Transfer progress is client state:
 * it has no server to be stale against, it changes many times a second, and
 * putting it in the query cache means uploads die on navigation — which is the
 * one thing `WEB-UPLOADS-001` says must never happen. The cache is for things
 * the server owns; this is not one of them.
 */
export interface UploadQueueState {
  items: UploadItem[];
  /** Dismissed by the user. Reappears on the next upload. */
  panelDismissed: boolean;

  enqueue: (files: File[], parentId: string) => { queued: UploadItem[]; rejected: Rejection[] };
  update: (id: string, patch: Partial<UploadItem>) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  setPanelDismissed: (dismissed: boolean) => void;
  reset: () => void;
}

export interface Rejection {
  file: File;
  reason: string;
}

/**
 * Three files at a time.
 *
 * An unbounded queue on a 200-file drop opens 200 connections and renders 200
 * simultaneous 0% bars, which looks broken and is slower than doing three
 * properly.
 */
export const CONCURRENCY = 3;

/**
 * Client-side rejection, before a byte moves.
 *
 * These are the **early warning**, not the enforcement — `/complete` reads the
 * object's bytes and is the only thing that decides what a file really is. What
 * they buy is not spending a 50 MB upload to be told no at the end.
 */
export function rejectionFor(file: File): string | null {
  if (file.size === 0) {
    // Its own message rather than "too large": a zero-byte file is nearly always
    // a failed export or a directory dragged in, and "0 bytes" is the useful
    // thing to say.
    return 'This file is empty.';
  }
  if (file.size > MAX_FILE_SIZE) {
    return `This file is ${formatMb(file.size)}, over the ${formatMb(MAX_FILE_SIZE)} limit.`;
  }
  return null;
}

function formatMb(bytes: number): string {
  return `${Math.round((bytes / 1_048_576) * 10) / 10} MB`;
}

let counter = 0;

export const useUploadQueue = create<UploadQueueState>((set) => ({
  items: [],
  panelDismissed: false,

  enqueue: (files, parentId) => {
    const queued: UploadItem[] = [];
    const rejected: Rejection[] = [];

    for (const file of files) {
      const reason = rejectionFor(file);
      if (reason !== null) {
        rejected.push({ file, reason });
        continue;
      }

      counter += 1;
      queued.push({
        id: `upload-${counter}`,
        file,
        parentId,
        status: 'queued',
        progress: 0,
        nodeId: null,
        finalName: null,
        error: null,
      });
    }

    // **Appends**, never replaces. Dropping more files while a transfer is
    // running must not restart the queue (`WEB-UPLOADS-045`), and the panel
    // reappears because new work arrived.
    if (queued.length > 0) {
      set((state) => ({ items: [...state.items, ...queued], panelDismissed: false }));
    }

    return { queued, rejected };
  },

  update: (id, patch) => {
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  },

  remove: (id) => {
    set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
  },

  /** Leaves anything still moving alone. */
  clearFinished: () => {
    set((state) => ({
      items: state.items.filter((item) => !isFinished(item.status)),
    }));
  },

  setPanelDismissed: (panelDismissed) => set({ panelDismissed }),

  reset: () => set({ items: [], panelDismissed: false }),
}));

export function isFinished(status: UploadStatus): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled';
}

export function isActive(status: UploadStatus): boolean {
  return status === 'initializing' || status === 'uploading' || status === 'completing';
}
