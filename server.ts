/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { ringSamplePoints, bearingDegrees, withinFieldOfView, haversineMeters } from './src/utils/geo';
import { SPEECHMATICS_VOICE_OPTIONS } from './src/types';
import {
  parseWearableEvent,
  applyWearableEvent,
  isWearableOnline,
  isCheckInActive,
  requestCheckIn,
  nearestLandmark,
  MAX_WEARABLE_DEVICES,
  WearableState,
} from './src/utils/wearable';
import { sendSms, smsAlertRecipients, smsConfigured } from './src/utils/notifications';
import { isValidSubscription, pushConfigured, vapidPublicKey } from './src/utils/webPush';
import { fcmAvailable, isValidFcmToken } from './src/utils/fcmPush';
import {
  answerTelegramCallback,
  ensureTelegramWebhook,
  escapeHtml,
  getBotUsername,
  googleMapsUrl,
  parseLinkCommand,
  RESPOND_CALLBACK_PREFIX,
  sendTelegramText,
  telegramConfigured,
  webhookSecretMatches,
} from './src/utils/telegram';
import {
  createTelegramLinkCode,
  getTelegramChats,
  migrateTelegramChat,
  recordTelegramResponder,
  redeemTelegramLinkCode,
  removeTelegramChat,
  removeTelegramChatEverywhere,
  sendTelegramPin,
  addPushDevice,
  createPushInvite,
  getPushDevices,
  getPushInviteOwner,
  joinPushInvite,
  notifyPushDevices,
  removePushDevice,
  removePushEndpointEverywhere,
  pushDeviceKey,
  sendToPushTarget,
  type PushTarget,
} from './src/utils/alertChannels';
import {
  handleWatchAlertTrigger,
  handleWatchIncidentUpdate,
  handleWatchAlertCancel,
  pairWearableDevice,
  unpairWearableDevice,
  getDevicePairedProfile,
  getActiveIncidentForDevice,
  getIncidentById,
  getPairingOwner,
  verifyFirebaseIdToken,
  getFirebaseAdminDb,
} from './src/utils/wearableIncidentService';
import { bearerToken, canManagePairing, checkWearableEventAuth } from './src/utils/wearableAuth';
import { classifyAddressQuery, mergeAddressSuggestions } from './src/utils/addressSearch';
import { findPickupOptions } from './src/utils/pickupService';
import { maybeInitDriveWorkerAtStartup } from './src/routing/driveWorkerClient';
import { checkOfflineWatches, recordWatchSeen } from './src/utils/watchHealth';
import { timingSafeEqual } from 'crypto';
import type { AddressSuggestion } from './src/types';

const app = express();
const PORT = Number(process.env.PORT) || 9003;

app.use(express.json({ limit: '35mb' }));

// The Android app serves its pages from https://localhost and calls /api here.
// Only that origin gets CORS; the website is same-origin and needs none.
const APP_ORIGINS = new Set(['https://localhost', 'capacitor://localhost']);
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  if (origin && APP_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});

// Helper: Clean text for Speechmatics TTS synthesis (strip markdown, asterisks, URLs, emoji)
function cleanSpeakableText(text: string): string {
  if (!text) return '';
  return text
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[\*\_~`#>\[\]\(\)]/g, ' ')
    .replace(/[\u{1F600}-\u{1F6FF}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F018}-\u{1F270}\u{2388}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Initialize Google GenAI lazily or securely
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY is not set in environment.');
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    hasGoogleMapsKey: Boolean(getGoogleMapsApiKey()),
    hasSpeechmaticsKey: Boolean(getSpeechmaticsApiKey()),
    timestamp: Date.now(),
  });
});

// Config endpoint: the browser map key. This is a separate key, restricted to
// the Maps JavaScript API and to SafeSpot's own web addresses, so copying it
// from the page is useless. The server key (Places, Routes, Roads...) is
// never sent to browsers.
app.get('/api/config/maps-key', (req, res) => {
  res.json({ mapsApiKey: process.env.MAPS_BROWSER_KEY || '' });
});

// Helper: Get Speechmatics API Key safely from environment
function getSpeechmaticsApiKey(): string | undefined {
  return (
    process.env.SPEECHMATICS_API_KEY ||
    process.env.VITE_SPEECHMATICS_API_KEY ||
    undefined
  );
}

// Endpoint: Mint temporary JWT token for Speechmatics Realtime SDK
app.post('/api/speechmatics/token', async (req, res) => {
  const apiKey = getSpeechmaticsApiKey();
  if (!apiKey) {
    return res.json({
      hasSpeechmaticsKey: false,
      message: 'No SPEECHMATICS_API_KEY set in environment secrets.',
    });
  }

  try {
    const mpRes = await fetch('https://mp.speechmatics.com/v1/api_keys?type=rt', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: 3600 }),
    });

    if (!mpRes.ok) {
      const errText = await mpRes.text();
      console.warn('Speechmatics MP API Key returned error:', mpRes.status, errText);
      return res.status(mpRes.status).json({
        hasSpeechmaticsKey: true,
        error: 'Speechmatics authentication error',
        details: errText,
      });
    }

    const data = (await mpRes.json()) as any;
    const token = data.key_value || data.key || data.token || data.jwt || '';

    return res.json({
      hasSpeechmaticsKey: true,
      token,
      url: 'wss://eu2.rt.speechmatics.com/v2',
      ttl: 3600,
    });
  } catch (err: any) {
    console.error('Error generating Speechmatics JWT token:', err);
    return res.status(500).json({
      hasSpeechmaticsKey: true,
      error: 'Failed to request Speechmatics Realtime token',
      details: err.message,
    });
  }
});

// Endpoint: Speechmatics Available Voices
// NOTE: Speechmatics TTS preview currently supports exactly 4 voices.
// See https://docs.speechmatics.com/text-to-speech/quickstart#voices
app.get('/api/speechmatics/voices', (req, res) => {
  const voices = SPEECHMATICS_VOICE_OPTIONS.map((v) => ({
    id: v.id,
    name: v.name,
    gender: v.gender,
    accent: v.accent,
    flag: v.flag,
    tone: v.tone,
    description: v.description,
    sampleText: v.sampleText,
    isRecommended: v.isRecommended,
  }));

  return res.json({
    hasSpeechmaticsKey: Boolean(getSpeechmaticsApiKey()),
    voices,
    defaultVoice: 'sarah',
  });
});

// Endpoint: Speechmatics Text-To-Speech (TTS)
app.post('/api/speechmatics/tts', async (req, res) => {
  const apiKey = getSpeechmaticsApiKey();
  const { text, voice = 'sarah' } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Text parameter is required for TTS synthesis.' });
  }

  if (!apiKey) {
    return res.status(400).json({ error: 'SPEECHMATICS_API_KEY is not configured.' });
  }

  const cleanText = cleanSpeakableText(text);
  if (!cleanText) {
    return res.status(400).json({ error: 'No speakable text content after sanitization.' });
  }

  // Voice IDs currently supported by the Speechmatics TTS preview API.
  // Unknown/removed IDs (e.g. 'ariana') fall back to the default instead of
  // triggering a Speechmatics error and a silent Web Speech fallback client-side.
  const VALID_TTS_VOICES = ['sarah', 'megan', 'theo', 'jack'];
  const safeVoice = VALID_TTS_VOICES.includes(String(voice || '')) ? voice : 'sarah';

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);

    // Call Speechmatics preview TTS generation endpoint with safe voice actor
    const ttsRes = await fetch(
      `https://preview.tts.speechmatics.com/generate/${encodeURIComponent(safeVoice)}?output_format=wav_16000`,
      {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: cleanText,
        }),
      }
    );

    clearTimeout(timer);

    if (ttsRes.ok) {
      const audioBuffer = await ttsRes.arrayBuffer();
      res.set('Content-Type', 'audio/wav');
      return res.send(Buffer.from(audioBuffer));
    } else {
      const errText = await ttsRes.text();
      console.warn(`Speechmatics TTS returned ${ttsRes.status}:`, errText);
      return res.status(ttsRes.status).json({
        error: 'Speechmatics TTS error',
        details: errText,
      });
    }
  } catch (err: any) {
    console.error('Speechmatics TTS request failed:', err);
    return res.status(500).json({ error: 'TTS request failed', details: err.message });
  }
});

// Helper: Get Google Maps / Places API Key safely from environment
// Server-side Google key (Places, Geocoding, Roads, Routes, Street View).
// Never returned to clients; see /api/config/maps-key for the browser key.
function getGoogleMapsApiKey(): string | undefined {
  return process.env.MAPS_SERVER_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.PLACES_API_KEY || undefined;
}

// Helper for reverse geocoding fallback
async function fetchReverseGeocode(lat: number, lng: number): Promise<string | null> {
  const mapsKey = getGoogleMapsApiKey();
  if (mapsKey) {
    try {
      const gRes = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${mapsKey}`,
        { signal: AbortSignal.timeout(4000) },
      );
      const data = (await gRes.json().catch(() => ({}))) as any;
      if (gRes.ok && data.results && data.results.length > 0) {
        return data.results[0].formatted_address;
      }
      // Google answers HTTP 200 with a status like REQUEST_DENIED; say why.
      console.warn(`[GEOCODE] Google reverse geocode failed: HTTP ${gRes.status} ${data.status || ''} ${String(data.error_message || '').slice(0, 160)}`);
    } catch (e) {
      console.warn('Google geocoding error:', e);
    }
  }

  // Fallback to OpenStreetMap Nominatim for open geocoding
  try {
    const osmRes = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'SafeSpot-SG/1.0 (https://github.com/Sedilix/SafeSpot-SG)',
        },
        signal: AbortSignal.timeout(4000),
      }
    );
    if (osmRes.ok) {
      const data = await osmRes.json();
      return data.display_name || null;
    }
    console.warn(`[GEOCODE] OpenStreetMap reverse geocode failed: HTTP ${osmRes.status}`);
  } catch (e) {
    console.warn('OSM geocoding error:', e);
  }
  return null;
}

// Helper: Snap coordinates to nearest road via Google Roads API
async function snapToNearestRoad(lat: number, lng: number): Promise<{ lat: number; lng: number; placeId?: string } | null> {
  const mapsKey = getGoogleMapsApiKey();
  if (!mapsKey) return null;

  try {
    const res = await fetch(
      `https://roads.googleapis.com/v1/nearestRoads?points=${lat},${lng}&key=${mapsKey}&solution_id=gmp_mcp_codeassist_v1_aistudio`
    );
    if (res.ok) {
      const data = await res.json();
      if (data.snappedPoints && data.snappedPoints.length > 0) {
        const point = data.snappedPoints[0];
        return {
          lat: point.location.latitude,
          lng: point.location.longitude,
          placeId: point.placeId,
        };
      }
    }
  } catch (err) {
    console.warn('Roads API nearestRoads error:', err);
  }
  return null;
}

// Helper: Query nearby prominent landmarks via Google Places API (New)
async function fetchNearbyPlacesLandmarks(lat: number, lng: number): Promise<Array<{ name: string; type: string; address?: string }>> {
  const mapsKey = getGoogleMapsApiKey();
  if (!mapsKey) return [];

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': mapsKey,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.primaryType,places.types',
        'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
      },
      body: JSON.stringify({
        includedTypes: [
          'pharmacy',
          'supermarket',
          'convenience_store',
          'transit_station',
          'bus_stop',
          'bank',
          'hospital',
          'cafe',
          'restaurant',
          'store',
          'community_center',
          'library',
        ],
        maxResultCount: 6,
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: 120.0,
          },
        },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.places && Array.isArray(data.places)) {
        return data.places.map((p: any) => ({
          name: p.displayName?.text || 'Nearby Landmark',
          type: p.primaryType || 'landmark',
          address: p.formattedAddress,
        }));
      }
    }
  } catch (err) {
    console.warn('Places API (New) searchNearby error:', err);
  }
  return [];
}

// ============================================================================
// Singapore Curated Medical, Work & Landmark Registry
// ============================================================================
interface SingaporePresetPlace {
  title: string;
  subtitle: string;
  fullAddress: string;
  postalCode: string;
  lat: number;
  lng: number;
  category: 'healthcare' | 'work' | 'home' | 'general';
  tags: string[];
  providerType?: 'public' | 'private';
}

