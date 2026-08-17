/// <reference types="vite/client" />

/**
 * The client-visible environment. Vite only exposes `VITE_`-prefixed values,
 * and everything here is public by definition — no secret belongs in it.
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /**
   * `mock` swaps the axios adapter for the placeholder data layer. Ignored in
   * a production build; see apps/web/src/shared/mock/TODO.md §4.
   */
  readonly VITE_API_MODE?: 'mock' | 'live';
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
