/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  X, 
  Car, 
  Navigation, 
  ExternalLink, 
  ShieldCheck, 
  Camera,
  Sparkles,
  Clock,
  Layers,
  MapPin
} from 'lucide-react';
import { LocationVerificationResult, AccessibilitySettings } from '../types';
import { t } from '../locales/translations';
import { useEscapeToClose } from '../utils/useEscapeToClose';

interface CaregiverPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  verification: LocationVerificationResult | null;
  photoBase64?: string | null;
  settings: AccessibilitySettings;
}

export const CaregiverPreviewModal: React.FC<CaregiverPreviewModalProps> = ({
  isOpen,
  onClose,
  verification,
  photoBase64,
  settings,
}) => {
  const [streetViewFailed, setStreetViewFailed] = useState(false);

  // Fresh street-view attempt every time the preview opens.
  useEffect(() => {
    if (isOpen) setStreetViewFailed(false);
  }, [isOpen, verification]);

  const lang = settings.language || 'en';

  // No invented addresses or coordinates: everything shown comes from the
  // actual verification result.
  const coords = verification?.verifiedCoordinates ?? verification?.originalCoordinates ?? null;
  const address = verification?.formattedAddress || 'Location not verified yet';
  const googleMapsUrl = coords
    ? verification?.shareUrls?.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`
    : null;

  useEscapeToClose(isOpen, onClose);

  if (!isOpen) return null;

  const seniorSnapshot = photoBase64 || verification?.photoUrl || null;
  const streetViewUrl = verification?.streetViewData?.streetViewImageUrl || null;
  const showStreetView = Boolean(streetViewUrl) && !streetViewFailed;

  return (
    <div id="modal-caregiver-preview" className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel max-w-2xl overflow-y-auto p-6 sm:p-8 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="border-line mb-6 flex items-start justify-between border-b pb-4">
          <div className="flex items-center gap-3">
            <div className="icon-tile h-12 w-12 rounded-2xl bg-pine-soft text-pine">
              <Car className="h-6 w-6" />
            </div>
            <div>
              <div className="section-kicker text-pine mb-0.5">{t('caregiver.kicker', lang)}</div>
              <h3 className="font-display text-2xl leading-tight font-bold tracking-tight text-ink">
                {t('caregiver.title', lang)}
              </h3>
            </div>
          </div>

          <button
            onClick={onClose}
            className="accessible-tap text-ink-soft hover:bg-well hover:text-ink rounded-xl p-2 transition-colors"
            aria-label="Close driver screen preview"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Honest ETA guidance: the real ETA comes from Google Maps using the
            driver's own live position, never from an invented starting point */}
        <div className="border-pine/30 bg-pine-soft text-ink mb-5 flex items-center justify-between gap-3 rounded-xl border p-4">
          <div className="flex items-center gap-3">
            <div className="bg-pine text-on-pine flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <div className="section-kicker text-pine-deep">
                {t('caregiver.travelTime', lang)}
              </div>
              <div className="text-base font-bold sm:text-lg">
                {t('caregiver.etaHint', lang)}
              </div>
            </div>
          </div>
          <span className="chip border-pine/40 bg-surface text-pine-deep">
            Google Maps
          </span>
        </div>

        {/* Big Address Card */}
        <div className="border-line bg-well/60 mb-5 rounded-xl border p-4">
          <div className="section-kicker mb-1">{t('caregiver.verifiedSpot', lang)}</div>
          <h2 className="font-display text-ink text-2xl leading-tight font-bold">
            {address}
          </h2>
          <div className="text-pine-deep mt-2 flex items-center gap-1.5 text-sm font-bold sm:text-base">
            <ShieldCheck className="h-5 w-5" />
            <span>{t('caregiver.precisionSummary', lang)}</span>
          </div>
        </div>

        {/* Multi-API Synergy Summary Box */}
        <div className="border-line bg-well/60 text-ink-soft mb-5 space-y-2 rounded-xl border p-4 text-sm">
          <div className="section-kicker flex items-center gap-1.5">
            <Layers className="h-4 w-4" />
            <span>{t('caregiver.precisionLayer', lang)}</span>
          </div>
          <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-3">
            <div className="border-line bg-surface rounded-lg border p-2.5">
              <span className="text-ink block font-bold">1. Places API</span>
              <span className="text-sm">{t('caregiver.placesApiDesc', lang)}</span>
            </div>
            <div className="border-line bg-surface rounded-lg border p-2.5">
              <span className="text-ink block font-bold">2. Roads API</span>
              <span className="text-sm">{t('caregiver.roadsApiDesc', lang)}</span>
            </div>
            <div className="border-line bg-surface rounded-lg border p-2.5">
              <span className="text-ink block font-bold">3. Routes API</span>
              <span className="text-sm">{t('caregiver.routesApiDesc', lang)}</span>
            </div>
          </div>
        </div>

        {/* Driver Pickup Notes */}
        <div className="border-ochre/30 bg-ochre-soft text-ink mb-5 rounded-xl border p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="text-ochre mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <div className="section-kicker text-ochre mb-1">{t('caregiver.driverNotes', lang)}</div>
              <p className="text-base leading-snug font-bold sm:text-lg">
                “{verification?.pickupInstructionsForDriver || 'Pull up safely to the designated curbside.'}”
              </p>
            </div>
          </div>
        </div>

        {/* Photo Comparison Strip */}
        <div className="mb-5">
          <div className="section-kicker text-ink-soft mb-2 flex items-center gap-1.5 text-sm">
            <Camera className="text-sky h-4 w-4" />
            <span>{t('caregiver.seniorSnapshot', lang)}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Senior Photo */}
            <div className="relative aspect-video overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-xs">
              {seniorSnapshot ? (
                <img
                  src={seniorSnapshot}
                  alt="Senior Surroundings"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-xs font-semibold text-slate-300">
                  <Camera className="h-6 w-6" />
                  {t('caregiver.noPhoto', lang)}
                </div>
              )}
              <div className="absolute top-2 left-2 rounded bg-black/75 px-2 py-0.5 text-xs font-bold text-white">
                {t('caregiver.seniorPhotoBadge', lang)}
              </div>
            </div>

            {/* Street View / Satellite Reference */}
            <div className="relative aspect-video overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-xs">
              {showStreetView ? (
                <img
                  src={streetViewUrl!}
                  alt="Google Street View Reference"
                  onError={() => setStreetViewFailed(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-xs font-semibold text-slate-300">
                  <MapPin className="h-6 w-6" />
                  {t('caregiver.streetViewNoAvailable', lang)}
                </div>
              )}
              <div className="absolute top-2 left-2 rounded bg-black/75 px-2 py-0.5 text-xs font-bold text-white">
                {t('caregiver.streetViewBadge', lang)}
              </div>
              {showStreetView && (
                <div className="absolute bottom-2 left-2 right-2 rounded bg-black/80 p-1.5 text-xs text-white">
                  <p className="truncate font-semibold text-emerald-400">
                    ✓ {verification?.streetViewData?.comparisonSummary || 'Curbside features cross-referenced'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Verified Landmarks */}
        {verification?.visualLandmarks && verification.visualLandmarks.length > 0 && (
          <div className="mb-6">
            <div className="section-kicker text-ink-soft mb-2 text-sm">
              Visual Landmark Indicators to Look For:
            </div>
            <div className="space-y-1.5">
              {verification.visualLandmarks.map((lm) => (
                <div
                  key={lm.id}
                  className="border-line bg-well/60 flex items-center justify-between rounded-lg border p-3 text-sm font-bold sm:text-base"
                >
                  <span>✓ {lm.name}</span>
                  <span className="text-pine-deep text-sm font-bold">
                    {lm.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Button: Start Navigation in Google Maps */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {googleMapsUrl ? (
            <a
              id="btn-caregiver-start-nav"
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-lg btn-primary"
            >
              <Navigation className="h-5 w-5" />
              <span>{t('caregiver.openMapsNav', lang)}</span>
              <ExternalLink className="h-4 w-4 opacity-60" />
            </a>
          ) : (
            <button type="button" disabled className="btn btn-lg btn-primary opacity-50">
              <Navigation className="h-5 w-5" />
              <span>{t('caregiver.noVerifiedLoc', lang)}</span>
            </button>
          )}

          <button
            id="btn-caregiver-close-preview"
            onClick={onClose}
            className="btn btn-lg btn-secondary"
          >
            {t('caregiver.donePreview', lang)}
          </button>
        </div>
      </div>
    </div>
  );
};
