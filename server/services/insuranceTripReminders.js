/**
 * Pre-trip rental insurance reminders (Resend + Twilio).
 * Charter bookings are stored with insurance_status=verified and are excluded.
 * Uses insurance_reminder_24h_sent_at / insurance_reminder_2h_sent_at for idempotency.
 */

const { sendSMS } = require('./sms');

const DEFAULT_MSG =
  'Reminder: Rental insurance must be completed before your trip. — Launch Zone Charters';

function publicAppBase() {
  return (process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {object} opts
 * @param {import('@supabase/supabase-js').SupabaseClient} opts.supabase
 * @param {import('resend').Resend | null} opts.resend
 * @param {string} opts.resendFrom
 * @returns {Promise<{ processed: number; sent24h: number; sent2h: number; errors: string[] }>}
 */
async function runTripInsuranceReminders(opts) {
  const { supabase, resend, resendFrom } = opts;
  const out = { processed: 0, sent24h: 0, sent2h: 0, errors: [] };

  if (!supabase) {
    out.errors.push('no_supabase');
    return out;
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const { data: rows, error: fetchErr } = await supabase
    .from('bookings')
    .select(
      'id, start_time, insurance_status, insurance_reminder_24h_sent_at, insurance_reminder_2h_sent_at, status, customer_id'
    )
    .in('insurance_status', ['pending', 'submitted', 'rejected'])
    .not('status', 'eq', 'cancelled')
    .gt('start_time', nowIso)
    .limit(250);

  if (fetchErr) {
    out.errors.push(fetchErr.message || 'fetch');
    return out;
  }

  if (!rows?.length) return out;

  const base = publicAppBase();

  for (const row of rows) {
    out.processed += 1;
    const startMs = new Date(row.start_time).getTime();
    const msUntilStart = startMs - now;

    const window24 =
      msUntilStart >= 23 * 60 * 60 * 1000 &&
      msUntilStart <= 25 * 60 * 60 * 1000 &&
      !row.insurance_reminder_24h_sent_at;
    const window2 =
      msUntilStart >= 1 * 60 * 60 * 1000 &&
      msUntilStart <= 3 * 60 * 60 * 1000 &&
      !row.insurance_reminder_2h_sent_at;

    if (!window24 && !window2) continue;

    const { data: customer, error: cErr } = await supabase
      .from('customers')
      .select('email, phone')
      .eq('id', row.customer_id)
      .maybeSingle();

    if (cErr || !customer?.email) {
      out.errors.push(`no_customer:${row.id}`);
      continue;
    }

    const email = String(customer.email).trim();
    const phone = String(customer.phone || '').trim();
    const insuranceUrl = base
      ? `${base}/insurance-required?bookingId=${encodeURIComponent(row.id)}`
      : '';

    const textBody = insuranceUrl
      ? `${DEFAULT_MSG} Complete: ${insuranceUrl}`
      : DEFAULT_MSG;

    if (window24) {
      let anyDelivery = false;
      if (resend && resendFrom) {
        const html = `
          <p>${escapeHtml(DEFAULT_MSG)}</p>
          ${
            insuranceUrl
              ? `<p><a href="${escapeHtml(insuranceUrl)}">Open insurance steps</a></p>`
              : ''
          }
          <p><small>Booking ID: ${escapeHtml(row.id)}</small></p>
        `;
        const r = await resend.emails.send({
          from: resendFrom,
          to: email,
          subject: 'Insurance required before your trip — Launch Zone Charters',
          html,
        });
        if (r.error) out.errors.push(`email24:${row.id}:${r.error.message || 'resend'}`);
        else anyDelivery = true;
      }

      const smsRes = await sendSMS(phone, textBody);
      if (smsRes.ok) anyDelivery = true;
      else if (!smsRes.skipped) out.errors.push(`sms24:${row.id}`);

      if (anyDelivery) {
        const patch24 = { insurance_reminder_24h_sent_at: new Date().toISOString() };
        const { error: u24 } = await supabase.from('bookings').update(patch24).eq('id', row.id);
        if (u24) out.errors.push(`db24:${row.id}:${u24.message}`);
        else out.sent24h += 1;
      }
    }

    if (window2) {
      let anyDelivery = false;
      if (resend && resendFrom) {
        const html = `
          <p>${escapeHtml(DEFAULT_MSG)}</p>
          ${
            insuranceUrl
              ? `<p><a href="${escapeHtml(insuranceUrl)}">Complete insurance now</a></p>`
              : ''
          }
          <p><small>Booking ID: ${escapeHtml(row.id)}</small></p>
        `;
        const r = await resend.emails.send({
          from: resendFrom,
          to: email,
          subject: 'Reminder: complete rental insurance before departure',
          html,
        });
        if (r.error) out.errors.push(`email2:${row.id}:${r.error.message || 'resend'}`);
        else anyDelivery = true;
      }

      const smsRes = await sendSMS(phone, textBody);
      if (smsRes.ok) anyDelivery = true;
      else if (!smsRes.skipped) out.errors.push(`sms2:${row.id}`);

      if (anyDelivery) {
        const patch2 = { insurance_reminder_2h_sent_at: new Date().toISOString() };
        const { error: u2 } = await supabase.from('bookings').update(patch2).eq('id', row.id);
        if (u2) out.errors.push(`db2:${row.id}:${u2.message}`);
        else out.sent2h += 1;
      }
    }
  }

  return out;
}

module.exports = {
  runTripInsuranceReminders,
  publicAppBase,
};
