/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  recordWatchSeen,
  checkOfflineWatches,
  isQuietHours,
  OFFLINE_AFTER_MS,
  _resetWatchHealthForTest,
} from './watchHealth';
import { pairWearableDevice, _setAdminDbForTest } from './wearableIncidentService';
import * as alertChannels from './alertChannels';
import * as notifications from './notifications';

const NOON_SGT = Date.parse('2026-10-22T04:00:00Z');
const MIDNIGHT_SGT = Date.parse('2026-10-22T16:30:00Z'); // 00:30 SGT

describe('watchHealth', () => {
  let telegram: ReturnType<typeof vi.spyOn>;
  let push: ReturnType<typeof vi.spyOn>;
  let sms: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    _setAdminDbForTest(null);
    _resetWatchHealthForTest();
    telegram = vi.spyOn(alertChannels, 'sendTelegramPin').mockResolvedValue(1);
    push = vi.spyOn(alertChannels, 'notifyPushDevices').mockResolvedValue(1);
    sms = vi.spyOn(notifications, 'sendSms').mockResolvedValue({ success: true, carrierStatus: 'SENT_TEXTBEE', recipient: '+6591234567' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await pairWearableDevice({
      deviceId: 'SS-HLTH-0000-0001',
      uid: 'uid-1',
      elderName: 'Benjamin',
      emergencyContacts: [{ id: 'mom', name: 'Mom', relationship: 'Mother', phone: '91234567', emoji: '', bgColor: '', isPrimary: true }],
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('knows Singapore quiet hours (23:00–07:00)', () => {
    expect(isQuietHours(NOON_SGT)).toBe(false);
    expect(isQuietHours(MIDNIGHT_SGT)).toBe(true);
    expect(isQuietHours(Date.parse('2026-10-21T23:00:00Z'))).toBe(false); // 07:00 SGT
  });

  it('warns once per discharge when the battery is low, on every channel', async () => {
    await recordWatchSeen('SS-HLTH-0000-0001', 40, NOON_SGT);
    expect(telegram).not.toHaveBeenCalled();

    await recordWatchSeen('SS-HLTH-0000-0001', 14, NOON_SGT + 60_000);
    expect(telegram).toHaveBeenCalledTimes(1);
    expect(String(telegram.mock.calls[0][1].text)).toContain("Benjamin's watch battery is at 14%");
    expect(push).toHaveBeenCalledTimes(1);
    expect(sms).toHaveBeenCalledTimes(1);

    await recordWatchSeen('SS-HLTH-0000-0001', 9, NOON_SGT + 120_000);
    expect(telegram).toHaveBeenCalledTimes(1); // not again while still low

    await recordWatchSeen('SS-HLTH-0000-0001', 80, NOON_SGT + 3600_000); // charged
    await recordWatchSeen('SS-HLTH-0000-0001', 12, NOON_SGT + 7200_000);
    expect(telegram).toHaveBeenCalledTimes(2); // re-armed after recovery
  });

  it('holds the low-battery warning during quiet hours', async () => {
    await recordWatchSeen('SS-HLTH-0000-0001', 10, MIDNIGHT_SGT);
    expect(telegram).not.toHaveBeenCalled();
  });

  it('warns once when a watch goes silent, and says when it is back', async () => {
    await recordWatchSeen('SS-HLTH-0000-0001', 55, NOON_SGT);

    expect((await checkOfflineWatches(NOON_SGT + OFFLINE_AFTER_MS - 1000)).notified).toBe(0); // not yet

    const later = NOON_SGT + OFFLINE_AFTER_MS + 60_000;
    expect(await checkOfflineWatches(later)).toEqual({ checked: 1, notified: 1 });
    const text = String(telegram.mock.calls[0][1].text);
    expect(text).toContain("Benjamin's watch has stopped reporting");
    expect(text).toContain('12:00'); // last seen, Singapore time
    expect(text).toContain('55%');
    expect(sms).toHaveBeenCalledTimes(1);

    expect((await checkOfflineWatches(later + 5 * 60_000)).notified).toBe(0); // once per silence

    await recordWatchSeen('SS-HLTH-0000-0001', 54, later + 10 * 60_000);
    expect(String(telegram.mock.calls[1][1].text)).toContain("Benjamin's watch is reporting again");
    expect(sms).toHaveBeenCalledTimes(1); // "back" is Telegram + phones only
  });

  it('ignores unpaired watches and skips the check during quiet hours', async () => {
    await recordWatchSeen('SS-NOPAIR-0000-01', 50, NOON_SGT);
    expect((await checkOfflineWatches(NOON_SGT + OFFLINE_AFTER_MS + 60_000)).notified).toBe(0);
    await recordWatchSeen('SS-HLTH-0000-0001', 50, MIDNIGHT_SGT - OFFLINE_AFTER_MS * 2);
    expect(await checkOfflineWatches(MIDNIGHT_SGT)).toEqual({ checked: 0, notified: 0 });
  });
});
