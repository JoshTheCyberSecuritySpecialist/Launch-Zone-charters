/**
 * Shop checkout — reuses Stripe Checkout patterns from booking flow.
 * Single product today: Launch Zone Observation Bottle.
 */

const OBSERVATION_BOTTLE_PRODUCT = {
  slug: 'observation-bottle',
  name: 'Launch Zone Observation Bottle',
  brand: 'Launch Zone Charters',
  tagline: 'Catch the Glow. Return the Magic.',
  description:
    'Premium borosilicate observation bottle for brief, responsible viewing of Florida bioluminescent lagoon water. Observe, learn, and return water to the same location.',
  priceUsd: 34.99,
  priceCents: 3499,
  currency: 'usd',
  imagePath: '/images/Launch_Zone_Observation_Bottle.png',
  minQty: 1,
  maxQty: 10,
  route: '/shop/observation-bottle',
  successRoute: '/shop/order-success',
};

const SHOP_ORDER_STATUSES = [
  'pending',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'refunded',
  'cancelled',
];

const SHOP_CHECKOUT_TTL_MS = 35 * 60 * 1000;

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function getPublicBaseUrl() {
  return String(process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || '')
    .trim()
    .replace(/\/$/, '');
}

function normalizeCheckoutBaseUrl(domain) {
  const raw = String(domain || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  if (raw.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(raw)) {
    return `https://${raw.slice('http://'.length)}`;
  }
  return raw;
}

function formatOrderNumber(id) {
  return String(id || '')
    .replace(/-/g, '')
    .slice(0, 8)
    .toUpperCase();
}

function normalizeShopStatus(value) {
  const s = String(value || '')
    .trim()
    .toLowerCase();
  return SHOP_ORDER_STATUSES.includes(s) ? s : null;
}

function shippingPayloadFromSession(session) {
  const shipping = session.shipping_details || session.shipping || null;
  const customer = session.customer_details || null;
  const address = shipping?.address || customer?.address || null;
  const name = String(shipping?.name || customer?.name || '').trim() || null;
  if (!address && !name) {
    return { shipping_name: name, shipping_address: null };
  }
  return {
    shipping_name: name,
    shipping_address: address
      ? {
          line1: address.line1 || null,
          line2: address.line2 || null,
          city: address.city || null,
          state: address.state || null,
          postal_code: address.postal_code || null,
          country: address.country || null,
        }
      : null,
  };
}

function formatShippingAddress(addr) {
  if (!addr || typeof addr !== 'object') return 'Address on file with Stripe';
  const parts = [
    addr.line1,
    addr.line2,
    [addr.city, addr.state, addr.postal_code].filter(Boolean).join(', '),
    addr.country,
  ].filter(Boolean);
  return parts.join('\n') || 'Address on file with Stripe';
}

/**
 * @param {{ stripe: import('stripe').Stripe, supabase: object, quantity?: number }} deps
 */
async function createShopCheckoutSession({ stripe, supabase, quantity: quantityRaw }) {
  if (!stripe) {
    const err = new Error('Stripe not configured');
    err.statusCode = 503;
    throw err;
  }
  const quantity = Math.round(Number(quantityRaw));
  if (
    !Number.isFinite(quantity) ||
    quantity < OBSERVATION_BOTTLE_PRODUCT.minQty ||
    quantity > OBSERVATION_BOTTLE_PRODUCT.maxQty
  ) {
    const err = new Error(`Quantity must be between ${OBSERVATION_BOTTLE_PRODUCT.minQty} and ${OBSERVATION_BOTTLE_PRODUCT.maxQty}.`);
    err.statusCode = 400;
    throw err;
  }

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

  let session;
  try {
    // Match booking checkout shape: no product images (ours is 2.24MB > Stripe 2MB cap).
    session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      expires_at: Math.floor((Date.now() + SHOP_CHECKOUT_TTL_MS) / 1000),
      allow_promotion_codes: true,
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['US'] },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: {
              amount: 0,
              currency: OBSERVATION_BOTTLE_PRODUCT.currency,
            },
            display_name: 'Free standard shipping (United States)',
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 12 },
              maximum: { unit: 'business_day', value: 16 },
            },
          },
        },
      ],
      line_items: [
        {
          price_data: {
            currency: OBSERVATION_BOTTLE_PRODUCT.currency,
            unit_amount: OBSERVATION_BOTTLE_PRODUCT.priceCents,
            product_data: {
              name: OBSERVATION_BOTTLE_PRODUCT.name,
              metadata: {
                brand: OBSERVATION_BOTTLE_PRODUCT.brand,
                product_slug: OBSERVATION_BOTTLE_PRODUCT.slug,
              },
            },
          },
          quantity,
        },
      ],
      success_url: `${domain}${OBSERVATION_BOTTLE_PRODUCT.successRoute}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${domain}${OBSERVATION_BOTTLE_PRODUCT.route}`,
      metadata: {
        order_type: 'shop',
        product_slug: OBSERVATION_BOTTLE_PRODUCT.slug,
        quantity: String(quantity),
      },
    });
    console.info('[shop/create-checkout-session] created', session.id, 'success_url=', `${domain}${OBSERVATION_BOTTLE_PRODUCT.successRoute}`);
  } catch (stripeErr) {
    console.error('[shop/create-checkout-session] Stripe error:', stripeErr?.message || stripeErr);
    const err = new Error(stripeErr?.message || 'Stripe could not create checkout session');
    err.statusCode = 502;
    throw err;
  }

  if (!session?.id || !session?.url) {
    const err = new Error('No checkout URL');
    err.statusCode = 500;
    throw err;
  }

  const { error: insertErr } = await supabase.from('shop_orders').upsert(
    {
      stripe_session_id: session.id,
      quantity,
      status: 'pending',
      product_slug: OBSERVATION_BOTTLE_PRODUCT.slug,
      currency: OBSERVATION_BOTTLE_PRODUCT.currency,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'stripe_session_id' }
  );

  if (insertErr) {
    // Do not expire the Stripe session — payment can still complete; webhook/finalize upserts the row.
    console.error('[shop/create-checkout-session] shop_orders insert failed (checkout proceeds):', insertErr.message);
  }

  return {
    url: session.url,
    sessionId: session.id,
    dbWarning: insertErr?.message || null,
  };
}

