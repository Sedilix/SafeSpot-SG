/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { AlertTriangle, Check, Copy, ExternalLink, Loader2, Plus, Send, Unlink, Users } from 'lucide-react';
import type { Language } from '../types';
import { t } from '../locales/translations';
import { authFetch, responseError } from '../lib/authFetch';
import { PushAlertsSection } from './PushAlertsSection';
import { isNativeApp } from '../lib/native';

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
  const [channels, setChannels] = useState<{ sms: boolean; telegram: boolean; push: boolean; fcm: boolean; vapidPublicKey: string | null } | null>(null);
  const [chats, setChats] = useState<LinkedChat[]>([]);
  const [pending, setPending] = useState<PendingLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  // Set when /api/alerts/channels can't be read, so the panel says why the
  // Telegram button stays disabled instead of looking stuck.
  const [channelsFailed, setChannelsFailed] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  const copyLinkCommand = async () => {
    if (!pending) return;
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(`/link ${pending.code}`);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
    window.setTimeout(() => setCopied(null), 2500);
  };

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
      .then((d) => {
        setChannelsFailed(false);
        setChannels({ sms: Boolean(d.sms), telegram: Boolean(d.telegram), push: Boolean(d.push), fcm: Boolean(d.fcm), vapidPublicKey: d.vapidPublicKey || null });
      })
      .catch(() => {
        setChannels(null);
        setChannelsFailed(true);
      });
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
    setUnlinkingId(chatId);
    setError(null);
    try {
      const res = await authFetch('/api/alerts/telegram/unlink', { method: 'POST', body: JSON.stringify({ chatId }) });
      if (!res.ok) throw new Error(await responseError(res, t('alerts.unlinkFailed', lang)));
      await loadChats();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
      setUnlinkingId(null);
    }
  };

  const loadingChannels = !channels && !channelsFailed;

  return (
    <section aria-labelledby="alert-channels-heading" className="border-line bg-well/60 space-y-3 rounded-xl border p-4">
      <div className="flex items-center gap-2">
        <Send className="text-sky h-5 w-5 shrink-0" />
        <h3 id="alert-channels-heading" className="font-body text-base font-bold sm:text-lg">
          {t('alerts.title', lang)}
        </h3>
      </div>
      <p className="text-ink-soft text-sm">{t('alerts.desc', lang)}</p>

      {channels && !channels.sms && (
        <div role="alert" className="border-brick/40 bg-brick-soft text-brick-deep flex items-start gap-2 rounded-xl border p-3 text-sm font-bold">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('alerts.smsOff', lang)}</span>
        </div>
      )}

      {channelsFailed && (
        <div role="alert" className="border-brick/40 bg-brick-soft text-brick-deep flex items-start gap-2 rounded-xl border p-3 text-sm font-bold">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('alerts.channelsFailed', lang)}</span>
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
                <li key={c.chatId} className="bg-surface border-line flex items-center justify-between gap-3 rounded-xl border p-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Users className="text-sky h-5 w-5 shrink-0" />
                    <span className="truncate font-bold">{c.title}</span>
                    {c.type === 'private' && <span className="text-ink-soft shrink-0 text-sm">({t('alerts.private', lang)})</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => unlink(c.chatId)}
                    disabled={busy}
                    aria-label={`${t('alerts.unlink', lang)}: ${c.title}`}
                    className="btn btn-sm btn-secondary text-brick border-brick/30 hover:text-brick-deep shrink-0"
                  >
                    {unlinkingId === c.chatId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
                    <span>{t('alerts.unlink', lang)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {pending ? (
            <div className="bg-surface border-line space-y-3 rounded-xl border p-3">
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
              <div className="text-ink-soft space-y-2 text-sm">
                <p className="font-semibold">{t('alerts.manual', lang)}</p>
                <ol className="list-decimal space-y-2 pl-5">
                  <li>
                    {t('alerts.manualFind', lang)} <span className="text-ink font-mono font-bold break-all">@{pending.botUsername}</span>
                  </li>
                  <li>
                    <span>{t('alerts.manualSend', lang)}</span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-ink font-mono font-bold">/link {pending.code}</span>
                      <button type="button" onClick={copyLinkCommand} className="btn btn-sm btn-secondary">
                        {copied === 'yes' ? <Check className="text-pine h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        <span>{copied === 'yes' ? t('push.copied', lang) : t('alerts.copy', lang)}</span>
                      </button>
                    </span>
                    <span aria-live="polite" className="text-brick-deep block font-semibold empty:hidden">
                      {copied === 'failed' ? t('common.copyFailed', lang) : ''}
                    </span>
                  </li>
                </ol>
              </div>
              <p role="status" className="text-ink-soft flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> {t('alerts.waiting', lang)}
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={startLink}
              disabled={busy || !channels}
              className="btn btn-md btn-secondary w-full"
            >
              {busy || loadingChannels ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
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

      {user && channels?.push && (isNativeApp() ? channels.fcm : channels.vapidPublicKey) && (
        <PushAlertsSection user={user} lang={lang} vapidPublicKey={channels.vapidPublicKey} />
      )}
    </section>
  );
};
