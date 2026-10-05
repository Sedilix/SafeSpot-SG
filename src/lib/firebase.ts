/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithPhoneNumber, 
  RecaptchaVerifier, 
  signInAnonymously, 
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User as FirebaseUser,
  ConfirmationResult
} from 'firebase/auth';
import { 
  getFirestore, 
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  onSnapshot,
  serverTimestamp,
  deleteField 
} from 'firebase/firestore';
import { UserProfile, EmergencyContact, Incident } from '../types';

// SafeSpot's own Firebase project (safespot-sg). Web config values are
// public identifiers, not secrets; the fallbacks keep local builds working
// when VITE_FIREBASE_* is unset.
export const firebaseConfig = {
  apiKey: (import.meta as any).env?.VITE_FIREBASE_API_KEY || 'AIzaSyBYYL46PgVVGpLagBFdMrEubpQG8dJ0dXQ',
  authDomain: (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN || 'safespot-sg.firebaseapp.com',
  projectId: (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID || 'safespot-sg',
  storageBucket: (import.meta as any).env?.VITE_FIREBASE_STORAGE_BUCKET || 'safespot-sg.firebasestorage.app',
  messagingSenderId: (import.meta as any).env?.VITE_FIREBASE_MESSAGING_SENDER_ID || '606598293391',
  appId: (import.meta as any).env?.VITE_FIREBASE_APP_ID || '1:606598293391:web:fdfac16e0d56048ba18dfa',
};

// Initialize Firebase App singleton safely
function initFirebaseApp() {
  if (getApps().length > 0) return getApp();
  try {
    return initializeApp(firebaseConfig);
  } catch (err) {
    console.error('Failed to initialize Firebase with environment config, using fallback:', err);
    return initializeApp({
      apiKey: 'AIzaSyBYYL46PgVVGpLagBFdMrEubpQG8dJ0dXQ',
      authDomain: 'safespot-sg.firebaseapp.com',
      projectId: 'safespot-sg',
      storageBucket: 'safespot-sg.firebasestorage.app',
      messagingSenderId: '606598293391',
      appId: '1:606598293391:web:fdfac16e0d56048ba18dfa',
    });
  }
}

export const app = initFirebaseApp();
export const auth = getAuth(app);

/**
 * Firestore with offline IndexedDB persistent cache so the elder's medical
 * profile, emergency contacts, and active incidents stay fully usable in
 * underground MRT stations or HDB void decks with poor reception.
 * Falls back to the default in-memory instance if the cache cannot init
 * (e.g. another tab already claimed single-tab cache in an older session).
 */
// Optional profile/incident fields are often undefined (e.g. a Google account
// has no phone number). Firestore rejects undefined values unless told to skip
// them, which made the first profile save fail. Note: skipped means *not
// written*, so clearing a field needs deleteField() (see clearWearableDeviceId).
function createFirestore() {
  try {
    return initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch (err) {
    console.warn('Persistent Firestore cache unavailable, using default:', err);
    try {
      return initializeFirestore(app, { ignoreUndefinedProperties: true });
    } catch {
      return getFirestore(app);
    }
  }
}

export const db = createFirestore();
export const googleProvider = new GoogleAuthProvider();

// Google Sign-In
export async function signInWithGoogle(): Promise<FirebaseUser> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

// Anonymous Sign-In
export async function signInAsGuest(): Promise<FirebaseUser> {
  const result = await signInAnonymously(auth);
  return result.user;
}

// Setup Phone reCAPTCHA
export function setupRecaptcha(containerId: string): RecaptchaVerifier {
  // Clear existing if any
  if ((window as any).recaptchaVerifier) {
    try {
      (window as any).recaptchaVerifier.clear();
    } catch (e) {}
  }
  
  const verifier = new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
    callback: () => {
      // reCAPTCHA solved
    },
    'expired-callback': () => {
      console.warn('reCAPTCHA expired, please try again.');
    },
  });

  (window as any).recaptchaVerifier = verifier;
  return verifier;
}

// Send Phone OTP
export async function sendPhoneOtp(
  phoneNumber: string, 
  verifier: RecaptchaVerifier
): Promise<ConfirmationResult> {
  // Format international number (e.g., +65 for Singapore)
  const cleanNumber = phoneNumber.trim().startsWith('+') 
    ? phoneNumber.trim() 
    : `+65${phoneNumber.trim().replace(/^0+/, '')}`;

  const confirmation = await signInWithPhoneNumber(auth, cleanNumber, verifier);
  return confirmation;
}

// Sign Out
export async function signOutUser(): Promise<void> {
  await firebaseSignOut(auth);
}

// Collection reference: Users
const USERS_COLLECTION = 'Users';

/**
 * Fetch a User profile by UID from Firestore collection `Users/{uid}`
 */
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  try {
    const userDocRef = doc(db, USERS_COLLECTION, uid);
    const snap = await getDoc(userDocRef);
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }
    return null;
  } catch (error) {
    console.error('Error fetching user profile from Firestore:', error);
    return null;
  }
}

