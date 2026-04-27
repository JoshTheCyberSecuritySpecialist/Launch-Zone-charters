/**
 * Resend (email) + Twilio (SMS) for condition alerts.
 * All sends are best-effort — errors are logged, never thrown to callers.
 */

const twilio = require('twilio');
const { Resend } = require('resend');

let twilioClient = null;

function getTwilioClient() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!sid || !token) {
    return null;
  }
  if (!twilioClient) {
    twilioClient = twilio(sid, token);
  }
  return twilioClient;
}

function getResend() {
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) return null;
  return new Resend(key);
}

function alertsFromEmail() {
  return (process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM || '').trim() || null;
}

/**
 * Normalize US-style numbers to E.164 when possible.
 * @param {string} raw
 */
function normalizePhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (s.startsWith('+')) return s;
  return '';
}

/**
 * @returns {Promise<boolean>} true if send attempted and API accepted
 */
async function sendSMS(toRaw, message) {
  const from = (process.env.TWILIO_PHONE_NUMBER || '').trim();
  const to = normalizePhone(toRaw);
  if (!to || !from) {
    console.warn('[notificationService] SMS skipped — missing phone or TWILIO_PHONE_NUMBER');
    return false;
  }
  const client = getTwilioClient();
  if (!client) {
    console.warn('[notificationService] SMS skipped — Twilio not configured');
    return false;
  }
  try {
    await client.messages.create({
      body: message.slice(0, 1600),
      from,
      to,
    });
    console.log('✅ SMS SENT:', to);
    return true;
  } catch (err) {
    console.error('❌ SMS FAILED:', err);
    return false;
  }
}

/**
 * @returns {Promise<boolean>}
 */
async function sendEmail(to, subject, text) {
  const resend = getResend();
  const from = alertsFromEmail();
  if (!resend || !from) {
    console.warn('[notificationService] Email skipped — RESEND_API_KEY or RESEND_FROM_EMAIL not set');
    return false;
  }
  const addr = String(to || '').trim().toLowerCase();
  if (!addr) return false;
  try {
    await resend.emails.send({
      from,
      to: addr,
      subject: String(subject).slice(0, 200),
      text: String(text).slice(0, 12000),
    });
    console.log('✅ EMAIL SENT:', addr);
    return true;
  } catch (err) {
    console.error('❌ EMAIL FAILED:', err);
    return false;
  }
}

module.exports = {
  sendSMS,
  sendEmail,
  normalizePhone,
};
