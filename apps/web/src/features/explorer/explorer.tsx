import type { NodeSummary } from '@dataroom/shared';
import { FolderPlus, FolderOpen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { AppError, describeError } from '@/shared';
import { Alert, Button, EmptyState, Skeleton, Spinner } from '@/shared/ui';

import { Breadcrumbs } from './breadcrumbs';
import { DeleteDialog } from './delete-dialog';
import { NameDialog } from './name-dialog';
import { NodeRow } from './node-row';
import {
  useChildren,
  useCreateFolder,
  useDeleteNode,
  useMoveNode,
  useRenameNode,
} from './use-explorer';

/**
 * Browse a folder and mutate what is in it.
 *
 * `readOnly` is how `public-view` reuses this without either feature importing
 * the other — the composition happens at the route level and this component
 * takes a prop. Everything it gates is **removed**, not disabled: see `NodeRow`.
 */
export function Explorer({
  nodeId,
  readOnly = false,
  onOpenNode,
  onNavigate,
  onShareNode,
}: {
  nodeId: string;
  readOnly?: boolean;
  /** A file was opened. The viewer is composed in at the route, not here. */
  onOpenNode?: (node: NodeSummary) => void;
  onNavigate: (nodeId: string) => void;
  /**
   * Composed in at the route. `explorer` does not import `sharing`, so where
   * this is omitted the menu item is **absent** rather than disabled.
   */
  onShareNode?: (node: NodeSummary) => void;
}) {
  const children = useChildren(nodeId);

  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<NodeSummary | null>(null);
  const [deleting, setDeleting] = useState<NodeSummary | null>(null);
  const [moving, setMoving] = useState<NodeSummary | null>(null);

  const createFolder = useCreateFolder(nodeId);
  const renameNode = useRenameNode();
  const deleteNode = useDeleteNode();
  const moveNode = useMoveNode();

  /**
   * Infinite scroll on an intersection observer.
   *
   * `loadMore` is idempotent while a page is in flight — the observer fires
   * repeatedly for as long as the sentinel is on screen, and without that guard
   * one boundary requests the same page several times (`WEB-EXPLORER-011`).
   */
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = sentinel.current;
    if (element === null || !children.hasMore) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) children.loadMore();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [children.hasMore, children.loadMore, children]);

  if (children.isLoading) return <ListSkeleton />;

  /**
   * A gone folder and a folder that never existed render the **same** thing,
   * because the API answers both with the same 404 — deliberately, so that a
   * node id is not confirmable. A UI that distinguished them would be inventing
   * a difference the server refuses to expose.
   */
  if (children.error !== null) {
    return <ExplorerError error={children.error} onRetry={() => children.loadMore()} />;
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <Breadcrumbs trail={children.breadcrumbs} onNavigate={onNavigate} />

        {!readOnly && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <FolderPlus className="size-4" aria-hidden="true" />
            New folder
          </Button>
        )}
      </header>

      {children.items.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="Nothing here yet"
          description={
            readOnly
              ? 'This folder is empty.'
              : 'Create a folder, or drop files here to upload them.'
          }
          action={
            readOnly ? undefined : (
              // Deliberately not also called "New folder": two buttons with one
              // accessible name in one view is ambiguous to a screen reader and
              // to anyone scripting against it.
              <Button size="sm" onClick={() => setCreating(true)}>
                Create a folder
              </Button>
            )
          }
        />
      ) : (
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Folder contents, folders first</caption>
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">
                Name
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Size
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Modified
              </th>
              <th scope="col" className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {children.items.map((node) => (
              <NodeRow
                key={node.id}
                node={node}
                readOnly={readOnly}
                onOpen={(target) => {
                  // A folder navigates; a file is the viewer's business, and
                  // this component does not know what a viewer is.
                  if (target.type === 'file') onOpenNode?.(target);
                  else onNavigate(target.id);
                }}
                onRename={setRenaming}
                onMove={setMoving}
                onDelete={setDeleting}
                onShare={onShareNode}
              />
            ))}
          </tbody>
        </table>
      )}

      {/* The sentinel exists only while there is a next page to ask for. */}
      {children.hasMore && (
        <div ref={sentinel} className="flex justify-center py-4">
          {children.isFetchingMore && <Spinner className="size-5" />}
        </div>
      )}

      {!readOnly && (
        <>
          <NameDialog
            open={creating}
            onOpenChange={(open) => {
              setCreating(open);
              if (!open) createFolder.reset();
            }}
            title="New folder"
            submitLabel="Create"
            pending={createFolder.isPending}
            error={asAppError(createFolder.error)}
            onSubmit={(name) => {
              createFolder.mutate(name, {
                // Closed on success only. Closing optimistically and reopening
                // on a 409 is how the conflict suggestion ends up on a dialog
                // the user has already dismissed.
                onSuccess: () => {
                  setCreating(false);
                  createFolder.reset();
                },
              });
            }}
          />

          <NameDialog
            open={renaming !== null}
            onOpenChange={(open) => {
              if (!open) {
                setRenaming(null);
                renameNode.reset();
              }
            }}
            title="Rename"
            submitLabel="Rename"
            initialName={renaming?.name ?? ''}
            pending={renameNode.isPending}
            error={asAppError(renameNode.error)}
            onSubmit={(name) => {
              const target = renaming;
              if (target === null) return;
              // Renaming to the name it already has is a no-op, not an error —
              // and asking the server would return a 409 against the node
              // itself.
              if (name === target.name) {
                setRenaming(null);
                return;
              }
              renameNode.mutate(
                { id: target.id, name },
                {
                  onSuccess: () => {
                    setRenaming(null);
                    renameNode.reset();
                  },
                },
              );
            }}
          />

          <DeleteDialog
            target={deleting}
            open={deleting !== null}
            onOpenChange={(open) => {
              if (!open) {
                setDeleting(null);
                deleteNode.reset();
              }
            }}
            pending={deleteNode.isPending}
            onConfirm={() => {
              const target = deleting;
              if (target === null) return;
              deleteNode.mutate(target.id, {
                onSuccess: () => setDeleting(null),
              });
            }}
          />

          <MovePrompt
            target={moving}
            pending={moveNode.isPending}
            error={asAppError(moveNode.error)}
            onCancel={() => {
              setMoving(null);
              moveNode.reset();
            }}
            onMove={(parentId) => {
              const target = moving;
              if (target === null) return;
              moveNode.mutate(
                { id: target.id, parentId },
                {
                  onSuccess: () => {
                    setMoving(null);
                    moveNode.reset();
                  },
                },
              );
            }}
          />
        </>
      )}
    </section>
  );
}

