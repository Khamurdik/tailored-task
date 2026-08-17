-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The refresh path's query: a live token by hash. Partial, so rotated and
-- revoked rows do not compete for the index — and liveness is in the predicate
-- rather than in JS for the same reason it is in `shares`.
CREATE INDEX "refresh_tokens_live_by_hash"
  ON "refresh_tokens" ("token_hash")
  WHERE "revoked_at" IS NULL;

-- `purge-expired-tokens` sweeps by expiry.
CREATE INDEX "refresh_tokens_expires_at"
  ON "refresh_tokens" ("expires_at");
