/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Watch IDs look like "SS-7KQ2-M9XD-4TFH": 12 Crockford base32 characters
// generated on the watch (garmin/safespot-fenix/source/DeviceId.mc).

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BODY_LENGTH = 12;

export const WATCH_DEVICE_ID_PATTERN = /^SS-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/**
 * Normalizes what a user types into the canonical ID. Case, spaces and
 * dashes don't matter, and look-alike letters map the Crockford way
 * (O→0, I/L→1). Returns the cleaned partial input while still typing.
 */
export function normalizeWatchDeviceId(raw: string): string {
  let body = raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (body.startsWith('SS')) body = body.slice(2);
  body = [...body].filter((c) => ALPHABET.includes(c)).join('').slice(0, BODY_LENGTH);

  const groups = body.match(/.{1,4}/g) ?? [];
  return groups.length ? `SS-${groups.join('-')}` : '';
}

export function isValidWatchDeviceId(id: string): boolean {
  return WATCH_DEVICE_ID_PATTERN.test(id);
}
