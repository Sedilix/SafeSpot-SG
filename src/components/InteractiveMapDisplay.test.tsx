/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { InteractiveMapDisplay } from './InteractiveMapDisplay';

// With no Maps key (as in tests), the card renders the OpenStreetMap fallback.
describe('InteractiveMapDisplay OpenStreetMap fallback', () => {
  const gps = { latitude: 1.30001, longitude: 103.80001, accuracy: 12, heading: null, speed: null, altitude: null, timestamp: 0 };
  // Verified pin and address as Google-derived content (Street View / Roads / Geocoding).
  const verification: any = {
    originalCoordinates: { lat: 1.30001, lng: 103.80001, accuracyMeters: 12 },
    verifiedCoordinates: { lat: 1.35555, lng: 103.85555 },
    formattedAddress: 'Google Geocoded Address 123',
    refinedByCandidate: true,
  };
  const settings: any = { language: 'en' };

  it('pins and shows only the raw device GPS fix, never the verified pin or address', () => {
    const html = renderToString(<InteractiveMapDisplay gps={gps} verification={verification} settings={settings} />);
    expect(html).toContain('openstreetmap.org/export/embed.html');
    expect(html).toContain('marker=1.30001%2C103.80001');
    expect(html).toContain('1.30001, 103.80001');
    expect(html).not.toContain('1.35555');
    expect(html).not.toContain('Google Geocoded Address 123');
  });

  it('shows the waiting state rather than a Google-derived pin when there is no device fix', () => {
    const html = renderToString(<InteractiveMapDisplay gps={null} verification={verification} settings={settings} />);
    expect(html).not.toContain('1.35555');
    expect(html).not.toContain('openstreetmap.org/export/embed.html');
  });
});
