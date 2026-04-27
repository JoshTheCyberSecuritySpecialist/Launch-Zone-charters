/**
 * Launch Zone API: booking confirmation + contact form (Resend + Supabase).
 * From /server: npm install && npm start
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const { Resend } = require('resend');
const supabase = require('./supabaseClient');
const contactSubmission = require('./services/contactSubmission');
const verificationReminder = require('./services/verificationReminder');
const verificationSms = require('./services/verificationSms');
const { getBioConditions } = require('./services/bioluminescenceService');
const { getRocketConditions } = require('./services/rocketService');
const { getLaunchSchedulePreview } = require('./services/rocketScheduleService');
const { getWeeklyForecast } = require('./services/weeklyForecastService');
const { getMarineConditions } = require('./services/marineConditionsService');
const availabilityService = require('./services/availabilityService');
const cron = require('node-cron');
const { runMonitor } = require('./jobs/conditionMonitor');

const stripeSecret = String(process.env.STRIPE_SECRET_KEY || '').trim();
let stripe = null;
if (stripeSecret) {
  try {
    stripe = require('stripe')(stripeSecret);
  } catch (e) {
    console.warn('[stripe] init failed:', e.message);
  }
}
const app = express();
const PORT = process.env.PORT || 3001;
const BIO_SHARED_MIN_GUESTS = 1;
const BIO_SHARED_MAX_GUESTS = 2;
const BIO_SHARED_PER_PERSON = 75;
const ROCKET_SHARED_PER_PERSON = 85;
const SUNSET_SHARED_PER_PERSON = 75;
const SECURITY_DEPOSIT = 300;
const CAPTAIN_HOURLY = 50;
const SUNSET_EXPERIENCE_SURCHARGE = 75;

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function firstForwardedIp(value) {
  if (!value) return '';
  const raw = Array.isArray(value) ? value[0] : String(value);
  const first = raw.split(',')[0]?.trim() || '';
  return first;
}

function requestIpBestEffort(req) {
  const forwarded =
    firstForwardedIp(req.headers['x-forwarded-for']) ||
    firstForwardedIp(req.headers['x-real-ip']) ||
    '';
  const socketIp =
    req.socket?.remoteAddress || req.connection?.remoteAddress || req.ip || '';
  const chosen = (forwarded || socketIp || '').trim();
  return chosen || null;
}

function computeCharterSurcharges({ charterType, date }) {
  const d = new Date(String(date || ''));
  const day = Number.isFinite(d.getTime()) ? d.getDay() : null;
  const month = Number.isFinite(d.getTime()) ? d.getMonth() + 1 : null;
  const isWeekend = day === 5 || day === 6 || day === 0;
  const isRocket = charterType === 'rocket';
  const isBio = charterType === 'bio';
  const isSunset = charterType === 'sunset';
  const isNight = charterType === 'bio';
  const isPeakBioSeason = isBio && month >= 6 && month <= 9;

  return {
    weekendSurcharge: isWeekend ? 75 : 0,
    rocketLaunchSurcharge: isRocket ? (isNight ? 200 : 150) : 0,
    bioTourSurcharge: isBio ? 100 : 0,
    sunsetExperienceSurcharge: isSunset ? SUNSET_EXPERIENCE_SURCHARGE : 0,
    nightExperienceSurcharge: isNight ? 50 : 0,
    peakSeasonSurcharge: isPeakBioSeason ? 50 : 0,
  };
}

function computeExpectedBookingTotals({
  bookingMode,
  rentalType,
  durationHours,
  captainIncluded,
  charterType,
  charterVariant,
  passengerCount,
  date,
  boat,
}) {
  const hours = Math.max(0, Number(durationHours) || 0);
  const captainFee = captainIncluded ? CAPTAIN_HOURLY * hours : 0;
  const hourly = Number(boat?.hourly_rate || 0);
  const halfDay = Number(boat?.half_day_rate || 0);
  const fullDay = Number(boat?.full_day_rate || 0);

  if (bookingMode === 'charter') {
    if (charterVariant === 'shared') {
      const guests = Math.min(BIO_SHARED_MAX_GUESTS, Math.max(1, Number(passengerCount) || 1));
      if (charterType === 'bio') {
        const total = roundMoney(guests * BIO_SHARED_PER_PERSON);
        return {
          mode: 'charter',
          basePrice: total,
          totalPrice: total,
          amountDueToday: total,
        };
      }
      if (charterType === 'rocket') {
        const total = roundMoney(guests * ROCKET_SHARED_PER_PERSON);
        return {
          mode: 'charter',
          basePrice: total,
          totalPrice: total,
          amountDueToday: total,
        };
      }
      if (charterType === 'sunset') {
        const total = roundMoney(guests * SUNSET_SHARED_PER_PERSON);
        return {
          mode: 'charter',
          basePrice: total,
          totalPrice: total,
          amountDueToday: total,
        };
      }
    }

    const basePrice = roundMoney(hourly * hours);
    const s = computeCharterSurcharges({ charterType, date });
    const totalPrice = roundMoney(
      basePrice +
        s.weekendSurcharge +
        s.rocketLaunchSurcharge +
        s.bioTourSurcharge +
        s.sunsetExperienceSurcharge +
        s.nightExperienceSurcharge +
        s.peakSeasonSurcharge
    );
    return {
      mode: 'charter',
      basePrice,
      totalPrice,
      amountDueToday: totalPrice,
      surcharges: s,
    };
  }

  let basePrice = 0;
  if (rentalType === 'hourly') basePrice = hourly * hours;
  if (rentalType === 'half_day') basePrice = halfDay;
  if (rentalType === 'full_day') basePrice = fullDay;
  const totalPrice = roundMoney(basePrice + captainFee + SECURITY_DEPOSIT);
  return {
    mode: 'rental',
    basePrice: roundMoney(basePrice),
    captainFee: roundMoney(captainFee),
    totalPrice,
    amountDueToday: roundMoney(totalPrice * 0.5),
  };
}

/** Unpaid Checkout holds expire after this TTL (server-side). */
const BOOKING_HOLD_TTL_MS = 10 * 60 * 1000;
const SLOT_TAKEN_USER_MESSAGE =
  'This time slot was just booked. Please select another time.';

const BLOCKING_BOOKING_STATUSES = new Set([
  'pending',
  'pending_verification',
  'confirmed',
  'completed',
]);

function bookingRowBlocksSlot(row) {
  if (!row || !BLOCKING_BOOKING_STATUSES.has(String(row.status || ''))) {
    return false;
  }
  const exp = row.expires_at ? new Date(String(row.expires_at)).getTime() : NaN;
  if (String(row.status) === 'pending' && Number.isFinite(exp) && exp < Date.now()) {
    return false;
  }
  return true;
}

function isOverlapConstraintError(err) {
  if (!err) return false;
  if (String(err.code || '') === '23P01') return true;
  const msg = String(err.message || '');
  return /exclusion|overlap|bookings_boat_no_time_overlap/i.test(msg);
}

async function cleanupExpiredBookingHolds() {
  if (!supabaseConfigured) return { deleted: 0 };
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('bookings')
    .delete()
    .eq('status', 'pending')
    .is('stripe_payment_id', null)
    .not('expires_at', 'is', null)
    .lt('expires_at', nowIso)
    .select('id');
  if (error) {
    console.warn('[booking-hold-cleanup]', error.message);
    return { deleted: 0, error };
  }
  const n = Array.isArray(data) ? data.length : 0;
  if (n > 0) {
    console.log('[booking-hold-cleanup] removed', n, 'expired pending hold(s)');
  }
  return { deleted: n };
}

async function assertSlotAvailable(boatId, startIso, endIso, excludeBookingId) {
  const boat = String(boatId || '').trim();
  if (!boat) {
    const err = new Error('Boat id required for availability check');
    err.statusCode = 400;
    throw err;
  }
  const start = String(startIso || '');
  const end = String(endIso || '');
  const { data: rows, error } = await supabase
    .from('bookings')
    .select('id, status, expires_at')
    .eq('boat_id', boat)
    .lt('start_time', end)
    .gt('end_time', start);
  if (error) {
    const err = new Error(error.message || 'Availability check failed');
    err.statusCode = 500;
    throw err;
  }
  const conflict = (rows || []).find((row) => {
    if (excludeBookingId && String(row.id) === String(excludeBookingId)) return false;
    return bookingRowBlocksSlot(row);
  });
  if (conflict) {
    const err = new Error(SLOT_TAKEN_USER_MESSAGE);
    err.statusCode = 409;
    err.code = 'slot_unavailable';
    throw err;
  }
}

