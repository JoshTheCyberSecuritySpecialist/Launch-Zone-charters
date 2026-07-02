/**
 * Twilio SMS. Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER.
 */

const twilio = require('twilio');

function normalizePhoneE164(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.startsWith('+')) {
    const digits = s.slice(1).replace(/\D/g, '');
    return digits.length >= 10 ? `+${digits}` : null;
  }
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

function twilioClient() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!sid || !token) return null;
  return twilio(sid, token);
}

/**
 * @param {string} phone destination (E.164 preferred; US 10-digit accepted)
 * @param {string} message body (SMS segment limits apply)
 * @returns {Promise<{ ok: boolean; skipped?: boolean }>}
 */
async function sendSMS(phone, message) {
  const from = (process.env.TWILIO_PHONE_NUMBER || '').trim();
  const client = twilioClient();
  const to = normalizePhoneE164(phone);

  if (!client || !from) {
    return { ok: false, skipped: true };
  }
  if (!to || !String(message || '').trim()) {
    return { ok: false, skipped: true };
  }

  try {
    const sentMessage = await client.messages.create({
      body: String(message).trim(),
      from,
      to,
    });
    return { ok: true, sid: sentMessage?.sid || null };
  } catch (err) {
    console.warn('[sms] Twilio send failed:', err && err.message ? err.message : err);
    return { ok: false };
  }
}

module.exports = {
  sendSMS,
  normalizePhoneE164,
  twilioClient,
};
