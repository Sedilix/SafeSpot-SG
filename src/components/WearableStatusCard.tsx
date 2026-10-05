/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Watch, HeartPulse, BatteryMedium, MapPin, ShieldAlert, HelpCircle, CheckCircle2 } from 'lucide-react';
import { Language } from '../types';
import { t } from '../locales/translations';
import type { WearableState } from '../utils/wearable';

type WearableDevice = WearableState & { online: boolean };

const POLL_MS = 10_000;

/**
 * Live telemetry from a paired Garmin watch (via /api/wearable/status).
 * Renders nothing until a watch has reported in.
 */
export const WearableStatusCard: React.FC<{ lang: Language }> = ({ lang }) => {
  const [device, setDevice] = useState<WearableDevice | null>(null);
  const [requestingCheckin, setRequestingCheckin] = useState(false);

  const requestCheckin = async () => {
    if (!device || requestingCheckin) return;
    setRequestingCheckin(true);
    try {
      const res = await fetch('/api/wearable/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: device.deviceId }),
      });
      if (res.ok) {
        setDevice((prev) => (prev ? { ...prev, checkInRequested: true, checkInRequestedAt: Date.now() } : null));
      }
    } catch {
      // network error
    } finally {
      setRequestingCheckin(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/wearable/status');
        if (!res.ok) return;
        const data: { devices: WearableDevice[] } = await res.json();
        if (!cancelled) setDevice(data.devices[0] ?? null);
      } catch {
        // transient network error; keep showing the last reading
      }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!device) return null;

  const minutesAgo = Math.max(0, Math.round((Date.now() - device.lastSeen) / 60_000));
  const mapsUrl = device.lat !== null && device.lng !== null
    ? `https://www.google.com/maps/search/?api=1&query=${device.lat},${device.lng}`
    : null;

  return (
    <section className={`card p-5 ${device.sosActive ? 'border-brick border-2' : ''}`}>
      {device.sosActive && (
        <div className="bg-brick mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-lg font-bold text-white">
          <ShieldAlert className="h-6 w-6 shrink-0" />
          <span>
            {t(
              device.alertReason === 'fall'
                ? 'wearable.fallDetected'
                : device.alertReason === 'heartRate'
                  ? 'wearable.hrAlert'
                  : 'wearable.sosActive',
              lang,
            )}
          </span>
        </div>
      )}

      {device.checkInRequested && (
        <div className="bg-amber-500/15 border-amber-500/30 text-amber-800 dark:text-amber-200 mb-4 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold">
          <HelpCircle className="h-5 w-5 shrink-0" />
          <span>{t('wearable.checkinPending', lang)}</span>
        </div>
      )}

      {!device.checkInRequested && device.lastEventType === 'CHECK_IN_OK' && (
        <div className="bg-pine/10 border-pine/20 text-pine mb-4 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>{t('wearable.checkinOk', lang)}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Watch className="text-pine h-5 w-5" />
          <span className="section-kicker">{t('wearable.title', lang)}</span>
        </div>
        <span className={`flex items-center gap-1.5 text-sm font-bold ${device.online ? 'text-pine' : 'text-ink-soft'}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${device.online ? 'bg-pine' : 'bg-ink-soft'}`} />
          {device.online ? t('wearable.online', lang) : t('wearable.offline', lang)}
          <span className="text-ink-soft font-semibold">
            • {minutesAgo === 0 ? t('wearable.justNow', lang) : `${minutesAgo} ${t('wearable.minAgo', lang)}`}
          </span>
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
        <div className="flex items-center gap-2">
          <HeartPulse className="text-brick h-5 w-5" />
          <span className="font-display text-3xl font-bold">{device.heartRate ?? '—'}</span>
          <span className="text-ink-soft text-sm font-semibold">bpm</span>
        </div>
        <div className="flex items-center gap-2">
          <BatteryMedium className="text-ink-soft h-5 w-5" />
          <span className="font-display text-3xl font-bold">{device.battery === null ? '—' : `${device.battery}%`}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-3">
        <div className="flex flex-wrap items-center gap-3 text-base font-semibold">
          {device.landmark && (
            <span className="flex items-center gap-1.5">
              <MapPin className="text-pine h-4 w-4" />
              {t('wearable.near', lang)} {device.landmark}
            </span>
          )}
          {device.isBackground && (
            <span className="bg-ink-soft/10 text-ink-soft rounded-md px-2 py-0.5 text-xs font-semibold">
              {t('wearable.bgSync', lang)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={requestCheckin}
            disabled={requestingCheckin || Boolean(device.checkInRequested) || !device.online}
            className="btn btn-md btn-secondary flex items-center gap-1.5 disabled:opacity-50"
          >
            <HelpCircle className="h-4 w-4" />
            {device.checkInRequested ? t('wearable.checkinPending', lang) : t('wearable.requestCheckin', lang)}
          </button>
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="btn btn-md btn-secondary">
              {t('wearable.openMap', lang)}
            </a>
          )}
        </div>
      </div>
    </section>
  );
};