/**
 * Save or update User profile in Firestore collection `Users/{uid}`
 */
/** Removes the paired watch ID from a profile (undefined would just be skipped). */
export async function clearWearableDeviceId(uid: string): Promise<void> {
  await updateDoc(doc(db, USERS_COLLECTION, uid), {
    wearableDeviceId: deleteField(),
    updatedAt: Date.now(),
  });
}

export async function saveUserProfile(profile: Partial<UserProfile> & { uid: string }): Promise<void> {
  try {
    const userDocRef = doc(db, USERS_COLLECTION, profile.uid);
    const existing = await getDoc(userDocRef);

    const now = Date.now();
    const payload: Record<string, any> = {
      ...profile,
      updatedAt: now,
    };

    if (!existing.exists()) {
      payload.createdAt = now;
    }

    await setDoc(userDocRef, payload, { merge: true });
  } catch (error) {
    console.error('Error saving user profile to Firestore:', error);
    throw error;
  }
}

/**
 * Listen to real-time updates for a user's profile
 */
export function subscribeToUserProfile(
  uid: string, 
  callback: (profile: UserProfile | null) => void
): () => void {
  const userDocRef = doc(db, USERS_COLLECTION, uid);
  return onSnapshot(userDocRef, (snap) => {
    if (snap.exists()) {
      callback(snap.data() as UserProfile);
    } else {
      callback(null);
    }
  }, (err) => {
    console.warn('Firestore profile subscription error:', err);
    callback(null);
  });
}

// Collection reference: Incidents (live caregiver tracking)
const INCIDENTS_COLLECTION = 'Incidents';

/**
 * Create a new live incident doc at `Incidents/{incidentId}` and return its ID.
 * The elder's device then streams live GPS + battery into this doc so family
 * can follow `/track/:incidentId` without installing an app.
 */
export async function createIncident(incident: Omit<Incident, 'incidentId'>): Promise<string> {
  const incidentDocRef = doc(collection(db, INCIDENTS_COLLECTION));
  const incidentId = incidentDocRef.id;
  const payload: Incident = { ...incident, incidentId };
  await setDoc(incidentDocRef, payload);
  return incidentId;
}

/**
 * Merge-update an existing incident (live GPS ticks, battery, status changes).
 */
export async function updateIncident(
  incidentId: string, 
  updates: Partial<Incident>
): Promise<void> {
  try {
    const incidentDocRef = doc(db, INCIDENTS_COLLECTION, incidentId);
    await updateDoc(incidentDocRef, { ...updates, updatedAt: Date.now() });
  } catch (error) {
    console.warn('Error updating incident (may be offline, will retry):', error);
  }
}

/**
 * Real-time subscription used by the `/track/:incidentId` caregiver dashboard.
 */
export function subscribeToIncident(
  incidentId: string, 
  callback: (incident: Incident | null) => void
): () => void {
  const incidentDocRef = doc(db, INCIDENTS_COLLECTION, incidentId);
  return onSnapshot(incidentDocRef, (snap) => {
    if (snap.exists()) {
      callback(snap.data() as Incident);
    } else {
      callback(null);
    }
  }, (err) => {
    console.warn('Firestore incident subscription error:', err);
    callback(null);
  });
}
