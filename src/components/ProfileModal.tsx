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
  MapPin, 
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
} from 'lucide-react';
import { UserProfile, BloodType, EmergencyContact, AccessibilitySettings } from '../types';
import { AddressAutocompleteInput } from './AddressAutocompleteInput';
import { saveUserProfile, signOutUser } from '../lib/firebase';
import { User as FirebaseUser } from 'firebase/auth';
import { t } from '../locales/translations';

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
  const [bloodType, setBloodType] = useState<BloodType>('O+');
  const [address, setAddress] = useState('');
  const [medicalNotes, setMedicalNotes] = useState('');
  const [selfiePhotoUrl, setSelfiePhotoUrl] = useState<string | undefined>(undefined);

  // Camera State
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Saving State
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Watch State
  const [pairedDeviceId, setPairedDeviceId] = useState('');
  const [inputDeviceId, setInputDeviceId] = useState('fenix-6s-solar');
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
      setBloodType(profile.bloodType || 'O+');
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
      setErrorMessage(
        'Live camera is unavailable here, so no photo was taken. Gallery uploads are disabled to keep your photo authentic — try again from your phone.'
      );
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
      setErrorMessage('You must be signed in to save your profile.');
      return;
    }

    if (!actualName.trim()) {
      setErrorMessage('Please enter your full name.');
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
      setErrorMessage(err.message || 'Failed to save profile to Firestore.');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePairWatch = async () => {
    const id = inputDeviceId.trim();
    if (!id || !user) return;
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

  if (!isOpen) return null;

  return (
    <div id="modal-profile-backdrop" className="modal-backdrop">
      <div id="modal-profile-content" className="modal-panel max-w-2xl">
        {/* Header */}
        <div className="modal-head">
          <div className="flex items-center gap-3">
            <div className="icon-tile">
              <User className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-2xl leading-none font-bold tracking-tight">
                Senior User Profile
              </h2>
              <p className="text-ink-soft mt-1 text-sm sm:text-base">
                Firestore Cloud Profile & SCDF Emergency Record
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="accessible-tap text-ink-soft hover:bg-well hover:text-ink rounded-xl p-2 transition-colors"
            aria-label="Close"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSaveProfile} className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
          {errorMessage && (
            <div className="border-brick/40 bg-brick-soft text-brick-deep flex items-start gap-2.5 rounded-xl border p-4 text-sm font-bold sm:text-base">
              <AlertCircle className="text-brick mt-0.5 h-5 w-5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {saveSuccess && (
            <div className="border-pine/40 bg-pine-soft text-pine-deep flex items-center gap-2.5 rounded-xl border p-4 text-base font-bold">
              <Check className="text-pine h-5 w-5" />
              <span>Profile updated in Firestore Users/{user?.uid}!</span>
            </div>
          )}

          {/* Section 1: Selfie Photo Capture */}
          <div className="border-line bg-well/60 space-y-3 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="text-sky h-5 w-5" />
                <label className="text-base font-bold sm:text-lg">
                  Profile Selfie Photo (Driver & Responder Visual ID)
                </label>
              </div>
              {selfiePhotoUrl && (
                <span className="text-pine-deep flex items-center gap-1 text-sm font-bold">
                  <ShieldCheck className="h-4 w-4" /> Photo Saved
                </span>
              )}
            </div>

            <p className="text-ink-soft text-sm">
              Taking a clear selfie helps arriving caregivers and ambulance drivers spot you immediately.
            </p>

            <div className="flex flex-col items-center gap-4 pt-1 sm:flex-row">
              {/* Photo Preview Circle */}
              <div className="border-line-strong bg-well relative h-28 w-28 shrink-0 overflow-hidden rounded-full border-4 shadow-md sm:h-32 sm:w-32 flex items-center justify-center">
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
                    alt="Senior Selfie"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <User className="text-ink-faint h-14 w-14" />
                )}
              </div>

              {/* Action Buttons for Camera */}
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                {isCameraActive ? (
                  <>
                    <button
                      type="button"
                      onClick={captureSelfie}
                      className="btn btn-md btn-primary"
                    >
                      <Camera className="h-5 w-5" />
                      <span>Take Photo</span>
                    </button>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="btn btn-md btn-secondary"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={startCamera}
                    className="btn btn-md btn-primary"
                  >
                    <Camera className="h-5 w-5" />
                    <span>{selfiePhotoUrl ? 'Retake Selfie' : 'Take Selfie Photo'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Section 2: Personal Details (Name & DOB) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="profile-name">Full Actual Name *</label>
              <div className="relative">
                <div className="text-ink-faint pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <User className="h-5 w-5" />
                </div>
                <input
                  id="profile-name"
                  type="text"
                  required
                  value={actualName}
                  onChange={(e) => setActualName(e.target.value)}
                  placeholder="e.g. Tan Ah Kow / Mary Lim"
                  className="input pl-10"
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="profile-dob">Date of Birth (DOB)</label>
              <div className="relative">
                <div className="text-ink-faint pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Calendar className="h-5 w-5" />
                </div>
                <input
                  id="profile-dob"
                  type="date"
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
              <label className="label" htmlFor="profile-blood">Blood Type (SCDF Ambulance Critical)</label>
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
                      {bt} {bt === 'O+' ? '(Universal / Common)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="profile-medical">Medical Notes / Allergies</label>
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
              label="Permanent Home Address (Singapore)"
              placeholder="e.g. Blk 480 Lorong 6 Toa Payoh #10-123 or S310480"
              onChange={(addr) => setAddress(addr)}
            />
          </div>

          {/* Section 5: Emergency Contacts Preview & Link */}
          <div className="border-line bg-well/60 flex items-center justify-between rounded-xl border p-4">
            <div className="flex items-center gap-2.5">
              <Users className="text-sky h-5 w-5" />
              <div>
                <div className="text-sm font-bold sm:text-base">
                  {contacts.length} Emergency Contacts Configured
                </div>
                <div className="text-ink-soft text-sm">
                  {contacts.map((c) => c.name).slice(0, 2).join(', ')}...
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenManageContacts();
              }}
              className="text-pine-deep text-sm font-bold hover:underline"
            >
              Edit Contacts →
            </button>
          </div>

          {/* Section 6: Garmin Watch Pairing */}
          <div className="border-line bg-well/60 space-y-3 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Watch className="text-sky h-5 w-5" />
                <label className="text-base font-bold sm:text-lg">
                  {t('wearable.pairingTitle', settings.language)}
                </label>
              </div>
              {pairedDeviceId ? (
                <span className="text-pine-deep flex items-center gap-1 text-sm font-bold">
                  <CheckCircle2 className="h-4 w-4" /> {t('wearable.pairedBadge', settings.language)}
                </span>
              ) : (
                <span className="text-ink-soft text-sm font-semibold">
                  {t('wearable.notPaired', settings.language)}
                </span>
              )}
            </div>

            <p className="text-ink-soft text-sm">
              {t('wearable.pairingDesc', settings.language)}
            </p>

            {pairedDeviceId ? (
              <div className="space-y-3 pt-1">
                <div className="bg-paper border-line flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
                  <div className="flex items-center gap-3">
                    <div className="bg-sky-soft text-sky-deep flex h-10 w-10 items-center justify-center rounded-xl font-bold">
                      <Radio className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-mono text-base font-bold">{pairedDeviceId}</div>
                      <div className="text-ink-soft flex items-center gap-2 text-xs font-semibold">
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${
                            watchStatus?.online ? 'bg-pine' : 'bg-ink-faint'
                          }`}
                        />
                        <span>
                          {watchStatus?.online
                            ? t('wearable.online', settings.language)
                            : t('wearable.offline', settings.language)}
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
                    className="btn btn-sm btn-secondary text-brick hover:bg-brick-soft hover:text-brick-deep border-brick/30"
                  >
                    <Unlink className="h-4 w-4" />
                    <span>{t('wearable.unpairButton', settings.language)}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 pt-1">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative flex-1">
                    <input
                      id="watch-device-id"
                      type="text"
                      value={inputDeviceId}
                      onChange={(e) => setInputDeviceId(e.target.value)}
                      placeholder={t('wearable.deviceIdPlaceholder', settings.language)}
                      className="input font-mono"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handlePairWatch}
                    disabled={isPairingWatch || !inputDeviceId.trim()}
                    className="btn btn-md btn-primary shrink-0"
                  >
                    {isPairingWatch ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>{t('wearable.connecting', settings.language)}</span>
                      </>
                    ) : (
                      <>
                        <Watch className="h-4 w-4" />
                        <span>{t('wearable.pairButton', settings.language)}</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-ink-soft text-xs">
                  {t('wearable.howToFindId', settings.language)}
                </p>
              </div>
            )}

            {watchFeedback && (
              <div className="border-pine/40 bg-pine-soft text-pine-deep flex items-center gap-2 rounded-lg border p-2 text-sm font-semibold">
                <Check className="h-4 w-4" />
                <span>{watchFeedback}</span>
              </div>
            )}
          </div>

          {/* Account Metadata / Sign Out */}
          <div className="border-line text-ink-soft flex items-center justify-between border-t pt-3 text-sm">
            <div>
              <span>Firestore UID: </span>
              <code className="bg-well border-line rounded border px-1.5 py-0.5 font-mono text-xs">
                {user?.uid.slice(0, 14)}...
              </code>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              className="text-brick hover:text-brick-deep flex items-center gap-1 font-bold"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
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
            Close
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={handleSaveProfile}
            className="btn btn-md btn-primary"
          >
            {isSaving ? (
              <>
                <RefreshCw className="h-5 w-5 animate-spin" />
                <span>Saving to Firestore...</span>
              </>
            ) : (
              <>
                <Check className="h-5 w-5" />
                <span>Save Profile to Cloud</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
