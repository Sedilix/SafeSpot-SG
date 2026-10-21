/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { Bell, BellOff, Check, Copy, Loader2, Share2, Smartphone, Trash2, UserPlus } from 'lucide-react';
import type { Language } from '../types';
import { t } from '../locales/translations';
import { authFetch, responseError } from '../lib/authFetch';
import { currentEndpoint, deviceLabel, pushSupport, subscribeThisDevice, unsubscribeThisDevice } from '../lib/push';

interface PushDeviceRow {
  id: string;
  label: string;
  endpoint: string;
}

/**
 * Phone notifications: turn them on for this device, invite family with a
 * link (they don't need an account), and remove devices.
 */
export const PushAlertsSection: React.FC<{
  user: FirebaseUser;
  lang: Language;
  vapidPublicKey: string;
  onDevicesChanged?: (count: number) => void;
}> = ({ user, lang, vapidPublicKey, onDevicesChanged }) => {
  const [devices, setDevices] = useState<PushDeviceRow[]>([]);
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ url: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const support = pushSupport();

  const load = useCallback(async () => {
    const res = await authFetch('/api/alerts/push/devices');
    if (!res.ok) return;
    const d = await res.json();
    const list: PushDeviceRow[] = Array.isArray(d.devices) ? d.devices : [];
    setDevices(list);
    onDevicesChanged?.(list.length);
    setThisEndpoint(await currentEndpoint().catch(() => null));
  }, [onDevicesChanged]);

  useEffect(() => {
    void load().catch(() => {});
  }, [load, user]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e.message || t('push.failed', lang));
    } finally {
      setBusy(null);
    }
  };

  const turnOnHere = () =>
    run('on', async () => {
      const subscription = await subscribeThisDevice(vapidPublicKey);
      const res = await authFetch('/api/alerts/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({ subscription, label: deviceLabel() }),
      });
      if (!res.ok) throw new Error(await responseError(res, t('push.failed', lang)));
      await load();
    });

  const remove = (d: PushDeviceRow) =>
    run(d.id, async () => {
      if (d.endpoint === thisEndpoint) await unsubscribeThisDevice();
      const res = await authFetch('/api/alerts/push/remove', { method: 'POST', body: JSON.stringify({ id: d.id }) });
      if (!res.ok) throw new Error(await responseError(res, t('push.failed', lang)));
      await load();
    });

  const createInvite = () =>
    run('invite', async () => {
      const res = await authFetch('/api/alerts/push/invite', { method: 'POST', body: '{}' });
      if (!res.ok) throw new Error(await responseError(res, t('push.failed', lang)));
      setInvite(await res.json());
    });

  const shareInvite = async () => {
    if (!invite) return;
    const text = t('push.inviteMessage', lang);
    if (navigator.share) {
      await navigator.share({ title: 'SafeSpot alerts', text, url: invite.url }).catch(() => {});
    } else {
      await copyText(`${text} ${invite.url}`);
    }
  };

  // Only say "Copied" when the clipboard write actually succeeded.
  const copyText = async (value: string) => {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(value);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
    setTimeout(() => setCopied(null), 2500);
  };

  const copyInvite = async () => {
    if (!invite) return;
    await copyText(invite.url);
  };

  const thisIsOn = Boolean(thisEndpoint && devices.some((d) => d.endpoint === thisEndpoint));

  return (
    <section aria-labelledby="push-alerts-heading" className="border-line space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <Bell className="text-sky h-5 w-5 shrink-0" />
        <h4 id="push-alerts-heading" className="font-body text-base font-bold">{t('push.title', lang)}</h4>
      </div>
      <p className="text-ink-soft text-sm">{t('push.desc', lang)}</p>

      {devices.length > 0 && (
        <ul className="space-y-2">
          {devices.map((d) => (
            <li key={d.id} className="bg-surface border-line flex items-center justify-between gap-3 rounded-xl border p-3">
              <div className="flex min-w-0 items-center gap-2">
                <Smartphone className="text-sky h-5 w-5 shrink-0" />
                <span className="truncate font-bold">{d.label}</span>
                {d.endpoint === thisEndpoint && <span className="text-ink-soft shrink-0 text-sm">({t('push.thisPhone', lang)})</span>}
              </div>
              <button
                type="button"
                onClick={() => remove(d)}
                disabled={busy !== null}
                className="btn btn-sm btn-secondary text-brick border-brick/30 hover:text-brick-deep shrink-0"
                aria-label={`${t('push.remove', lang)} ${d.label}`}
              >
                {busy === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                <span>{t('push.remove', lang)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {support === 'supported' && !thisIsOn && (
          <button type="button" onClick={turnOnHere} disabled={busy !== null} className="btn btn-md btn-secondary">
            {busy === 'on' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Bell className="h-5 w-5" />}
            <span>{t('push.turnOnHere', lang)}</span>
          </button>
        )}
        <button type="button" onClick={createInvite} disabled={busy !== null} className="btn btn-md btn-secondary">
          {busy === 'invite' ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />}
          <span>{t('push.invite', lang)}</span>
        </button>
      </div>

      {support === 'needs-install' && !thisIsOn && (
        <p className="text-ink-soft flex items-start gap-2 text-sm">
          <BellOff className="mt-0.5 h-4 w-4 shrink-0" />
          {t('push.iphoneHint', lang)}
        </p>
      )}

      {support === 'unsupported' && !thisIsOn && (
        <p className="text-ink-soft flex items-start gap-2 text-sm">
          <BellOff className="mt-0.5 h-4 w-4 shrink-0" />
          {t('push.unsupported', lang)}
        </p>
      )}

      {invite && (
        <div className="bg-surface border-line space-y-2 rounded-xl border p-3">
          <p className="text-sm font-semibold">{t('push.inviteReady', lang)}</p>
          <p className="bg-well border-line truncate rounded-lg border px-2.5 py-1.5 font-mono text-sm" title={invite.url}>{invite.url}</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={shareInvite} className="btn btn-md btn-primary">
              <Share2 className="h-5 w-5" />
              <span>{t('push.share', lang)}</span>
            </button>
            <button type="button" onClick={copyInvite} className="btn btn-md btn-secondary">
              {copied === 'yes' ? <Check className="text-pine h-5 w-5" /> : <Copy className="h-5 w-5" />}
              <span>{copied === 'yes' ? t('push.copied', lang) : t('push.copy', lang)}</span>
            </button>
          </div>
          <p aria-live="polite" className="text-brick-deep text-sm font-semibold empty:hidden">
            {copied === 'failed' ? t('common.copyFailed', lang) : ''}
          </p>
          <p className="text-ink-soft text-sm">{t('push.inviteExpiry', lang)}</p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-brick-deep text-sm font-bold">
          {error}
        </p>
      )}
    </section>
  );
};
