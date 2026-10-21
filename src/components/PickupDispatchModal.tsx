/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Send,
  Phone,
  Copy,
  Check,
  MapPin,
  Navigation,
  ExternalLink,
  Radio,
  Star,
  X,
  Share2,
  ShieldCheck,
  Loader2,
  MessageCircle,
} from 'lucide-react';
import { EmergencyContact, LocationVerificationResult, AccessibilitySettings } from '../types';
import { buildPickupSharePayload } from '../utils/contacts';
import { t } from '../locales/translations';
import { authFetch, responseError } from '../lib/authFetch';
import { useEscapeToClose } from '../utils/useEscapeToClose';

interface PickupDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  verification: LocationVerificationResult | null;
  preferredContact: EmergencyContact | undefined;
  incidentId?: string;
  settings: AccessibilitySettings;
}

export const PickupDispatchModal: React.FC<PickupDispatchModalProps> = ({
  isOpen,
  onClose,
  verification,
  preferredContact,
  incidentId,
  settings,
}) => {
  const [copied, setCopied] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const lang = settings.language || 'en';

  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEscapeToClose(isOpen, onClose);

  // Move focus into the dialog when it opens, and reset the one-shot
  // sent/error flags so a reopened dialog does not show a stale result.
  useEffect(() => {
    if (!isOpen) return;
    setIsSent(false);
    setSendError(null);
    closeButtonRef.current?.focus();
  }, [isOpen]);

  if (!isOpen || !verification) return null;

  const targetContact = preferredContact || {
    id: 'generic',
    name: 'Caregiver / Family',
    relationship: 'Family',
    phone: '',
    emoji: '👨👩👧',
    bgColor: 'bg-pine',
    isPrimary: true,
  };

  const payload = buildPickupSharePayload(verification, targetContact, incidentId);

  const handleDirectSendPin = async () => {
    if (isSending) return;
    setIsSending(true);

    try {
      const blePrecision = verification.bleAccuracyBoost && verification.bleBeacons?.[0]
        ? `${verification.bleBeacons[0].locationName} (≈${verification.bleBeacons[0].estimatedDistanceMeters}m)`
        : undefined;

      setSendError(null);
      const res = await authFetch('/api/notify/dispatch-pin', {
        method: 'POST',
        body: JSON.stringify({
          contactId: targetContact.id,
          contactName: targetContact.name,
          phone: targetContact.phone,
          address: verification.formattedAddress,
          googleMapsUrl: payload.googleMapsUrl,
          driverHint: verification.pickupInstructionsForDriver,
          blePrecision,
          incidentId,
        }),
      });

      if (res.ok) {
        setIsSent(true);

        if ('speechSynthesis' in window && settings.spokenGuidance) {
          const utterance = new SpeechSynthesisUtterance(`Location pin sent directly to ${targetContact.name.split(' ')[0]}.`);
          utterance.rate = 0.9;
          window.speechSynthesis.speak(utterance);
        }

        setTimeout(() => {
          onClose();
        }, 2200);
      } else {
        setSendError(await responseError(res, t('share.smsFailed', lang)));
      }
    } catch (err) {
      console.warn('Direct dispatch error:', err);
      setSendError(t('share.smsFailed', lang));
    } finally {
      setIsSending(false);
    }
  };

  const handleCopy = () => {
    // Clipboard can be refused (insecure context, permissions); only claim
    // "Copied" when the write actually succeeded.
    navigator.clipboard
      ?.writeText(payload.messageText)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      })
      .catch((e) => console.warn('Copy to clipboard failed:', e));
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `SafeSpot.SG: Pick Me Up Here (${targetContact.name})`,
          text: payload.messageText,
          url: payload.googleMapsUrl,
        });
      } catch (e) {
        console.warn('Native share cancelled or unsupported:', e);
      }
    } else {
      handleCopy();
    }
  };

  const handleOpenWhatsApp = () => {
    window.open(payload.whatsappUrl, '_blank', 'noopener');
  };

  const handleOpenSMS = () => {
    window.location.href = payload.smsUrl;
  };

  const handleCall = () => {
    window.location.href = payload.telUrl;
  };

  const firstName = targetContact.name.split(' ')[0];

  return (
    <div
      id="modal-pickup-dispatch"
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pickup-dispatch-title"
    >
      <div className="modal-panel max-w-lg overflow-y-auto p-5 sm:p-8">
        {/* Header */}
        <div className="border-line mb-5 flex items-start justify-between gap-3 border-b pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="icon-tile h-12 w-12 rounded-2xl bg-pine-soft text-pine" aria-hidden="true">
              <Star className="h-6 w-6 fill-pine" />
            </div>
            <h2
              id="pickup-dispatch-title"
              className="font-display text-2xl leading-tight font-bold tracking-tight text-ink break-words"
            >
              {t('dispatch.sendTo', lang)} {targetContact.name}
            </h2>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="accessible-tap text-ink-soft hover:bg-well hover:text-ink focus-visible:outline-pine shrink-0 rounded-xl p-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            aria-label={t('dispatch.close', lang)}
          >
            <X aria-hidden="true" className="h-6 w-6" />
          </button>
        </div>

        {/* Verified location preview */}
        <div className="border-line bg-well/70 mb-5 space-y-3 rounded-2xl border p-4">
          <div className="flex items-start gap-3">
            <MapPin aria-hidden="true" className="text-pine mt-0.5 h-6 w-6 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-ink-soft text-sm font-bold">{t('dispatch.verifiedSpot', lang)}</div>
              <div className="text-ink text-base leading-snug font-bold break-words">
                {verification.formattedAddress}
              </div>
              {verification.pickupInstructionsForDriver && (
                <p className="text-ink-soft mt-1 text-sm leading-relaxed">
                  <strong>{t('dispatch.driverNote', lang)} </strong>
                  {verification.pickupInstructionsForDriver}
                </p>
              )}
            </div>
          </div>

          {/* Precision badges */}
          <div className="border-line/60 flex flex-wrap items-center gap-2 border-t pt-3">
            <span className="chip border-pine/40 bg-pine-soft text-pine-deep">
              <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
              {verification.confidenceScore}% {t('live.verified', lang)}
            </span>
            {verification.bleAccuracyBoost && verification.bleBeacons?.[0] && (
              <span className="chip border-sky/40 bg-sky-soft text-sky">
                <Radio aria-hidden="true" className="h-3.5 w-3.5" />
                {verification.bleBeacons[0].locationName} (±{verification.bleBeacons[0].estimatedDistanceMeters}m)
              </span>
            )}
            <span className="chip border-line bg-surface text-ink-soft">
              <Navigation aria-hidden="true" className="h-3.5 w-3.5" />
              {t('dispatch.mapsReady', lang)}
            </span>
          </div>
        </div>

        {/* Primary one-tap direct send */}
        <div className="mb-5 space-y-3">
          <button
            id="btn-dispatch-direct-send"
            type="button"
            onClick={handleDirectSendPin}
            // A sent pin cannot be "un-sent"; block a second send while the
            // dialog shows its confirmation and closes.
            disabled={isSending || isSent}
            aria-busy={isSending}
            className={`btn btn-lg w-full ${isSent ? 'bg-pine-deep text-on-pine disabled:opacity-100' : 'btn-primary'}`}
          >
            {isSending ? (
              <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin" />
            ) : isSent ? (
              <Check aria-hidden="true" className="h-6 w-6 stroke-[3]" />
            ) : (
              <Send aria-hidden="true" className="h-6 w-6" />
            )}
            <span role="status">
              {isSending
                ? `${t('dispatch.sending', lang)} ${firstName}…`
                : isSent
                ? `${t('dispatch.sent', lang)} ${firstName}!`
                : `${t('dispatch.sendPin', lang)} ${firstName}`}
            </span>
          </button>

          {sendError && (
            <p role="alert" className="text-brick-deep text-center text-sm font-bold">
              {sendError}
            </p>
          )}

          {/* Other ways to send it */}
          <div className="grid grid-cols-2 gap-3">
            <button
              id="btn-dispatch-whatsapp"
              type="button"
              onClick={handleOpenWhatsApp}
              className="btn btn-md btn-secondary"
            >
              <MessageCircle aria-hidden="true" className="text-pine h-4 w-4" />
              <span>WhatsApp</span>
            </button>

            <button
              id="btn-dispatch-sms"
              type="button"
              onClick={handleOpenSMS}
              className="btn btn-md btn-secondary"
            >
              <Send aria-hidden="true" className="text-pine h-4 w-4" />
              <span>{t('dispatch.sms', lang)}</span>
            </button>
          </div>

          {targetContact.phone && (
            <button
              id="btn-dispatch-call"
              type="button"
              onClick={handleCall}
              className="btn btn-md btn-secondary w-full"
            >
              <Phone aria-hidden="true" className="text-pine h-4 w-4 shrink-0" />
              <span className="min-w-0 break-words">
                {t('dispatch.call', lang)} {targetContact.name} ({targetContact.phone})
              </span>
            </button>
          )}
        </div>

        {/* Secondary links */}
        <div className="border-line text-ink-soft flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm font-bold">
          <a
            href={payload.googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-pine inline-flex min-h-11 items-center gap-1.5 underline underline-offset-2"
          >
            <ExternalLink aria-hidden="true" className="h-4 w-4" />
            {t('dispatch.openGoogleMaps', lang)}
          </a>

          <div className="flex items-center gap-2">
            <button type="button" onClick={handleNativeShare} className="btn btn-md btn-secondary">
              <Share2 aria-hidden="true" className="h-4 w-4" />
              {t('dispatch.share', lang)}
            </button>

            <button type="button" onClick={handleCopy} className="btn btn-md btn-secondary">
              {copied ? (
                <Check aria-hidden="true" className="text-pine h-4 w-4" />
              ) : (
                <Copy aria-hidden="true" className="h-4 w-4" />
              )}
              <span role="status">{copied ? t('dispatch.copied', lang) : t('dispatch.copyText', lang)}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