async function refundStripeCheckoutSession(session) {
  if (!stripe) return { ok: false, reason: 'no_stripe' };
  const pi = session.payment_intent;
  const piId = typeof pi === 'string' ? pi : pi?.id;
  if (!piId) return { ok: false, reason: 'no_payment_intent' };
  try {
    await stripe.refunds.create({ payment_intent: piId });
    console.warn('[stripe-refund] refunded payment_intent', piId);
    return { ok: true };
  } catch (e) {
    console.error('[stripe-refund]', e.message || e);
    return { ok: false, error: e.message };
  }
}

/** Every incoming request — log method + URL (before routes). */
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  next();
});

const supabaseConfigured = Boolean(
  String(process.env.SUPABASE_URL || '').trim() &&
    String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
);

/** Captain's Log generator — only one Python run at a time; cleared on spawn close/error. */
let isGenerating = false;

/** True when Supabase HTTP failed (timeout, DNS, reset) — not invalid JWT. */
function isSupabaseNetworkError(err) {
  if (!err) return false;
  const cause = err.cause;
  const code = cause && cause.code ? cause.code : err.code;
  if (
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN'
  ) {
    return true;
  }
  const msg = String(err.message || '').toLowerCase();
  return /fetch failed|network|timeout|socket/i.test(msg);
}

/**
 * auth.getUser with short retries — helps flaky Wi‑Fi / slow DNS to *.supabase.co:443.
 */
async function authGetUserWithRetry(jwt, maxAttempts = 3) {
  let last;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last = await supabase.auth.getUser(jwt);
    if (!last.error && last.data?.user) {
      return last;
    }
    const err = last.error;
    if (!isSupabaseNetworkError(err) || attempt === maxAttempts) {
      return last;
    }
    const delayMs = 500 * attempt;
    console.warn(
      `[admin-auth] getUser attempt ${attempt}/${maxAttempts} failed (${err?.message || 'unknown'}), retry in ${delayMs}ms`
    );
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}

/**
 * Validate Supabase JWT and admins row. Sends response on failure; returns user or null.
 */
async function verifyAdminRequest(req, res) {
  if (!supabaseConfigured) {
    res.status(503).json({ error: 'Server not configured' });
    return null;
  }
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const jwt = m[1].trim();
  const { data: udat, error: authErr } = await authGetUserWithRetry(jwt);
  if (authErr || !udat?.user) {
    if (isSupabaseNetworkError(authErr)) {
      console.error('[admin-auth] Supabase unreachable:', authErr?.cause?.message || authErr?.message);
      res.status(503).json({
        error:
          'Cannot reach Supabase (network timeout). Check internet, firewall, VPN, or try again. Optional: set SUPABASE_CONNECT_TIMEOUT_MS in server/.env',
      });
      return null;
    }
    console.warn('[admin-auth] getUser failed:', authErr?.message || 'no user');
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const { data: admById, error: errById } = await supabase
    .from('admins')
    .select('id')
    .eq('id', udat.user.id)
    .maybeSingle();
  if (!errById && admById) {
    return udat.user;
  }
  const email = (udat.user.email || '').trim();
  if (email) {
    const { data: admByEmail, error: errByEmail } = await supabase
      .from('admins')
      .select('id')
      .ilike('email', email)
      .maybeSingle();
    if (!errByEmail && admByEmail) {
      return udat.user;
    }
  }
  if (errById) {
    console.warn('[admin-auth] admins id lookup:', errById.message);
  }
  res.status(403).json({ error: 'Forbidden' });
  return null;
}

/**
 * Resolve Python executable and args for spawn (no shell).
 * @param {string} projectRoot
 * @returns {{ command: string, args: string[], cwd: string }}
 */
function buildPythonSpawn(projectRoot) {
  let py =
    (process.env.PYTHON_PATH || '').trim() ||
    (process.platform === 'win32' ? 'python' : 'python3');
  if (
    (py.startsWith('"') && py.endsWith('"')) ||
    (py.startsWith("'") && py.endsWith("'"))
  ) {
    py = py.slice(1, -1);
  }
  return {
    command: py,
    args: ['./ai-content/upload.py'],
    cwd: projectRoot,
  };
}

/**
 * Captain's Log pipeline (upload.py). Same spawn + stdout parse as before; returns parsed JSON line.
 * @returns {Promise<object>}
 */
function runPythonScript() {
  return new Promise((resolve, reject) => {
    const projectRoot = path.resolve(__dirname, '..');
    const { command, args, cwd } = buildPythonSpawn(projectRoot);

    console.log('[generate-content] Starting content generation');
    console.log('[generate-content] command:', command, args.join(' '));
    console.log('[generate-content] child cwd:', cwd);
    console.log('[generate-content] server process.cwd():', process.cwd());

    const py = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        // Quieter RSS logs for API runs unless .env sets PIPELINE_VERBOSE=1
        PIPELINE_VERBOSE: process.env.PIPELINE_VERBOSE || '0',
        // Default off: full SEO hub prompts + HTML article fetch (see config.py PIPELINE_FAST).
        // Set PIPELINE_FAST=1 for quicker RSS-only runs when iterating locally.
        PIPELINE_FAST:
          process.env.PIPELINE_FAST !== undefined && process.env.PIPELINE_FAST !== ''
            ? process.env.PIPELINE_FAST
            : '0',
      },
    });

    let stdout = '';
    let stderr = '';

    py.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      console.log('[PYTHON STDOUT]', text);
    });

    py.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      console.error('[PYTHON STDERR]', text);
    });

    py.on('error', (err) => {
      isGenerating = false;
      console.error('[PYTHON SPAWN ERROR]', err);
      reject(err);
    });

    py.on('close', (code, signal) => {
      isGenerating = false;
      console.log('[PYTHON EXIT CODE]', code, signal || '');

      const trimmed = (stdout || '').trim();
      if (!trimmed) {
        console.error('No output from Python');
        reject(
          Object.assign(new Error('No output from Python'), {
            details: stderr || undefined,
          })
        );
        return;
      }

      let jsonStr = trimmed;
      const lines = trimmed.split(/\n/).filter((line) => line.trim().length > 0);
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith('{') && line.endsWith('}')) {
          jsonStr = line;
          break;
        }
      }

      try {
        const parsed = JSON.parse(jsonStr);
        console.log('[PYTHON PARSED]', parsed);

        if (parsed.status === 'error') {
          reject(
            Object.assign(new Error(parsed.error || 'Python reported error'), {
              details: stderr || undefined,
              output: parsed,
            })
          );
          return;
        }

        resolve(parsed);
      } catch (e) {
        console.error('Invalid JSON from Python:', trimmed);
        reject(
          Object.assign(
            new Error(e instanceof Error ? e.message : String(e)),
            { details: trimmed.slice(0, 2000) }
          )
        );
      }
    });
  });
}

const corsOrigins = [
  'http://localhost:5173',
  process.env.FRONTEND_URL,
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : []),
]
  .map((x) => String(x || '').trim())
  .filter(Boolean);

