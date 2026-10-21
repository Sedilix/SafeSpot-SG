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
  CheckCircle2,
  Clock,
  Layers,
  MapPin,
  StickyNote,
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

  // No invented addresses, coordinates or claims: everything shown comes from
  // the actual verification result.
  const coords = verification?.verifiedCoordinates ?? verification?.originalCoordinates ?? null;
  const isVerified = Boolean(verification?.formattedAddress);
  const address = verification?.formattedAddress || t('caregiver.notVerifiedYet', lang);
  const driverNote = verification?.pickupInstructionsForDriver || null;
  const comparisonSummary = verification?.streetViewData?.comparisonSummary || null;
  const googleMapsUrl = coords
    ? verification?.shareUrls?.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`
    : null;

  useEscapeToClose(isOpen, onClose);

  if (!isOpen) return null;

  const seniorSnapshot = photoBase64 || verification?.photoUrl || null;
  const streetViewUrl = verification?.streetViewData?.streetViewImageUrl || null;
  const showStreetView = Boolean(streetViewUrl) && !streetViewFailed;

  return (
    <div
      id="modal-caregiver-preview"
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="caregiver-preview-title"
    >
      <div className="modal-panel max-w-2xl">
        {/* Header */}
        <div className="modal-head">
          <div className="flex min-w-0 items-center gap-3">
            <div className="icon-tile">
              <Car className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="caregiver-preview-title"
                className="font-display text-2xl leading-tight font-bold tracking-tight text-ink"
              >
                {t('caregiver.title', lang)}
              </h2>
              <p className="text-ink-soft mt-1 text-sm sm:text-base">{t('caregiver.kicker', lang)}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="accessible-tap text-ink-soft hover:bg-well hover:text-ink shrink-0 rounded-xl p-2 transition-colors"
            aria-label={t('caregiver.closePreview', lang)}
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          {/* Honest ETA guidance: the real ETA comes from Google Maps using the
              driver's own live position, never from an invented starting point */}
          <div className="border-pine/30 bg-pine-soft text-ink flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
            <div className="flex items-center gap-3">
              <div className="bg-pine text-on-pine flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                <Clock className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <div className="section-kicker text-pine-deep">{t('caregiver.travelTime', lang)}</div>
                <div className="text-base font-bold sm:text-lg">{t('caregiver.etaHint', lang)}</div>
              </div>
            </div>
          </div>

          {/* Address */}
          <div className="border-line bg-well/60 rounded-xl border p-4">
            <div className="section-kicker mb-1">{t('caregiver.verifiedSpot', lang)}</div>
            <p className="font-display text-ink text-2xl leading-tight font-bold break-words">{address}</p>
            {isVerified && (
              <div className="text-pine-deep mt-2 flex items-start gap-1.5 text-sm font-bold sm:text-base">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <span>{t('caregiver.precisionSummary', lang)}</span>
              </div>
            )}
          </div>

          {/* How the spot is checked: one container, rows divided by rules */}
          <div className="border-line bg-well/60 text-ink-soft rounded-xl border p-4 text-sm">
            <div className="section-kicker flex items-center gap-1.5">
              <Layers className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t('caregiver.precisionLayer', lang)}</span>
            </div>
            <ul className="divide-line mt-2 divide-y">
              <li className="py-2.5 sm:flex sm:gap-3">
                <span className="text-ink block shrink-0 font-bold sm:w-32">1. Places API</span>
                <span>{t('caregiver.placesApiDesc', lang)}</span>
              </li>
              <li className="py-2.5 sm:flex sm:gap-3">
                <span className="text-ink block shrink-0 font-bold sm:w-32">2. Roads API</span>
                <span>{t('caregiver.roadsApiDesc', lang)}</span>
              </li>
              <li className="pt-2.5 sm:flex sm:gap-3">
                <span className="text-ink block shrink-0 font-bold sm:w-32">3. Routes API</span>
                <span>{t('caregiver.routesApiDesc', lang)}</span>
              </li>
            </ul>
          </div>

          {/* Driver Pickup Notes: only the real instruction, never a stock line */}
          <div className="border-ochre/30 bg-ochre-soft text-ink rounded-xl border p-4">
            <div className="flex items-start gap-3">
              <StickyNote className="text-ochre-deep mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <div className="section-kicker text-ochre-deep mb-1">{t('caregiver.driverNotes', lang)}</div>
                {driverNote ? (
                  <p className="text-base leading-snug font-bold sm:text-lg">“{driverNote}”</p>
                ) : (
                  <p className="text-ink-soft text-base">{t('caregiver.noDriverNotes', lang)}</p>
                )}
              </div>
            </div>
          </div>

          {/* Photo Comparison Strip */}
          <div>
            <div className="section-kicker text-ink-soft mb-2 flex items-center gap-1.5">
              <Camera className="text-sky h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t('caregiver.seniorSnapshot', lang)}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Senior Photo */}
              <div className="border-line bg-well relative aspect-video overflow-hidden rounded-xl border">
                {seniorSnapshot ? (
                  <img
                    src={seniorSnapshot}
                    alt={t('caregiver.seniorPhotoBadge', lang)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="text-ink-soft flex h-full w-full flex-col items-center justify-center gap-2 p-4 pt-9 text-center text-sm font-semibold">
                    <Camera className="h-6 w-6" aria-hidden="true" />
                    {t('caregiver.noPhoto', lang)}
                  </div>
                )}
                <div className="bg-ink/80 text-bg absolute top-2 left-2 rounded-md px-2 py-0.5 text-xs font-bold">
                  {t('caregiver.seniorPhotoBadge', lang)}
                </div>
              </div>

              {/* Street View Reference */}
              <div className="border-line bg-well relative aspect-video overflow-hidden rounded-xl border">
                {showStreetView ? (
                  <img
                    src={streetViewUrl!}
                    alt={t('caregiver.streetViewBadge', lang)}
                    onError={() => setStreetViewFailed(true)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="text-ink-soft flex h-full w-full flex-col items-center justify-center gap-2 p-4 pt-9 text-center text-sm font-semibold">
                    <MapPin className="h-6 w-6" aria-hidden="true" />
                    {t('caregiver.streetViewNoAvailable', lang)}
                  </div>
                )}
                <div className="bg-ink/80 text-bg absolute top-2 left-2 rounded-md px-2 py-0.5 text-xs font-bold">
                  {t('caregiver.streetViewBadge', lang)}
                </div>
                {showStreetView && comparisonSummary && (
                  <div className="bg-ink/80 text-bg absolute right-2 bottom-2 left-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <p className="truncate">{comparisonSummary}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Verified Landmarks */}
          {verification?.visualLandmarks && verification.visualLandmarks.length > 0 && (
            <div>
              <div className="section-kicker text-ink-soft mb-2">{t('caregiver.landmarksToLookFor', lang)}</div>
              <ul className="space-y-2">
                {verification.visualLandmarks.map((lm) => (
                  <li
                    key={lm.id}
                    className="border-line bg-well/60 flex flex-col gap-1 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:text-base"
                  >
                    <span className="flex items-center gap-2 font-bold">
                      <CheckCircle2 className="text-pine h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{lm.name}</span>
                    </span>
                    <span className="text-pine-deep text-sm font-bold sm:text-right">{lm.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="modal-foot">
          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
            {googleMapsUrl ? (
              <a
                id="btn-caregiver-start-nav"
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-lg btn-primary"
              >
                <Navigation className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span>{t('caregiver.openMapsNav', lang)}</span>
                <ExternalLink className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
              </a>
            ) : (
              <button type="button" disabled className="btn btn-lg btn-primary">
                <Navigation className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span>{t('caregiver.noVerifiedLoc', lang)}</span>
              </button>
            )}

            <button
              id="btn-caregiver-close-preview"
              type="button"
              onClick={onClose}
              className="btn btn-lg btn-secondary"
            >
              {t('caregiver.donePreview', lang)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
