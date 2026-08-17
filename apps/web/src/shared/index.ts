/**
 * The public surface of `web/shared`. Feature folders import from here.
 */
export { api, createApiClient, setSessionExpiredHandler } from './api/client';
export { refreshSession, resetRefreshState, REFRESH_PATH } from './api/refresh';

export * as tokenStore from './auth/token-store';
export { getShareToken, setShareToken, type Credential } from './auth/share-session';

export { AppError, toAppError, type AppErrorKind } from './errors/app-error';
export { describe as describeError, errorMessages, type Recovery } from './errors/messages';

export { queryKeys } from './query/keys';
export { createQueryClient, clearSession, shouldRetry } from './query/query-client';
