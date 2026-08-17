import type { NodeState, NodeType } from '@prisma/client';

/**
 * The contract other modules compile against.
 *
 * Note what is absent: **there is no `path`.** The materialized path is this
 * module's chosen storage strategy and stays inside it, so a later change of
 * strategy cannot reach a caller. What crosses the boundary is the ancestor
 * chain as an ordered list of ids, which every candidate strategy can produce.
 */
export interface Node {
  id: string;
  type: NodeType;
  state: NodeState;
  rootId: string;
  parentId: string | null;
  ownerId: string;
  name: string;
  depth: number;
  sizeBytes: number | null;
  contentType: string | null;
  subtreeFiles: number;
  subtreeBytes: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Ancestry {
  /** Root first, **excluding self**. */
  ancestorIds: readonly string[];
  /** True if any ancestor is soft-deleted. */
  ancestorsDeleted: boolean;
}

/**
 * What `access` receives through its `NODE_LOOKUP` port. Declared here because
 * this module produces it; the port itself is declared by `access`, which never
 * imports this one.
 */
export interface NodeSnapshot {
  id: string;
  rootId: string;
  ownerId: string;
  ancestorIds: readonly string[];
  deletedAt: Date | null;
  ancestorsDeleted: boolean;
}

export interface SubtreeStats {
  files: number;
  folders: number;
  bytes: number;
}

export type { NodeState, NodeType };