/**
 * @param {{ stripe: import('stripe').Stripe, supabase: object, resend: object|null, resendFrom: string, sessionId: string, source?: string }} deps
 */
async function finalizeShopOrderFromSession({
  stripe,
  supabase,
  resend,
  resendFrom,
  sessionId,
  source = 'finalize',
}) {
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

  const { data: existing, error: existingErr } = await supabase
    .from('shop_orders')
    .select('*')
    .eq('stripe_session_id', sid)
    .maybeSingle();
  if (existingErr) {
    const err = new Error(existingErr.message || 'Could not load shop order');
    err.statusCode = 500;
    throw err;
  }

  if (existing?.id && ['paid', 'processing', 'shipped', 'delivered'].includes(String(existing.status))) {
    return {
      orderId: existing.id,
      orderNumber: formatOrderNumber(existing.id),
      email: existing.email,
      alreadyFinalized: true,
    };
  }

  const session = await stripe.checkout.sessions.retrieve(sid, {
    expand: ['payment_intent', 'payment_intent.latest_charge'],
  });

  const orderType = String(session.metadata?.order_type || '').trim().toLowerCase();
  if (orderType !== 'shop') {
    const err = new Error('Not a shop checkout session');
    err.statusCode = 400;
    throw err;
  }

  const paymentStatus = String(session.payment_status || '').toLowerCase();
  if (paymentStatus !== 'paid') {
    const err = new Error(`Checkout session is not paid (status: ${paymentStatus || 'unknown'})`);
    err.statusCode = 409;
    throw err;
  }

  const customer = session.customer_details || {};
  const email = String(customer.email || session.customer_email || '').trim().toLowerCase();
  if (!email) {
    const err = new Error('Checkout session is missing customer email');
    err.statusCode = 422;
    throw err;
  }

  const quantityMeta = Number(session.metadata?.quantity);
  const quantity = Number.isFinite(quantityMeta) && quantityMeta > 0
    ? Math.min(OBSERVATION_BOTTLE_PRODUCT.maxQty, Math.max(1, Math.round(quantityMeta)))
    : existing?.quantity || 1;

  const shipping = shippingPayloadFromSession(session);
  const amountPaid = roundMoney((Number(session.amount_total) || 0) / 100);
  const currency = String(session.currency || OBSERVATION_BOTTLE_PRODUCT.currency).toLowerCase();

  let paymentIntentId = null;
  let chargeId = null;
  if (typeof session.payment_intent === 'object' && session.payment_intent) {
    paymentIntentId = session.payment_intent.id || null;
    chargeId =
      session.payment_intent.latest_charge?.id ||
      (typeof session.payment_intent.latest_charge === 'string'
        ? session.payment_intent.latest_charge
        : null);
  } else if (typeof session.payment_intent === 'string') {
    paymentIntentId = session.payment_intent;
  }

  const updatePayload = {
    stripe_session_id: sid,
    payment_intent_id: paymentIntentId,
    stripe_charge_id: chargeId,
    customer_name: String(customer.name || shipping.shipping_name || '').trim() || null,
    email,
    phone: String(customer.phone || session.customer_details?.phone || '').trim() || null,
    quantity,
    shipping_name: shipping.shipping_name,
    shipping_address: shipping.shipping_address,
    amount_paid: amountPaid,
    currency,
    status: 'paid',
    product_slug: String(session.metadata?.product_slug || OBSERVATION_BOTTLE_PRODUCT.slug),
    updated_at: new Date().toISOString(),
  };

  const { data: orderRow, error: upsertErr } = await supabase
    .from('shop_orders')
    .upsert(updatePayload, { onConflict: 'stripe_session_id' })
    .select('*')
    .single();

  if (upsertErr || !orderRow) {
    const err = new Error(upsertErr?.message || 'Could not save shop order');
    err.statusCode = 500;
    throw err;
  }

  if (!orderRow.confirmation_email_sent_at) {
    await sendShopOrderConfirmationEmail({
      resend,
      resendFrom,
      order: orderRow,
      publicBaseUrl: getPublicBaseUrl(),
      source,
    }).catch((emailErr) => {
      console.error('[finalizeShopOrderFromSession] confirmation email:', emailErr?.message || emailErr);
    });

    await supabase
      .from('shop_orders')
      .update({
        confirmation_email_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderRow.id)
      .is('confirmation_email_sent_at', null);
  }

  return {
    orderId: orderRow.id,
    orderNumber: formatOrderNumber(orderRow.id),
    email: orderRow.email,
    quantity: orderRow.quantity,
    amountPaid: orderRow.amount_paid,
    alreadyFinalized: false,
  };
}

async function sendShopOrderConfirmationEmail({ resend, resendFrom, order, publicBaseUrl, source }) {
  if (!resend || !resendFrom) {
    console.warn('[shop-order-email] Resend not configured');
    return false;
  }
  const email = String(order.email || '').trim().toLowerCase();
  if (!email) return false;

  const domain = publicBaseUrl || getPublicBaseUrl();
  const orderNumber = formatOrderNumber(order.id);
  const customerName = String(order.customer_name || order.shipping_name || 'there').trim();
  const quantity = Number(order.quantity) || 1;
  const total = roundMoney(order.amount_paid);
  const currency = String(order.currency || 'usd').toUpperCase();

  const guideUrl = domain ? `${domain}/bioluminescence` : '/bioluminescence';
  const toursUrl = domain ? `${domain}/bioluminescent-tours` : '/bioluminescent-tours';
  const contactUrl = domain ? `${domain}/contact` : '/contact';

  const subject = `Order confirmed — Launch Zone Observation Bottle (#${orderNumber})`;
  const text = [
    `Hi ${customerName},`,
    '',
    'Thank you for your order!',
    '',
    `Order number: ${orderNumber}`,
    `Product: ${OBSERVATION_BOTTLE_PRODUCT.name}`,
    `Quantity: ${quantity}`,
    `Total paid: $${total.toFixed(2)} ${currency}`,
    '',
    'This product is made to order. Please allow approximately 12–16 business days for processing and delivery within the United States.',
    'Tracking information will be emailed once your order ships.',
    '',
    `Shipping to:\n${order.shipping_name || customerName}\n${formatShippingAddress(order.shipping_address)}`,
    '',
    'Helpful links:',
    `Florida bioluminescence guide: ${guideUrl}`,
    `Book a bioluminescence tour: ${toursUrl}`,
    `Contact us: ${contactUrl}`,
    '',
    'Observe. Learn. Return.',
    '— Launch Zone Charters',
    '',
    `(Confirmation source: ${source || 'checkout'})`,
  ].join('\n');

  await resend.emails.send({
    from: resendFrom,
    to: email,
    subject,
    text,
  });

  console.log('[shop-order-email] sent', email, orderNumber);
  return true;
}

async function getShopOrderStatus(supabase, sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { status: 'error', error: 'sessionId is required' };

  const { data: order, error } = await supabase
    .from('shop_orders')
    .select('id, status, email, quantity, amount_paid, currency, confirmation_email_sent_at')
    .eq('stripe_session_id', sid)
    .maybeSingle();

  if (error) {
    return { status: 'error', error: error.message };
  }
  if (!order?.id) {
    return { status: 'pending' };
  }
  if (['paid', 'processing', 'shipped', 'delivered'].includes(String(order.status))) {
    return {
      status: 'confirmed',
      orderId: order.id,
      orderNumber: formatOrderNumber(order.id),
      email: order.email,
      quantity: order.quantity,
      amountPaid: order.amount_paid,
      currency: order.currency,
      confirmationEmailSent: Boolean(order.confirmation_email_sent_at),
    };
  }
  return { status: String(order.status || 'pending'), orderId: order.id };
}

module.exports = {
  OBSERVATION_BOTTLE_PRODUCT,
  SHOP_ORDER_STATUSES,
  SHOP_CHECKOUT_TTL_MS,
  formatOrderNumber,
  normalizeShopStatus,
  getPublicBaseUrl,
  createShopCheckoutSession,
  finalizeShopOrderFromSession,
  sendShopOrderConfirmationEmail,
  getShopOrderStatus,
};
