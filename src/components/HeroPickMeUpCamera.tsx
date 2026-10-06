/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  CameraOff,
  Volume2,
  AlertCircle,
  RefreshCw,
  Building2,
  DoorOpen,
  CheckCircle2,
  Radio,
  Plus,
  Compass,
} from 'lucide-react';
import {
  GPSLocation,
  LocationVerificationResult,
  AccessibilitySettings,
  SavedPlace,
  UserProfile,
  BLEBeaconScan,
  BLEScanState,
  SensorMetadata,
} from '../types';
import { subscribeToBLE, startBeaconScan, stopBeaconScan, getNearbyBeacons, pairSafetyTag, getBLECapability } from '../utils/ble';
import { orderSavedPlaces, savedPlaceLabel, SAVED_PLACE_META } from '../utils/places';
import { formatConciseAddress, formatDriverHint } from '../utils/address';
import { t } from '../locales/translations';
import {
  ensureOrientationPermission,
  getOrientationSnapshot,
  isSteadyCapture,
  startOrientationTracking,
  stopOrientationTracking,
  OrientationSnapshot,
} from '../utils/orientation';

/** Stop the camera after this long without the senior touching the screen. */
const CAMERA_IDLE_TIMEOUT_MS = 60_000;

interface HeroPickMeUpCameraProps {
  gps: GPSLocation | null;
  verification: LocationVerificationResult | null;
  isAnalyzing: boolean;
  isLoadingGPS: boolean;
  profile: UserProfile | null;
  onPickMeUp: (photoBase64?: string, place?: SavedPlace, sensor?: SensorMetadata) => void;
  onSpeakAddress: () => void;
  onOpenProfile: () => void;
  isSpeaking: boolean;
  settings: AccessibilitySettings;
}

