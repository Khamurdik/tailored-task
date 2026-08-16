/**
 * Compile-time constants, owned here and nowhere else.
 *
 * These are not configuration. The client validates against the same numbers
 * the server enforces, which is the whole reason this package exists — a limit
 * that lives in server `.env` is a limit the bundle cannot check.
 */

/** Maximum ancestor count. A room is depth 0. */
export const MAX_DEPTH = 32;

/** Characters, after NFC normalization — not bytes. */
export const MAX_NAME_LENGTH = 255;

/** 50 MiB. */
export const MAX_FILE_SIZE = 52_428_800;

/** Children per page. Keyset, not offset. */
export const PAGE_SIZE = 50;
