-- CreateEnum
CREATE TYPE "node_type" AS ENUM ('room', 'folder', 'file');

-- CreateEnum
CREATE TYPE "node_state" AS ENUM ('pending', 'active');

-- CreateTable
CREATE TABLE "nodes" (
    "id" UUID NOT NULL,
    "type" "node_type" NOT NULL,
    "state" "node_state" NOT NULL DEFAULT 'active',
    "root_id" UUID NOT NULL,
    "parent_id" UUID,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "size_bytes" INTEGER,
    "content_type" TEXT,
    "subtree_files" INTEGER NOT NULL DEFAULT 0,
    "subtree_bytes" BIGINT NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nodes_root_id_idx" ON "nodes"("root_id");

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "nodes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Indexes Prisma cannot express, and the constraints the strategy rests on.
--
-- Everything below is hand-written because it needs a partial predicate, a
-- non-default operator class, or an explicit collation — none of which the
-- Prisma schema language covers. That is a reason to write them here, not a
-- reason to do without them: two of these are the difference between a prefix
-- query using an index and scanning the table.
-- ---------------------------------------------------------------------------

-- 1. A name is unique among LIVE siblings.
--    Partial, so a soft-deleted node frees its name immediately — otherwise
--    deleting `Q4.pdf` and re-uploading it would 409 for thirty days until the
--    hard-delete job caught up.
CREATE UNIQUE INDEX "nodes_sibling_name_unique"
  ON "nodes" ("parent_id", "name")
  WHERE "deleted_at" IS NULL;

-- 2. Room names are unique per owner among live rooms.
--    A separate index because a room's `parent_id` is NULL, and Postgres treats
--    NULLs as distinct — so index 1 does not constrain rooms at all. This is
--    exactly the gap that lets two rooms called "Project Meridian" exist.
CREATE UNIQUE INDEX "nodes_room_name_unique"
  ON "nodes" ("owner_id", "name")
  WHERE "parent_id" IS NULL AND "deleted_at" IS NULL;

-- 3. Prefix matching on `path`.
--    `text_pattern_ops` is mandatory, not an optimisation: under any collation
--    other than C, btree ordering does not match `LIKE 'prefix%'` semantics and
--    the planner falls back to a sequential scan. Every cascade in this system
--    is this query, so without this line soft-delete, subtree stats and share
--    scoping all scan the table.
CREATE INDEX "nodes_path_prefix"
  ON "nodes" ("path" text_pattern_ops);

-- 4. The children listing, matching its ORDER BY exactly.
--    `COLLATE "C"` here because the keyset cursor compares the same way. A
--    mismatch between index collation and ORDER BY collation silently skips or
--    duplicates rows at page boundaries, and only with non-ASCII names — which
--    is the failure this whole line exists to prevent.
CREATE INDEX "nodes_children_listing"
  ON "nodes" ("parent_id", "type", "name" COLLATE "C", "id")
  WHERE "deleted_at" IS NULL;

-- 5. The pending-upload reaper's query: pending rows older than an hour.
CREATE INDEX "nodes_pending_created"
  ON "nodes" ("created_at")
  WHERE "state" = 'pending';

-- 6. Soft-deleted rows, for the hard-delete job.
CREATE INDEX "nodes_deleted_at"
  ON "nodes" ("deleted_at")
  WHERE "deleted_at" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Invariants the database enforces, so application bugs cannot write a tree
-- that is impossible to interpret.
-- ---------------------------------------------------------------------------

-- Depth is capped at 32. Under a materialized path this is a storage limit
-- rather than a policy: a btree entry maxes out near 2704 bytes and a UUID path
-- segment is 37 chars, so an uncapped tree fails around 73 levels with a raw
-- Postgres index error. The application rejects with DEPTH_LIMIT long before;
-- this is the backstop that keeps the failure legible if it ever does not.
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_depth_range"
  CHECK ("depth" >= 0 AND "depth" <= 32);

-- Only a room may have no parent, and a room is always its own root.
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_room_is_root"
  CHECK (("type" = 'room') = ("parent_id" IS NULL));
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_root_self_reference"
  CHECK ("type" <> 'room' OR "root_id" = "id");

-- A room is depth 0 and nothing else is.
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_room_depth_zero"
  CHECK (("depth" = 0) = ("type" = 'room'));

-- Only a file carries bytes. A folder with a size is a bug that would then be
-- summed into a rollup and be very hard to trace back.
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_only_files_have_bytes"
  CHECK ("type" = 'file' OR ("size_bytes" IS NULL AND "content_type" IS NULL));

-- Only a file may be pending: `pending` means "an upload is in flight".
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_only_files_pending"
  CHECK ("state" = 'active' OR "type" = 'file');

-- The path ends in this node's own id, which is the one part of the
-- path/parent_id relationship a single row can check by itself.
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_path_ends_with_self"
  CHECK ("path" LIKE '%/' || "id"::text);
