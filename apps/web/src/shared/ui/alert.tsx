import { AlertCircle, Info, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type AlertTone = 'error' | 'offline' | 'info';

const ICONS = { error: AlertCircle, offline: WifiOff, info: Info } as const;

const TONES: Record<AlertTone, string> = {
  error: 'border-destructive/50 text-destructive bg-destructive/5',
  offline: 'border-amber-500/50 text-amber-700 bg-amber-500/5',
  info: 'border-border text-foreground bg-muted/40',
};

/**
 * `role="alert"` so a screen reader announces it the moment it appears.
 *
 * A login failure communicated only by colour is not communicated at all to
 * anyone who cannot see it — and it is the one message on that page that
 * matters.
 */
export function Alert({
  tone = 'error',
  children,
  className,
}: {
  tone?: AlertTone;
  children: ReactNode;
  className?: string;
}) {
  const Icon = ICONS[tone];
  return (
    <div
      role="alert"
      className={cn('flex items-start gap-2 rounded-md border p-3 text-sm', TONES[tone], className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
