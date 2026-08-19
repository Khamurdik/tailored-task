/**
 * The demo data room — a **pure-data strip-safe leaf module**.
 *
 * `prisma db seed` runs `node prisma/seed.ts` under Node's type stripping, and
 * the whole transitive import graph of that file lives under the four rules in
 * `seed.ts`'s header. This file obeys the strictest reading of them: it has **no
 * imports at all** and declares no runtime behaviour, only data. That is also
 * why it can stay inside `tsconfig.json`'s `include` while `seed.ts` cannot —
 * there is no `.ts` specifier here for `node10` resolution to reject.
 *
 * ## What this is for
 *
 * The tree, the grants and the ids below are the dataset `REVIEW.md` and
 * `HANDOFF-DEMO-DATA.md` describe and publish links into. Until this file
 * existed they were built by hand against a live deployment, so a rebuilt
 * database came up with accounts and an empty room list, and the two node links
 * printed in `REVIEW.md` pointed at rows that no longer existed.
 *
 * **The ids are therefore part of the published contract, not an implementation
 * detail.** `financials` and `legal` carry the exact ids in `REVIEW.md` §"A
 * five-minute walkthrough"; changing either breaks a link a reviewer is being
 * asked to click. The rest are fixed for the same reason a fixed id is useful
 * anywhere: re-seeding recognises what it already created instead of building a
 * second copy of the room beside the first.
 *
 * ## What the dataset has to demonstrate
 *
 * Every element earns its place by making one rule visible, and the four are
 * what `REVIEW.md`'s matrix is measuring:
 *
 *   - two rooms with different owners  — ownership is read from the node, so
 *     Ana and Bo are mutually invisible;
 *   - two non-overlapping grants inside *one* room — Cara and Dmytro cannot see
 *     each other's folder;
 *   - a folder granted to nobody (`HR`) — the owner-only control case;
 *   - a public link with a short code — a visitor holding no account at all.
 *
 * A fifth is an absence: `erik.sandberg@example.com` appears nowhere in this
 * file. He is provisioned by `SEED_USERS` and granted nothing, which is the row
 * that shows authentication is not authorization.
 */

/**
 * One node. The union mirrors three of the database's CHECK constraints, so a
 * malformed fixture fails to compile rather than failing on insert:
 * `nodes_room_is_root` (only a room has no parent), `nodes_room_depth_zero`,
 * and `nodes_only_files_have_bytes` (only a file carries bytes).
 *
 * `parent` names a `key`, never an id. Keys are local to this file — the seeder
 * resolves them to real rows — which keeps the fixture readable and makes the
 * ordering requirement below checkable by eye.
 */
export type DemoNode =
  | {
      key: string;
      id: string;
      type: 'room';
      name: string;
      parent: null;
      /** A `SEED_USERS` email. Everything beneath a room inherits its owner. */
      ownerEmail: string;
    }
  | { key: string; id: string; type: 'folder'; name: string; parent: string }
  | {
      key: string;
      id: string;
      type: 'file';
      name: string;
      parent: string;
      /**
       * Plausible sizes for a demo, not measurements — no bytes are uploaded by
       * the seeder, so nothing reads these back from S3 to disagree with them.
       * They exist because folder rollups are rendered in the listing and a room
       * of six 0-byte files looks broken.
       */
      sizeBytes: number;
      contentType: string;
    };

const PDF = 'application/pdf';

/**
 * **Parents precede children.** The seeder walks this array once, resolving each
 * node's parent from what it has already written, and throws on a forward
 * reference rather than reordering — a fixture that needs two passes is a
 * fixture where the tree is no longer obvious from reading it.
 */