/**
 * Move, by pasting a destination id.
 *
 * Deliberately the plain version. The specified interaction is a drag onto a
 * folder row plus a picker, and both are worth building — but a move that
 * warns about a shared destination, refuses a cycle and survives a 409 is the
 * part with the rules in it, and shipping that behind a placeholder chooser is
 * better than shipping a beautiful chooser with none of them.
 */
function MovePrompt({
  target,
  pending,
  error,
  onCancel,
  onMove,
}: {
  target: NodeSummary | null;
  pending: boolean;
  error: AppError | null;
  onCancel: () => void;
  onMove: (parentId: string) => void;
}) {
  return (
    <NameDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={target === null ? 'Move' : `Move “${target.name}”`}
      submitLabel="Move"
      pending={pending}
      error={error}
      onSubmit={onMove}
    />
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading folder">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-9 w-full" />
      ))}
    </div>
  );
}

/**
 * Never a bare spinner and never a raw code.
 *
 * `describeError` owns the wording, so `NAME_CONFLICT` cannot reach a screen as
 * itself — a wire-format code rendered to a person is a leak as well as a bad
 * message.
 */
function ExplorerError({ error, onRetry }: { error: AppError; onRetry: () => void }) {
  const recovery = describeError(error);

  return (
    <Alert tone="error">
      <div className="space-y-2">
        <p>{recovery.message}</p>
        {recovery.action === 'retry' && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </Alert>
  );
}

function asAppError(error: unknown): AppError | null {
  return error instanceof AppError ? error : null;
}
