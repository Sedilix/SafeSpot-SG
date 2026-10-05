/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import admin from 'firebase-admin';
import type { Incident, EmergencyContact } from '../types';
import { sendTwilioSms } from './notifications';
import { WearableEvent } from './wearable';

export interface PairedWearableDoc {
  deviceId: string;
  uid?: string | null;
  elderName?: string;
  bloodType?: string;
  medicalNotes?: string;
  emergencyContacts?: EmergencyContact[];
  pairedAt?: number;
  updatedAt?: number;
}

export interface IncidentDispatchResult {
  incidentId: string;
  smsDispatched: boolean;
  contactsNotified: number;
}

let adminDb: admin.firestore.Firestore | null = null;
const inMemoryIncidents = new Map<string, Incident>();
const inMemoryPairings = new Map<string, PairedWearableDoc>();
let adminDbForced = false;

/**
 * Safely initializes Firebase Admin Firestore using Google Cloud Application
 * Default Credentials (ADC) on Cloud Run, or project config.
 */
export function getFirebaseAdminDb(): admin.firestore.Firestore | null {
  if (adminDb) return adminDb;
  if (process.env.NODE_ENV === 'test' && !adminDbForced) {
    return null;
  }

  try {
    if (admin.apps.length === 0) {
      // SafeSpot's Firebase project. Cloud Run itself still runs in the
      // cybrdeck GCP project, so GCLOUD_PROJECT must NOT be used as a fallback.
      const projectId = process.env.FIREBASE_PROJECT_ID || 'safespot-sg';
      admin.initializeApp({ projectId });
    }
    adminDb = admin.firestore();
    adminDb.settings({ ignoreUndefinedProperties: true });
    return adminDb;
  } catch (err: any) {
    console.warn('[FIREBASE_ADMIN] Firestore Admin initialization notice:', err.message);
    return null;
  }
}

/**
 * Reset admin DB instance (used in test fixtures).
 */
export function _setAdminDbForTest(db: admin.firestore.Firestore | null): void {
  adminDb = db;
  adminDbForced = db !== null;
}

/**
 * Returns paired user profile and emergency contacts for a given wearable deviceId.
 * Checks Firestore `WearableDevices/{deviceId}` and linked `Users/{uid}`,
 * with a fallback to environment variables or trial defaults.
 */
export async function getDevicePairedProfile(deviceId: string): Promise<{
  uid: string | null;
  elderName: string;
  bloodType: string;
  medicalNotes: string;
  emergencyContacts: EmergencyContact[];
}> {
  const db = getFirebaseAdminDb();
  let pairedDoc: PairedWearableDoc | null = inMemoryPairings.get(deviceId) || null;

  if (db && !pairedDoc) {
    try {
      const snap = await db.collection('WearableDevices').doc(deviceId).get();
      if (snap.exists) {
        pairedDoc = snap.data() as PairedWearableDoc;
      }
    } catch (e: any) {
      console.warn(`[WEARABLE_INCIDENT] Error querying WearableDevices/${deviceId}:`, e.message);
    }
  }

  // If paired to a user account UID, attempt to pull latest user profile from Firestore Users/{uid}
  if (db && pairedDoc?.uid) {
    try {
      const userSnap = await db.collection('Users').doc(pairedDoc.uid).get();
      if (userSnap.exists) {
        const u = userSnap.data() as Record<string, any>;
        return {
          uid: pairedDoc.uid,
          elderName: u.actualName || pairedDoc.elderName || 'Senior',
          bloodType: u.bloodType || pairedDoc.bloodType || 'Unknown',
          medicalNotes: u.medicalNotes || pairedDoc.medicalNotes || '',
          emergencyContacts: Array.isArray(u.emergencyContacts) && u.emergencyContacts.length > 0
            ? u.emergencyContacts
            : pairedDoc.emergencyContacts || [],
        };
      }
    } catch (e: any) {
      console.warn(`[WEARABLE_INCIDENT] Error querying Users/${pairedDoc.uid}:`, e.message);
    }
  }

  if (pairedDoc) {
    return {
      uid: pairedDoc.uid || null,
      elderName: pairedDoc.elderName || 'Senior',
      bloodType: pairedDoc.bloodType || 'Unknown',
      medicalNotes: pairedDoc.medicalNotes || '',
      emergencyContacts: pairedDoc.emergencyContacts || [],
    };
  }

  // Fallback defaults for trial / unconfigured watches
  const fallbackPhone = process.env.WEARABLE_FALLBACK_PHONE || process.env.TRIAL_CAREGIVER_PHONE || '';
  const fallbackContacts: EmergencyContact[] = fallbackPhone
    ? [
        {
          id: 'trial_fallback_contact',
          name: process.env.WEARABLE_FALLBACK_NAME || 'Family Caregiver',
          relationship: 'Caregiver',
          phone: fallbackPhone,
          emoji: '👨‍👩‍👧',
          bgColor: '#2D3748',
          isPrimary: true,
        },
      ]
    : [];

  return {
    uid: null,
    elderName: process.env.WEARABLE_SENIOR_NAME || 'Senior',
    bloodType: 'Unknown',
    medicalNotes: '',
    emergencyContacts: fallbackContacts,
  };
}

