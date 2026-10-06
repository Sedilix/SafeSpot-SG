/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { 
  MapPin, 
  Volume2, 
  RefreshCw, 
  ShieldCheck, 
  Navigation, 
  Info,
  CheckCircle2,
  Sparkles
} from 'lucide-react';
import { GPSLocation, LocationVerificationResult, AccessibilitySettings } from '../types';
import { t } from '../locales/translations';

interface LiveLocationCardProps {
  gps: GPSLocation | null;
  verification: LocationVerificationResult | null;
  isLoadingGPS: boolean;
  isVerifyingAI: boolean;
  onRefreshGPS: () => void;
  onSpeakAddress: () => void;
  isSpeaking: boolean;
  settings: AccessibilitySettings;
}

export const LiveLocationCard: React.FC<LiveLocationCardProps> = ({
  gps,
  verification,
  isLoadingGPS,
  isVerifyingAI,
  onRefreshGPS,
  onSpeakAddress,
  isSpeaking,
  settings,
}) => {
  const lang = settings.language || 'en';

  const address = verification?.formattedAddress || (gps ? `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}` : t('live.locating', lang));
  const accuracy = verification?.originalCoordinates?.accuracyMeters ?? gps?.accuracy ?? 25;

  return (
    <section id="card-live-location" className="card p-6 sm:p-7">
      {/* Header Banner: Status & Confidence */}
      <div className="border-line mb-5 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-3.5 w-3.5">
            <span className="bg-pine absolute inline-flex h-full w-full animate-ping rounded-full opacity-40"></span>
            <span className="bg-pine relative inline-flex h-3.5 w-3.5 rounded-full"></span>
          </span>
          <span className="section-kicker text-sm">
            {isVerifyingAI ? t('live.statusVerifying', lang) : t('live.statusReady', lang)}
          </span>
        </div>

        {/* Multi-source Confidence Pill */}
        <div className="flex flex-wrap items-center gap-2">
          {verification && (
            <span className="chip border-pine/40 bg-pine-soft text-pine-deep text-sm">
              <ShieldCheck className="h-4 w-4" />
              {verification.confidenceScore}% {t('live.verified', lang)}
            </span>
          )}

          <span className="text-ink-soft flex items-center gap-1.5 text-sm font-semibold">
            <Navigation className="h-4 w-4" />
            {t('live.accuracy', lang)}{Math.round(accuracy)}m
          </span>
        </div>
      </div>

      {/* Main Address Display */}
      <div className="mb-5 flex items-start gap-4">
        <div className="icon-tile mt-1 h-14 w-14 shrink-0 rounded-2xl">
          <MapPin className="h-7 w-7" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="section-kicker mb-1">{t('live.whereStanding', lang)}</div>
          <h2 className="font-display text-ink text-2xl leading-tight font-bold break-words sm:text-3xl">
            {address}
          </h2>

          {verification?.streetName && (
            <div className="text-pine-deep mt-2 flex items-center gap-1.5 text-base font-bold sm:text-lg">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span>{verification.streetName} • {verification.nearbyCrossStreet}</span>
            </div>
          )}
        </div>
      </div>

      {/* Indoor Detection Guidance */}
      {verification?.isIndoors && (
        <div className="mb-5 rounded-xl border-2 border-amber-400 bg-ochre-soft text-ink p-4 space-y-1">
          <div className="flex items-center gap-2 font-extrabold text-sm sm:text-base">
            <span>🏠 {t('live.indoors', lang)}: {verification.indoorContext || 'Inside Building / Concourse'}</span>
          </div>
          <p className="text-xs sm:text-sm font-semibold">
            <strong>{t('live.pickupTip', lang)}: </strong>{verification.indoorExitGuidance || t('live.stepEntrance', lang)}
          </p>
        </div>
      )}

      {/* Elder Voice Summary / Driver Note */}
      {verification && (
        <div className="border-ochre/30 bg-ochre-soft text-ink mb-5 rounded-xl border p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="text-ochre mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <div className="section-kicker text-ochre mb-1">
                {t('live.aiInstructionsTitle', lang)}
              </div>
              <p className="text-base leading-snug font-semibold sm:text-lg">
                “{verification.pickupInstructionsForDriver}”
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
        <button
          id="btn-speak-address-large"
          onClick={onSpeakAddress}
          className="btn btn-lg btn-primary"
          aria-label={t('live.readAddress', lang)}
        >
          <Volume2 className={`h-6 w-6 ${isSpeaking ? 'animate-pulse' : ''}`} />
          <span>{isSpeaking ? t('live.readingAddress', lang) : t('live.readAddress', lang)}</span>
        </button>

        <button
          id="btn-refresh-gps-location"
          onClick={onRefreshGPS}
          disabled={isLoadingGPS}
          className="btn btn-lg btn-secondary"
        >
          <RefreshCw className={`h-6 w-6 ${isLoadingGPS ? 'animate-spin' : ''}`} />
          <span>{isLoadingGPS ? t('live.updatingLocation', lang) : t('live.updateLocation', lang)}</span>
        </button>
      </div>

      {/* Reassuring Safe Waiting Tip & Multi-API Accuracy Indicators */}
      <div className="border-line mt-5 space-y-2.5 border-t pt-4">
        {verification?.safeWaitingAdvice && (
          <div className="text-ink-soft flex items-center gap-2 text-sm font-semibold sm:text-base">
            <Info className="text-pine h-5 w-5 shrink-0" />
            <span>{verification.safeWaitingAdvice}</span>
          </div>
        )}

        {/* Only facts this verification actually produced, in plain language:
            no API names, and no "road aligned"/"navigation" claims when
            nothing was checked yet. */}
        {(verification?.nearbyPlaces?.length || verification?.roadSnapping?.snapped || verification?.bleBeacons?.length) ? (
          <div className="text-ink-soft flex flex-wrap items-center gap-2 pt-1 text-xs font-semibold sm:text-sm">
            {verification?.nearbyPlaces?.length ? (
              <span className="chip border-line bg-well text-ink-soft">
                <span className="bg-pine h-2 w-2 rounded-full"></span>
                {verification.nearbyPlaces.length} {t('live.landmarks', lang)}
              </span>
            ) : null}
            {verification?.roadSnapping?.snapped ? (
              <span className="chip border-line bg-well text-ink-soft">
                <span className="bg-sky h-2 w-2 rounded-full"></span>
                {t('live.curbsideSnapped', lang)}
              </span>
            ) : null}
            {verification?.bleBeacons?.length ? (
              <span className="chip border-sky-400 bg-sky-50 text-sky-900 font-bold">
                <span className="bg-sky-600 h-2 w-2 rounded-full"></span>
                {verification.bleBeacons[0].name} (±{verification.bleBeacons[0].estimatedDistanceMeters}m)
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
};
