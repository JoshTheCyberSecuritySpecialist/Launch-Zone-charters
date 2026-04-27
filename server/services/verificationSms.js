/**
 * Verification SMS after booking (pending_verification only). At most one per booking.
 */

const sms = require('./sms');

function verifyLink(bookingId, publicAppBase) {
  const base = publicAppBase.replace(/\/$/, '');
  return `${base}/verify?bookingId=${encodeURIComponent(String(bookingId).trim())}`;
}

function buildVerificationMessage(link) {
  return `Launch Zone Charters:

You're almost booked!

Complete verification here:
${link}

Reply with questions anytime.`;
}

/**
 * @param {object} opts
 * @param {import('@supabase/supabase-js').SupabaseClient} opts.supabaseAdmin
 * @param {string} opts.bookingId
 * @param {string} opts.email - must match customers.email
 * @param {string} opts.publicAppBase - e.g. https://example.com
 * @returns {Promise<void>}
 */
async function maybeSendVerificationSms(opts) {
  const { supabaseAdmin, bookingId, email, publicAppBase } = opts;

  if (!supabaseAdmin || !publicAppBase) {
    return;
  }

  const emailNorm = String(email).trim().toLowerCase();
  const id = String(bookingId).trim();

  const { data: booking, error: fetchErr } = await supabaseAdmin
    .from('bookings')
    .select('id, status, verification_sms_sent_at, customer_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !booking) {
    return;
  }

  const { data: customer, error: custErr } = await supabaseAdmin
    .from('customers')
    .select('email, phone')
    .eq('id', booking.customer_id)
    .maybeSingle();

  if (custErr || !customer || !customer.email) {
    return;
  }

  if (customer.email.trim().toLowerCase() !== emailNorm) {
    return;
  }

  if (booking.status !== 'pending_verification') {
    return;
  }
  if (booking.verification_sms_sent_at) {
    return;
  }

  const phone = customer.phone;
  if (!phone || !String(phone).trim()) {
    return;
  }

  const link = verifyLink(id, publicAppBase);
  const message = buildVerificationMessage(link);

  const result = await sms.sendSMS(phone, message);
  if (!result.ok) {
    return;
  }

  const stamp = { verification_sms_sent_at: new Date().toISOString() };
  const markSent = () =>
    supabaseAdmin
      .from('bookings')
      .update(stamp)
      .eq('id', id)
      .eq('status', 'pending_verification')
      .is('verification_sms_sent_at', null)
      .select('id')
      .maybeSingle();

  let { error: updErr } = await markSent();
  if (updErr) {
    await new Promise((r) => setTimeout(r, 150));
    ({ error: updErr } = await markSent());
  }
  if (updErr) {
    console.warn('[verification-sms] could not set verification_sms_sent_at:', updErr.message || updErr);
  }
}

module.exports = {
  maybeSendVerificationSms,
  buildVerificationMessage,
  verifyLink,
};