const corsOptions = {
  origin: corsOrigins.length > 0 ? corsOrigins : true,
  credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

async function resolveCustomerEmail(customerId) {
  if (!customerId) return '';
  const { data: cRow } = await supabase
    .from('customers')
    .select('email')
    .eq('id', customerId)
    .maybeSingle();
  return cRow?.email ? String(cRow.email).trim() : '';
}

/**
 * Shared finalization path used by both webhook and success-page API.
 * Idempotent: if a booking already exists for this Stripe session, returns existing booking.
 */
async function finalizeBookingFromSession(sessionId, options = {}) {
  if (!supabaseConfigured) {
    const err = new Error('Server not configured');
    err.statusCode = 503;
    throw err;
  }
  if (!stripe) {
    const err = new Error('Stripe not configured');
    err.statusCode = 503;
    throw err;
  }
  const sid = String(sessionId || '').trim();
  if (!sid) {
    const err = new Error('sessionId is required');
    err.statusCode = 400;
    throw err;
  }

  const session = await stripe.checkout.sessions.retrieve(sid);
  if (!session) {
    const err = new Error('Checkout session not found');
    err.statusCode = 400;
    throw err;
  }

  const stripeSessionId = String(session.id || sid);
  const paymentIntentId = session.payment_intent ? String(session.payment_intent) : '';

  const { data: existingBySession } = await supabase
    .from('bookings')
    .select('id, customer_id')
    .eq('stripe_payment_id', stripeSessionId)
    .maybeSingle();
  if (existingBySession?.id) {
    return {
      bookingId: existingBySession.id,
      email: await resolveCustomerEmail(existingBySession.customer_id),
      alreadyFinalized: true,
    };
  }

  if (paymentIntentId) {
    const { data: existingByPi } = await supabase
      .from('bookings')
      .select('id, customer_id')
      .eq('stripe_payment_id', paymentIntentId)
      .maybeSingle();
    if (existingByPi?.id) {
      return {
        bookingId: existingByPi.id,
        email: await resolveCustomerEmail(existingByPi.customer_id),
        alreadyFinalized: true,
      };
    }
  }

  if (session.payment_status !== 'paid') {
    const err = new Error('Payment not completed');
    err.statusCode = 400;
    throw err;
  }

  const { data: draftRow, error: draftFetchErr } = await supabase
    .from('checkout_drafts')
    .select('payload')
    .eq('stripe_session_id', stripeSessionId)
    .maybeSingle();
  if (draftFetchErr) {
    const err = new Error(draftFetchErr.message || 'Could not load checkout draft');
    err.statusCode = 500;
    throw err;
  }
  const payload = draftRow?.payload;
  if (!payload || typeof payload !== 'object') {
    const err = new Error('Checkout session draft not found or expired');
    err.statusCode = 404;
    throw err;
  }

  const { data: holdRow } = await supabase
    .from('bookings')
    .select('id, expires_at, stripe_checkout_session_id')
    .eq('stripe_checkout_session_id', stripeSessionId)
    .maybeSingle();

  if (holdRow?.expires_at && new Date(String(holdRow.expires_at)).getTime() < Date.now()) {
    await refundStripeCheckoutSession(session);
    await supabase.from('bookings').delete().eq('id', holdRow.id);
    const err = new Error(
      'Your checkout reservation expired before payment cleared. Your card was refunded. Please choose another time.'
    );
    err.statusCode = 409;
    throw err;
  }

  const { customer, booking, waiver, legal } = payload;
  const waiverAccepted = Boolean(waiver?.accepted);
  const waiverSignature = String(waiver?.signature || '').trim();
  const termsAccepted = Boolean(legal?.termsAccepted);
  const damageFeeAcknowledged = Boolean(legal?.damageFeeAcknowledged);
  const signaturePresent = Boolean(legal?.signaturePresent);
  const legalAcceptedAtRaw = String(legal?.legalAcceptedAt || '').trim();
  const legalAcceptedAt = Number.isFinite(new Date(legalAcceptedAtRaw).getTime())
    ? new Date(legalAcceptedAtRaw).toISOString()
    : new Date().toISOString();
  const requestIp = options.requestIp || null;

  if (!termsAccepted || !damageFeeAcknowledged || !waiverAccepted || waiverSignature.length === 0 || !signaturePresent) {
    const err = new Error('Legal acceptance validation failed for this checkout session.');
    err.statusCode = 400;
    throw err;
  }

  const { data: customerRow, error: customerError } = await supabase
    .from('customers')
    .upsert(
      {
        full_name: String(customer.full_name),
        email: String(customer.email),
        phone: String(customer.phone),
        id_document_url: customer.id_document_url || null,
        insurance_proof_url: customer.insurance_proof_url || null,
        sms_opt_in: Boolean(customer.sms_opt_in),
      },
      { onConflict: 'email' }
    )
    .select('id, email')
    .single();
  if (customerError || !customerRow) {
    const err = new Error(customerError?.message || 'Could not save customer');
    err.statusCode = 500;
    throw err;
  }

  const { data: boatRow, error: boatErr } = await supabase
    .from('boats')
    .select('id, hourly_rate, half_day_rate, full_day_rate')
    .eq('id', String(booking.boat_id))
    .maybeSingle();
  if (boatErr) {
    console.warn('[finalizeBookingFromSession] boat lookup:', boatErr.message);
  }
  if (!boatRow) {
    await refundStripeCheckoutSession(session);
    const err = new Error('Boat not found; payment was refunded.');
    err.statusCode = 400;
    throw err;
  }

  const bookingMode = typeof booking.bookingMode === 'string' ? booking.bookingMode.trim().toLowerCase() : '';
  const charterType = typeof booking.charterType === 'string' ? booking.charterType.trim().toLowerCase() : '';
  const charterVariant =
    typeof booking.charterVariant === 'string' ? booking.charterVariant.trim().toLowerCase() : '';
  const passengerCountRaw = Number(booking.passengerCount);
  const passengerCount = Number.isFinite(passengerCountRaw) ? Math.max(1, Math.round(passengerCountRaw)) : 1;

  const expected = computeExpectedBookingTotals({
    bookingMode: bookingMode === 'charter' ? 'charter' : 'rental',
    rentalType: String(booking.rental_type || ''),
    durationHours: Number(booking.duration_hours || 0),
    captainIncluded: Boolean(booking.captain_included),
    charterType,
    charterVariant,
    passengerCount,
    date: booking.start_time,
    boat: boatRow,
  });

  const paidDeposit =
    typeof session.amount_total === 'number'
      ? Math.round((session.amount_total / 100) * 100) / 100
      : Number(booking.deposit_amount || 0);
  const paymentStatus = paidDeposit >= expected.totalPrice ? 'paid' : 'deposit_paid';

  const isCharterBooking = bookingMode === 'charter';
  const sharedGuestOutOfRange =
    ['bio', 'rocket', 'sunset'].includes(charterType) &&
    charterVariant === 'shared' &&
    (passengerCount < BIO_SHARED_MIN_GUESTS || passengerCount > BIO_SHARED_MAX_GUESTS);

  const adminNotesParts = [];
  if (bookingMode) adminNotesParts.push(`Booking mode: ${bookingMode}`);
  if (charterType) adminNotesParts.push(`Charter type: ${charterType}`);
  if (charterVariant) adminNotesParts.push(`Charter variant: ${charterVariant}`);
  adminNotesParts.push(`Passenger count: ${passengerCount}`);
  if (sharedGuestOutOfRange) {
    adminNotesParts.push(
      `Shared tour guest count out of range (${BIO_SHARED_MIN_GUESTS}-${BIO_SHARED_MAX_GUESTS}): ${passengerCount}`
    );
  }
  if (booking.special_requests) {
    adminNotesParts.push(`Special requests: ${String(booking.special_requests).trim()}`);
  }

  const captainFeeStored =
    bookingMode === 'rental' ? roundMoney(expected.captainFee || 0) : Number(booking.captain_fee || 0);
  const basePriceStored = roundMoney(expected.basePrice != null ? expected.basePrice : Number(booking.base_price || 0));

  const bookingInsert = {
    customer_id: customerRow.id,
    boat_id: String(booking.boat_id),
    start_time: booking.start_time,
    end_time: booking.end_time,
    duration_hours: Number(booking.duration_hours || 0),
    rental_type: booking.rental_type,
    captain_included: Boolean(booking.captain_included),
    captain_fee: captainFeeStored,
    base_price: basePriceStored,
    peak_surcharge: Number(booking.peak_surcharge || 0),
    security_deposit: Number(booking.security_deposit || 0),
    total_price: expected.totalPrice,
    deposit_amount: expected.amountDueToday,
    deposit_paid: paidDeposit,
    balance_due: roundMoney(expected.totalPrice - paidDeposit),
    payment_status: paymentStatus,
    status: 'pending_verification',
    is_night_tour: Boolean(booking.is_night_tour),
    is_rocket_tour: Boolean(booking.is_rocket_tour),
    license_status: isCharterBooking ? 'verified' : booking.license_status || 'pending',
    insurance_status: isCharterBooking ? 'verified' : booking.insurance_status || 'pending',
    waiver_signed: waiverAccepted && waiverSignature.length > 0,
    waiver_signed_at: legalAcceptedAt,
    terms_accepted: true,
    damage_fee_acknowledged: true,
    stripe_payment_id: stripeSessionId,
    stripe_checkout_session_id: null,
    expires_at: null,
    admin_notes: adminNotesParts.length > 0 ? adminNotesParts.join('\n') : null,
    license_url: booking.license_url || null,
    insurance_url: booking.insurance_url || null,
  };

  try {
    await assertSlotAvailable(booking.boat_id, booking.start_time, booking.end_time, holdRow?.id || null);
  } catch (slotErr) {
    await refundStripeCheckoutSession(session);
    const err = new Error(slotErr.message || SLOT_TAKEN_USER_MESSAGE);
    err.statusCode = slotErr.statusCode || 409;
    throw err;
  }

  let bookingRow;

  if (holdRow?.id) {
    const { data: updated, error: updErr } = await supabase
      .from('bookings')
      .update(bookingInsert)
      .eq('id', holdRow.id)
      .select('id')
      .single();
    if (updErr || !updated) {
      if (isOverlapConstraintError(updErr)) {
        await refundStripeCheckoutSession(session);
        const err = new Error(SLOT_TAKEN_USER_MESSAGE);
        err.statusCode = 409;
        throw err;
      }
      await refundStripeCheckoutSession(session);
      const err = new Error(updErr?.message || 'Could not confirm booking');
      err.statusCode = 500;
      throw err;
    }
    bookingRow = updated;
  } else {
    const { data: inserted, error: bookingError } = await supabase
      .from('bookings')
      .insert(bookingInsert)
      .select('id')
      .single();
    if (bookingError || !inserted) {
      if (isOverlapConstraintError(bookingError)) {
        await refundStripeCheckoutSession(session);
        const err = new Error(SLOT_TAKEN_USER_MESSAGE);
        err.statusCode = 409;
        throw err;
      }
      await refundStripeCheckoutSession(session);
      const err = new Error(bookingError?.message || 'Could not save booking');
      err.statusCode = 500;
      throw err;
    }
    bookingRow = inserted;
  }

  if (waiverAccepted && waiverSignature.length > 0) {
    const waiverContent = String(
      waiver?.waiverContent || waiver?.content || 'Florida Boating Liability Waiver - Full content stored in terms'
    ).trim();
    const { error: waiverErr } = await supabase.from('waivers').insert({
      booking_id: bookingRow.id,
      customer_id: customerRow.id,
      electronic_signature: waiverSignature,
      signature_date: legalAcceptedAt,
      ip_address: requestIp,
      waiver_content: waiverContent,
      accepted: true,
    });
    if (waiverErr) {
      console.warn('[finalize-checkout-session] waiver insert:', waiverErr.message);
    }
  }

  const { error: delDraftErr } = await supabase
    .from('checkout_drafts')
    .delete()
    .eq('stripe_session_id', stripeSessionId);
  if (delDraftErr) {
    console.warn('[finalizeBookingFromSession] draft delete:', delDraftErr.message);
  }
  return { bookingId: bookingRow.id, email: customerRow.email, alreadyFinalized: false };
}

/** Stripe webhook — raw body required for signature verification (must be before express.json). */
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!stripe || !webhookSecret) {
    console.warn('[stripe-webhook] STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET not set');
    return res.status(503).send('Stripe webhook not configured');
  }
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed', err);
    return res.sendStatus(400);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    try {
      const out = await finalizeBookingFromSession(session.id, { requestIp: null });
      console.log(
        '[stripe-webhook] finalized booking',
        out.bookingId,
        out.alreadyFinalized ? '(idempotent)' : ''
      );
    } catch (err) {
      console.error('[stripe-webhook] finalize:', err.message || err);
    }
  }

  return res.json({ received: true });
});

