import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
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
      { expiresIn: 900 },
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
  return (
    typeof cause === 'object' &&
    cause !== null &&
    '$metadata' in cause &&
    (cause as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
  );
}
