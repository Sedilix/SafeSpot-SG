/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  HeaderAccessibility 
} from './components/HeaderAccessibility';
import { 
  HeroPickMeUpCamera 
} from './components/HeroPickMeUpCamera';
import { 
  LiveLocationCard 
} from './components/LiveLocationCard';
import { 
  InteractiveMapDisplay 
} from './components/InteractiveMapDisplay';
import { 
  OneTapSharePanel 
} from './components/OneTapSharePanel';
import { 
  VoiceCommandOverlay 
} from './components/VoiceCommandOverlay';
import { 
  CaregiverPreviewModal 
} from './components/CaregiverPreviewModal';
import { 
  ManageContactsModal 
} from './components/ManageContactsModal';
import { 
  SettingsModal 
} from './components/SettingsModal';
import { 
  CaregiverLiveTracker 
} from './components/CaregiverLiveTracker';
import { 
  AuthModal 
} from './components/AuthModal';
import { 
  ProfileModal 
} from './components/ProfileModal';
import {
  PickupDispatchModal
} from './components/PickupDispatchModal';
import { 
  GPSLocation, 
  LocationVerificationResult, 
  AccessibilitySettings, 
  EmergencyContact, 
  UserProfile,
  SavedPlace,
  BatteryStatus,
  SensorMetadata,
  SPEECHMATICS_VOICE_OPTIONS
} from './types';
import { ensureEmergency995 } from './data/defaultContacts';
import { OnboardingWizard, OnboardingResult } from './components/OnboardingWizard';
import { speakSpeechmaticsOrFallback, stopSpeaking } from './utils/speech';
import { getBatteryStatus, watchBattery } from './utils/telemetry';
import { getPersistentItem, setPersistentItem } from './utils/storage';
import { 
  ensureMotionPermission, 
  motionPermissionNeedsGesture,
  startCrashAndFallDetection, 
  playEmergencyAlarmSiren, 
  stopEmergencyAlarmSiren, 
  updateMotionGpsSpeed, 
  CrashEventData 
} from './utils/fallDetection';
import { getBeaconsForVerification, getNearbyBeacons, startBeaconScan, stopBeaconScan, updateBeaconsFromGps } from './utils/ble';
import { fuseLocations, WatchLocationInput } from './utils/locationFusion';
import { getPreferredContact } from './utils/contacts';
import { resolveSavedPlace } from './utils/places';
import { auth, subscribeToUserProfile, saveUserProfile, createIncident, updateIncident } from './lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { AlertCircle, PhoneCall, ShieldAlert, Sparkles, Check, RefreshCw } from 'lucide-react';
import { t } from './locales/translations';
import { PrivacyPolicy } from './components/PrivacyPolicy';

export default function App() {
  // Caregiver live tracking route: /track/:incidentId renders the read-only
  // dashboard for family members instead of the elder app.
  const trackMatch = typeof window !== 'undefined'
    ? window.location.pathname.match(/^\/track\/([^/]+)/)
    : null;
  if (trackMatch) {
    return <CaregiverLiveTracker incidentId={trackMatch[1]} />;
  }
  if (typeof window !== 'undefined' && window.location.pathname.replace(/\/$/, '') === '/privacy') {
    return <PrivacyPolicy />;
  }
  return <SeniorSafeSpotHome />;
}

