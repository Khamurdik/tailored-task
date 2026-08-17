import type { NodeSummary } from '@dataroom/shared';

import { ConfirmDialog, Spinner } from '@/shared/ui';

import { useStats } from './use-explorer';

/**
 * The delete confirmation, with **real** counts.
 *
 * The numbers come from `/stats` when the dialog opens, not from the row's
 * denormalized rollups. Those are maintained asynchronously and reconciled
 * daily, and telling someone they are deleting 14 files when a drifted counter
 * says 14 and the truth is 400 is worse than showing nothing at all.
 */
export function DeleteDialog({
  target,
  open,
  onOpenChange,
  pending,
  isShared,
  onConfirm,
}: {
  target: NodeSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  /** Whether any live grant reaches this node. Drives the extra warning. */
  isShared?: boolean;
  onConfirm: () => void;
}) {
  const stats = useStats(target?.id, open && target?.type !== 'file');

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={target === null ? 'Delete' : `Delete “${target.name}”?`}
      destructive
      pending={pending}
      confirmLabel="Delete"
      onConfirm={onConfirm}
      description={
        <span className="space-y-2">
          <span className="block">{describe(target, stats.data, stats.isPending)}</span>

          {isShared === true && (
            <span className="block font-medium">
              This is shared. Deleting it revokes access for everyone holding a link to it.
            </span>
          )}

          <span className="block text-muted-foreground">
            Deleted items can be restored for 30 days.
          </span>
        </span>
      }
    />
  );
}

/**
 * The consequence, in a sentence.
 *
 * An empty folder says so rather than showing two zeroes — "0 files and 0
 * folders" is a sentence a person has to parse to learn nothing.
 */
function describe(
  target: NodeSummary | null,
  stats: { files: number; folders: number } | undefined,
  loading: boolean,
): React.ReactNode {
  if (target === null) return null;
  if (target.type === 'file') return 'This file will be deleted.';

  if (loading || stats === undefined) {
    return (
      <span className="flex items-center gap-2 text-muted-foreground">
        <Spinner className="size-4" /> Counting what is inside…
      </span>
    );
  }

  if (stats.files === 0 && stats.folders === 0) return 'This folder is empty.';

  return `This deletes ${plural(stats.folders, 'folder')} and ${plural(stats.files, 'file')}.`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