app.use(express.json());

/**
 * Active fleet for booking UI — service role reads boats (fallback when browser anon fails / empty).
 * GET /api/boats
 */
app.get('/api/boats', async (req, res) => {
  try {
    if (!supabaseConfigured) {
      return res.status(503).json({ error: 'Server not configured' });
    }
    const { data, error } = await supabase
      .from('boats')
      .select('*')
      .eq('is_active', true)
      .order('type', { ascending: false });

    if (error) {
      console.error('[api/boats]', error.message);
      return res.status(500).json({ error: error.message || 'Could not load boats' });
    }
    return res.json({ boats: Array.isArray(data) ? data : [] });
  } catch (err) {
    console.error('[api/boats]', err?.stack || err);
    return res.status(500).json({ error: err?.message || 'Could not load boats' });
  }
});

/**
 * Captain's Log hub — service role when browser anon fetch fails (e.g. CORS/network to Supabase).
 * GET /api/captains-log
 */
app.get('/api/captains-log', async (req, res) => {
  try {
    if (!supabaseConfigured) {
      return res.status(503).json({ error: 'Server not configured' });
    }
    const { data, error } = await supabase
      .from('captains_log')
      .select('id, title, slug, content, image_url, image_alt, category, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api/captains-log]', error.message);
      return res.status(500).json({ error: error.message || 'Could not load Captain’s Log' });
    }
    return res.json({ articles: Array.isArray(data) ? data : [] });
  } catch (err) {
    console.error('[api/captains-log]', err?.stack || err);
    return res.status(500).json({ error: err?.message || 'Could not load Captain’s Log' });
  }
});

/**
 * Calendar-style availability across the active fleet (blocking bookings + blocked_dates per boat).
 * GET /api/availability?from=&to=&durationHours=
 * boatId is optional (legacy clients); ignored for calendar day availability.
 */
app.get('/api/availability', async (req, res) => {
  try {
    if (!supabaseConfigured) {
      return res.status(503).json({ error: 'Server not configured' });
    }
    const boatId = String(req.query.boatId || '').trim();

    const durationHours = Number(req.query.durationHours || 4);
    const stepMinutes = Number(
      req.query.stepMinutes || availabilityService.DEFAULT_STEP_MINUTES
    );
    const openHour = Number(req.query.openHour ?? availabilityService.DEFAULT_OPEN_HOUR);
    const closeHour = Number(req.query.closeHour ?? availabilityService.DEFAULT_CLOSE_HOUR);

    let from = String(req.query.from || '').trim();
    let to = String(req.query.to || '').trim();
    if (!from || !to) {
      const d = availabilityService.defaultFromTo();
      if (!from) from = d.from;
      if (!to) to = d.to;
    }

    const dates = await availabilityService.listDatesAvailability(
      from,
      to,
      durationHours,
      openHour,
      closeHour,
      stepMinutes
    );

    const totalBoats = dates.length > 0 && typeof dates[0].totalBoats === 'number' ? dates[0].totalBoats : 0;

    return res.json({
      ...(boatId ? { boatId } : {}),
      fleetCalendar: true,
      totalBoats,
      timezone: availabilityService.BUSINESS_TZ,
      durationHours,
      openHour,
      closeHour,
      stepMinutes,
      from,
      to,
      dates,
    });
  } catch (err) {
    console.error('[api/availability]', err);
    return res.status(500).json({ error: err.message || 'Availability failed' });
  }
});

/**
 * Available start times for one calendar day (America/New_York by default).
 * GET /api/availability/times?boatId=&date=YYYY-MM-DD&durationHours=
 */
app.get('/api/availability/times', async (req, res) => {
  try {
    if (!supabaseConfigured) {
      return res.status(503).json({ error: 'Server not configured' });
    }
    const boatId = String(req.query.boatId || '').trim();
    const date = String(req.query.date || '').trim();
    if (!boatId) {
      return res.status(400).json({ error: 'boatId is required' });
    }
    if (!date) {
      return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
    }

    const durationHours = Number(req.query.durationHours || 4);
    const stepMinutes = Number(
      req.query.stepMinutes || availabilityService.DEFAULT_STEP_MINUTES
    );
    const openHour = Number(req.query.openHour ?? availabilityService.DEFAULT_OPEN_HOUR);
    const closeHour = Number(req.query.closeHour ?? availabilityService.DEFAULT_CLOSE_HOUR);

    const slots = await availabilityService.listSlotsForDay(
      boatId,
      date,
      durationHours,
      openHour,
      closeHour,
      stepMinutes
    );

    return res.json({
      boatId,
      date,
      timezone: availabilityService.BUSINESS_TZ,
      durationHours,
      slots,
    });
  } catch (err) {
    console.error('[api/availability/times]', err);
    return res.status(500).json({ error: err.message || 'Availability times failed' });
  }
});

