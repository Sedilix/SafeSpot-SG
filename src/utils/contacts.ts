/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { EmergencyContact, LocationVerificationResult } from '../types';
import { publicBaseUrl } from '../lib/native';

/**
 * Import emergency contacts straight from the phone's address book via the
 * Contact Picker API, so a senior never has to type a phone number.
 */

interface ContactsManagerLike {
  select: (
    properties: string[],
    options?: { multiple?: boolean }
  ) => Promise<Array<{ name?: string[]; tel?: string[]; email?: string[] }>>;
  getProperties?: () => Promise<string[]>;
}

function getContactsManager(): ContactsManagerLike | null {
  if (typeof navigator === 'undefined') return null;
  const manager = (navigator as any).contacts;
  if (!manager || typeof manager.select !== 'function') return null;
  return manager as ContactsManagerLike;
}

export function isContactPickerSupported(): boolean {
  if (typeof window !== 'undefined' && !window.isSecureContext) return false;
  return getContactsManager() !== null;
}

/** Rotating palette so imported contacts are visually distinguishable. */
const CONTACT_COLORS = [
  'bg-pine hover:bg-pine-deep text-on-pine',
  'bg-sky hover:bg-sky-deep text-white',
  'bg-ochre hover:bg-ochre-deep text-white',
  'bg-brick hover:bg-brick-deep text-on-brick',
];

const CONTACT_EMOJI = ['👤', '👨', '👩', '🧑'];

/** Keep only digits and a leading +, the shape a tel: link needs. */
export function normalisePhone(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return plus + trimmed.replace(/[^\d]/g, '');
}

/**
 * Two numbers are the same contact if their digits match once formatting is
 * stripped, so "+65 9123 4567" does not get added twice as "91234567".
 */
export function isSamePhone(a: string, b: string): boolean {
  const digits = (v: string) => v.replace(/[^\d]/g, '');
  const da = digits(a);
  const db = digits(b);
  if (!da || !db) return false;
  // Compare the last 8 digits: Singapore local numbers with and without +65.
  return da.slice(-8) === db.slice(-8);
}

export interface ContactImportResult {
  imported: EmergencyContact[];
  /** Contacts skipped because they were already in the list. */
  duplicates: number;
  error?: string;
}

/**
 * Open the system contact picker. Must be called from a user gesture.
 */
export async function importContactsFromPhone(
  existing: EmergencyContact[]
): Promise<ContactImportResult> {
  const manager = getContactsManager();
  if (!manager) {
    return { imported: [], duplicates: 0, error: 'This browser cannot open the phone contact book.' };
  }

  try {
    const selected = await manager.select(['name', 'tel'], { multiple: true });

    const imported: EmergencyContact[] = [];
    let duplicates = 0;

    selected.forEach((entry, index) => {
      const name = entry.name?.[0]?.trim();
      const phone = entry.tel?.[0] ? normalisePhone(entry.tel[0]) : '';
      if (!name || !phone) return;

      const alreadyKnown =
        existing.some((c) => isSamePhone(c.phone, phone)) ||
        imported.some((c) => isSamePhone(c.phone, phone));

      if (alreadyKnown) {
        duplicates += 1;
        return;
      }

      imported.push({
        id: `contact-${Date.now()}-${index}`,
        name,
        relationship: 'Family / Friend',
        phone,
        emoji: CONTACT_EMOJI[(existing.length + index) % CONTACT_EMOJI.length],
        bgColor: CONTACT_COLORS[(existing.length + index) % CONTACT_COLORS.length],
        isPrimary: existing.length === 0 && index === 0,
      });
    });

    return { imported, duplicates };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { imported: [], duplicates: 0 };
    }
    return {
      imported: [],
      duplicates: 0,
      error: err?.message || 'Could not read contacts from this device.',
    };
  }
}

/** Build a contact from hand-typed details, for browsers without the picker. */
export function createManualContact(
  name: string,
  phone: string,
  existingCount: number,
  relationship = 'Family / Friend',
  isPrimary = false
): EmergencyContact {
  return {
    id: `contact-${Date.now()}`,
    name: name.trim(),
    relationship,
    phone: normalisePhone(phone),
    emoji: CONTACT_EMOJI[existingCount % CONTACT_EMOJI.length],
    bgColor: CONTACT_COLORS[existingCount % CONTACT_COLORS.length],
    isPrimary: isPrimary || existingCount === 0,
  };
}

/**
 * Returns the preferred contact designated by the user during onboarding or in settings.
 * Skips locked emergency services like 995.
 */
export function getPreferredContact(contacts: EmergencyContact[]): EmergencyContact | undefined {
  if (!contacts || contacts.length === 0) return undefined;
  const primary = contacts.find((c) => c.isPrimary && !c.locked);
  if (primary) return primary;
  return contacts.find((c) => !c.locked);
}

/**
 * Sets a specific contact as the preferred pickup recipient and unsets all others.
 */
export function setPreferredContact(contacts: EmergencyContact[], targetId: string): EmergencyContact[] {
  return contacts.map((c) => ({
    ...c,
    isPrimary: c.id === targetId,
  }));
}

/**
 * Prepares the formatted text message and deep links (WhatsApp / SMS / Call)
 * for sharing live pickup coordinates with the preferred contact.
 */
export function buildPickupSharePayload(
  verification: LocationVerificationResult,
  contact: EmergencyContact,
  incidentId?: string
): {
  messageText: string;
  whatsappUrl: string;
  smsUrl: string;
  telUrl: string;
  googleMapsUrl: string;
} {
  const address = verification.formattedAddress || 'My Current Location';
  const driverHint = verification.pickupInstructionsForDriver || 'Please pull up to the exact pin location.';
  const googleMapsUrl =
    verification.shareUrls?.googleMapsUrl ||
    `https://www.google.com/maps/search/?api=1&query=${verification.verifiedCoordinates.lat},${verification.verifiedCoordinates.lng}`;

  const liveTrackPart = incidentId
    ? `\n⚡ Live Tracking: ${publicBaseUrl()}/track/${incidentId}`
    : '';

  const bleBadge = verification.bleAccuracyBoost && verification.bleBeacons?.[0]
    ? `\n📶 BLE Precision: ${verification.bleBeacons[0].locationName} (≈${verification.bleBeacons[0].estimatedDistanceMeters}m)`
    : '';

  const messageText = `Hi ${contact.name}! I need a pickup here:\n📍 SafeSpot: ${address}${bleBadge}\n🚗 Driver Note: ${driverHint}\n🗺️ Google Maps: ${googleMapsUrl}${liveTrackPart}`;

  const cleanPhone = contact.phone.replace(/[^0-9+]/g, '');
  const digitsOnly = contact.phone.replace(/[^0-9]/g, '');

  const encoded = encodeURIComponent(messageText);

  return {
    messageText,
    whatsappUrl: `https://wa.me/${digitsOnly}?text=${encoded}`,
    smsUrl: `sms:${cleanPhone}?body=${encoded}`,
    telUrl: `tel:${cleanPhone}`,
    googleMapsUrl,
  };
}
