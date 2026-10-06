/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { classifyAddressQuery, mergeAddressSuggestions } from './addressSearch';
import type { AddressSuggestion } from '../types';

const s = (source: AddressSuggestion['source'], title: string, extra: Partial<AddressSuggestion> = {}): AddressSuggestion => ({
  source,
  title,
  fullAddress: extra.fullAddress ?? `${title}, Singapore`,
  ...extra,
});

describe('classifyAddressQuery', () => {
  it('recognises postal codes', () => {
    expect(classifyAddressQuery('560480')).toBe('postal');
    expect(classifyAddressQuery('Singapore 560480')).toBe('postal');
    expect(classifyAddressQuery('S560480')).toBe('postal');
  });

  it('recognises HDB block addresses', () => {
    expect(classifyAddressQuery('Blk 480 Toa Payoh')).toBe('block');
    expect(classifyAddressQuery('block 12a')).toBe('block');
    expect(classifyAddressQuery('480 Lorong 6 Toa Payoh')).toBe('block');
  });

  it('treats everything else as a named place', () => {
    expect(classifyAddressQuery('Toa Payoh Hub')).toBe('place');
    expect(classifyAddressQuery('polyclinic')).toBe('place');
    expect(classifyAddressQuery('7-Eleven')).toBe('place');
  });
});

describe('mergeAddressSuggestions', () => {
  const onemap = [s('onemap', 'Blk 480 Lorong 6 Toa Payoh', { postalCode: '310480' }), s('onemap', 'Toa Payoh Central')];
  const google = [s('google', 'Toa Payoh Hub'), s('google', 'Toa Payoh Polyclinic')];
  const landmarks = [s('singapore_landmark', 'Tan Tock Seng Hospital (TTSH)', { postalCode: '308433' })];

  it('puts OneMap first for postal codes and blocks', () => {
    const merged = mergeAddressSuggestions('block', { landmarks, onemap, google });
    expect(merged.map((m) => m.source)).toEqual(['onemap', 'onemap', 'singapore_landmark', 'google', 'google']);
  });

  it('puts curated landmarks first, then interleaves Google and OneMap for places', () => {
    const merged = mergeAddressSuggestions('place', { landmarks, onemap, google });
    expect(merged.map((m) => m.source)).toEqual(['singapore_landmark', 'google', 'onemap', 'google', 'onemap']);
  });

  it('drops duplicates by address and by postal code, keeping the higher-ranked one', () => {
    const merged = mergeAddressSuggestions('postal', {
      landmarks: [],
      onemap: [s('onemap', 'Blk 480', { postalCode: '310480', fullAddress: '480 LORONG 6 TOA PAYOH SINGAPORE 310480' })],
      google: [
        s('google', '480 Lorong 6 Toa Payoh', { postalCode: '310480', fullAddress: '480 Lorong 6 Toa Payoh, Singapore 310480' }),
        s('google', 'Elsewhere', { fullAddress: '480 lorong 6 toa payoh singapore 310480' }),
      ],
    });
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('onemap');
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => s('google', `Place ${i}`));
    expect(mergeAddressSuggestions('place', { landmarks: [], onemap: [], google: many })).toHaveLength(8);
  });
});