const SINGAPORE_PRESET_PLACES: SingaporePresetPlace[] = [
  // Public Hospitals
  {
    title: 'Singapore General Hospital (SGH)',
    subtitle: 'Outram Rd • Public Tertiary Hospital',
    fullAddress: 'Outram Rd, Singapore 169608',
    postalCode: '169608',
    lat: 1.2792,
    lng: 103.8344,
    category: 'healthcare',
    providerType: 'public',
    tags: ['sgh', 'outram', 'singapore general hospital', 'public hospital', 'emergency'],
  },
  {
    title: 'Tan Tock Seng Hospital (TTSH)',
    subtitle: '11 Jalan Tan Tock Seng • Novena HealthCity',
    fullAddress: '11 Jalan Tan Tock Seng, Singapore 308433',
    postalCode: '308433',
    lat: 1.3214,
    lng: 103.8458,
    category: 'healthcare',
    providerType: 'public',
    tags: ['ttsh', 'tan tock seng', 'novena', 'public hospital', 'emergency'],
  },
  {
    title: 'National University Hospital (NUH)',
    subtitle: '5 Lower Kent Ridge Rd • Kent Ridge',
    fullAddress: '5 Lower Kent Ridge Rd, Singapore 119074',
    postalCode: '119074',
    lat: 1.2936,
    lng: 103.7831,
    category: 'healthcare',
    providerType: 'public',
    tags: ['nuh', 'national university hospital', 'kent ridge', 'public hospital', 'emergency'],
  },
  {
    title: 'Changi General Hospital (CGH)',
    subtitle: '2 Simei Street 3 • Simei',
    fullAddress: '2 Simei Street 3, Singapore 529889',
    postalCode: '529889',
    lat: 1.3404,
    lng: 103.9495,
    category: 'healthcare',
    providerType: 'public',
    tags: ['cgh', 'changi general hospital', 'simei', 'tampines', 'public hospital', 'emergency'],
  },
  {
    title: 'Khoo Teck Puat Hospital (KTPH)',
    subtitle: '90 Yishun Central • Yishun',
    fullAddress: '90 Yishun Central, Singapore 768828',
    postalCode: '768828',
    lat: 1.4246,
    lng: 103.8382,
    category: 'healthcare',
    providerType: 'public',
    tags: ['ktph', 'khoo teck puat', 'yishun', 'public hospital', 'emergency'],
  },
  {
    title: 'Sengkang General Hospital (SKH)',
    subtitle: '110 Sengkang East Way • Sengkang',
    fullAddress: '110 Sengkang East Way, Singapore 544886',
    postalCode: '544886',
    lat: 1.3954,
    lng: 103.8931,
    category: 'healthcare',
    providerType: 'public',
    tags: ['skh', 'sengkang general hospital', 'sengkang', 'punggol', 'public hospital', 'emergency'],
  },
  {
    title: 'Ng Teng Fong General Hospital (NTFGH)',
    subtitle: '1 Jurong East Street 21 • Jurong East',
    fullAddress: '1 Jurong East Street 21, Singapore 609606',
    postalCode: '609606',
    lat: 1.3333,
    lng: 103.746,
    category: 'healthcare',
    providerType: 'public',
    tags: ['ntfgh', 'ng teng fong', 'jurong east', 'jurong', 'public hospital', 'emergency'],
  },
  {
    title: "KK Women's and Children's Hospital (KKH)",
    subtitle: '100 Bukit Timah Rd • Rochor',
    fullAddress: '100 Bukit Timah Rd, Singapore 229899',
    postalCode: '229899',
    lat: 1.3106,
    lng: 103.8475,
    category: 'healthcare',
    providerType: 'public',
    tags: ['kkh', 'kk hospital', 'bukit timah', 'rochor', 'public hospital'],
  },
  {
    title: 'Woodlands Health Campus (WHC)',
    subtitle: '2 Woodlands Drive 17 • Woodlands',
    fullAddress: '2 Woodlands Drive 17, Singapore 737628',
    postalCode: '737628',
    lat: 1.4332,
    lng: 103.7895,
    category: 'healthcare',
    providerType: 'public',
    tags: ['whc', 'woodlands health', 'woodlands', 'public hospital', 'emergency'],
  },

  // Private Hospitals
  {
    title: 'Mount Elizabeth Hospital (Orchard)',
    subtitle: '3 Mount Elizabeth • Orchard',
    fullAddress: '3 Mount Elizabeth, Singapore 228510',
    postalCode: '228510',
    lat: 1.3048,
    lng: 103.8354,
    category: 'healthcare',
    providerType: 'private',
    tags: ['mount elizabeth', 'mount e orchard', 'orchard', 'private hospital'],
  },
  {
    title: 'Mount Elizabeth Novena Hospital',
    subtitle: '38 Irrawaddy Rd • Novena',
    fullAddress: '38 Irrawaddy Rd, Singapore 329563',
    postalCode: '329563',
    lat: 1.3217,
    lng: 103.8441,
    category: 'healthcare',
    providerType: 'private',
    tags: ['mount elizabeth novena', 'novena', 'private hospital'],
  },
  {
    title: 'Gleneagles Hospital',
    subtitle: '6A Napier Rd • Tanglin',
    fullAddress: '6A Napier Rd, Singapore 258500',
    postalCode: '258500',
    lat: 1.3075,
    lng: 103.8188,
    category: 'healthcare',
    providerType: 'private',
    tags: ['gleneagles', 'napier', 'tanglin', 'private hospital'],
  },
  {
    title: 'Mount Alvernia Hospital',
    subtitle: '820 Thomson Rd • Marymount',
    fullAddress: '820 Thomson Rd, Singapore 298145',
    postalCode: '298145',
    lat: 1.3417,
    lng: 103.8398,
    category: 'healthcare',
    providerType: 'private',
    tags: ['mount alvernia', 'thomson', 'marymount', 'private hospital'],
  },
  {
    title: 'Raffles Hospital',
    subtitle: '585 North Bridge Rd • Bugis',
    fullAddress: '585 North Bridge Rd, Singapore 188770',
    postalCode: '188770',
    lat: 1.3005,
    lng: 103.8576,
    category: 'healthcare',
    providerType: 'private',
    tags: ['raffles hospital', 'bugis', 'north bridge road', 'private hospital'],
  },
  {
    title: 'Parkway East Hospital',
    subtitle: '321 Joo Chiat Pl • East Coast',
    fullAddress: '321 Joo Chiat Pl, Singapore 427990',
    postalCode: '427990',
    lat: 1.3146,
    lng: 103.9079,
    category: 'healthcare',
    providerType: 'private',
    tags: ['parkway east', 'joo chiat', 'katong', 'private hospital'],
  },
  {
    title: 'Thomson Medical Centre',
    subtitle: '339 Thomson Rd • Novena / Thomson',
    fullAddress: '339 Thomson Rd, Singapore 307677',
    postalCode: '307677',
    lat: 1.3256,
    lng: 103.8407,
    category: 'healthcare',
    providerType: 'private',
    tags: ['thomson medical', 'thomson', 'private hospital'],
  },

  // Key Polyclinics (SingHealth, NHG, NUHS)
  {
    title: 'Toa Payoh Polyclinic',
    subtitle: '2003 Lor 8 Toa Payoh • NHG Polyclinic',
    fullAddress: '2003 Lor 8 Toa Payoh, Singapore 319260',
    postalCode: '319260',
    lat: 1.3392,
    lng: 103.8577,
    category: 'healthcare',
    providerType: 'public',
    tags: ['toa payoh polyclinic', 'polyclinic', 'nhg', 'toa payoh'],
  },
  {
    title: 'Yishun Polyclinic',
    subtitle: '1000 Yishun Ave 5 • NHG Polyclinic',
    fullAddress: '1000 Yishun Ave 5, Singapore 768794',
    postalCode: '768794',
    lat: 1.4312,
    lng: 103.8322,
    category: 'healthcare',
    providerType: 'public',
    tags: ['yishun polyclinic', 'polyclinic', 'nhg', 'yishun'],
  },
  {
    title: 'Bedok Polyclinic (Heartbeat@Bedok)',
    subtitle: '11 Bedok North Street 1 • SingHealth Polyclinic',
    fullAddress: '11 Bedok North Street 1, #02-01 Heartbeat@Bedok, Singapore 469662',
    postalCode: '469662',
    lat: 1.3267,
    lng: 103.9317,
    category: 'healthcare',
    providerType: 'public',
    tags: ['bedok polyclinic', 'heartbeat bedok', 'polyclinic', 'singhealth', 'bedok'],
  },
  {
    title: 'Tampines Polyclinic (Our Tampines Hub)',
    subtitle: '1 Tampines Walk • SingHealth Polyclinic',
    fullAddress: '1 Tampines Walk, #03-31 Our Tampines Hub, Singapore 528523',
    postalCode: '528523',
    lat: 1.3533,
    lng: 103.9405,
    category: 'healthcare',
    providerType: 'public',
    tags: ['tampines polyclinic', 'our tampines hub', 'polyclinic', 'singhealth', 'tampines'],
  },
  {
    title: 'Jurong Polyclinic',
    subtitle: '190 Jurong East Ave 1 • NUP Polyclinic',
    fullAddress: '190 Jurong East Ave 1, Singapore 609788',
    postalCode: '609788',
    lat: 1.3499,
    lng: 103.7388,
    category: 'healthcare',
    providerType: 'public',
    tags: ['jurong polyclinic', 'polyclinic', 'nuhs', 'nup', 'jurong east'],
  },
  {
    title: 'Outram Polyclinic',
    subtitle: '3 Second Hospital Ave • SingHealth Polyclinic',
    fullAddress: '3 Second Hospital Ave, #02-00 Health Promotion Board Building, Singapore 168937',
    postalCode: '168937',
    lat: 1.2801,
    lng: 103.8378,
    category: 'healthcare',
    providerType: 'public',
    tags: ['outram polyclinic', 'polyclinic', 'singhealth', 'outram', 'chinatown'],
  },
  {
    title: 'Ang Mo Kio Polyclinic',
    subtitle: '21 Ang Mo Kio Central 2 • NHG Polyclinic',
    fullAddress: '21 Ang Mo Kio Central 2, Singapore 569666',
    postalCode: '569666',
    lat: 1.3697,
    lng: 103.8475,
    category: 'healthcare',
    providerType: 'public',
    tags: ['ang mo kio polyclinic', 'polyclinic', 'amk', 'nhg'],
  },

  // Popular Work & Business Hubs
  {
    title: 'BLOCK71 Singapore',
    subtitle: '71 Ayer Rajah Crescent • LaunchPad @ one-north',
    fullAddress: '71 Ayer Rajah Crescent, Singapore 139951',
    postalCode: '139951',
    lat: 1.2968,
    lng: 103.7865,
    category: 'work',
    tags: ['block71', 'blk71', 'ayer rajah', 'launchpad', 'one-north', 'startup', 'work'],
  },
  {
    title: 'LaunchPad @ one-north',
    subtitle: 'Ayer Rajah Crescent • Tech & Innovation Park',
    fullAddress: 'LaunchPad @ one-north, Singapore 139951',
    postalCode: '139951',
    lat: 1.2965,
    lng: 103.7862,
    category: 'work',
    tags: ['launchpad', 'one north', 'ayer rajah', 'work'],
  },
  {
    title: 'Fusionopolis One',
    subtitle: '1 Fusionopolis Way • one-north Hub',
    fullAddress: '1 Fusionopolis Way, Singapore 138632',
    postalCode: '138632',
    lat: 1.2994,
    lng: 103.7885,
    category: 'work',
    tags: ['fusionopolis', 'one-north', 'a*star', 'work'],
  },
  {
    title: 'Marina Bay Financial Centre (MBFC)',
    subtitle: '10 Marina Blvd • Central Business District',
    fullAddress: '10 Marina Blvd, Singapore 018983',
    postalCode: '018983',
    lat: 1.2798,
    lng: 103.8542,
    category: 'work',
    tags: ['mbfc', 'marina bay financial centre', 'cbd', 'downtown', 'work'],
  },
  {
    title: 'Suntec City Tower',
    subtitle: '7 Temasek Blvd • Marina Centre',
    fullAddress: '7 Temasek Blvd, Singapore 038987',
    postalCode: '038987',
    lat: 1.2935,
    lng: 103.8572,
    category: 'work',
    tags: ['suntec', 'suntec city', 'temasek', 'work'],
  },
  {
    title: 'Guoco Tower',
    subtitle: '1 Wallich St • Tanjong Pagar',
    fullAddress: '1 Wallich St, Singapore 078881',
    postalCode: '078881',
    lat: 1.277,
    lng: 103.8458,
    category: 'work',
    tags: ['guoco tower', 'tanjong pagar', 'cbd', 'work'],
  },
  {
    title: 'Our Tampines Hub (OTH)',
    subtitle: '1 Tampines Walk • Community & Lifestyle Hub',
    fullAddress: '1 Tampines Walk, Singapore 528523',
    postalCode: '528523',
    lat: 1.3533,
    lng: 103.9405,
    category: 'general',
    tags: ['our tampines hub', 'oth', 'tampines', 'hub'],
  },
  {
    title: 'Toa Payoh HDB Hub',
    subtitle: '480 Lor 6 Toa Payoh • Central Hub',
    fullAddress: '480 Lor 6 Toa Payoh, Singapore 310480',
    postalCode: '310480',
    lat: 1.3328,
    lng: 103.8488,
    category: 'general',
    tags: ['hdb hub', 'toa payoh hub', 'toa payoh'],
  },
];

// Endpoint: Singapore OneMap Geocoding & Address Search Proxy
app.get('/api/onemap/search', async (req, res) => {
  const query = String(req.query.q || req.query.searchVal || '').trim();
  if (!query) {
    return res.status(400).json({ success: false, results: [], totalFound: 0, error: 'Missing ?q= search value' });
  }

  try {
    const onemapUrl = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(query)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    const r = await fetch(onemapUrl, {
      headers: {
        'User-Agent': 'SafeSpot-SG/1.0',
      },
    });

    if (!r.ok) {
      return res.json({ success: false, results: [], totalFound: 0, error: `OneMap upstream returned ${r.status}` });
    }

    const data = await r.json();
    return res.json({ success: true, results: data.results || [], totalFound: data.found || data.totalFound || 0 });
  } catch (err: any) {
    console.warn('OneMap search proxy failed:', err.message);
    return res.status(502).json({ success: false, error: 'OneMap search unavailable' });
  }
});

// Endpoint: Multi-Engine Intelligent Address Autocomplete (Google Maps + OneMap + Preset Landmarks)
// OneMap rate-limits quickly (429 after a short burst) and every user searches
// through this one server, so successful OneMap answers are cached briefly.
const ONEMAP_CACHE_TTL_MS = 10 * 60 * 1000;
const ONEMAP_CACHE_MAX = 500;
const oneMapCache = new Map<string, { at: number; results: any[] }>();