export const HeroPickMeUpCamera: React.FC<HeroPickMeUpCameraProps> = ({
  gps,
  verification,
  isAnalyzing,
  isLoadingGPS,
  profile,
  onPickMeUp,
  onSpeakAddress,
  onOpenProfile,
  isSpeaking,
  settings,
}) => {
  const [isLiveCameraActive, setIsLiveCameraActive] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraIdle, setIsCameraIdle] = useState(false);
  const [bleState, setBleState] = useState<BLEScanState>({ status: 'idle', beaconCount: 0 });
  const [bleBeacons, setBleBeacons] = useState<BLEBeaconScan[]>([]);
  const [bleUnsupportedReason, setBleUnsupportedReason] = useState<string | null>(null);
  const [liveOrientation, setLiveOrientation] = useState<OrientationSnapshot | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lang = settings.language || 'en';

  const savedPlaces = orderSavedPlaces(profile?.savedPlaces);

  // ── Camera lifecycle ──────────────────────────────────────────────────────

  const stopCamera = useCallback((idle: boolean) => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsLiveCameraActive(false);
    setIsCameraIdle(idle);
  }, []);

  const startCamera = useCallback(async () => {
    if (streamRef.current) return;
    try {
      setCameraError(null);
      setIsCameraIdle(false);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      // The <video> element is always mounted, so the ref is guaranteed to be
      // attached by the time the stream resolves. Gating the element on
      // isLiveCameraActive would deadlock: the flag is set here, and this only
      // runs once the element exists.
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setIsLiveCameraActive(true);
    } catch (err: any) {
      console.warn('Camera access not granted or unavailable:', err);
      setIsLiveCameraActive(false);
      setCameraError(
        err?.name === 'NotAllowedError'
          ? 'Camera permission was declined. Tap below to try again, or pick a saved place.'
          : 'No camera available on this device. You can still tap the big button — we will use your GPS.'
      );
    }
  }, []);

  useEffect(() => {
    void startCamera();
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [startCamera]);

  /**
   * A viewfinder nobody is looking at still drains the battery and holds the
   * camera hardware open, so idle time releases it. Any touch, keypress or
   * scroll counts as the senior still being present.
   */
  useEffect(() => {
    const markActive = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        if (streamRef.current) stopCamera(true);
      }, CAMERA_IDLE_TIMEOUT_MS);
    };

    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, markActive, { passive: true }));

    // Releasing a backgrounded tab's camera matters more than the idle timer.
    const onVisibility = () => {
      if (document.hidden && streamRef.current) stopCamera(true);
    };
    document.addEventListener('visibilitychange', onVisibility);

    markActive();

    return () => {
      events.forEach((e) => window.removeEventListener(e, markActive));
      document.removeEventListener('visibilitychange', onVisibility);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [stopCamera]);

  // ── Orientation tracking (sensor lock strip + shutter metadata) ──────────

  useEffect(() => {
    startOrientationTracking();
    const poll = setInterval(() => setLiveOrientation(getOrientationSnapshot()), 500);
    return () => {
      clearInterval(poll);
      stopOrientationTracking();
    };
  }, []);

  // ── BLE ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const unsubscribe = subscribeToBLE((state, beacons) => {
      setBleState(state);
      setBleBeacons(beacons);
    });

    getBLECapability().then((cap) => {
      if (!cap.canScan && !cap.canPairDevice) setBleUnsupportedReason(cap.reason ?? null);
    });

    return unsubscribe;
  }, []);

  const handleEnableBeacons = async () => {
    const state = await startBeaconScan(gps);
    setBleState(state);
    const beacons = getNearbyBeacons();
    setBleBeacons(beacons);
  };

  const handleToggleBeacons = async () => {
    if (bleState.status === 'scanning') {
      stopBeaconScan();
      setBleState({ status: 'idle', beaconCount: 0 });
      setBleBeacons([]);
    } else {
      await handleEnableBeacons();
    }
  };

  // ── Capture ───────────────────────────────────────────────────────────────

  const handleSnapAndPickMeUp = async () => {
    // The tap is a user gesture — the only context iOS grants the compass
    // from, so the shutter payload gets a real heading on iPhones.
    await ensureOrientationPermission();
    const sensor = getOrientationSnapshot();

    let photoData: string | undefined;

    if (videoRef.current && isLiveCameraActive) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth || 640;
        canvas.height = videoRef.current.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          photoData = canvas.toDataURL('image/jpeg', 0.85);
          setCapturedPhoto(photoData);
        }
      } catch (e) {
        console.warn('Could not snap canvas from video:', e);
      }
    } else if (capturedPhoto) {
      photoData = capturedPhoto;
    }

    onPickMeUp(photoData, undefined, sensor);
  };

  const conciseAddress = formatConciseAddress(verification?.formattedAddress);
  const driverHint = formatDriverHint(
    verification?.pickupInstructionsForDriver,
    verification?.formattedAddress
  );

  return (
    <section id="hero-pick-me-up-section" className="card overflow-hidden">
      {/* Status strip — sensor lock: compass heading, GPS accuracy, fix state */}
      <div className="border-line bg-well/70 flex items-center justify-between gap-2 border-b px-3 py-2 sm:px-4">
        <span className="section-kicker min-w-0 leading-snug">{t('hero.statusStrip', lang)}</span>
        <span className="text-ink-soft flex shrink-0 items-center gap-2 text-xs font-bold">
          <span className="flex items-center gap-1" title="Compass heading (sensor lock)">
            <Compass className={`h-3.5 w-3.5 ${liveOrientation?.heading != null ? 'text-sky' : 'text-ink-faint'}`} />
            {liveOrientation?.heading != null ? `${Math.round(liveOrientation.heading)}°` : '—'}
          </span>
          {gps && (
            <span
              className={gps.accuracy <= 15 ? 'text-pine-deep' : gps.accuracy <= 40 ? 'text-ochre-deep' : 'text-brick'}
              title="GPS accuracy radius"
            >
              ±{Math.round(gps.accuracy)}m
            </span>
          )}
          <span
            className={`h-2 w-2 rounded-full ${gps ? 'bg-pine' : 'bg-ink-faint animate-pulse'}`}
          ></span>
          {gps ? t('hero.gpsReady', lang) : t('hero.findingGps', lang)}
        </span>
      </div>

      <div className="space-y-3 p-3 sm:space-y-4 sm:p-5">
        {/* Viewfinder */}
        <div className="bg-ink relative aspect-4/3 w-full overflow-hidden rounded-xl sm:aspect-video">
          {/* Always mounted so its ref exists before the stream resolves. */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full object-cover transition-opacity duration-300 ${
              isLiveCameraActive ? 'opacity-100' : 'opacity-0'
            }`}
          />

          {!isLiveCameraActive && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
              {isCameraIdle ? (
                <>
                  <CameraOff className="h-8 w-8 text-white/50" />
                  <p className="text-sm font-bold text-white">{t('hero.cameraPausedBattery', lang)}</p>
                  <button
                    type="button"
                    onClick={() => void startCamera()}
                    className="btn btn-md bg-white/15 text-white backdrop-blur-sm hover:bg-white/25"
                  >
                    <Camera className="h-4 w-4" />
                    {t('hero.resumeCamera', lang)}
                  </button>
                </>
              ) : cameraError ? (
                <>
                  <AlertCircle className="h-8 w-8 text-amber-400" />
                  <p className="max-w-xs text-xs font-semibold text-white/90">{cameraError}</p>
                  <button
                    type="button"
                    onClick={() => void startCamera()}
                    className="btn btn-md bg-white/15 text-white backdrop-blur-sm hover:bg-white/25"
                  >
                    <Camera className="h-4 w-4" />
                    {t('hero.tryAgain', lang)}
                  </button>
                </>
              ) : capturedPhoto ? (
                <img src={capturedPhoto} alt="Your surroundings" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <>
                  <Camera className="h-8 w-8 animate-pulse text-white/50" />
                  <p className="text-sm font-bold text-white">{t('hero.startingCamera', lang)}</p>
                </>
              )}
            </div>
          )}

          {/* Framing guides, only while there is a picture to frame */}
          {isLiveCameraActive && (
            <div className="pointer-events-none absolute inset-5">
              <span className="absolute top-0 left-0 h-7 w-7 rounded-tl border-t-2 border-l-2 border-white/80"></span>
              <span className="absolute top-0 right-0 h-7 w-7 rounded-tr border-t-2 border-r-2 border-white/80"></span>
              <span className="absolute bottom-0 left-0 h-7 w-7 rounded-bl border-b-2 border-l-2 border-white/80"></span>
              <span className="absolute right-0 bottom-0 h-7 w-7 rounded-br border-r-2 border-b-2 border-white/80"></span>
            </div>
          )}

          {/* Level hint — only when the frame would be visibly canted */}
          {isLiveCameraActive && liveOrientation && !isSteadyCapture(liveOrientation) && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-amber-300/40 bg-black/70 px-3 py-1 text-xs font-bold text-amber-300 backdrop-blur-sm">
              {t('hero.holdPhoneLevel', lang)}
            </div>
          )}

          {isAnalyzing && (
            <div className="bg-ink/80 absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center backdrop-blur-xs">
              <RefreshCw className="h-8 w-8 animate-spin text-white" />
              <p className="text-sm font-bold text-white sm:text-base">{t('hero.checkingWhere', lang)}</p>
            </div>
          )}
        </div>

        {/* Primary action */}
        <button
          id="btn-hero-pick-me-up"
          type="button"
          disabled={isAnalyzing || isLoadingGPS}
          onClick={handleSnapAndPickMeUp}
          className="giant-tap btn btn-danger w-full rounded-xl px-5 py-4 text-xl font-bold sm:py-5 sm:text-2xl"
        >
          <Camera className="h-6 w-6 sm:h-7 sm:w-7" />
          <span>{t('hero.pickMeUp', lang)}</span>
        </button>

        {/* Saved places — the senior's own, set in their profile */}
        {savedPlaces.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="section-kicker">{t('hero.orImAt', lang)}</span>
            {savedPlaces.map((place) => (
              <button
                key={place.kind}
                type="button"
                disabled={isAnalyzing}
                onClick={() => onPickMeUp(undefined, place)}
                className="btn btn-md btn-secondary text-sm"
              >
                <span aria-hidden="true">{SAVED_PLACE_META[place.kind].emoji}</span>
                <span>{savedPlaceLabel(place)}</span>
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenProfile}
            className="border-line text-ink-soft hover:border-pine hover:text-ink flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-2.5 text-sm font-bold transition-colors"
          >
            <Plus className="h-4 w-4" />
            {t('hero.savePlacesTip', lang)}
          </button>
        )}

        {/* Verified result */}
        {verification && (
          <div
            className={`space-y-2 rounded-xl border p-3 sm:p-4 ${
              verification.isIndoors
                ? 'border-ochre/40 bg-ochre-soft'
                : 'border-pine/40 bg-pine-soft'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-ink flex items-center gap-1.5 text-sm font-bold">
                {verification.isIndoors ? (
                  <Building2 className="text-ochre-deep h-4 w-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="text-pine-deep h-4 w-4 shrink-0" />
                )}
                {verification.isIndoors ? t('hero.youAreIndoors', lang) : t('hero.readyAtRoadside', lang)}
              </span>

              <button
                type="button"
                onClick={onSpeakAddress}
                className={`btn btn-md text-sm ${isSpeaking ? 'btn-danger' : 'btn-soft'}`}
              >
                <Volume2 className="h-4 w-4" />
                {isSpeaking ? t('hero.stop', lang) : t('hero.listen', lang)}
              </button>
            </div>

            {/* Street and postal code only — the full chain is unreadable aloud */}
            {conciseAddress && (
              <p className="text-ink text-base leading-snug font-bold sm:text-lg">{conciseAddress}</p>
            )}

            {verification.isIndoors ? (
              <p className="text-ink-soft flex items-start gap-1.5 text-sm leading-snug">
                <DoorOpen className="text-ochre-deep mt-0.5 h-4 w-4 shrink-0" />
                <span>{verification.indoorExitGuidance || t('hero.stepOutTip', lang)}</span>
              </p>
            ) : (
              driverHint && <p className="text-ink-soft text-sm leading-snug">{driverHint}</p>
            )}

            {/* Beacon detail, only when a registered beacon refined the pin */}
            {verification.bleAccuracyBoost && verification.bleBeacons?.[0] && (
              <p className="text-ink-soft flex items-center gap-1.5 border-t border-current/10 pt-2 text-xs font-bold">
                <Radio className="text-sky h-3.5 w-3.5" />
                {verification.bleBeacons[0].locationName} · ≈{verification.bleBeacons[0].estimatedDistanceMeters}m
              </p>
            )}
          </div>
        )}

        {/* Beacon scanning — secondary, interactive micro-location line */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 font-bold">
            <Radio
              className={`h-3.5 w-3.5 ${bleState.status === 'scanning' ? 'text-pine animate-pulse' : 'text-ink-faint'}`}
            />
            <span className={bleState.status === 'scanning' ? 'text-pine-deep' : 'text-ink-faint'}>
              {bleState.status === 'scanning'
                ? bleBeacons[0]
                  ? `${bleBeacons[0].source === 'geofence' ? t('hero.nearbyVenue', lang) : t('hero.bleActive', lang)} • ${bleBeacons[0].locationName} · ≈${bleBeacons[0].estimatedDistanceMeters}m`
                  : t('hero.bleScanning', lang)
                : bleState.status === 'unavailable'
                  ? t('hero.bleUnavailable', lang)
                  : t('hero.bleOff', lang)}
            </span>
          </div>

          {/* No toggle where scanning can never work (e.g. every iPhone browser);
              the explanation below is shown instead of a dead button. */}
          {!bleUnsupportedReason && (
            <button
              type="button"
              onClick={handleToggleBeacons}
              disabled={bleState.status === 'requesting'}
              className="text-pine hover:text-pine-deep -my-2 inline-flex min-h-[44px] items-center px-2 font-bold underline underline-offset-2 disabled:opacity-50"
            >
              {bleState.status === 'requesting' ? t('hero.starting', lang) : bleState.status === 'scanning' ? t('hero.turnOff', lang) : t('hero.turnOn', lang)}
            </button>
          )}
        </div>

        {/* Reasons are shown on screen: a hover tooltip never appears on a phone. */}
        {bleUnsupportedReason ? (
          <p className="text-ink-soft text-xs leading-snug">{t('hero.bleNotSupported', lang)}</p>
        ) : bleState.status === 'unavailable' && bleState.error ? (
          <p className="text-ink-soft text-xs leading-snug">{bleState.error}</p>
        ) : null}

        {/* Nearest beacons, only once something is actually detected */}
        {bleBeacons.length > 0 && bleState.status === 'scanning' && (
          <div className="text-ink-soft space-y-1 text-xs border-t border-line/60 pt-1.5">
            {bleBeacons.slice(0, 2).map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">
                  {b.isPairedTag ? '🏷️' : b.isKnownVenue ? '📍' : '📶'} {b.locationName}
                </span>
                <span className="shrink-0 font-mono font-bold text-pine">
                  ≈{b.estimatedDistanceMeters}m{b.source === 'geofence' ? ' (GPS)' : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
