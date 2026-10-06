/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface GPSLocation {
  latitude: number;
  longitude: number;
  accuracy: number; // in meters
  heading: number | null;
  speed: number | null;
  altitude: number | null;
  /** Vertical accuracy radius in metres, when the GNSS chip reports one. */
  altitudeAccuracy?: number | null;
  timestamp: number;
}

/**
 * Phase 1 shutter-time sensor payload: compass heading + pitch + roll frozen
 * at the exact millisecond the photo is taken. Barometer pressure and focal
 * length are native-only and deliberately absent on the web platform.
 */
export interface SensorMetadata {
  heading: number | null;
  pitch: number | null;
  roll: number | null;
  capturedAt: number;
}

export interface LandmarkFeature {
  id: string;
  name: string;
  description: string;
  category: 'storefront' | 'building' | 'door_entrance' | 'signage' | 'seating_bench' | 'street_element' | 'color_pattern';
  matchedInStreetView: boolean;
  confidence: number; // 0 to 100
}

export interface StreetViewComparisonData {
  available: boolean;
  heading: number;
  pitch: number;
  fov: number;
  streetViewImageUrl?: string;
  comparisonSummary: string;
  matchingFeatures: string[];
}

export interface LocationVerificationResult {
  originalCoordinates: {
    lat: number;
    lng: number;
    accuracyMeters: number;
  };
  verifiedCoordinates: {
    lat: number;
    lng: number;
  };
  confidenceScore: number; // 0 - 100
  accuracyLevel: 'EXACT' | 'HIGH' | 'MODERATE' | 'ESTIMATED';
  formattedAddress: string;
  streetName: string;
  nearbyCrossStreet: string;
  roadSnapping?: {
    snapped: boolean;
    snappedCoordinates?: { lat: number; lng: number } | null;
    placeId?: string;
  };
  nearbyPlaces?: Array<{
    name: string;
    type: string;
    address?: string;
  }>;
  visualLandmarks: LandmarkFeature[];
  isIndoors?: boolean;
  environmentType?: 'indoor_mall' | 'indoor_mrt' | 'hdb_void_deck' | 'sheltered_porch' | 'outdoor_roadside' | 'underground';
  indoorContext?: string;
  indoorExitGuidance?: string;
  bleBeacons?: BLEBeaconScan[];
  bleAccuracyBoost?: boolean; // True if BLE micro-location refined accuracy to < 3m
  pickupInstructionsForDriver: string;
  elderlyVoiceSummary: string;
  safeWaitingAdvice: string;
  streetViewData: StreetViewComparisonData;
  shareUrls: {
    googleMapsUrl: string;
    appleMapsUrl: string;
    wazeUrl: string;
    smsBody: string;
    whatsappUrl: string;
  };
  timestamp: number;
  photoUrl?: string;
  /** Shutter-time sensor payload that oriented the candidate retrieval. */
  sensor?: SensorMetadata | null;
  /** Phase 2 Street View panoramas retrieved inside the accuracy bounding box. */
  candidatePanoramas?: Array<{
    label: string; // 'A' | 'B' | 'C'
    panoId: string;
    lat: number;
    lng: number;
    distanceMeters: number;
    bearingDeg: number;
  }>;
  /** Label of the panorama Gemini visually matched to the senior's photo. */
  matchedCandidate?: string | null;
  /** True when verifiedCoordinates came from a matched panorama, not raw GPS. */
  refinedByCandidate?: boolean;
}

