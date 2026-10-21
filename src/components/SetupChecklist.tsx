/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { AlertTriangle, CheckCircle2, ChevronRight, Circle, ListChecks, Loader2, X } from 'lucide-react';
import type { EmergencyContact, Language, UserProfile } from '../types';
import { t } from '../locales/translations';
import { authFetch, responseError } from '../lib/authFetch';
import { saveUserProfile, upgradeGuestToGoogle } from '../lib/firebase';
import { getPersistentItem, setPersistentItem } from '../utils/storage';
import { computeSetupSteps, type SetupStepId } from '../utils/setupSteps';

const HIDDEN_KEY = 'senior_safespot_checklist_hidden';

interface SetupChecklistProps {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  contacts: EmergencyContact[];
  lang: Language;
  onOpenAuth: () => void;
  onOpenProfile: () => void;
  onOpenContacts: () => void;
  /** Linking a guest to Google keeps the same user object; the parent must re-render. */
  onAccountUpgraded: () => void;
}

/**
 * After the first-launch wizard: the steps that make an emergency alert
 * actually reach someone. Stays until every required step is done; can be
 * hidden, but a warning remains while alerts would reach nobody.
 */
export const SetupChecklist: React.FC<SetupChecklistProps> = ({
  user,
  profile,
  contacts,
  lang,
  onOpenAuth,
  onOpenProfile,
  onOpenContacts,
  onAccountUpgraded,
}) => {
  const [channels, setChannels] = useState<{ sms: boolean; telegram: boolean } | null>(null);
  const [telegramChats, setTelegramChats] = useState(0);
  const [pushDevices, setPushDevices] = useState(0);
  const [hidden, setHidden] = useState(() => {
    try {
      return getPersistentItem(HIDDEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState<SetupStepId | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const refreshChats = useCallback(async () => {
    if (!user) {
      setTelegramChats(0);
      setPushDevices(0);
      return;
    }
    try {
      const [chats, push] = await Promise.all([authFetch('/api/alerts/telegram/chats'), authFetch('/api/alerts/push/devices')]);
      if (chats.ok) {
        const d = await chats.json();
        setTelegramChats(Array.isArray(d.chats) ? d.chats.length : 0);
      }
      if (push.ok) {
        const d = await push.json();
        setPushDevices(Array.isArray(d.devices) ? d.devices.length : 0);
      }
    } catch {
      /* keep the last known count */
    }
  }, [user]);

  useEffect(() => {
    fetch('/api/alerts/channels')
      .then((r) => r.json())
      .then((d) => setChannels({ sms: Boolean(d.sms), telegram: Boolean(d.telegram) }))
      .catch(() => setChannels(null));
  }, []);

  // Re-check linked chats whenever the user comes back to the app (e.g. from Telegram).
  useEffect(() => {
    void refreshChats();
    const onFocus = () => void refreshChats();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshChats]);

  const steps = computeSetupSteps({
    signedIn: Boolean(user),
    isGuest: Boolean(user?.isAnonymous),
    contacts,
    smsActive: channels?.sms ?? false,
    telegramChats,
    pushDevices,
    watchPaired: Boolean(profile?.wearableDeviceId),
    lastTestAlertAt: profile?.lastTestAlertAt,
  });
  const required = steps.filter((s) => !s.optional);
  const doneCount = required.filter((s) => s.done).length;
  const alertsStep = steps.find((s) => s.id === 'alerts')!;

  if (required.every((s) => s.done)) return null;

  if (hidden) {
    if (alertsStep.done) return null;
    return (
      <div role="alert" className="border-brick/40 bg-brick-soft flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3">
        <p className="text-brick-deep flex items-center gap-2 text-sm font-bold sm:text-base">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t('setup.nobodyWarning', lang)}
        </p>
        <button type="button" className="btn btn-md btn-secondary" onClick={() => setHidden(false)}>
          {t('setup.fixNow', lang)}
        </button>
      </div>
    );
  }

  const hide = () => {
    setHidden(true);
    try {
      setPersistentItem(HIDDEN_KEY, '1');
    } catch {
      /* hidden for this session only */
    }
  };

  const sendTest = async () => {
    setBusy('test');
    setMessage(null);
    try {
      const res = await authFetch('/api/alerts/test', { method: 'POST', body: '{}' });
      if (!res.ok) throw new Error(await responseError(res, t('setup.testFailed', lang)));
      const d = await res.json();
      if (!d.reachedSomeone) throw new Error(t('setup.testReachedNobody', lang));
      const parts = [
        d.sms.sent ? `${d.sms.sent} SMS` : '',
        d.telegram.sent ? `${d.telegram.sent} Telegram` : '',
        d.push?.sent ? `${d.push.sent} ${t('push.notifications', lang)}` : '',
      ].filter(Boolean);
      setMessage({ kind: 'ok', text: `${t('setup.testSent', lang)} ${parts.join(' + ')}. ${t('setup.testAskFamily', lang)}` });
    } catch (e: any) {
      setMessage({ kind: 'error', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const upgrade = async () => {
    setBusy('account');
    setMessage(null);
    try {
      const upgraded = await upgradeGuestToGoogle();
      await saveUserProfile({ uid: upgraded.uid, authProvider: 'google', email: upgraded.email || undefined }).catch(() => {});
      onAccountUpgraded();
    } catch (e: any) {
      if (e?.code !== 'auth/popup-closed-by-user') setMessage({ kind: 'error', text: e.message || t('setup.signInFailed', lang) });
    } finally {
      setBusy(null);
    }
  };

  const actionFor = (id: SetupStepId): (() => void) => {
    switch (id) {
      case 'contacts':
        return onOpenContacts;
      case 'account':
        return user?.isAnonymous ? upgrade : onOpenAuth;
      case 'alerts':
      case 'watch':
        return user ? onOpenProfile : onOpenAuth;
      case 'test':
        return sendTest;
    }
  };

  return (
    <section id="card-setup-checklist" className="card p-5 sm:p-6" aria-labelledby="setup-checklist-title">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="icon-tile" aria-hidden="true">
            <ListChecks className="h-5 w-5" />
          </div>
          <div>
            <h2 id="setup-checklist-title" className="text-lg font-extrabold sm:text-xl">
              {t('setup.title', lang)}
            </h2>
            <p className="text-ink-soft text-sm font-semibold">
              {doneCount} / {required.length} {t('setup.done', lang)}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={hide}
          className="btn accessible-tap text-ink-soft hover:bg-well hover:text-ink -mt-1 -mr-2 shrink-0"
          aria-label={t('setup.hide', lang)}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div
        className="bg-well mb-4 h-2 overflow-hidden rounded-full"
        role="progressbar"
        aria-labelledby="setup-checklist-title"
        aria-valuemin={0}
        aria-valuemax={required.length}
        aria-valuenow={doneCount}
      >
        <div className="bg-pine h-full rounded-full transition-all duration-300" style={{ width: `${(doneCount / required.length) * 100}%` }} />
      </div>

      <ol className="space-y-2">
        {steps.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={actionFor(s.id)}
              disabled={s.done || s.blocked || busy !== null}
              aria-busy={busy === s.id || undefined}
              className={`flex min-h-14 w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pine disabled:cursor-default ${
                s.done
                  ? 'border-pine/30 bg-pine-soft/50'
                  : s.blocked
                  ? 'border-line border-dashed bg-well/40'
                  : 'border-line bg-surface enabled:hover:bg-well'
              }`}
            >
              {s.done ? (
                <CheckCircle2 className="text-pine h-6 w-6 shrink-0" aria-hidden="true" />
              ) : busy === s.id ? (
                <Loader2 className="text-pine h-6 w-6 shrink-0 animate-spin" aria-hidden="true" />
              ) : (
                <Circle className="text-ink-faint h-6 w-6 shrink-0" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-bold sm:text-lg">
                  {t(`setup.${s.id}.title`, lang)}
                  {s.optional && <span className="text-ink-soft ml-2 text-sm font-semibold">({t('setup.optional', lang)})</span>}
                </span>
                <span className="text-ink-soft block text-sm">
                  {t(s.done ? `setup.${s.id}.done` : s.hintKey, lang)}
                </span>
              </span>
              {!s.done && !s.blocked && <ChevronRight className="text-ink-soft h-5 w-5 shrink-0" aria-hidden="true" />}
            </button>
          </li>
        ))}
      </ol>

      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`mt-3 text-sm font-bold ${message.kind === 'error' ? 'text-brick-deep' : 'text-pine-deep'}`}
        >
          {message.text}
        </p>
      )}
    </section>
  );
};
