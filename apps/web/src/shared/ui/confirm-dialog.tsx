import { Loader2 } from 'lucide-react';
import { useRef, type ReactNode } from 'react';

import { Button } from './button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';

/**
 * The confirmation every destructive action goes through.
 *
 * Shared rather than reimplemented per feature, because the details that make a
 * confirmation honest are the ones that get dropped when it is written inline:
 *
 *   - the **consequence** is stated, not just the verb. "Delete 14 files and 3
 *     folders" is a decision; "Are you sure?" is a speed bump;
 *   - the destructive button is not the default focus, so Enter on a dialog
 *     that appeared unexpectedly does not confirm it;
 *   - it stays open and busy while the request is in flight, rather than
 *     closing optimistically and leaving the user unsure whether it happened.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Escape and the overlay must not dismiss a request already in flight —
        // the action would still complete with the dialog gone.
        if (pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        // Focus lands on Cancel. Radix would otherwise focus the first tabbable
        // element, and for a delete dialog that is the button that deletes — so
        // Enter on a dialog that appeared unexpectedly would confirm it.
        //
        // A ref rather than a query off `event.currentTarget`: that is typed as
        // `EventTarget`, so reaching for `querySelector` needs a cast, and a
        // cast here would be hiding the fact that nothing guarantees the button
        // is in the subtree.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            ref={cancelRef}
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
            aria-busy={pending}
            onClick={onConfirm}
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
