import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The state a folder is in most often on a first visit, and the one that gets
 * built last. Given its own component so it cannot be skipped: an empty
 * explorer with no affordance reads as a failure to load.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-16 text-center', className)}>
      {Icon !== undefined && <Icon className="size-8 text-muted-foreground" aria-hidden="true" />}
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description !== undefined && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