/**
 * Register or update device pairing in Firestore / in-memory.
 */
export async function pairWearableDevice(doc: PairedWearableDoc): Promise<boolean> {
  const now = Date.now();
  const payload: PairedWearableDoc = {
    ...doc,
    updatedAt: now,
    pairedAt: doc.pairedAt || now,
  };

  inMemoryPairings.set(doc.deviceId, payload);

  const db = getFirebaseAdminDb();
  if (db) {
    try {
      await db.collection('WearableDevices').doc(doc.deviceId).set(payload, { merge: true });
      return true;
    } catch (e: any) {
      console.warn(`[WEARABLE_PAIR] Failed to write WearableDevices/${doc.deviceId}:`, e.message);
    }
  }
  return true;
}

/**
 * Unpairs a wearable device, removing it from Firestore and in-memory cache.
 */
export async function unpairWearableDevice(deviceId: string): Promise<boolean> {
  inMemoryPairings.delete(deviceId);
  const db = getFirebaseAdminDb();
  if (db) {
    try {
      await db.collection('WearableDevices').doc(deviceId).delete();
      return true;
    } catch (e: any) {
      console.warn(`[WEARABLE_PAIR] Failed to delete WearableDevices/${deviceId}:`, e.message);
    }
  }
  return true;
}

/**
 * UID of the account that owns a device pairing, or null if it is unpaired.
 * Firestore read errors are thrown (not swallowed) so callers fail closed.
 */
export async function getPairingOwner(deviceId: string): Promise<string | null> {
  const cached = inMemoryPairings.get(deviceId);
  if (cached) return cached.uid ?? null;

  const db = getFirebaseAdminDb();
  if (!db) return null;
  const snap = await db.collection('WearableDevices').doc(deviceId).get();
  return snap.exists ? ((snap.data() as PairedWearableDoc).uid ?? null) : null;
}

/** Verifies a Firebase Auth ID token and returns the caller's uid. Throws if invalid. */
export async function verifyFirebaseIdToken(idToken: string): Promise<string> {
  if (!getFirebaseAdminDb()) {
    throw new Error('Firebase Admin is not available.');
  }
  const decoded = await admin.auth().verifyIdToken(idToken);
  return decoded.uid;
}

/**
 * Maps wearable event types to incidentType enum in Incident schema.
 */
export function mapEventToIncidentType(
  eventType: WearableEvent['eventType']
): Incident['incidentType'] {
  switch (eventType) {
    case 'FALL_DETECTED':
      return 'fall';
    case 'HR_ALERT':
      return 'heart_rate';
    case 'SOS_TRIGGER':
    default:
      return 'manual_sos';
  }
}

/**
 * Formats a high-urgency emergency SMS body for caregiver emergency contacts.
 */
export function formatEmergencySms(params: {
  elderName: string;
  eventType: WearableEvent['eventType'];
  incidentId: string;
  serverBaseUrl: string;
  landmark?: string | null;
  formattedAddress?: string | null;
  lat?: number;
  lng?: number;
  heartRate?: number;
  battery?: number;
}): string {
  const {
    elderName,
    eventType,
    incidentId,
    serverBaseUrl,
    landmark,
    formattedAddress,
    lat,
    lng,
    heartRate,
    battery,
  } = params;

  let header = `🚨 SafeSpot.SG EMERGENCY SOS: Senior ${elderName} triggered an emergency SOS from their Garmin watch!`;
  if (eventType === 'FALL_DETECTED') {
    header = `🚨 SafeSpot.SG FALL ALERT: Fall & impact detected for Senior ${elderName} on their Garmin watch!`;
  } else if (eventType === 'HR_ALERT') {
    header = `🚨 SafeSpot.SG HEALTH ALERT: Abnormal heart rate detected (${heartRate ?? '—'} bpm) for Senior ${elderName} on Garmin watch!`;
  }

  const locationText = formattedAddress || landmark || (lat && lng ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'Singapore');
  const mapsLink = lat && lng ? `\n🗺️ Google Maps: https://maps.google.com/?q=${lat},${lng}` : '';
  const trackingLink = `\n⚡ Live Tracking: ${serverBaseUrl}/track/${incidentId}`;
  const vitalsText = `\n❤️ HR: ${heartRate ? `${heartRate} bpm` : 'Active'} | 🔋 Battery: ${battery != null ? `${battery}%` : 'Normal'}`;

  return `${header}\n📍 Location: ${locationText}${mapsLink}${trackingLink}${vitalsText}`;
}

