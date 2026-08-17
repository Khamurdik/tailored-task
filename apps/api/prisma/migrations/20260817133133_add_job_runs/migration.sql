-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('running', 'succeeded', 'failed', 'timed_out', 'skipped', 'interrupted');

-- CreateEnum
CREATE TYPE "job_trigger" AS ENUM ('schedule', 'manual');

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "job_id" TEXT NOT NULL,
    "trigger" "job_trigger" NOT NULL,
    "status" "job_status" NOT NULL DEFAULT 'running',
    "triggered_by_user_id" UUID,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "result" JSONB,
    "error_message" TEXT,
    "error_stack" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_runs_job_id_started_at_idx" ON "job_runs"("job_id", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_triggered_by_user_id_fkey" FOREIGN KEY ("triggered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "refresh_tokens_expires_at" RENAME TO "refresh_tokens_expires_at_idx";

-- ---------------------------------------------------------------------------
-- The rename above is Prisma reconciling a hand-written index with its own
-- naming convention. It is a rename and not a drop, which is the outcome that
-- was worth checking: `refresh_tokens_expires_at` was created by hand in
-- `add_refresh_tokens` and never declared in `schema.prisma`, so the first
-- attempt at this migration contained `DROP INDEX "refresh_tokens_expires_at"`
-- and would have removed the index `purge-expired-tokens` is built on.
--
-- The other hand-written indexes in this schema are partial, or carry an
-- operator class or an explicit collation, and Prisma cannot represent any of
-- those — so it leaves them alone. This one was a plain single-column btree,
-- which Prisma can represent, and an index in the database that the schema does
-- not declare reads to `migrate dev` as drift. It is declared now.
-- ---------------------------------------------------------------------------

-- `running` is never a resting state, made checkable for a single row: a run is
-- either in flight with no end, or finished with one. It cannot enforce that a
-- run eventually finishes — that is the startup sweep's and the stale-run
-- guard's job — but it does stop a terminal status being written without the
-- timestamps that explain it.
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_finished_iff_terminal"
  CHECK (("status" = 'running') = ("finished_at" IS NULL));

-- A duration exists exactly when the run has finished, and is computed from the
-- two timestamps rather than from a stopwatch variable.
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_duration_iff_finished"
  CHECK (("duration_ms" IS NULL) = ("finished_at" IS NULL));

-- There is deliberately **no** constraint requiring `triggered_by_user_id` on a
-- manual run. The column is `ON DELETE SET NULL` so that history outlives the
-- operator who made it, and a NOT NULL rule here would make deleting a user
-- fail against rows that are supposed to survive them.