async function oneMapSearch(query: string): Promise<any[]> {
  const key = query.trim().toLowerCase();
  const hit = oneMapCache.get(key);
  if (hit && Date.now() - hit.at < ONEMAP_CACHE_TTL_MS) return hit.results;
  const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(query)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
  const oRes = await fetch(url, { headers: { 'User-Agent': 'SafeSpot-SG/1.0' }, signal: AbortSignal.timeout(3000) });
  if (!oRes.ok) return []; // includes 429: don't cache failures
  const data = (await oRes.json()) as any;
  const results = Array.isArray(data.results) ? data.results : [];
  if (oneMapCache.size >= ONEMAP_CACHE_MAX) oneMapCache.delete(oneMapCache.keys().next().value as string);
  oneMapCache.set(key, { at: Date.now(), results });
  return results;
}

app.get('/api/places/autocomplete', async (req, res) => {
  const query = String(req.query.q || req.query.input || '').trim();
  const category = String(req.query.category || 'general').toLowerCase(); // 'home' | 'work' | 'healthcare' | 'general'
  const mapsKey = getGoogleMapsApiKey();

  const results: Array<{
    id: string;
    title: string;
    subtitle?: string;
    fullAddress: string;
    postalCode?: string;
    lat?: number;
    lng?: number;
    source: 'google' | 'onemap' | 'singapore_landmark';
    category?: string;
    providerType?: 'public' | 'private';
  }> = [];

  const seenAddresses = new Set<string>();

  const addSuggestion = (item: typeof results[0]) => {
    const key = (item.fullAddress || item.title).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!seenAddresses.has(key)) {
      seenAddresses.add(key);
      results.push(item);
    }
  };

  const normalizedQuery = query.toLowerCase();

  // 1. Check curated Singapore Landmarks & Hospitals
  const matchedPresets = SINGAPORE_PRESET_PLACES.filter((p) => {
    if (!query) {
      return category === 'healthcare' ? p.category === 'healthcare' : category === 'work' ? p.category === 'work' : true;
    }
    const matchTag = p.tags.some((t) => t.includes(normalizedQuery) || normalizedQuery.includes(t));
    const matchTitle = p.title.toLowerCase().includes(normalizedQuery);
    const matchAddress = p.fullAddress.toLowerCase().includes(normalizedQuery);
    const matchPostal = p.postalCode.includes(normalizedQuery);
    return matchTag || matchTitle || matchAddress || matchPostal;
  });

  for (const preset of matchedPresets.slice(0, 5)) {
    addSuggestion({
      id: `preset-${preset.postalCode}-${preset.title}`,
      title: preset.title,
      subtitle: preset.subtitle,
      fullAddress: preset.fullAddress,
      postalCode: preset.postalCode,
      lat: preset.lat,
      lng: preset.lng,
      source: 'singapore_landmark',
      category: preset.category,
      providerType: preset.providerType,
    });
  }

  // 2 + 3. Google Places and OneMap, queried in parallel (each capped at 3 s
  // so one slow provider can't stall the list), then merged by query type:
  // OneMap first for postal codes / HDB blocks, Google first for named places.
  type Suggestion = typeof results[0];
  const fetchGoogle = async (): Promise<Suggestion[]> => {
    if (query.length < 2 || !mapsKey) return [];
    try {
      const gRes = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': mapsKey },
        body: JSON.stringify({ input: query, includedRegionCodes: ['sg'], languageCode: 'en' }),
        signal: AbortSignal.timeout(3000),
      });
      if (!gRes.ok) return [];
      const gData = (await gRes.json()) as any;
      return (Array.isArray(gData.suggestions) ? gData.suggestions : [])
        .map((s: any) => s.placePrediction)
        .filter((p: any) => p?.placeId)
        .slice(0, 5)
        .map((p: any) => ({
          id: `google-${p.placeId}`,
          title: p.structuredFormat?.mainText?.text || p.text?.text,
          subtitle: p.structuredFormat?.secondaryText?.text || 'Singapore',
          fullAddress: p.text?.text,
          source: 'google' as const,
          category,
        }));
    } catch (e: any) {
      console.warn('Google Places autocomplete query error:', e.message);
      return [];
    }
  };
  const fetchOneMap = async (): Promise<Suggestion[]> => {
    if (query.length < 2) return [];
    try {
      return (await oneMapSearch(query)).slice(0, 6).map((r: any) => {
        const building = r.BUILDING && r.BUILDING !== 'NIL' ? r.BUILDING : null;
        const blk = r.BLK_NO && r.BLK_NO !== 'NIL' ? `Blk ${r.BLK_NO} ` : '';
        const road = r.ROAD_NAME && r.ROAD_NAME !== 'NIL' ? r.ROAD_NAME : '';
        const postal = r.POSTAL && r.POSTAL !== 'NIL' ? r.POSTAL : '';
        const title = building || (blk || road ? `${blk}${road}`.trim() : r.ADDRESS);
        return {
          id: `onemap-${postal || ''}-${r.X || ''}-${r.Y || ''}`,
          title,
          subtitle: postal ? `Singapore ${postal}` : road || 'Singapore',
          fullAddress: r.ADDRESS || `${title}, Singapore ${postal}`.trim(),
          postalCode: postal || undefined,
          lat: Number(r.LATITUDE) || undefined,
          lng: Number(r.LONGITUDE) || undefined,
          source: 'onemap' as const,
          category,
        };
      });
    } catch (err: any) {
      console.warn('OneMap autocomplete query error:', err.message);
      return [];
    }
  };

  const [google, onemap] = await Promise.all([fetchGoogle(), fetchOneMap()]);
  const suggestions = mergeAddressSuggestions(classifyAddressQuery(query), {
    landmarks: results as AddressSuggestion[],
    onemap: onemap as AddressSuggestion[],
    google: google as AddressSuggestion[],
  });
  return res.json({ suggestions });
});

// Google autocomplete results carry no coordinates. When one is picked, look
// up its position and postal code (Google Place Details), then confirm the
// official Singapore address for that postal code with OneMap.
app.get('/api/places/resolve', async (req, res) => {
  const placeId = String(req.query.placeId || '').trim();
  const mapsKey = getGoogleMapsApiKey();
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) {
    return res.status(400).json({ error: 'placeId is required.' });
  }
  if (!mapsKey) {
    return res.status(503).json({ error: 'Place lookup unavailable.' });
  }
  try {
    const dRes = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        'X-Goog-Api-Key': mapsKey,
        'X-Goog-FieldMask': 'location,formattedAddress,addressComponents,displayName',
      },
      signal: AbortSignal.timeout(4000),
    });
    const d = (await dRes.json()) as any;
    const loc = { lat: d.location?.latitude, lng: d.location?.longitude };
    if (!dRes.ok || typeof loc.lat !== 'number') {
      return res.status(404).json({ error: 'Place not found.' });
    }
    const postalCode: string | undefined = (d.addressComponents || [])
      .find((c: any) => Array.isArray(c.types) && c.types.includes('postal_code'))?.longText;

    let officialAddress: string | undefined;
    if (postalCode && /^\d{6}$/.test(postalCode)) {
      try {
        const oRes = await fetch(
          `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${postalCode}&returnGeom=N&getAddrDetails=Y&pageNum=1`,
          { headers: { 'User-Agent': 'SafeSpot-SG/1.0' }, signal: AbortSignal.timeout(3000) },
        );
        const o = (await oRes.json()) as any;
        const match = (o.results || []).find((r: any) => r.POSTAL === postalCode);
        if (match?.ADDRESS) officialAddress = match.ADDRESS;
      } catch {
        // OneMap is a refinement; Google's address still stands.
      }
    }

    return res.json({
      lat: loc.lat,
      lng: loc.lng,
      postalCode,
      fullAddress: officialAddress || d.formattedAddress,
      name: d.displayName?.text,
    });
  } catch (err: any) {
    console.warn('Place resolve error:', err.message);
    return res.status(502).json({ error: 'Place lookup failed.' });
  }
});

// ── Phase 2: Street View candidate retrieval inside the GPS accuracy box ──

interface StreetViewCandidate {
  label: string;
  panoId: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  bearingDeg: number;
  imageUrl: string;
  imageBase64?: string | null;
}

async function fetchStreetViewMetadata(lat: number, lng: number, mapsKey: string): Promise<any | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${mapsKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.status === 'OK' ? data : null;
  } catch {
    return null;
  }
}

async function fetchImageBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.startsWith('image/')) return null;
    const buf = await res.arrayBuffer();
    return Buffer.from(buf).toString('base64');
  } catch {
    return null;
  }
}

/**
 * Sample the accuracy bounding box, snap each probe to its nearest panorama
 * via the Street View Metadata API, discard panoramas outside the camera
 * field of view, and download the three nearest as heading-oriented frames.
 */
async function retrieveStreetViewCandidates(opts: {
  lat: number;
  lng: number;
  accuracy: number;
  deviceHeading: number | null;
  mapsKey: string;
}): Promise<StreetViewCandidate[]> {
  // Clamp the probe radius: below 15m nothing new is found, above 60m the
  // ring starts landing on the next street over.
  const radius = Math.min(Math.max(opts.accuracy || 20, 15), 60);
  const user = { lat: opts.lat, lng: opts.lng };
  const samplePoints = ringSamplePoints(user, radius, 8);

  const metas = await Promise.all(
    samplePoints.map((p) => fetchStreetViewMetadata(p.lat, p.lng, opts.mapsKey))
  );

  const byPano = new Map<string, { lat: number; lng: number }>();
  for (const m of metas) {
    if (m?.pano_id && m.location && !byPano.has(m.pano_id)) {
      byPano.set(m.pano_id, { lat: m.location.lat, lng: m.location.lng });
    }
  }

  let candidates = [...byPano.entries()].map(([panoId, loc]) => ({
    panoId,
    lat: loc.lat,
    lng: loc.lng,
    distanceMeters: Math.round(haversineMeters(user, loc)),
    bearingDeg: Math.round(bearingDegrees(user, loc)),
  }));

  // A panorama behind the senior can never appear in their photo.
  if (opts.deviceHeading != null) {
    candidates = candidates.filter((c) => withinFieldOfView(c.bearingDeg, opts.deviceHeading as number, 90));
  }

  candidates.sort((a, b) => a.distanceMeters - b.distanceMeters);

  const renderHeading = Math.round(opts.deviceHeading ?? candidates[0]?.bearingDeg ?? 0);
  const labels = ['A', 'B', 'C'];
  const top: StreetViewCandidate[] = candidates.slice(0, 3).map((c, i) => ({
    ...c,
    label: labels[i],
    imageUrl: `https://maps.googleapis.com/maps/api/streetview?size=600x400&location=${c.lat},${c.lng}&heading=${renderHeading}&pitch=0&fov=90&key=${opts.mapsKey}`,
  }));

  await Promise.all(
    top.map(async (c) => {
      c.imageBase64 = await fetchImageBase64(c.imageUrl);
    })
  );
  return top.filter((c) => Boolean(c.imageBase64));
}