/** A beacon actually heard on the radio during a Web Bluetooth scan. */
export interface BLEBeaconScan {
  id: string;
  name: string;
  uuid?: string;
  major?: number;
  minor?: number;
  rssi: number; // Measured signal strength in dBm, e.g. -62
  txPower?: number; // Calibrated RSSI at 1m, from the advertisement when broadcast
  proximity: 'immediate' | 'near' | 'far' | 'unknown'; // <1m, 1-3m, >3m
  estimatedDistanceMeters: number;
  locationName: string; // e.g. "Toa Payoh Hub Taxi Stand 1 - Beacon #04"
  floorLevel?: string; // e.g. "Level 1" or "Basement 1 Concourse"
  zoneType: 'transit_hub' | 'hospital' | 'hdb_estate' | 'shopping_mall' | 'caregiver_tag' | 'building_entrance' | 'community_zone' | 'unknown';
  lat?: number;
  lng?: number;
  batteryPercent?: number;
  /** Advertisement format this was decoded from. */
  format: 'ibeacon' | 'eddystone' | 'generic';
  /**
   * Where this reading came from. 'radio' = a real advertisement measured
   * over the air; 'geofence' = a surveyed venue matched by GPS proximity,
   * whose distance is a GPS estimate, never a radio measurement.
   */
  source?: 'radio' | 'geofence';
  /** True only when the beacon's id matches a surveyed venue in the registry. */
  isKnownVenue: boolean;
  /** True when this is the senior's own paired safety pendant. */
  isPairedTag: boolean;
  /** Epoch ms of the last advertisement received from this beacon. */
  lastSeen: number;
}

/** What this browser and device are able to do with Bluetooth. */
export interface BLECapability {
  supported: boolean;
  canScan: boolean; // Passive advertisement scanning (requestLEScan)
  canPairDevice: boolean; // Device chooser (requestDevice)
  reason?: string; // Plain-language explanation when something is unavailable
}

export interface BLEScanState {
  status: 'idle' | 'requesting' | 'scanning' | 'denied' | 'unavailable';
  beaconCount: number;
  error?: string;
}

export interface EmergencyContact {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  emoji: string;
  bgColor: string;
  isPrimary: boolean;
  notes?: string;
  /** System contacts (e.g. 995 SCDF) are hard-coded and cannot be removed */
  locked?: boolean;
}

export type BloodType = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-' | 'Unknown';

/**
 * The places a senior actually travels between, set once in their profile
 * and offered as one-tap destinations — their own home and clinic, never a
 * pre-filled landmark.
 */
export type SavedPlaceKind = 'home' | 'work' | 'healthcare';

export interface SavedPlace {
  kind: SavedPlaceKind;
  /** Free-text address as the senior or caregiver entered it. */
  address: string;
  /** Optional friendly name, e.g. "Tan Tock Seng Polyclinic". */
  label?: string;
  /** Whether the healthcare provider is public or private, for triage context. */
  providerType?: 'public' | 'private';
  /** Resolved coordinates, filled in once the address has been geocoded. */
  lat?: number;
  lng?: number;
}

export interface AddressSuggestion {
  id?: string;
  title: string;
  subtitle?: string;
  fullAddress: string;
  postalCode?: string;
  lat?: number;
  lng?: number;
  source: 'google' | 'onemap' | 'singapore_landmark';
  category?: 'home' | 'work' | 'healthcare' | 'general';
}

export interface UserProfile {
  uid: string;
  actualName: string;
  dob: string; // e.g. YYYY-MM-DD or DD/MM/YYYY
  bloodType: BloodType;
  address: string; // Home address e.g. "Blk 123 Toa Payoh Lorong 1 #08-456, Singapore 310123"
  selfiePhotoUrl?: string; // Selfie photo base64 / URL
  /** Home, work and preferred healthcare provider, for one-tap pickup. */
  savedPlaces?: SavedPlace[];
  emergencyContacts: EmergencyContact[];
  phone?: string;
  email?: string;
  authProvider: 'google' | 'phone' | 'anonymous';
  medicalNotes?: string; // Optional allergies or medical conditions (e.g., "Diabetic, Pacemaker")
  wearableDeviceId?: string; // Paired Garmin watch ID, random per watch (e.g. "SS-7KQ2-M9XD-4TFH")
  createdAt: number;
  updatedAt: number;
}

export type HighContrastTheme = 'normal' | 'yellow-black' | 'black-white' | 'warm-soft';

export type FontSizeLevel = 'standard' | 'large' | 'extra-large';

// Singapore's 4 official languages for elder-friendly localization
export type Language = 'en' | 'zh' | 'ms' | 'ta';

