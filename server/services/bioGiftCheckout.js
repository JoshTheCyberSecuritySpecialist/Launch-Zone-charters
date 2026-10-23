/**
 * Bioluminescence gift checkout — Stripe payment without a departure date or capacity hold.
 * Draft + paid payloads live in checkout_drafts until the dedicated gift table (later phase).
 */

const crypto = require('crypto');
const {
  getBioluminescencePackage,
  isDirectBioPackagePricingEnabled,
} = require('../config/bioluminescencePackages');
const { getActiveBioBookingSeason } = require('../config/bioluminescenceSeason');

const BIO_GIFT_MIN_TICKETS = 1;
const BIO_GIFT_MAX_TICKETS = 10;
const BIO_GIFT_CHECKOUT_TTL_MS = 30 * 60 * 1000;
const BIO_GIFT_KIND = 'bio_gift';

function getPublicBaseUrl() {
  return String(process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || '').trim();
}

function normalizeCheckoutBaseUrl(domain) {
  const raw = String(domain || '').trim().replace(/\/$/, '');
  return raw;
}

function cleanText(value, maxLen) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  return text.slice(0, maxLen);
}

function clampTicketQuantity(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return null;
  if (n < BIO_GIFT_MIN_TICKETS || n > BIO_GIFT_MAX_TICKETS) return null;
  return n;
}

function generateGiftTicketCode(seasonYear) {
  const year = Number(seasonYear) || 2027;
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `LZC-${year}-${suffix}`;
}

function parseRecipientMode(raw, ticketQuantity) {
  const mode = String(raw || '').trim().toLowerCase();
  if (ticketQuantity <= 1) return 'same';
  if (mode === 'different') return 'different';
  return 'same';
}

function normalizeTicketRecipient(raw, label) {
  const recipientName = cleanText(raw?.recipientName || raw?.recipient_name, 120);
  if (!recipientName) {
    const err = new Error(`${label}: recipient name is required.`);
    err.statusCode = 400;
    throw err;
  }
  const fromName = cleanText(raw?.fromName || raw?.from_name, 120);
  if (!fromName) {
    const err = new Error(`${label}: from name is required.`);
    err.statusCode = 400;
    throw err;
  }
  const recipientEmailRaw = cleanText(raw?.recipientEmail || raw?.recipient_email, 200);
  const recipientEmail = recipientEmailRaw ? recipientEmailRaw.toLowerCase() : null;
  if (recipientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    const err = new Error(`${label}: recipient email looks invalid.`);
    err.statusCode = 400;
    throw err;
  }
  const giftMessage = cleanText(raw?.giftMessage || raw?.gift_message, 400) || null;
  return {
    recipientName,
    recipientEmail,
    giftMessage,
    fromName,
  };
}

function buildTicketRecipients(body, ticketQuantity, recipientMode) {
  const rawTickets = Array.isArray(body?.tickets) ? body.tickets : null;

  if (recipientMode === 'different') {
    if (!rawTickets || rawTickets.length !== ticketQuantity) {
      const err = new Error(
        `Provide recipient details for each of the ${ticketQuantity} gift tickets.`
      );
      err.statusCode = 400;
      throw err;
    }
    return rawTickets.map((ticket, index) =>
      normalizeTicketRecipient(ticket, `Ticket ${index + 1}`)
    );
  }

  // Same recipient / group — accept tickets[0] or legacy top-level fields.
  const sharedSource =
    rawTickets && rawTickets.length > 0
      ? rawTickets[0]
      : {
          recipientName: body?.recipientName || body?.recipient_name,
          recipientEmail: body?.recipientEmail || body?.recipient_email,
          giftMessage: body?.giftMessage || body?.gift_message,
          fromName: body?.fromName || body?.from_name,
        };
  const shared = normalizeTicketRecipient(sharedSource, 'Gift');
  return Array.from({ length: ticketQuantity }, () => ({ ...shared }));
}