/**
 * Formats an incident cancellation / resolution SMS body.
 */
export function formatResolvedSms(params: {
  elderName: string;
  incidentId: string;
  serverBaseUrl: string;
}): string {
  const { elderName, incidentId, serverBaseUrl } = params;
  return (
    `✅ SafeSpot.SG Update: Senior ${elderName} confirmed they are OK ("I'm OK" / Cancelled SOS).\n` +
    `Status: Incident Resolved.\n` +
    `⚡ Summary: ${serverBaseUrl}/track/${incidentId}`
  );
}

/**
 * Handles creation of a live Firestore incident and dispatches SMS alerts
 * when an SOS, fall, or HR alert is received from a wearable device.
 */
export async function handleWatchAlertTrigger(params: {
  event: WearableEvent;
  landmark?: string | null;
  formattedAddress?: string | null;
  serverBaseUrl?: string;
}): Promise<IncidentDispatchResult> {
  const { event, landmark, formattedAddress } = params;
  const serverBaseUrl =
    params.serverBaseUrl ||
    process.env.APP_BASE_URL ||
    'https://safespot-sg-258662267000.asia-southeast1.run.app';

  const profile = await getDevicePairedProfile(event.deviceId);
  const now = Date.now();
  const incidentId = `inc_w_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  const incidentDoc: Incident = {
    incidentId,
    deviceId: event.deviceId,
    elderUid: profile.uid,
    elderName: profile.elderName,
    bloodType: (profile.bloodType as any) || 'Unknown',
    medicalNotes: profile.medicalNotes || '',
    incidentType: mapEventToIncidentType(event.eventType),
    currentGps:
      event.lat !== undefined && event.lng !== undefined
        ? {
            lat: event.lat,
            lng: event.lng,
            accuracy: 10,
            timestamp: event.timestamp ? event.timestamp * 1000 : now,
          }
        : null,
    locationSource: event.lat !== undefined && event.lng !== undefined ? 'watch_gps' : undefined,
    batteryLevel: event.battery ?? null,
    isCharging: null,
    nearestLandmarks: landmark ? [landmark] : [],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  if (formattedAddress) {
    incidentDoc.formattedAddress = formattedAddress;
  }

  inMemoryIncidents.set(incidentId, incidentDoc);

  const db = getFirebaseAdminDb();
  if (db) {
    try {
      await db.collection('Incidents').doc(incidentId).set(incidentDoc);
      console.log(`[WEARABLE_INCIDENT] Created Firestore incident ${incidentId} for ${event.deviceId}`);
    } catch (e: any) {
      console.warn(`[WEARABLE_INCIDENT] Failed to write Firestore Incidents/${incidentId}:`, e.message);
    }
  }

  // Dispatch emergency SMS alerts
  const smsBody = formatEmergencySms({
    elderName: profile.elderName,
    eventType: event.eventType,
    incidentId,
    serverBaseUrl,
    landmark,
    formattedAddress,
    lat: event.lat,
    lng: event.lng,
    heartRate: event.heartRate,
    battery: event.battery,
  });

  const contactsToNotify =
    profile.emergencyContacts.filter((c) => c.isPrimary && c.phone) .length > 0
      ? profile.emergencyContacts.filter((c) => c.isPrimary && c.phone)
      : profile.emergencyContacts.filter((c) => Boolean(c.phone));

  let sentCount = 0;
  for (const contact of contactsToNotify) {
    try {
      const res = await sendTwilioSms({ to: contact.phone, body: smsBody });
      if (res.success) {
        sentCount++;
        console.log(`[WEARABLE_INCIDENT] Dispatched SOS alert to ${contact.name} (${res.recipient})`);
      }
    } catch (err: any) {
      console.warn(`[WEARABLE_INCIDENT] Failed to notify ${contact.name}:`, err.message);
    }
  }

  return {
    incidentId,
    smsDispatched: sentCount > 0,
    contactsNotified: sentCount,
  };
}

/**
 * Updates an ongoing incident with fresh GPS, battery, and landmark readings.
 */
export async function handleWatchIncidentUpdate(
  incidentId: string,
  event: WearableEvent,
  landmark?: string | null,
  formattedAddress?: string | null,
): Promise<void> {
  const now = Date.now();
  const existing = inMemoryIncidents.get(incidentId);

  const updates: Partial<Incident> = {
    updatedAt: now,
  };

  if (event.lat !== undefined && event.lng !== undefined) {
    updates.currentGps = {
      lat: event.lat,
      lng: event.lng,
      accuracy: 10,
      timestamp: event.timestamp ? event.timestamp * 1000 : now,
    };
    updates.locationSource = 'watch_gps';
  }
  if (event.battery !== undefined) {
    updates.batteryLevel = event.battery;
  }
  if (landmark) {
    updates.nearestLandmarks = [landmark];
  }
  if (formattedAddress) {
    updates.formattedAddress = formattedAddress;
  }

  if (existing) {
    Object.assign(existing, updates);
  }

  const db = getFirebaseAdminDb();
  if (db) {
    try {
      await db.collection('Incidents').doc(incidentId).set(updates, { merge: true });
    } catch (e: any) {
      console.warn(`[WEARABLE_INCIDENT] Failed to update Incidents/${incidentId}:`, e.message);
    }
  }
}

/**
 * Resolves an active incident when the wearer presses "I'm OK" / cancels the alert.
 */
export async function handleWatchAlertCancel(
  incidentId: string,
  deviceId: string,
  serverBaseUrl?: string,
): Promise<void> {
  const now = Date.now();
  const baseUrl =
    serverBaseUrl ||
    process.env.APP_BASE_URL ||
    'https://safespot-sg-258662267000.asia-southeast1.run.app';

  const existing = inMemoryIncidents.get(incidentId);
  if (existing) {
    existing.status = 'resolved';
    existing.updatedAt = now;
  }

  const db = getFirebaseAdminDb();
  if (db) {
    try {
      await db.collection('Incidents').doc(incidentId).set(
        { status: 'resolved', updatedAt: now },
        { merge: true },
      );
      console.log(`[WEARABLE_INCIDENT] Resolved Firestore incident ${incidentId}`);
    } catch (e: any) {
      console.warn(`[WEARABLE_INCIDENT] Failed to mark Incidents/${incidentId} resolved:`, e.message);
    }
  }

  // Send resolution SMS
  const profile = await getDevicePairedProfile(deviceId);
  const resolvedBody = formatResolvedSms({
    elderName: profile.elderName,
    incidentId,
    serverBaseUrl: baseUrl,
  });

  const contactsToNotify =
    profile.emergencyContacts.filter((c) => c.isPrimary && c.phone).length > 0
      ? profile.emergencyContacts.filter((c) => c.isPrimary && c.phone)
      : profile.emergencyContacts.filter((c) => Boolean(c.phone));

  for (const contact of contactsToNotify) {
    try {
      await sendTwilioSms({ to: contact.phone, body: resolvedBody });
    } catch (err: any) {
      console.warn(`[WEARABLE_INCIDENT] Failed to notify ${contact.name} of cancel:`, err.message);
    }
  }
}

/**
 * Fetches an incident doc by ID (from Firestore or in-memory fallback).
 */
export async function getIncidentById(incidentId: string): Promise<Incident | null> {
  const mem = inMemoryIncidents.get(incidentId);
  if (mem) return mem;

  const db = getFirebaseAdminDb();
  if (db) {
    try {
      const snap = await db.collection('Incidents').doc(incidentId).get();
      if (snap.exists) {
        return snap.data() as Incident;
      }
    } catch (e: any) {
      console.warn(`[WEARABLE_INCIDENT] Failed to read Incidents/${incidentId}:`, e.message);
    }
  }
  return null;
}

/**
 * Looks up the latest active incident for a device from in-memory cache or Firestore.
 */
export async function getActiveIncidentForDevice(deviceId: string): Promise<Incident | null> {
  for (const inc of inMemoryIncidents.values()) {
    if (inc.status === 'active' && inc.deviceId === deviceId) {
      return inc;
    }
  }

  const db = getFirebaseAdminDb();
  if (db) {
    try {
      const snap = await db
        .collection('Incidents')
        .where('status', '==', 'active')
        .where('deviceId', '==', deviceId)
        .limit(1)
        .get();
      if (!snap.empty) {
        return snap.docs[0].data() as Incident;
      }
    } catch (e: any) {
      console.warn(`[WEARABLE_INCIDENT] Error looking up active incident for ${deviceId}:`, e.message);
    }
  }
  return null;
}