export interface BatteryStatus {
  level: number | null; // 0-100, null if unsupported
  charging: boolean | null;
  supported: boolean;
}

export interface SpeechmaticsVoiceOption {
  id: string;
  name: string;
  gender: 'female' | 'male' | 'neutral';
  accent: string;
  flag: string;
  tone: string;
  description: string;
  sampleText: string;
  isRecommended?: boolean;
}

// NOTE: Matches the 4 voices currently supported by Speechmatics TTS preview.
// See https://docs.speechmatics.com/text-to-speech/quickstart#voices
export const SPEECHMATICS_VOICE_OPTIONS: SpeechmaticsVoiceOption[] = [
  {
    id: 'sarah',
    name: 'Sarah',
    gender: 'female',
    accent: 'British (UK)',
    flag: '🇬🇧',
    tone: 'Crisp & Professional',
    description: 'Clear, reassuring, and professional female voice. Highly recommended for elderly users and emergency assistance.',
    sampleText: 'Hello! I am Sarah. You are safe. I will help you verify your location and notify your family.',
    isRecommended: true,
  },
  {
    id: 'megan',
    name: 'Megan',
    gender: 'female',
    accent: 'American (US)',
    flag: '🇺🇸',
    tone: 'Dynamic & Conversational',
    description: 'Clear female companion voice with gentle inflection and smooth conversational cadence.',
    sampleText: 'Hi there, I am Megan. Please stay sheltered on the bench while your driver arrives.',
  },
  {
    id: 'theo',
    name: 'Theo',
    gender: 'male',
    accent: 'British (UK)',
    flag: '🇬🇧',
    tone: 'Expressive & Modern',
    description: 'Trusted British male presenter voice with distinct pronunciation and calm pacing.',
    sampleText: 'Good day. Theo here. Your location is confirmed and ready to share with your caregiver.',
  },
  {
    id: 'jack',
    name: 'Jack',
    gender: 'male',
    accent: 'American (US)',
    flag: '🇺🇸',
    tone: 'Clear & Steady',
    description: 'Clear, steady American male voice with natural intonation.',
    sampleText: 'Hello, this is Jack. Your pickup coordinates are verified and ready to go.',
  },
];

export interface AccessibilitySettings {
  contrastTheme: HighContrastTheme;
  fontSize: FontSizeLevel;
  spokenGuidance: boolean;
  simplifiedMode: boolean;
  haptics: boolean;
  alwaysShowStreetView: boolean;
  speechmaticsVoice: string; // 'sarah' | 'megan' | 'theo' | 'jack'
  speechmaticsRate?: number; // 0.85 (elder-friendly) to 1.0
  language: Language; // UI + voice readout language (default 'en')
  fallDetection?: boolean; // Passive accelerometer fall monitoring
  crashDetection?: boolean; // High-G vehicle crash impact detection (iOS / Android)
}

export type LocationSource = 'watch_gps' | 'phone_gps' | 'phone_ble_assisted' | 'fused_gps';

/**
 * Live incident document stored at Firestore `Incidents/{incidentId}`.
 * Created when the elder alerts family or when a crash/fall is detected.
 */
export interface Incident {
  incidentId: string;
  deviceId?: string;
  elderUid: string | null;
  elderName: string;
  elderSelfieUrl?: string;
  bloodType?: string;
  medicalNotes?: string;
  incidentType?: 'manual_sos' | 'fall' | 'crash' | 'heart_rate';
  crashMetrics?: {
    impactGForce: number; // in Gs (e.g. 3.8G)
    preImpactSpeedKmh: number; // e.g. 52 km/h
    peakRotationRateDps?: number; // degrees/sec
  };
  currentGps: {
    lat: number;
    lng: number;
    accuracy: number;
    timestamp: number;
  } | null;
  locationSource?: LocationSource;
  floorLevel?: string;
  venueName?: string;
  batteryLevel: number | null; // 0-100, null if unsupported
  isCharging: boolean | null;
  nearestLandmarks: string[];
  formattedAddress?: string;
  status: 'active' | 'resolved';
  createdAt: number;
  updatedAt: number;
}