/**
 * Pay-first flow: create Stripe Checkout, defer booking insert until success page finalize call.
 * POST body: { customer: {...}, booking: {...}, waiver: {...}, legal: {...} }
 */
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    if (!supabaseConfigured) {
      return res.status(503).json({ error: 'Server not configured' });
    }
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe not configured' });
    }

    await cleanupExpiredBookingHolds();

    const payload = req.body || {};
    const customer = payload.customer || {};
    const booking = payload.booking || {};
    const waiver = payload.waiver || {};
    const legal = payload.legal || {};
    const waiverAccepted = Boolean(waiver?.accepted);
    const waiverSignature = String(waiver?.signature || '').trim();
    const termsAccepted = Boolean(legal?.termsAccepted);
    const damageFeeAcknowledged = Boolean(legal?.damageFeeAcknowledged);
    const legalAcceptedAt = new Date().toISOString();

    if (!customer.full_name || !customer.email || !customer.phone || !booking.boat_id) {
      return res.status(400).json({ error: 'Missing required customer/booking fields' });
    }
    if (!termsAccepted) {
      return res.status(400).json({
        error: 'Terms acceptance is required to continue.',
      });
    }
    if (!waiverAccepted || waiverSignature.length === 0) {
      return res.status(400).json({
        error: 'Waiver acceptance and electronic signature are required to continue.',
      });
    }
    if (!damageFeeAcknowledged) {
      return res.status(400).json({
        error: 'Damage fee acknowledgment is required to continue.',
      });
    }

    const bookingMode = String(booking.bookingMode || '').trim().toLowerCase();
    const charterType = String(booking.charterType || '').trim().toLowerCase();
    const charterVariant = String(booking.charterVariant || '').trim().toLowerCase();
    const isSharedCharter = bookingMode === 'charter' && charterVariant === 'shared';
    const rentalType = String(booking.rental_type || '').trim().toLowerCase();
    const startTime = new Date(String(booking.start_time || ''));
    const endTime = new Date(String(booking.end_time || ''));
    const durationHoursRaw = Number(booking.duration_hours);
    const durationHours = Number.isFinite(durationHoursRaw) ? Number(durationHoursRaw) : NaN;

    if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime())) {
      return res.status(400).json({ error: 'Invalid start or end time.' });
    }
    if (endTime.getTime() <= startTime.getTime()) {
      return res.status(400).json({ error: 'End time must be after start time.' });
    }
    if (!Number.isFinite(durationHours) || durationHours <= 0) {
      return res.status(400).json({ error: 'Invalid duration hours.' });
    }
    if (bookingMode === 'rental' && !['hourly', 'half_day', 'full_day'].includes(rentalType)) {
      return res.status(400).json({ error: 'Invalid rental type.' });
    }

    const computedDurationHours = roundMoney(
      (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60)
    );
    if (Math.abs(computedDurationHours - durationHours) > 0.01) {
      return res.status(400).json({
        error: 'Duration hours do not match selected start and end times.',
      });
    }

    const passengerCountRaw = Number(booking.passengerCount);
    const passengerCount = Number.isFinite(passengerCountRaw) ? Math.max(1, Math.round(passengerCountRaw)) : 1;
    if (
      bookingMode === 'charter' &&
      ['bio', 'rocket', 'sunset'].includes(charterType) &&
      charterVariant === 'shared' &&
      (passengerCount < BIO_SHARED_MIN_GUESTS || passengerCount > BIO_SHARED_MAX_GUESTS)
    ) {
      return res.status(400).json({
        error: `Shared bookings require ${BIO_SHARED_MIN_GUESTS}-${BIO_SHARED_MAX_GUESTS} guests.`,
      });
    }
    if (isSharedCharter) {
      const tripDate = new Date(String(booking.start_time || ''));
      if (!Number.isFinite(tripDate.getTime())) {
        return res.status(400).json({ error: 'Invalid trip date for shared charter booking.' });
      }
      const now = new Date();
      const hoursUntilTrip = (tripDate.getTime() - now.getTime()) / (1000 * 60 * 60);
      if (hoursUntilTrip > 48) {
        return res.status(400).json({
          error: 'Shared charter seats are only available within 48 hours of departure.',
        });
      }
    }

    // Server-authoritative pricing: compute expected totals server-side.
    const { data: boatRow, error: boatErr } = await supabase
      .from('boats')
      .select('id, hourly_rate, half_day_rate, full_day_rate')
      .eq('id', String(booking.boat_id))
      .maybeSingle();
    if (boatErr) {
      console.warn('[pricing-authoritative] boat lookup error', boatErr.message);
    }
    if (!boatRow) {
      return res.status(400).json({ error: 'Boat not found for pricing validation' });
    }

    const expected = computeExpectedBookingTotals({
      bookingMode: bookingMode === 'charter' ? 'charter' : 'rental',
      rentalType: String(booking.rental_type || ''),
      durationHours: Number(booking.duration_hours || 0),
      captainIncluded: Boolean(booking.captain_included),
      charterType,
      charterVariant,
      passengerCount,
      date: booking.start_time,
      boat: boatRow,
    });
    const clientTotal = roundMoney(Number(booking.total_price || 0));
    const clientDueToday = roundMoney(Number(booking.deposit_amount || 0));
    const totalDiff = roundMoney(Math.abs(expected.totalPrice - clientTotal));
    const dueTodayDiff = roundMoney(Math.abs(expected.amountDueToday - clientDueToday));
    if (totalDiff > 0.01 || dueTodayDiff > 0.01) {
      console.warn(
        '[pricing-shadow-mismatch]',
        JSON.stringify({
          boatId: String(booking.boat_id),
          bookingMode,
          rentalType: String(booking.rental_type || ''),
          charterType,
          charterVariant,
          durationHours: Number(booking.duration_hours || 0),
          passengerCount,
          clientTotal,
          clientDueToday,
          serverExpectedTotal: expected.totalPrice,
          serverExpectedDueToday: expected.amountDueToday,
          totalDiff,
          dueTodayDiff,
        })
      );
      console.info(
        '[pricing-authoritative-override]',
        JSON.stringify({
          boatId: String(booking.boat_id),
          clientTotal,
          clientDueToday,
          enforcedTotal: expected.totalPrice,
          enforcedDueToday: expected.amountDueToday,
        })
      );
    }

    const depositUsd = Number(expected.amountDueToday);
    if (!Number.isFinite(depositUsd) || depositUsd <= 0) {
      return res.status(400).json({ error: 'Invalid deposit amount' });
    }
    const cents = Math.round(depositUsd * 100);
    if (cents < 50) {
      return res.status(400).json({ error: 'Deposit too small' });
    }

    const { data: customerRow, error: customerUpsertErr } = await supabase
      .from('customers')
      .upsert(
        {
          full_name: String(customer.full_name),
          email: String(customer.email),
          phone: String(customer.phone),
          id_document_url: customer.id_document_url || null,
          insurance_proof_url: customer.insurance_proof_url || null,
          sms_opt_in: Boolean(customer.sms_opt_in),
        },
        { onConflict: 'email' }
      )
      .select('id')
      .single();
    if (customerUpsertErr || !customerRow) {
      return res.status(500).json({
        error: customerUpsertErr?.message || 'Could not save customer',
      });
    }

    try {
      await assertSlotAvailable(booking.boat_id, booking.start_time, booking.end_time, null);
    } catch (slotErr) {
      const code = slotErr.statusCode || 409;
      return res.status(code).json({ error: slotErr.message || SLOT_TAKEN_USER_MESSAGE });
    }

    const domain = String(process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || '')
      .trim()
      .replace(/\/$/, '');
    if (!domain) {
      return res.status(503).json({
        error: 'APP_PUBLIC_URL or FRONTEND_URL must be configured for Stripe redirects.',
      });
    }

    const checkoutBookingMode = String(booking.bookingMode || '').trim().toLowerCase();
    const checkoutCharterVariant = String(booking.charterVariant || '').trim().toLowerCase();
    const lineItemName =
      checkoutBookingMode === 'charter'
        ? checkoutCharterVariant === 'shared'
          ? 'Shared Charter Seat'
          : 'Private Charter Booking'
        : 'Boat Rental Deposit';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: lineItemName,
            },
            unit_amount: cents,
          },
          quantity: 1,
        },
      ],
      success_url: `${domain}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${domain}/booking`,
    });

    if (!session?.id || !session?.url) {
      return res.status(500).json({ error: 'No checkout URL' });
    }

    const authoritativeBooking = {
      ...booking,
      total_price: expected.totalPrice,
      deposit_amount: expected.amountDueToday,
      balance_due: roundMoney(expected.totalPrice - expected.amountDueToday),
    };

    const isCharterBooking = bookingMode === 'charter';
    const captainFeeStored =
      bookingMode === 'rental' ? roundMoney(expected.captainFee || 0) : Number(booking.captain_fee || 0);
    const basePriceStored = roundMoney(
      expected.basePrice != null ? expected.basePrice : Number(booking.base_price || 0)
    );
    const expiresAt = new Date(Date.now() + BOOKING_HOLD_TTL_MS).toISOString();

    const holdInsert = {
      customer_id: customerRow.id,
      boat_id: String(authoritativeBooking.boat_id),
      start_time: authoritativeBooking.start_time,
      end_time: authoritativeBooking.end_time,
      duration_hours: Number(authoritativeBooking.duration_hours || 0),
      rental_type: authoritativeBooking.rental_type,
      captain_included: Boolean(authoritativeBooking.captain_included),
      captain_fee: captainFeeStored,
      base_price: basePriceStored,
      peak_surcharge: Number(authoritativeBooking.peak_surcharge || 0),
      security_deposit: Number(authoritativeBooking.security_deposit || 0),
      total_price: expected.totalPrice,
      deposit_amount: expected.amountDueToday,
      deposit_paid: 0,
      balance_due: roundMoney(expected.totalPrice - expected.amountDueToday),
      payment_status: 'pending',
      status: 'pending',
      expires_at: expiresAt,
      stripe_checkout_session_id: session.id,
      stripe_payment_id: null,
      is_night_tour: Boolean(authoritativeBooking.is_night_tour),
      is_rocket_tour: Boolean(authoritativeBooking.is_rocket_tour),
      license_status: isCharterBooking ? 'verified' : authoritativeBooking.license_status || 'pending',
      insurance_status: isCharterBooking ? 'verified' : authoritativeBooking.insurance_status || 'pending',
      waiver_signed: false,
      admin_notes: `Checkout hold · expires ${expiresAt}`,
      license_url: authoritativeBooking.license_url || null,
      insurance_url: authoritativeBooking.insurance_url || null,
    };

    const { error: holdErr } = await supabase.from('bookings').insert(holdInsert);
    if (holdErr) {
      await stripe.checkout.sessions.expire(session.id).catch(() => {});
      if (isOverlapConstraintError(holdErr)) {
        return res.status(409).json({ error: SLOT_TAKEN_USER_MESSAGE });
      }
      console.error('[create-checkout-session] hold insert:', holdErr.message);
      return res.status(409).json({ error: SLOT_TAKEN_USER_MESSAGE });
    }

    const { error: draftErr } = await supabase.from('checkout_drafts').upsert(
      {
        stripe_session_id: session.id,
        payload: {
          customer,
          booking: authoritativeBooking,
          waiver,
          legal: {
            termsAccepted: true,
            waiverAccepted: true,
            damageFeeAcknowledged: true,
            signaturePresent: true,
            legalAcceptedAt,
          },
        },
      },
      { onConflict: 'stripe_session_id' }
    );
    if (draftErr) {
      console.error('[create-checkout-session] checkout_drafts:', draftErr.message);
      await supabase.from('bookings').delete().eq('stripe_checkout_session_id', session.id);
      await stripe.checkout.sessions.expire(session.id).catch(() => {});
      return res.status(500).json({ error: 'Could not save checkout session. Try again.' });
    }

    return res.json({ url: session.url });
  } catch (err) {
    console.error('[create-checkout-session]', err);
    return res.status(500).json({ error: err.message || 'Failed to create checkout session' });
  }
});

