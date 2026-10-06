/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { normalizeWatchDeviceId, isValidWatchDeviceId } from './watchDeviceId';

describe('normalizeWatchDeviceId', () => {
  it('keeps a correctly typed ID', () => {
    expect(normalizeWatchDeviceId('SS-7KQ2-M9XD-4TFH')).toBe('SS-7KQ2-M9XD-4TFH');
  });

  it('ignores case, spaces and missing dashes', () => {
    expect(normalizeWatchDeviceId('ss7kq2m9xd4tfh')).toBe('SS-7KQ2-M9XD-4TFH');
    expect(normalizeWatchDeviceId(' ss 7kq2 m9xd 4tfh ')).toBe('SS-7KQ2-M9XD-4TFH');
  });

  it('maps look-alike letters', () => {
    expect(normalizeWatchDeviceId('SS-O0IL-AAAA-BBBB')).toBe('SS-0011-AAAA-BBBB');
  });

  it('accepts the ID without the SS prefix', () => {
    expect(normalizeWatchDeviceId('7KQ2M9XD4TFH')).toBe('SS-7KQ2-M9XD-4TFH');
  });

  it('formats partial input while typing and caps the length', () => {
    expect(normalizeWatchDeviceId('')).toBe('');
    expect(normalizeWatchDeviceId('ss-7k')).toBe('SS-7K');
    expect(normalizeWatchDeviceId('SS-7KQ2-M9XD-4TFH-EXTRA')).toBe('SS-7KQ2-M9XD-4TFH');
  });
});

describe('isValidWatchDeviceId', () => {
  it('accepts only complete canonical IDs', () => {
    expect(isValidWatchDeviceId('SS-7KQ2-M9XD-4TFH')).toBe(true);
    expect(isValidWatchDeviceId('SS-7KQ2-M9XD')).toBe(false);
    expect(isValidWatchDeviceId('fenix-6s-solar')).toBe(false);
    expect(isValidWatchDeviceId('SS-7KQ2-M9XD-4TFU')).toBe(false); // U is not in the alphabet
  });
});
