/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import admin from 'firebase-admin';
import type { Incident, EmergencyContact, SourceFix } from '../types';
import { fuseIncidentFixes, reportedAccuracy } from './locationFusion';
import { sendSms, smsAlertRecipients } from './notifications';
import { notifyPushDevices, notifyTelegramAlert, resolveTelegramIncident, updateTelegramIncidentLocation } from './alertChannels';
import { formatTelegramAlert, formatTelegramResolved } from './telegram';
import { WearableEvent, describePositionAge } from './wearable';

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
  telegramChatsNotified: number;
  pushDevicesNotified: number;
  /** True when we stopped waiting (waitForDeliveryMs) before every channel finished; they keep going. */
  deliveryPending?: boolean;
}

/** Waits for `task` at most `ms` (if given); null means it's still running. */
function within<T>(task: Promise<T>, ms?: number): Promise<T | null> {
  if (ms === undefined) return task;
  return Promise.race([task, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

let adminDb: admin.firestore.Firestore | null = null;
const inMemoryIncidents = new Map<string, Incident>();

/** The watch's fix as reported: its own accuracy (or null), timed when it was taken, not sent. */
export function watchFixFromEvent(event: WearableEvent, now: number): SourceFix | null {
  if (event.lat === undefined || event.lng === undefined) return null;
  return {
    lat: event.lat,
    lng: event.lng,
    accuracy: reportedAccuracy(event.accuracy),
    timestamp: (event.timestamp ? event.timestamp * 1000 : now) - (event.positionAge ?? 0) * 1000,
    source: 'watch_gps',
  };
}
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
/** Appends "(last known location, N min ago)" when the position isn't current. */
function withAge(text: string | null, positionAge?: number): string | null {
  const age = describePositionAge(positionAge);
  return text && age ? `${text} (${age})` : text;
}

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
  positionAge?: number;
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

  const locationText =
    withAge(formattedAddress || landmark || (lat && lng ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : null), params.positionAge) ||
    'Location unknown (no GPS fix)';
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
  /**
   * Return after this long even if some channels are still sending (an SMS
   * through the textbee phone can take ~20 s to confirm). The watch times out
   * after 30 s and retries, so the server must answer it quickly.
   */
  waitForDeliveryMs?: number;
}): Promise<IncidentDispatchResult> {
  const { event, landmark, formattedAddress } = params;
  const serverBaseUrl =
    params.serverBaseUrl ||
    process.env.APP_BASE_URL ||
    'https://safespot-sg-258662267000.asia-southeast1.run.app';

  const profile = await getDevicePairedProfile(event.deviceId);
  const now = Date.now();
  const watchFix = watchFixFromEvent(event, now);
  const incidentId = `inc_w_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  const incidentDoc: Incident = {
    incidentId,
    deviceId: event.deviceId,
    elderUid: profile.uid,
    elderName: profile.elderName,
    bloodType: (profile.bloodType as any) || 'Unknown',
    medicalNotes: profile.medicalNotes || '',
    incidentType: mapEventToIncidentType(event.eventType),
    currentGps: null,
    watchFix,
    phoneFix: null,
    ...fuseIncidentFixes(watchFix, null, now),
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
    positionAge: event.positionAge,
  });

  const contactsToNotify = smsAlertRecipients(profile.emergencyContacts);

  // Every channel is sent at once, so one slow or failing channel never
  // delays or blocks the others.
  const smsTask = Promise.all(
    contactsToNotify.map(async (contact) => {
      try {
        const res = await sendSms({ to: contact.phone, body: smsBody });
        if (res.success) {
          console.log(`[WEARABLE_INCIDENT] Dispatched SOS alert to ${contact.name}`);
          return 1;
        }
        console.warn(`[WEARABLE_INCIDENT] SMS to ${contact.name} not sent: ${res.carrierStatus}`);
      } catch (err: any) {
        console.warn(`[WEARABLE_INCIDENT] Failed to notify ${contact.name}:`, err.message);
      }
      return 0;
    }),
  ).then((r) => r.reduce((a: number, b) => a + b, 0));

  const telegramTask = notifyTelegramAlert({
    uid: profile.uid,
    elderName: profile.elderName,
    incidentId,
    text: formatTelegramAlert({
      elderName: profile.elderName,
      eventType: event.eventType,
      incidentId,
      serverBaseUrl,
      locationText: withAge(formattedAddress || (landmark ? `Near ${landmark}` : null), event.positionAge),
      lat: event.lat,
      lng: event.lng,
      heartRate: event.heartRate,
      battery: event.battery,
      bloodType: profile.bloodType,
      medicalNotes: profile.medicalNotes,
    }),
    lat: event.lat,
    lng: event.lng,
    now,
  }).catch((err: any) => {
    console.warn('[WEARABLE_INCIDENT] Telegram alert failed:', err.message);
    return 0;
  });

  const what =
    event.eventType === 'FALL_DETECTED' ? 'Fall detected' : event.eventType === 'HR_ALERT' ? 'Heart rate alert' : 'SOS';
  const pushTask = notifyPushDevices(profile.uid, {
    title: `🚨 ${what}: ${profile.elderName}`,
    body: `${withAge(formattedAddress || (landmark ? `Near ${landmark}` : null), event.positionAge) || 'Location on the tracking page'}. Tap to see where they are.`,
    url: `/track/${incidentId}`,
    tag: incidentId,
    urgent: true,
  }).catch((err: any) => {
    console.warn('[WEARABLE_INCIDENT] Push alert failed:', err.message);
    return 0;
  });

  const delivery = Promise.all([smsTask, telegramTask, pushTask]).then(([sms, telegram, push]) => {
    console.log(`[WEARABLE_INCIDENT] ${incidentId} delivered: SMS ${sms}, Telegram ${telegram}, phones ${push}`);
    if (sms + telegram + push === 0) {
      console.error(`[WEARABLE_INCIDENT] ALERT ${incidentId} REACHED NOBODY: no SMS sent, no Telegram chat or phone linked.`);
    }
    return { sms, telegram, push };
  });

  const done = await within(delivery, params.waitForDeliveryMs);
  if (!done) {
    return { incidentId, smsDispatched: false, contactsNotified: 0, telegramChatsNotified: 0, pushDevicesNotified: 0, deliveryPending: true };
  }
  return {
    incidentId,
    smsDispatched: done.sms > 0,
    contactsNotified: done.sms,
    telegramChatsNotified: done.telegram,
    pushDevicesNotified: done.push,
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

  const watchFix = watchFixFromEvent(event, now);
  if (event.battery !== undefined) {
    updates.batteryLevel = event.battery;
  }
  if (landmark) {
    updates.nearestLandmarks = [landmark];
  }
  if (formattedAddress) {
    updates.formattedAddress = formattedAddress;
  }

  // The phone writes its own fix to the same doc; fuse with its latest one so a
  // watch tick never overwrites a better phone fix (and vice versa on the phone).
  const withLocation = (phoneFix: SourceFix | null | undefined): Partial<Incident> =>
    watchFix ? { ...updates, watchFix, ...fuseIncidentFixes(watchFix, phoneFix, now) } : updates;

  const db = getFirebaseAdminDb();
  if (db) {
    try {
      const ref = db.collection('Incidents').doc(incidentId);
      const written = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = withLocation(snap.exists ? (snap.data() as Incident).phoneFix : existing?.phoneFix);
        tx.set(ref, data, { merge: true });
        return data;
      });
      if (existing) Object.assign(existing, written);
    } catch (e: any) {
      console.warn(`[WEARABLE_INCIDENT] Failed to update Incidents/${incidentId}:`, e.message);
      if (existing) Object.assign(existing, withLocation(existing.phoneFix));
    }
  } else if (existing) {
    Object.assign(existing, withLocation(existing.phoneFix));
  }

  if (event.lat !== undefined && event.lng !== undefined) {
    await updateTelegramIncidentLocation(incidentId, event.lat, event.lng, now).catch((e: any) =>
      console.warn('[WEARABLE_INCIDENT] Telegram live location update failed:', e.message),
    );
  }
}

/**
 * Resolves an active incident when the wearer presses "I'm OK" / cancels the alert.
 */
export async function handleWatchAlertCancel(
  incidentId: string,
  deviceId: string,
  serverBaseUrl?: string,
  opts: { waitForDeliveryMs?: number } = {},
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

  const contactsToNotify = smsAlertRecipients(profile.emergencyContacts);

  const delivery = Promise.all([
    ...contactsToNotify.map(async (contact) => {
      try {
        await sendSms({ to: contact.phone, body: resolvedBody });
      } catch (err: any) {
        console.warn(`[WEARABLE_INCIDENT] Failed to notify ${contact.name} of cancel:`, err.message);
      }
    }),
    notifyPushDevices(profile.uid, {
      title: `✅ ${profile.elderName} is OK`,
      body: 'They cancelled the alert on their watch.',
      url: `/track/${incidentId}`,
      tag: incidentId,
    }).catch(() => 0),
    resolveTelegramIncident(incidentId, formatTelegramResolved(profile.elderName)).catch((e: any) =>
      console.warn('[WEARABLE_INCIDENT] Telegram resolve failed:', e.message),
    ),
  ]);
  await within(delivery, opts.waitForDeliveryMs);
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
