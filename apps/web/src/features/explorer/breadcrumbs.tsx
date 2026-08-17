import type { Breadcrumb } from '@dataroom/shared';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';

/** Past this many, the middle collapses. */
const VISIBLE_DEPTH = 4;

/**
 * The trail, collapsing in the middle past four levels.
 *
 * The **middle** rather than the end: the room and the current folder are the
 * two a person orients by, and a trail that truncates the tail hides exactly
 * the segment they are standing in.
 *
 * For a share visitor the trail arrives already truncated at the shared node —
 * the server stops it there, and this component is never the thing deciding what
 * a visitor may know about the tree above them.
 */
export function Breadcrumbs({
  trail,
  onNavigate,
}: {
  trail: readonly Breadcrumb[];
  /** Omitted in read-only contexts that have nowhere to navigate to. */
  onNavigate?: (id: string) => void;
}) {
  if (trail.length === 0) return null;

  const collapsed = trail.length > VISIBLE_DEPTH;
  const shown = collapsed ? [trail[0], ...trail.slice(-(VISIBLE_DEPTH - 1))] : [...trail];

  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {shown.map((crumb, index) => {
          if (crumb === undefined) return null;
          const isLast = index === shown.length - 1;
          // The gap sits after the first segment, which is where the collapse
          // actually happened.
          const showEllipsis = collapsed && index === 1;

          return (
            <li key={crumb.id} className="flex items-center gap-1">
              {index > 0 && (
                <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
              )}

              {showEllipsis && (
                <>
                  <span
                    className="px-1 text-muted-foreground"
                    // Announced, so the trail does not read as if the hidden
                    // levels were never there.
                    aria-label={`${trail.length - VISIBLE_DEPTH + 1} more levels`}
                  >
                    …
                  </span>
                  <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                </>
              )}

              {isLast ? (
                // The current folder is not a link. A link to where you already
                // are is a control that does nothing.
                <span aria-current="page" className="font-medium">
                  {crumb.name}
                </span>
              ) : onNavigate === undefined ? (
                <span className="text-muted-foreground">{crumb.name}</span>
              ) : (
                <Link
                  to={`/nodes/${crumb.id}`}
                  className="text-muted-foreground hover:text-foreground hover:underline"
                  onClick={(event) => {
                    event.preventDefault();
                    onNavigate(crumb.id);
                  }}
                >
                  {crumb.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export { VISIBLE_DEPTH };
