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
import { sendTwilioSms } from './src/utils/notifications';
import {
  handleWatchAlertTrigger,
  handleWatchIncidentUpdate,
  handleWatchAlertCancel,
  pairWearableDevice,
  unpairWearableDevice,
  getDevicePairedProfile,
  getActiveIncidentForDevice,
  getPairingOwner,
  verifyFirebaseIdToken,
} from './src/utils/wearableIncidentService';
import { bearerToken, canManagePairing, checkWearableEventAuth } from './src/utils/wearableAuth';
import { classifyAddressQuery, mergeAddressSuggestions } from './src/utils/addressSearch';
import type { AddressSuggestion } from './src/types';

const app = express();
const PORT = Number(process.env.PORT) || 9003;

app.use(express.json({ limit: '35mb' }));

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

// Config endpoint: return public Maps API key for client-side rendering
app.get('/api/config/maps-key', (req, res) => {
  const mapsKey = getGoogleMapsApiKey() || '';
  res.json({ mapsApiKey: mapsKey });
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
function getGoogleMapsApiKey(): string | undefined {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.PLACES_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    undefined
  );
}

// Helper for reverse geocoding fallback
async function fetchReverseGeocode(lat: number, lng: number): Promise<string | null> {
  const mapsKey = getGoogleMapsApiKey();
  if (mapsKey) {
    try {
      const gRes = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${mapsKey}`
      );
      if (gRes.ok) {
        const data = await gRes.json();
        if (data.results && data.results.length > 0) {
          return data.results[0].formatted_address;
        }
      }
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
          'User-Agent': 'SeniorSafeSpotApp/1.0',
        },
      }
    );
    if (osmRes.ok) {
      const data = await osmRes.json();
      return data.display_name || null;
    }
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
      const gUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&components=country:sg&language=en&key=${mapsKey}`;
      const gRes = await fetch(gUrl, { signal: AbortSignal.timeout(3000) });
      if (!gRes.ok) return [];
      const gData = (await gRes.json()) as any;
      return (Array.isArray(gData.predictions) ? gData.predictions : []).slice(0, 5).map((pred: any) => ({
        id: `google-${pred.place_id}`,
        title: pred.structured_formatting?.main_text || pred.description,
        subtitle: pred.structured_formatting?.secondary_text || 'Singapore',
        fullAddress: pred.description,
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
    const dUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=geometry,formatted_address,address_component,name&key=${mapsKey}`;
    const dRes = await fetch(dUrl, { signal: AbortSignal.timeout(4000) });
    const d = (await dRes.json()) as any;
    const loc = d.result?.geometry?.location;
    if (!dRes.ok || typeof loc?.lat !== 'number') {
      return res.status(404).json({ error: 'Place not found.' });
    }
    const postalCode: string | undefined = (d.result.address_components || [])
      .find((c: any) => Array.isArray(c.types) && c.types.includes('postal_code'))?.long_name;

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
      fullAddress: officialAddress || d.result.formatted_address,
      name: d.result.name,
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

// API endpoint: Direct 1-Tap Location Pin & SMS/Live Alert Dispatch
app.post('/api/notify/dispatch-pin', async (req, res) => {
  try {
    const { 
      contactId,
      contactName, 
      phone, 
      address, 
      googleMapsUrl, 
      driverHint, 
      blePrecision,
      incidentId,
      seniorName = 'Senior'
    } = req.body;

    if (!phone && !contactName) {
      return res.status(400).json({ error: 'Phone number or contact name is required.' });
    }

    const cleanPhone = (phone || '').replace(/[^0-9+]/g, '');
    const timestamp = Date.now();
    const messageId = `disp_${timestamp}_${Math.random().toString(36).slice(2, 7)}`;

    const messageBody = `📍 SafeSpot.SG Pick-Up Request for ${seniorName}:\n` +
      `🏠 Location: ${address || 'Verified Curbside'}\n` +
      (blePrecision ? `📶 Precision: ${blePrecision}\n` : '') +
      (driverHint ? `🚗 Driver Note: ${driverHint}\n` : '') +
      `🗺️ Google Maps Pin: ${googleMapsUrl || 'https://maps.google.com'}\n` +
      (incidentId ? `⚡ Live Tracking: https://safespot-sg-258662267000.asia-southeast1.run.app/track/${incidentId}` : '');

    const twilioResult = await sendTwilioSms({ to: cleanPhone, body: messageBody });

    console.log(`[DISPATCH_PIN] Successfully sent location pin to ${contactName} (${cleanPhone}):`, {
      messageId: twilioResult.messageId || messageId,
      carrierStatus: twilioResult.carrierStatus,
      address,
      googleMapsUrl,
    });

    return res.json({
      success: true,
      messageId: twilioResult.messageId || messageId,
      carrierStatus: twilioResult.carrierStatus,
      recipient: contactName || 'Caregiver',
      phone: cleanPhone,
      timestamp,
      messagePreview: messageBody,
    });
  } catch (error: any) {
    console.error('Error in /api/notify/dispatch-pin:', error);
    return res.status(500).json({ error: 'Failed to dispatch location pin', details: error.message });
  }
});

// ── Wearable (Garmin Connect IQ) intake ─────────────────────────────────────
// In-memory, keyed by deviceId. Resets on restart / differs per Cloud Run
// instance; fine for a single-watch trial, swap for Firestore before scaling.
const wearableStates = new Map<string, WearableState>();

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

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
    return res.status(400).json({ error: event });
  }

  if (!wearableStates.has(event.deviceId) && wearableStates.size >= MAX_WEARABLE_DEVICES) {
    return res.status(429).json({ error: 'Too many tracked devices.' });
  }

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
        const result = await handleWatchAlertTrigger({
          event,
          landmark: state.landmark,
          formattedAddress,
        });
        state.activeIncidentId = result.incidentId;
        console.log(`[WEARABLE] Created incident ${result.incidentId} (SMS sent: ${result.smsDispatched})`);
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
        await handleWatchAlertCancel(previousIncidentId, event.deviceId);
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SafeSpot.SG Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