function validateGiftCheckoutBody(body) {
  if (!isDirectBioPackagePricingEnabled()) {
    const err = new Error('Bioluminescence gift checkout is not available right now.');
    err.statusCode = 503;
    throw err;
  }

  const packageId = cleanText(body?.packageId || body?.package_id, 40);
  let pkg;
  try {
    pkg = getBioluminescencePackage(packageId);
  } catch (e) {
    const err = new Error(e.message || 'Invalid bioluminescence package.');
    err.statusCode = 400;
    throw err;
  }

  const ticketQuantity = clampTicketQuantity(body?.ticketQuantity ?? body?.ticket_quantity);
  if (ticketQuantity == null) {
    const err = new Error(
      `Ticket quantity must be between ${BIO_GIFT_MIN_TICKETS} and ${BIO_GIFT_MAX_TICKETS}.`
    );
    err.statusCode = 400;
    throw err;
  }

  const recipientMode = parseRecipientMode(
    body?.recipientMode || body?.recipient_mode,
    ticketQuantity
  );
  const tickets = buildTicketRecipients(body, ticketQuantity, recipientMode);

  const purchaser = body?.purchaser && typeof body.purchaser === 'object' ? body.purchaser : {};
  const purchaserName = cleanText(purchaser.fullName || purchaser.full_name || body?.purchaserName, 120);
  const purchaserEmail = cleanText(purchaser.email || body?.purchaserEmail, 200).toLowerCase();
  const purchaserPhone = cleanText(purchaser.phone || body?.purchaserPhone, 40);
  if (!purchaserName) {
    const err = new Error('Purchaser name is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!purchaserEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(purchaserEmail)) {
    const err = new Error('Purchaser email is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!purchaserPhone || purchaserPhone.replace(/\D/g, '').length < 10) {
    const err = new Error('Purchaser phone is required.');
    err.statusCode = 400;
    throw err;
  }

  const season = getActiveBioBookingSeason();
  const seasonYear = season?.year || 2027;
  const unitPriceCents = Number(pkg.priceCents);
  const totalCents = unitPriceCents * ticketQuantity;
  const first = tickets[0];

  return {
    pkg,
    packageId: pkg.id,
    packageName: pkg.name,
    ticketQuantity,
    recipientMode,
    tickets,
    unitPriceCents,
    totalCents,
    seasonYear,
    seasonStart: season?.bookingStart || '2027-06-01',
    seasonEnd: season?.bookingEnd || '2027-10-31',
    // Summary fields (first ticket / same-mode) for Stripe metadata + legacy readers
    recipientName: first.recipientName,
    recipientEmail: first.recipientEmail,
    giftMessage: first.giftMessage,
    fromName: first.fromName,
    purchaser: {
      fullName: purchaserName,
      email: purchaserEmail,
      phone: purchaserPhone,
    },
  };
}

async function createBioGiftCheckoutSession({ stripe, supabase, body }) {
  if (!stripe) {
    const err = new Error('Stripe not configured');
    err.statusCode = 503;
    throw err;
  }

  const gift = validateGiftCheckoutBody(body);
  const domain = normalizeCheckoutBaseUrl(getPublicBaseUrl());
  if (!domain) {
    const err = new Error('APP_PUBLIC_URL or FRONTEND_URL must be configured for Stripe redirects.');
    err.statusCode = 503;
    throw err;
  }
  if (!domain.startsWith('https://') && !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(domain)) {
    const err = new Error('APP_PUBLIC_URL must use HTTPS for live Stripe Checkout.');
    err.statusCode = 503;
    throw err;
  }

  const lineLabel =
    gift.ticketQuantity === 1
      ? `${gift.packageName} — Gift ticket`
      : `${gift.packageName} — Gift tickets (×${gift.ticketQuantity})`;

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: gift.purchaser.email,
      expires_at: Math.floor((Date.now() + BIO_GIFT_CHECKOUT_TTL_MS) / 1000),
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: gift.unitPriceCents,
            product_data: {
              name: lineLabel,
              description: `No date required. Valid ${gift.seasonStart} – ${gift.seasonEnd}. Recipient chooses later.`,
              metadata: {
                order_type: BIO_GIFT_KIND,
                pricing_package_id: gift.packageId,
              },
            },
          },
          quantity: gift.ticketQuantity,
        },
      ],
      success_url: `${domain}/booking/gift/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${domain}/booking/gift?package=${encodeURIComponent(gift.packageId)}`,
      metadata: {
        order_type: BIO_GIFT_KIND,
        pricing_package_id: gift.packageId,
        ticket_quantity: String(gift.ticketQuantity),
        recipient_mode: gift.recipientMode,
        season_year: String(gift.seasonYear),
        recipient_name: gift.recipientName.slice(0, 40),
        from_name: gift.fromName.slice(0, 40),
        purchaser_email: gift.purchaser.email,
      },
    });
  } catch (stripeErr) {
    console.error('[bio-gift/create-checkout] Stripe error:', stripeErr?.message || stripeErr);
    const err = new Error(stripeErr?.message || 'Stripe could not create checkout session');
    err.statusCode = 502;
    throw err;
  }

  if (!session?.id || !session?.url) {
    const err = new Error('No checkout URL');
    err.statusCode = 500;
    throw err;
  }

  const draftPayload = {
    kind: BIO_GIFT_KIND,
    status: 'incomplete',
    packageId: gift.packageId,
    packageName: gift.packageName,
    guestCount:
      String(gift.packageId) === 'bio_private'
        ? Number(gift.pkg.maxGuests) || 5
        : Number(gift.pkg.guestCount) || 1,
    ticketQuantity: gift.ticketQuantity,
    recipientMode: gift.recipientMode,
    tickets: gift.tickets.map((ticket, index) => ({
      index: index + 1,
      recipientName: ticket.recipientName,
      recipientEmail: ticket.recipientEmail,
      giftMessage: ticket.giftMessage,
      fromName: ticket.fromName,
      code: null,
    })),
    unitPriceCents: gift.unitPriceCents,
    totalCents: gift.totalCents,
    seasonYear: gift.seasonYear,
    seasonStart: gift.seasonStart,
    seasonEnd: gift.seasonEnd,
    recipientName: gift.recipientName,
    recipientEmail: gift.recipientEmail,
    giftMessage: gift.giftMessage,
    fromName: gift.fromName,
    purchaser: gift.purchaser,
    capacityConsumed: false,
    departureDate: null,
    ticketCodes: null,
    paidAt: null,
  };

  const { error: draftErr } = await supabase.from('checkout_drafts').upsert(
    {
      stripe_session_id: session.id,
      payload: draftPayload,
    },
    { onConflict: 'stripe_session_id' }
  );

  if (draftErr) {
    console.error('[bio-gift/create-checkout] checkout_drafts:', draftErr.message);
    await stripe.checkout.sessions.expire(session.id).catch(() => {});
    const err = new Error('Could not start gift checkout. Please try again.');
    err.statusCode = 500;
    throw err;
  }

  return {
    url: session.url,
    sessionId: session.id,
  };
}

