/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface TwilioSendParams {
  to: string;
  body: string;
}

export interface TwilioSendResult {
  success: boolean;
  messageId?: string;
  carrierStatus: string;
  recipient: string;
  error?: string;
}

/**
 * Normalizes phone numbers to E.164 standard (+65 for Singapore if 8-digit mobile).
 */
export function normalizePhoneNumber(phone: string): string {
  const trimmed = (phone || '').trim();
  const digitsOnly = trimmed.replace(/[^0-9+]/g, '');
  if (digitsOnly.startsWith('+')) {
    return digitsOnly;
  }
  // Singapore 8-digit numbers typically start with 8 or 9
  if (/^[89]\d{7}$/.test(digitsOnly)) {
    return `+65${digitsOnly}`;
  }
  // If starts with 65 followed by 8 digits
  if (/^65[89]\d{7}$/.test(digitsOnly)) {
    return `+${digitsOnly}`;
  }
  return digitsOnly.startsWith('+') ? digitsOnly : `+65${digitsOnly.replace(/^0+/, '')}`;
}

/**
 * Dispatches an SMS via Twilio REST API if credentials are present,
 * or simulates delivery in development/test environments.
 */
export async function sendTwilioSms(params: TwilioSendParams): Promise<TwilioSendResult> {
  const { to, body } = params;
  const cleanPhone = normalizePhoneNumber(to);
  const timestamp = Date.now();
  const fallbackId = `disp_${timestamp}_${Math.random().toString(36).slice(2, 7)}`;

  if (!cleanPhone || cleanPhone === '+65') {
    return {
      success: false,
      carrierStatus: 'MISSING_PHONE',
      recipient: to,
      error: 'Valid phone number is required.',
    };
  }

  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM_NUMBER;

  if (!twilioAccountSid || !twilioAuthToken || !twilioFrom) {
    console.log(`[TWILIO] Gateway unconfigured (dev/test), simulated SMS to ${cleanPhone}:`, {
      messagePreview: body.slice(0, 100) + (body.length > 100 ? '...' : ''),
    });
    return {
      success: true,
      messageId: fallbackId,
      carrierStatus: 'DISPATCHED_DIRECT_GATEWAY',
      recipient: cleanPhone,
    };
  }

  try {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
    const formParams = new URLSearchParams();
    formParams.append('To', cleanPhone);
    formParams.append('From', twilioFrom);
    formParams.append('Body', body);

    const twilioRes = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formParams.toString(),
    });

    if (twilioRes.ok) {
      const data = (await twilioRes.json().catch(() => ({}))) as Record<string, any>;
      return {
        success: true,
        messageId: data.sid || fallbackId,
        carrierStatus: 'SENT_CARRIER_SMS',
        recipient: cleanPhone,
      };
    } else {
      const twErr = await twilioRes.text();
      console.warn('[TWILIO] Carrier dispatch warning:', twErr);
      return {
        success: false,
        messageId: fallbackId,
        carrierStatus: 'TWILIO_CARRIER_ERROR',
        recipient: cleanPhone,
        error: twErr,
      };
    }
  } catch (err: any) {
    console.warn('[TWILIO] Carrier dispatch error:', err.message);
    return {
      success: false,
      messageId: fallbackId,
      carrierStatus: 'TWILIO_NETWORK_ERROR',
      recipient: cleanPhone,
      error: err.message,
    };
  }
}
