import { Inject, Injectable, Logger } from '@nestjs/common';
import type { InitUploadRequest } from '@dataroom/shared';

import { APP_CONFIG, AppError, MAX_FILE_SIZE, type AppConfig } from '../common';
import { NodesService, type Node } from '../nodes';
import { STORAGE, objectKey, type StoragePort } from '../storage';

/** `%PDF-`. Five bytes, and the only thing that decides whether a PDF is a PDF. */
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');

export interface InitiatedUpload {
  node: Node;
  uploadUrl: string;
}

export interface ReapResult {
  scanned: number;
  deleted: number;
}

/**
 * The upload lifecycle. The only module that knows both what a node is and what
 * a bucket is.
 *
 * Authorization happens above this, in the controller — `files` never asks who
 * is calling, for the same reason `nodes` does not.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly nodes: NodesService,
    @Inject(STORAGE) private readonly storage: StoragePort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Reserves a name, creates the `pending` row, and signs a PUT for it.
   *
   * The client's `sizeBytes` and `contentType` are **pinned into the
   * signature**, which is what makes them binding rather than advisory: a
   * browser that uploads something else gets a signature mismatch from S3
   * rather than a successful upload with different metadata. They are still not
   * trusted for what gets *stored* — `/complete` reads that back from the
   * object.
   */
  async init(request: InitUploadRequest): Promise<InitiatedUpload> {
    // Bounds-checked here as well as in the schema so the limit holds for any
    // caller, not only one that came through the parsed route.
    if (request.sizeBytes > MAX_FILE_SIZE) throw AppError.fileTooLarge(MAX_FILE_SIZE);

    const node = await this.nodes.createPendingFile(request.parentId, request.name);

    const presigned = await this.storage.presignPut(
      objectKey(node.rootId, node.id),
      request.contentType,
      request.sizeBytes,
    );

    return { node, uploadUrl: presigned.url };
  }

  /**
   * Verifies the object, takes its authoritative metadata, and flips the row.
   *
   * ## The order of the three checks is deliberate
   *
   * `head` first, so "you never uploaded anything" is a 400 rather than a type
   * rejection. Then the policy, which reads **bytes** rather than the stored
   * content type — a client that declares `application/pdf` and uploads HTML is
   * the entire case this exists for, and the declared type is exactly what such
   * a client controls. Only then the flip.
   *
   * A rejected upload leaves the node `pending` on purpose. It is already the
   * reaper's problem, the name stays reserved while the user retries, and
   * deleting it here would race a retry that is already in flight.
   */
  async complete(nodeId: string): Promise<Node> {
    const node = await this.nodes.findById(nodeId);
    if (node === null || node.type !== 'file') throw AppError.notFound();

    const key = objectKey(node.rootId, node.id);

    const head = await this.storage.head(key);
    if (head === null) {
      throw AppError.validationFailed({ upload: 'No object was uploaded for this file' });
    }

    await this.assertPolicyAllows(key);

    /**
     * **Both values come from storage, never from the client.**
     *
     * A lying client otherwise produces a perfectly plausible row, and nothing
     * looks wrong until a quota calculation or a download breaks months later.
     * Invariant 8 in `docs/ARCHITECTURE.md`.
     */
    const completed = await this.nodes.completeFile({
      id: node.id,
      sizeBytes: head.size,
      contentType: head.contentType,
    });

    // Null means the row was not `pending` — a retried `/complete`. Returning
    // the node as it stands makes the endpoint idempotent rather than
    // incrementing the ancestors' rollups a second time.
    if (completed !== null) return completed;

    const current = await this.nodes.findById(nodeId);
    if (current === null) throw AppError.notFound();
    return current;
  }

  /**
   * User cancelled. Best-effort, and the order matters.
   *
   * The row goes first: if the object delete fails, the outcome is an orphaned
   * object that the bucket's own lifecycle rule collects, which is harmless.
   * The other order risks a deleted object under a live row — a file that
   * exists in the tree and cannot be downloaded.
   */
  async abort(nodeId: string): Promise<void> {
    const node = await this.nodes.findById(nodeId);
    if (node === null || node.type !== 'file') throw AppError.notFound();

    const discarded = await this.nodes.discardPendingFile(node.id);
    // Aborting a *completed* upload is not a delete. Deleting a live document
    // through the cancel button of a finished transfer would be a surprising
    // way to lose a file.
    if (!discarded) throw AppError.validationFailed({ upload: 'That upload is already complete' });

    await this.storage.delete(objectKey(node.rootId, node.id)).catch((cause: unknown) => {
      this.logger.warn(`Could not remove the object for aborted upload ${node.id}: ${String(cause)}`);
    });
  }

  /**
   * A short-lived signed GET.
   *
   * The TTL is the **entire** mitigation for the fact that a presigned URL
   * cannot be revoked once issued — revoking a share does not kill a URL already
   * handed out. That is why it is 60 seconds by default and why the client is
   * told the expiry rather than being left to cache it.
   */
  async contentUrl(nodeId: string): Promise<{ url: string; expiresAt: Date }> {
    const node = await this.nodes.findById(nodeId);
    if (node === null || node.type !== 'file' || node.state !== 'active') {
      // A `pending` file is not a document yet. 404 rather than a specific
      // error, so the state of somebody else's upload is not observable.
      throw AppError.notFound();
    }

    const ttl = this.config.s3.presignGetTtlSeconds;
    const url = await this.storage.presignGet(objectKey(node.rootId, node.id), ttl, node.name);

    return { url, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  /**
   * Drops `pending` rows whose upload never arrived, and their objects.
   *
   * Returns counts rather than nothing, so a job run reports what it actually
   * did instead of merely "succeeded" — a green run that says `{deleted: 0}`
   * every day is evidence, and a green run that says nothing is not.
   */
  async reapPending(olderThan: Date): Promise<ReapResult> {
    const stale = await this.nodes.stalePendingFiles(olderThan);
    if (stale.length === 0) return { scanned: 0, deleted: 0 };

    const deleted = await this.nodes.discardPendingFiles(stale.map((node) => node.id));

    // After the rows, for the same reason `abort` does it in that order: an
    // orphaned object is collected by the bucket lifecycle rule, an orphaned
    // row is a file the user can see and cannot open.
    for (const node of stale) {
      await this.storage.delete(objectKey(node.rootId, node.id)).catch((cause: unknown) => {
        this.logger.warn(`Could not remove the object for reaped upload ${node.id}: ${String(cause)}`);
      });
    }

    return { scanned: stale.length, deleted };
  }

  /**
   * Hard-deletes nodes soft-deleted before the cutoff, **and their objects**.
   *
   * The only place in the system an object is ever removed. It lives here rather
   * than in `jobs` because it is the one operation that spans the tree and the
   * bucket, which is what this module is for — `jobs` orchestrates, it does not
   * learn what a bucket is.
   *
   * Rows go deepest-first (`parent_id` is `ON DELETE RESTRICT`), and the object
   * follows the row for the same reason as everywhere else: an orphaned object
   * is collected by the bucket lifecycle rule, an orphaned row is a document
   * somebody can see and cannot open.
   */
  async hardDeleteExpired(olderThan: Date): Promise<{ nodes: number; objects: number; bytes: number }> {
    const expired = await this.nodes.deletedBefore(olderThan);
    if (expired.length === 0) return { nodes: 0, objects: 0, bytes: 0 };

    const removed = await this.nodes.hardDelete(expired.map((node) => node.id));

    let objects = 0;
    let bytes = 0;
    for (const node of expired) {
      if (node.type !== 'file') continue;
      try {
        await this.storage.delete(objectKey(node.rootId, node.id));
        objects += 1;
        bytes += node.sizeBytes ?? 0;
      } catch (cause) {
        this.logger.warn(`Could not remove the object for hard-deleted ${node.id}: ${String(cause)}`);
      }
    }

    return { nodes: removed, objects, bytes };
  }

  /**
   * Enforces `UPLOAD_FILE_POLICY` against the object's **leading bytes**.
   *
   * Reading the bytes rather than the stored content type is the point: the
   * content type was pinned from the client's own declaration, so trusting it
   * here would mean asking the attacker whether they are attacking.
   *
   * Note what this deliberately does *not* touch: `Content-Disposition`. Only
   * `application/pdf` is ever served `inline`, under **both** values of this
   * toggle — see `storage.port.ts`. Uploads are served from the S3 origin, where
   * the web app's CSP cannot reach, so a config flag must not be able to open a
   * stored-XSS path into the session token.
   */
  private async assertPolicyAllows(key: string): Promise<void> {
    if (this.config.uploads.policy !== 'pdf-only') return;

    const prefix = await this.storage.readPrefix(key, PDF_MAGIC.length);
    // A short read is a short object, not a failure — and an object too short to
    // carry the magic bytes is not a PDF.
    if (prefix === null || !prefix.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
      throw AppError.unsupportedFileType();
    }
  }
}

export { PDF_MAGIC };