/** Success-page finalization: verify paid Stripe session and finalize (shared logic with webhook). */
app.post('/api/finalize-checkout-session', async (req, res) => {
  try {
    const sessionId = req.body && req.body.sessionId ? String(req.body.sessionId).trim() : '';
    const out = await finalizeBookingFromSession(sessionId, { requestIp: requestIpBestEffort(req) });
    return res.json({ bookingId: out.bookingId, email: out.email, alreadyFinalized: out.alreadyFinalized });
  } catch (err) {
    console.error('[finalize-checkout-session]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to finalize booking' });
  }
});

const resendApiKey = process.env.RESEND_API_KEY;
const resendFrom = process.env.RESEND_FROM_EMAIL || 'Launch Zone <onboarding@resend.dev>';

const resend = resendApiKey ? new Resend(resendApiKey) : null;

app.post('/api/send-booking-confirmation', async (req, res) => {
  try {
    const { email, bookingId } = req.body || {};

    if (!bookingId) {
      return res.status(400).json({ error: 'bookingId is required' });
    }

    let emailSafe = email ? String(email).trim() : '';
    if (!emailSafe && supabaseConfigured) {
      const { data: bRow } = await supabase
        .from('bookings')
        .select('customer_id')
        .eq('id', String(bookingId))
        .maybeSingle();
      if (bRow?.customer_id) {
        const { data: cRow } = await supabase
          .from('customers')
          .select('email')
          .eq('id', bRow.customer_id)
          .maybeSingle();
        emailSafe = (cRow && cRow.email ? String(cRow.email) : '').trim();
      }
    }
    if (!emailSafe) {
      return res.status(400).json({ error: 'email is required (or booking must exist to resolve it)' });
    }

    if (!resend) {
      console.warn('[send-booking-confirmation] RESEND_API_KEY not set; skipping send');
      return res.status(503).json({ error: 'Email service not configured' });
    }

    const bookingIdSafe = String(bookingId);

    const customerSend = resend.emails.send({
      from: resendFrom,
      to: emailSafe,
      subject: 'Your Launch Zone Booking Confirmation',
      html: `
        <p>Thank you for booking with Launch Zone Rentals.</p>
        <p><strong>Booking ID:</strong> ${bookingIdSafe}</p>
        <p>We will follow up with pickup details and next steps.</p>
        <p>If you have questions, call <a href="tel:803-542-1761">803-542-1761</a>.</p>
      `,
    });

    const adminTo = (process.env.ADMIN_EMAIL || '').trim();
    const adminSend =
      adminTo.length > 0
        ? resend.emails.send({
            from: resendFrom,
            to: adminTo,
            subject: 'New Booking Received',
            html: `
              <p>A new booking was submitted.</p>
              <p><strong>Booking ID:</strong> ${bookingIdSafe}</p>
              <p><strong>Customer email:</strong> ${emailSafe}</p>
            `,
          })
        : Promise.resolve({ data: null, error: null });

    const [customerResult, adminResult] = await Promise.all([customerSend, adminSend]);

    if (customerResult.error) {
      console.error('[send-booking-confirmation] customer Resend error:', customerResult.error);
      return res.status(500).json({ error: 'Failed to send email' });
    }

    if (adminResult.error) {
      console.error('[send-booking-confirmation] admin notify Resend error:', adminResult.error);
    } else if (adminTo.length === 0) {
      console.warn('[send-booking-confirmation] ADMIN_EMAIL not set; admin notify skipped');
    }

    if (supabaseConfigured) {
      try {
        await verificationReminder.maybeSendVerificationReminder({
          supabaseAdmin: supabase,
          resend,
          resendFrom,
          bookingId: bookingIdSafe,
          email: emailSafe,
        });
      } catch (remErr) {
        console.error('[send-booking-confirmation] verification reminder:', remErr);
      }

      try {
        const publicBase = verificationReminder.publicAppBase();
        await verificationSms.maybeSendVerificationSms({
          supabaseAdmin: supabase,
          bookingId: bookingIdSafe,
          email: emailSafe,
          publicAppBase: publicBase,
        });
      } catch (_smsErr) {
        /* fail silently — do not affect booking / response */
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[send-booking-confirmation]', err);
    return res.status(500).json({ error: 'Failed to send email' });
  }
});

/**
 * Optional server-side contact (same `contact_messages` table as the public form).
 * Use for API clients; the website submits directly to Supabase from the browser.
 */
app.post('/api/contact', async (req, res) => {
  try {
    if (!supabaseConfigured) {
      console.error('[contact] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
      return res.status(503).json({ error: 'Contact service not configured' });
    }

    const fields = contactSubmission.parseContactBody(req.body);
    const invalid = contactSubmission.validateContact(fields);
    if (invalid) {
      return res.status(400).json({ error: invalid.error });
    }

    const inserted = await contactSubmission.insertContact(supabase, fields);
    if (inserted.error) {
      console.error('[contact] Supabase insert error:', inserted.error);
      return res.status(500).json({ error: 'Failed to save message' });
    }

    const resendFromContact = (process.env.RESEND_FROM_EMAIL || '').trim();
    await contactSubmission.notifyAdminEmail({
      resend,
      resendFrom: resendFromContact,
      adminEmail: (process.env.ADMIN_EMAIL || '').trim(),
      businessName: (process.env.BUSINESS_NAME || '').trim(),
      name: fields.name,
      email: fields.email,
      message: fields.message,
    });

    return res.json({ ok: true, id: inserted.id });
  } catch (err) {
    console.error('[contact]', err);
    return res.status(500).json({ error: 'Failed to submit contact' });
  }
});

// Future: cron trigger, email alert on failure (ADMIN_EMAIL), multi-instance lock (Redis).
app.get('/api/test-supabase', async (req, res) => {
  try {
    const { data, error } = await supabase.from('boats').select('*');
    res.json({ data, error });
  } catch (err) {
    console.error('[test-supabase]', err?.stack || err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/generate-content', async (req, res) => {
  console.log('[generate-content] HIT');
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;

  if (isGenerating) {
    return res.status(200).json({ success: false, message: 'Already generating' });
  }

  isGenerating = true;
  console.log('[generate-content] admin:', adminUser.id);

  try {
    const result = await runPythonScript();
    console.log('[generate-content] Completed');
    return res.json({
      status: 'completed',
      result,
    });
  } catch (err) {
    console.error('[generate-content] Error:', err);
    const message = err instanceof Error ? err.message : String(err);
    const details = err && typeof err === 'object' && 'details' in err ? err.details : undefined;
    const output = err && typeof err === 'object' && 'output' in err ? err.output : undefined;
    return res.status(500).json({
      status: 'error',
      error: message,
      ...(details !== undefined ? { details } : {}),
      ...(output !== undefined ? { output } : {}),
    });
  }
});

app.get('/api/admin/alerts', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;

  try {
    const { data, error } = await supabase
      .from('alerts_log')
      .select('id, type, message, score, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('[admin-alerts] select error:', error.message);
      return res.status(500).json({ error: 'Could not load alerts' });
    }

    return res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error('[admin-alerts]', err?.stack || err);
    return res.status(500).json({ error: 'Could not load alerts' });
  }
});

app.get('/api/admin/subscribers', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;

  try {
    const { data, error } = await supabase
      .from('alert_subscribers')
      .select('email, phone, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('FETCH SUBSCRIBERS ERROR:', error);
      return res.status(500).json({ error: 'Failed to fetch subscribers' });
    }

    return res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error('FETCH SUBSCRIBERS ERROR:', err);
    return res.status(500).json({ error: 'Failed to fetch subscribers' });
  }
});

const DELETABLE_BOOKING_STATUSES = new Set(['pending', 'pending_verification']);

/** Admin-only: remove unpaid draft/pending bookings only (no Stripe payment / deposit paid). */
app.delete('/api/bookings/:id', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Booking id is required' });
    }

    const { data: booking, error: fetchErr } = await supabase
      .from('bookings')
      .select('id, status, stripe_payment_id, payment_status')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) {
      console.error('[bookings/delete] fetch:', fetchErr.message);
      return res.status(500).json({ error: fetchErr.message || 'Could not load booking' });
    }
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const status = String(booking.status || '');
    if (!DELETABLE_BOOKING_STATUSES.has(status)) {
      return res.status(403).json({
        error: 'Only pending or pending_verification bookings can be deleted.',
      });
    }

    const stripePid = booking.stripe_payment_id;
    if (stripePid != null && String(stripePid).trim() !== '') {
      return res.status(400).json({
        error: 'Cannot delete a booking that has a Stripe payment recorded.',
      });
    }

    const payStatus = String(booking.payment_status || 'pending');
    if (payStatus === 'deposit_paid') {
      return res.status(400).json({
        error: 'Cannot delete a booking with a recorded deposit payment.',
      });
    }

    const { data: incidentRows, error: incListErr } = await supabase
      .from('incidents')
      .select('id')
      .eq('booking_id', id);
    if (!incListErr && Array.isArray(incidentRows) && incidentRows.length > 0) {
      const incIds = incidentRows.map((r) => r.id).filter(Boolean);
      if (incIds.length > 0) {
        const { error: photoDelErr } = await supabase.from('incident_photos').delete().in('incident_id', incIds);
        if (photoDelErr) {
          console.error('[bookings/delete] incident_photos:', photoDelErr.message);
          return res.status(500).json({ error: photoDelErr.message || 'Could not remove incident photos' });
        }
      }
      const { error: incDelErr } = await supabase.from('incidents').delete().eq('booking_id', id);
      if (incDelErr) {
        console.error('[bookings/delete] incidents:', incDelErr.message);
        return res.status(500).json({ error: incDelErr.message || 'Could not remove incidents' });
      }
    } else if (incListErr) {
      console.warn('[bookings/delete] incidents list skipped:', incListErr.message);
    }

    const { error: waiverErr } = await supabase.from('waivers').delete().eq('booking_id', id);
    if (waiverErr) {
      console.error('[bookings/delete] waivers:', waiverErr.message);
      return res.status(500).json({ error: waiverErr.message || 'Could not remove waiver records' });
    }

    const { error: delErr } = await supabase.from('bookings').delete().eq('id', id);
    if (delErr) {
      console.error('[bookings/delete] booking:', delErr.message);
      return res.status(500).json({ error: delErr.message || 'Could not delete booking' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[bookings/delete]', err?.stack || err);
    return res.status(500).json({ error: 'Could not delete booking' });
  }
});

app.post('/api/incidents/create', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const bookingId = String(req.body?.booking_id || '').trim();
    const description = String(req.body?.description || '').trim();
    const reportedBy = String(req.body?.reported_by || 'admin').trim() || 'admin';
    if (!bookingId) {
      return res.status(400).json({ error: 'booking_id is required' });
    }
    if (!description) {
      return res.status(400).json({ error: 'description is required' });
    }

    const { data: created, error } = await supabase
      .from('incidents')
      .insert({
        booking_id: bookingId,
        description,
        reported_by: reportedBy,
        status: 'pending',
      })
      .select('*')
      .single();
    if (error || !created) {
      return res.status(500).json({ error: error?.message || 'Could not create incident' });
    }
    return res.json({ incident: created });
  } catch (err) {
    console.error('[incidents/create]', err?.stack || err);
    return res.status(500).json({ error: 'Could not create incident' });
  }
});

