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
    <div className="bg-bg text-ink min-h-screen">
      {/* Status Banner */}
      <header
        className={`${
          !loaded
            ? 'bg-ink text-white'
            : isActive
              ? 'bg-brick text-on-brick'
              : incident
                ? 'bg-pine text-on-pine'
                : 'bg-paper text-ink border-b border-line'
        } px-4 py-4 sm:px-8`}
      >
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          {!loaded ? (
            <RefreshCw className="h-8 w-8 animate-spin" />
          ) : isActive ? (
            <ShieldAlert className="h-8 w-8" />
          ) : incident ? (
            <ShieldCheck className="h-8 w-8" />
          ) : (
            <ShieldAlert className="h-8 w-8 text-brick" />
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl leading-tight font-bold sm:text-2xl">
                {incident?.elderName || 'Senior'} • {t('tracker.title', lang)}
              </h1>
              {incident?.incidentType && (
                <span className="inline-flex items-center rounded bg-black/20 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white">
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
              <p className="text-sm font-semibold opacity-90">
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

        {/* Loading / Not Found states */}
        {!loaded && (
          <div className="card flex items-center justify-center gap-3 p-10 text-lg font-semibold">
            <RefreshCw className="animate-spin h-6 w-6" />
            <span>{t('tracker.connecting', lang)}</span>
          </div>
        )}

        {loaded && !incident && (
          <div className="card border-brick/40 p-10 text-center">
            <ShieldAlert className="text-brick mx-auto mb-3 h-10 w-10" />
            <p className="text-lg font-semibold">{t('tracker.notFound', lang)}</p>
          </div>
        )}

        {loaded && incident && (
          <>
            {/* Live Map */}
            <section className="card overflow-hidden p-0">
              {gps ? (
                <iframe
                  title="Live senior location map"
                  src={mapsEmbedUrl}
                  className="h-[320px] w-full sm:h-[420px]"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ) : (
                <div className="flex h-[200px] items-center justify-center gap-2 text-ink-soft font-semibold">
                  <MapPin className="h-5 w-5" />
                  <span>{t('tracker.waitingGps', lang)}</span>
                </div>
              )}

              <div className="border-line flex flex-wrap items-center justify-between gap-3 border-t p-4">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Clock className="text-ink-soft h-4 w-4" />
                    <span>
                      {t('tracker.lastUpdated', lang)}: {lastUpdatedText}
                      {gps && ` • ±${Math.round(gps.accuracy)}m`}
                    </span>
                  </div>

                  {/* Location Source Badge & Floor Micro-Location */}
                  {incident.locationSource && (
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      {incident.locationSource === 'phone_ble_assisted' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-soft text-sky-deep border border-sky/30 px-2.5 py-0.5 text-xs font-bold">
                          <Radio className="h-3 w-3 animate-pulse text-sky" />
                          <span>{t('fusion.phoneBle', lang)}</span>
                        </span>
                      ) : incident.locationSource === 'fused_gps' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-pine-soft text-pine-deep border border-pine/30 px-2.5 py-0.5 text-xs font-bold">
                          <Watch className="h-3 w-3 text-pine" />
                          <span>{t('fusion.combined', lang)}</span>
                        </span>
                      ) : incident.locationSource === 'watch_gps' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-pine-soft text-pine-deep border border-pine/30 px-2.5 py-0.5 text-xs font-bold">
                          <Watch className="h-3 w-3 text-pine" />
                          <span>{t('fusion.watchGps', lang)}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-well text-ink border border-line px-2.5 py-0.5 text-xs font-bold">
                          <MapPin className="h-3 w-3 text-ink-soft" />
                          <span>{t('fusion.phoneGps', lang)}</span>
                        </span>
                      )}

                      {incident.floorLevel && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 px-2 py-0.5 text-xs font-bold">
                          <span>{t('fusion.floor', lang)}: {incident.floorLevel}</span>
                        </span>
                      )}

                      {incident.venueName && (
                        <span className="text-ink-soft text-xs font-semibold truncate max-w-[220px]">
                          📍 {incident.venueName}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Direct navigation buttons for the caregiver / driver */}
                <div className="flex flex-wrap gap-2">
                  <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className="btn btn-md btn-primary">
                    <Navigation className="h-4 w-4" />
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
              </div>
            </section>

            {/* Vitals & Medical Grid */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Battery Telemetry */}
              <div className="card p-5">
                <div className="flex items-center gap-2">
                  {incident.isCharging ? (
                    <BatteryCharging className={`${batteryColor} h-5 w-5`} />
                  ) : (
                    <BatteryMedium className={`${batteryColor} h-5 w-5`} />
                  )}
                  <span className="section-kicker">{t('tracker.battery', lang)}</span>
                </div>
                <div className={`${batteryColor} font-display mt-2 text-4xl font-bold`}>
                  {batteryLevel === null ? '—' : `${batteryLevel}%`}
                </div>
                <p className="text-ink-soft mt-1 text-sm font-semibold">
                  {incident.isCharging === null
                    ? 'Battery telemetry unavailable on this device'
                    : incident.isCharging
                      ? 'Charging'
                      : batteryLevel !== null && batteryLevel <= 20
                        ? 'Low — phone may power off soon'
                        : 'Discharging'}
                </p>
              </div>

              {/* Blood Type */}
              <div className="card p-5">
                <div className="flex items-center gap-2">
                  <Droplets className="text-brick h-5 w-5" />
                  <span className="section-kicker">{t('tracker.bloodType', lang)}</span>
                </div>
                <div className="font-display text-brick-deep mt-2 text-4xl font-bold">
                  {incident.bloodType || 'Unknown'}
                </div>
                <p className="text-ink-soft mt-1 text-sm font-semibold">
                  Relay to SCDF paramedics on arrival
                </p>
              </div>

              {/* Senior Identity / Selfie */}
              <div className="card flex items-center gap-4 p-5">
                {incident.elderSelfieUrl ? (
                  <img
                    src={incident.elderSelfieUrl}
                    alt={incident.elderName}
                    className="border-pine h-20 w-20 shrink-0 rounded-2xl border-2 object-cover"
                  />
                ) : (
                  <div className="bg-pine-soft text-pine-deep flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl text-3xl font-bold">
                    {(incident.elderName || '?').charAt(0)}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="section-kicker mb-1">Senior</div>
                  <div className="text-xl leading-tight font-bold">{incident.elderName}</div>
                  {incident.formattedAddress && (
                    <div className="text-ink-soft mt-1 truncate text-sm font-semibold">
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
                  <Stethoscope className="text-brick h-5 w-5" />
                  <span className="section-kicker">{t('tracker.medicalNotes', lang)}</span>
                </div>
                <p className="mt-2 text-lg leading-snug font-semibold">{incident.medicalNotes}</p>
              </section>
            )}

            {/* Nearest Landmarks */}
            {incident.nearestLandmarks && incident.nearestLandmarks.length > 0 && (
              <section className="card p-5">
                <div className="flex items-center gap-2">
                  <Landmark className="text-pine h-5 w-5" />
                  <span className="section-kicker">{t('tracker.landmarks', lang)}</span>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {incident.nearestLandmarks.map((landmark, i) => (
                    <li key={i} className="text-ink flex items-start gap-2 text-base font-semibold">
                      <MapPin className="text-pine mt-1 h-4 w-4 shrink-0" />
                      <span>{landmark}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>

      <footer className="border-line text-ink-soft border-t px-4 py-5 text-center text-sm font-medium">
        SafeSpot.SG • Live incident {incidentId} • Auto-refreshes in real time
      </footer>
    </div>
  );
};