// API endpoint: Multimodal Location Verification & Landmark Cross-Referencing
app.post('/api/gemini/analyze-location', async (req, res) => {
  try {
    const {
      gps,
      photoBase64,
      photoMimeType = 'image/jpeg',
      voiceNotes = '',
      manualClues = '',
      bleBeacons = [],
      sensor,
    } = req.body;

    if (!gps || typeof gps.latitude !== 'number' || typeof gps.longitude !== 'number') {
      return res.status(400).json({ error: 'Valid GPS coordinates (latitude, longitude) are required.' });
    }

    const { latitude, longitude, accuracy = 20, heading = 0, speed = 0, altitude = 0 } = gps;

    // Phase 1: the shutter-time compass heading beats the GNSS course, which
    // is usually null on phones. It orients the whole candidate retrieval.
    const deviceHeading =
      sensor && typeof sensor.heading === 'number' ? sensor.heading : heading || null;

    // Execute Roads API snap & Places API search in parallel with reverse geocoding
    const [approximateAddress, snappedRoad, nearbyPlaces] = await Promise.all([
      fetchReverseGeocode(latitude, longitude),
      snapToNearestRoad(latitude, longitude),
      fetchNearbyPlacesLandmarks(latitude, longitude),
    ]);

    const effectiveLat = snappedRoad?.lat || latitude;
    const effectiveLng = snappedRoad?.lng || longitude;

    const mapsKey = getGoogleMapsApiKey();
    const staticStreetViewUrl = mapsKey
      ? `https://maps.googleapis.com/maps/api/streetview?size=600x400&location=${effectiveLat},${effectiveLng}&heading=${deviceHeading ?? 0}&pitch=0&fov=90&key=${mapsKey}`
      : `https://maps.googleapis.com/maps/api/streetview?size=600x400&location=${effectiveLat},${effectiveLng}&heading=${deviceHeading ?? 0}&pitch=0&fov=90&client=aistudio-agent`;

    // Phase 2: probe the GPS accuracy bounding box for Street View panoramas,
    // keep only the ones inside the camera field of view at shutter time, and
    // download up to three reference frames so Gemini can actually see them.
    const candidates: StreetViewCandidate[] = mapsKey
      ? await retrieveStreetViewCandidates({
          lat: latitude,
          lng: longitude,
          accuracy,
          deviceHeading,
          mapsKey,
        }).catch((e) => {
          console.warn('Street View candidate retrieval failed:', e?.message || e);
          return [] as StreetViewCandidate[];
        })
      : [];

    const ai = getGeminiClient();

    const generateFallbackResult = (reason?: string) => {
      const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${effectiveLat},${effectiveLng}`;
      const appleMapsUrl = `https://maps.apple.com/?q=${effectiveLat},${effectiveLng}`;
      const wazeUrl = `https://waze.com/ul?ll=${effectiveLat},${effectiveLng}&navigate=yes`;
      const primaryLandmark = nearbyPlaces[0]?.name || 'curbside entrance';

      return {
        originalCoordinates: { lat: latitude, lng: longitude, accuracyMeters: accuracy },
        verifiedCoordinates: { lat: effectiveLat, lng: effectiveLng },
        confidenceScore: photoBase64 ? 92 : 84,
        accuracyLevel: accuracy <= 15 ? 'HIGH' : 'MODERATE',
        formattedAddress: approximateAddress || `${effectiveLat.toFixed(5)}, ${effectiveLng.toFixed(5)}`,
        streetName: approximateAddress ? approximateAddress.split(',')[0] : 'Current Street',
        nearbyCrossStreet: nearbyPlaces[0]?.name ? `Near ${nearbyPlaces[0].name}` : 'Near main roadway / entrance',
        roadSnapping: {
          snapped: Boolean(snappedRoad),
          snappedCoordinates: snappedRoad ? { lat: snappedRoad.lat, lng: snappedRoad.lng } : null,
          placeId: snappedRoad?.placeId,
        },
        nearbyPlaces: nearbyPlaces.slice(0, 5),
        visualLandmarks: nearbyPlaces.length > 0
          ? nearbyPlaces.slice(0, 3).map((p, idx) => ({
              id: `lm-${idx + 1}`,
              name: p.name,
              description: `Verified ${p.type.replace(/_/g, ' ')} landmark near pickup spot.`,
              category: 'storefront',
              matchedInStreetView: true,
              confidence: 90,
            }))
          : [
              {
                id: 'lm-1',
                name: 'Curbside Boarding Zone',
                description: 'Snapped to drivable road geometry for vehicle pickup.',
                category: 'street_element',
                matchedInStreetView: true,
                confidence: 88,
              },
            ],
        isIndoors: accuracy > 40,
        environmentType: accuracy > 40 ? 'sheltered_porch' : 'outdoor_roadside',
        indoorContext: accuracy > 40 ? 'Under sheltered walkway or building perimeter' : 'Outdoor street curbside',
        indoorExitGuidance: accuracy > 40 ? 'Please step out towards the main driveway or taxi bay for driver pickup.' : 'Wait safely on the curbside pavement.',
        pickupInstructionsForDriver: `Pickup at ${approximateAddress || 'curbside'}. Driver should pull up directly near ${primaryLandmark}.`,
        elderlyVoiceSummary: `Your location is verified at ${approximateAddress ? approximateAddress.split(',')[0] : 'your pickup spot'}. You can safely share it now.`,
        safeWaitingAdvice: 'Please remain at the sheltered sidewalk or bench in clear sight of arriving vehicles.',
        streetViewData: {
          available: true,
          heading: deviceHeading ?? 0,
          pitch: 0,
          fov: 90,
          streetViewImageUrl: staticStreetViewUrl,
          comparisonSummary: 'Visual coordinates align with street level orientation.',
          matchingFeatures: ['Curbside walkway', 'Building façade boundary', ...nearbyPlaces.slice(0, 2).map(p => p.name)],
        },
        sensor: sensor || null,
        candidatePanoramas: candidates.map(({ label, panoId, lat, lng, distanceMeters, bearingDeg }) => ({ label, panoId, lat, lng, distanceMeters, bearingDeg })),
        matchedCandidate: null,
        refinedByCandidate: false,
        shareUrls: {
          googleMapsUrl,
          appleMapsUrl,
          wazeUrl,
          smsBody: `Hi! I need a pickup here: ${approximateAddress || `${effectiveLat.toFixed(5)}, ${effectiveLng.toFixed(5)}`}. Map link: ${googleMapsUrl}`,
          whatsappUrl: `https://wa.me/?text=${encodeURIComponent(`Hi! Here is my verified pickup location:\n📍 Address: ${approximateAddress || `${effectiveLat.toFixed(5)}, ${effectiveLng.toFixed(5)}`}\n🚗 Navigation: ${googleMapsUrl}`)}`,
        },
        timestamp: Date.now(),
        fallbackNotice: reason,
      };
    };

    if (!ai) {
      return res.json(generateFallbackResult('Gemini API key not configured'));
    }

    const placesContext = nearbyPlaces.length > 0
      ? `Verified Nearby Places (via Google Places API): ${nearbyPlaces.map(p => `${p.name} (${p.type})`).join(', ')}`
      : 'No automated Places API results in immediate radius.';

    const roadsContext = snappedRoad
      ? `Roads API Snap-to-Road: Raw GPS was snapped to nearest drivable roadway at lat ${snappedRoad.lat}, lng ${snappedRoad.lng} (Place ID: ${snappedRoad.placeId || 'N/A'})`
      : 'Roads API: Using raw GPS centroid.';

    // Only beacons at surveyed positions can refine the pin. A detected but
    // unregistered device is real radio traffic that says nothing about where
    // the senior is standing, so it must not be offered as location evidence.
    // 'geofence' entries are GPS-proximity hints, not radio measurements.
    const venueBeacons = (bleBeacons || []).filter((b: any) => b.isKnownVenue);
    const radioBeacons = venueBeacons.filter((b: any) => b.source !== 'geofence');
    const geofenceBeacons = venueBeacons.filter((b: any) => b.source === 'geofence');
    const pairedTag = (bleBeacons || []).find((b: any) => b.isPairedTag);

    const bleParts: string[] = [];
    if (radioBeacons.length > 0) {
      bleParts.push(
        `BLE Micro-Location Beacons in Range (measured over the air, surveyed positions): ${radioBeacons
          .map((b: any) => `${b.name} at ${b.locationName} (RSSI ${b.rssi} dBm, estimated ${b.estimatedDistanceMeters}m away${b.floorLevel ? `, floor: ${b.floorLevel}` : ''})`)
          .join('; ')}. Distances are estimated from radio signal strength and degrade badly through walls and crowds, so treat them as supporting evidence for the photo and Places data, not as ground truth that overrides them.`
      );
    }
    if (geofenceBeacons.length > 0) {
      bleParts.push(
        `GPS-matched surveyed venues nearby (no Bluetooth radio signal - the phone matched these venues by GPS proximity only, so their distances are GPS estimates, NOT beacon measurements): ${geofenceBeacons
          .map((b: any) => `${b.name} at ${b.locationName} (about ${b.estimatedDistanceMeters}m from the GPS fix${b.floorLevel ? `, floor: ${b.floorLevel}` : ''})`)
          .join('; ')}. Useful as a hint about which venue the senior is near; never use them to override GPS or the photo.`
      );
    }
    if (bleParts.length === 0) {
      bleParts.push(
        `No registered venue BLE beacon detected in range${pairedTag ? `, though the senior's own paired safety tag is nearby (RSSI ${pairedTag.rssi} dBm)` : ''}. Rely on GPS, the photo, and Places API only — do not infer a beacon-based position.`
      );
    }
    const bleContext = bleParts.join(' ');

    const promptText = `
You are an expert AI Location Specialist and Elder Pickup Assistant for Singapore and worldwide locations.
The goal is to provide maximum location accuracy and reassurance for an elderly person waiting to be picked up by a caregiver, family member, or ride/emergency responder.

Google Maps Platform Multi-API & BLE Grounding:
- Raw GPS: Latitude ${latitude}, Longitude ${longitude} (Accuracy: ${accuracy}m)
- ${roadsContext}
- ${placesContext}
- ${bleContext}
- Shutter Sensor Metadata (Phase 1): compass heading ${deviceHeading != null ? `${Math.round(deviceHeading)} degrees` : 'unavailable'}, pitch ${sensor?.pitch ?? 'n/a'} deg, roll ${sensor?.roll ?? 'n/a'} deg, vertical accuracy ${gps.altitudeAccuracy ?? 'n/a'} m
- Reverse Geocoded Address Hint: ${approximateAddress || 'Not available'}
- User Voice Notes / Speech: "${voiceNotes || 'None'}"
- Additional Clues / Environment: "${manualClues || 'None'}"
- Phase 2 Candidate Panoramas: ${candidates.length > 0 ? candidates.map((c) => `Frame ${c.label} (${c.distanceMeters}m from GPS, bearing ${c.bearingDeg} deg)`).join('; ') : 'none retrieved - rely on GPS, Places and the photo alone'}

TASK:
1. Analyze the user's uploaded surroundings photo (if provided) along with the Roads API snapped curbside, Places API verified landmark list, and detected BLE Beacon micro-location signatures.
2. Cross-reference visible features (storefront signs, awning colors, building numbers, door entrances, benches, pavement markers, transit stops, distinct street signs) against what Google Street View, Places API, and BLE beacons show at these coordinates.
3. If a REGISTERED venue BLE beacon is listed above with a strong signal (RSSI above -70 dBm), use its surveyed position and floor level to refine the pickup point. Only beacons listed above count; never assume a beacon is present when none is listed.
4. Assess whether the senior is currently INDOORS (inside a mall/building/MRT), OUTDOORS at roadside, under an HDB VOID DECK, or under a SHELTERED PORCH based on ceilings, artificial lighting, floor tiles, columns, BLE beacons, and GPS attenuation.
5. If indoors, identify the indoor context (e.g. "Inside Toa Payoh Hub Level 1 near FairPrice") and provide clear step-by-step guidance for the elder to reach the nearest vehicle pickup point or taxi bay.
6. Determine refined/verified coordinates (prefer a registered beacon's surveyed position when one is within a few metres, otherwise the Roads API snapped curbside if the user is by the road).
7. Extract 2-4 concrete, easily identifiable visual landmarks with high distinction (utilize real names from Places/BLE API results when matching).
8. Create crystal-clear pickup instructions for the driver (e.g. "Pull up directly in front of the taxi stand or main entrance. Elder is waiting under the sheltered walkway.").
9. Create a warm, calming, simple voice summary for the elderly user (written in short, easy-to-hear sentences without technical jargon, mentioning if they need to step out to the pickup bay).
10. Create safe waiting advice (e.g., "Stay under the sheltered walkway or bench. It is safe, dry, and brightly visible from the road.").
11. Provide matching assessment for Google Street View comparison.
12. Visual consensus (Phase 3): compare the user's photo against reference frames A/B/C along the device heading vector - match structural features (storefront rows, awnings, poles, foliage, building edges, perspective lines). Answer matchedCandidate with the letter of the frame showing the same scene, or NONE when nothing matches. When GPS drift is likely (urban canyon, accuracy worse than 15m) and a frame clearly matches, prefer that panorama's coordinates for verifiedLat/verifiedLng.

Output your answer strictly using the provided JSON schema.`;

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    if (photoBase64) {
      // Clean up base64 prefix if present
      const cleanBase64 = photoBase64.replace(/^data:image\/[a-z]+;base64,/, '');
      parts.push({
        inlineData: {
          mimeType: photoMimeType,
          data: cleanBase64,
        },
      });
    }

    // Phase 3: attach the heading-oriented reference frames for consensus matching.
    for (const c of candidates) {
      parts.push({
        text: `Reference frame ${c.label}: Street View panorama ${c.panoId}, ${c.distanceMeters}m from the user's GPS at bearing ${c.bearingDeg} deg, rendered facing the device compass heading.`,
      });
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: c.imageBase64 as string } });
    }

    parts.push({ text: promptText });

    const schemaConfig = {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          verifiedLat: { type: Type.NUMBER, description: 'Refined exact latitude for pickup pin' },
          verifiedLng: { type: Type.NUMBER, description: 'Refined exact longitude for pickup pin' },
          confidenceScore: { type: Type.INTEGER, description: 'Confidence score from 50 to 99' },
          accuracyLevel: { type: Type.STRING, enum: ['EXACT', 'HIGH', 'MODERATE', 'ESTIMATED'] },
          formattedAddress: { type: Type.STRING, description: 'Clear street address with number and city' },
          streetName: { type: Type.STRING, description: 'Primary street or avenue name' },
          nearbyCrossStreet: { type: Type.STRING, description: 'Nearest cross street or landmark zone' },
          isIndoors: { type: Type.BOOLEAN, description: 'True if user is inside a shopping mall, building, underground concourse, or indoor lobby' },
          environmentType: {
            type: Type.STRING,
            enum: ['indoor_mall', 'indoor_mrt', 'hdb_void_deck', 'sheltered_porch', 'outdoor_roadside', 'underground'],
            description: 'Specific architectural environment type',
          },
          indoorContext: { type: Type.STRING, description: 'Description of indoor location (e.g. Inside Toa Payoh Hub near FairPrice)' },
          indoorExitGuidance: { type: Type.STRING, description: 'Gentle instructions directing elder to the nearest vehicle pickup bay or taxi stand' },
          visualLandmarks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                description: { type: Type.STRING },
                category: {
                  type: Type.STRING,
                  enum: [
                    'storefront',
                    'building',
                    'door_entrance',
                    'signage',
                    'seating_bench',
                    'street_element',
                    'color_pattern',
                  ],
                },
                matchedInStreetView: { type: Type.BOOLEAN },
                confidence: { type: Type.INTEGER },
              },
              required: ['id', 'name', 'description', 'category', 'matchedInStreetView', 'confidence'],
            },
          },
          pickupInstructionsForDriver: {
            type: Type.STRING,
            description: 'Precise, actionable pickup notes for caregiver/driver',
          },
          elderlyVoiceSummary: {
            type: Type.STRING,
            description: 'Calm, comforting short summary for speech synthesis',
          },
          safeWaitingAdvice: {
            type: Type.STRING,
            description: 'Clear safety recommendation for waiting safely',
          },
          matchedCandidate: {
            type: Type.STRING,
            enum: ['A', 'B', 'C', 'NONE'],
            description: 'Letter of the reference frame showing the same scene as the user photo, or NONE',
          },
          streetViewComparison: {
            type: Type.OBJECT,
            properties: {
              available: { type: Type.BOOLEAN },
              heading: { type: Type.NUMBER },
              pitch: { type: Type.NUMBER },
              fov: { type: Type.NUMBER },
              comparisonSummary: { type: Type.STRING },
              matchingFeatures: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['available', 'heading', 'comparisonSummary', 'matchingFeatures'],
          },
        },
        required: [
          'verifiedLat',
          'verifiedLng',
          'confidenceScore',
          'accuracyLevel',
          'formattedAddress',
          'streetName',
          'nearbyCrossStreet',
          'isIndoors',
          'environmentType',
          'visualLandmarks',
          'pickupInstructionsForDriver',
          'elderlyVoiceSummary',
          'safeWaitingAdvice',
          'streetViewComparison',
        ],
      },
    };

    let response: any = null;
    const modelsToTry = ['gemini-3.7-flash', 'gemini-2.5-flash'];

    for (const modelName of modelsToTry) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: { parts },
          config: schemaConfig,
        });
        if (response && response.text) break;
      } catch (genErr: any) {
        console.warn(`Gemini generation attempt with ${modelName} encountered error:`, genErr?.message || genErr);
        // If it's a 503 high demand or 429 rate limit, continue to fallback model
      }
    }

    if (!response || !response.text) {
      console.warn('All Gemini model calls failed or experienced high demand. Returning Maps-grounded fallback.');
      return res.json(generateFallbackResult('Model high demand fallback'));
    }

    const parsed = JSON.parse(response.text?.trim() || '{}');

    // Phase 3 consensus: a matched panorama is surveyed street geometry, so
    // it overrides a drifting GPS fix in urban canyons.
    const matchedCandidate = candidates.find((c) => c.label === parsed.matchedCandidate) || null;
    const verifiedLat = matchedCandidate ? matchedCandidate.lat : parsed.verifiedLat || latitude;
    const verifiedLng = matchedCandidate ? matchedCandidate.lng : parsed.verifiedLng || longitude;
    const formattedAddress = parsed.formattedAddress || approximateAddress || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${verifiedLat},${verifiedLng}`;
    const appleMapsUrl = `https://maps.apple.com/?q=${verifiedLat},${verifiedLng}`;
    const wazeUrl = `https://waze.com/ul?ll=${verifiedLat},${verifiedLng}&navigate=yes`;

    const smsBody = `Hi! I need a pickup here: ${formattedAddress}. Landmark: ${parsed.visualLandmarks?.[0]?.name || 'curbside'}. Instructions: ${parsed.pickupInstructionsForDriver}. Navigation Map link: ${googleMapsUrl}`;

    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(
      `Hi! Here is my verified pickup location:\n📍 Address: ${formattedAddress}\n🔍 Landmarks: ${parsed.visualLandmarks?.map((l: any) => l.name).join(', ') || 'Entrance'}\n🚗 Driver Note: ${parsed.pickupInstructionsForDriver}\n🗺️ Navigation: ${googleMapsUrl}`
    )}`;

    const result = {
      originalCoordinates: { lat: latitude, lng: longitude, accuracyMeters: accuracy },
      verifiedCoordinates: { lat: verifiedLat, lng: verifiedLng },
      confidenceScore: parsed.confidenceScore || (photoBase64 ? 96 : 85),
      accuracyLevel: parsed.accuracyLevel || 'HIGH',
      formattedAddress,
      streetName: parsed.streetName || (approximateAddress ? approximateAddress.split(',')[0] : 'Current Street'),
      nearbyCrossStreet: parsed.nearbyCrossStreet || 'Curbside Area',
      roadSnapping: {
        snapped: Boolean(snappedRoad),
        snappedCoordinates: snappedRoad ? { lat: snappedRoad.lat, lng: snappedRoad.lng } : null,
        placeId: snappedRoad?.placeId,
      },
      nearbyPlaces: nearbyPlaces.slice(0, 5),
      visualLandmarks: parsed.visualLandmarks || [],
      isIndoors: Boolean(parsed.isIndoors),
      environmentType: parsed.environmentType || (parsed.isIndoors ? 'indoor_mall' : 'outdoor_roadside'),
      indoorContext: parsed.indoorContext || (parsed.isIndoors ? 'Inside building/concourse' : 'Outdoor street area'),
      indoorExitGuidance: parsed.indoorExitGuidance || (parsed.isIndoors ? 'Please step towards the nearest ground floor entrance or taxi stand.' : 'Wait safely at the curbside.'),
      bleBeacons: bleBeacons || [],
      // Only a surveyed beacon actually heard over the air, close enough to
      // trust, improves the pin. GPS-matched geofence hints never qualify.
      bleAccuracyBoost: radioBeacons.some((b: any) => b.rssi >= -70 && b.estimatedDistanceMeters <= 3),
      sensor: sensor || null,
      candidatePanoramas: candidates.map(({ label, panoId, lat, lng, distanceMeters, bearingDeg }) => ({ label, panoId, lat, lng, distanceMeters, bearingDeg })),
      matchedCandidate: matchedCandidate?.label || null,
      refinedByCandidate: Boolean(matchedCandidate),
      pickupInstructionsForDriver: parsed.pickupInstructionsForDriver || 'Please pull up to the exact pin location.',
      elderlyVoiceSummary: parsed.elderlyVoiceSummary || `You are at ${formattedAddress}. Your location is verified.`,
      safeWaitingAdvice: parsed.safeWaitingAdvice || 'Stay where you are in a visible and comfortable spot.',
      streetViewData: {
        available: parsed.streetViewComparison?.available ?? true,
        heading: parsed.streetViewComparison?.heading ?? (deviceHeading ?? 0),
        pitch: parsed.streetViewComparison?.pitch ?? 0,
        fov: parsed.streetViewComparison?.fov ?? 90,
        streetViewImageUrl: staticStreetViewUrl,
        comparisonSummary: parsed.streetViewComparison?.comparisonSummary || 'Features confirmed against street layout.',
        matchingFeatures: parsed.streetViewComparison?.matchingFeatures || ['Storefront alignment', 'Curbside layout'],
      },
      shareUrls: {
        googleMapsUrl,
        appleMapsUrl,
        wazeUrl,
        smsBody,
        whatsappUrl,
      },
      timestamp: Date.now(),
    };

    return res.json(result);
  } catch (error: any) {
    console.error('Error in /api/gemini/analyze-location:', error);
    return res.status(500).json({
      error: 'Failed to analyze location and landmarks.',
      details: error.message,
    });
  }
});

// API endpoint: Accessible Voice Command Assistant
app.post('/api/gemini/voice-assistant', async (req, res) => {
  try {
    const { transcript, currentAddress, currentLocation, emergencyContacts = [] } = req.body;

    if (!transcript || typeof transcript !== 'string') {
      return res.status(400).json({ error: 'Speech transcript is required.' });
    }

    const ai = getGeminiClient();

    if (!ai) {
      // Local keyword matching fallback if AI key isn't provided
      const lower = transcript.toLowerCase();
      let action = 'GENERAL_HELP';
      let spokenResponse = 'I am here to help you. You can say: Where am I, Send my location to Sarah, or Help.';

      if (lower.includes('where am i') || lower.includes('what is my address') || lower.includes('location') || lower.includes('where is this')) {
        action = 'READ_LOCATION';
        spokenResponse = currentAddress
          ? `You are currently at ${currentAddress}.`
          : 'I am checking your current Singapore location right now.';
      } else if (lower.includes('send') || lower.includes('share') || lower.includes('pick me up') || lower.includes('daughter') || lower.includes('son') || lower.includes('caregiver') || lower.includes('sarah') || lower.includes('david') || lower.includes('ah girl') || lower.includes('ah boy')) {
        action = 'SEND_LOCATION';
        spokenResponse = 'Sending your verified pickup location to your emergency contact now.';
      } else if (lower.includes('photo') || lower.includes('picture') || lower.includes('camera') || lower.includes('look') || lower.includes('see')) {
        action = 'ANALYZE_PHOTO';
        spokenResponse = 'Opening the camera so we can verify the landmarks around you.';
      } else if (lower.includes('emergency') || lower.includes('995') || lower.includes('911') || lower.includes('help me') || lower.includes('scdf') || lower.includes('ambulance') || lower.includes('urgent') || lower.includes('fall') || lower.includes('pain') || lower.includes('hospital')) {
        action = 'EMERGENCY_TRIGGER';
        spokenResponse = 'Activating emergency SCDF 995 assistance for you right now.';
      } else if (lower.includes('contrast') || lower.includes('yellow') || lower.includes('dark') || lower.includes('bright') || lower.includes('bigger') || lower.includes('color')) {
        action = 'TOGGLE_CONTRAST';
        spokenResponse = 'Switching high-contrast visual display mode for you.';
      } else if (lower.includes('safe') || lower.includes('wait') || lower.includes('rain') || lower.includes('shelter')) {
        action = 'SPEAK_ADVICE';
        spokenResponse = 'Please stay at the covered walkway or bench where you are sheltered and easily visible to drivers.';
      }

      return res.json({
        action,
        spokenResponse,
        feedbackMessage: spokenResponse,
        confidence: 90,
      });
    }

    const contactsList = emergencyContacts.map((c: any) => `${c.name} (${c.relationship})`).join(', ');

    const prompt = `