app.get('/api/incidents/:bookingId', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const bookingId = String(req.params.bookingId || '').trim();
    if (!bookingId) {
      return res.status(400).json({ error: 'bookingId is required' });
    }
    const { data: incidents, error } = await supabase
      .from('incidents')
      .select('*')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: false });
    if (error) {
      return res.status(500).json({ error: error.message || 'Could not load incidents' });
    }

    const list = Array.isArray(incidents) ? incidents : [];
    const ids = list.map((x) => x.id).filter(Boolean);
    let photosByIncident = {};
    if (ids.length > 0) {
      const { data: photoRows, error: photoErr } = await supabase
        .from('incident_photos')
        .select('*')
        .in('incident_id', ids)
        .order('created_at', { ascending: false });
      if (!photoErr && Array.isArray(photoRows)) {
        photosByIncident = photoRows.reduce((acc, row) => {
          const key = String(row.incident_id || '');
          if (!key) return acc;
          if (!Array.isArray(acc[key])) acc[key] = [];
          acc[key].push(row);
          return acc;
        }, {});
      }
    }

    const withPhotos = list.map((incident) => ({
      ...incident,
      photos: Array.isArray(photosByIncident[String(incident.id)]) ? photosByIncident[String(incident.id)] : [],
    }));
    return res.json({ incidents: withPhotos });
  } catch (err) {
    console.error('[incidents/list]', err?.stack || err);
    return res.status(500).json({ error: 'Could not load incidents' });
  }
});

app.patch('/api/incidents/:id', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const body = req.body || {};
    const patch = {};
    if (body.status !== undefined) patch.status = body.status;
    if (body.estimated_cost !== undefined) patch.estimated_cost = body.estimated_cost;
    if (body.actual_cost !== undefined) patch.actual_cost = body.actual_cost;
    if (body.admin_notes !== undefined) patch.admin_notes = body.admin_notes;

    let updatedIncident = null;
    if (Object.keys(patch).length > 0) {
      const { data: updated, error } = await supabase
        .from('incidents')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single();
      if (error || !updated) {
        return res.status(500).json({ error: error?.message || 'Could not update incident' });
      }
      updatedIncident = updated;
    } else {
      const { data: existing, error } = await supabase.from('incidents').select('*').eq('id', id).maybeSingle();
      if (error || !existing) {
        return res.status(500).json({ error: error?.message || 'Could not load incident' });
      }
      updatedIncident = existing;
    }

    const photos = Array.isArray(body.photos) ? body.photos : [];
    let photosSaved = 0;
    if (photos.length > 0) {
      const normalized = photos
        .map((p) => ({
          incident_id: id,
          file_path: String(p?.file_path || '').trim(),
          file_name: String(p?.file_name || '').trim() || null,
          content_type: String(p?.content_type || '').trim() || null,
          uploaded_by: String(p?.uploaded_by || 'admin').trim() || 'admin',
        }))
        .filter((p) => p.file_path.length > 0);
      if (normalized.length > 0) {
        const { data: insertedPhotos, error: photoErr } = await supabase
          .from('incident_photos')
          .insert(normalized)
          .select('id');
        if (!photoErr) {
          photosSaved = Array.isArray(insertedPhotos) ? insertedPhotos.length : 0;
        }
      }
    }
    return res.json({ incident: updatedIncident, photos_saved: photosSaved });
  } catch (err) {
    console.error('[incidents/patch]', err?.stack || err);
    return res.status(500).json({ error: 'Could not update incident' });
  }
});

