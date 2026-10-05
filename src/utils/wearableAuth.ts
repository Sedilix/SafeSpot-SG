/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Authorization rules for the wearable endpoints, kept pure so they can be
// tested without Express or Firebase.

/** Extracts the token from an `Authorization: Bearer <token>` header. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? '');
  return match ? match[1] : null;
}

/**
 * A device pairing may be created, changed, read or removed only by the
 * account that owns it. An unpaired device can be claimed by any signed-in
 * user; after that it is locked to them.
 */
export function canManagePairing(ownerUid: string | null, callerUid: string): boolean {
  return ownerUid === null || ownerUid === callerUid;
}

export type WearableEventAuthResult = 'ok' | 'unconfigured' | 'invalid';

/**
 * Watch events can create incidents and send SMS, so in production a missing
 * WEARABLE_TOKEN fails closed instead of accepting anonymous events.
 * Development keeps the old behaviour (no token = open) for the simulator.
 */
export function checkWearableEventAuth(
  expectedToken: string | undefined,
  providedToken: string | undefined,
  isProduction: boolean,
): WearableEventAuthResult {
  if (!expectedToken) return isProduction ? 'unconfigured' : 'ok';
  return providedToken === expectedToken ? 'ok' : 'invalid';
}
