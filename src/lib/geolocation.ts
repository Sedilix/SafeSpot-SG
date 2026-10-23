/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Geolocation } from '@capacitor/geolocation';
import { Language } from '../types';
import { t } from '../locales/translations';
import { isNativeApp } from './native';

// Capacitor's WebView already answers navigator.geolocation and getUserMedia
// by asking Android for the permission, so the existing calls keep working in
// the app. Two gaps remain:
// - It keeps a single pending permission callback, so two location calls made
//   before the first answer (start-up GPS plus a watch) leave one hanging.
//   Asking once up front through @capacitor/geolocation avoids that, and also
//   tells us when the phone's Location switch is off.
// - After "Don't allow" Android stops asking, so the messages have to send an
//   app user to Android Settings instead of a browser prompt.

/** 'off' means the phone's Location switch is off, not a denied permission. */
export type LocationAccess = 'ok' | 'denied' | 'off';

let pending: Promise<LocationAccess> | null = null;

/** Asks Android for location once (shared by concurrent callers). Always 'ok' on the website. */
export function ensureLocationPermission(): Promise<LocationAccess> {
  if (!isNativeApp()) return Promise.resolve('ok');
  if (!pending) {
    pending = (async (): Promise<LocationAccess> => {
      try {
        let status = await Geolocation.checkPermissions();
        if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
          status = await Geolocation.requestPermissions();
        }
        // Approximate-only (Android 12+) still works through the WebView.
        return status.location === 'granted' || status.coarseLocation === 'granted' ? 'ok' : 'denied';
      } catch (err: any) {
        // The plugin rejects every permission call while Location is switched off.
        // (OS-PLUG-GLOC-0007, "Location services are not enabled.")
        if (err?.code === 'OS-PLUG-GLOC-0007' || /not enabled/i.test(String(err?.message))) return 'off';
        // Anything else: let the WebView's own prompt have a go.
        console.warn('Location permission check failed:', err);
        return 'ok';
      }
    })().finally(() => {
      pending = null;
    });
  }
  return pending;
}

/** Shaped like GeolocationPositionError so existing error callbacks keep working. */
const accessError = (access: Exclude<LocationAccess, 'ok'>) =>
  ({
    code: access === 'denied' ? 1 : 2,
    message: access === 'denied' ? 'Location permission denied' : 'Location services are off',
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
    locationOff: access === 'off',
  }) as GeolocationPositionError & { locationOff: boolean };

/** navigator.geolocation.getCurrentPosition, asking for the Android permission first in the app. */
export function getCurrentPosition(
  success: PositionCallback,
  error?: PositionErrorCallback | null,
  options?: PositionOptions,
): void {
  if (!isNativeApp()) {
    navigator.geolocation.getCurrentPosition(success, error, options);
    return;
  }
  void ensureLocationPermission().then((access) => {
    if (access === 'ok') navigator.geolocation.getCurrentPosition(success, error, options);
    else error?.(accessError(access));
  });
}

/**
 * navigator.geolocation.watchPosition, asking for the Android permission first
 * in the app. Returns a function that stops the watch (safe to call before the
 * permission answer arrives).
 */
export function watchPosition(
  success: PositionCallback,
  error?: PositionErrorCallback | null,
  options?: PositionOptions,
): () => void {
  if (!isNativeApp()) {
    const id = navigator.geolocation.watchPosition(success, error, options);
    return () => navigator.geolocation.clearWatch(id);
  }
  let id: number | null = null;
  let stopped = false;
  void ensureLocationPermission().then((access) => {
    if (stopped) return;
    if (access === 'ok') id = navigator.geolocation.watchPosition(success, error, options);
    else error?.(accessError(access));
  });
  return () => {
    stopped = true;
    if (id !== null) navigator.geolocation.clearWatch(id);
  };
}

