/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AddressSuggestion } from '../types';

// Address search mixes three sources, each used for what it is best at:
// - OneMap (Singapore Land Authority): authoritative postal codes, HDB blocks
//   and official building names.
// - Google Places: shops, clinics and other businesses, and fuzzy or
//   misspelled text.
// - Curated SafeSpot landmarks (hospitals, polyclinics): always offered first
//   when they match.

export type AddressQueryKind = 'postal' | 'block' | 'place';

/** Decides which provider is likely to know the answer best. */
export function classifyAddressQuery(query: string): AddressQueryKind {
  const q = query.trim().toLowerCase();
  if (/^\d{6}$/.test(q) || /\bsingapore\s+\d{6}\b/.test(q) || /\bs\(?\d{6}\)?\b/.test(q)) return 'postal';
  // "Blk 480", "block 12a", "480 Toa Payoh", "12A Lorong 6"
  if (/\b(blk|block)\s*\d+[a-z]?\b/.test(q) || /^\d+[a-z]?\s+\D/.test(q)) return 'block';
  return 'place';
}

const addressKey = (s: AddressSuggestion) =>
  (s.fullAddress || s.title).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Merges provider results in the order that suits the query: OneMap first for
 * postal codes and blocks, Google first (interleaved with OneMap) for named
 * places. Duplicates are dropped by normalised address and by postal code,
 * keeping the earlier (higher-ranked) entry.
 */
export function mergeAddressSuggestions(
  kind: AddressQueryKind,
  sources: { landmarks: AddressSuggestion[]; onemap: AddressSuggestion[]; google: AddressSuggestion[] },
  limit = 8,
): AddressSuggestion[] {
  const { landmarks, onemap, google } = sources;
  let ordered: AddressSuggestion[];
  if (kind === 'place') {
    const interleaved: AddressSuggestion[] = [];
    for (let i = 0; i < Math.max(google.length, onemap.length); i++) {
      if (google[i]) interleaved.push(google[i]);
      if (onemap[i]) interleaved.push(onemap[i]);
    }
    ordered = [...landmarks, ...interleaved];
  } else {
    ordered = [...onemap, ...landmarks, ...google];
  }

  const seenAddresses = new Set<string>();
  const seenPostal = new Set<string>();
  const merged: AddressSuggestion[] = [];
  for (const s of ordered) {
    const key = addressKey(s);
    if (seenAddresses.has(key)) continue;
    if (s.postalCode && seenPostal.has(s.postalCode)) continue;
    seenAddresses.add(key);
    if (s.postalCode) seenPostal.add(s.postalCode);
    merged.push(s);
    if (merged.length >= limit) break;
  }
  return merged;
}
