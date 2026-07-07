/**
 * Remind customers when license or insurance is still missing before a trip.
 * Points to /waivers-insurance?bookingId= for the unified flow.
 */

const { sendSMS } = require('./sms');
const { waiversInsuranceUrl, bookingNeedsRentalDocs } = require('./preTripNotifications');
const bookingCommunications = require('./bookingCommunications');

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

function missingDocLabels(booking, customer) {
  const missing = [];
  if (!booking.waiver_signed) missing.push('waiver');
  if (bookingNeedsRentalDocs(booking)) {
    const hasLicense = Boolean(
      String(booking.license_url || customer?.id_document_url || '').trim()
    );
    const insuranceOk =
      booking.insurance_status === 'verified' ||
      booking.insurance_status === 'submitted' ||
      Boolean(String(booking.insurance_url || customer?.insurance_proof_url || '').trim());
    if (!hasLicense) missing.push('license/ID');
    if (!insuranceOk) missing.push('Buoy rental insurance');
  }
  return missing;
}

/**
 * @param {object} opts
 * @param {import('@supabase/supabase-js').SupabaseClient} opts.supabase
 * @param {import('resend').Resend | null} opts.resend
 * @param {string} opts.resendFrom
 */
async function runWaiversDocsReminders(opts) {
  const { supabase, resend, resendFrom } = opts;
  const out = { processed: 0, sent: 0, errors: [] };

  if (!supabase) {
    out.errors.push('no_supabase');
    return out;
  }

  const nowIso = new Date().toISOString();
  const { data: rows, error: fetchErr } = await supabase
    .from('bookings')
    .select(
      'id, start_time, status, waiver_signed, license_url, insurance_url, insurance_status, captain_included, waivers_docs_reminder_sent_at, customer_id'
    )
    .in('status', ['pending', 'pending_verification', 'confirmed'])
    .is('waivers_docs_reminder_sent_at', null)
    .not('status', 'eq', 'cancelled')
    .gt('start_time', nowIso)
    .limit(200);

  if (fetchErr) {
    out.errors.push(fetchErr.message || 'fetch');
    return out;
  }

  const base = publicAppBase();

  for (const row of rows || []) {
    out.processed += 1;
    const { data: customer, error: cErr } = await supabase
      .from('customers')
      .select('email, phone, id_document_url, insurance_proof_url')
      .eq('id', row.customer_id)
      .maybeSingle();

    if (cErr || !customer?.email) {
      out.errors.push(`no_customer:${row.id}`);
      continue;
    }

    const missing = missingDocLabels(row, customer);
    if (missing.length === 0) continue;

    const statusUrl = waiversInsuranceUrl({ bookingId: row.id });
    const email = String(customer.email).trim();
    const phone = String(customer.phone || '').trim();
    const missingText = missing.join(', ');

    const subject = 'Complete your pre-trip requirements — Launch Zone Charters';
    const textBody = `Launch Zone Charters reminder:

Please complete before your trip: ${missingText}.

Finish here: ${statusUrl}`;

    let anyDelivery = false;

    if (resend && resendFrom) {
      const html = `
        <p>Please complete before your trip: <strong>${escapeHtml(missingText)}</strong>.</p>
        <p><a href="${escapeHtml(statusUrl)}">Open Waivers &amp; Insurance</a></p>
        <p><small>Booking ID: ${escapeHtml(row.id)}</small></p>
      `;
      const r = await resend.emails.send({ from: resendFrom, to: email, subject, text: textBody, html });
      if (r.error) out.errors.push(`email:${row.id}:${r.error.message || 'resend'}`);
      else {
        anyDelivery = true;
        await bookingCommunications.logAutomatedCommunication(supabase, {
          bookingId: row.id,
          channel: 'email',
          messageType: 'automated_waivers_docs_reminder',
          recipient: email,
          subject,
          body: textBody,
          providerMessageId: r.data?.id || null,
        });
      }
    }

    const smsRes = await sendSMS(phone, textBody);
    if (smsRes.ok) anyDelivery = true;
    else if (!smsRes.skipped && phone) out.errors.push(`sms:${row.id}`);

    if (anyDelivery) {
      const patch = { waivers_docs_reminder_sent_at: new Date().toISOString() };
      const { error: uErr } = await supabase.from('bookings').update(patch).eq('id', row.id);
      if (uErr) out.errors.push(`db:${row.id}:${uErr.message}`);
      else out.sent += 1;
    }
  }

  return out;
}

/**
 * Remind manual pre-trip submitters who still owe insurance proof (rentals).
 */
async function runPreTripInsuranceReminders(opts) {
  const { supabase, resend, resendFrom } = opts;
  const out = { processed: 0, sent: 0, errors: [] };

  if (!supabase) return out;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error: fetchErr } = await supabase
    .from('pre_trip_submissions')
    .select('id, email, phone, trip_type, insurance_status, insurance_url, docs_reminder_sent_at, admin_status')
    .eq('admin_status', 'pending')
    .eq('insurance_status', 'pending')
    .is('insurance_url', null)
    .neq('trip_type', 'captain_charter')
    .is('docs_reminder_sent_at', null)
    .lt('created_at', cutoff)
    .limit(100);

  if (fetchErr) {
    out.errors.push(fetchErr.message || 'fetch');
    return out;
  }

  for (const row of rows || []) {
    out.processed += 1;
    const statusUrl = waiversInsuranceUrl({ submissionId: row.id });
    const email = String(row.email || '').trim();
    const phone = String(row.phone || '').trim();
    const subject = 'Buoy insurance still needed — Launch Zone Charters';
    const textBody = `Launch Zone Charters: Please upload your Buoy rental insurance proof when ready.\n\n${statusUrl}`;

    let anyDelivery = false;
    if (resend && resendFrom && email) {
      const html = `<p>Please upload your Buoy rental insurance proof when ready.</p><p><a href="${escapeHtml(statusUrl)}">View status</a></p>`;
      const r = await resend.emails.send({ from: resendFrom, to: email, subject, text: textBody, html });
      if (!r.error) anyDelivery = true;
      else out.errors.push(`email:${row.id}`);
    }
    const smsRes = await sendSMS(phone, textBody);
    if (smsRes.ok) anyDelivery = true;

    if (anyDelivery) {
      await supabase
        .from('pre_trip_submissions')
        .update({ docs_reminder_sent_at: new Date().toISOString() })
        .eq('id', row.id);
      out.sent += 1;
    }
  }

  return out;
}

module.exports = { runWaiversDocsReminders, runPreTripInsuranceReminders };
