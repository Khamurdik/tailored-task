import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Carries its own accessible label. A bare spinner announces nothing, so a
 * screen-reader user gets silence during exactly the moment they most need to
 * know something is happening.
 */
export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex items-center gap-2', className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
