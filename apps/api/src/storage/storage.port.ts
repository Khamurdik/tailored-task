export const STORAGE = Symbol('STORAGE');

export interface PresignedPut {
  url: string;
  /**
   * Headers the browser **must** send with the PUT. They are part of the
   * signature, so omitting one makes the upload fail with a signature mismatch
   * rather than succeeding with different metadata.
   */
  headers: Record<string, string>;
}

export interface ObjectHead {
  size: number;
  contentType: string;
}

/**
 * The blob store, as the rest of the system sees it. Knows nothing about the
 * tree, users, or the database, and must be swappable for a local
 * implementation in tests without touching a single caller.
 */
export interface StoragePort {
  /**
   * `exactBytes`, not `maxBytes`, and the distinction is not cosmetic: a
   * presigned PUT signs a `Content-Length` **value**, and cannot express a
   * range at all — that needs a POST policy. So the size limit is enforced at
   * `/uploads/init` against `MAX_FILE_SIZE`, and the authoritative size is read
   * back from `HeadObject` at `/complete`.
   */
  presignPut(key: string, contentType: string, exactBytes: number): Promise<PresignedPut>;

  /**
   * `filename` is the current display name, so a download keeps the right name
   * even after a rename. The disposition **type** is not a parameter — it is
   * decided by the object's stored content type. See the implementations.
   */
  presignGet(key: string, ttlSeconds: number, filename: string): Promise<string>;

  /** Null for a missing key. Never throws for absence — absence is an answer. */
  head(key: string): Promise<ObjectHead | null>;

  delete(key: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
}

/**
 * `rooms/{rootId}/{nodeId}` — ids only.
 *
 * No user-supplied filename ever reaches a key, which makes key collisions and
 * path traversal impossible by construction rather than by sanitisation. The
 * display name lives in the database and travels in `Content-Disposition`.
 *
 * A `{versionId}` segment was specified and removed: no module owns a versions
 * table and no responsibility creates one, so it was a placeholder for a
 * feature that does not exist. Add it back in the same change that adds the
 * table, not before.
 */
export function objectKey(rootId: string, nodeId: string): string {
  return `rooms/${rootId}/${nodeId}`;
}

/**
 * Only `application/pdf` is ever served inline. Everything else is an
 * attachment, **under both values of `UPLOAD_FILE_POLICY`**.
 *
 * This deliberately does not consult config. Uploads are served from the S3
 * origin, `inline` makes the browser render rather than download, and the
 * viewer frames that URL — so under `all-files` an uploaded `.html` or `.svg`
 * would execute as script on the bucket origin, where the web app's CSP cannot
 * reach it. That CSP is the mitigation the entire `localStorage` token decision
 * rests on. A config flag must not be able to open that path, so the rule sits
 * outside the toggle and takes no argument that could carry one.
 */
export function dispositionType(contentType: string | null | undefined): 'inline' | 'attachment' {
  return normalizeContentType(contentType) === 'application/pdf' ? 'inline' : 'attachment';
}

/** `application/pdf; charset=binary` is still a PDF. Compare the media type only. */
function normalizeContentType(contentType: string | null | undefined): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/**
 * RFC 6266 `Content-Disposition`.
 *
 * Both forms are emitted: a sanitised ASCII `filename=` for old clients and
 * `filename*=UTF-8''…` for everyone else. The sanitisation is the security
 * half — a display name is user-controlled, and a name containing a quote, a
 * newline, or a semicolon could otherwise terminate the header value early and
 * inject a second header.
 */
export function contentDisposition(contentType: string | null | undefined, filename: string): string {
  const type = dispositionType(contentType);

  // Strip anything that could end the value or start a new header, then fall
  // back rather than emit an empty filename.
  const ascii =
    // eslint-disable-next-line no-control-regex
    filename.replace(/[\u0000-\u001F\u007F"\\;,\r\n]/g, '').trim() || 'download';

  // encodeURIComponent leaves ' ( ) * alone; RFC 5987 wants them percent-encoded.
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