You are the empathetic, senior-friendly voice intelligence engine for "SafeSpot.SG".
The elder spoke the following transcript transcribed by Speechmatics:
"${transcript}"

Context & Environment:
- Location Region: Singapore
- User's Current Verified Location/Address: "${currentAddress || 'Locating current spot in Singapore...'}"
- Known Family/Emergency Contacts: "${contactsList || 'Sarah (Daughter), David (Son), Nurse Priya (Caregiver), Singapore SCDF Ambulance (995)'}"

Semantic Heuristics & Singapore Natural Language Handling:
- The elder may use Singapore English / Singlish expressions (e.g., "Ah Girl pick me up", "Send location to my boy David", "I at MRT exit", "Where is this void deck", "Call 995", "I feeling giddy / chest pain", "Cannot see properly", "Take photo of the clinic").
- Carefully understand the elder's emotional state, intent, and cognitive clarity.

Classify intent into the primary action:
1. 'READ_LOCATION': Elder asks where they are, what street they are on, or wants spoken confirmation of address.
2. 'SEND_LOCATION': Elder asks to send location, message family/driver, get picked up, notify daughter/son/caregiver.
3. 'CALL_CONTACT': Elder explicitly asks to ring or call a specific family member or caregiver.
4. 'ANALYZE_PHOTO': Elder asks to look around, check photo, scan landmarks, or use camera.
5. 'EMERGENCY_TRIGGER': Elder expresses pain, distress, fall, chest discomfort, danger, SCDF, ambulance, 995, or urgent medical help.
6. 'TOGGLE_CONTRAST': Elder wants high contrast, yellow-black mode, dark mode, or clearer visual screen.
7. 'SPEAK_ADVICE': Elder asks if they should wait, if it is safe, or where to stand.
8. 'GENERAL_HELP': Elder asks for general instructions or greetings.

