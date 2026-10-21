/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Camera,
  Lock,
  Plus,
  Trash2,
  UserRound,
  BookUser,
  Star,
  Hospital,
  Briefcase,
} from 'lucide-react';
import {
  AccessibilitySettings,
  BloodType,
  EmergencyContact,
  SavedPlace,
  SavedPlaceKind,
} from '../types';
import { AppLogo } from './AppLogo';
import { AddressAutocompleteInput } from './AddressAutocompleteInput';
import { EMERGENCY_995_CONTACT, ensureEmergency995 } from '../data/defaultContacts';
import { importContactsFromPhone, isContactPickerSupported, createManualContact, getPreferredContact, setPreferredContact } from '../utils/contacts';
import { SAVED_PLACE_KINDS, SAVED_PLACE_META } from '../utils/places';
import { t } from '../locales/translations';

const BLOOD_TYPES: BloodType[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'];

export interface OnboardingResult {
  actualName: string;
  phone: string;
  dob: string;
  bloodType: BloodType;
  selfiePhotoUrl?: string;
  savedPlaces: SavedPlace[];
  contacts: EmergencyContact[];
}

interface OnboardingWizardProps {
  settings: AccessibilitySettings;
  existingContacts: EmergencyContact[];
  onComplete: (result: OnboardingResult) => void;
  onSkip: () => void;
}

type Step = 'welcome' | 'profile' | 'places' | 'contacts';

const STEP_ORDER: Step[] = ['welcome', 'profile', 'places', 'contacts'];

/**
 * First-launch setup. A senior in distress should never be entering their
 * blood type or a daughter's phone number, so everything the emergency flow
 * needs is collected once, up front, before the app is usable.
 */
export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  settings,
  existingContacts,
  onComplete,
  onSkip,
}) => {
  const lang = settings.language || 'en';

  const [step, setStep] = useState<Step>('welcome');
  const [actualName, setActualName] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [bloodType, setBloodType] = useState<BloodType>('Unknown');
  const [selfiePhotoUrl, setSelfiePhotoUrl] = useState<string | undefined>();
  const [places, setPlaces] = useState<Record<SavedPlaceKind, string>>({
    home: '',
    work: '',
    healthcare: '',
  });
  const [providerType, setProviderType] = useState<'public' | 'private'>('public');

  // 995 is seeded from the start so the list is never empty of help.
  const [contacts, setContacts] = useState<EmergencyContact[]>(() =>
    ensureEmergency995(existingContacts)
  );
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [importNote, setImportNote] = useState<string | null>(null);

  // Live selfie capture only — gallery uploads are deliberately absent so the
  // photo responders see is always authentic and current.
  const [isSelfieCameraOn, setIsSelfieCameraOn] = useState(false);
  const [cameraUnavailable, setCameraUnavailable] = useState(false);
  const selfieVideoRef = useRef<HTMLVideoElement | null>(null);
  const selfieStreamRef = useRef<MediaStream | null>(null);

  const stepIndex = STEP_ORDER.indexOf(step);
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);

  // Each step swaps the whole page: start it at the top and move focus to its
  // heading so screen-reader and keyboard users land on the new step.
  useEffect(() => {
    if (step === 'welcome') return;
    window.scrollTo({ top: 0 });
    stepHeadingRef.current?.focus();
  }, [step]);

  const goNext = () => {
    const next = STEP_ORDER[stepIndex + 1];
    if (next) setStep(next);
  };

  const goBack = () => {
    const prev = STEP_ORDER[stepIndex - 1];
    if (prev) setStep(prev);
  };

  const stopSelfieCamera = () => {
    selfieStreamRef.current?.getTracks().forEach((track) => track.stop());
    selfieStreamRef.current = null;
    setIsSelfieCameraOn(false);
  };

  const startSelfieCamera = async () => {
    try {
      setCameraUnavailable(false);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
        audio: false,
      });
      selfieStreamRef.current = stream;
      setIsSelfieCameraOn(true);
    } catch (err) {
      console.warn('Selfie camera unavailable:', err);
      setIsSelfieCameraOn(false);
      setCameraUnavailable(true);
    }
  };

  // Attach the stream once the <video> tile is mounted.
  useEffect(() => {
    if (isSelfieCameraOn && selfieVideoRef.current && selfieStreamRef.current) {
      selfieVideoRef.current.srcObject = selfieStreamRef.current;
      void selfieVideoRef.current.play().catch(() => {});
    }
  }, [isSelfieCameraOn]);

  // Release the camera when the wizard unmounts.
  useEffect(() => stopSelfieCamera, []);

  // Leaving the profile step unmounts the <video>; release the camera so the
  // tile is not left showing a dead "camera on" state when the user returns.
  useEffect(() => {
    if (step !== 'profile' && selfieStreamRef.current) stopSelfieCamera();
  }, [step]);

  const captureSelfie = () => {
    const video = selfieVideoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const vWidth = video.videoWidth || 400;
    const vHeight = video.videoHeight || 400;
    const minDim = Math.min(vWidth, vHeight);
    ctx.drawImage(video, (vWidth - minDim) / 2, (vHeight - minDim) / 2, minDim, minDim, 0, 0, 400, 400);
    setSelfiePhotoUrl(canvas.toDataURL('image/jpeg', 0.85));
    stopSelfieCamera();
  };
  const handleImportContacts = async () => {
    const result = await importContactsFromPhone(contacts);

    if (result.error) {
      setImportNote(result.error);
      return;
    }

    if (result.imported.length === 0) {
      setImportNote(
        result.duplicates > 0 ? t('onboard.importAllDuplicates', lang) : t('onboard.importNoneChosen', lang)
      );
      return;
    }

    setContacts((prev) => ensureEmergency995([...prev, ...result.imported]));
    setImportNote(
      t('onboard.importAdded', lang).replace('{n}', String(result.imported.length)) +
        (result.duplicates > 0
          ? ' ' + t('onboard.importSkipped', lang).replace('{n}', String(result.duplicates))
          : '')
    );
  };

  const handleAddManualContact = () => {
    if (!newName.trim() || !newPhone.trim()) return;
    const contact = createManualContact(newName, newPhone, contacts.length);
    setContacts((prev) => ensureEmergency995([...prev, contact]));
    setNewName('');
    setNewPhone('');
    setImportNote(null);
  };

  const handleRemoveContact = (id: string) => {
    // Locked entries (995) are filtered back in by ensureEmergency995 anyway,
    // but the button is not offered for them in the first place.
    setContacts((prev) => ensureEmergency995(prev.filter((c) => c.id !== id)));
  };

  const handleFinish = () => {
    const savedPlaces: SavedPlace[] = SAVED_PLACE_KINDS.filter((kind) => places[kind].trim()).map(
      (kind) => ({
        kind,
        address: places[kind].trim(),
        ...(kind === 'healthcare' ? { providerType } : {}),
      })
    );

    onComplete({
      actualName: actualName.trim(),
      phone: phone.trim(),
      dob: dob.trim(),
      bloodType,
      selfiePhotoUrl,
      savedPlaces,
      contacts: ensureEmergency995(contacts),
    });
  };

  return (
    <div className="bg-bg text-ink flex min-h-dvh flex-col">
      {/* Progress Header — only shown on steps 2-4, padded safely below iOS/Android status bar */}
      {step !== 'welcome' && (
        <header className="border-line bg-surface/95 sticky top-0 z-10 border-b px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] backdrop-blur-md sm:px-6">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <button
              type="button"
              onClick={goBack}
              className="btn accessible-tap text-ink-soft hover:bg-well hover:text-ink -ml-2 shrink-0"
              aria-label={t('onboard.back', lang)}
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="min-w-0 flex-1">
              <div className="text-ink-soft mb-1.5 flex items-center justify-between gap-2 text-sm font-bold">
                <span className="truncate">
                  {step === 'profile' ? t('onboard.stepProfile', lang) : step === 'places' ? t('onboard.stepPlaces', lang) : t('onboard.stepContacts', lang)}
                </span>
                <span className="shrink-0">{stepIndex} / {STEP_ORDER.length - 1}</span>
              </div>
              <div
                className="bg-well h-1.5 overflow-hidden rounded-full"
                role="progressbar"
                aria-label={t('onboard.progress', lang)}
                aria-valuemin={0}
                aria-valuemax={STEP_ORDER.length - 1}
                aria-valuenow={stepIndex}
              >
                <div
                  className="bg-pine h-full rounded-full transition-all duration-300"
                  style={{ width: `${(stepIndex / (STEP_ORDER.length - 1)) * 100}%` }}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={onSkip}
              className="btn btn-sm text-ink-soft hover:bg-well hover:text-ink -mr-2 min-h-12 shrink-0"
            >
              {t('onboard.skip', lang)}
            </button>
          </div>
        </header>
      )}

      <main className={`mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6 sm:py-8 ${step === 'welcome' ? 'pt-[calc(env(safe-area-inset-top,0px)+2.5rem)] flex flex-col justify-center' : ''}`}>
        {step === 'welcome' && (
          <div className="flex flex-col items-center gap-6 py-6 text-center">
            <AppLogo size={96} />
            <div className="space-y-2">
              <h1 className="font-display text-3xl sm:text-5xl font-black tracking-tight text-ink">
                {t('onboard.welcomeTitle', lang)}
              </h1>
              <p className="text-ink-soft max-w-md text-base sm:text-lg leading-relaxed mx-auto">
                {t('onboard.welcomeBody', lang)}
              </p>
            </div>
            <div className="w-full max-w-xs space-y-3 pt-2">
              <button type="button" onClick={goNext} className="btn btn-lg btn-primary w-full">
                {t('onboard.start', lang)}
                <ArrowRight className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={onSkip}
                className="btn btn-md text-ink-soft hover:bg-well hover:text-ink w-full"
              >
                {t('onboard.skip', lang)}
              </button>
            </div>
          </div>
        )}

        {step === 'profile' && (
          <div className="space-y-5">
            <div>
              <h2
                ref={stepHeadingRef}
                tabIndex={-1}
                className="font-display text-2xl font-bold tracking-tight focus:outline-none"
              >
                {t('onboard.stepProfile', lang)}
              </h2>
              <p className="text-ink-soft mt-1 text-sm sm:text-base">
                {t('onboard.profileIntro', lang)}
              </p>
            </div>

            {/* Photo — live capture only; no gallery upload so the photo a
                responder sees is always authentic and current. */}
            <div className="flex items-center gap-4">
              <div className="border-line bg-well relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-2">
                {isSelfieCameraOn ? (
                  <video
                    ref={selfieVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                  />
                ) : selfiePhotoUrl ? (
                  <img src={selfiePhotoUrl} alt={t('onboard.photoAlt', lang)} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-ink-faint flex h-full w-full items-center justify-center">
                    <Camera className="h-7 w-7" aria-hidden="true" />
                  </span>
                )}
              </div>
              <div className="min-w-0 space-y-1.5">
                <div className="text-base font-bold">{t('onboard.photo', lang)}</div>
                <p className="text-ink-soft text-sm">{t('onboard.photoWhy', lang)}</p>
                <div className="flex flex-wrap gap-2">
                  {isSelfieCameraOn ? (
                    <>
                      <button type="button" onClick={captureSelfie} className="btn btn-md btn-primary">
                        <Camera className="h-4 w-4" />
                        {t('onboard.takeSelfie', lang)}
                      </button>
                      <button type="button" onClick={stopSelfieCamera} className="btn btn-md btn-secondary">
                        {t('onboard.cancelCamera', lang)}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void startSelfieCamera()}
                      className="btn btn-md btn-primary"
                    >
                      <Camera className="h-4 w-4" />
                      {selfiePhotoUrl ? t('onboard.retakeSelfie', lang) : t('onboard.takeSelfie', lang)}
                    </button>
                  )}
                </div>
                {cameraUnavailable && (
                  <p role="status" className="text-ochre-deep text-sm font-semibold">
                    {t('onboard.cameraUnavailable', lang)}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="onboard-name">
                {t('onboard.name', lang)}
              </label>
              <input
                id="onboard-name"
                className="input"
                value={actualName}
                onChange={(e) => setActualName(e.target.value)}
                placeholder="Tan Ah Kow"
                autoComplete="name"
              />
            </div>

            <div>
              <label className="label" htmlFor="onboard-phone">
                {t('onboard.phone', lang)}
              </label>
              <input
                id="onboard-phone"
                className="input"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="9123 4567"
                autoComplete="tel"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="onboard-dob">
                  {t('onboard.dob', lang)}
                </label>
                <input
                  id="onboard-dob"
                  className="input"
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="onboard-blood">
                  {t('onboard.bloodType', lang)}
                </label>
                <select
                  id="onboard-blood"
                  className="input"
                  value={bloodType}
                  onChange={(e) => setBloodType(e.target.value as BloodType)}
                >
                  {BLOOD_TYPES.map((bt) => (
                    <option key={bt} value={bt}>
                      {bt}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {step === 'places' && (
          <div className="space-y-5">
            <div>
              <h2
                ref={stepHeadingRef}
                tabIndex={-1}
                className="font-display text-2xl font-bold tracking-tight focus:outline-none"
              >
                {t('onboard.stepPlaces', lang)}
              </h2>
              <p className="text-ink-soft mt-1 text-sm sm:text-base">
                {t('onboard.placesIntro', lang)}
              </p>
            </div>

            <div className="space-y-4">
              {SAVED_PLACE_KINDS.map((kind) => (
                <div key={kind} className="space-y-1.5">
                  <AddressAutocompleteInput
                    id={`onboard-place-${kind}`}
                    value={places[kind]}
                    category={kind}
                    label={SAVED_PLACE_META[kind].title}
                    lang={lang}
                    placeholder={
                      kind === 'home'
                        ? 'e.g. 356 Yishun Ring Rd or S760356'
                        : kind === 'work'
                        ? 'e.g. BLOCK71, 71 Ayer Rajah Crescent'
                        : 'e.g. Tan Tock Seng Hospital or Yishun Polyclinic'
                    }
                    onChange={(addr, suggestion) => {
                      setPlaces((prev) => ({ ...prev, [kind]: addr }));
                      if (kind === 'healthcare' && suggestion?.providerType) {
                        setProviderType(suggestion.providerType);
                      }
                    }}
                  />

                  {/* Quick-pick recommendations for Healthcare */}
                  {kind === 'healthcare' && !places.healthcare && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-ink-soft mr-1 text-sm font-semibold">{t('onboard.popular', lang)}</span>
                      {[
                        { name: 'SGH', full: 'Outram Rd, Singapore 169608', type: 'public' },
                        { name: 'TTSH', full: '11 Jalan Tan Tock Seng, Singapore 308433', type: 'public' },
                        { name: 'NUH', full: '5 Lower Kent Ridge Rd, Singapore 119074', type: 'public' },
                        { name: 'KTPH', full: '90 Yishun Central, Singapore 768828', type: 'public' },
                        { name: 'Mt Elizabeth', full: '3 Mount Elizabeth, Singapore 228510', type: 'private' },
                      ].map((item) => (
                        <button
                          key={item.name}
                          type="button"
                          onClick={() => {
                            setPlaces((prev) => ({ ...prev, healthcare: item.full }));
                            setProviderType(item.type as 'public' | 'private');
                          }}
                          className="chip border-line bg-well hover:bg-pine-soft hover:text-pine-deep text-ink min-h-11 px-3.5 text-sm"
                        >
                          <Hospital className="h-4 w-4" aria-hidden="true" />
                          {item.name}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Quick-pick recommendations for Work */}
                  {kind === 'work' && !places.work && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-ink-soft mr-1 text-sm font-semibold">{t('onboard.popular', lang)}</span>
                      {[
                        { name: 'BLOCK71', full: '71 Ayer Rajah Crescent, Singapore 139951' },
                        { name: 'LaunchPad', full: 'LaunchPad @ one-north, Singapore 139951' },
                        { name: 'MBFC', full: '10 Marina Blvd, Singapore 018983' },
                        { name: 'Suntec City', full: '7 Temasek Blvd, Singapore 038987' },
                      ].map((item) => (
                        <button
                          key={item.name}
                          type="button"
                          onClick={() => setPlaces((prev) => ({ ...prev, work: item.full }))}
                          className="chip border-line bg-well hover:bg-pine-soft hover:text-pine-deep text-ink min-h-11 px-3.5 text-sm"
                        >
                          <Briefcase className="h-4 w-4" aria-hidden="true" />
                          {item.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div>
              <span className="label" id="onboard-provider-label">
                {t('onboard.providerType', lang)}
              </span>
              <div className="flex gap-2" role="group" aria-labelledby="onboard-provider-label">
                {(['public', 'private'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setProviderType(type)}
                    aria-pressed={providerType === type}
                    className={`btn btn-md flex-1 ${
                      providerType === type ? 'btn-primary' : 'btn-secondary'
                    }`}
                  >
                    {providerType === type && <Check className="h-4 w-4" aria-hidden="true" />}
                    {t(type === 'public' ? 'onboard.providerPublic' : 'onboard.providerPrivate', lang)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 'contacts' && (
          <div className="space-y-5">
            <div>
              <h2
                ref={stepHeadingRef}
                tabIndex={-1}
                className="font-display text-2xl font-bold tracking-tight focus:outline-none"
              >
                {t('onboard.stepContacts', lang)}
              </h2>
              <p className="text-ink-soft mt-1 text-sm sm:text-base">
                {t('onboard.emergencyLocked', lang)}
              </p>
            </div>

            {/* Preferred Contact Explanation Banner */}
            <div className="border-pine/30 bg-pine-soft text-pine-deep flex items-start gap-3 rounded-xl border p-4 text-sm">
              <Star className="fill-pine text-pine mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p>
                <span className="font-bold">{t('onboard.preferredTitle', lang)} </span>
                {t('onboard.preferredBody', lang).replace('{button}', `“${t('hero.pickMeUp', lang)}”`)}
              </p>
            </div>

            {/* Import from the phone's address book where the browser allows it */}
            {isContactPickerSupported() && (
              <button type="button" onClick={handleImportContacts} className="btn btn-lg btn-secondary w-full">
                <BookUser className="h-5 w-5" aria-hidden="true" />
                {t('onboard.importContacts', lang)}
              </button>
            )}

            {importNote && (
              <p role="status" className="text-ink-soft text-sm font-semibold">
                {importNote}
              </p>
            )}

            {/* Current list */}
            <ul className="space-y-2">
              {contacts.map((c) => (
                <li
                  key={c.id}
                  className={`flex items-center gap-3 rounded-xl border p-3.5 transition-all ${
                    c.isPrimary && !c.locked
                      ? 'border-pine bg-pine-soft/40 shadow-sm'
                      : 'border-line bg-well/50'
                  }`}
                >
                  <span className="text-2xl" aria-hidden="true">
                    {c.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-base font-bold text-ink">{c.name}</span>
                      {c.isPrimary && !c.locked && (
                        <span className="chip border-pine/50 bg-pine-soft text-pine-deep shrink-0 px-2 py-0.5">
                          <Star className="fill-pine text-pine h-3 w-3" aria-hidden="true" />
                          {t('onboard.preferred', lang)}
                        </span>
                      )}
                    </div>
                    <div className="text-ink-soft truncate text-sm">
                      {c.relationship} · {c.phone}
                    </div>
                  </div>

                  {c.locked ? (
                    <span
                      className="text-ink-soft flex h-11 w-11 shrink-0 items-center justify-center"
                      title={t('onboard.emergencyLocked', lang)}
                    >
                      <Lock className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">{t('onboard.emergencyLocked', lang)}</span>
                    </span>
                  ) : (
                    <div className="flex shrink-0 items-center gap-2">
                      {!c.isPrimary ? (
                        <button
                          type="button"
                          onClick={() => setContacts(prev => setPreferredContact(prev, c.id))}
                          className="btn btn-sm btn-secondary min-h-11 min-w-11 px-2.5 sm:px-3"
                          title={t('onboard.setPreferredHint', lang)}
                          aria-label={`${t('onboard.setPreferred', lang)}: ${c.name}`}
                        >
                          <Star className="h-4 w-4" aria-hidden="true" />
                          <span className="hidden sm:inline">{t('onboard.setPreferred', lang)}</span>
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => handleRemoveContact(c.id)}
                        className="btn text-brick hover:bg-brick-soft h-11 w-11"
                        aria-label={`${t('onboard.removeContact', lang)}: ${c.name}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {/* Manual fallback, always available */}
            <div className="border-line space-y-4 rounded-xl border border-dashed p-4">
              <h3 className="text-ink-soft font-body flex items-center gap-2 text-sm font-bold">
                <UserRound className="h-4 w-4" aria-hidden="true" />
                {t('onboard.addManually', lang)}
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="onboard-contact-name">
                    {t('onboard.contactName', lang)}
                  </label>
                  <input
                    id="onboard-contact-name"
                    className="input"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="onboard-contact-phone">
                    {t('onboard.contactPhone', lang)}
                  </label>
                  <input
                    id="onboard-contact-phone"
                    className="input"
                    type="tel"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="9123 4567"
                    autoComplete="off"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleAddManualContact}
                disabled={!newName.trim() || !newPhone.trim()}
                className="btn btn-md btn-secondary w-full"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t('onboard.addContact', lang)}
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Navigation */}
      {step !== 'welcome' && (
        <footer className="border-line bg-surface/95 sticky bottom-0 border-t px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] backdrop-blur-md sm:px-6">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <button
              type="button"
              onClick={goBack}
              className="btn btn-lg btn-secondary shrink-0"
              aria-label={t('onboard.back', lang)}
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              <span className="hidden sm:inline">{t('onboard.back', lang)}</span>
            </button>

            {step === 'contacts' ? (
              <button type="button" onClick={handleFinish} className="btn btn-lg btn-primary flex-1">
                <Check className="h-5 w-5" />
                {t('onboard.finish', lang)}
              </button>
            ) : (
              <button type="button" onClick={goNext} className="btn btn-lg btn-primary flex-1">
                {t('onboard.next', lang)}
                <ArrowRight className="h-5 w-5" />
              </button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
};

export { EMERGENCY_995_CONTACT };