export const DEMO_NODES: DemoNode[] = [
  {
    key: 'meridian',
    id: 'cbd18cfa-8a8a-4a26-834e-4d4fa0ad52f7',
    type: 'room',
    name: 'Project Meridian',
    parent: null,
    ownerEmail: 'ana.ruiz@example.com',
  },
  {
    // Published in REVIEW.md as the folder Cara can open directly. Fixed.
    key: 'financials',
    id: 'd681640f-9005-4fb9-864d-0a307a23e266',
    type: 'folder',
    name: 'Financials',
    parent: 'meridian',
  },
  {
    key: 'q4-report',
    id: '30d02ddd-3bd4-4703-98cc-068356de4ae7',
    type: 'file',
    name: 'q4-report.pdf',
    parent: 'financials',
    sizeBytes: 184_320,
    contentType: PDF,
  },
  {
    key: 'cap-table',
    id: '962b7ffa-509f-420a-bd5a-bb5fdf5743be',
    type: 'file',
    name: 'cap-table.pdf',
    parent: 'financials',
    sizeBytes: 96_256,
    contentType: PDF,
  },
  {
    // Published in REVIEW.md as the folder Cara must NOT be able to open. Fixed.
    key: 'legal',
    id: '52da7215-5e2c-4449-849c-3bb5813fda51',
    type: 'folder',
    name: 'Legal',
    parent: 'meridian',
  },
  {
    key: 'master-agreement',
    id: 'c7560829-bfa9-4c96-ab6e-8739d3f82be3',
    type: 'file',
    name: 'master-agreement.pdf',
    parent: 'legal',
    sizeBytes: 251_904,
    contentType: PDF,
  },
  {
    key: 'hr',
    id: '10927ba8-f04b-4246-9afe-92da5ebdb93b',
    type: 'folder',
    name: 'HR',
    parent: 'meridian',
  },
  {
    key: 'headcount',
    id: '3b15a10d-909a-450f-ac49-e0682ad5e8b8',
    type: 'file',
    name: 'headcount.pdf',
    parent: 'hr',
    sizeBytes: 74_752,
    contentType: PDF,
  },
  {
    key: 'teaser',
    id: 'a8ca712c-2555-44d1-b14b-3d7814c000cb',
    type: 'folder',
    name: 'Teaser',
    parent: 'meridian',
  },
  {
    key: 'teaser-pdf',
    id: '7dafaaf6-0c38-4f7d-80de-e9726c0eb890',
    type: 'file',
    name: 'teaser.pdf',
    parent: 'teaser',
    sizeBytes: 48_128,
    contentType: PDF,
  },
  {
    key: 'northwind',
    id: '2c0d275a-6357-4935-9ab3-ef69ee2f5bfa',
    type: 'room',
    name: 'Project Northwind',
    parent: null,
    ownerEmail: 'bo.lindqvist@example.com',
  },
  {
    key: 'diligence',
    id: '7ab251a8-3ff0-48f8-96a4-fda7f9026e19',
    type: 'folder',
    name: 'Diligence',
    parent: 'northwind',
  },
  {
    key: 'northwind-summary',
    id: 'e65d9d7e-5266-4994-90c5-06a4826464a4',
    type: 'file',
    name: 'northwind-summary.pdf',
    parent: 'diligence',
    sizeBytes: 132_096,
    contentType: PDF,
  },
];

/**
 * A grant. The union mirrors `shares_kind_shape`: a public link has a token and
 * no principal, a user grant has a principal and no token.
 *
 * `role` is absent because there is exactly one issuable role in this build —
 * `viewer`. `sharing` refuses to issue anything else and the column's CHECK
 * refuses to store `none` or `owner`, so a field here would be a knob with one
 * position.
 */
export type DemoShare =
  | {
      id: string;
      nodeKey: string;
      kind: 'user';
      /**
       * Bound to a `user_id` by the seeder when the account exists, which for
       * the demo it does. Left pending — and therefore inert, per
       * `API-ACCESS-016` — when it does not, exactly as an invitation sent
       * ahead of an account would be.
       */
      email: string;
    }
  | {
      id: string;
      nodeKey: string;
      kind: 'public_link';
      /**
       * The 16-character Crockford code published as
       * `/s/VBHV2KVG5Y9F5WZ9` in `REVIEW.md`. Fixed for the same reason the two
       * node ids are: it is a link a reviewer is asked to open.
       *
       * Only the SHA-256 is stored, and only of the **canonical** spelling.
       * Codes here must already be canonical — upper case, and free of `I`, `L`,
       * `O` and `U` — which the seeder asserts rather than assumes, because a
       * code that needed folding would be hashed here one way and looked up by
       * `ShareCodec.canonicalize` another, and the link would 404 with nothing
       * in the logs to say why.
       */
      shortCode: string;
    };

export const DEMO_SHARES: DemoShare[] = [
  {
    id: '2347fb95-9804-42db-a6fb-432ac57b87e7',
    nodeKey: 'financials',
    kind: 'user',
    email: 'cara.mensah@example.com',
  },
  {
    id: '7be59a05-48a7-45e6-9849-a41b70e6de60',
    nodeKey: 'legal',
    kind: 'user',
    email: 'dmytro.kovalenko@example.com',
  },
  {
    id: '53d847b0-bcf9-42d6-9539-d43c27e953db',
    nodeKey: 'teaser',
    kind: 'public_link',
    shortCode: 'VBHV2KVG5Y9F5WZ9',
  },
];

/**
 * Crockford base32, duplicated from `access/share-codec.ts` because that file is
 * `@Injectable()` and a decorator is a `SyntaxError` under type stripping.
 *
 * Duplicating a constant into the strip-safe zone is a real cost, so it buys
 * something: it is used only to *assert* that every fixture code is already
 * canonical, so the two copies cannot silently disagree about a code — they can
 * only disagree about the alphabet, and then this file's assertion fails loudly
 * at seed time.
 */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const SHORT_CODE_LENGTH = 16;