function resolveGuestCountForPackage(packageId) {
  try {
    const pkg = getBioluminescencePackage(packageId);
    if (String(pkg.id) === 'bio_private') {
      return Number(pkg.maxGuests) || 5;
    }
    return Number(pkg.guestCount) || 1;
  } catch {
    return null;
  }
}

function publicGiftResult(payload, { alreadyFinalized = false } = {}) {
  const packageId = payload?.packageId || null;
  const guestCount =
    payload?.guestCount != null ? Number(payload.guestCount) : resolveGuestCountForPackage(packageId);
  const tickets = Array.isArray(payload?.tickets)
    ? payload.tickets.map((ticket, index) => ({
        index: ticket.index || index + 1,
        code: ticket.code || (Array.isArray(payload.ticketCodes) ? payload.ticketCodes[index] : null),
        recipientName: ticket.recipientName || null,
        recipientEmail: ticket.recipientEmail || null,
        giftMessage: ticket.giftMessage || null,
        fromName: ticket.fromName || null,
      }))
    : [];
  return {
    status: payload?.status === 'paid' ? 'confirmed' : String(payload?.status || 'pending'),
    packageName: payload?.packageName || null,
    packageId,
    guestCount,
    ticketQuantity: payload?.ticketQuantity || null,
    recipientMode: payload?.recipientMode || 'same',
    ticketCodes: Array.isArray(payload?.ticketCodes) ? payload.ticketCodes : tickets.map((t) => t.code).filter(Boolean),
    tickets,
    recipientName: payload?.recipientName || null,
    fromName: payload?.fromName || null,
    seasonYear: payload?.seasonYear || null,
    seasonStart: payload?.seasonStart || null,
    seasonEnd: payload?.seasonEnd || null,
    purchaserEmail: payload?.purchaser?.email || null,
    ticketEmailSentAt: payload?.ticketEmailSentAt || null,
    alreadyFinalized,
  };
}

