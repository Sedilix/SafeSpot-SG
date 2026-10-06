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
  Navigation, 
  ExternalLink, 
  UserPlus, 
  HeartHandshake,
  Car,
  Share2, 
  Radio, 
  Loader2,
  Star
} from 'lucide-react';
import { EmergencyContact, LocationVerificationResult, AccessibilitySettings } from '../types';
import { t } from '../locales/translations';

interface OneTapSharePanelProps {
  contacts: EmergencyContact[];
  verification: LocationVerificationResult | null;
  settings: AccessibilitySettings;
  onOpenManageContacts: () => void;
  onOpenCaregiverPreview: () => void;
  /** Creates a Firestore incident and SMSes the /track/:id live link to family */
  onAlertFamily: () => void;
  isAlertingFamily: boolean;
}

export const OneTapSharePanel: React.FC<OneTapSharePanelProps> = ({
  contacts,
  verification,
  settings,
  onOpenManageContacts,
  onOpenCaregiverPreview,
  onAlertFamily,
  isAlertingFamily,
}) => {
  const [copied, setCopied] = useState(false);
  const [lastSentTo, setLastSentTo] = useState<string | null>(null);
  const [sendingContactId, setSendingContactId] = useState<string | null>(null);
  const [sentContactIds, setSentContactIds] = useState<Record<string, boolean>>({});

  const lang = settings.language || 'en';

  const shareUrls = verification?.shareUrls;
  const address = verification?.formattedAddress || 'My Current Location';

  const handleCopyLink = () => {
    if (!shareUrls?.googleMapsUrl) return;
    navigator.clipboard.writeText(
      `Pickup Location for Senior: ${address}\nNavigation Link: ${shareUrls.googleMapsUrl}\nInstructions: ${verification?.pickupInstructionsForDriver || 'Please pickup here'}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handleNativeShare = async () => {
    if (navigator.share && shareUrls) {
      try {
        await navigator.share({
          title: 'SafeSpot.SG Live Pickup Location',
          text: `I need a pickup at: ${address}. Driver instructions: ${verification?.pickupInstructionsForDriver || ''}`,
          url: shareUrls.googleMapsUrl,
        });
      } catch (e) {
        console.warn('Share cancelled or not supported:', e);
      }
    } else {
      handleCopyLink();
    }
  };

  /**
   * Direct 1-Tap Location Pin Dispatch:
   * Sends the live Google Maps pin, verified address, and driver note directly
   * to the contact's phone without launching the messaging app or requiring a 2nd tap!
   */
  const handleDirectSendPin = async (contact: EmergencyContact) => {
    if (sendingContactId === contact.id) return;
    setSendingContactId(contact.id);

    try {
      const blePrecision = verification?.bleAccuracyBoost && verification?.bleBeacons?.[0]
        ? `${verification.bleBeacons[0].locationName} (≈${verification.bleBeacons[0].estimatedDistanceMeters}m)`
        : undefined;

      const res = await fetch('/api/notify/dispatch-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: contact.id,
          contactName: contact.name,
          phone: contact.phone,
          address: verification?.formattedAddress || address,
          googleMapsUrl: shareUrls?.googleMapsUrl || (verification ? `https://www.google.com/maps/search/?api=1&query=${verification.verifiedCoordinates.lat},${verification.verifiedCoordinates.lng}` : 'https://www.google.com/maps'),
          driverHint: verification?.pickupInstructionsForDriver,
          blePrecision,
          incidentId: localStorage.getItem('senior_safespot_active_incident') || undefined,
        }),
      });

      if (res.ok) {
        setSentContactIds((prev) => ({ ...prev, [contact.id]: true }));
        setLastSentTo(contact.name);

        // Optional speech synthesis feedback
        if ('speechSynthesis' in window && settings.spokenGuidance) {
          const utterance = new SpeechSynthesisUtterance(`Location pin sent to ${contact.name.split(' ')[0]}.`);
          utterance.rate = 0.9;
          window.speechSynthesis.speak(utterance);
        }

        setTimeout(() => {
          setSentContactIds((prev) => ({ ...prev, [contact.id]: false }));
        }, 4500);

        setTimeout(() => setLastSentTo(null), 5000);
      }
    } catch (err) {
      console.warn('Direct pin dispatch error:', err);
    } finally {
      setSendingContactId(null);
    }
  };

  const handleCallContact = (contact: EmergencyContact) => {
    const cleanPhone = contact.phone.replace(/[^0-9+]/g, '');
    window.location.href = `tel:${cleanPhone}`;
  };

  return (
    <section id="card-one-tap-triggers" className="card p-6 sm:p-7">
      {/* Title Bar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="icon-tile">
            <HeartHandshake className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-display text-2xl leading-none font-bold tracking-tight">
              {t('share.title', lang)}
            </h3>
            <p className="text-ink-soft mt-1 text-sm font-normal sm:text-base">
              {t('share.subtitle', lang)}
            </p>
          </div>
        </div>

        {/* Full-width, evenly sized buttons on a phone; inline from sm up. */}
        <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <button
            id="btn-alert-family-live-track"
            onClick={onAlertFamily}
            disabled={isAlertingFamily}
            className="btn btn-md btn-danger"
            title="Create a live tracking incident and send the link to your family"
          >
            {isAlertingFamily ? <Loader2 className="h-5 w-5 animate-spin" /> : <Radio className="h-5 w-5" />}
            <span>{t('share.alertFamily', lang)}</span>
          </button>

          <button
            id="btn-preview-caregiver-view"
            onClick={onOpenCaregiverPreview}
            className="btn btn-md btn-secondary"
          >
            <Car className="text-pine h-5 w-5" />
            <span>{t('share.driverScreen', lang)}</span>
          </button>

          <button
            id="btn-manage-contacts"
            onClick={onOpenManageContacts}
            className="btn btn-md btn-secondary"
          >
            <UserPlus className="text-ink-soft h-5 w-5" />
            <span>{t('share.editContacts', lang)}</span>
          </button>
        </div>
      </div>

      {/* Instant Confirmation Feedback Banner */}
      {lastSentTo && (
        <div className="mb-4 flex items-center justify-center gap-2 rounded-2xl bg-pine-soft border-2 border-pine text-pine-deep p-4 text-base font-extrabold sm:text-lg shadow-sm animate-in fade-in duration-200">
          <Check className="h-6 w-6 stroke-[3] text-pine" />
          <span>{t('share.pinSentToBanner', lang)} {lastSentTo}!</span>
        </div>
      )}

      {/* 1-Tap Emergency Contact Cards Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {contacts.map((contact) => {
          const isSending = sendingContactId === contact.id;
          const isSent = Boolean(sentContactIds[contact.id]);

          return (
            <div
              key={contact.id}
              className={`flex flex-col justify-between rounded-2xl border p-5 transition-all ${
                contact.isPrimary && !contact.locked
                  ? 'border-pine bg-pine-soft/20 shadow-sm'
                  : 'border-line bg-well/50 hover:border-line-strong'
              }`}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="border-line bg-surface text-3xl rounded-xl border p-2 shadow-xs shrink-0">
                    {contact.emoji}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-ink text-lg leading-tight font-bold break-words sm:text-xl">
                        {contact.name}
                      </span>
                      {contact.isPrimary && !contact.locked && (
                        <span className="chip border-pine/60 bg-pine-soft text-pine-deep text-xs font-bold py-0.5 px-2 shrink-0">
                          <Star className="h-3 w-3 fill-pine text-pine" />
                          {t('share.preferred', lang)}
                        </span>
                      )}
                    </div>
                    <div className="text-ink-soft mt-0.5 text-sm font-semibold sm:text-base">
                      {contact.phone}
                    </div>
                  </div>
                </div>
              </div>

              {/* Direct 1-Tap Action Buttons */}
              <div className="mt-1 grid grid-cols-2 gap-2.5">
                <button
                  id={`btn-send-sms-${contact.id}`}
                  onClick={() => handleDirectSendPin(contact)}
                  disabled={isSending}
                  className={`btn btn-lg font-bold transition-all ${
                    isSent
                      ? 'bg-pine-deep text-white shadow-md'
                      : 'btn-primary'
                  }`}
                  aria-label={`Send location pin directly to ${contact.name}`}
                >
                  {isSending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : isSent ? (
                    <Check className="h-5 w-5 stroke-[3]" />
                  ) : (
                    <Send className="h-5 w-5" />
                  )}
                  <span>{isSending ? t('share.sending', lang) : isSent ? t('share.pinSent', lang) : t('share.sendPin', lang)}</span>
                </button>

                <button
                  id={`btn-call-${contact.id}`}
                  onClick={() => handleCallContact(contact)}
                  className="btn btn-lg btn-secondary font-bold"
                  aria-label={`Call ${contact.name}`}
                >
                  <Phone className="text-ink-soft h-5 w-5" />
                  <span>{t('share.call', lang)}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Universal Quick Action Row */}
      <div className="border-line mt-5 grid grid-cols-1 gap-2.5 border-t pt-4 sm:grid-cols-3">
        <a
          id="btn-open-google-maps-navigation"
          href={shareUrls?.googleMapsUrl || `https://www.google.com/maps`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-md btn-secondary"
        >
          <Navigation className="text-sky h-5 w-5" />
          <span>{t('share.openMaps', lang)}</span>
          <ExternalLink className="h-4 w-4 opacity-60" />
        </a>

        <button
          id="btn-copy-share-pin-link"
          onClick={handleCopyLink}
          className="btn btn-md btn-secondary"
        >
          {copied ? <Check className="text-pine h-5 w-5" /> : <Copy className="text-ink-soft h-5 w-5" />}
          <span>{copied ? t('share.copied', lang) : t('share.copyLink', lang)}</span>
        </button>

        <button
          id="btn-universal-share-sheet"
          onClick={handleNativeShare}
          className="btn btn-md btn-secondary"
        >
          <Share2 className="text-sky h-5 w-5" />
          <span>{t('share.shareToAnyApp', lang)}</span>
        </button>
      </div>
    </section>
  );
};
