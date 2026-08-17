import { FolderPlus, Library } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { useSession } from '@/features/auth';
import { UploadDropzone } from '@/features/uploads';
import { ShareDialog } from '@/features/sharing';
import { FileViewer } from '@/features/viewer';
import { AppError, describeError } from '@/shared';
import { Alert, Button, EmptyState, Skeleton } from '@/shared/ui';

import { Explorer } from './explorer';
import { NameDialog } from './name-dialog';
import { useCreateRoom, useNode, useRooms } from './use-explorer';

/**
 * `/nodes/:id` — one folder.
 *
 * The id lives in the **URL**, so a folder can be linked, opened directly,
 * reloaded, and reached with the back button. Holding it in component state
 * instead is the version where every one of those is broken and only the first
 * is noticed.
 */
export function FolderPage() {
  const { id, fileId } = useParams<{ id: string; fileId?: string }>();
  const navigate = useNavigate();
  const openFile = useNode(fileId);
  const [sharing, setSharing] = useState<{ id: string; name: string } | null>(null);

  if (id === undefined) return null;

  return (
    <Shell>
      {/*
        Both composed here, at the route. `explorer` imports neither `uploads`
        nor `viewer`, and neither imports it — the dropzone wraps the explorer
        and the viewer sits beside it, which is what keeps those three features
        independent.
      */}
      <UploadDropzone parentId={id}>
        <Explorer
          nodeId={id}
          onNavigate={(next) => void navigate(`/nodes/${next}`)}
          // The route is the state. Opening a file is a navigation, so a
          // preview is linkable and the back button closes it — which is the
          // whole of `WEB-VIEWER-003` and `-008`.
          onOpenNode={(target) => void navigate(`/nodes/${id}/f/${target.id}`)}
          onShareNode={(target) => setSharing({ id: target.id, name: target.name })}
        />
      </UploadDropzone>

      <FileViewer
        file={openFile.data ?? null}
        open={fileId !== undefined}
        onClose={() => void navigate(`/nodes/${id}`)}
      />

      <ShareDialog
        nodeId={sharing?.id ?? ''}
        nodeName={sharing?.name ?? ''}
        open={sharing !== null}
        onOpenChange={(next) => !next && setSharing(null)}
      />
    </Shell>
  );
}

/**
 * `/` — the rooms.
 *
 * Separate from `Explorer` rather than a special case inside it, because a room
 * genuinely is one: it has no parent, so there is no node to authorize against
 * and no breadcrumb trail above it. The server answers this on its own route for
 * the same reason.
 */
export function RoomsPage() {
  const navigate = useNavigate();
  const rooms = useRooms();
  const createRoom = useCreateRoom();
  const [creating, setCreating] = useState(false);

  return (
    <Shell>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Data rooms</h1>
        <Button size="sm" onClick={() => setCreating(true)}>
          <FolderPlus className="size-4" aria-hidden="true" />
          New room
        </Button>
      </div>

      {rooms.isPending ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading rooms">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : rooms.error !== null ? (
        <Alert tone="error">
          {describeError(rooms.error instanceof AppError ? rooms.error : toUnknown()).message}
        </Alert>
      ) : rooms.data.items.length === 0 ? (
        <EmptyState
          icon={Library}
          title="No data rooms yet"
          description="A data room is the top of one tree — one deal, one diligence, one client."
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              Create the first one
            </Button>
          }
        />
      ) : (
        <ul className="divide-y rounded-md border">
          {rooms.data.items.map((room) => (
            <li key={room.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/40"
                onClick={() => void navigate(`/nodes/${room.id}`)}
              >
                <span dir="auto" className="font-medium">
                  {room.name}
                </span>
                <span className="text-sm text-muted-foreground">
                  {room.subtreeFiles ?? 0} file{(room.subtreeFiles ?? 0) === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <NameDialog
        open={creating}
        onOpenChange={(open) => {
          setCreating(open);
          if (!open) createRoom.reset();
        }}
        title="New data room"
        submitLabel="Create"
        pending={createRoom.isPending}
        error={createRoom.error instanceof AppError ? createRoom.error : null}
        onSubmit={(name) => {
          createRoom.mutate(name, {
            onSuccess: (room) => {
              setCreating(false);
              createRoom.reset();
              // Straight into it. Creating a room and landing back on the list
              // makes the next click inevitable.
              void navigate(`/nodes/${room.id}`);
            },
          });
        }}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useSession();

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <a href="/" className="font-semibold">
            Data room
          </a>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{user?.email}</span>
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-6 py-6">{children}</main>
    </div>
  );
}

function toUnknown(): AppError {
  return new AppError('unknown', 'INTERNAL', 'Something went wrong', null);
}
