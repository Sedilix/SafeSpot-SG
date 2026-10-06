/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  MapPin, 
  Navigation, 
  Compass, 
  ExternalLink, 
  ShieldCheck
} from 'lucide-react';
import { APIProvider, Map, AdvancedMarker, Pin, Circle } from '@vis.gl/react-google-maps';
import { GPSLocation, LocationVerificationResult, AccessibilitySettings } from '../types';
import { t } from '../locales/translations';

interface InteractiveMapDisplayProps {
  gps: GPSLocation | null;
  verification: LocationVerificationResult | null;
  settings: AccessibilitySettings;
}

export const InteractiveMapDisplay: React.FC<InteractiveMapDisplayProps> = ({
  gps,
  verification,
  settings,
}) => {
  const lang = settings.language || 'en';
  const [dynamicKey, setDynamicKey] = useState<string>(() => {
    return (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || '';
  });

  useEffect(() => {
    if (!dynamicKey) {
      fetch('/api/config/maps-key')
        .then((res) => res.json())
        .then((data) => {
          if (data.mapsApiKey) {
            setDynamicKey(data.mapsApiKey);
          }
        })
        .catch((e) => console.warn('Could not fetch server maps key:', e));
    }
  }, [dynamicKey]);

  // Never show a made-up position: with no fix, the card says it is waiting
  // instead of pinning (and offering to navigate to) a default location.
  const lat = verification?.verifiedCoordinates?.lat ?? gps?.latitude ?? null;
  const lng = verification?.verifiedCoordinates?.lng ?? gps?.longitude ?? null;
  const isVerified = Boolean(verification?.verifiedCoordinates);
  const address = verification?.formattedAddress || (lat !== null && lng !== null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : '');
  const accuracyMeters =
    verification?.originalCoordinates?.accuracyMeters ?? gps?.accuracy ?? null;

  const mapsApiKey = dynamicKey;

  // Google Maps Embed / Search link
  const openInGoogleMaps = () => {
    window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`, '_blank');
  };

  if (lat === null || lng === null) {
    return (
      <section id="card-interactive-map" className="card p-6 sm:p-7">
        <div className="mb-4 flex items-center gap-3">
          <div className="icon-tile">
            <Navigation className="h-5 w-5" />
          </div>
          <h3 className="font-display text-2xl leading-none font-bold tracking-tight">{t('map.title', lang)}</h3>
        </div>
        <div className="border-line text-ink-soft flex h-40 items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 text-center text-base font-semibold">
          <MapPin className="h-5 w-5 shrink-0" />
          <span>{t('map.waiting', lang)}</span>
        </div>
      </section>
    );
  }

  return (
    <section id="card-interactive-map" className="card p-6 sm:p-7">
      {/* Header bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="icon-tile">
            <Navigation className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-display text-2xl leading-none font-bold tracking-tight">
              {t('map.title', lang)}
            </h3>
            <p className="text-ink-soft mt-1 text-sm font-normal sm:text-base">
              {t('map.precision', lang)} {lat.toFixed(5)}, {lng.toFixed(5)}
              {accuracyMeters != null && ` • ±${Math.round(accuracyMeters)}m`}
              {verification?.refinedByCandidate && ' • panorama-refined'}
            </p>
          </div>
        </div>

        <button onClick={openInGoogleMaps} className="btn btn-md btn-secondary" title="Open coordinates in external Google Maps application">
          <span>{t('map.openFull', lang)}</span>
          <ExternalLink className="text-ink-soft h-4 w-4" />
        </button>
      </div>

      {/* Map Container */}
      <div className="border-line-strong/60 relative h-72 w-full overflow-hidden rounded-xl border-2 bg-slate-950 shadow-inner sm:h-96">
        {mapsApiKey ? (
          <APIProvider apiKey={mapsApiKey}>
            <Map
              defaultCenter={{ lat, lng }}
              center={{ lat, lng }}
              defaultZoom={17}
              zoom={17}
              mapId="DEMO_MAP_ID"
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              disableDefaultUI={false}
              style={{ width: '100%', height: '100%' }}
            >
              <AdvancedMarker position={{ lat, lng }}>
                <Pin background="#16a34a" glyphColor="#ffffff" borderColor="#ffffff" />
              </AdvancedMarker>
              {accuracyMeters != null && accuracyMeters > 0 && (
                <Circle
                  center={{ lat, lng }}
                  radius={Math.min(Math.max(accuracyMeters, 5), 80)}
                  strokeColor="#16a34a"
                  strokeOpacity={0.8}
                  strokeWeight={2}
                  fillColor="#16a34a"
                  fillOpacity={0.15}
                />
              )}
            </Map>
          </APIProvider>
        ) : (
          /* Fallback interactive tile map with verified pin overlay */
          <div className="relative h-full w-full">
            <iframe
              title="Interactive Pickup Map"
              width="100%"
              height="100%"
              frameBorder="0"
              scrolling="no"
              marginHeight={0}
              marginWidth={0}
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.003}%2C${lat - 0.002}%2C${lng + 0.003}%2C${lat + 0.002}&layer=mapnik&marker=${lat}%2C${lng}`}
              className="h-full w-full"
            />

            {/* Custom Overlay Pin & Pulsing Radius */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative flex items-center justify-center">
                <div className="bg-pine/20 border-pine absolute h-20 w-20 animate-ping rounded-full border-2"></div>
                <div className="bg-pine/30 border-pine-deep absolute h-14 w-14 rounded-full border"></div>
                <div className="bg-pine text-on-pine z-10 -translate-y-3 rounded-full border-2 border-white p-2 shadow-xl">
                  <MapPin className="h-7 w-7" />
                </div>
              </div>
            </div>

            {/* In-Map Info Overlay Pill */}
            <div className="absolute top-3 left-3 right-3 flex items-center gap-2 rounded-xl border border-white/20 bg-black/85 px-3.5 py-2 text-sm font-semibold text-white shadow-md backdrop-blur-md sm:right-auto">
              {isVerified ? (
                <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
              ) : (
                <MapPin className="h-5 w-5 shrink-0 text-sky-300" />
              )}
              <div className="truncate">
                <span className={isVerified ? 'text-emerald-400' : 'text-sky-300'}>
                  {t(isVerified ? 'map.verifiedPin' : 'map.gpsPin', lang)}
                </span>{' '}
                {address}
              </div>
            </div>

            {/* Zoom / Re-center Overlay Controls */}
            <div className="pointer-events-auto absolute bottom-3 right-3 flex flex-col gap-1.5">
              <button
                onClick={openInGoogleMaps}
                className="btn btn-md border-line bg-surface text-ink hover:bg-well border shadow-md"
                title="Open directly in Google Maps"
              >
                <ExternalLink className="text-sky h-4 w-4" />
                <span>Google Maps</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Driver Coordinates & Notes bar */}
      <div className="text-ink-soft mt-3.5 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold sm:text-base">
        <div className="flex items-center gap-1.5">
          <Compass className="text-pine h-5 w-5" />
          <span>{t('map.coordinates', lang)} {lat.toFixed(6)}, {lng.toFixed(6)}</span>
        </div>
        <div>
          <span>{t('map.navReady', lang)}</span>
        </div>
      </div>
    </section>
  );
};
