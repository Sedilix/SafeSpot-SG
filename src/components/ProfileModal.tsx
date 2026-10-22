/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  User, 
  Camera, 
  Heart, 
  Calendar,
  Users, 
  ShieldCheck, 
  Check, 
  RefreshCw, 
  LogOut, 
  AlertCircle,
  FileText,
  Watch,
  Radio,
  Unlink,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';
import { UserProfile, BloodType, EmergencyContact, AccessibilitySettings } from '../types';
import { AddressAutocompleteInput } from './AddressAutocompleteInput';
import { saveUserProfile, signOutUser, clearWearableDeviceId } from '../lib/firebase';
import { User as FirebaseUser } from 'firebase/auth';
import { t } from '../locales/translations';
import { AlertChannelsPanel } from './AlertChannelsPanel';
import { normalizeWatchDeviceId, isValidWatchDeviceId } from '../utils/watchDeviceId';
import { useEscapeToClose } from '../utils/useEscapeToClose';

/**
 * Calls a wearable pairing endpoint as the signed-in user. The server takes
 * the owner from the ID token, so no uid is sent. Throws with the server's
 * message on failure (e.g. the watch is paired to another account).
 */
async function wearablePairingRequest(user: FirebaseUser, url: string, body: object): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
}

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: FirebaseUser | null;
  profile: UserProfile | null;
  onProfileUpdated: (updated: UserProfile) => void;
  contacts: EmergencyContact[];
  onOpenManageContacts: () => void;
  settings: AccessibilitySettings;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  user,
  profile,
  onProfileUpdated,
  contacts,
  onOpenManageContacts,
  settings,
}) => {
  // Form State
  const [actualName, setActualName] = useState('');
  const [dob, setDob] = useState('');
  // 'Unknown' until the user picks one: a guessed blood type would reach paramedics as fact.
  const [bloodType, setBloodType] = useState<BloodType>('Unknown');
  const [address, setAddress] = useState('');
  const [medicalNotes, setMedicalNotes] = useState('');
  const [selfiePhotoUrl, setSelfiePhotoUrl] = useState<string | undefined>(undefined);

  // Camera State
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const noticeRef = useRef<HTMLDivElement | null>(null);

  // Saving State
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Watch State
  const [pairedDeviceId, setPairedDeviceId] = useState('');
  const [inputDeviceId, setInputDeviceId] = useState('');
  const [isPairingWatch, setIsPairingWatch] = useState(false);
  const [watchFeedback, setWatchFeedback] = useState<string | null>(null);
  const [watchStatus, setWatchStatus] = useState<{
    online: boolean;
    battery?: number;
    heartRate?: number;
  } | null>(null);

  useEffect(() => {
    if (profile) {
      setActualName(profile.actualName || '');
      setDob(profile.dob || '');
      setBloodType(profile.bloodType || 'Unknown');
      setAddress(profile.address || '');
      setMedicalNotes(profile.medicalNotes || '');
      setSelfiePhotoUrl(profile.selfiePhotoUrl);
      setPairedDeviceId(profile.wearableDeviceId || '');
      if (profile.wearableDeviceId) {
        setInputDeviceId(profile.wearableDeviceId);
      }
    } else if (user) {
      setActualName(user.displayName || '');
    }
  }, [profile, user, isOpen]);

  // Poll status of paired watch when modal is open
  useEffect(() => {
    if (!isOpen || !pairedDeviceId) {
      setWatchStatus(null);
      return;
    }

    let active = true;
    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/wearable/status?deviceId=${encodeURIComponent(pairedDeviceId)}`);
        if (!res.ok) return;
        const data = await res.json();
        const dev = data.devices?.[0];
        if (active && dev) {
          setWatchStatus({
            online: Boolean(dev.online),
            battery: dev.battery,
            heartRate: dev.heartRate,
          });
        }
      } catch {
        // silent network error in modal
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isOpen, pairedDeviceId]);

  // Clean up camera on unmount or close
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setIsSaving(false);
      setSaveSuccess(false);
      setErrorMessage(null);
    }
    return () => {
      // Ensure camera stream is released on unmount even if isOpen stays true
      stopCamera();
    };
  }, [isOpen]);

  const startCamera = async () => {
    try {
      setIsCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err) {
      console.warn('Cannot open user selfie camera:', err);
      setIsCameraActive(false);
      setErrorMessage(t('profile.cameraUnavailable', settings.language));
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const captureSelfie = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Draw square crop centered
      const vWidth = videoRef.current.videoWidth || 400;
      const vHeight = videoRef.current.videoHeight || 400;
      const minDim = Math.min(vWidth, vHeight);
      const startX = (vWidth - minDim) / 2;
      const startY = (vHeight - minDim) / 2;

      ctx.drawImage(videoRef.current, startX, startY, minDim, minDim, 0, 0, 400, 400);
      const base64 = canvas.toDataURL('image/jpeg', 0.85);
      setSelfiePhotoUrl(base64);
      stopCamera();
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setErrorMessage(t('profile.signInRequired', settings.language));
      return;
    }

    if (!actualName.trim()) {
      setErrorMessage(t('profile.nameRequired', settings.language));
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const updatedProfile: UserProfile = {
        uid: user.uid,
        actualName: actualName.trim(),
        dob: dob.trim(),
        bloodType,
        address: address.trim(),
        selfiePhotoUrl,
        emergencyContacts: contacts,
        phone: user.phoneNumber || profile?.phone,
        email: user.email || profile?.email,
        authProvider: user.isAnonymous ? 'anonymous' : (user.providerData[0]?.providerId?.includes('google') ? 'google' : 'phone'),
        medicalNotes: medicalNotes.trim(),
        wearableDeviceId: pairedDeviceId.trim() || undefined,
        createdAt: profile?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };

      await saveUserProfile(updatedProfile);
      onProfileUpdated(updatedProfile);
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 1500);
    } catch (err: any) {
      console.error('Failed to save profile:', err);
      setErrorMessage(err.message || t('profile.saveFailed', settings.language));
    } finally {
      setIsSaving(false);
    }
  };

  const handlePairWatch = async () => {
    const id = normalizeWatchDeviceId(inputDeviceId);
    if (!isValidWatchDeviceId(id) || !user) return;
    setIsPairingWatch(true);
    setWatchFeedback(null);
    setErrorMessage(null);
    try {
      await wearablePairingRequest(user, '/api/wearable/pair', {
        deviceId: id,
        elderName: actualName.trim() || user.displayName || 'Senior',
        bloodType,
        medicalNotes: medicalNotes.trim(),
        emergencyContacts: contacts,
      });

      setPairedDeviceId(id);
      const updatedProfile: UserProfile = {
        uid: user.uid,
        actualName: actualName.trim() || user.displayName || 'Senior',
        dob: dob.trim(),
        bloodType,
        address: address.trim(),
        selfiePhotoUrl,
        emergencyContacts: contacts,
        phone: user.phoneNumber || profile?.phone,
        email: user.email || profile?.email,
        authProvider: user.isAnonymous ? 'anonymous' : (user.providerData[0]?.providerId?.includes('google') ? 'google' : 'phone'),
        medicalNotes: medicalNotes.trim(),
        wearableDeviceId: id,
        createdAt: profile?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      await saveUserProfile(updatedProfile);
      onProfileUpdated(updatedProfile);
      setWatchFeedback(t('wearable.pairingSuccess', settings.language));
      setTimeout(() => setWatchFeedback(null), 3000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to pair watch.');
    } finally {
      setIsPairingWatch(false);
    }
  };

  const handleUnpairWatch = async () => {
    if (!pairedDeviceId || !user) return;
    setIsPairingWatch(true);
    setWatchFeedback(null);
    setErrorMessage(null);
    try {
      await wearablePairingRequest(user, '/api/wearable/unpair', { deviceId: pairedDeviceId });

      const updatedProfile: UserProfile = {
        uid: user.uid,
        actualName: actualName.trim() || user.displayName || 'Senior',
        dob: dob.trim(),
        bloodType,
        address: address.trim(),
        selfiePhotoUrl,
        emergencyContacts: contacts,
        phone: user.phoneNumber || profile?.phone,
        email: user.email || profile?.email,
        authProvider: user.isAnonymous ? 'anonymous' : (user.providerData[0]?.providerId?.includes('google') ? 'google' : 'phone'),
        medicalNotes: medicalNotes.trim(),
        wearableDeviceId: undefined,
        createdAt: profile?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      await saveUserProfile(updatedProfile);
      await clearWearableDeviceId(user.uid);
      onProfileUpdated(updatedProfile);
      setPairedDeviceId('');
      setWatchStatus(null);
      setWatchFeedback(t('wearable.unpairedSuccess', settings.language));
      setTimeout(() => setWatchFeedback(null), 3000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to unpair watch.');
    } finally {
      setIsPairingWatch(false);
    }
  };

  const handleSignOut = async () => {
    stopCamera();
    await signOutUser();
    onClose();
  };

  useEscapeToClose(isOpen, onClose);

  // Errors and the save confirmation render at the top of the scrolling form,
  // but Save lives in the footer: bring the message into view so it is seen.
  useEffect(() => {
    if (errorMessage || saveSuccess) {
      noticeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [errorMessage, saveSuccess]);

  if (!isOpen) return null;

  const lang = settings.language;
  const familyNames = contacts.filter((c) => !c.locked).map((c) => c.name);

  return (
    <div
      id="modal-profile-backdrop"
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-profile-title"
    >
      <div id="modal-profile-content" className="modal-panel max-w-2xl">
        {/* Header */}
        <div className="modal-head">
          <div className="flex min-w-0 items-center gap-3">
            <div className="icon-tile">
              <User className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 id="modal-profile-title" className="font-display text-2xl leading-none font-bold tracking-tight">
                {t('profile.title', lang)}
              </h2>
              <p className="text-ink-soft mt-1 text-sm sm:text-base">
                {t('profile.subtitle', lang)}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="accessible-tap text-ink-soft hover:bg-well hover:text-ink shrink-0 rounded-xl p-2 transition-colors"
            aria-label={t('common.close', lang)}
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSaveProfile} className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
          <div ref={noticeRef} className="space-y-3 empty:hidden">
            {errorMessage && (
              <div
                role="alert"
                className="border-brick/40 bg-brick-soft text-brick-deep flex items-start gap-2.5 rounded-xl border p-4 text-sm font-bold sm:text-base"
              >
                <AlertCircle className="text-brick mt-0.5 h-5 w-5 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {saveSuccess && (
              <div
                role="status"
                className="border-pine/40 bg-pine-soft text-pine-deep flex items-center gap-2.5 rounded-xl border p-4 text-base font-bold"
              >
                <Check className="text-pine h-5 w-5 shrink-0" />
                <span>{t('profile.saved', lang)}</span>
              </div>
            )}
          </div>

          {/* Section 1: Selfie Photo Capture */}
          <section aria-labelledby="profile-selfie-heading" className="border-line bg-well/60 space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Camera className="text-sky h-5 w-5 shrink-0" />
                <h3 id="profile-selfie-heading" className="font-body text-base font-bold sm:text-lg">
                  {t('profile.selfieTitle', lang)}
                </h3>
              </div>
              {selfiePhotoUrl && (
                <span className="text-pine-deep flex items-center gap-1 text-sm font-bold">
                  <ShieldCheck className="h-4 w-4" /> {t('profile.photoSaved', lang)}
                </span>
              )}
            </div>

            <p className="text-ink-soft text-sm">
              {t('profile.selfieDesc', lang)}
            </p>

            <div className="flex flex-col items-center gap-4 pt-1 sm:flex-row">
              {/* Photo Preview Circle */}
              <div className="border-line-strong bg-well relative flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 shadow-md sm:h-32 sm:w-32">
                {isCameraActive ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                  />
                ) : selfiePhotoUrl ? (
                  <img
                    src={selfiePhotoUrl}
                    alt={t('profile.photoAlt', lang)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <User className="text-ink-faint h-14 w-14" aria-hidden="true" />
                )}
              </div>

              {/* Action Buttons for Camera */}
              <div className="flex w-full flex-wrap items-center justify-center gap-2 sm:w-auto sm:justify-start">
                {isCameraActive ? (
                  <>
                    <button
                      type="button"
                      onClick={captureSelfie}
                      className="btn btn-md btn-primary"
                    >
                      <Camera className="h-5 w-5" />
                      <span>{t('profile.takePhoto', lang)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="btn btn-md btn-secondary"
                    >
                      {t('common.cancel', lang)}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={startCamera}
                    className="btn btn-md btn-primary"
                  >
                    <Camera className="h-5 w-5" />
                    <span>{selfiePhotoUrl ? t('profile.retakeSelfie', lang) : t('profile.takeSelfie', lang)}</span>
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Section 2: Personal Details (Name & DOB) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="profile-name">
                {t('profile.nameLabel', lang)} <span aria-hidden="true">*</span>
              </label>
              <div className="relative">
                <div className="text-ink-faint pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <User className="h-5 w-5" />
                </div>
                <input
                  id="profile-name"
                  type="text"
                  required
                  autoComplete="name"
                  value={actualName}
                  onChange={(e) => setActualName(e.target.value)}
                  placeholder="e.g. Tan Ah Kow / Mary Lim"
                  className="input pl-10"
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="profile-dob">{t('profile.dobLabel', lang)}</label>
              <div className="relative">
                <div className="text-ink-faint pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Calendar className="h-5 w-5" />
                </div>
                <input
                  id="profile-dob"
                  type="date"
                  autoComplete="bday"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  className="input pl-10"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Blood Type & Medical Notes */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="profile-blood">{t('profile.bloodLabel', lang)}</label>
              <div className="relative">
                <div className="text-brick pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Heart className="h-5 w-5" />
                </div>
                <select
                  id="profile-blood"
                  value={bloodType}
                  onChange={(e) => setBloodType(e.target.value as BloodType)}
                  className="input pl-10"
                >
                  {['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'Unknown'].map((bt) => (
                    <option key={bt} value={bt}>
                      {bt} {bt === 'O+' ? '(most common)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="profile-medical">{t('profile.medicalLabel', lang)}</label>
              <div className="relative">
                <div className="text-ink-faint pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <FileText className="h-5 w-5" />
                </div>
                <input
                  id="profile-medical"
                  type="text"
                  value={medicalNotes}
                  onChange={(e) => setMedicalNotes(e.target.value)}
                  placeholder="e.g. Diabetic, Penicillin allergy, Pacemaker"
                  className="input pl-10"
                />
              </div>
            </div>
          </div>

          {/* Section 4: Home Address */}
          <div>
            <AddressAutocompleteInput
              id="profile-address"
              value={address}
              category="home"
              label={t('profile.addressLabel', lang)}
              placeholder="e.g. Blk 480 Lorong 6 Toa Payoh #10-123 or S310480"
              onChange={(addr) => setAddress(addr)}
            />
          </div>

          {/* Section 5: Emergency Contacts Preview & Link */}
          <div className="border-line bg-well/60 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <Users className="text-sky h-5 w-5 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-bold sm:text-base">
                  {t('profile.contactsCount', lang).replace('{count}', String(contacts.length))}
                </div>
                <div className="text-ink-soft text-sm">
                  {familyNames.length === 0
                    ? t('profile.noFamilyContacts', lang)
                    : familyNames.slice(0, 2).join(', ') +
                      (familyNames.length > 2
                        ? ` ${t('profile.moreContacts', lang).replace('{count}', String(familyNames.length - 2))}`
                        : '')}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenManageContacts();
              }}
              className="btn btn-md btn-secondary shrink-0"
            >
              <span>{t('settings.editContacts', lang)}</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Alert channels: SMS status + Telegram chats */}
          <AlertChannelsPanel user={user} lang={lang} />

          {/* Section 6: Garmin Watch Pairing */}
          <section aria-labelledby="profile-watch-heading" className="border-line bg-well/60 space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Watch className="text-sky h-5 w-5 shrink-0" />
                <h3 id="profile-watch-heading" className="font-body text-base font-bold sm:text-lg">
                  {t('wearable.pairingTitle', lang)}
                </h3>
              </div>
              {pairedDeviceId ? (
                <span className="text-pine-deep flex items-center gap-1 text-sm font-bold">
                  <CheckCircle2 className="h-4 w-4" /> {t('wearable.pairedBadge', lang)}
                </span>
              ) : (
                <span className="text-ink-soft text-sm font-semibold">
                  {t('wearable.notPaired', lang)}
                </span>
              )}
            </div>

            <p className="text-ink-soft text-sm">
              {t('wearable.pairingDesc', lang)}
            </p>

            {pairedDeviceId ? (
              <div className="bg-surface border-line flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="bg-sky-soft text-sky flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                    <Radio className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-mono text-base font-bold break-all">{pairedDeviceId}</div>
                    <div className="text-ink-soft flex flex-wrap items-center gap-x-2 text-sm font-semibold">
                      <span
                        aria-hidden="true"
                        className={`inline-block h-2 w-2 rounded-full ${
                          watchStatus?.online ? 'bg-pine' : 'bg-ink-faint'
                        }`}
                      />
                      <span>
                        {watchStatus?.online
                          ? t('wearable.online', lang)
                          : t('wearable.offline', lang)}
                      </span>
                      {watchStatus?.battery != null && <span>• {watchStatus.battery}% battery</span>}
                      {watchStatus?.heartRate != null && <span>• {watchStatus.heartRate} bpm</span>}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleUnpairWatch}
                  disabled={isPairingWatch}
                  className="btn btn-sm btn-secondary text-brick border-brick/30 hover:text-brick-deep shrink-0"
                >
                  {isPairingWatch ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
                  <span>{t('wearable.unpairButton', lang)}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="label mb-0" htmlFor="watch-device-id">
                  {t('wearable.deviceIdLabel', lang)}
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    id="watch-device-id"
                    type="text"
                    value={inputDeviceId}
                    onChange={(e) => setInputDeviceId(normalizeWatchDeviceId(e.target.value))}
                    placeholder={t('wearable.deviceIdPlaceholder', lang)}
                    aria-describedby="watch-device-id-hint"
                    className="input min-w-0 flex-1 font-mono uppercase"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={17}
                  />
                  <button
                    type="button"
                    onClick={handlePairWatch}
                    disabled={isPairingWatch || !isValidWatchDeviceId(inputDeviceId)}
                    className="btn btn-md btn-primary shrink-0"
                  >
                    {isPairingWatch ? (
                      <>
                        <RefreshCw className="h-5 w-5 animate-spin" />
                        <span>{t('wearable.connecting', lang)}</span>
                      </>
                    ) : (
                      <>
                        <Watch className="h-5 w-5" />
                        <span>{t('wearable.pairButton', lang)}</span>
                      </>
                    )}
                  </button>
                </div>
                <p id="watch-device-id-hint" className="text-ink-soft text-sm">
                  {t('wearable.howToFindId', lang)}
                </p>
              </div>
            )}

            {watchFeedback && (
              <div
                role="status"
                className="border-pine/40 bg-pine-soft text-pine-deep flex items-center gap-2 rounded-xl border p-3 text-sm font-bold"
              >
                <Check className="h-4 w-4 shrink-0" />
                <span>{watchFeedback}</span>
              </div>
            )}
          </section>

          {/* Account Metadata / Sign Out */}
          <div className="border-line text-ink-soft flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
            <div className="min-w-0">
              <span>{t('profile.accountId', lang)} </span>
              <code className="bg-well border-line rounded border px-1.5 py-0.5 font-mono text-xs">
                {user?.uid.slice(0, 14)}…
              </code>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              className="btn btn-sm btn-secondary text-brick border-brick/30 hover:text-brick-deep"
            >
              <LogOut className="h-4 w-4" />
              <span>{t('profile.signOut', lang)}</span>
            </button>
          </div>
        </form>

        {/* Footer */}
        <div className="modal-foot">
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="btn btn-md btn-secondary"
          >
            {t('common.close', lang)}
          </button>

          <button
            type="button"
            disabled={isSaving || saveSuccess}
            onClick={handleSaveProfile}
            className="btn btn-md btn-primary"
          >
            {isSaving ? (
              <>
                <RefreshCw className="h-5 w-5 animate-spin" />
                <span>{t('profile.saving', lang)}</span>
              </>
            ) : saveSuccess ? (
              <>
                <CheckCircle2 className="h-5 w-5" />
                <span>{t('profile.saved', lang)}</span>
              </>
            ) : (
              <>
                <Check className="h-5 w-5" />
                <span>{t('profile.save', lang)}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
