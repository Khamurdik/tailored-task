import { z } from 'zod';

import { CursorSchema } from './pagination.js';

export const JobIdSchema = z.enum([
  'reap-pending-uploads',
  'hard-delete-expired',
  'purge-expired-grants',
  'purge-expired-tokens',
  'reconcile-rollups',
  'prune-job-runs',
]);
export type JobId = z.infer<typeof JobIdSchema>;

/** `running` is never a resting state. Every run reaches one of the other five. */
export const JobStatusSchema = z.enum([
  'running',
  'succeeded',
  'failed',
  'timed_out',
  'skipped',
  'interrupted',
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobTriggerSchema = z.enum(['schedule', 'manual']);
export type JobTrigger = z.infer<typeof JobTriggerSchema>;

export const JobRunSummarySchema = z.strictObject({
  id: z.uuid(),
  jobId: JobIdSchema,
  trigger: JobTriggerSchema,
  status: JobStatusSchema,
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  durationMs: z.int().nonnegative().nullable(),
});
export type JobRunSummary = z.infer<typeof JobRunSummarySchema>;

/**
 * `errorStack` is on the row and deliberately not on the wire. A stack trace
 * names internal paths and library versions, and these endpoints exist to tell
 * an admin *what* failed, not to hand out a map of the deployment.
 */
export const JobRunDetailSchema = JobRunSummarySchema.extend({
  triggeredByUserId: z.uuid().nullable(),
  result: z.record(z.string(), z.union([z.number(), z.string()])).nullable(),
  errorMessage: z.string().nullable(),
  attempt: z.int().positive(),
});
export type JobRunDetail = z.infer<typeof JobRunDetailSchema>;

/**
 * `nextRunAt` is an ISO string here and a Luxon `DateTime` inside the API —
 * `cron@4` returns Luxon from `nextDate()`. Serializing it with `.toISO()` is
 * the API's job; handing the object straight to the serializer produces a blob
 * of internal Luxon fields, and `new Date(nextDate())` yields `Invalid Date`.
 *
 * Null when the job is disabled. A disabled job still lists — a job you cannot
 * see is a job you forget exists.
 */
export const JobSummarySchema = z.strictObject({
  id: JobIdSchema,
  name: z.string(),
  description: z.string(),
  cron: z.string(),
  timezone: z.literal('UTC'),
  enabled: z.boolean(),
  timeoutMs: z.int().positive(),
  onOverlap: z.enum(['skip', 'reject']),
  nextRunAt: z.iso.datetime().nullable(),
  lastRun: JobRunSummarySchema.nullable(),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;

export const JobDetailSchema = JobSummarySchema.extend({
  recentRuns: z.array(JobRunSummarySchema),
});
export type JobDetail = z.infer<typeof JobDetailSchema>;

export const JobRunsPageSchema = z.strictObject({
  items: z.array(JobRunSummarySchema),
  nextCursor: CursorSchema.nullable(),
});
export type JobRunsPage = z.infer<typeof JobRunsPageSchema>;

/** 202 Accepted. The caller polls the run; it does not wait on it. */
export const TriggerJobResponseSchema = z.strictObject({
  runId: z.uuid(),
});
export type TriggerJobResponse = z.infer<typeof TriggerJobResponseSchema>;
