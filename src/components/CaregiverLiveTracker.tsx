/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  MapPin,
  BatteryMedium,
  BatteryCharging,
  Droplets,
  Stethoscope,
  Landmark,
  Navigation,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Clock,
  Watch,
  Radio,
} from 'lucide-react';
import { Incident, Language } from '../types';
import { subscribeToIncident } from '../lib/firebase';
import { t } from '../locales/translations';
import { WearableStatusCard } from './WearableStatusCard';
import { PickupOptionsCard } from './PickupOptionsCard';

interface CaregiverLiveTrackerProps {
  incidentId: string;
}

/**
 * Read-only live tracking dashboard served at `/track/:incidentId`.
 * Family members and drivers open this link in any browser (no app needed)
 * and follow the senior's live GPS, battery, blood type, and medical notes.
 */
export const CaregiverLiveTracker: React.FC<CaregiverLiveTrackerProps> = ({ incidentId }) => {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Caregiver device language fallback; the elder's chosen language is not
  // part of the incident doc, so mirror the viewer's browser preference.
  const lang: Language = useMemo(() => {
    const browser = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return (['en', 'zh', 'ms', 'ta'].includes(browser) ? browser : 'en') as Language;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToIncident(incidentId, (data) => {
      setIncident(data);
      setLoaded(true);
    });
    return () => unsubscribe();
  }, [incidentId]);

  const gps = incident?.currentGps || null;
  const isActive = incident?.status === 'active';

  const googleMapsUrl = gps
    ? `https://www.google.com/maps/dir/?api=1&destination=${gps.lat},${gps.lng}`
    : 'https://www.google.com/maps';
  const appleMapsUrl = gps
    ? `https://maps.apple.com/?daddr=${gps.lat},${gps.lng}`
    : 'https://maps.apple.com';
  const wazeUrl = gps ? `https://waze.com/ul?ll=${gps.lat},${gps.lng}&navigate=yes` : 'https://waze.com';

  const mapsEmbedUrl = gps
    ? `https://maps.google.com/maps?q=${gps.lat},${gps.lng}&z=17&output=embed`
    : '';

  const lastUpdatedText = incident?.currentGps?.timestamp
    ? new Date(incident.currentGps.timestamp).toLocaleTimeString()
    : '—';

  const batteryLevel = incident?.batteryLevel ?? null;
  const batteryColor =
    batteryLevel === null
      ? 'text-ink-soft'
      : batteryLevel <= 20
        ? 'text-brick-deep'
        : 'text-pine-deep';

  return (
    <div className="bg-bg text-ink min-h-dvh">
      {/* Status Banner */}
      <header
        className={`${
          !loaded
            ? 'bg-ink text-bg'
            : isActive
              ? 'bg-brick text-on-brick'
              : incident
                ? 'bg-pine text-on-pine'
                : 'bg-surface text-ink border-b border-line'
        } px-4 py-4 sm:px-8`}
      >
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          {!loaded ? (
            <RefreshCw className="h-8 w-8 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
          ) : isActive ? (
            <ShieldAlert className="h-8 w-8 shrink-0" aria-hidden="true" />
          ) : incident ? (
            <ShieldCheck className="h-8 w-8 shrink-0" aria-hidden="true" />
          ) : (
            <ShieldAlert className="h-8 w-8 shrink-0 text-brick" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl leading-tight font-bold sm:text-2xl">
                {incident?.elderName || t('tracker.senior', lang)} • {t('tracker.title', lang)}
              </h1>
              {incident?.incidentType && (
                <span className="inline-flex items-center rounded-md border border-current px-2 py-0.5 text-xs font-bold">
                  {incident.incidentType === 'fall'
                    ? t('tracker.alertFall', lang)
                    : incident.incidentType === 'heart_rate'
                      ? t('tracker.alertHr', lang)
                      : incident.incidentType === 'crash'
                        ? t('tracker.alertCrash', lang)
                        : t('tracker.alertSos', lang)}
                </span>
              )}
            </div>
            {/* A missing incident is explained once, in the card below. */}
            {(!loaded || incident) && (
              <p className="text-sm font-semibold opacity-90" aria-live="polite">
                {!loaded
                  ? t('tracker.connecting', lang)
                  : isActive
                    ? t('tracker.statusActive', lang)
                    : t('tracker.statusResolved', lang)}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-8">
        {/* Garmin watch telemetry (independent of the phone incident) */}
        <WearableStatusCard lang={lang} deviceId={incident?.deviceId} />

        {/* Loading: placeholders in the shape of the page (the banner above
            already says "connecting"). */}
        {!loaded && (
          <div className="space-y-5" aria-busy="true" aria-label={t('tracker.connecting', lang)}>
            <div className="skeleton h-[320px] w-full sm:h-[420px]" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="skeleton h-36" />
              <div className="skeleton h-36" />
              <div className="skeleton h-36" />
            </div>
          </div>
        )}

        {loaded && !incident && (
          <div className="card border-brick/40 p-10 text-center">
            <ShieldAlert className="text-brick mx-auto mb-3 h-10 w-10" aria-hidden="true" />
            <p className="text-lg font-semibold">{t('tracker.notFound', lang)}</p>
          </div>
        )}

        {loaded && incident && (
          <>
            {/* Live Map */}
            <section className="card overflow-hidden p-0">
              {gps ? (
                <iframe
                  title={t('tracker.mapTitle', lang)}
                  src={mapsEmbedUrl}
                  className="h-[320px] w-full sm:h-[420px]"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ) : (
                <div className="flex h-[200px] items-center justify-center gap-2 px-4 text-center text-ink-soft font-semibold">
                  <MapPin className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span>{t('tracker.waitingGps', lang)}</span>
                </div>
              )}

              <div className="border-line flex flex-wrap items-center justify-between gap-3 border-t p-4">
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Clock className="text-ink-soft h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      {t('tracker.lastUpdated', lang)}: {lastUpdatedText}
                      {gps && ` • ±${Math.round(gps.accuracy)}m`}
                    </span>
                  </div>

                  {/* Location Source Badge & Floor Micro-Location */}
                  {incident.locationSource && (
                    <div className="flex flex-wrap items-center gap-2">
                      {incident.locationSource === 'phone_ble_assisted' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-soft text-sky border border-sky/30 px-2.5 py-0.5 text-xs font-bold">
                          <Radio className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>{t('fusion.phoneBle', lang)}</span>
                        </span>
                      ) : incident.locationSource === 'fused_gps' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-pine-soft text-pine-deep border border-pine/30 px-2.5 py-0.5 text-xs font-bold">
                          <Watch className="h-3.5 w-3.5 shrink-0 text-pine" aria-hidden="true" />
                          <span>{t('fusion.combined', lang)}</span>
                        </span>
                      ) : incident.locationSource === 'watch_gps' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-pine-soft text-pine-deep border border-pine/30 px-2.5 py-0.5 text-xs font-bold">
                          <Watch className="h-3.5 w-3.5 shrink-0 text-pine" aria-hidden="true" />
                          <span>{t('fusion.watchGps', lang)}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-well text-ink border border-line px-2.5 py-0.5 text-xs font-bold">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-soft" aria-hidden="true" />
                          <span>{t('fusion.phoneGps', lang)}</span>
                        </span>
                      )}

                      {incident.floorLevel && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-ochre-soft text-ochre-deep border border-ochre/30 px-2.5 py-0.5 text-xs font-bold">
                          <span>{t('fusion.floor', lang)}: {incident.floorLevel}</span>
                        </span>
                      )}

                      {incident.venueName && (
                        <span className="text-ink-soft inline-flex max-w-[220px] items-center gap-1 text-xs font-semibold">
                          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{incident.venueName}</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Direct navigation buttons for the caregiver / driver. Shown
                    only once there is a position: without one they would just
                    open an empty map. */}
                {gps && (
                  <div className="flex flex-wrap gap-2">
                    <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className="btn btn-md btn-primary">
                      <Navigation className="h-4 w-4" aria-hidden="true" />
                      <span>Google Maps</span>
                    </a>
                    <a href={appleMapsUrl} target="_blank" rel="noopener noreferrer" className="btn btn-md btn-secondary">
                      <span>{t('tracker.navigate', lang)}</span>
                      <span className="opacity-70">• Apple</span>
                    </a>
                    <a href={wazeUrl} target="_blank" rel="noopener noreferrer" className="btn btn-md btn-secondary">
                      <span>{t('tracker.navigate', lang)}</span>
                      <span className="opacity-70">• Waze</span>
                    </a>
                  </div>
                )}
              </div>
            </section>

            {/* Best pickup points (real walking/driving times) */}
            {isActive && <PickupOptionsCard incidentId={incidentId} lang={lang} />}

            {/* Vitals & Medical Grid */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Battery Telemetry */}
              <div className="card p-5">
                <div className="flex items-center gap-2">
                  {incident.isCharging ? (
                    <BatteryCharging className={`${batteryColor} h-5 w-5`} aria-hidden="true" />
                  ) : (
                    <BatteryMedium className={`${batteryColor} h-5 w-5`} aria-hidden="true" />
                  )}
                  <span className="section-kicker">{t('tracker.battery', lang)}</span>
                </div>
                <div className={`${batteryColor} font-display mt-2 text-4xl font-bold`}>
                  {batteryLevel === null ? '—' : `${batteryLevel}%`}
                </div>
                <p className="text-ink-soft mt-1 text-sm font-semibold">
                  {incident.isCharging === null
                    ? t('tracker.batteryUnavailable', lang)
                    : incident.isCharging
                      ? t('tracker.charging', lang)
                      : batteryLevel !== null && batteryLevel <= 20
                        ? t('tracker.batteryLow', lang)
                        : t('tracker.notCharging', lang)}
                </p>
              </div>

              {/* Blood Type */}
              <div className="card p-5">
                <div className="flex items-center gap-2">
                  <Droplets className="text-brick h-5 w-5" aria-hidden="true" />
                  <span className="section-kicker">{t('tracker.bloodType', lang)}</span>
                </div>
                <div className="font-display text-brick-deep mt-2 text-4xl font-bold">
                  {incident.bloodType || t('tracker.bloodUnknown', lang)}
                </div>
                <p className="text-ink-soft mt-1 text-sm font-semibold">
                  {t('tracker.bloodHint', lang)}
                </p>
              </div>

              {/* Senior Identity / Selfie */}
              <div className="card flex items-center gap-4 p-5">
                {incident.elderSelfieUrl ? (
                  <img
                    src={incident.elderSelfieUrl}
                    alt={incident.elderName}
                    width={80}
                    height={80}
                    className="border-pine h-20 w-20 shrink-0 rounded-2xl border-2 object-cover"
                  />
                ) : (
                  <div
                    className="bg-pine-soft text-pine-deep flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl text-3xl font-bold"
                    aria-hidden="true"
                  >
                    {(incident.elderName || '?').charAt(0)}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="section-kicker mb-1">{t('tracker.senior', lang)}</div>
                  <div className="text-xl leading-tight font-bold break-words">{incident.elderName}</div>
                  {incident.formattedAddress && (
                    <div className="text-ink-soft mt-1 text-sm font-semibold break-words">
                      {incident.formattedAddress}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Medical Notes */}
            {incident.medicalNotes && (
              <section className="card border-brick/30 p-5">
                <div className="flex items-center gap-2">
                  <Stethoscope className="text-brick h-5 w-5" aria-hidden="true" />
                  <span className="section-kicker">{t('tracker.medicalNotes', lang)}</span>
                </div>
                <p className="mt-2 text-lg leading-snug font-semibold">{incident.medicalNotes}</p>
              </section>
            )}

            {/* Nearest Landmarks */}
            {incident.nearestLandmarks && incident.nearestLandmarks.length > 0 && (
              <section className="card p-5">
                <div className="flex items-center gap-2">
                  <Landmark className="text-pine h-5 w-5" aria-hidden="true" />
                  <span className="section-kicker">{t('tracker.landmarks', lang)}</span>
                </div>
                <ul className="mt-3 space-y-2">
                  {incident.nearestLandmarks.map((landmark, i) => (
                    <li key={i} className="text-ink flex items-start gap-2 text-base font-semibold">
                      <MapPin className="text-pine mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{landmark}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>

      <footer className="border-line text-ink-soft border-t px-4 py-5 text-center text-sm font-medium break-words">
        SafeSpot.SG • {t('tracker.footer', lang).replace('{id}', incidentId)}
      </footer>
    </div>
  );
};