// Android-specific wording. Lives here rather than in translations.ts so the
// website strings stay untouched; only shown inside the app.
const APP_TEXT: Record<string, Record<Language, string>> = {
  'app.locationDenied': {
    en: 'SafeSpot SG cannot use your location. Open Android Settings > Apps > SafeSpot SG > Permissions, allow Location, then try again.',
    zh: 'SafeSpot SG 无法使用您的位置。请打开 Android“设置”>“应用”>“SafeSpot SG”>“权限”，允许“位置信息”，然后重试。',
    ms: 'SafeSpot SG tidak dapat menggunakan lokasi anda. Buka Tetapan Android > Apl > SafeSpot SG > Kebenaran, benarkan Lokasi, kemudian cuba lagi.',
    ta: 'SafeSpot SG உங்கள் இருப்பிடத்தைப் பயன்படுத்த முடியவில்லை. Android அமைப்புகள் > ஆப்ஸ் > SafeSpot SG > அனுமதிகள் என்பதைத் திறந்து, இருப்பிடத்தை அனுமதித்து, மீண்டும் முயலவும்.',
  },
  'app.locationOff': {
    en: "Your phone's Location is switched off. Swipe down from the top of the screen, turn on Location, then try again.",
    zh: '手机的定位功能已关闭。请从屏幕顶部向下滑动，开启“位置信息”，然后重试。',
    ms: 'Lokasi telefon anda dimatikan. Leret ke bawah dari bahagian atas skrin, hidupkan Lokasi, kemudian cuba lagi.',
    ta: 'உங்கள் தொலைபேசியின் இருப்பிடம் முடக்கப்பட்டுள்ளது. திரையின் மேலிருந்து கீழே இழுத்து, இருப்பிடத்தை இயக்கி, மீண்டும் முயலவும்.',
  },
  'app.micDenied': {
    en: 'SafeSpot SG cannot use the microphone. Open Android Settings > Apps > SafeSpot SG > Permissions and allow Microphone.',
    zh: 'SafeSpot SG 无法使用麦克风。请打开 Android“设置”>“应用”>“SafeSpot SG”>“权限”，允许“麦克风”。',
    ms: 'SafeSpot SG tidak dapat menggunakan mikrofon. Buka Tetapan Android > Apl > SafeSpot SG > Kebenaran dan benarkan Mikrofon.',
    ta: 'SafeSpot SG மைக்ரோஃபோனைப் பயன்படுத்த முடியவில்லை. Android அமைப்புகள் > ஆப்ஸ் > SafeSpot SG > அனுமதிகள் என்பதைத் திறந்து மைக்ரோஃபோனை அனுமதிக்கவும்.',
  },
  'app.cameraDenied': {
    en: 'SafeSpot SG cannot use the camera. Open Android Settings > Apps > SafeSpot SG > Permissions and allow Camera.',
    zh: 'SafeSpot SG 无法使用相机。请打开 Android“设置”>“应用”>“SafeSpot SG”>“权限”，允许“相机”。',
    ms: 'SafeSpot SG tidak dapat menggunakan kamera. Buka Tetapan Android > Apl > SafeSpot SG > Kebenaran dan benarkan Kamera.',
    ta: 'SafeSpot SG கேமராவைப் பயன்படுத்த முடியவில்லை. Android அமைப்புகள் > ஆப்ஸ் > SafeSpot SG > அனுமதிகள் என்பதைத் திறந்து கேமராவை அனுமதிக்கவும்.',
  },
};

/**
 * In the app, the message key for a refused location, microphone or camera
 * request; null on the website or for any other failure, so callers fall back
 * to their existing key.
 */
export function appPermissionKey(err: any, kind: 'location' | 'microphone' | 'camera'): string | null {
  if (!isNativeApp() || !err) return null;
  if (kind === 'location') {
    if (err.locationOff) return 'app.locationOff';
    return err.code === 1 ? 'app.locationDenied' : null;
  }
  if (err.name !== 'NotAllowedError' && err.name !== 'PermissionDeniedError') return null;
  return kind === 'microphone' ? 'app.micDenied' : 'app.cameraDenied';
}

/** t() that also knows the app-only keys above. */
export function permissionText(key: string, lang: Language): string {
  const entry = APP_TEXT[key];
  return entry ? entry[lang] || entry.en : t(key, lang);
}