function SeniorSafeSpotHome() {
  // State: Firebase User & Firestore Profile
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // State: Accessibility Settings
  const [settings, setSettings] = useState<AccessibilitySettings>(() => {
    const validVoiceIds = SPEECHMATICS_VOICE_OPTIONS.map((v) => v.id);
    try {
      const saved = getPersistentItem('senior_safespot_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Migrate stale voice IDs from storage (e.g. removed voices like 'ariana')
        // back to the default so TTS does not silently fall back to Web Speech API.
        if (parsed && !validVoiceIds.includes(parsed.speechmaticsVoice)) {
          parsed.speechmaticsVoice = 'sarah';
        }
        if (parsed && !['en', 'zh', 'ms', 'ta'].includes(parsed.language)) {
          parsed.language = 'en';
        }
        // One-time migration: voice readout is now on-demand by default, so any
        // previously persisted "auto speak" preference is reset to off.
        if (parsed) parsed.spokenGuidance = false;
        return parsed;
      }
    } catch (e) {}
    return {
      contrastTheme: 'normal',
      fontSize: 'large', // Default large for elderly readability
      spokenGuidance: false, // On-demand by default — tap "Listen" to hear the address
      simplifiedMode: false,
      haptics: true,
      alwaysShowStreetView: true,
      speechmaticsVoice: 'sarah', // Default friendly & warm voice
      speechmaticsRate: 0.85,
      language: 'en', // Singapore default; switchable to zh / ms / ta
    };
  });

  // State: Emergency Contacts
  const [contacts, setContacts] = useState<EmergencyContact[]>(() => {
    try {
      const saved = getPersistentItem('senior_safespot_contacts');
      // 995 is re-inserted on every load: a senior who deleted it, or a stale
      // list synced from another device, must never leave them without it.
      if (saved) return ensureEmergency995(JSON.parse(saved));
    } catch (e) {}
    // No sample people: a fresh install contains only the locked 995 entry,
    // and real family contacts are added during onboarding or from Settings.
    return ensureEmergency995([]);
  });

  // State: Telemetry, Photo & AI Verification
  const [gps, setGps] = useState<GPSLocation | null>(() => {
    try {
      const cached = getPersistentItem('senior_safespot_last_gps');
      if (cached) return JSON.parse(cached);
    } catch {}
    return null;
  });
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [currentPhoto, setCurrentPhoto] = useState<string | null>(null);
  const [verification, setVerification] = useState<LocationVerificationResult | null>(null);
  const [isLoadingGPS, setIsLoadingGPS] = useState(false);
  const [isVerifyingAI, setIsVerifyingAI] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // State: Modals & Overlays
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isCaregiverPreviewOpen, setIsCaregiverPreviewOpen] = useState(false);
  const [isContactsModalOpen, setIsContactsModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isPickupDispatchOpen, setIsPickupDispatchOpen] = useState(false);
  const [emergencyCountdown, setEmergencyCountdown] = useState<number | null>(null);

  // State: Battery telemetry, live incident & fall detection
  const [battery, setBattery] = useState<BatteryStatus>({ level: null, charging: null, supported: false });
  const [activeIncidentId, setActiveIncidentId] = useState<string | null>(
    () => getPersistentItem('senior_safespot_active_incident')
  );
  const [isAlertingFamily, setIsAlertingFamily] = useState(false);
  const [fallCountdown, setFallCountdown] = useState<number | null>(null);
  const [activeImpactEvent, setActiveImpactEvent] = useState<CrashEventData | null>(null);
  // True only while a hero "Pick Me Up Here!" capture is being processed, so
  // the background boot verification never disables the giant button.
  const [heroBusy, setHeroBusy] = useState(false);

  // First-launch setup runs before the landing page and is remembered via cookies/localStorage,
  // so the senior is asked for their details exactly once.
  const [hasOnboarded, setHasOnboarded] = useState<boolean>(() => {
    try {
      return getPersistentItem('senior_safespot_onboarded') === 'true';
    } catch {
      return false;
    }
  });

  const initialVerificationDoneRef = useRef(false);
  const lastIncidentGpsPushRef = useRef(0);

  const lang = settings.language || 'en';

  // Live battery telemetry (attached to SOS dispatches & live incidents)
  useEffect(() => {
    let mounted = true;
    getBatteryStatus().then((status) => {
      if (mounted) setBattery(status);
    });
    const unwatch = watchBattery((status) => setBattery(status));
    return () => {
      mounted = false;
      unwatch();
    };
  }, []);

  // Firebase Auth & Firestore Users Collection Sync
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      if (user) {
        // Subscribe to Firestore Users/{uid}
        const unsubscribeProfile = subscribeToUserProfile(user.uid, (profile) => {
          setUserProfile(profile);
          if (profile && profile.emergencyContacts && profile.emergencyContacts.length > 0) {
            setContacts(profile.emergencyContacts);
            setPersistentItem('senior_safespot_contacts', JSON.stringify(profile.emergencyContacts));
          }
        });
        return () => unsubscribeProfile();
      } else {
        setUserProfile(null);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // Apply theme classes to body + root font scaling for senior readability
  useEffect(() => {
    document.body.className = '';
    if (settings.contrastTheme === 'yellow-black') {
      document.body.classList.add('theme-yellow-black');
    } else if (settings.contrastTheme === 'black-white') {
      document.body.classList.add('theme-black-white');
    } else if (settings.contrastTheme === 'warm-soft') {
      document.body.classList.add('theme-warm-soft');
    }
    document.documentElement.setAttribute('data-fs', settings.fontSize);
    setPersistentItem('senior_safespot_settings', JSON.stringify(settings));
  }, [settings]);

  // Persist contacts and sync to Firestore if user is authenticated
  const handleSaveContacts = async (incoming: EmergencyContact[]) => {
    const updated = ensureEmergency995(incoming);
    setContacts(updated);
    setPersistentItem('senior_safespot_contacts', JSON.stringify(updated));

    if (currentUser) {
      try {
        await saveUserProfile({
          uid: currentUser.uid,
          emergencyContacts: updated,
        });
      } catch (e) {
        console.warn('Could not sync contacts to Firestore Users collection:', e);
      }
    }
  };

  // Multimodal Gemini Verification Engine
  const triggerLocationVerification = useCallback(
    async (
      coords: { latitude: number; longitude: number; accuracy?: number; heading?: number; altitude?: number; speed?: number },
      photoBase64?: string | null,
      voiceClue?: string,
      isFromPickMeUp = false,
      sensor?: SensorMetadata | null
    ) => {
      setIsVerifyingAI(true);
      try {
        // Resolve surveyed Singapore venue beacons based on GPS or live radio scan
        if (coords.latitude && coords.longitude) {
          updateBeaconsFromGps(coords.latitude, coords.longitude);
        }
        const bleBeacons = getBeaconsForVerification();

        const res = await fetch('/api/gemini/analyze-location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gps: coords,
            photoBase64: photoBase64 || currentPhoto,
            voiceNotes: voiceClue || '',
            bleBeacons,
            sensor: sensor || null,
          }),
        });

        if (res.ok) {
          const data: LocationVerificationResult = await res.json();
          setVerification(data);

          // If triggered by "Pick Me Up Here!", open the instant dispatch modal for the preferred contact
          if (isFromPickMeUp) {
            setIsPickupDispatchOpen(true);
          }

          // Audio speech feedback for senior
          if (settings.spokenGuidance && data.elderlyVoiceSummary) {
            setIsSpeaking(true);
            const preferred = getPreferredContact(contacts);
            const summaryWithPreferred = isFromPickMeUp && preferred
              ? `${data.elderlyVoiceSummary} Ready to send pickup pin to ${preferred.name.split(' ')[0]}.`
              : data.elderlyVoiceSummary;

            speakSpeechmaticsOrFallback(
              summaryWithPreferred, 
              settings.speechmaticsVoice || 'sarah', 
              () => setIsSpeaking(false),
              settings.speechmaticsRate ?? 0.85,
              settings.language || 'en'
            );
          }
        }
      } catch (err) {
        console.error('Gemini location verification failed:', err);
      } finally {
        setIsVerifyingAI(false);
      }
    },
    [contacts, currentPhoto, settings.spokenGuidance, settings.speechmaticsVoice, settings.speechmaticsRate, settings.language]
  );

  // Acquire Live GPS
  const refreshGPS = useCallback(() => {
    setIsLoadingGPS(true);

    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          updateMotionGpsSpeed(pos.coords.speed);
          const loc: GPSLocation = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy || 15,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
            altitude: pos.coords.altitude,
            altitudeAccuracy: pos.coords.altitudeAccuracy ?? null,
            timestamp: pos.timestamp,
          };
          setGps(loc);
          setGpsError(null);
          setIsLoadingGPS(false);
          setPersistentItem('senior_safespot_last_gps', JSON.stringify(loc));
          triggerLocationVerification(loc, currentPhoto);
        },
        (err) => {
          // Honest failure: never invent a location. Tell the senior what
          // happened and offer a retry.
          console.warn('Geolocation failed or permission denied:', err);
          setIsLoadingGPS(false);
          setGpsError(
            'We could not find your location. Please allow location access, then tap Try Again.'
          );
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    } else {
      setIsLoadingGPS(false);
      setGpsError('Location services are not available on this device.');
    }
  }, [currentPhoto, triggerLocationVerification]);

  // Initial GPS acquisition & verification on mount
  useEffect(() => {
    if (initialVerificationDoneRef.current) return;
    initialVerificationDoneRef.current = true;
    refreshGPS();
  }, [refreshGPS]);

  // Release the Bluetooth radio when the app unmounts
  useEffect(() => stopBeaconScan, []);

  /**
   * Hero "Pick Me Up Here!" one-tap flow: snap surroundings photo, grab fresh
   * GPS, run Gemini landmark verification (voice confirmation plays inside),
   * then auto-scroll the elder down to the verified location card.
   */
  const handlePickMeUp = useCallback(
    async (snappedPhotoBase64?: string, place?: SavedPlace, sensor?: SensorMetadata) => {
      setHeroBusy(true);

      // This tap is a user gesture, which is the only context a browser will
      // start a Bluetooth scan from. Fire and forget: beacons take a moment to
      // arrive, so this tap warms the scan for subsequent verifications rather
      // than blocking this one.
      void startBeaconScan(gps || undefined);

      const runVerification = (coords: GPSLocation) => {
        const photoToUse = snappedPhotoBase64 || currentPhoto;
        if (snappedPhotoBase64) {
          setCurrentPhoto(snappedPhotoBase64);
        }
        triggerLocationVerification(coords, photoToUse, '', true, sensor);
      };

      // "I'm at home / work / my clinic": trust the senior's own saved place
      // over a GPS fix that may be drifting indoors.
      if (place) {
        const resolved = await resolveSavedPlace(place);
        if (resolved && typeof resolved.lat === 'number' && typeof resolved.lng === 'number') {
          const placeLoc: GPSLocation = {
            latitude: resolved.lat,
            longitude: resolved.lng,
            accuracy: 20,
            heading: 0,
            speed: 0,
            altitude: 0,
            timestamp: Date.now(),
          };
          setGps(placeLoc);
          runVerification(placeLoc);
          return;
        }
        // The address could not be resolved; fall through to live GPS rather
        // than pinning the senior to a place we could not find.
        console.warn('Saved place could not be geocoded, using live GPS instead:', place.address);
      }

      // No invented coordinates: verification only ever runs on the senior's
      // own saved place, a live GPS fix, or their last known real fix.
      if (!gps) {
        console.warn('Hero tap without any GPS fix available.');
        setGpsError(
          'We could not find your location. Please allow location access, then tap Try Again.'
        );
        setHeroBusy(false);
        return;
      }

      if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            updateMotionGpsSpeed(pos.coords.speed);
            const freshLoc: GPSLocation = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy || 15,
              heading: pos.coords.heading,
              speed: pos.coords.speed,
              altitude: pos.coords.altitude,
              altitudeAccuracy: pos.coords.altitudeAccuracy ?? null,
              timestamp: pos.timestamp,
            };
            setGps(freshLoc);
            setGpsError(null);
            runVerification(freshLoc);
          },
          (err) => {
            console.warn('Hero GPS acquisition failed, using last known location:', err);
            runVerification(gps);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
        );
      } else {
        runVerification(gps);
      }
    },
    [currentPhoto, gps, triggerLocationVerification]
  );

  // Release the hero busy state once its GPS + AI verification settles
  useEffect(() => {
    if (heroBusy && !isLoadingGPS && !isVerifyingAI) {
      setHeroBusy(false);
    }
  }, [heroBusy, isLoadingGPS, isVerifyingAI]);

  // Speak address aloud
  const handleSpeakAddress = () => {
    const text = verification?.elderlyVoiceSummary || (verification ? `You are at ${verification.formattedAddress}.` : 'Finding your location.');
    setIsSpeaking(true);
    speakSpeechmaticsOrFallback(
      text, 
      settings.speechmaticsVoice || 'sarah', 
      () => setIsSpeaking(false),
      settings.speechmaticsRate ?? 0.85,
      lang
    );
  };

  /**
   * Create a Firestore `Incidents/{id}` doc seeded with the elder's identity,
   * medical profile, current GPS, and live battery. Returns the incident ID
   * so callers can build the `/track/:id` caregiver link.
   */
  const createLiveIncident = useCallback(async (
    incidentType: 'manual_sos' | 'fall' | 'crash' = 'manual_sos',
    crashMetrics?: { impactGForce: number; preImpactSpeedKmh: number; peakRotationRateDps?: number }
  ): Promise<string | null> => {
    try {
      const batt = battery.supported ? battery : await getBatteryStatus();
      const now = Date.now();

      // Multi-source location fusion (BLE Beacon -> Watch GNSS -> Phone GPS)
      let watchLoc: WatchLocationInput | null = null;
      if (userProfile?.wearableDeviceId) {
        try {
          const res = await fetch(`/api/wearable/status?deviceId=${encodeURIComponent(userProfile.wearableDeviceId)}`);
          if (res.ok) {
            const data = await res.json();
            const dev = data.devices?.[0];
            if (dev && dev.lat != null && dev.lng != null) {
              watchLoc = {
                lat: dev.lat,
                lng: dev.lng,
                timestamp: dev.lastSeen || now,
                positionAge: dev.positionAge,
              };
            }
          }
        } catch {
          // ignore network failure
        }
      }

      const fused = fuseLocations({
        watchLocation: watchLoc,
        phoneLocation: gps
          ? {
              latitude: gps.latitude,
              longitude: gps.longitude,
              accuracy: gps.accuracy,
              timestamp: gps.timestamp,
            }
          : null,
        beacons: getNearbyBeacons(),
        now,
      });

      const currentGps = fused
        ? { lat: fused.lat, lng: fused.lng, accuracy: fused.accuracy, timestamp: fused.timestamp }
        : gps
          ? { lat: gps.latitude, lng: gps.longitude, accuracy: gps.accuracy, timestamp: gps.timestamp }
          : null;

      const incidentId = await createIncident({
        deviceId: userProfile?.wearableDeviceId,
        elderUid: currentUser?.uid || null,
        elderName: userProfile?.actualName || currentUser?.displayName || 'Senior',
        elderSelfieUrl: userProfile?.selfiePhotoUrl,
        bloodType: userProfile?.bloodType,
        medicalNotes: userProfile?.medicalNotes || '',
        incidentType,
        crashMetrics,
        currentGps,
        locationSource: fused?.source || (gps ? 'phone_gps' : undefined),
        floorLevel: fused?.floorLevel,
        venueName: fused?.venueName,
        batteryLevel: batt.level,
        isCharging: batt.charging,
        nearestLandmarks: (verification?.visualLandmarks || [])
          .filter((l) => l.matchedInStreetView)
          .slice(0, 5)
          .map((l) => `${l.name} — ${l.description}`),
        formattedAddress: verification?.formattedAddress,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
      setPersistentItem('senior_safespot_active_incident', incidentId);
      setActiveIncidentId(incidentId);
      return incidentId;
    } catch (err) {
      console.error('Failed to create live incident:', err);
      return null;
    }
  }, [battery, currentUser, userProfile, gps, verification]);

  // Alert Family & Live Track: create incident, then open SMS composer to the
  // primary contact with the /track/:id real-time tracking link.
  const handleAlertFamily = async () => {
    setIsAlertingFamily(true);
    try {
      const incidentId = await createLiveIncident();
      if (!incidentId) return;
      const trackUrl = `${window.location.origin}/track/${incidentId}`;
      const primary = contacts.find((c) => c.isPrimary) || contacts[0];
      const batteryText = battery.level !== null ? ` Battery: ${battery.level}%.` : '';
      const message = encodeURIComponent(
        `EMERGENCY: ${userProfile?.actualName || 'I'} need assistance at: ${verification?.formattedAddress || 'My Current Location'}.${batteryText}\nLive tracking: ${trackUrl}\nMap: ${verification?.shareUrls?.googleMapsUrl || ''}`
      );
      if (primary) {
        window.location.href = `sms:${primary.phone.replace(/[^0-9+]/g, '')}?body=${message}`;
      } else {
        await navigator.clipboard?.writeText(trackUrl);
      }
    } finally {
      setIsAlertingFamily(false);
    }
  };

  // While an incident is active, stream live GPS + battery into Firestore so
  // caregivers watching /track/:id see real-time updates. Throttled to 5s.
  useEffect(() => {
    if (!activeIncidentId) return;

    let watchId: number | null = null;
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const now = Date.now();
          if (now - lastIncidentGpsPushRef.current < 5000) return;
          lastIncidentGpsPushRef.current = now;

          const fusedStream = fuseLocations({
            phoneLocation: {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy || 15,
              timestamp: pos.timestamp,
            },
            beacons: getNearbyBeacons(),
            now,
          });

          void updateIncident(activeIncidentId, {
            currentGps: fusedStream
              ? {
                  lat: fusedStream.lat,
                  lng: fusedStream.lng,
                  accuracy: fusedStream.accuracy,
                  timestamp: fusedStream.timestamp,
                }
              : {
                  lat: pos.coords.latitude,
                  lng: pos.coords.longitude,
                  accuracy: pos.coords.accuracy || 15,
                  timestamp: pos.timestamp,
                },
            locationSource: fusedStream?.source ?? 'phone_gps',
            floorLevel: fusedStream?.floorLevel,
            venueName: fusedStream?.venueName,
          });
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 3000 }
      );
    }

    const unwatchBattery = watchBattery((status) => {
      void updateIncident(activeIncidentId, {
        batteryLevel: status.level,
        isCharging: status.charging,
      });
    });

    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      unwatchBattery();
    };
  }, [activeIncidentId]);

  // Passive high-G crash & fall monitoring via accelerometer (opt-in via settings)
  useEffect(() => {
    if (settings.fallDetection === false && settings.crashDetection === false) return;
    let handle: { stop: () => void } | null = null;
    let cancelled = false;

    const beginDetection = (granted: boolean) => {
      if (cancelled || !granted) return;
      handle = startCrashAndFallDetection((event) => {
        if (event.type === 'crash' && settings.crashDetection === false) return;
        if (event.type === 'fall' && settings.fallDetection === false) return;

        setActiveImpactEvent(event);
        setFallCountdown(10);
        playEmergencyAlarmSiren();

        // Life-safety alert: always spoken regardless of the guidance toggle.
        const alertText = event.type === 'crash'
          ? 'Severe vehicle crash detected! Notifying SCDF emergency 995 in 10 seconds. Tap I am okay to cancel.'
          : `${t('fall.title', lang)}. ${t('fall.desc', lang)}`;
        speakSpeechmaticsOrFallback(
          alertText,
          settings.speechmaticsVoice || 'sarah',
          undefined,
          0.95,
          lang
        );
      });
    };

    // iOS only opens the motion permission prompt from inside a user gesture.
    // Asking at mount is rejected silently and leaves the sensors permanently
    // inactive, so there wait for the senior's first tap and ask from that.
    let armFromGesture: (() => void) | null = null;

    if (motionPermissionNeedsGesture()) {
      armFromGesture = () => {
        window.removeEventListener('pointerdown', armFromGesture!);
        void ensureMotionPermission().then(beginDetection);
      };
      window.addEventListener('pointerdown', armFromGesture, { once: true });
    } else {
      void ensureMotionPermission().then(beginDetection);
    }

    return () => {
      cancelled = true;
      if (armFromGesture) window.removeEventListener('pointerdown', armFromGesture);
      handle?.stop();
    };
  }, [settings.fallDetection, settings.crashDetection, settings.speechmaticsVoice, lang]);

  // Fall/Crash countdown: reassuring audio + siren + cancel button, auto-dials 995 at 0
  useEffect(() => {
    if (fallCountdown === null) {
      stopEmergencyAlarmSiren();
      return;
    }

    if (fallCountdown > 0) {
      const timer = setTimeout(() => setFallCountdown((c) => (c === null ? null : c - 1)), 1000);
      return () => clearTimeout(timer);
    } else {
      setFallCountdown(null);
      stopEmergencyAlarmSiren();
      const currentEv = activeImpactEvent;
      void createLiveIncident(
        currentEv?.type || 'fall',
        currentEv ? {
          impactGForce: currentEv.impactGForce,
          preImpactSpeedKmh: currentEv.speedKmh,
          peakRotationRateDps: currentEv.rotationRateDps,
        } : undefined
      );
      window.location.href = 'tel:995';
    }
  }, [fallCountdown, activeImpactEvent, createLiveIncident]);

  // Emergency SOS Trigger with 5-second cancelable countdown
  const handleEmergencySOS = () => {
    setEmergencyCountdown(5);
  };

  useEffect(() => {
    if (emergencyCountdown === null) return;
    if (emergencyCountdown > 0) {
      const timer = setTimeout(() => {
        setEmergencyCountdown(emergencyCountdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (emergencyCountdown === 0) {
      // Trigger emergency phone call & live incident dispatch
      setEmergencyCountdown(null);
      const address = verification?.formattedAddress || 'My Current Location';
      const batteryText = battery.level !== null ? ` Battery: ${battery.level}%${battery.charging ? ' (charging)' : ''}.` : '';
      console.info(`SOS SCDF dispatch — address: ${address}.${batteryText}`);
      void createLiveIncident('manual_sos');
      window.location.href = `tel:995`;
    }
  }, [emergencyCountdown, verification, battery, createLiveIncident]);

  const finishOnboarding = () => {
    try {
      setPersistentItem('senior_safespot_onboarded', 'true');
    } catch {
      /* Private mode fallback */
    }
    setHasOnboarded(true);
  };

  const handleOnboardingComplete = (result: OnboardingResult) => {
    void handleSaveContacts(result.contacts);

    // Persist the profile locally so it survives without an account, and to
    // Firestore too when the senior is signed in.
    const profilePatch = {
      actualName: result.actualName,
      phone: result.phone,
      dob: result.dob,
      bloodType: result.bloodType,
      selfiePhotoUrl: result.selfiePhotoUrl,
      savedPlaces: result.savedPlaces,
    };

    setUserProfile((prev) => ({ ...(prev ?? ({} as UserProfile)), ...profilePatch } as UserProfile));

    try {
      setPersistentItem('senior_safespot_profile', JSON.stringify(profilePatch));
    } catch {
      /* Storage unavailable; the in-memory profile still serves this session. */
    }

    if (currentUser) {
      void saveUserProfile({ uid: currentUser.uid, ...profilePatch }).catch((e) =>
        console.warn('Could not sync onboarding profile to Firestore:', e)
      );
    }

    finishOnboarding();
  };

  // Gate the landing page behind first-launch setup.
  if (!hasOnboarded) {
    return (
      <OnboardingWizard
        settings={settings}
        existingContacts={contacts}
        onComplete={handleOnboardingComplete}
        onSkip={finishOnboarding}
      />
    );
  }

  return (
    <div
      id="app-container-senior-safespot"
      className="bg-bg text-ink flex min-h-screen flex-col transition-colors"
    >
      {/* Top Accessibility Bar */}
      <HeaderAccessibility
        settings={settings}
        onUpdateSettings={setSettings}
        onOpenVoiceCommand={() => setIsVoiceModalOpen(true)}
        onEmergencyTrigger={handleEmergencySOS}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onOpenProfile={() => setIsProfileModalOpen(true)}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        user={currentUser}
        profile={userProfile}
        isSpeaking={isSpeaking}
        onStopSpeaking={stopSpeaking}
      />

      {/* Emergency Alert Active Banner */}
      {emergencyCountdown !== null && (
        <div
          id="banner-emergency-countdown"
          className="bg-brick text-on-brick border-brick-deep sticky top-16 z-50 flex flex-wrap items-center justify-between gap-4 border-b p-4 shadow-xl sm:p-5"
        >
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-7 w-7 sm:h-8 sm:w-8" />
            <div>
              <div className="font-display text-lg font-bold tracking-tight uppercase sm:text-xl">
                {t('sos.countdownTitle', lang)} {emergencyCountdown}s
              </div>
              <p className="text-sm font-medium opacity-90 sm:text-base">
                {t('sos.countdownDesc', lang)}
                {battery.level !== null && ` • ${t('tracker.battery', lang)}: ${battery.level}%`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setEmergencyCountdown(null)}
              className="bg-on-brick text-brick-deep btn btn-md hover:bg-on-brick/90"
            >
              {t('sos.cancel', lang)}
            </button>
          </div>
        </div>
      )}

      {/* Fall / Crash Detection Cancelable Countdown Overlay */}
      {fallCountdown !== null && (
        <div
          id="overlay-fall-detection-countdown"
          className="bg-brick/95 backdrop-blur-md fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 p-6 text-center animate-fadeIn"
        >
          <div className="relative">
            <div className="absolute -inset-4 bg-white/20 rounded-full animate-ping"></div>
            <ShieldAlert className="text-on-brick h-20 w-20 relative" />
          </div>

          <div className="space-y-2 max-w-lg">
            <h2 className="font-display text-on-brick text-3xl sm:text-5xl font-black uppercase tracking-tight">
              {activeImpactEvent?.type === 'crash' ? '🚗 VEHICLE CRASH DETECTED' : t('fall.title', lang)}
            </h2>
            <p className="text-on-brick/90 text-lg sm:text-2xl font-bold">
              {activeImpactEvent?.type === 'crash'
                ? `Calling SCDF 995 & Alerting Family in ${fallCountdown}s`
                : `${t('fall.desc', lang)} (${fallCountdown}s)`}
            </p>

            {activeImpactEvent && (
              <div className="inline-flex items-center gap-3 bg-black/30 text-on-brick text-sm sm:text-base font-mono px-4 py-2 rounded-full border border-white/20">
                <span>Impact Shock: <strong>{activeImpactEvent.impactGForce}G</strong></span>
                {activeImpactEvent.speedKmh > 0 && (
                  <span>• Pre-Impact Speed: <strong>{activeImpactEvent.speedKmh} km/h</strong></span>
                )}
              </div>
            )}
          </div>

          <button
            id="btn-fall-im-okay"
            onClick={() => {
              setFallCountdown(null);
              stopEmergencyAlarmSiren();
              stopSpeaking();
            }}
            className="giant-tap bg-white text-brick-deep font-black rounded-3xl px-10 py-6 sm:px-14 sm:py-8 text-2xl sm:text-4xl shadow-2xl border-4 border-white active:scale-95 transition-transform"
          >
            ✋ {t('fall.imOkay', lang)}
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto w-full px-3 sm:px-6 py-6 sm:py-8 flex-1 space-y-6 sm:space-y-8">
        {/* Hero: "Pick Me Up Here!" live camera landing experience */}
        <HeroPickMeUpCamera
          gps={gps}
          verification={verification}
          isAnalyzing={isVerifyingAI || isLoadingGPS || heroBusy}
          isLoadingGPS={isLoadingGPS}
          profile={userProfile}
          onPickMeUp={handlePickMeUp}
          onSpeakAddress={handleSpeakAddress}
          onOpenProfile={() => (currentUser ? setIsProfileModalOpen(true) : setIsAuthModalOpen(true))}
          isSpeaking={isSpeaking}
          settings={settings}
        />

        {/* Honest GPS failure banner — no invented locations, just a clear retry */}
        {gpsError && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brick/30 bg-brick-soft px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-bold text-brick-deep">
              <AlertCircle className="h-5 w-5 shrink-0" />
              {gpsError}
            </p>
            <button type="button" onClick={refreshGPS} className="btn btn-md btn-secondary">
              <RefreshCw className="h-4 w-4" />
              Try Again
            </button>
          </div>
        )}

        {/* Section 1: Live Location Card with Voice Reading */}
        <LiveLocationCard
          gps={gps}
          verification={verification}
          isLoadingGPS={isLoadingGPS}
          isVerifyingAI={isVerifyingAI}
          onRefreshGPS={refreshGPS}
          onSpeakAddress={handleSpeakAddress}
          isSpeaking={isSpeaking}
          settings={settings}
        />

        {/* Section 2: One-Tap Caregiver & Family Contact Triggers */}
        <OneTapSharePanel
          contacts={contacts}
          verification={verification}
          settings={settings}
          onOpenManageContacts={() => setIsContactsModalOpen(true)}
          onOpenCaregiverPreview={() => setIsCaregiverPreviewOpen(true)}
          onAlertFamily={handleAlertFamily}
          isAlertingFamily={isAlertingFamily}
        />

        {/* Section 3: Interactive Live Map Display */}
        <InteractiveMapDisplay
          gps={gps}
          verification={verification}
          settings={settings}
        />
      </main>

      {/* Modals */}
      <VoiceCommandOverlay
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        currentAddress={verification?.formattedAddress || ''}
        verification={verification}
        emergencyContacts={contacts}
        settings={settings}
        onTriggerSendLocation={() => {
          const primary = contacts.find((c) => c.isPrimary) || contacts[0];
          if (primary && verification?.shareUrls?.googleMapsUrl) {
            window.location.href = `sms:${primary.phone}?body=${encodeURIComponent(
              `Hi! I need a pickup here: ${verification.formattedAddress}. Map: ${verification.shareUrls.googleMapsUrl}`
            )}`;
          }
        }}
        onTriggerEmergency={handleEmergencySOS}
        onTriggerCamera={() => {
          window.scrollTo({ top: 400, behavior: 'smooth' });
        }}
        onToggleContrast={() => {
          setSettings((prev) => ({
            ...prev,
            contrastTheme: prev.contrastTheme === 'yellow-black' ? 'normal' : 'yellow-black',
          }));
        }}
        onSpeakAddress={handleSpeakAddress}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={settings}
        onUpdateSettings={setSettings}
        onOpenManageContacts={() => setIsContactsModalOpen(true)}
      />

      <CaregiverPreviewModal
        isOpen={isCaregiverPreviewOpen}
        onClose={() => setIsCaregiverPreviewOpen(false)}
        verification={verification}
        photoBase64={currentPhoto}
        settings={settings}
      />

      <ManageContactsModal
        isOpen={isContactsModalOpen}
        onClose={() => setIsContactsModalOpen(false)}
        contacts={contacts}
        onSaveContacts={handleSaveContacts}
        settings={settings}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={(user) => {
          setIsAuthModalOpen(false);
          setIsProfileModalOpen(true);
        }}
        settings={settings}
      />

      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        user={currentUser}
        profile={userProfile}
        onProfileUpdated={(updated) => {
          setUserProfile(updated);
          if (updated.emergencyContacts && updated.emergencyContacts.length > 0) {
            setContacts(updated.emergencyContacts);
          }
        }}
        contacts={contacts}
        onOpenManageContacts={() => {
          setIsProfileModalOpen(false);
          setIsContactsModalOpen(true);
        }}
        settings={settings}
      />

      <PickupDispatchModal
        isOpen={isPickupDispatchOpen}
        onClose={() => setIsPickupDispatchOpen(false)}
        verification={verification}
        preferredContact={getPreferredContact(contacts)}
        incidentId={activeIncidentId || undefined}
        settings={settings}
      />

      {/* Footer Accessibility Notice */}
      <footer className="border-line text-ink-soft border-t px-4 py-6 text-center text-sm font-medium sm:text-base">
        <p>
          SafeSpot.SG • Multimodal Location & Pickup Assistant • Powered by Gemini AI, Speechmatics & Firebase
        </p>
        <p className="mt-2">
          <a href="/privacy" className="text-pine font-semibold underline underline-offset-2">Privacy Policy</a>
        </p>
      </footer>
    </div>
  );
}
