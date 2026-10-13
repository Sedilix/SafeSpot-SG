/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { computeSetupSteps, type SetupState } from './setupSteps';
import { EMERGENCY_995_CONTACT } from '../data/defaultContacts';
import type { EmergencyContact } from '../types';

const mei: EmergencyContact = {
  id: 'mei', name: 'Mei', relationship: 'Daughter', phone: '9123 4567', emoji: '👩', bgColor: '', isPrimary: true,
};

const base: SetupState = {
  signedIn: false,
  isGuest: false,
  contacts: [EMERGENCY_995_CONTACT],
  smsActive: true,
  telegramChats: 0,
  watchPaired: false,
};

const byId = (s: SetupState) => Object.fromEntries(computeSetupSteps(s).map((x) => [x.id, x]));

describe('computeSetupSteps', () => {
  it('a fresh install has nothing done; 995 alone is not a family contact', () => {
    const s = byId(base);
    expect(s.contacts.done).toBe(false);
    expect(s.account.done).toBe(false);
    expect(s.alerts.done).toBe(false);
    expect(s.test.blocked).toBe(true);
    expect(s.alerts.hintKey).toBe('setup.alerts.hintSignIn');
  });

  it('guests are signed in but asked to keep their setup', () => {
    const s = byId({ ...base, signedIn: true, isGuest: true, contacts: [EMERGENCY_995_CONTACT, mei] });
    expect(s.account.done).toBe(false);
    expect(s.account.hintKey).toBe('setup.account.hintGuest');
    expect(s.alerts.done).toBe(true); // SMS works for guests too
  });

  it('without SMS, alerts only count once a Telegram chat is linked', () => {
    const noSms = { ...base, signedIn: true, smsActive: false, contacts: [EMERGENCY_995_CONTACT, mei] };
    expect(byId(noSms).alerts.done).toBe(false);
    expect(byId(noSms).alerts.hintKey).toBe('setup.alerts.hintTelegram');
    expect(byId({ ...noSms, telegramChats: 1 }).alerts.done).toBe(true);
  });

  it('a phone getting notifications also counts as a working channel', () => {
    const noSms = { ...base, signedIn: true, smsActive: false };
    expect(byId({ ...noSms, pushDevices: 1 }).alerts.done).toBe(true);
  });

  it('SMS needs the contacts on the account (signed in)', () => {
    expect(byId({ ...base, contacts: [mei] }).alerts.done).toBe(false);
    expect(byId({ ...base, signedIn: true, contacts: [mei] }).alerts.done).toBe(true);
  });

  it('the watch is optional and the test unlocks once alerts work', () => {
    const s = byId({ ...base, signedIn: true, contacts: [mei], lastTestAlertAt: 1 });
    expect(s.watch.optional).toBe(true);
    expect(s.test.blocked).toBe(false);
    expect(s.test.done).toBe(true);
  });
});
