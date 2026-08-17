import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../common';
import {
  contentDisposition,
  type ObjectHead,
  type PresignedPut,
  type StoragePort,
} from './storage.port';

@Injectable()
export class S3StorageAdapter implements StoragePort {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.bucket = config.s3.bucket;
    this.client = new S3Client({
      region: config.s3.region,
      // Unset for real AWS. Set, it points at a local S3-compatible bucket —
      // which is what lets the upload path run, and be tested, without an AWS
      // account. `forcePathStyle` travels with it because there is no wildcard
      // DNS in front of a bare host.
      ...(config.s3.endpoint === undefined
        ? {}
        : { endpoint: config.s3.endpoint, forcePathStyle: config.s3.forcePathStyle }),
      // Undefined credentials means the SDK falls back to the instance role,
      // which is how this should run in App Runner. Explicit keys are for local
      // development, and are the case worth keeping working, not the default.
      ...(config.s3.accessKeyId !== undefined && config.s3.secretAccessKey !== undefined
        ? {
            credentials: {
              accessKeyId: config.s3.accessKeyId,
              secretAccessKey: config.s3.secretAccessKey,
            },
          }
        : {}),
    });
  }

  /**
   * `ContentType` and `ContentLength` are pinned into the signature, so a
   * client cannot upload something other than what it declared — the signature
   * simply will not match. That is what makes the client's declaration at
   * `/uploads/init` binding rather than advisory.
   *
   * ## `signableHeaders` is load-bearing, and this comment was wrong without it
   *
   * The claim above was written before anything had ever run against a real
   * bucket, and it was **false**: for a presigned URL the SDK signs only what it
   * must, and the emitted `X-Amz-SignedHeaders` was `content-length;host`.
   * `ContentType` on the command sets a header the signature does not cover, so
   * a browser could declare `application/pdf` at `/uploads/init` and PUT
   * anything it liked. `API-STORAGE-008` caught it the first time it ran.
   *
   * Nothing downstream was actually relying on the claim — `/complete` takes the
   * size and type from `HeadObject` and reads the object's leading bytes, which
   * is the check that matters — so this is defence in depth rather than a hole
   * that was open. But a comment asserting a security property the code does not
   * have is worse than no comment, so the option makes it true.
   */
  async presignPut(key: string, contentType: string, exactBytes: number): Promise<PresignedPut> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: exactBytes,
      }),
      {
        expiresIn: 900,
        // Without this the header is sent and not signed. `content-length` is
        // signed by default; `content-type` has to be asked for.
        signableHeaders: new Set(['content-type']),
      },
    );

    return {
      url,
      headers: { 'Content-Type': contentType, 'Content-Length': String(exactBytes) },
    };
  }

  /**
   * The disposition comes from the object's **stored** content type, which
   * means a `HeadObject` before signing. That extra call is the price of the
   * rule holding: taking the type from the caller would let whoever calls this
   * choose `inline`, and the whole point is that nobody can.
   *
   * Every parameter is required, with no defaults. An earlier version defaulted
   * `ttlSeconds` and `filename`, which made this adapter and the in-memory one
   * behave differently when called with fewer arguments — a fake that can
   * diverge from the real thing devalues every test that uses it. The TTL is
   * the caller's policy anyway (`S3_PRESIGN_GET_TTL_SECONDS`, read by `files`),
   * not the transport's, and it is the entire mitigation for a presigned GET
   * being unrevocable: revoking a share does not kill a URL already handed out.
   */
  async presignGet(key: string, ttlSeconds: number, filename: string): Promise<string> {
    const stored = await this.head(key);

    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(stored?.contentType, filename),
        // Pinned so a stored type of `text/html` cannot be re-served as
        // something the browser treats differently.
        ResponseContentType: stored?.contentType ?? 'application/octet-stream',
      }),
      { expiresIn: ttlSeconds },
    );
    // Never log the result. A presigned URL is a bearer credential — anyone
    // holding it has the object for the length of the TTL.
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        size: result.ContentLength ?? 0,
        contentType: result.ContentType ?? 'application/octet-stream',
      };
    } catch (cause) {
      // Absence is an answer, not a failure. The caller asking "is it there?"
      // gets null; anything else is a real error and keeps propagating.
      if (cause instanceof NotFound) return null;
      if (isNotFoundStatus(cause)) return null;
      throw cause;
    }
  }

  /**
   * A **ranged** `GetObject`, so S3 transfers five bytes rather than the object.
   *
   * `Range: bytes=0-N` is inclusive at both ends, hence `maxBytes - 1`. An
   * object shorter than the range is not an error — S3 returns 206 with what it
   * has — so a short buffer means a short object, not a failure.
   */
  async readPrefix(key: string, maxBytes: number): Promise<Buffer | null> {
    if (maxBytes <= 0) return Buffer.alloc(0);

    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: `bytes=0-${maxBytes - 1}`,
        }),
      );

      if (result.Body === undefined) return null;
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (cause) {
      if (cause instanceof NoSuchKey) return null;
      if (isNotFoundStatus(cause)) return null;
      // 416 means the object exists and is empty, so the range is unsatisfiable.
      // That is "no magic bytes", not "no object" — and returning null here
      // would make an empty upload indistinguishable from a missing one.
      if (isRangeNotSatisfiable(cause)) return Buffer.alloc(0);
      throw cause;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async copy(from: string, to: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${from}`,
        Key: to,
      }),
    );
  }
}

/**
 * `HeadObject` on a missing key can surface as a bare 404 with no error body,
 * because HEAD responses carry none — so the typed `NotFound` is not always
 * constructed and the status has to be checked directly.
 */
function isNotFoundStatus(cause: unknown): boolean {
  return statusOf(cause) === 404;
}

/** 416: the object exists but is shorter than the requested range — i.e. empty. */
function isRangeNotSatisfiable(cause: unknown): boolean {
  return statusOf(cause) === 416;
}

function statusOf(cause: unknown): number | undefined {
  return typeof cause === 'object' && cause !== null && '$metadata' in cause
    ? (cause as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    : undefined;
}
