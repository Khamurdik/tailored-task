import {
  InitUploadRequestSchema,
  MAX_FILE_SIZE,
  type ContentUrlResponse,
  type InitUploadResponse,
} from '@dataroom/shared';

import { readable, writable } from '../access';
import { isVisible, mockDb, toDetail, type MockNode } from '../db';
import {
  fail,
  noContent,
  notFound,
  ok,
  validationFailed,
  type MockRequest,
  type MockResponse,
} from '../http';
import { resolveActor } from '../session';

/** The magic bytes `/complete` checks under `UPLOAD_FILE_POLICY=pdf-only`. */
const PDF_MAGIC = '%PDF-';

function suggestFrom(taken: Set<string>, name: string): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const hasExtension = dot > 0 && dot < name.length - 1;
  const stem = hasExtension ? name.slice(0, dot) : name;
  const extension = hasExtension ? name.slice(dot) : '';
  for (let n = 1; n < 1000; n += 1) {
    const candidate = `${stem} (${n})${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem} (${Date.now()})${extension}`;
}

/**
 * `POST /uploads/init`.
 *
 * The node row is inserted as **`pending` now**, which is the behaviour worth
 * reproducing: the name is reserved for the whole upload window, so two
 * simultaneous drops of the same filename resolve to two names rather than
 * racing at the end when the bytes are already spent. The upload queue UI is
 * built directly on that.
 */
export function initUpload(request: MockRequest): MockResponse {
  const actor = resolveActor(request);
  const parsed = InitUploadRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    const tooBig = parsed.error.issues.some((issue) => issue.path[0] === 'sizeBytes');
    return tooBig
      ? fail(413, 'FILE_TOO_LARGE', 'That file is larger than the maximum upload size', {
          max: MAX_FILE_SIZE,
        })
      : validationFailed('An upload needs a parent, a name, a size and a content type');
  }

  const parent = writable(actor, parsed.data.parentId);
  if (parent === null || parent.type === 'file') return notFound();

  const nodes = mockDb().nodes;
  const taken = new Set(
    [...nodes.values()]
      .filter((node) => node.parentId === parent.id && isVisible(nodes, node))
      .map((node) => node.name),
  );
  const finalName = suggestFrom(taken, parsed.data.name.normalize('NFC').trim());
  const now = new Date().toISOString();

  const node: MockNode = {
    id: crypto.randomUUID(),
    type: 'file',
    rootId: parent.rootId,
    parentId: parent.id,
    ownerId: parent.ownerId,
    name: finalName,
    depth: parent.depth + 1,
    state: 'pending',
    sizeBytes: null,
    contentType: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  nodes.set(node.id, node);

  const body: InitUploadResponse = {
    nodeId: node.id,
    // Recognised by the fake transport, which accepts the PUT and keeps the
    // bytes in memory. Nothing leaves the browser.
    uploadUrl: `mock://uploads/${node.id}`,
    finalName,
  };
  return ok(body);
}

/**
 * `POST /uploads/:id/complete`.
 *
 * Size and content type come from the stored bytes, never from the client —
 * the same rule as the real endpoint, so the UI cannot come to rely on its own
 * claim being echoed back. Under `pdf-only` the leading bytes decide, which is
 * the case a client declaring `application/pdf` and uploading HTML exists for.
 */
export function completeUpload(request: MockRequest): MockResponse {
  const actor = resolveActor(request);
  const node = writable(actor, request.params['id'] ?? '');
  if (node === null || node.type !== 'file') return notFound();

  const db = mockDb();
  const bytes = db.blobs.get(node.id);
  if (bytes === undefined) {
    // Node stays pending for the reaper — one of the four upload states, and
    // the one a closed tab produces.
    return validationFailed('No object was uploaded for this node');
  }

  const head = new TextDecoder().decode(bytes.slice(0, PDF_MAGIC.length));
  if (head !== PDF_MAGIC) {
    return fail(415, 'UNSUPPORTED_FILE_TYPE', 'Only PDF files are accepted');
  }

  node.state = 'active';
  node.sizeBytes = bytes.byteLength;
  node.contentType = 'application/pdf';
  node.updatedAt = new Date().toISOString();

  return ok(toDetail(db.nodes, node));
}

export function abortUpload(request: MockRequest): MockResponse {
  const actor = resolveActor(request);
  const node = writable(actor, request.params['id'] ?? '');
  if (node === null) return notFound();

  const db = mockDb();
  db.blobs.delete(node.id);
  if (node.state === 'pending') db.nodes.delete(node.id);

  return noContent();
}

/**
 * `GET /nodes/:id/content-url`.
 *
 * Returns a `blob:` URL over the stored bytes, which is what makes the PDF
 * viewer buildable with no bucket. The expiry is real enough to matter: the
 * viewer must never cache a signed URL, and a TTL it can see is what makes
 * that rule testable.
 */
export function contentUrl(request: MockRequest): MockResponse {
  const actor = resolveActor(request);
  const node = readable(actor, request.params['id'] ?? '');
  if (node === null || node.type !== 'file') return notFound();

  const bytes = mockDb().blobs.get(node.id) ?? placeholderPdf(node.name);
  // `.slice()` rather than passing the view straight in: `Uint8Array` is
  // generic over its buffer since TS 5.7, and `BlobPart` requires an
  // `ArrayBuffer` specifically — a `SharedArrayBuffer`-backed view is not
  // assignable. Slicing produces a fresh, definitely-non-shared buffer.
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' });

  const body: ContentUrlResponse = {
    url: URL.createObjectURL(blob),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  return ok(body);
}

/**
 * A one-page PDF naming the file, for fixtures that have no uploaded bytes.
 *
 * Hand-assembled rather than pulled from a binary asset: it keeps the fixtures
 * readable as text, and a viewer built against a real PDF byte stream behaves
 * the same as one built against a decorative image would not.
 */
function placeholderPdf(name: string): Uint8Array {
  const escaped = name.replace(/([()\\])/g, '\\$1');
  const content = `BT /F1 18 Tf 60 760 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}
