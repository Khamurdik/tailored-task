import {
  LoginResponseSchema,
  SessionUserSchema,
  type LoginRequest,
  type LoginResponse,
  type SessionUser,
} from '@dataroom/shared';
import type { AxiosInstance } from 'axios';

import { api } from '@/shared/api/client';
import { request } from '@/shared/api/request';

/**
 * Every call parses its response against the shared schema, so a server one
 * deploy ahead produces a failed request rather than an `undefined` rendered
 * into the header.
 */

export async function login(body: LoginRequest, client: AxiosInstance = api): Promise<LoginResponse> {
  return request(LoginResponseSchema, { method: 'POST', url: '/auth/login', data: body }, client);
}

/**
 * Google sign-in **links to an existing account and never creates one.**
 *
 * The client sends the ID token and takes whatever comes back. It does not
 * inspect the token, and it must not translate "no user for this email" into
 * its own message — the API returns one indistinguishable failure precisely so
 * that the login page is not an oracle for which addresses are provisioned.
 */
export async function loginWithGoogle(
  idToken: string,
  client: AxiosInstance = api,
): Promise<LoginResponse> {
  return request(
    LoginResponseSchema,
    { method: 'POST', url: '/auth/google', data: { idToken } },
    client,
  );
}

export async function me(client: AxiosInstance = api): Promise<SessionUser> {
  return request(SessionUserSchema, { method: 'GET', url: '/auth/me' }, client);
}

/**
 * Logout is a **server** operation.
 *
 * Clearing `localStorage` is not a logout: the refresh family stays alive
 * server-side, so anyone holding the stolen token can mint new access tokens
 * for another seven days. The API call is the part that revokes; dropping the
 * local copy is bookkeeping.
 */
export async function logout(refreshToken: string, client: AxiosInstance = api): Promise<void> {
  await client.post('/auth/logout', { refreshToken });
}
