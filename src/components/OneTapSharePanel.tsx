/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
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
  Star,
  AlertTriangle
} from 'lucide-react';
import { EmergencyContact, LocationVerificationResult, AccessibilitySettings } from '../types';
import { t } from '../locales/translations';
import { auth } from '../lib/firebase';
import { authFetch, responseError } from '../lib/authFetch';

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
  const [sendError, setSendError] = useState<string | null>(null);
  const [telegramChatCount, setTelegramChatCount] = useState(0);
  const [telegramState, setTelegramState] = useState<'idle' | 'sending' | 'sent'>('idle');

  const lang = settings.language || 'en';

  const shareUrls = verification?.shareUrls;
  const address = verification?.formattedAddress || 'My Current Location';
  // Map link for this spot; null until there is a real position to share,
  // so the share controls never hand out a generic Google Maps homepage.
  const mapsUrl =
    shareUrls?.googleMapsUrl ||
    (verification?.verifiedCoordinates
      ? `https://www.google.com/maps/search/?api=1&query=${verification.verifiedCoordinates.lat},${verification.verifiedCoordinates.lng}`
      : null);

  // Show "Send to Telegram" only when this account has linked chats.
  useEffect(() => {
    if (!auth.currentUser) return;
    let cancelled = false;
    authFetch('/api/alerts/telegram/chats')
      .then((r) => (r.ok ? r.json() : { chats: [] }))
      .then((d) => !cancelled && setTelegramChatCount(Array.isArray(d.chats) ? d.chats.length : 0))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSendTelegram = async () => {
    if (telegramState === 'sending') return;
    setTelegramState('sending');
    setSendError(null);
    try {
      const res = await authFetch('/api/notify/telegram-pin', {
        method: 'POST',
        body: JSON.stringify({
          address: verification?.formattedAddress || address,
          lat: verification?.verifiedCoordinates?.lat,
          lng: verification?.verifiedCoordinates?.lng,
          driverHint: verification?.pickupInstructionsForDriver,
        }),
      });
      if (!res.ok) throw new Error(await responseError(res, t('share.telegramFailed', lang)));
      setTelegramState('sent');
      setTimeout(() => setTelegramState('idle'), 4500);
    } catch (err: any) {
      setSendError(err.message);
      setTelegramState('idle');
    }
  };

  const handleCopyLink = () => {
    if (!mapsUrl) return;
    // Only claim "Copied" once the clipboard write actually succeeded.
    navigator.clipboard
      ?.writeText(
        `Pickup Location for Senior: ${address}\nNavigation Link: ${mapsUrl}\nInstructions: ${verification?.pickupInstructionsForDriver || 'Please pickup here'}`
      )
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      })
      .catch((e) => console.warn('Copy to clipboard failed:', e));
  };

  const handleNativeShare = async () => {
    if (!mapsUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'SafeSpot.SG Live Pickup Location',
          text: `I need a pickup at: ${address}. Driver instructions: ${verification?.pickupInstructionsForDriver || ''}`,
          url: mapsUrl,
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
    setSendError(null);

    try {
      const blePrecision = verification?.bleAccuracyBoost && verification?.bleBeacons?.[0]
        ? `${verification.bleBeacons[0].locationName} (≈${verification.bleBeacons[0].estimatedDistanceMeters}m)`
        : undefined;

      const res = await authFetch('/api/notify/dispatch-pin', {
        method: 'POST',
        body: JSON.stringify({
          contactId: contact.id,
          contactName: contact.name,
          phone: contact.phone,
          address: verification?.formattedAddress || address,
          googleMapsUrl: mapsUrl || 'https://www.google.com/maps',
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
      } else {
        setSendError(await responseError(res, t('share.smsFailed', lang)));
      }
    } catch (err) {
      console.warn('Direct pin dispatch error:', err);
      setSendError(t('share.smsFailed', lang));
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
          <div className="icon-tile" aria-hidden="true">
            <HeartHandshake className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-2xl leading-none font-bold tracking-tight">
              {t('share.title', lang)}
            </h2>
            <p className="text-ink-soft mt-1 text-sm font-normal sm:text-base">
              {t('share.subtitle', lang)}
            </p>
          </div>
        </div>

        {/* Full-width, evenly sized buttons on a phone; inline from sm up. */}
        <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <button
            id="btn-alert-family-live-track"
            type="button"
            onClick={onAlertFamily}
            disabled={isAlertingFamily}
            aria-busy={isAlertingFamily}
            className="btn btn-md btn-danger"
          >
            {isAlertingFamily ? (
              <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
            ) : (
              <Radio aria-hidden="true" className="h-5 w-5" />
            )}
            <span>{t('share.alertFamily', lang)}</span>
          </button>

          <button
            id="btn-preview-caregiver-view"
            type="button"
            onClick={onOpenCaregiverPreview}
            className="btn btn-md btn-secondary"
          >
            <Car aria-hidden="true" className="text-pine h-5 w-5" />
            <span>{t('share.driverScreen', lang)}</span>
          </button>

          <button
            id="btn-manage-contacts"
            type="button"
            onClick={onOpenManageContacts}
            className="btn btn-md btn-secondary"
          >
            <UserPlus aria-hidden="true" className="text-ink-soft h-5 w-5" />
            <span>{t('share.editContacts', lang)}</span>
          </button>
        </div>
      </div>

      {/* Instant Confirmation Feedback Banner */}
      {/* Always mounted so screen readers announce the confirmation. */}
      <div role="status" aria-live="polite">
        {lastSentTo && (
          <div className="border-pine/50 bg-pine-soft text-pine-deep animate-in mb-4 flex items-center justify-center gap-2 rounded-2xl border p-4 text-base font-bold sm:text-lg">
            <Check aria-hidden="true" className="text-pine h-6 w-6 shrink-0 stroke-[3]" />
            <span>{t('share.pinSentToBanner', lang)} {lastSentTo}!</span>
          </div>
        )}
      </div>

      {sendError && (
        <div role="alert" className="border-brick/40 bg-brick-soft text-brick-deep mb-4 flex items-start gap-2 rounded-2xl border p-4 text-base font-bold">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{sendError}</span>
        </div>
      )}

      {telegramChatCount > 0 && (
        <button
          id="btn-send-telegram"
          type="button"
          onClick={handleSendTelegram}
          disabled={telegramState !== 'idle'}
          aria-busy={telegramState === 'sending'}
          className="btn btn-md btn-secondary mb-4 w-full"
        >
          {telegramState === 'sending' ? (
            <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
          ) : telegramState === 'sent' ? (
            <Check aria-hidden="true" className="text-pine h-5 w-5" />
          ) : (
            <Send aria-hidden="true" className="text-sky h-5 w-5" />
          )}
          <span>
            {telegramState === 'sent'
              ? t('share.telegramSent', lang)
              : `${t('share.sendTelegram', lang)} (${telegramChatCount})`}
          </span>
        </button>
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
                  <div
                    aria-hidden="true"
                    className="border-line bg-surface flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border text-3xl shadow-xs"
                  >
                    {contact.emoji}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-ink text-lg leading-tight font-bold break-words sm:text-xl">
                        {contact.name}
                      </span>
                      {contact.isPrimary && !contact.locked && (
                        <span className="chip border-pine/60 bg-pine-soft text-pine-deep text-xs font-bold py-0.5 px-2 shrink-0">
                          <Star aria-hidden="true" className="h-3 w-3 fill-pine text-pine" />
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
                  type="button"
                  onClick={() => handleDirectSendPin(contact)}
                  disabled={isSending || isSent}
                  aria-busy={isSending}
                  className={`btn btn-lg ${isSent ? 'bg-pine-deep text-on-pine disabled:opacity-100' : 'btn-primary'}`}
                >
                  {isSending ? (
                    <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
                  ) : isSent ? (
                    <Check aria-hidden="true" className="h-5 w-5 stroke-[3]" />
                  ) : (
                    <Send aria-hidden="true" className="h-5 w-5" />
                  )}
                  <span>{isSending ? t('share.sending', lang) : isSent ? t('share.pinSent', lang) : t('share.sendPin', lang)}</span>
                  {/* Visible label stays short; the name tells screen readers which card. */}
                  <span className="sr-only">: {contact.name}</span>
                </button>

                <button
                  id={`btn-call-${contact.id}`}
                  type="button"
                  onClick={() => handleCallContact(contact)}
                  className="btn btn-lg btn-secondary"
                >
                  <Phone aria-hidden="true" className="text-ink-soft h-5 w-5" />
                  <span>{t('share.call', lang)}</span>
                  <span className="sr-only">: {contact.name}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Universal Quick Action Row */}
      <div className="border-line mt-5 grid grid-cols-1 gap-2.5 border-t pt-4 sm:grid-cols-3">
        {mapsUrl ? (
          <a
            id="btn-open-google-maps-navigation"
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-md btn-secondary"
          >
            <Navigation aria-hidden="true" className="text-sky h-5 w-5" />
            <span>{t('share.openMaps', lang)}</span>
            <ExternalLink aria-hidden="true" className="h-4 w-4 opacity-60" />
          </a>
        ) : (
          <button id="btn-open-google-maps-navigation" type="button" disabled className="btn btn-md btn-secondary">
            <Navigation aria-hidden="true" className="text-sky h-5 w-5" />
            <span>{t('share.openMaps', lang)}</span>
          </button>
        )}

        <button
          id="btn-copy-share-pin-link"
          type="button"
          onClick={handleCopyLink}
          disabled={!mapsUrl}
          className="btn btn-md btn-secondary"
        >
          {copied ? (
            <Check aria-hidden="true" className="text-pine h-5 w-5" />
          ) : (
            <Copy aria-hidden="true" className="text-ink-soft h-5 w-5" />
          )}
          <span role="status">{copied ? t('share.copied', lang) : t('share.copyLink', lang)}</span>
        </button>

        <button
          id="btn-universal-share-sheet"
          type="button"
          onClick={handleNativeShare}
          disabled={!mapsUrl}
          className="btn btn-md btn-secondary"
        >
          <Share2 aria-hidden="true" className="text-sky h-5 w-5" />
          <span>{t('share.shareToAnyApp', lang)}</span>
        </button>
      </div>
      {!mapsUrl && (
        <p className="text-ink-soft mt-2 text-sm font-semibold">{t('share.waitingForLocation', lang)}</p>
      )}
    </section>
  );
};