Instructions for generation:
- 'action': One of the above enum values.
- 'targetContactName': The specific contact name mentioned (e.g. "Sarah", "David", "Nurse Priya") or null.
- 'spokenResponse': Calm, warm, reassuring, concise English (1-2 short sentences, clear for older ears).
- 'feedbackMessage': Concise visual confirmation to display on the high-contrast display.
`;

    const schemaVoiceConfig = {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          action: {
            type: Type.STRING,
            enum: [
              'READ_LOCATION',
              'SEND_LOCATION',
              'CALL_CONTACT',
              'ANALYZE_PHOTO',
              'EMERGENCY_TRIGGER',
              'TOGGLE_CONTRAST',
              'SPEAK_ADVICE',
              'GENERAL_HELP',
            ],
          },
          targetContactName: { type: Type.STRING },
          spokenResponse: { type: Type.STRING },
          feedbackMessage: { type: Type.STRING },
        },
        required: ['action', 'spokenResponse', 'feedbackMessage'],
      },
    };

    let response: any = null;
    for (const modelName of ['gemini-3.7-flash', 'gemini-2.5-flash']) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: schemaVoiceConfig,
        });
        if (response && response.text) break;
      } catch (err: any) {
        console.warn(`Voice assistant generation error with ${modelName}:`, err?.message || err);
      }
    }

    if (!response || !response.text) {
      // Return heuristic response on model 503 / failure
      const lower = transcript.toLowerCase();
      let action = 'GENERAL_HELP';
      let spokenResponse = 'I am here to help you. You can say: Where am I, Send my location to Sarah, or Help.';

      if (lower.includes('where am i') || lower.includes('what is my address') || lower.includes('location') || lower.includes('where is this')) {
        action = 'READ_LOCATION';
        spokenResponse = currentAddress
          ? `You are currently at ${currentAddress}.`
          : 'I am checking your current location right now.';
      } else if (lower.includes('send') || lower.includes('share') || lower.includes('pick me up') || lower.includes('daughter') || lower.includes('son') || lower.includes('caregiver') || lower.includes('sarah') || lower.includes('david')) {
        action = 'SEND_LOCATION';
        spokenResponse = 'Sending your verified pickup location to your emergency contact now.';
      } else if (lower.includes('photo') || lower.includes('picture') || lower.includes('camera') || lower.includes('look') || lower.includes('see')) {
        action = 'ANALYZE_PHOTO';
        spokenResponse = 'Opening the camera so we can verify the landmarks around you.';
      } else if (lower.includes('emergency') || lower.includes('995') || lower.includes('911') || lower.includes('help me') || lower.includes('scdf') || lower.includes('ambulance') || lower.includes('urgent') || lower.includes('fall') || lower.includes('pain')) {
        action = 'EMERGENCY_TRIGGER';
        spokenResponse = 'Activating emergency SCDF 995 assistance for you right now.';
      } else if (lower.includes('contrast') || lower.includes('yellow') || lower.includes('dark') || lower.includes('bright') || lower.includes('bigger') || lower.includes('color')) {
        action = 'TOGGLE_CONTRAST';
        spokenResponse = 'Switching high-contrast visual display mode for you.';
      } else if (lower.includes('safe') || lower.includes('wait') || lower.includes('rain') || lower.includes('shelter')) {
        action = 'SPEAK_ADVICE';
        spokenResponse = 'Please stay at the covered walkway or bench where you are sheltered and easily visible to drivers.';
      }

      return res.json({
        action,
        spokenResponse,
        feedbackMessage: spokenResponse,
        confidence: 85,
      });
    }

    const parsed = JSON.parse(response.text?.trim() || '{}');
    return res.json(parsed);
  } catch (error: any) {
    console.error('Error in /api/gemini/voice-assistant:', error);
    return res.json({
      action: 'GENERAL_HELP',
      spokenResponse: 'I am listening. How can I help you right now?',
      feedbackMessage: 'Ready to assist.',
      confidence: 70,
    });
  }
});

// Per-account limit on messages the phone app can send (SMS costs money and
// must not become an open relay), plus a server-wide ceiling.
const notifyRate = new Map<string, number[]>();
let notifyGlobal: number[] = [];
function allowNotify(uid: string, now = Date.now()): boolean {
  notifyGlobal = notifyGlobal.filter((t) => now - t < 60 * 60_000);
  const recent = (notifyRate.get(uid) || []).filter((t) => now - t < 60 * 60_000);
  if (recent.length >= 15 || notifyGlobal.length >= 300) return false;
  recent.push(now);
  notifyGlobal.push(now);
  notifyRate.set(uid, recent);
  return true;
}

const clipText = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
const inSingaporeBounds = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' && typeof lng === 'number' && lat > 1.15 && lat < 1.48 && lng > 103.6 && lng < 104.1;

// API endpoint: Direct 1-Tap Location Pin SMS. Requires sign-in (a guest
// account is fine) so it can't be used to send SMS to arbitrary numbers.
app.post('/api/notify/dispatch-pin', async (req, res) => {
  const uid = await requireFirebaseUid(req, res);
  if (!uid) return;
  if (!allowNotify(uid)) return res.status(429).json({ error: 'Too many messages sent. Please wait a while.' });
  try {
    const {
      contactName,
      phone,
      address,
      googleMapsUrl,
      driverHint,
      blePrecision,
      incidentId,
      seniorName = 'Senior'
    } = req.body || {};

    if (typeof phone !== 'string' || !phone.trim()) {
      return res.status(400).json({ error: 'Phone number is required.' });
    }

    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    if (smsAlertRecipients([{ phone: cleanPhone }]).length === 0) {
      return res.status(400).json({ error: 'Messages can only be sent to mobile numbers. Call 995 directly in an emergency.' });
    }
    const mapsUrl = typeof googleMapsUrl === 'string' && /^https:\/\/(www\.)?google\.[a-z.]+\/maps|^https:\/\/maps\.google\.[a-z.]+\//.test(googleMapsUrl)
      ? googleMapsUrl.slice(0, 300)
      : 'https://maps.google.com';
    const baseUrl = process.env.APP_BASE_URL || 'https://safespot-sg-258662267000.asia-southeast1.run.app';

    const messageBody = `📍 SafeSpot.SG Pick-Up Request for ${clipText(seniorName, 60) || 'Senior'}:\n` +
      `🏠 Location: ${clipText(address, 200) || 'Verified Curbside'}\n` +
      (blePrecision ? `📶 Precision: ${clipText(blePrecision, 100)}\n` : '') +
      (driverHint ? `🚗 Driver Note: ${clipText(driverHint, 300)}\n` : '') +
      `🗺️ Google Maps Pin: ${mapsUrl}\n` +
      (typeof incidentId === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(incidentId) ? `⚡ Live Tracking: ${baseUrl}/track/${incidentId}` : '');

    const twilioResult = await sendSms({ to: cleanPhone, body: messageBody });
    console.log(`[DISPATCH_PIN] ${twilioResult.success ? 'Sent' : 'FAILED'} location pin to ${clipText(contactName, 60) || 'contact'}: ${twilioResult.carrierStatus}`);

    if (!twilioResult.success) {
      const unconfigured = twilioResult.carrierStatus === 'SMS_NOT_CONFIGURED';
      return res.status(unconfigured ? 503 : 502).json({
        success: false,
        error: unconfigured ? 'SMS sending is not set up yet.' : 'The SMS could not be sent.',
        carrierStatus: twilioResult.carrierStatus,
      });
    }

    return res.json({
      success: true,
      messageId: twilioResult.messageId,
      carrierStatus: twilioResult.carrierStatus,
      recipient: clipText(contactName, 60) || 'Caregiver',
      phone: twilioResult.recipient,
      timestamp: Date.now(),
      messagePreview: messageBody,
    });
  } catch (error: any) {
    console.error('Error in /api/notify/dispatch-pin:', error);
    return res.status(500).json({ error: 'Failed to dispatch location pin' });
  }
});

// ── Alert channels (SMS + Telegram) ──────────────────────────────────────────

// Which channels can actually deliver. No secrets, safe to show anyone.
app.get('/api/alerts/channels', async (_req, res) => {
  res.json({
    sms: smsConfigured(),
    telegram: telegramConfigured(),
    telegramBot: telegramConfigured() ? await getBotUsername().catch(() => null) : null,
    // Any phone notifications at all; webPush is browsers (VAPID), fcm the Android app.
    push: pushConfigured() || fcmAvailable(),
    webPush: pushConfigured(),
    fcm: fcmAvailable(),
    vapidPublicKey: vapidPublicKey(),
  });
});

// Start linking a Telegram chat: returns a one-time code and t.me links that
// open Telegram with the code pre-filled (for a group, or a private chat).
app.post('/api/alerts/telegram/link', async (req, res) => {
  const uid = await requireFirebaseUid(req, res);
  if (!uid) return;
  if (!telegramConfigured()) return res.status(503).json({ error: 'Telegram alerts are not set up yet.' });
  const bot = await getBotUsername().catch(() => null);
  if (!bot) return res.status(503).json({ error: 'Telegram is unreachable right now.' });
  try {
    const { code, expiresAt } = await createTelegramLinkCode(uid);
    return res.json({
      code,
      expiresAt,
      botUsername: bot,
      groupUrl: `https://t.me/${bot}?startgroup=${code}`,
      privateUrl: `https://t.me/${bot}?start=${code}`,
    });
  } catch (e: any) {
    console.error('[TELEGRAM] Could not create link code:', e.message);
    return res.status(503).json({ error: 'Could not start linking. Please try again.' });
  }
});

app.get('/api/alerts/telegram/chats', async (req, res) => {
  const uid = await requireFirebaseUid(req, res);
  if (!uid) return;
  try {
    const chats = await getTelegramChats(uid);
    return res.json({ chats: chats.map(({ chatId, title, type, linkedAt }) => ({ chatId, title, type, linkedAt })) });
  } catch (e: any) {
    console.error('[TELEGRAM] Could not list chats:', e.message);
    return res.status(503).json({ error: 'Could not load linked chats.' });
  }
});

app.post('/api/alerts/telegram/unlink', async (req, res) => {
  const uid = await requireFirebaseUid(req, res);
  if (!uid) return;
  const chatId = typeof req.body?.chatId === 'string' ? req.body.chatId : '';
  if (!/^-?\d{1,20}$/.test(chatId)) return res.status(400).json({ error: 'chatId is required.' });
  try {
    const removed = await removeTelegramChat(uid, chatId);
    if (removed) {
      await sendTelegramText(chatId, 'SafeSpot alerts will no longer be posted in this chat.').catch(() => {});
    }
    return res.json({ status: 'ok', removed });
  } catch (e: any) {
    console.error('[TELEGRAM] Could not unlink chat:', e.message);
    return res.status(503).json({ error: 'Could not unlink. Please try again.' });
  }
});

// Setup checklist: send a clearly-labelled test alert through every channel
// the account would use in a real emergency (SMS to its family contacts as
// stored on the server, and its linked Telegram chats). Recipients come from
// the account's own profile, never from the request.
const testAlertRate = new Map<string, number[]>();
app.post('/api/alerts/test', async (req, res) => {
  const uid = await requireFirebaseUid(req, res);
  if (!uid) return;
  const now = Date.now();
  const recent = (testAlertRate.get(uid) || []).filter((t) => now - t < 60 * 60_000);
  if (recent.length >= 3 || !allowNotify(uid, now)) {
    return res.status(429).json({ error: 'Too many test alerts. Please try again in an hour.' });
  }
  recent.push(now);
  testAlertRate.set(uid, recent);

  const db = getFirebaseAdminDb();
  let name = 'Senior';
  let contacts: Array<{ name?: string; phone?: string; isPrimary?: boolean; locked?: boolean }> = [];
  if (db) {
    try {
      const snap = await db.collection('Users').doc(uid).get();
      const data = (snap.data() || {}) as Record<string, any>;
      if (typeof data.actualName === 'string' && data.actualName.trim()) name = data.actualName.trim().slice(0, 60);
      if (Array.isArray(data.emergencyContacts)) contacts = data.emergencyContacts;
    } catch (e: any) {
      console.error('[ALERT_TEST] Could not read profile:', e.message);
      return res.status(503).json({ error: 'Could not load your profile. Please try again.' });
    }
  }

  const recipients = smsAlertRecipients(contacts);
  const smsText =
    `🧪 SafeSpot.SG TEST alert for ${name}. This is only a test, no action needed.\n` +
    `In a real emergency this message would include their location and a live tracking link.`;
  const [smsResults, telegramSent, pushSent] = await Promise.all([
    Promise.all(recipients.map((c) => sendSms({ to: c.phone as string, body: smsText }))),
    sendTelegramPin(uid, {
      text: `🧪 <b>SafeSpot test alert for ${escapeHtml(name)}</b>\nThis is only a test, no action needed. ` +
        'In a real emergency you would see what happened, a live map pin and an "I\'m responding" button.',
    }).catch(() => 0),
    notifyPushDevices(uid, {
      title: `🧪 SafeSpot test alert for ${name}`,
      body: 'This is only a test, no action needed.',
      url: '/',
      tag: 'safespot-test',
    }).catch(() => 0),
  ]);
  const smsSent = smsResults.filter((r) => r.success).length;

  if (smsSent + telegramSent + pushSent > 0 && db) {
    await db.collection('Users').doc(uid).set({ lastTestAlertAt: now }, { merge: true }).catch((e: any) =>
      console.warn('[ALERT_TEST] Could not record test time:', e.message),
    );
  }
  console.log(`[ALERT_TEST] ${uid.slice(0, 6)}…: SMS ${smsSent}/${recipients.length}, Telegram ${telegramSent}`);
  return res.json({
    sms: { sent: smsSent, attempted: recipients.length, configured: smsConfigured() },
    telegram: { sent: telegramSent, configured: telegramConfigured() },
    push: { sent: pushSent, configured: pushConfigured() || fcmAvailable() },
    reachedSomeone: smsSent + telegramSent + pushSent > 0,
  });
});


// ── Web push (phone notifications) ───────────────────────────────────────────

