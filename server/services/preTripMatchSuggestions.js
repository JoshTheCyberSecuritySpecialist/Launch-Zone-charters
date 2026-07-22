const { normalizeEmailParam } = require('./bookingAccess');
const { normalizePhoneDigits, phoneDigitsMatch } = require('./preTripSubmissionGuard');

function logMatchDiagnostics(submissionId, diagnostics) {
  console.log(
    `[pre-trip-match] submission=${submissionId} suggestions=${diagnostics.total} strategies=${JSON.stringify(diagnostics.strategies)}`
  );
  if (diagnostics.total === 0) {
    console.log(
      `[pre-trip-match] submission=${submissionId} no_matches submission_fields=${JSON.stringify(diagnostics.submission_fields)} hints=${JSON.stringify(diagnostics.hints)}`
    );
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
async function findPreTripMatchSuggestions(supabase, submission, manualQuery = '') {
  const suggestions = [];
  const seen = new Set();
  const strategies = {
    groupon: 0,
    email: 0,
    phone: 0,
    name: 0,
    date: 0,
    groupon_customer: 0,
  };
  const hints = [];

  const pushCandidate = (booking, customer, boat, reason) => {
    if (!booking?.id || seen.has(booking.id)) return;
    seen.add(booking.id);
    suggestions.push({
      id: booking.id,
      customer_name: customer?.full_name || null,
      email: customer?.email || null,
      start_time: booking.start_time,
      promo_code: booking.promo_code || null,
      status: booking.status,
      boat_name: boat?.name || null,
      match_reason: reason,
    });
  };

  const query = String(manualQuery || '').trim();
  const submissionEmail = normalizeEmailParam(submission.email);
  const submissionPhone = String(submission.phone || '').trim();
  const submissionName = String(submission.customer_name || '').trim();
  const phoneDigits = normalizePhoneDigits(submissionPhone);

  const diagnostics = {
    total: 0,
    strategies,
    submission_fields: {
      email: submissionEmail || null,
      phone_digits: phoneDigits || null,
      name: submissionName || null,
      requested_trip_date: submission.requested_trip_date || null,
      groupon_code: submission.groupon_code || null,
      manual_query: query || null,
    },
    hints,
  };

  const groupon = String(submission.groupon_code || '').trim().toUpperCase();
  if (groupon) {
    const { data: promoBookings, error } = await supabase
      .from('bookings')
      .select('id, customer_id, start_time, status, promo_code, boats(name)')
      .ilike('promo_code', groupon)
      .not('status', 'eq', 'cancelled')
      .order('start_time', { ascending: false })
      .limit(5);

    if (error) {
      hints.push(`groupon_query_failed:${error.message}`);
    } else {
      for (const b of promoBookings || []) {
        const { data: customer } = await supabase
          .from('customers')
          .select('full_name, email, phone')
          .eq('id', b.customer_id)
          .maybeSingle();
        const boat = Array.isArray(b.boats) ? b.boats[0] : b.boats;
        pushCandidate(b, customer, boat, 'Groupon code match');
      }
      strategies.groupon = (promoBookings || []).length;
      if (strategies.groupon === 0) hints.push('groupon_code_no_booking');
    }
  }

  const emailNorm = normalizeEmailParam(query.includes('@') ? query : query || submission.email);
  if (emailNorm) {
    const safeEmail = emailNorm.replace(/[%_]/g, '');
    const { data: customers, error } = await supabase
      .from('customers')
      .select('id, full_name, email, phone')
      .ilike('email', `%${safeEmail}%`)
      .limit(12);

    if (error) {
      hints.push(`email_query_failed:${error.message}`);
    } else if (!customers?.length) {
      hints.push('email_no_customer');
    } else {
      for (const c of customers || []) {
        const { data: bookings } = await supabase
          .from('bookings')
          .select('id, customer_id, start_time, status, promo_code, boats(name)')
          .eq('customer_id', c.id)
          .not('status', 'eq', 'cancelled')
          .order('start_time', { ascending: false })
          .limit(5);

        for (const b of bookings || []) {
          const boat = Array.isArray(b.boats) ? b.boats[0] : b.boats;
          const reason =
            submissionPhone && phoneDigitsMatch(c.phone, submissionPhone)
              ? 'Email and phone match'
              : query
                ? 'Email search match'
                : 'Email match';
          pushCandidate(b, c, boat, reason);
        }
      }
      strategies.email = customers?.length || 0;
    }
  } else {
    hints.push('email_missing');
  }

  const phoneToMatch = query && !query.includes('@') && normalizePhoneDigits(query).length >= 10 ? query : submissionPhone;
  const matchDigits = normalizePhoneDigits(phoneToMatch);
  if (matchDigits.length >= 10) {
    const last10 = matchDigits.slice(-10);
    const { data: customers, error } = await supabase
      .from('customers')
      .select('id, full_name, email, phone')
      .ilike('phone', `%${last10}%`)
      .limit(12);

    if (error) {
      hints.push(`phone_query_failed:${error.message}`);
    } else if (!customers?.length) {
      hints.push('phone_no_customer');
    } else {
      for (const c of customers || []) {
        if (!phoneDigitsMatch(c.phone, phoneToMatch)) continue;
        const { data: bookings } = await supabase
          .from('bookings')
          .select('id, customer_id, start_time, status, promo_code, boats(name)')
          .eq('customer_id', c.id)
          .not('status', 'eq', 'cancelled')
          .order('start_time', { ascending: false })
          .limit(5);

        for (const b of bookings || []) {
          const boat = Array.isArray(b.boats) ? b.boats[0] : b.boats;
          pushCandidate(b, c, boat, query ? 'Phone search match' : 'Phone match');
        }
      }
      strategies.phone = customers?.length || 0;
    }
  } else if (!query) {
    hints.push('phone_missing_or_short');
  }

  const nameQuery =
    query && !query.includes('@') && normalizePhoneDigits(query).length < 10
      ? query
      : submissionName;
  if (nameQuery.length >= 3 && !nameQuery.includes('@')) {
    const safeName = nameQuery.replace(/[%_]/g, '').slice(0, 80);
    const { data: customers, error } = await supabase
      .from('customers')
      .select('id, full_name, email, phone')
      .ilike('full_name', `%${safeName}%`)
      .limit(8);

    if (error) {
      hints.push(`name_query_failed:${error.message}`);
    } else if (!customers?.length) {
      hints.push('name_no_customer');
    } else {
      for (const c of customers || []) {
        const { data: bookings } = await supabase
          .from('bookings')
          .select('id, customer_id, start_time, status, promo_code, boats(name)')
          .eq('customer_id', c.id)
          .not('status', 'eq', 'cancelled')
          .order('start_time', { ascending: false })
          .limit(3);

        for (const b of bookings || []) {
          const boat = Array.isArray(b.boats) ? b.boats[0] : b.boats;
          pushCandidate(b, c, boat, query ? 'Name search match' : 'Name match');
        }
      }
      strategies.name = customers?.length || 0;
    }
  } else if (!query && submissionName.length < 3) {
    hints.push('name_missing_or_short');
  }

  if (submission.requested_trip_date) {
    const anchor = new Date(submission.requested_trip_date);
    if (Number.isFinite(anchor.getTime())) {
      const windowStart = new Date(anchor);
      windowStart.setDate(windowStart.getDate() - 3);
      const windowEnd = new Date(anchor);
      windowEnd.setDate(windowEnd.getDate() + 3);

      const { data: dateBookings, error } = await supabase
        .from('bookings')
        .select('id, customer_id, start_time, status, promo_code, boats(name)')
        .gte('start_time', windowStart.toISOString())
        .lte('start_time', windowEnd.toISOString())
        .not('status', 'eq', 'cancelled')
        .order('start_time', { ascending: true })
        .limit(12);

      if (error) {
        hints.push(`date_query_failed:${error.message}`);
      } else if (!dateBookings?.length) {
        hints.push('date_window_no_bookings');
      } else {
        for (const b of dateBookings || []) {
          const { data: customer } = await supabase
            .from('customers')
            .select('full_name, email, phone')
            .eq('id', b.customer_id)
            .maybeSingle();
          const boat = Array.isArray(b.boats) ? b.boats[0] : b.boats;
          const sameEmail =
            submissionEmail &&
            customer?.email &&
            normalizeEmailParam(customer.email) === submissionEmail;
          const samePhone =
            submissionPhone && customer?.phone && phoneDigitsMatch(customer.phone, submissionPhone);
          const reason =
            sameEmail && samePhone
              ? 'Trip date + email + phone match'
              : sameEmail
                ? 'Trip date + email match'
                : samePhone
                  ? 'Trip date + phone match'
                  : 'Trip date match';
          pushCandidate(b, customer, boat, reason);
        }
        strategies.date = dateBookings?.length || 0;
      }
    } else {
      hints.push('requested_trip_date_invalid');
    }
  } else if (!query) {
    hints.push('requested_trip_date_missing');
  }

  if (groupon && suggestions.length === 0) {
    const emailForGroupon = normalizeEmailParam(submission.email);
    if (emailForGroupon) {
      const { data: customers } = await supabase
        .from('customers')
        .select('id, full_name, email, phone')
        .ilike('email', `%${emailForGroupon.replace(/[%_]/g, '')}%`);

      for (const c of customers || []) {
        const { data: bookings } = await supabase
          .from('bookings')
          .select('id, customer_id, start_time, status, promo_code, boats(name)')
          .eq('customer_id', c.id)
          .not('status', 'eq', 'cancelled')
          .order('start_time', { ascending: false })
          .limit(5);

        for (const b of bookings || []) {
          const promo = String(b.promo_code || '').toUpperCase();
          if (!promo.includes('GROUPON') && !promo.includes('GROUPONFUN')) continue;
          const boat = Array.isArray(b.boats) ? b.boats[0] : b.boats;
          pushCandidate(b, c, boat, 'Groupon customer match');
        }
      }
      strategies.groupon_customer = customers?.length || 0;
    }
  }

  diagnostics.total = suggestions.length;
  logMatchDiagnostics(submission.id, diagnostics);

  return {
    suggestions: suggestions.slice(0, 12),
    diagnostics,
  };
}

module.exports = {
  findPreTripMatchSuggestions,
  logMatchDiagnostics,
};
