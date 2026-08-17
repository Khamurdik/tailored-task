-- CreateEnum
CREATE TYPE "share_kind" AS ENUM ('public_link', 'user');

-- CreateEnum
CREATE TYPE "role" AS ENUM ('none', 'viewer', 'editor', 'owner');

-- DropIndex
DROP INDEX "nodes_path_prefix";

-- CreateTable
CREATE TABLE "shares" (
    "id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "kind" "share_kind" NOT NULL,
    "role" "role" NOT NULL DEFAULT 'viewer',
    "token_hash" TEXT,
    "short_code_hash" TEXT,
    "principal_user_id" UUID,
    "principal_email" CITEXT,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shares_token_hash_key" ON "shares"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "shares_short_code_hash_key" ON "shares"("short_code_hash");

-- CreateIndex
CREATE INDEX "shares_node_id_idx" ON "shares"("node_id");

-- CreateIndex
CREATE INDEX "shares_principal_email_idx" ON "shares"("principal_email");

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_principal_user_id_fkey" FOREIGN KEY ("principal_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Indexes and constraints Prisma cannot express.
-- ---------------------------------------------------------------------------

-- The guard's query: every live grant for a set of node ids, in one round trip.
-- Partial, because expired and revoked grants are excluded **in SQL** rather
-- than filtered in JS — which is what lets `resolveAccess` stay a pure function
-- that never evaluates a clock. See API-ACCESS-007 and 009.
CREATE INDEX "shares_live_by_node"
  ON "shares" ("node_id", "role")
  WHERE "revoked_at" IS NULL;

-- Claiming pending grants at login is a lookup by email over live grants only.
CREATE INDEX "shares_pending_by_email"
  ON "shares" ("principal_email")
  WHERE "principal_user_id" IS NULL AND "revoked_at" IS NULL;

-- A public link has a token; a user grant has a principal. Neither shape can be
-- half-built, because a grant with no way to reach it and no one to reach it is
-- a row that grants access to nobody and can never be diagnosed.
ALTER TABLE "shares" ADD CONSTRAINT "shares_kind_shape"
  CHECK (
    ("kind" = 'public_link' AND "token_hash" IS NOT NULL AND "principal_email" IS NULL)
    OR
    ("kind" = 'user' AND "principal_email" IS NOT NULL AND "token_hash" IS NULL)
  );

-- A short code only ever belongs to a public link.
ALTER TABLE "shares" ADD CONSTRAINT "shares_short_code_is_link_only"
  CHECK ("short_code_hash" IS NULL OR "kind" = 'public_link');

-- `none` is the resolver's answer, never a stored grant: a row granting nothing
-- would silently satisfy a `max(role)` that should have found nothing at all.
-- `owner` is not issued either — ownership comes from `nodes.owner_id`, and a
-- grant that could confer it would be a second, unaudited path to it.
ALTER TABLE "shares" ADD CONSTRAINT "shares_role_is_issuable"
  CHECK ("role" IN ('viewer', 'editor'));
