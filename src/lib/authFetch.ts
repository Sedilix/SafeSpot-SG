/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { auth, signInAsGuest } from './firebase';

/**
 * fetch() with the signed-in user's Firebase ID token. If nobody is signed
 * in, a guest account is created first, so sending messages works without
 * making the senior create an account.
 */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const user = auth.currentUser ?? (await signInAsGuest());
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(url, { ...init, headers });
}

/** Reads `{ error }` from a failed response, or a generic message. */
export async function responseError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return typeof data?.error === 'string' ? data.error : fallback;
}