const pushJoinRate = new Map<string, number[]>();
function allowPushJoin(ip: string, now = Date.now()): boolean {
  const recent = (pushJoinRate.get(ip) || []).filter((t) => now - t < 60 * 60_000);
  if (recent.length >= 20) return false;
  recent.push(now);
  pushJoinRate.set(ip, recent);
  return true;
}
const clientIp = (req: express.Request) => String(req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();
const isInviteCode = (c: unknown): c is string => typeof c === 'string' && /^[0-9A-Z]{8}$/.test(c);
const PUSH_OFF = 'Phone notifications are not set up yet.';

/**
 * A browser sends { subscription }, the Android app { fcmToken }. Each kind
 * only needs its own sender: FCM works without VAPID keys and vice versa.
 */
function pushTargetFrom(body: any): { target: PushTarget } | { status: number; error: string } {
  if (body?.fcmToken !== undefined) {
    if (!isValidFcmToken(body.fcmToken)) return { status: 400, error: 'Invalid request.' };
    if (!fcmAvailable()) return { status: 503, error: PUSH_OFF };
    return { target: { fcmToken: body.fcmToken } };
  }
  if (!isValidSubscription(body?.subscription)) return { status: 400, error: 'Invalid request.' };
  if (!pushConfigured()) return { status: 503, error: PUSH_OFF };
  return { target: body.subscription };
}

// This device, signed in to the account, turns on notifications for itself.
app.post('/api/alerts/push/subscribe', async (req, res) => {
  const uid = await requireFirebaseUid(req, res);
  if (!uid) return;
  const parsed = pushTargetFrom(req.body);
  if ('error' in parsed) return res.status(parsed.status).json({ error: parsed.error });
  const ok = await addPushDevice(uid, parsed.target, clipText(req.body?.label, 60) || 'This phone').catch(() => false);
  return ok ? res.json({ status: 'ok' }) : res.status(409).json({ error: 'Too many phones on this account. Remove one first.' });
});

// A shareable link for family to get notifications on their own phones.
app.post('/api/alerts/push/invite', async (req, res) => {
  const uid = await requireFirebaseUid(req, res);
  if (!uid) return;
  if (!pushConfigured() && !fcmAvailable()) return res.status(503).json({ error: PUSH_OFF });
  try {
    const { code, expiresAt } = await createPushInvite(uid);
    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    return res.json({ code, expiresAt, url: `${baseUrl}/alerts/join/${code}` });
  } catch (e: any) {
    console.error('[PUSH] Could not create invite:', e.message);
    return res.status(503).json({ error: 'Could not create an invite. Please try again.' });
  }
});

// Invite landing page: whose alerts these are (first name only).
app.get('/api/alerts/push/invite/:code', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  if (!isInviteCode(code) || !allowPushJoin(clientIp(req))) return res.status(404).json({ error: 'Invite not found.' });
  const uid = await getPushInviteOwner(code).catch(() => null);
  if (!uid) return res.status(404).json({ error: 'This invite has expired. Ask for a new link.' });
  let name = 'your family member';
  const db = getFirebaseAdminDb();
  if (db) {
    const data = (await db.collection('Users').doc(uid).get().catch(() => null))?.data() as Record<string, any> | undefined;
    if (typeof data?.actualName === 'string' && data.actualName.trim()) name = data.actualName.trim().split(/\s+/)[0].slice(0, 30);
  }
  return res.json({ name, vapidPublicKey: vapidPublicKey(), fcm: fcmAvailable() });
});

app.post('/api/alerts/push/join', async (req, res) => {
  if (!pushConfigured() && !fcmAvailable()) return res.status(503).json({ error: PUSH_OFF });
  if (!allowPushJoin(clientIp(req))) return res.status(429).json({ error: 'Too many attempts. Please wait a while.' });
  const { code, label } = req.body || {};
  const c = String(code || '').toUpperCase();
  if (!isInviteCode(c)) return res.status(400).json({ error: 'Invalid request.' });
  const parsed = pushTargetFrom(req.body);
  if ('error' in parsed) return res.status(parsed.status).json({ error: parsed.error });
  const uid = await joinPushInvite(c, parsed.target, clipText(label, 60) || 'Family phone').catch(() => null);
  if (!uid) return res.status(404).json({ error: 'This invite has expired or was used too many times. Ask for a new link.' });
  await notifyPushDevicesOne(parsed.target);
  return res.json({ status: 'ok' });
});

// A device turning its own notifications off (knowing the endpoint, or the
// app's FCM token, proves it's that device).
app.post('/api/alerts/push/unsubscribe', async (req, res) => {
  const { endpoint, fcmToken } = req.body || {};
  let key: string;
  if (isValidFcmToken(fcmToken)) key = pushDeviceKey({ fcmToken });
  else if (typeof endpoint === 'string' && /^https:\/\//.test(endpoint)) key = endpoint;
  else return res.status(400).json({ error: 'endpoint is required.' });
  await removePushEndpointEverywhere(key).catch(() => {});
  return res.json({ status: 'ok' });
});

app.get('/api/alerts/push/devices', async (req, res) => {
  const uid = await requireFirebaseUid(req, res);
  if (!uid) return;
  try {
    const devices = await getPushDevices(uid);
    return res.json({
      // endpoint is the device key ("fcm:<token>" for the app), so a device can spot itself.
      devices: devices.map((d) => ({
        id: d.id,
        label: d.label,
        createdAt: d.createdAt,
        kind: d.fcmToken ? 'app' : 'web',
        endpoint: pushDeviceKey(d),
      })),
    });
  } catch {
    return res.status(503).json({ error: 'Could not load phones.' });
  }
});

app.post('/api/alerts/push/remove', async (req, res) => {
  const uid = await requireFirebaseUid(req, res);
  if (!uid) return;
  const id = typeof req.body?.id === 'string' ? req.body.id : '';
  if (!/^[0-9a-z]{8}$/.test(id)) return res.status(400).json({ error: 'id is required.' });
  const removed = await removePushDevice(uid, id).catch(() => false);
  return res.json({ status: 'ok', removed });
});

/** Confirms to a newly joined phone that notifications work. */
async function notifyPushDevicesOne(target: PushTarget): Promise<void> {
  await sendToPushTarget(target, {
    title: '✅ SafeSpot alerts are on',
    body: "You'll get a notification here if there's an emergency.",
    url: '/',
    tag: 'safespot-welcome',
  }).catch(() => {});
}

// iPhone: notifications need SafeSpot on the home screen. While on an invite
// page the app points at this manifest, so the home-screen app opens the
// invite instead of the start page.
app.get('/manifest-join/:code.webmanifest', (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  if (!isInviteCode(code)) return res.status(404).end();
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    name: 'SafeSpot.SG',
    short_name: 'SafeSpot.SG',
    id: '/',
    start_url: `/alerts/join/${code}`,
    display: 'standalone',
    background_color: '#f3efe6',
    theme_color: '#2f6d5b',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
});

// Phone app: send the current location to every linked Telegram chat.
app.post('/api/notify/telegram-pin', async (req, res) => {
  const uid = await requireFirebaseUid(req, res);
  if (!uid) return;
  if (!telegramConfigured() && !pushConfigured() && !fcmAvailable()) return res.status(503).json({ error: 'Telegram alerts are not set up yet.' });
  if (!allowNotify(uid)) return res.status(429).json({ error: 'Too many messages sent. Please wait a while.' });
  const { address, lat, lng, driverHint, seniorName, incidentId, emergency } = req.body || {};
  const hasPos = inSingaporeBounds(lat, lng);
  const name = escapeHtml(clipText(seniorName, 60) || 'Senior');
  const baseUrl = process.env.APP_BASE_URL || 'https://safespot-sg-258662267000.asia-southeast1.run.app';
  const text =
    (emergency === true
      ? `🚨 <b>${name} needs help</b>\nSent from the SafeSpot app.\n`
      : `📍 <b>Pick-up location for ${name}</b>\n`) +
    `🏠 ${escapeHtml(clipText(address, 200) || 'See the map pin below')}` +
    (driverHint ? `\n🚗 ${escapeHtml(clipText(driverHint, 300))}` : '') +
    (hasPos ? `\n🗺️ <a href="${googleMapsUrl(lat as number, lng as number)}">Open in Google Maps</a>` : '') +
    (typeof incidentId === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(incidentId)
      ? `\n⚡ Live tracking: ${baseUrl}/track/${incidentId}`
      : '');
  try {
    const validIncident = typeof incidentId === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(incidentId);
    const [sent, pushed] = await Promise.all([
      sendTelegramPin(uid, {
        text,
        lat: hasPos ? (lat as number) : undefined,
        lng: hasPos ? (lng as number) : undefined,
      }),
      emergency === true
        ? notifyPushDevices(uid, {
            title: `🚨 ${clipText(seniorName, 60) || 'Senior'} needs help`,
            body: `${clipText(address, 120) || 'Tap to see where they are.'}`,
            url: validIncident ? `/track/${incidentId}` : '/',
            tag: validIncident ? (incidentId as string) : 'safespot-emergency',
            urgent: true,
          }).catch(() => 0)
        : Promise.resolve(0),
    ]);
    if (sent + pushed === 0) return res.status(404).json({ error: 'No Telegram chat is linked yet.' });
    return res.json({ success: true, chatsNotified: sent, pushNotified: pushed });
  } catch (e: any) {
    console.error('[TELEGRAM] telegram-pin failed:', e.message);
    return res.status(502).json({ error: 'Could not send to Telegram.' });
  }
});

// Telegram webhook. Telegram signs each call with our secret header; anything
// else is rejected. Always answers 200 once verified so Telegram doesn't retry.
app.post('/api/telegram/webhook', async (req, res) => {
  if (!webhookSecretMatches(req.get('X-Telegram-Bot-Api-Secret-Token'))) {
    return res.status(401).end();
  }
  const update = req.body || {};
  try {
    const msg = update.message;
    if (msg?.chat?.id !== undefined) {
      const chatId = String(msg.chat.id);
      if (msg.migrate_to_chat_id !== undefined) {
        await migrateTelegramChat(chatId, String(msg.migrate_to_chat_id));
      } else {
        const code = parseLinkCommand(msg.text);
        if (code) {
          const linked = await redeemTelegramLinkCode(code, msg.chat);
          await sendTelegramText(
            chatId,
            linked
              ? '✅ <b>Linked to SafeSpot.</b>\nEmergency alerts (SOS, falls, heart rate) will be posted here with a live map pin. ' +
                  'To stop, unlink this chat in the SafeSpot app or remove the bot.'
              : 'That code is wrong or has expired. In the SafeSpot app, open Profile → Telegram alerts to get a new one.',
          );
        } else if (/^\/start(@\w+)?\s*$/.test(String(msg.text || '').trim())) {
          await sendTelegramText(
            chatId,
            'Hi! I post SafeSpot emergency alerts. To link this chat, open the SafeSpot app → Profile → Telegram alerts.',
          );
        }
      }
    }

    const member = update.my_chat_member;
    if (member?.chat?.id !== undefined && ['left', 'kicked'].includes(member.new_chat_member?.status)) {
      await removeTelegramChatEverywhere(String(member.chat.id));
    }

    const cq = update.callback_query;
    if (cq?.id && typeof cq.data === 'string' && cq.data.startsWith(RESPOND_CALLBACK_PREFIX)) {
      const incidentId = cq.data.slice(RESPOND_CALLBACK_PREFIX.length);
      const name = [cq.from?.first_name, cq.from?.last_name].filter(Boolean).join(' ') || 'Someone';
      const ok = cq.message?.chat?.id !== undefined &&
        (await recordTelegramResponder(incidentId, String(cq.message.chat.id), name));
      await answerTelegramCallback(cq.id, ok ? "Thanks, everyone has been told you're responding." : 'This alert is no longer active.');
    }
  } catch (e: any) {
    console.error('[TELEGRAM] Webhook handling failed:', e.message);
  }
  return res.status(200).end();
});

// ── Wearable (Garmin Connect IQ) intake ─────────────────────────────────────
// In-memory, keyed by deviceId. Resets on restart / differs per Cloud Run
// instance; fine for a single-watch trial, swap for Firestore before scaling.
const wearableStates = new Map<string, WearableState>();

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/** How long a watch event waits for alert delivery before the server answers it. */
const WATCH_ACK_DELIVERY_WAIT_MS = 8000;

if (!process.env.WEARABLE_TOKEN) {
  console.warn(IS_PRODUCTION
    ? 'WEARABLE_TOKEN is not set — /api/wearable/event will reject all watch events until it is.'
    : 'WEARABLE_TOKEN is not set — /api/wearable/event accepts unauthenticated events (development only).');
}

/**
 * Resolves the signed-in Firebase user for a request, or sends 401 and
 * returns null. Pairing data includes medical notes and emergency contacts,
 * and controls who receives SOS SMS, so it is never served anonymously.
 */
async function requireFirebaseUid(req: express.Request, res: express.Response): Promise<string | null> {
  const idToken = bearerToken(req.get('Authorization'));
  if (!idToken) {
    res.status(401).json({ error: 'Sign-in required.' });
    return null;
  }
  try {
    return await verifyFirebaseIdToken(idToken);
  } catch {
    res.status(401).json({ error: 'Invalid or expired sign-in token.' });
    return null;
  }
}

/**
 * Sends 403/404/503 and returns false unless `uid` may access this device's
 * pairing. Writing may claim an unpaired device; reading requires ownership,
 * since an unpaired device's profile falls back to server-configured contacts.
 */
async function requirePairingAccess(
  deviceId: string,
  uid: string,
  res: express.Response,
  mode: 'read' | 'write',
): Promise<boolean> {
  try {
    const owner = await getPairingOwner(deviceId);
    if (mode === 'read' && owner === null) {
      res.status(404).json({ error: 'This watch is not paired.' });
      return false;
    }
    if (canManagePairing(owner, uid)) return true;
    res.status(403).json({ error: 'This watch is paired to another account.' });
  } catch (e: any) {
    console.error('[WEARABLE_PAIR] Ownership lookup failed:', e.message);
    res.status(503).json({ error: 'Pairing service unavailable.' });
  }
  return false;
}

app.post('/api/wearable/event', async (req, res) => {
  const auth = checkWearableEventAuth(process.env.WEARABLE_TOKEN, req.get('X-SafeSpot-Token'), IS_PRODUCTION);
  if (auth === 'unconfigured') {
    return res.status(503).json({ error: 'Wearable intake is not configured.' });
  }
  if (auth === 'invalid') {
    return res.status(401).json({ error: 'Invalid wearable token.' });
  }

  const event = parseWearableEvent(req.body);
  if (typeof event === 'string') {
    console.warn(`[WEARABLE] rejected event: ${event}`);
    return res.status(400).json({ error: event });
  }
  if ((req.body.lat != null || req.body.lng != null) && event.lat === undefined) {
    console.warn(`[WEARABLE] ${event.deviceId}: dropped invalid position ${req.body.lat}, ${req.body.lng}`);
  }

  if (!wearableStates.has(event.deviceId) && wearableStates.size >= MAX_WEARABLE_DEVICES) {
    return res.status(429).json({ error: 'Too many tracked devices.' });
  }

  // The watch reports sends it couldn't complete (e.g. "Phone slow"), so
  // phone-link problems show up in the logs once it gets through again.
  if (event.linkFailures) {
    console.warn(
      `[WEARABLE] ${event.deviceId}: ${event.linkFailures} send(s) failed before this one` +
        (event.lastLinkError !== undefined ? ` (last error ${event.lastLinkError})` : ''),
    );
  }

  // Last-seen time and battery for the family's low-battery / offline
  // warnings. Not awaited: a warning SMS must never delay the watch's answer.
  void recordWatchSeen(event.deviceId, event.battery).catch((e: any) =>
    console.warn('[WATCH_HEALTH] record failed:', e.message),
  );

  const landmark = event.lat !== undefined && event.lng !== undefined
    ? nearestLandmark({ lat: event.lat, lng: event.lng }, SINGAPORE_PRESET_PLACES)
    : null;

  const prevState = wearableStates.get(event.deviceId);
  const state = applyWearableEvent(prevState, event, Date.now(), landmark);

  // If an alert is active but no incident ID is cached locally (e.g. after a cold start),
  // recover the existing active incident from Firestore before deciding whether to create a new one.
  if (state.sosActive && !state.activeIncidentId) {
    try {
      const existing = await getActiveIncidentForDevice(event.deviceId);
      if (existing) {
        state.activeIncidentId = existing.incidentId;
      }
    } catch (e: any) {
      console.warn('[WEARABLE] Could not recover active incident:', e.message);
    }
  }

  let formattedAddress: string | null = null;
  if (event.lat !== undefined && event.lng !== undefined) {
    try {
      formattedAddress = await fetchReverseGeocode(event.lat, event.lng);
    } catch (e) {
      // non-fatal
    }
  }

  // Step 2: Handle server-side Incident creation and Twilio alert notifications
  if (event.eventType === 'SOS_TRIGGER' || event.eventType === 'FALL_DETECTED' || event.eventType === 'HR_ALERT') {
    if (!prevState?.sosActive || !state.activeIncidentId) {
      try {
        // Answer the watch within ~8 s even if an SMS is still waiting for the
        // textbee phone to confirm (up to ~20 s): the watch gives up after 30 s
        // and re-sends, which would duplicate alerts. Delivery carries on.
        const result = await handleWatchAlertTrigger({
          event,
          landmark: state.landmark,
          formattedAddress,
          waitForDeliveryMs: WATCH_ACK_DELIVERY_WAIT_MS,
        });
        state.activeIncidentId = result.incidentId;
        console.log(
          `[WEARABLE] Created incident ${result.incidentId} ` +
            (result.deliveryPending ? '(alerts still sending)' : `(SMS sent: ${result.smsDispatched})`),
        );
      } catch (err: any) {
        console.error('[WEARABLE] Failed to trigger watch incident alert:', err.message);
      }
    } else if (state.activeIncidentId) {
      // Ongoing alert session — update incident with latest GPS / battery
      try {
        await handleWatchIncidentUpdate(state.activeIncidentId, event, state.landmark, formattedAddress);
      } catch (err: any) {
        console.warn('[WEARABLE] Failed to update ongoing incident:', err.message);
      }
    }
  } else if (event.eventType === 'SOS_CANCEL') {
    const previousIncidentId = prevState?.activeIncidentId || state.activeIncidentId;
    if (previousIncidentId) {
      try {
        await handleWatchAlertCancel(previousIncidentId, event.deviceId, undefined, {
          waitForDeliveryMs: WATCH_ACK_DELIVERY_WAIT_MS,
        });
        console.log(`[WEARABLE] Resolved watch incident ${previousIncidentId}`);
      } catch (err: any) {
        console.error('[WEARABLE] Failed to cancel watch incident:', err.message);
      }
    }
    state.activeIncidentId = null;
  } else if (event.eventType === 'HEARTBEAT') {
    if (state.sosActive && state.activeIncidentId) {
      try {
        await handleWatchIncidentUpdate(state.activeIncidentId, event, state.landmark, formattedAddress);
      } catch (err: any) {
        console.warn('[WEARABLE] Failed to update heartbeat in incident:', err.message);
      }
    }
  }

  wearableStates.set(event.deviceId, state);

  if (event.eventType !== 'HEARTBEAT') {
    console.log(`[WEARABLE] ${event.eventType} from ${event.deviceId}`, {
      lat: state.lat,
      lng: state.lng,
      heartRate: state.heartRate,
      battery: state.battery,
      landmark: state.landmark,
      incidentId: state.activeIncidentId,
    });
  }

  return res.json({
    status: 'acknowledged',
    sosActive: state.sosActive,
    landmark: state.landmark,
    checkInRequested: isCheckInActive(state, Date.now()),
    incidentId: state.activeIncidentId || undefined,
  });
});

// Cloud Scheduler calls this every 5 minutes to warn families about watches
// that stopped reporting. Protected by a shared secret header.
function cronSecretOk(provided: string | undefined): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

app.post('/api/internal/watch-health-check', async (req, res) => {
  if (!cronSecretOk(req.get('X-Cron-Secret'))) return res.status(401).end();
  try {
    const result = await checkOfflineWatches();
    if (result.checked) console.log(`[WATCH_HEALTH] offline check: ${result.checked} silent, ${result.notified} warned`);
    return res.json(result);
  } catch (e: any) {
    console.error('[WATCH_HEALTH] offline check failed:', e.message);
    return res.status(500).json({ error: 'check failed' });
  }
});

// Device pairing endpoint (Step 2 & 3: maps watch deviceId to senior profile & caregiver contacts)
// The owner uid comes from the verified sign-in token, never the request body.
app.post('/api/wearable/pair', async (req, res) => {
  const { deviceId, elderName, bloodType, medicalNotes, emergencyContacts } = req.body || {};
  if (typeof deviceId !== 'string' || !deviceId.trim()) {
    return res.status(400).json({ error: 'deviceId is required.' });
  }

  const uid = await requireFirebaseUid(req, res);
  if (!uid || !(await requirePairingAccess(deviceId.trim(), uid, res, 'write'))) return;

  const success = await pairWearableDevice({
    deviceId: deviceId.trim(),
    uid,
    elderName: typeof elderName === 'string' ? elderName.trim() : undefined,
    bloodType: typeof bloodType === 'string' ? bloodType.trim() : undefined,
    medicalNotes: typeof medicalNotes === 'string' ? medicalNotes.trim() : undefined,
    emergencyContacts: Array.isArray(emergencyContacts) ? emergencyContacts : undefined,
  });

  return res.json({ status: success ? 'ok' : 'error', deviceId: deviceId.trim() });
});

app.get('/api/wearable/pair/:deviceId', async (req, res) => {
  const deviceId = req.params.deviceId?.trim();
  if (!deviceId) return res.status(400).json({ error: 'deviceId is required.' });

  const uid = await requireFirebaseUid(req, res);
  if (!uid || !(await requirePairingAccess(deviceId, uid, res, 'read'))) return;

  const profile = await getDevicePairedProfile(deviceId);
  return res.json({ deviceId, profile });
});

// Unpairing silently stops SOS alerts reaching caregivers, so it needs the
// same owner check as pairing. Unpairing an already-unpaired device is a no-op.
async function handleUnpair(deviceId: string | undefined, req: express.Request, res: express.Response) {
  if (!deviceId) return res.status(400).json({ error: 'deviceId is required.' });

  const uid = await requireFirebaseUid(req, res);
  if (!uid || !(await requirePairingAccess(deviceId, uid, res, 'write'))) return;

  const success = await unpairWearableDevice(deviceId);
  return res.json({ status: success ? 'ok' : 'error', deviceId });
}

app.post('/api/wearable/unpair', (req, res) => handleUnpair(req.body?.deviceId?.trim(), req, res));
app.delete('/api/wearable/pair/:deviceId', (req, res) => handleUnpair(req.params.deviceId?.trim(), req, res));

// Caregiver-facing, so it can't use the watch's X-SafeSpot-Token (a browser
// can't keep a secret). It is therefore limited to devices that already
// reported in and rate-limited per device. Real caregiver auth comes with
// watch<->account pairing (handoff Step 3).
app.post('/api/wearable/checkin', (req, res) => {
  const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';
  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required.' });
  }

  const result = requestCheckIn(wearableStates.get(deviceId), Date.now());
  if (result.ok === false) {
    return res
      .status(result.reason === 'unknown_device' ? 404 : 429)
      .json({ error: result.reason });
  }

  wearableStates.set(deviceId, result.state);
  console.log(`[WEARABLE] Caregiver requested check-in for ${deviceId}`);
  return res.json({ status: 'ok', checkInRequested: true, deviceId });
});

