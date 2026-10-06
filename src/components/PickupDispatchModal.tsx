/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
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
  Loader2 
} from 'lucide-react';
import { EmergencyContact, LocationVerificationResult, AccessibilitySettings } from '../types';
import { buildPickupSharePayload } from '../utils/contacts';
import { t } from '../locales/translations';
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

  const lang = settings.language || 'en';

  useEscapeToClose(isOpen, onClose);

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

      const res = await fetch('/api/notify/dispatch-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      }
    } catch (err) {
      console.warn('Direct dispatch error:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(payload.messageText);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
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
    window.open(payload.whatsappUrl, '_blank');
  };

  const handleOpenSMS = () => {
    window.location.href = payload.smsUrl;
  };

  const handleCall = () => {
    window.location.href = payload.telUrl;
  };

  return (
    <div id="modal-pickup-dispatch" className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel max-w-lg overflow-y-auto p-6 sm:p-8 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="border-line mb-5 flex items-start justify-between border-b pb-4">
          <div className="flex items-center gap-3">
            <div className="icon-tile h-12 w-12 rounded-2xl bg-pine-soft text-pine">
              <Star className="h-6 w-6 fill-pine" />
            </div>
            <div>
              <div className="section-kicker text-pine mb-0.5">{t('dispatch.kicker', lang)}</div>
              <h3 className="font-display text-2xl leading-tight font-bold tracking-tight text-ink">
                {t('dispatch.sendTo', lang)} {targetContact.name}
              </h3>
            </div>
          </div>

          <button
            onClick={onClose}
            className="accessible-tap text-ink-soft hover:bg-well hover:text-ink rounded-xl p-2 transition-colors"
            aria-label="Close dispatch window"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Verified Location Preview Card */}
        <div className="border-line bg-well/70 rounded-2xl border p-4 mb-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="bg-surface rounded-xl border border-line p-2 text-pine shrink-0">
              <MapPin className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold uppercase tracking-wider text-ink-faint">{t('dispatch.verifiedSpot', lang)}</div>
              <div className="text-ink text-base font-bold leading-snug">
                {verification.formattedAddress}
              </div>
              {verification.pickupInstructionsForDriver && (
                <p className="text-ink-soft text-xs mt-1 leading-relaxed">
                  <strong>{t('dispatch.driverNote', lang)} </strong>{verification.pickupInstructionsForDriver}
                </p>
              )}
            </div>
          </div>

          {/* Precision Badges */}
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-line/60">
            <span className="chip border-pine/40 bg-pine-soft text-pine-deep text-xs font-bold">
              <ShieldCheck className="h-3.5 w-3.5" />
              {verification.confidenceScore}% Verified
            </span>
            {verification.bleAccuracyBoost && verification.bleBeacons?.[0] && (
              <span className="chip border-sky-400 bg-sky-soft text-sky text-xs font-bold">
                <Radio className="h-3.5 w-3.5 text-sky animate-pulse" />
                BLE: {verification.bleBeacons[0].locationName} (±{verification.bleBeacons[0].estimatedDistanceMeters}m)
              </span>
            )}
            <span className="chip border-line bg-surface text-ink-soft text-xs font-semibold">
              <Navigation className="h-3 w-3" />
              {t('dispatch.mapsReady', lang)}
            </span>
          </div>
        </div>

        {/* Primary 1-Tap Direct Send Button */}
        <div className="space-y-3 mb-5">
          <button
            id="btn-dispatch-direct-send"
            onClick={handleDirectSendPin}
            disabled={isSending}
            className={`btn btn-lg w-full shadow-lg font-bold text-lg py-4 flex items-center justify-center gap-3 rounded-2xl transition-all ${
              isSent ? 'bg-pine-deep text-white' : 'btn-primary'
            }`}
          >
            {isSending ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : isSent ? (
              <Check className="h-6 w-6 stroke-[3]" />
            ) : (
              <Send className="h-6 w-6" />
            )}
            <span>
              {isSending
                ? `${t('dispatch.sending', lang)} ${targetContact.name.split(' ')[0]}…`
                : isSent
                ? `${t('dispatch.sent', lang)} ${targetContact.name.split(' ')[0]}!`
                : `${t('dispatch.sendPin', lang)} ${targetContact.name.split(' ')[0]}`}
            </span>
          </button>

          {/* Secondary Quick Messaging Channels */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              id="btn-dispatch-whatsapp"
              onClick={handleOpenWhatsApp}
              className="btn btn-md btn-secondary flex items-center justify-center gap-2 font-bold py-2.5 text-xs sm:text-sm"
            >
              <span>💬</span>
              <span>WhatsApp</span>
            </button>

            <button
              id="btn-dispatch-sms"
              onClick={handleOpenSMS}
              className="btn btn-md btn-secondary flex items-center justify-center gap-2 font-bold py-2.5 text-xs sm:text-sm"
            >
              <Send className="h-4 w-4 text-pine" />
              <span>{t('dispatch.sms', lang)}</span>
            </button>
          </div>

          {targetContact.phone && (
            <button
              id="btn-dispatch-call"
              onClick={handleCall}
              className="btn btn-md btn-secondary w-full flex items-center justify-center gap-2 font-bold py-2.5"
            >
              <Phone className="h-4 w-4 text-pine" />
              <span>{t('dispatch.call', lang)} {targetContact.name} ({targetContact.phone})</span>
            </button>
          )}
        </div>

        {/* Secondary Links */}
        <div className="border-t border-line pt-4 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-ink-soft">
          <a
            href={payload.googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-pine flex items-center gap-1.5 underline underline-offset-2 py-1"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('dispatch.openGoogleMaps', lang)}
          </a>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleNativeShare}
              className="hover:text-pine flex items-center gap-1 border border-line rounded-lg px-2.5 py-1 transition-colors"
            >
              <Share2 className="h-3.5 w-3.5" />
              {t('dispatch.share', lang)}
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className="hover:text-pine flex items-center gap-1 border border-line rounded-lg px-2.5 py-1 transition-colors"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-pine" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t('dispatch.copied', lang) : t('dispatch.copyText', lang)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
