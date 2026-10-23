/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Car, Footprints, Navigation, MapPin, Accessibility, Loader2 } from 'lucide-react';
import { Language } from '../types';
import { t } from '../locales/translations';
import type { ScoredPickup } from '../utils/pickupOptimizer';
import { appPermissionKey, permissionText, watchPosition } from '../lib/geolocation';

const REFRESH_MS = 30_000;

const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));

/**
 * Best pickup points for an active incident, ranked by real walking time for
 * the senior and, once the caregiver shares their location, real driving
 * time with traffic. Shown on the caregiver /track page.
 */
export const PickupOptionsCard: React.FC<{ incidentId: string; lang: Language }> = ({ incidentId, lang }) => {
  const [options, setOptions] = useState<ScoredPickup[] | null>(null);
  const [usedDriver, setUsedDriver] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const driverRef = useRef<{ lat: number; lng: number } | null>(null);
  const stopWatchRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const driver = driverRef.current;
      const res = await fetch('/api/pickup/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidentId, driverLat: driver?.lat, driverLng: driver?.lng }),
      });
      if (!res.ok) {
        setError(res.status === 404 ? null : t('pickup.unavailable', lang));
        if (res.status === 404) setOptions(null);
        return;
      }
      const data = await res.json();
      setOptions(data.options);
      setUsedDriver(Boolean(data.usedDriverLocation));
      setError(null);
    } catch {
      setError(t('pickup.unavailable', lang));
    } finally {
      setLoading(false);
    }
  }, [incidentId, lang]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => () => stopWatchRef.current?.(), []);

  const startSharing = () => {
    if (!('geolocation' in navigator)) {
      setError(t('pickup.noLocation', lang));
      return;
    }
    setSharing(true);
    let first = true;
    stopWatchRef.current = watchPosition(
      (pos) => {
        driverRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (first) {
          first = false;
          void refresh();
        }
      },
      (err) => {
        setSharing(false);
        // In the app, a refusal points to Android Settings instead.
        const appKey = appPermissionKey(err, 'location');
        setError(appKey ? permissionText(appKey, lang) : t('pickup.noLocation', lang));
      },
      { enableHighAccuracy: true, maximumAge: 15_000 },
    );
  };

  const stopSharing = () => {
    stopWatchRef.current?.();
    stopWatchRef.current = null;
    driverRef.current = null;
    setSharing(false);
    void refresh();
  };

  if (!options && !error && !loading) return null;

  const kindLabel = (o: ScoredPickup) =>
    o.kind === 'kerbside' ? t('pickup.kerbside', lang) : o.kind === 'taxi_stop' ? t('pickup.taxiStop', lang) : t('pickup.taxiStand', lang);

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MapPin aria-hidden="true" className="text-pine h-5 w-5 shrink-0" />
          <h2 className="section-kicker font-body">{t('pickup.title', lang)}</h2>
        </div>
        {sharing ? (
          <button type="button" onClick={stopSharing} className="btn btn-md btn-secondary">
            <Car aria-hidden="true" className="h-5 w-5" />
            <span>{t('pickup.stopSharing', lang)}</span>
          </button>
        ) : (
          <button type="button" onClick={startSharing} className="btn btn-md btn-primary">
            <Car aria-hidden="true" className="h-5 w-5" />
            <span>{t('pickup.imDriving', lang)}</span>
          </button>
        )}
      </div>

      <p className="text-ink-soft text-sm font-semibold">
        {usedDriver ? t('pickup.rankedWithDriver', lang) : t('pickup.rankedWalkOnly', lang)}
      </p>

      {error && (
        <p role="alert" className="text-brick-deep text-sm font-semibold">
          {error}
        </p>
      )}

      {loading && !options && (
        <div role="status" className="text-ink-soft flex items-center gap-2 text-sm font-semibold">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          <span>{t('pickup.finding', lang)}</span>
        </div>
      )}

      {options && options.length === 0 && <p className="text-ink-soft text-base font-semibold">{t('pickup.none', lang)}</p>}

      {options && options.length > 0 && (
        <ol className="space-y-3">
          {options.map((o, i) => (
            <li key={o.id} className={`rounded-xl border p-4 ${i === 0 ? 'border-pine bg-pine-soft/30' : 'border-line bg-well/40'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-ink text-base leading-snug font-bold break-words">
                    {i === 0 && <span className="text-pine-deep">{t('pickup.best', lang)} · </span>}
                    {o.kind === 'kerbside' ? kindLabel(o) : o.name}
                  </div>
                  <div className="text-ink-soft mt-0.5 flex flex-wrap items-center gap-x-2 text-xs font-bold">
                    <span>{o.kind === 'kerbside' ? t('pickup.kerbNote', lang) : kindLabel(o)}</span>
                    {o.barrierFree && (
                      <span className="text-pine-deep inline-flex items-center gap-1">
                        <Accessibility aria-hidden="true" className="h-3.5 w-3.5" />
                        {t('pickup.barrierFree', lang)}
                      </span>
                    )}
                  </div>
                </div>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}&travelmode=driving`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-md btn-secondary shrink-0"
                >
                  <Navigation aria-hidden="true" className="h-4 w-4" />
                  <span>{t('pickup.navigate', lang)}</span>
                  <span className="sr-only">: {o.kind === 'kerbside' ? kindLabel(o) : o.name}</span>
                </a>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold tabular-nums">
                <span className="inline-flex items-center gap-1.5">
                  <Footprints aria-hidden="true" className="text-ink-soft h-4 w-4" />
                  {t('pickup.walk', lang)} {minutes(o.seniorWalkSeconds)} {t('pickup.min', lang)} ({o.walkMeters} m)
                </span>
                {o.driveSeconds !== null && (
                  <span className="inline-flex items-center gap-1.5">
                    <Car aria-hidden="true" className="text-ink-soft h-4 w-4" />
                    {t('pickup.drive', lang)} {minutes(o.driveSeconds)} {t('pickup.min', lang)}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};