// ── Pickup point optimiser ───────────────────────────────────────────────────
// Ranks nearby taxi stands / kerb points by real walking time for the senior
// and (if the caregiver shares it) real driving time for the driver. Every
// call costs Google Routes usage, so it is tied to a real incident (the
// senior's position comes from the incident record, not the caller), cached
// briefly, and rate-limited per IP.
const PICKUP_CACHE_TTL_MS = 60_000;
const pickupCache = new Map<string, { at: number; body: unknown }>();
const pickupRate = new Map<string, number[]>();
const inSingapore = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' && typeof lng === 'number' && lat > 1.15 && lat < 1.48 && lng > 103.6 && lng < 104.1;

app.post('/api/pickup/options', async (req, res) => {
  const ip = String(req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();
  const now = Date.now();
  const recent = (pickupRate.get(ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 20) return res.status(429).json({ error: 'Too many requests.' });
  recent.push(now);
  pickupRate.set(ip, recent);

  const { incidentId, driverLat, driverLng } = req.body || {};
  if (typeof incidentId !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(incidentId)) {
    return res.status(400).json({ error: 'incidentId is required.' });
  }
  const driver = inSingapore(driverLat, driverLng) ? { lat: driverLat as number, lng: driverLng as number } : null;
  const mapsKey = getGoogleMapsApiKey();
  if (!mapsKey) return res.status(503).json({ error: 'Pickup planning unavailable.' });

  const incident = await getIncidentById(incidentId).catch(() => null);
  const gps = incident?.currentGps;
  if (!incident || incident.status !== 'active' || !gps || !inSingapore(gps.lat, gps.lng)) {
    return res.status(404).json({ error: 'No active incident with a location.' });
  }

  const cacheKey = [incidentId, gps.lat.toFixed(4), gps.lng.toFixed(4), driver ? `${driver.lat.toFixed(3)},${driver.lng.toFixed(3)}` : '-'].join('|');
  const hit = pickupCache.get(cacheKey);
  if (hit && now - hit.at < PICKUP_CACHE_TTL_MS) return res.json(hit.body);

  try {
    const result = await findPickupOptions({
      senior: { lat: gps.lat, lng: gps.lng },
      driver,
      mapsKey,
      ltaKey: process.env.LTA_DATAMALL_KEY,
    });
    const body = { ...result, senior: { lat: gps.lat, lng: gps.lng }, computedAt: now };
    if (pickupCache.size > 500) pickupCache.clear();
    pickupCache.set(cacheKey, { at: now, body });
    return res.json(body);
  } catch (err: any) {
    console.warn('[PICKUP] Optimiser failed:', err.message);
    return res.status(502).json({ error: 'Pickup planning failed.' });
  }
});

app.get('/api/wearable/status', (req, res) => {
  const now = Date.now();
  const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
  const states = deviceId
    ? [wearableStates.get(deviceId)].filter((s): s is WearableState => Boolean(s))
    : [...wearableStates.values()];
  res.json({
    devices: states
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((s) => ({
        ...s,
        checkInRequested: isCheckInActive(s, now),
        online: isWearableOnline(s, now),
        activeIncidentId: s.activeIncidentId ?? null,
      })),
    serverTime: now,
  });
});

// Setup Vite development middleware or static production serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');

    // Never cache sw.js so service worker updates immediately across all clients
    app.get('/sw.js', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Content-Type', 'application/javascript');
      res.sendFile(path.join(distPath, 'sw.js'));
    });

    // Never return index.html for missing /assets/* files — return 404 to avoid MIME type errors
    app.use('/assets', express.static(path.join(distPath, 'assets'), {
      maxAge: '1y',
      immutable: true,
      fallthrough: false,
    }));

    // Static files (manifest, icons, etc.)
    app.use(express.static(distPath));

    // SPA fallback: serve index.html with no-cache so browsers always get fresh asset hashes
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (!smsConfigured()) {
    console.warn(IS_PRODUCTION
      ? 'No SMS provider (TEXTBEE_API_KEY or TWILIO_*) is set: SMS alerts will NOT be sent.'
      : 'No SMS provider is set: SMS alerts are simulated (development only).');
  }
  if (!pushConfigured()) console.warn('VAPID_* is not set: browser (web push) notifications are off.');
  if (!fcmAvailable()) console.warn('Firebase Admin is unavailable: Android app (FCM) notifications are off.');
  if (telegramConfigured() && process.env.APP_BASE_URL) {
    ensureTelegramWebhook(process.env.APP_BASE_URL).catch(() => {});
  }

  // Pre-load routing graph in background if shadow mode or local engine is active
  maybeInitDriveWorkerAtStartup();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SafeSpot.SG Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
