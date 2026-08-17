import { MAX_NAME_LENGTH } from '@dataroom/shared';
import { Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';

import type { AppError } from '@/shared';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@/shared/ui';

/**
 * Client-side name checks.
 *
 * These are the **early warning**, never the enforcement — the server normalizes
 * and sanitizes, and the database's partial unique index is the only thing that
 * can actually arbitrate a collision. What they buy is a user finding out about
 * an empty name without a round trip.
 *
 * The cap counts characters **after NFC normalization**, matching the server:
 * `é` composed is one character and decomposed is two, and only one of those
 * readings can be the limit a person was told about.
 */
export function validateName(raw: string): string | null {
  const name = raw.normalize('NFC').trim();

  if (name === '') return 'A name is required.';
  if (name.length > MAX_NAME_LENGTH) {
    return `A name can be at most ${MAX_NAME_LENGTH} characters.`;
  }
  // Sanitised rather than rejected server-side, but a path separator in a name
  // is nearly always a paste accident and saying so beats silently eating it.
  if (/[/\\]/.test(name)) return 'A name cannot contain / or \\.';

  return null;
}

/** Trimmed and normalized the same way the server will. */
export function prepareName(raw: string): string {
  return raw.normalize('NFC').trim();
}

/**
 * One dialog for create and rename.
 *
 * They are the same interaction — type a name, get told if it collides, accept a
 * suggestion — and building them separately is how the suggestion affordance
 * ends up on one and not the other.
 */
export function NameDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  initialName = '',
  pending = false,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  initialName?: string;
  pending?: boolean;
  error?: AppError | null;
  onSubmit: (name: string) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // A dialog dismissed mid-request would leave the create completing
        // invisibly.
        if (pending) return;
        onOpenChange(next);
      }}
    >
      {/*
        The form is a **separate component, mounted only while the dialog is
        open**, so `useState(initialName)` initialises from the right value every
        time it opens.

        The obvious alternative — one component with an effect that resets the
        field when `open` flips — is what was written first, and it is both a
        cascading render and subtly wrong: the effect runs after the first paint,
        so a rename dialog shows the *previous* node's name for a frame. Letting
        it remount is the version with no synchronisation to get wrong.
      */}
      {open && (
        <NameForm
          key={initialName}
          initialName={initialName}
          title={title}
          submitLabel={submitLabel}
          pending={pending}
          error={error}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      )}
    </Dialog>
  );
}

function NameForm({
  initialName,
  title,
  submitLabel,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  initialName: string;
  title: string;
  submitLabel: string;
  pending: boolean;
  error: AppError | null | undefined;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const problem = touched ? validateName(name) : null;
  const suggestion = error?.code === 'NAME_CONFLICT' ? error.suggestedName : undefined;

  const submit = (): void => {
    setTouched(true);
    // Checked here as well as on the button's `disabled`, because Enter submits
    // the form and does not consult it.
    if (validateName(name) !== null || pending) return;
    onSubmit(prepareName(name));
  };

  return (
    <>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
          // Selected rather than merely focused: renaming `Q4 Report.pdf`
          // usually means replacing the name, and a caret at position zero makes
          // that a select-all first.
          inputRef.current?.select();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Names are unique among the items beside them.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="node-name">Name</Label>
            <Input
              id="node-name"
              ref={inputRef}
              value={name}
              disabled={pending}
              aria-invalid={problem !== null}
              aria-describedby={problem === null ? undefined : 'node-name-error'}
              onChange={(event) => {
                setName(event.target.value);
                setTouched(true);
              }}
            />
            {problem !== null && (
              <p id="node-name-error" className="text-sm text-destructive">
                {problem}
              </p>
            )}
          </div>

          {suggestion !== undefined && (
            <Alert tone="info">
              <span>Something here is already called that.</span>{' '}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-1 py-0 align-baseline underline"
                onClick={() => {
                  // One click from conflict to resolution: fill it in and submit,
                  // rather than filling it in and making the user press the
                  // button they just pressed.
                  setName(suggestion);
                  onSubmit(suggestion);
                }}
              >
                Use “{suggestion}” instead
              </Button>
            </Alert>
          )}

          {error !== null && error !== undefined && error.code !== 'NAME_CONFLICT' && (
            <Alert tone="error">{error.message}</Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              // Disabled while in flight, so a double-click cannot create two
              // folders — the failure that looks like a UI stutter and leaves a
              // duplicate behind.
              disabled={pending || validateName(name) !== null}
              aria-busy={pending}
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </>
  );
}
