/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizePhoneNumber, sendTwilioSms } from './notifications';

describe('normalizePhoneNumber', () => {
  it('formats Singapore 8-digit numbers with +65', () => {
    expect(normalizePhoneNumber('91234567')).toBe('+6591234567');
    expect(normalizePhoneNumber('81234567')).toBe('+6581234567');
    expect(normalizePhoneNumber(' 91234567 ')).toBe('+6591234567');
  });

  it('keeps existing + prefix intact', () => {
    expect(normalizePhoneNumber('+6591234567')).toBe('+6591234567');
    expect(normalizePhoneNumber('+14155552671')).toBe('+14155552671');
  });

  it('handles 65 prefix without +', () => {
    expect(normalizePhoneNumber('6591234567')).toBe('+6591234567');
  });

  it('handles empty or blank phone strings', () => {
    expect(normalizePhoneNumber('')).toBe('+65');
  });
});

describe('sendTwilioSms', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns MISSING_PHONE error when phone is invalid', async () => {
    const res = await sendTwilioSms({ to: '', body: 'Hello' });
    expect(res.success).toBe(false);
    expect(res.carrierStatus).toBe('MISSING_PHONE');
  });

  it('simulates direct gateway dispatch when Twilio credentials are missing', async () => {
    const res = await sendTwilioSms({ to: '91234567', body: 'Emergency alert!' });
    expect(res.success).toBe(true);
    expect(res.carrierStatus).toBe('DISPATCHED_DIRECT_GATEWAY');
    expect(res.recipient).toBe('+6591234567');
    expect(res.messageId).toMatch(/^disp_/);
  });

  it('dispatches to Twilio REST API when credentials are present and handles success', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACmock123';
    process.env.TWILIO_AUTH_TOKEN = 'mocktoken123';
    process.env.TWILIO_PHONE_NUMBER = '+15005550006';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: 'SMmock123456' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await sendTwilioSms({ to: '91234567', body: 'Test Twilio message' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
    expect(res.carrierStatus).toBe('SENT_CARRIER_SMS');
    expect(res.messageId).toBe('SMmock123456');
  });

  it('handles Twilio API HTTP errors gracefully', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACmock123';
    process.env.TWILIO_AUTH_TOKEN = 'mocktoken123';
    process.env.TWILIO_PHONE_NUMBER = '+15005550006';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => '{"code": 21608, "message": "The number is unverified"}',
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await sendTwilioSms({ to: '91234567', body: 'Test Twilio message' });
    expect(res.success).toBe(false);
    expect(res.carrierStatus).toBe('TWILIO_CARRIER_ERROR');
    expect(res.error).toContain('21608');
  });
});