async function finalizeBioGiftCheckoutFromSession({ stripe, supabase, sessionId, source = 'finalize' }) {
  const sid = String(sessionId || '').trim();
  if (!sid) {
    const err = new Error('sessionId is required');
    err.statusCode = 400;
    throw err;
  }
  if (!stripe) {
    const err = new Error('Stripe not configured');
    err.statusCode = 503;
    throw err;
  }

  const { data: draftRow, error: draftErr } = await supabase
    .from('checkout_drafts')
    .select('stripe_session_id, payload')
    .eq('stripe_session_id', sid)
    .maybeSingle();

  if (draftErr) {
    const err = new Error(draftErr.message || 'Could not load gift checkout');
    err.statusCode = 500;
    throw err;
  }

  const existingPayload =
    draftRow?.payload && typeof draftRow.payload === 'object' ? draftRow.payload : null;

  if (existingPayload?.kind === BIO_GIFT_KIND && existingPayload.status === 'paid') {
    return publicGiftResult(existingPayload, { alreadyFinalized: true });
  }

  const session = await stripe.checkout.sessions.retrieve(sid);
  const orderType = String(session?.metadata?.order_type || '').trim().toLowerCase();
  if (orderType !== BIO_GIFT_KIND && existingPayload?.kind !== BIO_GIFT_KIND) {
    const err = new Error('This checkout session is not a bioluminescence gift purchase.');
    err.statusCode = 400;
    throw err;
  }

  const paid =
    session.payment_status === 'paid' ||
    session.status === 'complete' ||
    String(session.payment_status || '').toLowerCase() === 'no_payment_required';

  if (!paid) {
    const err = new Error('Payment is not complete yet.');
    err.statusCode = 402;
    throw err;
  }

  const base =
    existingPayload && existingPayload.kind === BIO_GIFT_KIND
      ? existingPayload
      : {
          kind: BIO_GIFT_KIND,
          packageId: session.metadata?.pricing_package_id || null,
          ticketQuantity: Number(session.metadata?.ticket_quantity || 1),
          seasonYear: Number(session.metadata?.season_year || 2027),
          recipientName: session.metadata?.recipient_name || null,
          fromName: session.metadata?.from_name || null,
          purchaser: {
            email: session.customer_details?.email || session.metadata?.purchaser_email || null,
          },
          capacityConsumed: false,
          departureDate: null,
        };

  let pkgName = base.packageName;
  let unitPriceCents = base.unitPriceCents;
  try {
    if (base.packageId) {
      const pkg = getBioluminescencePackage(base.packageId);
      pkgName = pkg.name;
      unitPriceCents = pkg.priceCents;
    }
  } catch {
    /* keep draft values */
  }

  const qty = clampTicketQuantity(base.ticketQuantity) || 1;
  const seasonYear = Number(base.seasonYear) || 2027;
  const recipientMode = parseRecipientMode(base.recipientMode, qty);

  let baseTickets = Array.isArray(base.tickets) ? base.tickets : [];
  if (baseTickets.length !== qty) {
    const shared = {
      recipientName: base.recipientName || null,
      recipientEmail: base.recipientEmail || null,
      giftMessage: base.giftMessage || null,
      fromName: base.fromName || null,
    };
    baseTickets = Array.from({ length: qty }, (_, index) => ({
      index: index + 1,
      ...shared,
      code: null,
    }));
  }

  const existingCodes = Array.isArray(base.ticketCodes) ? base.ticketCodes : [];
  const ticketCodes =
    existingCodes.length === qty
      ? existingCodes
      : Array.from({ length: qty }, (_, index) => {
          const existing = baseTickets[index]?.code;
          return existing || generateGiftTicketCode(seasonYear);
        });

  // Unique code per ticket — never one shared redemption for multiple gifts.
  const uniqueCodes = [];
  const seen = new Set();
  for (let i = 0; i < qty; i += 1) {
    let code = ticketCodes[i];
    while (!code || seen.has(code)) {
      code = generateGiftTicketCode(seasonYear);
    }
    seen.add(code);
    uniqueCodes.push(code);
  }

  const tickets = baseTickets.map((ticket, index) => ({
    index: index + 1,
    recipientName: ticket.recipientName || base.recipientName || null,
    recipientEmail: ticket.recipientEmail || null,
    giftMessage: ticket.giftMessage || null,
    fromName: ticket.fromName || base.fromName || null,
    code: uniqueCodes[index],
  }));

  const paidPayload = {
    ...base,
    kind: BIO_GIFT_KIND,
    status: 'paid',
    packageName: pkgName || base.packageName || 'Bioluminescence Gift',
    unitPriceCents: unitPriceCents || base.unitPriceCents || null,
    totalCents:
      base.totalCents ||
      (unitPriceCents ? unitPriceCents * qty : null),
    ticketQuantity: qty,
    recipientMode,
    tickets,
    seasonYear,
    ticketCodes: uniqueCodes,
    capacityConsumed: false,
    departureDate: null,
    paidAt: new Date().toISOString(),
    finalizedSource: source,
    stripePaymentIntentId:
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id || null,
  };

  const { error: upsertErr } = await supabase.from('checkout_drafts').upsert(
    {
      stripe_session_id: sid,
      payload: paidPayload,
    },
    { onConflict: 'stripe_session_id' }
  );

  if (upsertErr) {
    console.error('[bio-gift/finalize] checkout_drafts:', upsertErr.message);
    const err = new Error('Could not save gift ticket confirmation.');
    err.statusCode = 500;
    throw err;
  }

  console.info(
    '[bio-gift/finalize]',
    sid,
    'tickets=',
    qty,
    'source=',
    source,
    'codes=',
    uniqueCodes.join(',')
  );

  return publicGiftResult(paidPayload, { alreadyFinalized: false });
}

module.exports = {
  BIO_GIFT_KIND,
  BIO_GIFT_MIN_TICKETS,
  BIO_GIFT_MAX_TICKETS,
  createBioGiftCheckoutSession,
  finalizeBioGiftCheckoutFromSession,
  validateGiftCheckoutBody,
  generateGiftTicketCode,
};
