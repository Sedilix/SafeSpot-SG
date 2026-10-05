/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { bearerToken, canManagePairing, checkWearableEventAuth } from './wearableAuth';

describe('bearerToken', () => {
  it('extracts the token from a Bearer header', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerToken('bearer   xyz')).toBe('xyz');
  });

  it('rejects missing or malformed headers', () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('')).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer')).toBeNull();
    expect(bearerToken('Bearer a b')).toBeNull();
  });
});

describe('canManagePairing', () => {
  it('lets anyone signed in claim an unpaired device', () => {
    expect(canManagePairing(null, 'uid-a')).toBe(true);
  });

  it('locks a paired device to its owner', () => {
    expect(canManagePairing('uid-a', 'uid-a')).toBe(true);
    expect(canManagePairing('uid-a', 'uid-b')).toBe(false);
  });
});

describe('checkWearableEventAuth', () => {
  it('fails closed in production when no token is configured', () => {
    expect(checkWearableEventAuth(undefined, undefined, true)).toBe('unconfigured');
    expect(checkWearableEventAuth('', 'anything', true)).toBe('unconfigured');
  });

  it('stays open in development when no token is configured', () => {
    expect(checkWearableEventAuth(undefined, undefined, false)).toBe('ok');
  });

  it('requires the exact token once configured', () => {
    expect(checkWearableEventAuth('s3cret', 's3cret', true)).toBe('ok');
    expect(checkWearableEventAuth('s3cret', undefined, true)).toBe('invalid');
    expect(checkWearableEventAuth('s3cret', 'wrong', false)).toBe('invalid');
  });
});
