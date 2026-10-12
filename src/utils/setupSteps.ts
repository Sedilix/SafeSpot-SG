/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EmergencyContact } from '../types';
import { smsAlertRecipients } from './notifications';

export type SetupStepId = 'contacts' | 'account' | 'alerts' | 'watch' | 'test';

export interface SetupStep {
  id: SetupStepId;
  done: boolean;
  optional?: boolean;
  /** Can't be started until an earlier step is done. */
  blocked?: boolean;
  /** Translation key explaining what to do next. */
  hintKey: string;
}

export interface SetupState {
  signedIn: boolean;
  isGuest: boolean;
  contacts: EmergencyContact[];
  smsActive: boolean;
  telegramChats: number;
  watchPaired: boolean;
  lastTestAlertAt?: number;
}

/**
 * The setup checklist, in order. "Alerts reach someone" means at least one
 * channel would deliver a real alert right now: a linked Telegram chat, or
 * working SMS plus a family mobile number saved to the account (the server
 * reads contacts from the account, so a signed-out phone can't count).
 */
export function computeSetupSteps(s: SetupState): SetupStep[] {
  const hasFamilyMobile = smsAlertRecipients(s.contacts).length > 0;
  const accountDone = s.signedIn && !s.isGuest;
  const alertsDone = s.telegramChats > 0 || (s.smsActive && hasFamilyMobile && s.signedIn);

  return [
    { id: 'contacts', done: hasFamilyMobile, hintKey: 'setup.contacts.hint' },
    {
      id: 'account',
      done: accountDone,
      hintKey: s.signedIn ? 'setup.account.hintGuest' : 'setup.account.hintSignIn',
    },
    {
      id: 'alerts',
      done: alertsDone,
      hintKey: !s.signedIn
        ? 'setup.alerts.hintSignIn'
        : !s.smsActive
          ? 'setup.alerts.hintTelegram'
          : 'setup.alerts.hintContacts',
    },
    { id: 'watch', done: s.watchPaired, optional: true, hintKey: 'setup.watch.hint' },
    {
      id: 'test',
      done: Boolean(s.lastTestAlertAt),
      blocked: !alertsDone,
      hintKey: alertsDone ? 'setup.test.hint' : 'setup.test.hintBlocked',
    },
  ];
}
