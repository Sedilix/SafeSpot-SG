/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Bell, CheckCircle2, Loader2, Share, ShieldAlert, SquarePlus } from 'lucide-react';
import type { Language } from '../types';
import { t } from '../locales/translations';
import { deviceLabel, pushSupport, subscribeThisDevice } from '../lib/push';
import { isNativeApp } from '../lib/native';

/** Family members open this from an invite link; no account needed. */
function browserLanguage(): Language {
  const l = (navigator.language || 'en').toLowerCase();
  if (l.startsWith('zh')) return 'zh';
  if (l.startsWith('ms')) return 'ms';
  if (l.startsWith('ta')) return 'ta';
  return 'en';
}

export const AlertJoinPage: React.FC<{ code: string }> = ({ code }) => {
  const lang = browserLanguage();
  const [invite, setInvite] = useState<{ name: string; vapidPublicKey: string | null; fcm?: boolean } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'busy' | 'done'>('loading');
  const [error, setError] = useState<string | null>(null);
  const support = pushSupport();

  useEffect(() => {
    fetch(`/api/alerts/push/invite/${encodeURIComponent(code)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        setInvite(await r.json());
        setState('ready');
      })
      .catch(() => setState('invalid'));
  }, [code]);

  // On iPhone the home-screen app must reopen this invite, not the start page.
  useEffect(() => {
    if (support !== 'needs-install') return;
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (link) link.href = `/manifest-join/${encodeURIComponent(code)}.webmanifest`;
  }, [code, support]);

  // Without the server's push key (or FCM, in the app) the button could never
  // work, so say so instead of showing a button that silently does nothing.
  const pushConfigured = isNativeApp() ? Boolean(invite?.fcm) : Boolean(invite?.vapidPublicKey);

  const join = async () => {
    if (!invite || !pushConfigured) return;
    setState('busy');
    setError(null);
    try {
      const registration = await subscribeThisDevice(invite.vapidPublicKey);
      const res = await fetch('/api/alerts/push/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, ...registration, label: deviceLabel() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || t('push.failed', lang));
      }
      setState('done');
    } catch (e: any) {
      setError(e.message || t('push.failed', lang));
      setState('ready');
    }
  };

  const name = invite?.name || '';

  return (
    <main className="bg-bg text-ink flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="card w-full max-w-md space-y-5 p-6 text-center" aria-live="polite">
        {state === 'done' ? (
          <CheckCircle2 className="text-pine mx-auto h-12 w-12" aria-hidden="true" />
        ) : (
          <div className="icon-tile mx-auto">
            <Bell className="h-6 w-6" aria-hidden="true" />
          </div>
        )}

        {state === 'loading' && (
          <div role="status" className="text-ink-soft flex items-center justify-center gap-2 font-semibold">
            <Loader2 className="text-pine h-6 w-6 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
            <span>{t('join.loading', lang)}</span>
          </div>
        )}

        {state === 'invalid' && (
          <>
            <h1 className="text-xl font-extrabold">{t('join.invalidTitle', lang)}</h1>
            <p className="text-ink-soft">{t('join.invalidBody', lang)}</p>
          </>
        )}

        {state === 'done' && (
          <>
            <h1 className="text-xl font-extrabold">{t('join.doneTitle', lang)}</h1>
            <p className="text-ink-soft">{t('join.doneBody', lang).replace('{name}', name)}</p>
          </>
        )}

        {(state === 'ready' || state === 'busy') && (
          <>
            <h1 className="text-xl font-extrabold">{t('join.title', lang).replace('{name}', name)}</h1>
            <p className="text-ink-soft">{t('join.body', lang).replace('{name}', name)}</p>

            {support === 'supported' && pushConfigured && (
              <button
                type="button"
                onClick={join}
                disabled={state === 'busy'}
                aria-busy={state === 'busy'}
                className="btn btn-lg btn-primary w-full"
              >
                {state === 'busy' ? (
                  <Loader2 className="h-6 w-6 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
                ) : (
                  <Bell className="h-6 w-6 shrink-0" aria-hidden="true" />
                )}
                <span>{t('join.button', lang)}</span>
              </button>
            )}

            {support === 'supported' && !pushConfigured && (
              <p className="text-brick-deep flex items-start gap-2 text-left text-sm font-bold">
                <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span>{t('join.notConfigured', lang)}</span>
              </p>
            )}

            {support === 'needs-install' && (
              <ol className="bg-well space-y-3 rounded-xl p-4 text-left text-base">
                <li className="flex items-start gap-3">
                  <Share className="text-sky mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                  <span>{t('join.ios1', lang)}</span>
                </li>
                <li className="flex items-start gap-3">
                  <SquarePlus className="text-sky mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                  <span>{t('join.ios2', lang)}</span>
                </li>
                <li className="flex items-start gap-3">
                  <Bell className="text-sky mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                  <span>{t('join.ios3', lang)}</span>
                </li>
              </ol>
            )}

            {support === 'unsupported' && (
              <p className="text-brick-deep flex items-start gap-2 text-left text-sm font-bold">
                <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span>{t('join.unsupported', lang)}</span>
              </p>
            )}

            {error && (
              <p role="alert" className="text-brick-deep text-sm font-bold">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
};
