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

/**
 * If the Google map throws (e.g. after Google rejects the key for this site),
 * show the OpenStreetMap fallback instead. Without this, React 19 unmounts
 * the whole app on the uncaught error and the screen goes blank.
 */
type MapErrorBoundaryProps = { fallback: React.ReactNode; children: React.ReactNode };
class MapErrorBoundary extends React.Component<MapErrorBoundaryProps, { failed: boolean }> {
  declare props: MapErrorBoundaryProps;
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn('Google map failed, showing the fallback map:', err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Google calls window.gm_authFailure when the key is not allowed on this site. */
function useMapsAuthFailed(): boolean {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const w = window as any;
    const prev = w.gm_authFailure;
    w.gm_authFailure = () => {
      setFailed(true);
      prev?.();
    };
    return () => {
      w.gm_authFailure = prev;
    };
  }, []);
  return failed;
}

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

  const mapsAuthFailed = useMapsAuthFailed();
  const mapsApiKey = mapsAuthFailed ? '' : dynamicKey;

  // The Google map draws its marker and accuracy ring itself, so it needs
  // real colour values: read the theme's pine token instead of hard-coding
  // a hue, and re-read when the contrast theme changes. The theme class is
  // applied by App's effect, which runs after this one, so wait a frame.
  const [pinColors, setPinColors] = useState<{ pin?: string; glyph?: string }>({});
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const css = getComputedStyle(document.body);
      setPinColors({
        pin: css.getPropertyValue('--ss-pine').trim() || undefined,
        glyph: css.getPropertyValue('--ss-on-pine').trim() || undefined,
      });
    });
    return () => cancelAnimationFrame(id);
  }, [settings.contrastTheme]);

  // Google Maps Embed / Search link
  const openInGoogleMaps = () => {
    window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`, '_blank', 'noopener');
  };

  if (lat === null || lng === null) {
    return (
      <section id="card-interactive-map" className="card p-6 sm:p-7">
        <div className="mb-4 flex items-center gap-3">
          <div className="icon-tile" aria-hidden="true">
            <Navigation className="h-5 w-5" />
          </div>
          <h2 className="font-display text-2xl leading-none font-bold tracking-tight">{t('map.title', lang)}</h2>
        </div>
        <div
          role="status"
          className="border-line-strong text-ink-soft flex h-40 items-center justify-center gap-2 rounded-xl border border-dashed px-4 text-center text-base font-semibold"
        >
          <MapPin aria-hidden="true" className="h-5 w-5 shrink-0" />
          <span>{t('map.waiting', lang)}</span>
        </div>
      </section>
    );
  }

  // Fallback interactive tile map with verified pin overlay
  const fallbackMap = (
    <div className="relative h-full w-full">
      <iframe
        title={t('map.title', lang)}
        loading="lazy"
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
      {/* Static "you are here" marker: the position is a single fix,
          not a live stream, so it does not pulse. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="relative flex items-center justify-center">
          <div className="bg-pine/15 border-pine/60 absolute h-20 w-20 rounded-full border-2"></div>
          <div className="bg-pine/30 border-pine-deep absolute h-14 w-14 rounded-full border"></div>
          <div className="bg-pine text-on-pine border-on-pine z-10 -translate-y-3 rounded-full border-2 p-2 shadow-xl">
            <MapPin className="h-7 w-7" />
          </div>
        </div>
      </div>

      {/* In-map info pill */}
      <div className="border-line bg-surface/95 text-ink absolute top-3 right-3 left-3 flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold shadow-md backdrop-blur-md sm:right-auto">
        {isVerified ? (
          <ShieldCheck aria-hidden="true" className="text-pine h-5 w-5 shrink-0" />
        ) : (
          <MapPin aria-hidden="true" className="text-sky h-5 w-5 shrink-0" />
        )}
        <div className="min-w-0 truncate">
          <span className={`font-bold ${isVerified ? 'text-pine-deep' : 'text-sky'}`}>
            {t(isVerified ? 'map.verifiedPin' : 'map.gpsPin', lang)}
          </span>{' '}
          {address}
        </div>
      </div>

      {/* Open externally */}
      <div className="pointer-events-auto absolute right-3 bottom-3 flex flex-col gap-1.5">
        <button type="button" onClick={openInGoogleMaps} className="btn btn-md btn-secondary shadow-md">
          <ExternalLink aria-hidden="true" className="text-sky h-4 w-4" />
          <span>Google Maps</span>
        </button>
      </div>
    </div>
  );

  return (
    <section id="card-interactive-map" className="card p-6 sm:p-7">
      {/* Header bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="icon-tile" aria-hidden="true">
            <Navigation className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-2xl leading-none font-bold tracking-tight">
              {t('map.title', lang)}
            </h2>
            <p className="text-ink-soft mt-1 text-sm font-normal tabular-nums sm:text-base">
              {t('map.precision', lang)} {lat.toFixed(5)}, {lng.toFixed(5)}
              {accuracyMeters != null && ` • ±${Math.round(accuracyMeters)}m`}
              {verification?.refinedByCandidate && ` • ${t('map.streetViewChecked', lang)}`}
            </p>
          </div>
        </div>

        <button type="button" onClick={openInGoogleMaps} className="btn btn-md btn-secondary">
          <span>{t('map.openFull', lang)}</span>
          <ExternalLink aria-hidden="true" className="text-ink-soft h-4 w-4" />
        </button>
      </div>

      {/* Map Container */}
      <div className="border-line-strong/60 bg-well relative h-72 w-full overflow-hidden rounded-xl border-2 shadow-inner sm:h-96">
        {mapsApiKey ? (
          <MapErrorBoundary fallback={fallbackMap}>
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
                  <Pin background={pinColors.pin} glyphColor={pinColors.glyph} borderColor={pinColors.glyph} />
                </AdvancedMarker>
                {accuracyMeters != null && accuracyMeters > 0 && (
                  <Circle
                    center={{ lat, lng }}
                    radius={Math.min(Math.max(accuracyMeters, 5), 80)}
                    strokeColor={pinColors.pin}
                    strokeOpacity={0.8}
                    strokeWeight={2}
                    fillColor={pinColors.pin}
                    fillOpacity={0.15}
                  />
                )}
              </Map>
            </APIProvider>
          </MapErrorBoundary>
        ) : (
          fallbackMap
        )}
      </div>

      {/* Driver Coordinates & Notes bar */}
      <div className="text-ink-soft mt-3.5 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold sm:text-base">
        <div className="flex min-w-0 items-center gap-1.5">
          <Compass aria-hidden="true" className="text-pine h-5 w-5 shrink-0" />
          <span className="tabular-nums break-all">
            {t('map.coordinates', lang)} {lat.toFixed(6)}, {lng.toFixed(6)}
          </span>
        </div>
        <div>
          <span>{t('map.navReady', lang)}</span>
        </div>
      </div>
    </section>
  );
};