app.post('/api/admin/run-alerts', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;

  try {
    console.log('RUN ALERTS HIT');
    await runMonitor();
    return res.json({ success: true });
  } catch (err) {
    console.error('RUN ALERT ERROR:', err);
    return res.status(500).json({ error: 'Failed to run alerts' });
  }
});

/**
 * Bioluminescence conditions (OpenWeather via weatherService — never silent).
 * POST — no body.
 */
/**
 * 7-day glow outlook (OpenWeather forecast + moon). POST — on demand only.
 */
async function upsertAlertSubscriber({ email, phone, subscribedTo }) {
  const payload = {
    email,
    phone,
    subscribed_to: subscribedTo,
  };

  const primary = await supabase
    .from('alert_subscribers')
    .upsert([payload], { onConflict: 'email,subscribed_to' });
  if (!primary.error) return null;

  const msg = String(primary.error?.message || '');
  const missingTopicCol = /column .*subscribed_to.* does not exist/i.test(msg);
  const missingConflictConstraint = /no unique or exclusion constraint matching the ON CONFLICT specification/i.test(
    msg
  );

  if (missingTopicCol) {
    const fallbackSimple = await supabase
      .from('alert_subscribers')
      .upsert([{ email, phone }], { onConflict: 'email' });
    return fallbackSimple.error || null;
  }

  if (missingConflictConstraint) {
    const fallbackEmailConflict = await supabase
      .from('alert_subscribers')
      .upsert([payload], { onConflict: 'email' });
    if (!fallbackEmailConflict.error) return null;

    const fallbackInsert = await supabase.from('alert_subscribers').insert([payload]);
    return fallbackInsert.error || null;
  }

  return primary.error;
}

/**
 * Opt-in alerts (Supabase `alert_subscribers` table). Server normalizes email.
 */
async function handleSubscribe(req, res) {
  console.log('📡 POST /api/subscribe');
  try {
    if (!supabaseConfigured) {
      return res.status(503).json({ success: false, error: 'Service not configured' });
    }

    const body = req.body || {};
    const rawTopic = String(body.subscribed_to || 'bio').toLowerCase();
    const subscribedTo = rawTopic === 'rocket' ? 'rocket' : 'bio';
    const email = String(body.email || '')
      .trim()
      .toLowerCase();
    const phone = String(body.phone || '').trim() || null;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'A valid email is required' });
    }

    const error = await upsertAlertSubscriber({ email, phone, subscribedTo });

    if (error) {
      console.error('SUBSCRIBE ERROR:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Could not save subscription',
      });
    }

    console.log('[subscribe] ok:', email, subscribedTo);
    return res.json({ success: true });
  } catch (err) {
    console.error('SUBSCRIBE ERROR:', err?.stack || err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Server error',
    });
  }
}

app.post('/api/subscribe', handleSubscribe);
app.post('/api/alerts/subscribe', handleSubscribe);

/**
 * Live marine conditions — NOAA Weather.gov + Open-Meteo marine (5 min cache).
 */
app.get('/api/marine-conditions', async (req, res) => {
  console.log('📡 GET /api/marine-conditions');
  try {
    const locationKey =
      typeof req.query?.location === 'string' && req.query.location.trim()
        ? req.query.location.trim().toLowerCase()
        : 'daytona';
    const result = await getMarineConditions({ locationKey });
    return res.json(result);
  } catch (err) {
    console.warn('[marine-conditions] route:', err?.message || err);
    return res.status(500).json({
      success: false,
      error: 'Live data temporarily unavailable',
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/weekly-forecast', async (req, res) => {
  console.log('📡 Weekly forecast triggered');
  try {
    const forecast = await getWeeklyForecast();
    if (!forecast || forecast.length === 0) {
      console.warn('[weekly-forecast] empty or failed');
      return res.json({
        success: false,
        forecast: [],
        message: 'Unable to load forecast',
      });
    }
    return res.json({
      success: true,
      forecast,
    });
  } catch (err) {
    console.error('❌ weekly-forecast route:', err?.stack || err);
    return res.json({
      success: false,
      forecast: [],
      message: 'Unable to load forecast',
    });
  }
});

/**
 * Live bioluminescence snapshot (GET) — strict live weather + tide + moon; Ollama analysis only when OK.
 * Success: { status: 'OK', data, analysis } (analysis may be null; AI runs async). Failure: { status: 'UNAVAILABLE', message }.
 * TODO: Store last successful result in Supabase `bio_conditions` for caching (see bioPublicPayload.js).
 */
app.get('/api/bioluminescence', async (req, res) => {
  console.log('📡 GET /api/bioluminescence');
  try {
    const result = await getBioConditions();

    if (result.status === 'UNAVAILABLE') {
      console.error('BIO ERROR:', result.message || 'unavailable');
      return res.status(503).json({
        status: 'UNAVAILABLE',
        message: result.message || 'Live environmental data unavailable',
      });
    }

    if (result.status !== 'OK' || !result.data) {
      console.error('BIO ERROR: invalid API response shape');
      return res.status(500).json({
        status: 'UNAVAILABLE',
        message: 'Live environmental data unavailable',
      });
    }

    return res.json(result);
  } catch (err) {
    console.error('BIO ERROR:', err?.message || err);
    if (err?.stack) console.error(err.stack);
    return res.status(500).json({
      status: 'UNAVAILABLE',
      message: 'Live environmental data unavailable',
    });
  }
});

app.post('/api/bioluminescence-check', async (req, res) => {
  console.log('📡 BIO CHECK TRIGGERED');
  try {
    const result = await getBioConditions();
    console.log(
      '[bioluminescence-check] result:',
      result.status,
      result.status === 'OK' ? `score=${result.data?.score}` : result.message
    );
    return res.json(result);
  } catch (err) {
    console.error('❌ API ERROR:', err?.stack || err);
    return res.status(500).json({
      status: 'UNAVAILABLE',
      message: 'Live environmental data unavailable',
    });
  }
});

/**
 * Upcoming launches only (Launch Library 2) — cached; no weather or AI.
 * For home page preview and default schedule list on /launches.
 */
app.get('/api/launch-schedule-preview', async (req, res) => {
  try {
    const result = await getLaunchSchedulePreview();
    return res.json(result);
  } catch (err) {
    console.error('❌ launch-schedule-preview:', err?.stack || err);
    return res.status(500).json({
      success: false,
      source: 'Launch Library 2 (The Space Devs)',
      launches: [],
      message: 'Unable to load launch schedule',
    });
  }
});

/**
 * Rocket launch viewing — weather + Ollama advisory (same weather stack as bio).
 * POST — no body.
 */
app.post('/api/rocket-check', async (req, res) => {
  console.log('🚀 Rocket check triggered');
  try {
    const result = await getRocketConditions();
    console.log(
      '[rocket-check] success:',
      result.success,
      'score=',
      result.score,
      'launches=',
      Array.isArray(result.launches) ? result.launches.length : 0
    );
    return res.json(result);
  } catch (err) {
    console.error('❌ rocket-check route:', err?.stack || err);
    return res.status(500).json({
      success: false,
      aiSummary: 'Server error',
    });
  }
});

/** Express error handler — must be last; logs stack, returns JSON (no silent failures). */
app.use((err, req, res, next) => {
  console.error('💥 SERVER ERROR:', err?.stack || err);
  if (res.headersSent) {
    return;
  }
  res.status(500).json({ error: 'Internal Server Error' });
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 UNHANDLED REJECTION:', reason);
  if (reason && typeof reason === 'object' && reason.stack) {
    console.error(reason.stack);
  }
});

process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION:', err?.stack || err);
});

app.listen(PORT, () => {
  console.log(`Launch Zone API listening on http://localhost:${PORT}`);
});

cron.schedule(
  '*/2 * * * *',
  () => {
    cleanupExpiredBookingHolds().catch((e) => {
      console.error('[cron] booking-hold-cleanup:', e?.message || e);
    });
  },
  { timezone: 'America/New_York' }
);
console.log('⏰ Booking hold cleanup: every 2 minutes (America/New_York)');

if (process.env.DISABLE_CONDITION_MONITOR === '1' || process.env.DISABLE_CONDITION_MONITOR === 'true') {
  console.log('⏰ Condition monitor cron: disabled (DISABLE_CONDITION_MONITOR)');
} else {
  cron.schedule(
    '0 * * * *',
    () => {
      runMonitor().catch((e) => {
        console.error('[cron] conditionMonitor:', e?.message || e);
      });
    },
    { timezone: 'America/New_York' }
  );
  console.log('⏰ Condition monitor cron: hourly (America/New_York)');
}
