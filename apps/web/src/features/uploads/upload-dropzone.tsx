import { Upload } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import { useDropzone } from 'react-dropzone';

import { Alert, Button } from '@/shared/ui';

import { useUploadQueue, type Rejection } from './upload-queue';

/**
 * The drop target, which is **the whole content area** rather than a small zone.
 *
 * A postage-stamp dropzone is the version people miss and then complain that
 * drag-and-drop does not work — which is exactly what happened here before this
 * existed. It wraps its children rather than sitting beside them, so there is no
 * geometry to get wrong.
 */
export function UploadDropzone({
  parentId,
  disabled = false,
  children,
}: {
  parentId: string;
  /** `readOnly` views pass true — a share visitor gets no dropzone at all. */
  disabled?: boolean;
  children: ReactNode;
}) {
  const enqueue = useUploadQueue((state) => state.enqueue);
  const [rejections, setRejections] = useState<Rejection[]>([]);

  const onDrop = useCallback(
    (files: File[]) => {
      const result = enqueue(files, parentId);
      // A mixed drop uploads what it can and reports only what it refused. The
      // alternative — refusing the whole batch — makes one bad file in twenty
      // everybody's problem.
      setRejections(result.rejected);
    },
    [enqueue, parentId],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    disabled,
    // The click target is the explicit button below, not the whole page: a
    // content area that opens a file picker on any click is unusable.
    noClick: true,
    noKeyboard: true,
  });

  if (disabled) return <>{children}</>;

  return (
    <div {...getRootProps()} className="relative">
      <input {...getInputProps()} data-testid="upload-input" />

      {isDragActive && (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5"
          data-testid="drop-overlay"
        >
          <p className="flex items-center gap-2 font-medium">
            <Upload className="size-5" aria-hidden="true" />
            Drop to upload here
          </p>
        </div>
      )}

      {rejections.length > 0 && (
        <Alert tone="error" className="mb-3">
          <div className="space-y-1">
            {rejections.map((rejection) => (
              <p key={rejection.file.name}>
                {/* Names the file **and** the limit. "Some files were rejected"
                    is not something a person can act on. */}
                <span className="font-medium">{rejection.file.name}</span> — {rejection.reason}
              </p>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="px-1"
              onClick={() => setRejections([])}
            >
              Dismiss
            </Button>
          </div>
        </Alert>
      )}

      {children}

      <UploadButton onOpen={open} />
    </div>
  );
}

/**
 * The affordance drag-and-drop needs beside it.
 *
 * Dragging is undiscoverable, impossible on a touch device, and awkward with a
 * screen reader. A visible button is not a fallback — for most people it is the
 * primary path.
 */
function UploadButton({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="pt-3">
      <Button variant="outline" size="sm" onClick={onOpen}>
        <Upload className="size-4" aria-hidden="true" />
        Upload files
      </Button>
    </div>
  );
}
