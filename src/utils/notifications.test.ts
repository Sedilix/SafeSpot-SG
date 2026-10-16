/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizePhoneNumber, sendSms, sendTextbeeSms, sendTwilioSms, smsConfigured, smsAlertRecipients, smsProviderOrder, _resetTextbeeForTest } from './notifications';

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

describe('smsAlertRecipients', () => {
  const scdf = { id: 'contact-emergency', phone: '995', isPrimary: false, locked: true };
  const mei = { id: 'mei', phone: '9123 4567', isPrimary: false };
  const tan = { id: 'tan', phone: '+65 8765 4321', isPrimary: true };

  it('never texts 995 or other short codes, even with no primary contact', () => {
    expect(smsAlertRecipients([scdf, mei])).toEqual([mei]);
    expect(smsAlertRecipients([scdf, { id: 'x', phone: '995' }, { id: 'y', phone: '1777' }])).toEqual([]);
  });

  it('prefers primary contacts', () => {
    expect(smsAlertRecipients([scdf, mei, tan])).toEqual([tan]);
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

  it('fails (never pretends) in production when Twilio credentials are missing', async () => {
    process.env.NODE_ENV = 'production';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await sendTwilioSms({ to: '91234567', body: 'Emergency alert!' });
    expect(res.success).toBe(false);
    expect(res.carrierStatus).toBe('SMS_NOT_CONFIGURED');
    expect(smsConfigured()).toBe(false);
  });

  it('reports SMS as configured when all three Twilio settings are present', () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC1';
    process.env.TWILIO_AUTH_TOKEN = 't';
    process.env.TWILIO_PHONE_NUMBER = '+15550000000';
    expect(smsConfigured()).toBe(true);
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

describe('SMS providers', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'production' };
    for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'TEXTBEE_API_KEY', 'TEXTBEE_DEVICE_ID', 'SMS_PROVIDER']) {
      delete process.env[k];
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    _resetTextbeeForTest();
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const twilioEnv = () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC1';
    process.env.TWILIO_AUTH_TOKEN = 't';
    process.env.TWILIO_PHONE_NUMBER = '+15550000000';
  };

  /** textbee mock: send is accepted ("queued"), then the batch reports `outcome` (after `pendingPolls` pending answers). */
  const textbeeMock = (outcome: 'sent' | 'failed' | 'pending', pendingPolls = 0, devices?: any[]) => {
    let polls = 0;
    return vi.fn(async (url: string, init?: any) => {
      if (url.endsWith('/gateway/devices')) return { ok: true, status: 200, json: async () => ({ data: devices ?? [] }) };
      if (url.endsWith('/send-sms')) return { ok: true, status: 200, json: async () => ({ data: { smsBatchId: 'b1', message: 'SMS added to queue for processing' } }) };
      if (url.includes('/sms-batch/')) {
        polls++;
        const status = outcome === 'pending' || polls <= pendingPolls ? 'pending' : outcome;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              batch: { status, sentCount: status === 'sent' ? 1 : 0, failureCount: status === 'failed' ? 1 : 0 },
              messages: [{ status, errorMessage: status === 'failed' ? 'No cellular service. Check signal and try again.' : undefined }],
            },
          }),
        };
      }
      return { ok: true, status: 201, json: async () => ({ sid: 'SM1' }) }; // Twilio
    });
  };
  const fast = { pollMs: 1, confirmTimeoutMs: 200 };

  it('textbee counts as sent only once the phone confirms it', async () => {
    process.env.TEXTBEE_API_KEY = 'tb-key';
    process.env.TEXTBEE_DEVICE_ID = 'dev1';
    const fetchMock = textbeeMock('sent', 2);
    vi.stubGlobal('fetch', fetchMock);
    const res = await sendTextbeeSms({ to: '91234567', body: 'Hi' }, fast);
    expect(res).toMatchObject({ success: true, carrierStatus: 'SENT_TEXTBEE', messageId: 'b1', recipient: '+6591234567' });
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://api.textbee.dev/api/v1/gateway/send-sms');
    expect(init.headers['x-api-key']).toBe('tb-key');
    expect(JSON.parse(init.body)).toEqual({ recipients: ['+6591234567'], message: 'Hi', deviceId: 'dev1' });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/devices/dev1/sms-batch/b1');
  });

  it('textbee "queued" but the phone fails (e.g. no SIM) is a failure with the reason', async () => {
    process.env.TEXTBEE_API_KEY = 'tb-key';
    process.env.TEXTBEE_DEVICE_ID = 'dev1';
    vi.stubGlobal('fetch', textbeeMock('failed'));
    const res = await sendTextbeeSms({ to: '91234567', body: 'Hi' }, fast);
    expect(res).toMatchObject({ success: false, carrierStatus: 'TEXTBEE_FAILED_ON_PHONE' });
    expect(res.error).toContain('No cellular service');
  });

  it('textbee with no confirmation in time is a failure', async () => {
    process.env.TEXTBEE_API_KEY = 'tb-key';
    process.env.TEXTBEE_DEVICE_ID = 'dev1';
    vi.stubGlobal('fetch', textbeeMock('pending'));
    const res = await sendTextbeeSms({ to: '91234567', body: 'Hi' }, { pollMs: 1, confirmTimeoutMs: 20 });
    expect(res).toMatchObject({ success: false, carrierStatus: 'TEXTBEE_UNCONFIRMED' });
  });

  it('without TEXTBEE_DEVICE_ID, uses the enabled phone seen most recently', async () => {
    process.env.TEXTBEE_API_KEY = 'tb-key';
    const fetchMock = textbeeMock('sent', 0, [
      { _id: 'old', enabled: true, lastHeartbeat: '2026-10-01T00:00:00Z' },
      { _id: 'off', enabled: false, lastHeartbeat: '2026-10-16T00:00:00Z' },
      { _id: 'new', enabled: true, lastHeartbeat: '2026-10-15T00:00:00Z' },
    ]);
    vi.stubGlobal('fetch', fetchMock);
    await sendTextbeeSms({ to: '91234567', body: 'Hi' }, fast);
    const send = fetchMock.mock.calls.find((c: any) => String(c[0]).endsWith('/send-sms')) as any;
    expect(JSON.parse(send[1].body).deviceId).toBe('new');
  });

  it('prefers textbee by default and Twilio when SMS_PROVIDER=twilio', () => {
    process.env.TEXTBEE_API_KEY = 'k';
    twilioEnv();
    expect(smsProviderOrder()).toEqual(['textbee', 'twilio']);
    process.env.SMS_PROVIDER = 'twilio';
    expect(smsProviderOrder()).toEqual(['twilio', 'textbee']);
    delete process.env.TEXTBEE_API_KEY;
    expect(smsProviderOrder()).toEqual(['twilio']);
    expect(smsConfigured()).toBe(true);
  });

  it('falls back to the other provider when the first fails', async () => {
    process.env.TEXTBEE_API_KEY = 'k';
    twilioEnv();
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('textbee')
        ? { ok: false, status: 503, json: async () => ({ message: 'device offline' }) }
        : { ok: true, status: 201, json: async () => ({ sid: 'SM1' }) },
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await sendSms({ to: '91234567', body: 'Alert' });
    expect(res).toMatchObject({ success: true, carrierStatus: 'SENT_CARRIER_SMS', messageId: 'SM1' });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('api.twilio.com');
  });

  it('with no provider, fails in production', async () => {
    const res = await sendSms({ to: '91234567', body: 'Alert' });
    expect(res).toMatchObject({ success: false, carrierStatus: 'SMS_NOT_CONFIGURED' });
  });
});
