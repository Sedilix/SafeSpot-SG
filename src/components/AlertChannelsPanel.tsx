/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { AlertTriangle, ExternalLink, Loader2, Plus, Send, Unlink, Users } from 'lucide-react';
import type { Language } from '../types';
import { t } from '../locales/translations';
import { authFetch, responseError } from '../lib/authFetch';

interface LinkedChat {
  chatId: string;
  title: string;
  type: string;
}

interface PendingLink {
  code: string;
  expiresAt: number;
  botUsername: string;
  groupUrl: string;
  privateUrl: string;
}

/**
 * Where emergency alerts go besides SMS. Lets the account link Telegram
 * chats (a family group, or a private chat) with a one-time code, and warns
 * when SMS isn't actually configured on the server.
 */
export const AlertChannelsPanel: React.FC<{ user: FirebaseUser | null; lang: Language }> = ({ user, lang }) => {
  const [channels, setChannels] = useState<{ sms: boolean; telegram: boolean } | null>(null);
  const [chats, setChats] = useState<LinkedChat[]>([]);
  const [pending, setPending] = useState<PendingLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const loadChats = useCallback(async () => {
    if (!user) return [];
    const res = await authFetch('/api/alerts/telegram/chats');
    if (!res.ok) return null;
    const data = await res.json();
    const list: LinkedChat[] = Array.isArray(data.chats) ? data.chats : [];
    setChats(list);
    return list;
  }, [user]);

  useEffect(() => {
    fetch('/api/alerts/channels')
      .then((r) => r.json())
      .then((d) => setChannels({ sms: Boolean(d.sms), telegram: Boolean(d.telegram) }))
      .catch(() => setChannels(null));
    void loadChats().catch(() => {});
  }, [loadChats]);

  // While a code is waiting to be used, check every few seconds for the new chat.
  useEffect(() => {
    if (!pending) return;
    const before = chats.length;
    pollRef.current = window.setInterval(async () => {
      if (Date.now() > pending.expiresAt) {
        setPending(null);
        return;
      }
      const list = await loadChats().catch(() => null);
      if (list && list.length > before) setPending(null);
    }, 4000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const startLink = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/alerts/telegram/link', { method: 'POST', body: '{}' });
      if (!res.ok) throw new Error(await responseError(res, t('alerts.linkFailed', lang)));
      setPending(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (chatId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/alerts/telegram/unlink', { method: 'POST', body: JSON.stringify({ chatId }) });
      if (!res.ok) throw new Error(await responseError(res, t('alerts.unlinkFailed', lang)));
      await loadChats();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-line bg-well/60 space-y-3 rounded-xl border p-4">
      <div className="flex items-center gap-2">
        <Send className="text-sky h-5 w-5" />
        <label className="text-base font-bold sm:text-lg">{t('alerts.title', lang)}</label>
      </div>
      <p className="text-ink-soft text-sm">{t('alerts.desc', lang)}</p>

      {channels && !channels.sms && (
        <div role="alert" className="border-brick bg-brick-soft text-brick-deep flex items-start gap-2 rounded-xl border p-3 text-sm font-bold">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('alerts.smsOff', lang)}</span>
        </div>
      )}

      {!user ? (
        <p className="text-ink-soft text-sm font-semibold">{t('alerts.signInFirst', lang)}</p>
      ) : channels && !channels.telegram ? (
        <p className="text-ink-soft text-sm font-semibold">{t('alerts.telegramOff', lang)}</p>
      ) : (
        <>
          {chats.length > 0 && (
            <ul className="space-y-2">
              {chats.map((c) => (
                <li key={c.chatId} className="bg-paper border-line flex items-center justify-between gap-3 rounded-xl border p-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Users className="text-sky-deep h-5 w-5 shrink-0" />
                    <span className="truncate font-bold">{c.title}</span>
                    {c.type === 'private' && <span className="text-ink-soft text-xs">({t('alerts.private', lang)})</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => unlink(c.chatId)}
                    disabled={busy}
                    className="btn btn-sm btn-secondary text-brick border-brick/30 shrink-0"
                  >
                    <Unlink className="h-4 w-4" />
                    <span>{t('alerts.unlink', lang)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {pending ? (
            <div className="bg-paper border-line space-y-3 rounded-xl border p-3">
              <p className="text-sm font-semibold">{t('alerts.step1', lang)}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <a href={pending.groupUrl} target="_blank" rel="noopener noreferrer" className="btn btn-md btn-primary">
                  <Users className="h-5 w-5" />
                  <span>{t('alerts.openGroup', lang)}</span>
                </a>
                <a href={pending.privateUrl} target="_blank" rel="noopener noreferrer" className="btn btn-md btn-secondary">
                  <ExternalLink className="h-5 w-5" />
                  <span>{t('alerts.openPrivate', lang)}</span>
                </a>
              </div>
              <p className="text-ink-soft text-xs">
                {t('alerts.manual', lang)} <span className="font-mono font-bold">@{pending.botUsername}</span> →{' '}
                <span className="font-mono font-bold">/link {pending.code}</span>
              </p>
              <p className="text-ink-soft flex items-center gap-2 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" /> {t('alerts.waiting', lang)}
              </p>
            </div>
          ) : (
            <button type="button" onClick={startLink} disabled={busy || !channels} className="btn btn-md btn-secondary w-full">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
              <span>{chats.length ? t('alerts.addAnother', lang) : t('alerts.add', lang)}</span>
            </button>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="text-brick-deep text-sm font-bold">
          {error}
        </p>
      )}
    </div>
  );
};
