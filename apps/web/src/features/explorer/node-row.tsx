import type { NodeSummary } from '@dataroom/shared';
import { File, Folder, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/shared/ui';

/**
 * One row.
 *
 * `readOnly` **removes** the actions rather than disabling them. A greyed-out
 * delete button in a read-only view reads as broken — and, more to the point, a
 * disabled control is a control: it is in the DOM, it can be re-enabled from a
 * console, and it tells a share visitor exactly which operations exist. Absent
 * is the only version of this that is a security property rather than a styling
 * one (`WEB-EXPLORER-001`).
 */
export function NodeRow({
  node,
  readOnly,
  onOpen,
  onRename,
  onMove,
  onDelete,
  onShare,
}: {
  node: NodeSummary;
  readOnly: boolean;
  onOpen: (node: NodeSummary) => void;
  onRename: (node: NodeSummary) => void;
  onMove: (node: NodeSummary) => void;
  onDelete: (node: NodeSummary) => void;
  /** Omitted where sharing is not composed in, so the item is simply absent. */
  onShare?: (node: NodeSummary) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const Icon = node.type === 'file' ? File : Folder;

  return (
    <tr
      className="border-b last:border-0 hover:bg-muted/40"
      data-testid={`row-${node.id}`}
      data-node-type={node.type}
    >
      <td className="px-3 py-2">
        <button
          type="button"
          className="flex items-center gap-2 text-left hover:underline"
          onClick={() => onOpen(node)}
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {/*
            `dir="auto"` per row, and it matters more than it looks. A
            right-to-left filename in a left-to-right table otherwise drags the
            surrounding punctuation with it, so the size and date columns appear
            to belong to the wrong row (`WEB-EXPLORER-029`).
          */}
          <span dir="auto" className="truncate">
            {node.name}
          </span>
          {node.state === 'pending' && (
            <span className="text-xs text-muted-foreground">uploading…</span>
          )}
        </button>
      </td>

      <td className="px-3 py-2 text-right text-sm text-muted-foreground tabular-nums">
        {describeSize(node)}
      </td>

      <td className="px-3 py-2 text-right text-sm text-muted-foreground">
        <time dateTime={node.updatedAt}>{new Date(node.updatedAt).toLocaleDateString()}</time>
      </td>

      <td className="w-10 px-3 py-2 text-right">
        {/* Absent in read-only, not disabled. See the component comment. */}
        {!readOnly && (
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${node.name}`}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((was) => !was)}
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-10 mt-1 w-36 rounded-md border bg-popover p-1 shadow-md"
                onMouseLeave={() => setMenuOpen(false)}
              >
                {(
                  [
                    ['Share', onShare],
                    ['Rename', onRename],
                    ['Move', onMove],
                    ['Delete', onDelete],
                  ] as [string, ((node: NodeSummary) => void) | undefined][]
                )
                  // `Share` is absent rather than disabled where the route did
                  // not compose `sharing` in — the same rule `readOnly` follows.
                  .filter(
                    (entry): entry is [string, (node: NodeSummary) => void] =>
                      entry[1] !== undefined,
                  )
                  .map(([label, action]) => (
                    <button
                      key={label}
                      type="button"
                      role="menuitem"
                      className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setMenuOpen(false);
                        action(node);
                      }}
                    >
                      {label}
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * A folder shows what is inside it; a file shows its own size.
 *
 * The rollups are null on a file by contract, where they would only restate
 * `sizeBytes` — so this reads the right field per type rather than falling back
 * between them and silently showing a file's size as a folder's contents.
 */
function describeSize(node: NodeSummary): string {
  if (node.type === 'file') return node.sizeBytes === null ? '—' : formatBytes(node.sizeBytes);
  if (node.subtreeFiles === null || node.subtreeFiles === 0) return '—';
  return `${node.subtreeFiles} file${node.subtreeFiles === 1 ? '' : 's'}`;
}

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${UNITS[unit] ?? 'B'}`;
}
