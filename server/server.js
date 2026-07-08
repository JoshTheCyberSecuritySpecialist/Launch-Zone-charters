/**
 * Launch Zone API: booking confirmation + contact form (Resend + Supabase).
 * From /server: npm install && npm start
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { spawn, execFile } = require('child_process');
const express = require('express');
const cors = require('cors');
const { DateTime } = require('luxon');
const { Resend } = require('resend');
const supabase = require('./supabaseClient');
const contactSubmission = require('./services/contactSubmission');
const verificationReminder = require('./services/verificationReminder');
const verificationSms = require('./services/verificationSms');
const insuranceTripReminders = require('./services/insuranceTripReminders');
const preTripNotifications = require('./services/preTripNotifications');
const waiversDocsReminders = require('./services/waiversDocsReminders');
const bookingAccess = require('./services/bookingAccess');
const documentUrlValidation = require('./services/documentUrlValidation');
const bookingReliability = require('./services/bookingReliability');
const bookingCommunications = require('./services/bookingCommunications');
const shopService = require('./services/shopService');
const disputeService = require('./services/disputeService');
const disputeEvidenceService = require('./services/disputeEvidenceService');
const disputeExportService = require('./services/disputeExportService');
const { getBioConditions } = require('./services/bioluminescenceService');
const { getRocketConditions } = require('./services/rocketService');
const { getLaunchSchedulePreview } = require('./services/rocketScheduleService');
const { getWeeklyForecast } = require('./services/weeklyForecastService');
const { getMarineConditions } = require('./services/marineConditionsService');
const availabilityService = require('./services/availabilityService');
const {
  applyPromoToExpectedTotals,
  incrementPromoUsage,
  normalizeAppliesTo,
  normalizePromoCode,
  validatePromoCode,
} = require('./services/promoService');
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
const BIO_SHARED_MAX_GUESTS = 6;
const BIO_SHARED_PER_PERSON = 150;
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
    const charterDurationHours = 1;
    const guests = Math.min(BIO_SHARED_MAX_GUESTS, Math.max(BIO_SHARED_MIN_GUESTS, Number(passengerCount) || 1));
    const ticketPrice =
      charterType === 'bio'
        ? BIO_SHARED_PER_PERSON
        : charterType === 'rocket'
          ? ROCKET_SHARED_PER_PERSON
          : SUNSET_SHARED_PER_PERSON;
    const totalPrice = roundMoney(guests * ticketPrice);
    return {
      mode: 'charter',
      basePrice: totalPrice,
      ticketPrice,
      guestCount: guests,
      durationHours: charterDurationHours,
      totalPrice,
      amountDueToday: totalPrice,
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

/** Unpaid Checkout holds expire with the Stripe Checkout Session. */
const BOOKING_HOLD_TTL_MS = 30 * 60 * 1000;
const SLOT_TAKEN_USER_MESSAGE =
  'This time slot was just booked. Please select another time.';
const SLOT_TOO_SOON_USER_MESSAGE =
  'This time is no longer available. Please choose a later time.';

function isOverlapConstraintError(err) {
  if (!err) return false;
  if (String(err.code || '') === '23P01') return true;
  const msg = String(err.message || '');
  return /exclusion|overlap|bookings_boat_no_time_overlap/i.test(msg);
}

function isUniqueConstraintError(err) {
  if (!err) return false;
  if (String(err.code || '') === '23505') return true;
  const msg = String(err.message || '');
  return /duplicate key|unique constraint|uidx/i.test(msg);
}

function assertBookingLeadTime(startIso) {
  if (!availabilityService.isStartTimeAllowed(startIso)) {
    const err = new Error(SLOT_TOO_SOON_USER_MESSAGE);
    err.statusCode = 409;
    err.code = 'slot_too_soon';
    throw err;
  }
}

function assertCharterStartTimeAllowed(charterType, startIso, endIso = null) {
  const start = DateTime.fromISO(String(startIso || ''), { zone: 'utc' });
  const end =
    endIso != null
      ? DateTime.fromISO(String(endIso || ''), { zone: 'utc' })
      : start.plus({ hours: 1 });
  availabilityService.assertCharterSlotWindow({
    charterType,
    startIso: start.toISO(),
    endIso: end.toISO(),
  });
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
 * Resolve the project-local Python executable and args for spawn (no shell).
 * @param {string} projectRoot
 * @returns {{ command: string, args: string[], cwd: string }}
 */
function buildPythonSpawn(projectRoot) {
  const py =
    process.platform === 'win32'
      ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
      : path.join(__dirname, '.venv', 'bin', 'python');
  return {
    command: py,
    args: ['./ai-content/upload.py'],
    cwd: projectRoot,
  };
}

function formatCaptainsLogVenvSetupMessage(command) {
  return [
    `Captain's Log Python virtual environment is missing at ${command}.`,
    'It should be created automatically during Render builds via npm postinstall/build (scripts/ensure-captains-log-venv.js).',
    'If this persists after deploy, confirm Render Build Command includes npm install and check build logs for [captains-log-venv].',
  ].join('\n');
}

/**
 * Execute a command without a shell and capture output.
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv}} [opts]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function runFile(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: opts.cwd, env: opts.env }, (error, stdout, stderr) => {
      if (error) {
        reject(
          Object.assign(error, {
            stdout: String(stdout || ''),
            stderr: String(stderr || ''),
          })
        );
        return;
      }
      resolve({
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

/**
 * Ensure Python deps for Captain's Log exist in server/.venv only.
 * Prevents externally-managed-environment failures on cloud hosts.
 * @param {string} command
 * @param {string} projectRoot
 */
async function ensurePythonPipelineDeps(command, projectRoot) {
  const skipCheck = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.SKIP_PYTHON_DEP_CHECK || '')
      .trim()
      .toLowerCase()
  );
  if (skipCheck) return;

  if (!fs.existsSync(command)) {
    throw Object.assign(new Error('Captain\'s Log Python virtual environment is missing'), {
      details: formatCaptainsLogVenvSetupMessage(command),
    });
  }

  const requirementsPath = path.join(__dirname, 'requirements-captains-log.txt');
  if (!fs.existsSync(requirementsPath)) {
    throw Object.assign(new Error('Captain\'s Log Python requirements file is missing'), {
      details: `Expected requirements file at ${requirementsPath}.`,
    });
  }

  const importCheck = 'import requests, bs4, supabase, dotenv';
  try {
    await runFile(command, ['-c', importCheck], { cwd: projectRoot, env: process.env });
    return;
  } catch (checkErr) {
    console.warn(
      '[generate-content] Python dependency precheck failed, installing into server/.venv:',
      checkErr?.stderr || checkErr?.message || checkErr
    );
  }

  await runFile(command, ['-m', 'pip', 'install', '-r', requirementsPath], {
    cwd: projectRoot,
    env: process.env,
  });
  await runFile(command, ['-c', importCheck], { cwd: projectRoot, env: process.env });
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

    const childEnv = {
      ...process.env,
      // Quieter RSS logs for API runs unless .env sets PIPELINE_VERBOSE=1
      PIPELINE_VERBOSE: process.env.PIPELINE_VERBOSE || '0',
      // Default off: full SEO hub prompts + HTML article fetch (see config.py PIPELINE_FAST).
      // Set PIPELINE_FAST=1 for quicker RSS-only runs when iterating locally.
      PIPELINE_FAST:
        process.env.PIPELINE_FAST !== undefined && process.env.PIPELINE_FAST !== ''
          ? process.env.PIPELINE_FAST
          : '0',
    };

    void (async () => {
      try {
        await ensurePythonPipelineDeps(command, projectRoot);
      } catch (depErr) {
        isGenerating = false;
        reject(
          Object.assign(new Error('Python dependencies missing for Captain\'s Log pipeline'), {
            details: depErr?.stderr || depErr?.message || String(depErr),
          })
        );
        return;
      }

      const py = spawn(command, args, {
        cwd,
        env: childEnv,
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
    })();
  });
}

/**
 * Browsers send an exact Origin (e.g. https://www.example.com). Many sites set
 * FRONTEND_URL to the apex but users land on www (or vice versa). Mirror www ↔ apex
 * so production API calls are not silently blocked by CORS.
 */
function expandCorsOriginVariants(origins) {
  const out = new Set();
  for (const raw of origins) {
    const o = String(raw || '').trim();
    if (!o) continue;
    out.add(o.replace(/\/$/, ''));
    try {
      const u = new URL(o);
      const host = u.hostname.toLowerCase();
      if (host === 'localhost' || host.startsWith('127.')) continue;
      const protocol = u.protocol;
      if (host.startsWith('www.')) {
        out.add(`${protocol}//${host.slice(4)}`);
      } else {
        out.add(`${protocol}//www.${host}`);
      }
    } catch {
      /* ignore malformed */
    }
  }
  return [...out];
}

const corsOrigins = expandCorsOriginVariants([
  'http://localhost:5173',
  process.env.FRONTEND_URL,
  process.env.APP_PUBLIC_URL,
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : []),
])
  .map((x) => String(x || '').trim())
  .filter(Boolean);

const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && corsOrigins.length === 0) {
  console.error(
    '[cors] NODE_ENV=production but no FRONTEND_URL, APP_PUBLIC_URL, or CORS_ORIGIN set — refusing open CORS'
  );
}

const corsOptions = {
  origin:
    corsOrigins.length > 0
      ? corsOrigins
      : isProduction
        ? false
        : true,
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

  const session = await stripe.checkout.sessions.retrieve(sid, {
    expand: ['payment_intent.latest_charge'],
  });
  if (!session) {
    const err = new Error('Checkout session not found');
    err.statusCode = 400;
    throw err;
  }

  const stripeSessionId = String(session.id || sid);
  const sessionIds = bookingReliability.extractSessionIds(session);
  const paymentIntentId = sessionIds.paymentIntentId || '';
  const stripeChargeId = sessionIds.chargeId || '';

  const { data: existingBySession } = await supabase
    .from('bookings')
    .select('id, customer_id')
    .or(
      [
        `stripe_payment_id.eq.${stripeSessionId}`,
        `stripe_checkout_session_id.eq.${stripeSessionId}`,
        `checkout_session_id.eq.${stripeSessionId}`,
      ].join(',')
    )
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
      .or(`stripe_payment_id.eq.${paymentIntentId},payment_intent_id.eq.${paymentIntentId}`)
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
    await bookingReliability.enqueueRecovery(supabase, {
      ...bookingReliability.recoveryPayloadFromSession(session),
      reason: 'payment_received_no_booking',
      error: 'Checkout session draft not found or expired',
    });
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
    const refund = await refundStripeCheckoutSession(session);
    if (!refund.ok) {
      await bookingReliability.enqueueRecovery(supabase, {
        ...bookingReliability.recoveryPayloadFromSession(session),
        reason: 'refund_failed',
        error: refund.error || refund.reason || 'Checkout hold expired and refund failed',
      });
    }
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
    await bookingReliability.enqueueRecovery(supabase, {
      ...bookingReliability.recoveryPayloadFromSession(session),
      reason: 'booking_failed',
      error: customerError?.message || 'Could not save customer',
    });
    const err = new Error(customerError?.message || 'Could not save customer');
    err.statusCode = 500;
    throw err;
  }

  const bookingMode = typeof booking.bookingMode === 'string' ? booking.bookingMode.trim().toLowerCase() : '';
  const charterType = typeof booking.charterType === 'string' ? booking.charterType.trim().toLowerCase() : '';
  const charterVariant =
    typeof booking.charterVariant === 'string' ? booking.charterVariant.trim().toLowerCase() : '';
  const passengerCountRaw = Number(booking.passengerCount);
  const passengerCount = Number.isFinite(passengerCountRaw) ? Math.max(1, Math.round(passengerCountRaw)) : 1;
  const isCharterBooking = bookingMode === 'charter';

  let boatRow = null;
  if (!isCharterBooking) {
    const { data, error: boatErr } = await supabase
      .from('boats')
      .select('id, name, hourly_rate, half_day_rate, full_day_rate, type')
      .eq('id', String(booking.boat_id))
      .maybeSingle();
    if (boatErr) {
      console.warn('[finalizeBookingFromSession] boat lookup:', boatErr.message);
    }
    if (!data) {
      const refund = await refundStripeCheckoutSession(session);
      if (!refund.ok) {
        await bookingReliability.enqueueRecovery(supabase, {
          ...bookingReliability.recoveryPayloadFromSession(session),
          reason: 'refund_failed',
          error: refund.error || refund.reason || 'Boat not found and refund failed',
        });
      }
      const err = new Error('Boat not found; payment was refunded.');
      err.statusCode = 400;
      throw err;
    }
    boatRow = data;
  }

  let expected = computeExpectedBookingTotals({
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

  const promoApplied = await applyPromoToExpectedTotals(expected, {
    supabaseAdmin: supabase,
    booking,
    boatRow,
    bookingMode,
  });
  if (promoApplied.error) {
    const refund = await refundStripeCheckoutSession(session);
    if (!refund.ok) {
      await bookingReliability.enqueueRecovery(supabase, {
        ...bookingReliability.recoveryPayloadFromSession(session),
        reason: 'refund_failed',
        error: refund.error || refund.reason || promoApplied.error,
      });
    }
    const err = new Error(promoApplied.error);
    err.statusCode = 400;
    throw err;
  }
  expected = promoApplied.expected;
  const promoFields = promoApplied.promo;

  const paidDeposit =
    typeof session.amount_total === 'number'
      ? Math.round((session.amount_total / 100) * 100) / 100
      : Number(booking.deposit_amount || 0);
  const paymentStatus = paidDeposit >= expected.totalPrice ? 'paid' : 'deposit_paid';

  const sharedGuestOutOfRange =
    ['bio', 'rocket', 'sunset'].includes(charterType) &&
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
    boat_id: isCharterBooking ? null : String(booking.boat_id),
    booking_type: isCharterBooking ? 'charter' : 'rental',
    charter_type: isCharterBooking ? charterType || null : null,
    guest_count: isCharterBooking ? passengerCount : 1,
    total_amount: expected.totalPrice,
    start_time: booking.start_time,
    end_time: isCharterBooking
      ? new Date(new Date(String(booking.start_time)).getTime() + 60 * 60 * 1000).toISOString()
      : booking.end_time,
    duration_hours: isCharterBooking ? 1 : Number(booking.duration_hours || 0),
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
    payment_intent_id: paymentIntentId || null,
    checkout_session_id: stripeSessionId,
    stripe_charge_id: stripeChargeId || null,
    stripe_checkout_session_id: null,
    expires_at: null,
    admin_notes: adminNotesParts.length > 0 ? adminNotesParts.join('\n') : null,
    license_url: booking.license_url || null,
    insurance_url: booking.insurance_url || null,
    promo_code: promoFields?.promo_code || null,
    discount_amount: promoFields?.discount_amount ?? 0,
    original_total: promoFields?.original_total ?? expected.totalPrice,
    final_total: promoFields?.final_total ?? expected.totalPrice,
  };

  try {
    if (isCharterBooking) {
      const startMs = new Date(String(booking.start_time || '')).getTime();
      if (!Number.isFinite(startMs) || startMs < Date.now()) {
        const err = new Error('This charter time is in the past. Please choose another time.');
        err.statusCode = 409;
        throw err;
      }
        await availabilityService.assertCharterSlotAvailable({
          startTime: booking.start_time,
          endTime: bookingInsert.end_time,
          charterType,
          excludeBookingId: holdRow?.id || null,
        });
    } else {
      assertBookingLeadTime(booking.start_time);
      await availabilityService.assertBookingSlotAvailable({
        boatId: booking.boat_id,
        startTime: booking.start_time,
        endTime: booking.end_time,
        location: booking.rentalLocation || booking.rental_location || null,
        excludeBookingId: holdRow?.id || null,
      });
    }
  } catch (slotErr) {
    const refund = await refundStripeCheckoutSession(session);
    if (!refund.ok) {
      await bookingReliability.enqueueRecovery(supabase, {
        ...bookingReliability.recoveryPayloadFromSession(session),
        reason: 'refund_failed',
        error: refund.error || refund.reason || slotErr.message || 'Availability conflict and refund failed',
      });
    }
    const fallbackMessage =
      slotErr?.code === 'slot_too_soon' ? SLOT_TOO_SOON_USER_MESSAGE : SLOT_TAKEN_USER_MESSAGE;
    const err = new Error(slotErr.message || fallbackMessage);
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
      if (isUniqueConstraintError(updErr)) {
        const { data: existing } = await supabase
          .from('bookings')
          .select('id, customer_id')
          .or(
            [
              `stripe_payment_id.eq.${stripeSessionId}`,
              `checkout_session_id.eq.${stripeSessionId}`,
              paymentIntentId ? `payment_intent_id.eq.${paymentIntentId}` : '',
            ]
              .filter(Boolean)
              .join(',')
          )
          .maybeSingle();
        if (existing?.id) {
          return {
            bookingId: existing.id,
            email: await resolveCustomerEmail(existing.customer_id),
            alreadyFinalized: true,
          };
        }
      }
      if (isOverlapConstraintError(updErr)) {
        const refund = await refundStripeCheckoutSession(session);
        if (!refund.ok) {
          await bookingReliability.enqueueRecovery(supabase, {
            ...bookingReliability.recoveryPayloadFromSession(session),
            reason: 'refund_failed',
            error: refund.error || refund.reason || SLOT_TAKEN_USER_MESSAGE,
          });
        }
        const err = new Error(SLOT_TAKEN_USER_MESSAGE);
        err.statusCode = 409;
        throw err;
      }
      const refund = await refundStripeCheckoutSession(session);
      await bookingReliability.enqueueRecovery(supabase, {
        ...bookingReliability.recoveryPayloadFromSession(session),
        reason: refund.ok ? 'booking_failed' : 'refund_failed',
        error: updErr?.message || refund.error || refund.reason || 'Could not confirm booking',
      });
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
      if (isUniqueConstraintError(bookingError)) {
        const { data: existing } = await supabase
          .from('bookings')
          .select('id, customer_id')
          .or(
            [
              `stripe_payment_id.eq.${stripeSessionId}`,
              `checkout_session_id.eq.${stripeSessionId}`,
              paymentIntentId ? `payment_intent_id.eq.${paymentIntentId}` : '',
            ]
              .filter(Boolean)
              .join(',')
          )
          .maybeSingle();
        if (existing?.id) {
          return {
            bookingId: existing.id,
            email: await resolveCustomerEmail(existing.customer_id),
            alreadyFinalized: true,
          };
        }
      }
      if (isOverlapConstraintError(bookingError)) {
        const refund = await refundStripeCheckoutSession(session);
        if (!refund.ok) {
          await bookingReliability.enqueueRecovery(supabase, {
            ...bookingReliability.recoveryPayloadFromSession(session),
            reason: 'refund_failed',
            error: refund.error || refund.reason || SLOT_TAKEN_USER_MESSAGE,
          });
        }
        const err = new Error(SLOT_TAKEN_USER_MESSAGE);
        err.statusCode = 409;
        throw err;
      }
      const refund = await refundStripeCheckoutSession(session);
      await bookingReliability.enqueueRecovery(supabase, {
        ...bookingReliability.recoveryPayloadFromSession(session),
        reason: refund.ok ? 'booking_failed' : 'refund_failed',
        error: bookingError?.message || refund.error || refund.reason || 'Could not save booking',
      });
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
      await bookingReliability.insertActivity(supabase, {
        booking_id: bookingRow.id,
        checkout_session_id: stripeSessionId,
        payment_intent_id: paymentIntentId || null,
        event_type: 'waiver_insert_failed',
        message: waiverErr.message,
      });
    }
  }

  if (promoFields?.promo_code) {
    await incrementPromoUsage(supabase, promoFields.promo_code);
  }

  await bookingReliability.upsertBookingPayment(supabase, {
    booking_id: bookingRow.id,
    checkout_session_id: stripeSessionId,
    payment_intent_id: paymentIntentId || null,
    charge_id: stripeChargeId || null,
    amount: paidDeposit,
    currency: session.currency || 'usd',
    status: paymentStatus,
    payload: session,
  });

  await bookingReliability.resolveRecovery(
    supabase,
    {
      checkout_session_id: stripeSessionId,
      payment_intent_id: paymentIntentId || null,
    },
    { booking_id: bookingRow.id }
  );

  await bookingReliability.createOrUpdateBookingDraft(supabase, {
    checkout_session_id: stripeSessionId,
    payment_intent_id: paymentIntentId || null,
    customer_email: customerRow.email,
    customer_name: String(customer.full_name || ''),
    customer_phone: String(customer.phone || ''),
    booking_payload: payload,
    status: 'completed',
    amount_due: paidDeposit,
    currency: session.currency || 'usd',
    booking_id: bookingRow.id,
  });

  await bookingReliability.insertActivity(supabase, {
    booking_id: bookingRow.id,
    checkout_session_id: stripeSessionId,
    payment_intent_id: paymentIntentId || null,
    event_type: 'booking_created',
    message: 'Paid Stripe Checkout finalized into booking.',
    payload: {
      payment_status: paymentStatus,
      amount_paid: paidDeposit,
      alreadyFinalized: false,
    },
  });

  const { error: delDraftErr } = await supabase
    .from('checkout_drafts')
    .delete()
    .eq('stripe_session_id', stripeSessionId);
  if (delDraftErr) {
    console.warn('[finalizeBookingFromSession] draft delete:', delDraftErr.message);
  }

  await sendBookingConfirmationInternal({
    bookingId: bookingRow.id,
    email: customerRow.email,
    source: options.source || 'finalize',
  }).catch(async (emailErr) => {
    console.error('[finalizeBookingFromSession] confirmation email:', emailErr?.message || emailErr);
    await bookingReliability.enqueueRecovery(supabase, {
      ...bookingReliability.recoveryPayloadFromSession(session),
      booking_id: bookingRow.id,
      customer_email: customerRow.email,
      reason: 'email_failed',
      error: emailErr?.message || 'Booking confirmation email failed',
    });
  });

  return { bookingId: bookingRow.id, email: customerRow.email, alreadyFinalized: false };
}

async function processStripeWebhookEvent(event) {
  const eventId = String(event.id || '');
  const eventType = String(event.type || '');
  const ids = bookingReliability.extractEventIds(event);

  await bookingReliability.updateWebhookEventStatus(supabase, eventId, 'processing');
  await bookingReliability.insertActivity(supabase, {
    checkout_session_id: ids.checkoutSessionId || null,
    payment_intent_id: ids.paymentIntentId || null,
    event_type: 'webhook_received',
    message: `Stripe webhook received: ${eventType}`,
    payload: { event_id: eventId, event_type: eventType },
  });

  if (eventType === 'checkout.session.completed' || eventType === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    const orderType = String(session.metadata?.order_type || '').trim().toLowerCase();
    if (orderType === 'shop') {
      try {
        const out = await shopService.finalizeShopOrderFromSession({
          stripe,
          supabase,
          resend,
          resendFrom,
          sessionId: session.id,
          source: 'stripe_webhook',
        });
        await bookingReliability.updateWebhookEventStatus(supabase, eventId, 'processed', {
          error: null,
        });
        await bookingReliability.insertActivity(supabase, {
          checkout_session_id: session.id,
          payment_intent_id: ids.paymentIntentId || null,
          event_type: 'shop_order_paid',
          message: 'Stripe shop payment succeeded and order finalization completed.',
          payload: { event_id: eventId, order_id: out.orderId, alreadyFinalized: out.alreadyFinalized },
        });
        console.log(
          '[stripe-webhook] finalized shop order',
          out.orderId,
          session.id,
          out.alreadyFinalized ? '(idempotent)' : '',
          'email=',
          out.email || '-'
        );
        return { ok: true, orderId: out.orderId };
      } catch (err) {
        console.error('[stripe-webhook] shop finalize:', session.id, err.message || err);
        await bookingReliability.updateWebhookEventStatus(supabase, eventId, 'failed', {
          error: err.message || 'Shop webhook finalization failed',
        });
        return { ok: false, error: err };
      }
    }
    try {
      const out = await finalizeBookingFromSession(session.id, { requestIp: null, source: 'stripe_webhook' });
      await bookingReliability.updateWebhookEventStatus(supabase, eventId, 'processed', {
        booking_id: out.bookingId,
        error: null,
      });
      await bookingReliability.insertActivity(supabase, {
        booking_id: out.bookingId,
        checkout_session_id: session.id,
        payment_intent_id: ids.paymentIntentId || null,
        event_type: 'payment_succeeded',
        message: 'Stripe payment succeeded and booking finalization completed.',
        payload: { event_id: eventId, alreadyFinalized: out.alreadyFinalized },
      });
      console.log('[stripe-webhook] finalized booking', out.bookingId, out.alreadyFinalized ? '(idempotent)' : '');
      return { ok: true, bookingId: out.bookingId };
    } catch (err) {
      console.error('[stripe-webhook] finalize:', err.message || err);
      const recovery = await bookingReliability.enqueueRecovery(supabase, {
        ...bookingReliability.recoveryPayloadFromSession(session, {
          stripe_event_id: eventId,
          payment_intent_id: ids.paymentIntentId || null,
        }),
        reason: 'webhook_failed',
        error: err.message || 'Webhook finalization failed',
      });
      await bookingReliability.updateWebhookEventStatus(supabase, eventId, recovery.error ? 'failed' : 'queued', {
        error: err.message || 'Webhook finalization failed',
      });
      return { ok: !recovery.error, queued: !recovery.error, error: err };
    }
  }

  if (eventType === 'payment_intent.succeeded') {
    let session = null;
    if (!ids.checkoutSessionId && ids.paymentIntentId) {
      session = await bookingReliability.findCheckoutSessionForPaymentIntent(stripe, ids.paymentIntentId).catch((err) => {
        console.warn('[stripe-webhook] find session by PI:', err.message);
        return null;
      });
    }
    const checkoutSessionId = ids.checkoutSessionId || session?.id || null;

    const { data: shopOrder } = await supabase
      .from('shop_orders')
      .select('id, status, stripe_session_id, payment_intent_id, amount_paid')
      .or(
        [
          ids.paymentIntentId ? `payment_intent_id.eq.${ids.paymentIntentId}` : '',
          checkoutSessionId ? `stripe_session_id.eq.${checkoutSessionId}` : '',
        ]
          .filter(Boolean)
          .join(',')
      )
      .maybeSingle();
    if (shopOrder?.id) {
      const shopSessionId = checkoutSessionId || shopOrder.stripe_session_id || null;
      if (!shopService.isShopOrderPaid(shopOrder) && shopSessionId) {
        try {
          const out = await shopService.finalizeShopOrderFromSession({
            stripe,
            supabase,
            resend,
            resendFrom,
            sessionId: shopSessionId,
            source: 'stripe_webhook_payment_intent',
          });
          console.log('[stripe-webhook] finalized shop order via payment_intent', out.orderId, shopSessionId);
        } catch (err) {
          console.error('[stripe-webhook] shop finalize via payment_intent:', shopSessionId, err.message || err);
        }
      }
      await bookingReliability.updateWebhookEventStatus(supabase, eventId, 'processed', {
        error: null,
      });
      return { ok: true, orderId: shopOrder.id };
    }

    const { data: booking } = await supabase
      .from('bookings')
      .select('id')
      .or(
        [
          ids.paymentIntentId ? `payment_intent_id.eq.${ids.paymentIntentId}` : '',
          checkoutSessionId ? `checkout_session_id.eq.${checkoutSessionId}` : '',
          checkoutSessionId ? `stripe_payment_id.eq.${checkoutSessionId}` : '',
        ]
          .filter(Boolean)
          .join(',')
      )
      .maybeSingle();
    if (!booking?.id) {
      await bookingReliability.enqueueRecovery(supabase, {
        ...(session ? bookingReliability.recoveryPayloadFromSession(session) : {}),
        payment_intent_id: ids.paymentIntentId || null,
        checkout_session_id: checkoutSessionId,
        stripe_event_id: eventId,
        amount: ids.amount ?? null,
        currency: ids.currency || 'usd',
        customer_email: ids.customerEmail || null,
        reason: 'payment_received_no_booking',
        error: 'PaymentIntent succeeded without a matching booking.',
      });
      await bookingReliability.updateWebhookEventStatus(supabase, eventId, 'queued', {
        error: 'PaymentIntent succeeded without a matching booking.',
      });
      return { ok: true, queued: true };
    }
    await bookingReliability.updateWebhookEventStatus(supabase, eventId, 'processed', {
      booking_id: booking.id,
      error: null,
    });
    return { ok: true, bookingId: booking.id };
  }

  if (eventType === 'payment_intent.payment_failed' || eventType === 'checkout.session.async_payment_failed') {
    await bookingReliability.enqueueRecovery(supabase, {
      checkout_session_id: ids.checkoutSessionId || null,
      payment_intent_id: ids.paymentIntentId || null,
      stripe_event_id: eventId,
      amount: ids.amount ?? null,
      currency: ids.currency || 'usd',
      customer_email: ids.customerEmail || null,
      reason: 'booking_failed',
      error: 'Stripe payment failed.',
      status: 'ignored',
    });
    await bookingReliability.updateWebhookEventStatus(supabase, eventId, 'processed');
    return { ok: true };
  }

  if (eventType === 'checkout.session.expired') {
    const session = event.data.object;
    if (String(session.metadata?.order_type || '').trim().toLowerCase() === 'shop') {
      await shopService.markShopOrderAbandoned({
        supabase,
        stripeSessionId: session.id,
        source: 'stripe_session_expired',
      });
    }
    await bookingReliability.createOrUpdateBookingDraft(supabase, {
      checkout_session_id: session.id,
      payment_intent_id: ids.paymentIntentId || null,
      customer_email: ids.customerEmail || null,
      customer_name: ids.customerName || null,
      customer_phone: ids.customerPhone || null,
      booking_payload: { stripe_session: session },
      status: 'expired',
      amount_due: ids.amount ?? null,
      currency: ids.currency || 'usd',
    });
    await bookingReliability.updateWebhookEventStatus(supabase, eventId, 'processed');
    return { ok: true };
  }

  if (eventType === 'charge.refunded' || eventType.startsWith('refund.')) {
    const { data: shopOrder } = await supabase
      .from('shop_orders')
      .select('id')
      .or(
        [
          ids.paymentIntentId ? `payment_intent_id.eq.${ids.paymentIntentId}` : '',
          ids.chargeId ? `stripe_charge_id.eq.${ids.chargeId}` : '',
        ]
          .filter(Boolean)
          .join(',')
      )
      .maybeSingle();
    if (shopOrder?.id) {
      await supabase
        .from('shop_orders')
        .update({ status: 'refunded', updated_at: new Date().toISOString() })
        .eq('id', shopOrder.id);
      await bookingReliability.updateWebhookEventStatus(supabase, eventId, 'processed', {
        error: null,
      });
      return { ok: true, orderId: shopOrder.id };
    }

    const { data: booking } = await supabase
      .from('bookings')
      .select('id')
      .or(
        [
          ids.paymentIntentId ? `payment_intent_id.eq.${ids.paymentIntentId}` : '',
          ids.chargeId ? `stripe_charge_id.eq.${ids.chargeId}` : '',
        ]
          .filter(Boolean)
          .join(',')
      )
      .maybeSingle();
    if (booking?.id) {
      await bookingReliability.insertActivity(supabase, {
        booking_id: booking.id,
        payment_intent_id: ids.paymentIntentId || null,
        event_type: 'refunded',
        message: 'Stripe refund event received.',
        payload: { event_id: eventId, event_type: eventType, amount: ids.amount },
      });
    }
    await bookingReliability.updateWebhookEventStatus(supabase, eventId, 'processed', {
      booking_id: booking?.id || null,
    });
    return { ok: true };
  }

  if (eventType.startsWith('charge.dispute.')) {
    const dispute = event.data.object;
    try {
      const out = await disputeService.upsertDisputeFromStripe(supabase, dispute);
      await bookingReliability.updateWebhookEventStatus(supabase, eventId, 'processed', {
        booking_id: out.bookingId || null,
        error: null,
      });
      if (out.bookingId) {
        await bookingReliability.insertActivity(supabase, {
          booking_id: out.bookingId,
          payment_intent_id: ids.paymentIntentId || out.dispute?.payment_intent_id || null,
          event_type: 'stripe_dispute',
          message: `Stripe dispute ${eventType.replace('charge.dispute.', '')}: ${String(dispute.status || 'updated')}`,
          payload: {
            event_id: eventId,
            event_type: eventType,
            stripe_dispute_id: dispute.id,
            reason: dispute.reason || null,
            status: dispute.status || null,
          },
        });
      }
      console.log('[stripe-webhook] dispute', dispute.id, eventType, out.created ? '(created)' : '(updated)');
      return { ok: true, disputeId: out.dispute?.id || null };
    } catch (err) {
      console.error('[stripe-webhook] dispute:', err.message || err);
      await bookingReliability.updateWebhookEventStatus(supabase, eventId, 'failed', {
        error: err.message || 'Dispute webhook failed',
      });
      return { ok: false, error: err };
    }
  }

  await bookingReliability.updateWebhookEventStatus(supabase, eventId, 'ignored');
  return { ok: true, ignored: true };
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

  const recorded = await bookingReliability.recordWebhookEvent(supabase, event);
  if (recorded.error) {
    return res.status(500).json({ error: 'Could not record Stripe webhook' });
  }
  if (
    recorded.duplicate &&
    ['processed', 'ignored', 'queued'].includes(String(recorded.data?.processing_status || ''))
  ) {
    return res.json({
      received: true,
      duplicate: true,
      status: recorded.data.processing_status,
    });
  }

  const out = await processStripeWebhookEvent(event);
  if (!out.ok && !out.queued) {
    return res.status(500).json({ received: true, queued: false });
  }
  return res.json({ received: true, queued: Boolean(out.queued), ignored: Boolean(out.ignored) });
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

function cleanText(value, maxLen = 500) {
  const text = String(value || '').trim();
  return text ? text.slice(0, maxLen) : '';
}

function normalizeStaffPaymentMethod(value) {
  const method = cleanText(value, 40).toLowerCase();
  return ['stripe', 'cash', 'venmo', 'zelle', 'paypal', 'groupon', 'comp', 'other'].includes(method)
    ? method
    : null;
}

function normalizeStaffPaymentStatus(value, fallback = 'pending') {
  const status = cleanText(value, 40).toLowerCase();
  return ['pending', 'deposit_paid', 'paid'].includes(status) ? status : fallback;
}

function parseStaffMoney(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? roundMoney(Math.max(0, n)) : fallback;
}

function parseStaffDuration(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function rentalTypeForHours(hours) {
  if (Math.abs(Number(hours) - 4) < 0.01) return 'half_day';
  if (Math.abs(Number(hours) - 8) < 0.01) return 'full_day';
  return 'hourly';
}

function staffBookingTimes(body) {
  const startRaw = cleanText(body.start_time || body.startTime, 80);
  const endRaw = cleanText(body.end_time || body.endTime, 80);
  if (startRaw && endRaw) {
    const start = new Date(startRaw);
    const end = new Date(endRaw);
    if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end.getTime() > start.getTime()) {
      return { startIso: start.toISOString(), endIso: end.toISOString() };
    }
  }

  const date = cleanText(body.date, 20);
  const time = cleanText(body.start_time_local || body.startTimeLocal || body.startTime || body.time, 20);
  const duration = parseStaffDuration(body.duration_hours ?? body.durationHours);
  if (!date || !time || duration == null) return null;

  const start = DateTime.fromISO(`${date}T${time}`, { zone: availabilityService.BUSINESS_TZ });
  if (!start.isValid) return null;
  const end = start.plus({ minutes: Math.round(duration * 60) });
  return { startIso: start.toUTC().toISO(), endIso: end.toUTC().toISO() };
}

function staffAvailabilityConflictPayload(result) {
  const conflict = result?.conflict || null;
  const customer = Array.isArray(conflict?.customers) ? conflict.customers[0] : conflict?.customers;
  const boat = Array.isArray(conflict?.boats) ? conflict.boats[0] : conflict?.boats;
  return {
    available: Boolean(result?.available),
    reason: result?.reason || null,
    conflict: conflict
      ? {
          id: conflict.id,
          customer_name: customer?.full_name || customer?.email || customer?.phone || 'Existing booking',
          boat_name: boat?.name || 'Selected boat',
          start_time: conflict.start_time,
          end_time: conflict.end_time,
          status: conflict.status,
        }
      : null,
  };
}

async function findOrCreateStaffCustomer({ fullName, email, phone }) {
  const normalizedEmail = email ? email.toLowerCase() : '';
  if (normalizedEmail) {
    const { data: existing, error } = await supabase
      .from('customers')
      .select('id, full_name, email, phone')
      .ilike('email', normalizedEmail)
      .maybeSingle();
    if (error) throw error;
    if (existing?.id) {
      const { data: updated, error: updateError } = await supabase
        .from('customers')
        .update({
          full_name: fullName,
          phone,
          email: normalizedEmail,
        })
        .eq('id', existing.id)
        .select('id, full_name, email, phone')
        .single();
      if (updateError) throw updateError;
      return updated || existing;
    }
  }

  if (phone) {
    const { data: existingByPhone, error } = await supabase
      .from('customers')
      .select('id, full_name, email, phone')
      .eq('phone', phone)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (existingByPhone?.id) return existingByPhone;
  }

  const { data, error } = await supabase
    .from('customers')
    .insert({
      full_name: fullName,
      email: normalizedEmail || null,
      phone,
      sms_opt_in: false,
    })
    .select('id, full_name, email, phone')
    .single();
  if (error) throw error;
  return data;
}

app.post('/api/admin/staff-bookings/check', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const boatId = cleanText(req.body?.boat_id || req.body?.boatId, 80);
    const times = staffBookingTimes(req.body || {});
    if (!boatId || !times) {
      return res.status(400).json({ error: 'Boat, date, start time, and duration are required.' });
    }

    const result = await availabilityService.checkBookingSlotAvailability({
      boatId,
      startTime: times.startIso,
      endTime: times.endIso,
      location: cleanText(req.body?.rental_location || req.body?.location, 80) || null,
      excludeBookingId: cleanText(req.body?.exclude_booking_id || req.body?.excludeBookingId, 80) || null,
    });
    return res.json(staffAvailabilityConflictPayload(result));
  } catch (err) {
    console.error('[admin-staff-bookings:check]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not check availability.' });
  }
});

app.get('/api/admin/staff-bookings/today', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const today = DateTime.now().setZone(availabilityService.BUSINESS_TZ).startOf('day');
    const { data, error } = await supabase
      .from('bookings')
      .select('id, start_time, end_time, status, payment_status, booking_source, rental_location, customers(full_name, phone, email), boats(name)')
      .gte('start_time', today.toUTC().toISO())
      .lt('start_time', today.plus({ days: 1 }).toUTC().toISO())
      .or('staff_created.eq.true,booking_source.eq.admin')
      .order('start_time', { ascending: true });
    if (error) throw error;
    return res.json({ bookings: Array.isArray(data) ? data : [] });
  } catch (err) {
    console.error('[admin-staff-bookings:today]', err);
    return res.status(500).json({ error: err.message || 'Could not load staff bookings.' });
  }
});

app.post('/api/admin/staff-bookings', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const body = req.body || {};
    const action = cleanText(body.action, 20) === 'hold' ? 'hold' : 'booking';
    const customerName = cleanText(body.customer_name || body.customerName, 160);
    const phone = cleanText(body.phone, 40);
    const email = cleanText(body.email, 160);
    const boatId = cleanText(body.boat_id || body.boatId, 80);
    const bookingType = cleanText(body.booking_type || body.bookingType, 40) === 'captain_charter'
      ? 'captain_charter'
      : 'rental';
    const location = cleanText(body.rental_location || body.location, 80);
    const passengerCount = Math.max(1, Math.floor(Number(body.passenger_count || body.passengerCount || 1) || 1));
    const durationHours = parseStaffDuration(body.duration_hours ?? body.durationHours);
    const times = staffBookingTimes(body);

    if (!customerName) return res.status(400).json({ error: 'Customer name is required.' });
    if (!boatId) return res.status(400).json({ error: 'Boat is required.' });
    if (!times || durationHours == null) return res.status(400).json({ error: 'Date, start time, and duration are required.' });

    const availability = await availabilityService.checkBookingSlotAvailability({
      boatId,
      startTime: times.startIso,
      endTime: times.endIso,
      location: location || null,
    });
    if (!availability.available) {
      return res.status(409).json({
        error: SLOT_TAKEN_USER_MESSAGE,
        availability: staffAvailabilityConflictPayload(availability),
      });
    }

    const { data: boat, error: boatError } = await supabase
      .from('boats')
      .select('id, name, hourly_rate, half_day_rate, full_day_rate, type')
      .eq('id', boatId)
      .maybeSingle();
    if (boatError) throw boatError;
    if (!boat?.id) return res.status(400).json({ error: 'Boat not found.' });

    const customer = await findOrCreateStaffCustomer({ fullName: customerName, email, phone });
    const originalPrice = parseStaffMoney(body.original_price ?? body.originalPrice, 0);
    const discount = parseStaffMoney(body.discount, 0);
    const finalPrice = parseStaffMoney(body.final_price ?? body.finalPrice, Math.max(0, originalPrice - discount));
    const paymentStatus = action === 'hold'
      ? 'pending'
      : normalizeStaffPaymentStatus(body.payment_status || body.paymentStatus);
    const paymentMethod = normalizeStaffPaymentMethod(body.payment_method || body.paymentMethod);
    const amountCollected = action === 'hold'
      ? 0
      : parseStaffMoney(body.amount_collected ?? body.amountCollected, paymentStatus === 'pending' ? 0 : finalPrice);
    const status = action === 'hold' ? 'hold' : 'confirmed';
    const captainIncluded = bookingType === 'captain_charter';

    const insert = {
      customer_id: customer.id,
      boat_id: boat.id,
      booking_type: bookingType === 'captain_charter' ? 'charter' : 'rental',
      charter_type: bookingType === 'captain_charter' ? 'captain_charter' : null,
      guest_count: passengerCount,
      rental_location: location || null,
      start_time: times.startIso,
      end_time: times.endIso,
      duration_hours: durationHours,
      rental_type: rentalTypeForHours(durationHours),
      captain_included: captainIncluded,
      captain_fee: captainIncluded ? roundMoney(CAPTAIN_HOURLY * durationHours) : 0,
      base_price: originalPrice,
      peak_surcharge: 0,
      security_deposit: 0,
      total_price: finalPrice,
      total_amount: finalPrice,
      deposit_amount: amountCollected,
      deposit_paid: amountCollected,
      balance_due: roundMoney(Math.max(0, finalPrice - amountCollected)),
      payment_status: paymentStatus,
      status,
      is_night_tour: false,
      is_rocket_tour: false,
      license_status: 'pending',
      insurance_status: bookingType === 'captain_charter' ? 'verified' : 'pending',
      waiver_signed: false,
      staff_created: true,
      staff_created_by: adminUser.id,
      booking_source: 'admin',
      payment_method: paymentMethod,
      payment_note: cleanText(body.payment_note || body.paymentNote, 500) || null,
      amount_collected: amountCollected,
      manual_discount_reason: cleanText(body.manual_discount_reason || body.manualDiscountReason, 500) || null,
      hold_expires_at: action === 'hold' ? DateTime.now().plus({ hours: 2 }).toUTC().toISO() : null,
      staff_notes: cleanText(body.staff_notes || body.staffNotes, 1000) || null,
      admin_notes: cleanText(body.staff_notes || body.staffNotes, 1000) || null,
      original_total: originalPrice,
      discount_amount: discount,
      final_total: finalPrice,
    };

    const { data: booking, error } = await supabase
      .from('bookings')
      .insert(insert)
      .select('id, status')
      .single();
    if (error) {
      if (isOverlapConstraintError(error)) {
        return res.status(409).json({ error: SLOT_TAKEN_USER_MESSAGE });
      }
      throw error;
    }

    return res.status(201).json({ booking, customer });
  } catch (err) {
    console.error('[admin-staff-bookings:create]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not create staff booking.' });
  }
});

function calendarRangeFromQuery(query) {
  const fromRaw = cleanText(query.from, 80);
  const toRaw = cleanText(query.to, 80);
  const now = DateTime.now().setZone(availabilityService.BUSINESS_TZ).startOf('week');
  const from = fromRaw ? new Date(fromRaw) : now.toJSDate();
  const to = toRaw ? new Date(toRaw) : now.plus({ days: 7 }).toJSDate();
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to.getTime() <= from.getTime()) {
    const err = new Error('Valid from and to range is required.');
    err.statusCode = 400;
    throw err;
  }
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

function normalizeCalendarBooking(row) {
  const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
  const boat = Array.isArray(row.boats) ? row.boats[0] : row.boats;
  return {
    ...row,
    customer_name: customer?.full_name || row.name || 'Unknown customer',
    customer_phone: customer?.phone || row.phone || null,
    customer_email: customer?.email || row.email || null,
    boat_name: boat?.name || 'Unassigned boat',
    boat_type: boat?.type || null,
  };
}

function bookingMatchesCalendarSearch(row, needle) {
  if (!needle) return true;
  const hay = [
    row.id,
    row.customer_name,
    row.customer_phone,
    row.customer_email,
    row.boat_name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(needle);
}

async function loadCalendarBlockedDates({ fromIso, toIso, boatId }) {
  const boat = cleanText(boatId, 80);
  let query = supabase
    .from('blocked_dates')
    .select('id, boat_id, start_time, end_time, title, reason, location, all_day, notes, created_at, updated_at')
    .lt('start_time', toIso)
    .gt('end_time', fromIso);
  if (boat) query = query.or(`boat_id.eq.${boat},boat_id.is.null`);
  const { data, error } = await query;
  if (!error) return Array.isArray(data) ? data : [];

  const rangeStartDate = fromIso.slice(0, 10);
  const rangeEndDateExclusive = toIso.slice(0, 10);
  let fallback = supabase
    .from('blocked_dates')
    .select('id, boat_id, start_date, end_date')
    .lt('start_date', rangeEndDateExclusive)
    .gte('end_date', rangeStartDate);
  if (boat) fallback = fallback.or(`boat_id.eq.${boat},boat_id.is.null`);
  const { data: dateRows, error: dateError } = await fallback;
  if (dateError) throw error;
  return (dateRows || []).map((row) => {
    const start = DateTime.fromISO(String(row.start_date), { zone: availabilityService.BUSINESS_TZ }).startOf('day');
    const end = DateTime.fromISO(String(row.end_date), { zone: availabilityService.BUSINESS_TZ }).startOf('day');
    return {
      id: row.id,
      boat_id: row.boat_id || null,
      start_time: start.toUTC().toISO(),
      end_time: end.plus({ days: 1 }).toUTC().toISO(),
      title: row.reason || 'Blocked Time',
      reason: row.reason || null,
      location: null,
      all_day: true,
      notes: null,
    };
  });
}

function normalizeCalendarBlock(row) {
  return {
    id: row.id,
    item_type: 'blocked_time',
    title: row.title || row.reason || 'Blocked Time',
    reason: row.reason || null,
    duty_type: null,
    assigned_to: null,
    boat_id: row.boat_id || null,
    location: row.location || null,
    start_time: row.start_time,
    end_time: row.end_time,
    all_day: Boolean(row.all_day),
    blocks_availability: true,
    priority: 'normal',
    notes: row.notes || null,
    completed: false,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function normalizeAdminCalendarItem(row) {
  return {
    id: row.id,
    item_type: row.item_type,
    title: row.title || (row.item_type === 'admin_duty' ? 'Admin Duty' : 'Blocked Time'),
    reason: row.reason || null,
    duty_type: row.duty_type || null,
    assigned_to: row.assigned_to || null,
    boat_id: row.boat_id || null,
    location: row.location || null,
    start_time: row.start_time,
    end_time: row.end_time,
    all_day: Boolean(row.all_day),
    blocks_availability: Boolean(row.blocks_availability),
    priority: row.priority || 'normal',
    notes: row.notes || null,
    completed: Boolean(row.completed),
    created_by: row.created_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function calendarItemTimes(body) {
  const allDay = Boolean(body.all_day || body.allDay);
  const startRaw = cleanText(body.start_time || body.startTime, 80);
  const endRaw = cleanText(body.end_time || body.endTime, 80);
  if (startRaw && endRaw) {
    const start = new Date(startRaw);
    const end = new Date(endRaw);
    if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start) {
      return { startIso: start.toISOString(), endIso: end.toISOString(), allDay };
    }
  }
  const date = cleanText(body.date, 20);
  if (!date) return null;
  if (allDay) {
    const start = DateTime.fromISO(date, { zone: availabilityService.BUSINESS_TZ }).startOf('day');
    const endDate = cleanText(body.end_date || body.endDate, 20) || date;
    const endDay = DateTime.fromISO(endDate, { zone: availabilityService.BUSINESS_TZ }).startOf('day');
    if (!endDay.isValid || endDay < start.startOf('day')) return null;
    return { startIso: start.toUTC().toISO(), endIso: endDay.plus({ days: 1 }).toUTC().toISO(), allDay };
  }
  const startTime = cleanText(body.start_time_local || body.startTimeLocal || body.startTime || '09:00', 20);
  const endTime = cleanText(body.end_time_local || body.endTimeLocal || body.endTime || '10:00', 20);
  const start = DateTime.fromISO(`${date}T${startTime}`, { zone: availabilityService.BUSINESS_TZ });
  const end = DateTime.fromISO(`${date}T${endTime}`, { zone: availabilityService.BUSINESS_TZ });
  if (!start.isValid || !end.isValid || end <= start) return null;
  return { startIso: start.toUTC().toISO(), endIso: end.toUTC().toISO(), allDay };
}

async function blockingCalendarItemConflicts({ boatId, startIso, endIso, excludeBlockedDateId = null, excludeItemId = null }) {
  const conflictQuery = supabase
    .from('bookings')
    .select('id, start_time, end_time, status, customers(full_name), boats(name)')
    .lt('start_time', endIso)
    .gt('end_time', startIso)
    .in('status', ['hold', 'pending', 'pending_verification', 'confirmed', 'ready_for_departure', 'completed']);
  const scopedBookings = boatId ? conflictQuery.eq('boat_id', boatId) : conflictQuery;
  const [bookingResult, blockedResult, itemResult] = await Promise.all([
    scopedBookings,
    loadCalendarBlockedDates({ fromIso: startIso, toIso: endIso, boatId }),
    supabase
      .from('admin_calendar_items')
      .select('id, title, boat_id, start_time, end_time, blocks_availability')
      .eq('blocks_availability', true)
      .lt('start_time', endIso)
      .gt('end_time', startIso),
  ]);
  const bookingConflicts = bookingResult.error ? [] : bookingResult.data || [];
  const blockConflicts = (blockedResult || []).filter((row) => String(row.id) !== String(excludeBlockedDateId || ''));
  const itemConflicts = itemResult.error
    ? []
    : (itemResult.data || []).filter((row) => String(row.id) !== String(excludeItemId || '') && (!row.boat_id || !boatId || row.boat_id === boatId));
  return {
    bookings: bookingConflicts.map((row) => ({
      id: row.id,
      customer_name: (Array.isArray(row.customers) ? row.customers[0] : row.customers)?.full_name || 'Existing booking',
      boat_name: (Array.isArray(row.boats) ? row.boats[0] : row.boats)?.name || 'Boat',
      start_time: row.start_time,
      end_time: row.end_time,
      status: row.status,
    })),
    blocked: blockConflicts,
    duties: itemConflicts,
  };
}

app.get('/api/admin/calendar-bookings', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const { fromIso, toIso } = calendarRangeFromQuery(req.query || {});
    const location = cleanText(req.query.location, 80);
    const boatId = cleanText(req.query.boatId || req.query.boat_id, 80);
    const bookingType = cleanText(req.query.bookingType || req.query.booking_type, 40);
    const status = cleanText(req.query.status, 40);
    const source = cleanText(req.query.source, 40).toLowerCase();
    const search = cleanText(req.query.search, 160).toLowerCase();

    let query = supabase
      .from('bookings')
      .select(
        'id, customer_id, boat_id, start_time, end_time, duration_hours, status, payment_status, booking_source, staff_created, rental_location, booking_type, charter_type, guest_count, total_price, total_amount, staff_notes, admin_notes, customers(full_name, email, phone), boats(id, name, type)'
      )
      .lt('start_time', toIso)
      .gt('end_time', fromIso)
      .order('start_time', { ascending: true });

    if (location) query = query.eq('rental_location', location);
    if (boatId) query = query.eq('boat_id', boatId);
    if (bookingType === 'rental') query = query.eq('booking_type', 'rental');
    if (bookingType === 'captain_charter') query = query.eq('booking_type', 'charter');
    if (status) query = query.eq('status', status);
    if (source === 'staff') query = query.eq('staff_created', true);
    if (source === 'website') query = query.not('booking_source', 'eq', 'admin');
    if (source === 'admin') query = query.eq('booking_source', 'admin');

    const [{ data, error }, blockedDates] = await Promise.all([
      query,
      loadCalendarBlockedDates({ fromIso, toIso, boatId }),
    ]);
    if (error) throw error;
    const bookings = (Array.isArray(data) ? data : [])
      .map(normalizeCalendarBooking)
      .filter((row) => bookingMatchesCalendarSearch(row, search));
    return res.json({ bookings, blockedDates, from: fromIso, to: toIso });
  } catch (err) {
    console.error('[admin-calendar-bookings:list]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not load calendar bookings.' });
  }
});

app.patch('/api/admin/calendar-bookings/:id', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid booking id.' });

    const { data: existing, error: existingError } = await supabase
      .from('bookings')
      .select('id, boat_id, start_time, end_time, status, captain_included')
      .eq('id', id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing?.id) return res.status(404).json({ error: 'Booking not found.' });

    const body = req.body || {};
    const action = cleanText(body.action, 40);
    const update = {};

    if (action === 'cancel') update.status = 'cancelled';
    if (action === 'complete') update.status = 'completed';
    if (action === 'confirm_hold') update.status = 'confirmed';

    const requestedStatus = cleanText(body.status, 40);
    if (requestedStatus) {
      const allowed = ['hold', 'pending', 'pending_verification', 'confirmed', 'ready_for_departure', 'cancelled', 'completed'];
      if (!allowed.includes(requestedStatus)) return res.status(400).json({ error: 'Invalid status.' });
      update.status = requestedStatus;
    }

    const nextBoatId = cleanText(body.boat_id || body.boatId, 80) || existing.boat_id;
    const nextStart = cleanText(body.start_time || body.startTime, 80) || existing.start_time;
    const nextEnd = cleanText(body.end_time || body.endTime, 80) || existing.end_time;
    const nextLocation = cleanText(body.rental_location || body.location, 80);

    if (body.boat_id || body.boatId) update.boat_id = nextBoatId;
    if (body.start_time || body.startTime) update.start_time = new Date(nextStart).toISOString();
    if (body.end_time || body.endTime) update.end_time = new Date(nextEnd).toISOString();
    if (body.rental_location || body.location) update.rental_location = nextLocation || null;
    if (body.payment_status || body.paymentStatus) {
      update.payment_status = normalizeStaffPaymentStatus(body.payment_status || body.paymentStatus, existing.payment_status || 'pending');
    }

    const scheduleChanged = Boolean(body.boat_id || body.boatId || body.start_time || body.startTime || body.end_time || body.endTime);
    const blocksAfterUpdate = !['cancelled'].includes(String(update.status || existing.status || ''));
    if (scheduleChanged && blocksAfterUpdate) {
      await availabilityService.assertBookingSlotAvailable({
        boatId: nextBoatId,
        startTime: nextStart,
        endTime: nextEnd,
        location: nextLocation || null,
        excludeBookingId: id,
      });
      update.duration_hours = roundMoney((new Date(nextEnd).getTime() - new Date(nextStart).getTime()) / (1000 * 60 * 60));
      update.rental_type = rentalTypeForHours(update.duration_hours);
      update.captain_fee = existing.captain_included ? roundMoney(CAPTAIN_HOURLY * update.duration_hours) : 0;
    }

    if (Object.keys(update).length === 0) return res.status(400).json({ error: 'No changes supplied.' });

    const { data, error } = await supabase
      .from('bookings')
      .update(update)
      .eq('id', id)
      .select(
        'id, customer_id, boat_id, start_time, end_time, duration_hours, status, payment_status, booking_source, staff_created, rental_location, booking_type, charter_type, guest_count, total_price, total_amount, staff_notes, admin_notes, customers(full_name, email, phone), boats(id, name, type)'
      )
      .single();
    if (error) {
      if (isOverlapConstraintError(error)) return res.status(409).json({ error: SLOT_TAKEN_USER_MESSAGE });
      throw error;
    }
    return res.json({ booking: normalizeCalendarBooking(data) });
  } catch (err) {
    console.error('[admin-calendar-bookings:update]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not update booking.' });
  }
});

app.get('/api/admin/calendar-items', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const { fromIso, toIso } = calendarRangeFromQuery(req.query || {});
    const boatId = cleanText(req.query.boatId || req.query.boat_id, 80);
    const includeCompleted = String(req.query.includeCompleted || '').toLowerCase() === 'true';
    const [blockedDates, itemResult] = await Promise.all([
      loadCalendarBlockedDates({ fromIso, toIso, boatId }),
      supabase
        .from('admin_calendar_items')
        .select('*')
        .lt('start_time', toIso)
        .gt('end_time', fromIso)
        .order('start_time', { ascending: true }),
    ]);
    if (itemResult.error) throw itemResult.error;
    const items = [
      ...(blockedDates || []).map(normalizeCalendarBlock),
      ...(itemResult.data || [])
        .filter((row) => !boatId || !row.boat_id || row.boat_id === boatId)
        .filter((row) => includeCompleted || !row.completed)
        .map(normalizeAdminCalendarItem),
    ];
    return res.json({ items, from: fromIso, to: toIso });
  } catch (err) {
    console.error('[admin-calendar-items:list]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not load calendar items.' });
  }
});

app.post('/api/admin/calendar-items', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const body = req.body || {};
    const itemType = cleanText(body.item_type || body.itemType, 40);
    if (!['blocked_time', 'admin_duty'].includes(itemType)) return res.status(400).json({ error: 'Choose Block Time or Admin Duty.' });
    const times = calendarItemTimes(body);
    if (!times) return res.status(400).json({ error: 'Valid date, start time, and end time are required.' });
    const boatId = cleanText(body.boat_id || body.boatId, 80) || null;
    const title = cleanText(body.title, 160) || (itemType === 'blocked_time' ? 'Blocked Time' : 'Admin Duty');
    const location = cleanText(body.location, 80) || null;
    const blocksAvailability = itemType === 'blocked_time' ? true : Boolean(body.blocks_availability || body.blocksAvailability);

    let conflicts = { bookings: [], blocked: [], duties: [] };
    if (blocksAvailability) {
      conflicts = await blockingCalendarItemConflicts({ boatId, startIso: times.startIso, endIso: times.endIso });
      const hasConflicts = conflicts.bookings.length > 0 || conflicts.blocked.length > 0 || conflicts.duties.length > 0;
      if (hasConflicts && !body.saveAnyway) {
        return res.status(409).json({ error: 'This block conflicts with existing calendar items.', conflicts });
      }
    }

    if (itemType === 'blocked_time') {
      const { data, error } = await supabase
        .from('blocked_dates')
        .insert({
          title,
          reason: cleanText(body.reason, 300) || title,
          boat_id: boatId,
          location,
          start_time: times.startIso,
          end_time: times.endIso,
          all_day: times.allDay,
          notes: cleanText(body.notes, 1000) || null,
          created_by: null,
        })
        .select('id, boat_id, start_time, end_time, title, reason, location, all_day, notes, created_at, updated_at')
        .single();
      if (error) throw error;
      return res.status(201).json({ item: normalizeCalendarBlock(data), conflicts });
    }

    const { data, error } = await supabase
      .from('admin_calendar_items')
      .insert({
        item_type: 'admin_duty',
        title,
        reason: cleanText(body.reason, 300) || null,
        duty_type: cleanText(body.duty_type || body.dutyType, 80) || null,
        assigned_to: cleanText(body.assigned_to || body.assignedTo, 120) || null,
        boat_id: boatId,
        location,
        start_time: times.startIso,
        end_time: times.endIso,
        all_day: times.allDay,
        blocks_availability: blocksAvailability,
        priority: ['low', 'normal', 'high'].includes(cleanText(body.priority, 20)) ? cleanText(body.priority, 20) : 'normal',
        notes: cleanText(body.notes, 1000) || null,
        completed: Boolean(body.completed),
        created_by: adminUser.id,
      })
      .select('*')
      .single();
    if (error) throw error;
    return res.status(201).json({ item: normalizeAdminCalendarItem(data), conflicts });
  } catch (err) {
    console.error('[admin-calendar-items:create]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not save calendar item.' });
  }
});

app.patch('/api/admin/calendar-items/:id', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid calendar item id.' });
    const body = req.body || {};
    const itemType = cleanText(body.item_type || body.itemType, 40);
    const table = itemType === 'blocked_time' ? 'blocked_dates' : 'admin_calendar_items';
    const times = calendarItemTimes(body);
    const boatId = cleanText(body.boat_id || body.boatId, 80) || null;
    const blocksAvailability = itemType === 'blocked_time' ? true : Boolean(body.blocks_availability || body.blocksAvailability);

    if (blocksAvailability && times) {
      const conflicts = await blockingCalendarItemConflicts({
        boatId,
        startIso: times.startIso,
        endIso: times.endIso,
        excludeBlockedDateId: itemType === 'blocked_time' ? id : null,
        excludeItemId: itemType === 'admin_duty' ? id : null,
      });
      const hasConflicts = conflicts.bookings.length > 0 || conflicts.blocked.length > 0 || conflicts.duties.length > 0;
      if (hasConflicts && !body.saveAnyway) {
        return res.status(409).json({ error: 'This item conflicts with existing calendar items.', conflicts });
      }
    }

    if (table === 'blocked_dates') {
      const update = {
        title: cleanText(body.title, 160) || 'Blocked Time',
        reason: cleanText(body.reason, 300) || cleanText(body.title, 160) || 'Blocked Time',
        boat_id: boatId,
        location: cleanText(body.location, 80) || null,
        all_day: times?.allDay ?? Boolean(body.all_day || body.allDay),
        notes: cleanText(body.notes, 1000) || null,
        updated_at: new Date().toISOString(),
      };
      if (times) {
        update.start_time = times.startIso;
        update.end_time = times.endIso;
      }
      const { data, error } = await supabase
        .from('blocked_dates')
        .update(update)
        .eq('id', id)
        .select('id, boat_id, start_time, end_time, title, reason, location, all_day, notes, created_at, updated_at')
        .single();
      if (error) throw error;
      return res.json({ item: normalizeCalendarBlock(data) });
    }

    const update = {
      title: cleanText(body.title, 160) || 'Admin Duty',
      reason: cleanText(body.reason, 300) || null,
      duty_type: cleanText(body.duty_type || body.dutyType, 80) || null,
      assigned_to: cleanText(body.assigned_to || body.assignedTo, 120) || null,
      boat_id: boatId,
      location: cleanText(body.location, 80) || null,
      all_day: times?.allDay ?? Boolean(body.all_day || body.allDay),
      blocks_availability: blocksAvailability,
      priority: ['low', 'normal', 'high'].includes(cleanText(body.priority, 20)) ? cleanText(body.priority, 20) : 'normal',
      notes: cleanText(body.notes, 1000) || null,
      completed: Boolean(body.completed),
      updated_at: new Date().toISOString(),
    };
    if (times) {
      update.start_time = times.startIso;
      update.end_time = times.endIso;
    }
    const { data, error } = await supabase.from('admin_calendar_items').update(update).eq('id', id).select('*').single();
    if (error) throw error;
    return res.json({ item: normalizeAdminCalendarItem(data) });
  } catch (err) {
    console.error('[admin-calendar-items:update]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not update calendar item.' });
  }
});

app.delete('/api/admin/calendar-items/:id', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    const itemType = cleanText(req.query.item_type || req.query.itemType, 40);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid calendar item id.' });
    const table = itemType === 'blocked_time' ? 'blocked_dates' : 'admin_calendar_items';
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin-calendar-items:delete]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not delete calendar item.' });
  }
});

async function loadAdminBookingDetail(id) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(
      '*, customers(id, full_name, email, phone), boats(id, name, type, hourly_rate, half_day_rate, full_day_rate), waivers(id), user_verifications(*)'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!booking?.id) return null;

  const [{ count: lifetimeBookings }, { data: activity }, { data: communications }] = await Promise.all([
    booking.customer_id
      ? supabase
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', booking.customer_id)
      : Promise.resolve({ count: 0 }),
    supabase
      .from('booking_activity_events')
      .select('id, event_type, actor_type, message, payload, created_at')
      .eq('booking_id', id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('booking_communications')
      .select('id, channel, message_type, recipient, subject, body, sent_by, sent_at, status, provider_message_id, error_message, reviewed_at, reviewed_by, created_at')
      .eq('booking_id', id)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  const events = Array.isArray(activity) ? activity : [];
  if (events.length === 0) {
    events.push({
      id: `created-${booking.id}`,
      event_type: 'booking_created',
      actor_type: booking.staff_created ? 'admin' : 'system',
      message: booking.staff_created ? 'Created by Admin' : 'Created by Website',
      payload: {},
      created_at: booking.created_at,
    });
  }

  return {
    booking,
    lifetimeBookings: Number(lifetimeBookings || 0),
    timeline: events,
    communications: Array.isArray(communications) ? communications : [],
  };
}

function bookingDetailUpdateFromBody(body) {
  const out = {};
  const setText = (column, keys, max = 500) => {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        out[column] = cleanText(body[key], max) || null;
        return;
      }
    }
  };
  const setMoney = (column, keys) => {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        out[column] = parseStaffMoney(body[key], 0);
        return;
      }
    }
  };
  setText('rental_location', ['rental_location', 'location'], 80);
  setText('booking_source', ['booking_source', 'bookingSource'], 80);
  setText('payment_method', ['payment_method', 'paymentMethod'], 40);
  setText('payment_note', ['payment_note', 'paymentNote'], 500);
  setText('manual_discount_reason', ['manual_discount_reason', 'manualDiscountReason'], 500);
  setText('staff_notes', ['staff_notes', 'staffNotes'], 2000);
  setText('admin_notes', ['internal_notes', 'internalNotes'], 2000);
  setMoney('base_price', ['base_price', 'originalPrice']);
  setMoney('discount_amount', ['discount_amount', 'discount']);
  setMoney('total_price', ['total_price', 'finalPrice']);
  setMoney('final_total', ['final_total', 'finalPrice']);
  setMoney('deposit_paid', ['deposit_paid', 'depositPaid']);
  setMoney('amount_collected', ['amount_collected', 'amountCollected']);
  setMoney('balance_due', ['balance_due', 'remainingBalance']);
  const paymentStatus = cleanText(body.payment_status || body.paymentStatus, 40);
  if (paymentStatus) out.payment_status = normalizeStaffPaymentStatus(paymentStatus);
  const status = cleanText(body.status, 40);
  if (status && ['hold', 'pending', 'pending_verification', 'confirmed', 'ready_for_departure', 'cancelled', 'completed'].includes(status)) {
    out.status = status;
  }
  const bookingType = cleanText(body.booking_type || body.bookingType, 40);
  if (bookingType) {
    out.booking_type = bookingType === 'captain_charter' ? 'charter' : 'rental';
    out.charter_type = bookingType === 'captain_charter' ? 'captain_charter' : null;
    out.captain_included = bookingType === 'captain_charter';
  }
  const guestCount = Number(body.guest_count ?? body.passengerCount);
  if (Number.isFinite(guestCount) && guestCount > 0) out.guest_count = Math.floor(guestCount);
  return out;
}

app.get('/api/admin/bookings/:id', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid booking id.' });
    const detail = await loadAdminBookingDetail(id);
    if (!detail) return res.status(404).json({ error: 'Booking not found.' });
    return res.json(detail);
  } catch (err) {
    console.error('[admin-booking-detail:get]', err);
    return res.status(500).json({ error: err.message || 'Could not load booking.' });
  }
});

app.patch('/api/admin/bookings/:id', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid booking id.' });
    const { data: existing, error: existingError } = await supabase
      .from('bookings')
      .select('id, customer_id, boat_id, start_time, end_time, status')
      .eq('id', id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing?.id) return res.status(404).json({ error: 'Booking not found.' });

    const body = req.body || {};
    const customer = body.customer || {};
    if (existing.customer_id && Object.keys(customer).length > 0) {
      const customerUpdate = {};
      if (Object.prototype.hasOwnProperty.call(customer, 'full_name')) customerUpdate.full_name = cleanText(customer.full_name, 160);
      if (Object.prototype.hasOwnProperty.call(customer, 'email')) customerUpdate.email = cleanText(customer.email, 160) || null;
      if (Object.prototype.hasOwnProperty.call(customer, 'phone')) customerUpdate.phone = cleanText(customer.phone, 40);
      if (Object.keys(customerUpdate).length > 0) {
        const { error: customerErr } = await supabase.from('customers').update(customerUpdate).eq('id', existing.customer_id);
        if (customerErr) throw customerErr;
      }
    }

    const update = bookingDetailUpdateFromBody(body.booking || body);
    const nextBoatId = cleanText(body.boat_id || body.boatId || body.booking?.boat_id || body.booking?.boatId, 80) || existing.boat_id;
    const nextStart = cleanText(body.start_time || body.startTime || body.booking?.start_time || body.booking?.startTime, 80) || existing.start_time;
    const nextEnd = cleanText(body.end_time || body.endTime || body.booking?.end_time || body.booking?.endTime, 80) || existing.end_time;

    if (nextBoatId !== existing.boat_id) update.boat_id = nextBoatId;
    if (nextStart !== existing.start_time) update.start_time = new Date(nextStart).toISOString();
    if (nextEnd !== existing.end_time) update.end_time = new Date(nextEnd).toISOString();

    const scheduleChanged = Boolean(update.boat_id || update.start_time || update.end_time);
    if (scheduleChanged && String(update.status || existing.status) !== 'cancelled') {
      if (!nextBoatId) return res.status(400).json({ error: 'Select a boat first.' });
      await availabilityService.assertBookingSlotAvailable({
        boatId: nextBoatId,
        startTime: nextStart,
        endTime: nextEnd,
        location: update.rental_location || null,
        excludeBookingId: id,
      });
      update.duration_hours = roundMoney((new Date(nextEnd).getTime() - new Date(nextStart).getTime()) / (1000 * 60 * 60));
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase.from('bookings').update(update).eq('id', id);
      if (error) {
        if (isOverlapConstraintError(error)) return res.status(409).json({ error: SLOT_TAKEN_USER_MESSAGE });
        throw error;
      }
      await bookingReliability.insertActivity(supabase, {
        booking_id: id,
        event_type: 'booking_modified',
        actor_type: 'admin',
        actor_id: adminUser.id,
        message: 'Booking modified by admin.',
        payload: { fields: Object.keys(update) },
      });
    }

    const detail = await loadAdminBookingDetail(id);
    return res.json(detail);
  } catch (err) {
    console.error('[admin-booking-detail:update]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not update booking.' });
  }
});

app.post('/api/admin/bookings/:id/actions', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid booking id.' });
    const action = cleanText(req.body?.action, 60);
    const statusByAction = {
      confirm_hold: 'confirmed',
      cancel: 'cancelled',
      ready: 'ready_for_departure',
      complete: 'completed',
    };

    if (action === 'send_confirmation') {
      const detail = await loadAdminBookingDetail(id);
      const email = detail?.booking?.customers?.email || detail?.booking?.email || '';
      if (!email) return res.status(400).json({ error: 'Booking has no customer email.' });
      await sendBookingConfirmationInternal({ bookingId: id, email, source: 'admin' });
      return res.json({ ok: true });
    }

    if (action === 'delete_hold') {
      const { data: existing, error: existingError } = await supabase
        .from('bookings')
        .select('id, status')
        .eq('id', id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing?.id) return res.status(404).json({ error: 'Booking not found.' });
      if (existing.status !== 'hold') return res.status(400).json({ error: 'Only hold bookings can be deleted from the quick menu.' });
      await bookingReliability.insertActivity(supabase, {
        booking_id: id,
        event_type: 'delete_hold',
        actor_type: 'admin',
        actor_id: adminUser.id,
        message: 'Hold deleted by admin.',
      });
      const { error: deleteError } = await supabase.from('bookings').delete().eq('id', id);
      if (deleteError) throw deleteError;
      return res.json({ ok: true, deleted: true });
    }

    const nextStatus = statusByAction[action];
    if (!nextStatus) return res.status(400).json({ error: 'Unknown action.' });
    const { error } = await supabase.from('bookings').update({ status: nextStatus }).eq('id', id);
    if (error) throw error;
    await bookingReliability.insertActivity(supabase, {
      booking_id: id,
      event_type: action,
      actor_type: 'admin',
      actor_id: adminUser.id,
      message: action.replace(/_/g, ' '),
    });
    return res.json({ ok: true, status: nextStatus });
  } catch (err) {
    console.error('[admin-booking-detail:action]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not run booking action.' });
  }
});

app.post('/api/admin/bookings/:id/communications/preview', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid booking id.' });
    const messageType = cleanText(req.body?.message_type || req.body?.messageType, 80);
    const detail = await loadAdminBookingDetail(id);
    if (!detail) return res.status(404).json({ error: 'Booking not found.' });
    const preview = bookingCommunications.templateFor(messageType, detail);
    const [emailDuplicate, smsDuplicate] = await Promise.all([
      bookingCommunications.recentSuccessfulCommunication(supabase, id, messageType, 'email'),
      bookingCommunications.recentSuccessfulCommunication(supabase, id, messageType, 'sms'),
    ]);
    return res.json({
      preview,
      smsAvailable: bookingCommunications.smsConfigured(),
      duplicates: {
        email: emailDuplicate,
        sms: smsDuplicate,
      },
    });
  } catch (err) {
    console.error('[admin-communications:preview]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not preview communication.' });
  }
});

app.post('/api/admin/bookings/:id/communications/send', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid booking id.' });
    const messageType = cleanText(req.body?.message_type || req.body?.messageType, 80);
    const channels = Array.isArray(req.body?.channels)
      ? req.body.channels.map((channel) => cleanText(channel, 20)).filter((channel) => ['email', 'sms'].includes(channel))
      : [];
    const confirmDuplicate = Boolean(req.body?.confirmDuplicate || req.body?.confirm_duplicate);
    if (channels.length === 0) return res.status(400).json({ error: 'Choose email, SMS, or both.' });

    const detail = await loadAdminBookingDetail(id);
    if (!detail) return res.status(404).json({ error: 'Booking not found.' });
    const preview = bookingCommunications.templateFor(messageType, detail);

    const duplicateChecks = await Promise.all(
      channels.map(async (channel) => ({
        channel,
        duplicate: await bookingCommunications.recentSuccessfulCommunication(supabase, id, messageType, channel),
      }))
    );
    const duplicates = duplicateChecks.filter((row) => row.duplicate);
    if (duplicates.length > 0 && !confirmDuplicate) {
      return res.status(409).json({
        error: 'This message was already sent. Confirm duplicate send to continue.',
        duplicates,
        preview,
      });
    }

    const results = [];
    if (channels.includes('email')) {
      results.push(await bookingCommunications.sendEmail({
        supabase,
        resend,
        resendFrom,
        bookingId: id,
        adminUserId: adminUser.id,
        preview,
      }));
    }
    if (channels.includes('sms')) {
      results.push(await bookingCommunications.sendSms({
        supabase,
        bookingId: id,
        adminUserId: adminUser.id,
        preview,
      }));
    }

    await bookingReliability.insertActivity(supabase, {
      booking_id: id,
      event_type: 'communication_sent',
      actor_type: 'admin',
      actor_id: adminUser.id,
      message: `Admin sent ${messageType.replace(/_/g, ' ')} communication.`,
      payload: { channels, result_ids: results.map((row) => row.id) },
    });

    return res.json({ ok: true, results, smsAvailable: bookingCommunications.smsConfigured() });
  } catch (err) {
    console.error('[admin-communications:send]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not send communication.' });
  }
});

function adminEmailRecipientFromDetail(detail, override) {
  const booking = detail?.booking || {};
  const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers || {};
  const candidate = cleanText(override || customer.email || booking.email, 200).toLowerCase();
  return candidate;
}

function validateAdminCustomEmail(detail, body = {}) {
  const to = adminEmailRecipientFromDetail(detail, body.to || body.recipient || body.email);
  const subject = cleanText(body.subject, 200);
  const message = cleanText(body.message || body.body, 12000);
  if (!to) {
    const err = new Error('Customer email is missing.');
    err.statusCode = 400;
    throw err;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    const err = new Error('Customer email is invalid.');
    err.statusCode = 400;
    throw err;
  }
  if (!subject) {
    const err = new Error('Subject is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!message) {
    const err = new Error('Message is required.');
    err.statusCode = 400;
    throw err;
  }
  return { to, subject, message };
}

function customEmailHtml(message) {
  return String(message || '')
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `<p>${documentUrlValidation.escapeHtml(line)}</p>` : '<br>'))
    .join('');
}

async function logCustomEmailCommunication({
  bookingId,
  adminUserId,
  to,
  subject,
  message,
  status,
  providerMessageId = null,
  errorMessage = null,
}) {
  const { data, error } = await supabase
    .from('booking_communications')
    .insert({
      booking_id: bookingId,
      channel: 'email',
      message_type: 'custom_email',
      recipient: to,
      subject,
      body: message,
      sent_by: adminUserId,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
      status,
      provider_message_id: providerMessageId,
      error_message: errorMessage,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

app.get('/api/admin/email/config-check', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  return res.json({
    resendConfigured: Boolean(resend && resendFrom),
    senderEmail: resendFrom,
    apiKeyPresent: Boolean(resendApiKey),
  });
});

app.post('/api/admin/bookings/:id/email-customer/preview', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid booking id.' });
    const detail = await loadAdminBookingDetail(id);
    if (!detail) return res.status(404).json({ error: 'Booking not found.' });
    const email = validateAdminCustomEmail(detail, req.body || {});
    return res.json({
      preview: {
        from: resendFrom,
        to: email.to,
        subject: email.subject,
        message: email.message,
      },
      resendConfigured: Boolean(resend && resendFrom),
    });
  } catch (err) {
    console.error('[admin-email-customer:preview]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not preview email.' });
  }
});

app.post('/api/admin/bookings/:id/email-customer/send', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  let email = null;
  const id = cleanText(req.params.id, 80);
  try {
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid booking id.' });
    const detail = await loadAdminBookingDetail(id);
    if (!detail) return res.status(404).json({ error: 'Booking not found.' });
    email = validateAdminCustomEmail(detail, req.body || {});

    if (!resend) {
      await logCustomEmailCommunication({
        bookingId: id,
        adminUserId: adminUser.id,
        to: email.to,
        subject: email.subject,
        message: email.message,
        status: 'failed',
        errorMessage: 'Email service is not configured.',
      });
      return res.status(503).json({ error: 'Email service is not configured.' });
    }

    const result = await resend.emails.send({
      from: resendFrom,
      to: email.to,
      subject: email.subject,
      text: email.message,
      html: customEmailHtml(email.message),
    });

    if (result.error) {
      const row = await logCustomEmailCommunication({
        bookingId: id,
        adminUserId: adminUser.id,
        to: email.to,
        subject: email.subject,
        message: email.message,
        status: 'failed',
        errorMessage: result.error.message || 'Resend failed',
      });
      return res.status(502).json({ error: result.error.message || 'Could not send email.', communication: row });
    }

    const row = await logCustomEmailCommunication({
      bookingId: id,
      adminUserId: adminUser.id,
      to: email.to,
      subject: email.subject,
      message: email.message,
      status: 'sent',
      providerMessageId: result.data?.id || null,
    });

    await bookingReliability.insertActivity(supabase, {
      booking_id: id,
      event_type: 'custom_email_sent',
      actor_type: 'admin',
      actor_id: adminUser.id,
      message: 'Admin sent a custom customer email.',
      payload: { communication_id: row.id, recipient: email.to },
    });

    return res.json({ ok: true, communication: row });
  } catch (err) {
    console.error('[admin-email-customer:send]', err);
    if (email && isBookingUuidParam(id)) {
      try {
        await logCustomEmailCommunication({
          bookingId: id,
          adminUserId: adminUser.id,
          to: email.to,
          subject: email.subject,
          message: email.message,
          status: 'failed',
          errorMessage: err.message || 'Could not send email.',
        });
      } catch (logErr) {
        console.error('[admin-email-customer:send:log-failed]', logErr);
      }
    }
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not send email.' });
  }
});

function normalizeOutboxRow(row) {
  const booking = Array.isArray(row.bookings) ? row.bookings[0] : row.bookings || {};
  const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers || {};
  return {
    id: row.id,
    booking_id: row.booking_id,
    booking_status: booking.status || null,
    customer_name: customer.full_name || booking.name || 'Unknown customer',
    customer_email: customer.email || booking.email || null,
    channel: row.channel,
    message_type: row.message_type,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    status: row.status,
    sent_by: row.sent_by,
    sent_at: row.sent_at,
    created_at: row.created_at,
    provider_message_id: row.provider_message_id,
    error_message: row.error_message,
    reviewed_at: row.reviewed_at || null,
    reviewed_by: row.reviewed_by || null,
  };
}

function outboxSelectColumns(includeBody = false) {
  return [
    'id',
    'booking_id',
    'channel',
    'message_type',
    'recipient',
    'subject',
    includeBody ? 'body' : null,
    'status',
    'sent_by',
    'sent_at',
    'created_at',
    'provider_message_id',
    'error_message',
    'reviewed_at',
    'reviewed_by',
    'bookings(id, name, email, status, customers(full_name, email))',
  ].filter(Boolean).join(', ');
}

function applyOutboxFilters(query, reqQuery) {
  const from = cleanText(reqQuery.from, 40);
  const to = cleanText(reqQuery.to, 40);
  const channel = cleanText(reqQuery.channel, 20).toLowerCase();
  const status = cleanText(reqQuery.status, 40).toLowerCase();
  const messageType = cleanText(reqQuery.messageType || reqQuery.message_type, 80);
  const recipient = cleanText(reqQuery.recipient, 200);
  const bookingId = cleanText(reqQuery.bookingId || reqQuery.booking_id, 80);

  let q = query;
  if (from) q = q.gte('created_at', new Date(from).toISOString());
  if (to) {
    const end = new Date(to);
    if (Number.isFinite(end.getTime())) {
      end.setDate(end.getDate() + 1);
      q = q.lt('created_at', end.toISOString());
    }
  }
  if (['email', 'sms'].includes(channel)) q = q.eq('channel', channel);
  if (status) q = q.eq('status', status);
  if (messageType) q = q.eq('message_type', messageType);
  if (recipient) q = q.ilike('recipient', `%${recipient}%`);
  if (bookingId && isBookingUuidParam(bookingId)) q = q.eq('booking_id', bookingId);
  return q;
}

app.get('/api/admin/outbox', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 100) || 100, 1), 250);
    const search = cleanText(req.query.search, 200).toLowerCase();
    let query = supabase
      .from('booking_communications')
      .select(outboxSelectColumns(false))
      .order('created_at', { ascending: false })
      .limit(limit);
    query = applyOutboxFilters(query, req.query);
    const { data, error } = await query;
    if (error) throw error;
    let rows = (Array.isArray(data) ? data : []).map(normalizeOutboxRow);
    if (search) {
      rows = rows.filter((row) =>
        [row.customer_name, row.customer_email, row.recipient, row.subject, row.booking_id]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search))
      );
    }
    return res.json({ items: rows });
  } catch (err) {
    console.error('[admin-outbox:list]', err);
    return res.status(500).json({ error: err.message || 'Could not load outbox.' });
  }
});

app.get('/api/admin/outbox/:id', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid communication id.' });
    const { data, error } = await supabase
      .from('booking_communications')
      .select(outboxSelectColumns(true))
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Message not found.' });
    return res.json({ item: normalizeOutboxRow(data) });
  } catch (err) {
    console.error('[admin-outbox:get]', err);
    return res.status(500).json({ error: err.message || 'Could not load message.' });
  }
});

app.post('/api/admin/outbox/:id/resend', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid communication id.' });
    const { data, error } = await supabase
      .from('booking_communications')
      .select(outboxSelectColumns(true))
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Message not found.' });
    const row = normalizeOutboxRow(data);
    if (!row.recipient) return res.status(400).json({ error: 'Recipient is missing.' });

    const preview = {
      messageType: row.message_type,
      subject: row.subject || 'Launch Zone Charters',
      emailBody: row.body || '',
      emailHtml: customEmailHtml(row.body || ''),
      smsBody: row.body || '',
      recipients: {
        email: row.channel === 'email' ? row.recipient : '',
        phone: row.channel === 'sms' ? row.recipient : '',
        rawPhone: row.channel === 'sms' ? row.recipient : '',
      },
    };
    const resent =
      row.channel === 'email'
        ? await bookingCommunications.sendEmail({
            supabase,
            resend,
            resendFrom,
            bookingId: row.booking_id,
            adminUserId: adminUser.id,
            preview,
          })
        : await bookingCommunications.sendSms({
            supabase,
            bookingId: row.booking_id,
            adminUserId: adminUser.id,
            preview,
          });

    await bookingReliability.insertActivity(supabase, {
      booking_id: row.booking_id,
      event_type: 'communication_resent',
      actor_type: 'admin',
      actor_id: adminUser.id,
      message: `Admin resent ${row.message_type.replace(/_/g, ' ')} via ${row.channel}.`,
      payload: { original_communication_id: row.id, resent_communication_id: resent.id },
    });

    return res.json({ ok: true, item: resent });
  } catch (err) {
    console.error('[admin-outbox:resend]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not resend message.' });
  }
});

app.patch('/api/admin/outbox/:id/reviewed', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid communication id.' });
    const reviewed = req.body?.reviewed !== false;
    const { data, error } = await supabase
      .from('booking_communications')
      .update({
        reviewed_at: reviewed ? new Date().toISOString() : null,
        reviewed_by: reviewed ? adminUser.id : null,
      })
      .eq('id', id)
      .select(outboxSelectColumns(true))
      .single();
    if (error) throw error;
    return res.json({ ok: true, item: normalizeOutboxRow(data) });
  } catch (err) {
    console.error('[admin-outbox:reviewed]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not update review status.' });
  }
});

app.get('/api/admin/disputes/summary', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const summary = await disputeService.getDisputeSummary(supabase);
    return res.json(summary);
  } catch (err) {
    console.error('[admin-disputes:summary]', err);
    return res.status(500).json({ error: err.message || 'Could not load dispute summary.' });
  }
});

app.get('/api/admin/disputes', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const items = await disputeService.listDisputes(supabase, {
      status: cleanText(req.query.status, 40),
      search: cleanText(req.query.search, 200),
      limit: req.query.limit,
    });
    return res.json({ items });
  } catch (err) {
    console.error('[admin-disputes:list]', err);
    return res.status(500).json({ error: err.message || 'Could not load disputes.' });
  }
});

app.get('/api/admin/disputes/:id', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid dispute id.' });
    const detail = await disputeService.loadDisputeDetail(supabase, id);
    if (!detail) return res.status(404).json({ error: 'Dispute not found.' });
    return res.json(detail);
  } catch (err) {
    console.error('[admin-disputes:get]', err);
    return res.status(500).json({ error: err.message || 'Could not load dispute.' });
  }
});

app.get('/api/admin/bookings/:id/dispute', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid booking id.' });
    const detail = await disputeService.getDisputeForBooking(supabase, id);
    return res.json(detail || { dispute: null, notes: [] });
  } catch (err) {
    console.error('[admin-booking-dispute:get]', err);
    return res.status(500).json({ error: err.message || 'Could not load booking dispute.' });
  }
});

app.post('/api/admin/disputes/:id/notes', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid dispute id.' });
    const { data: existing, error: existingError } = await supabase
      .from('stripe_disputes')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing?.id) return res.status(404).json({ error: 'Dispute not found.' });
    const note = await disputeService.addDisputeNote(supabase, {
      disputeId: id,
      adminId: adminUser.id,
      noteText: req.body?.note_text || req.body?.noteText || req.body?.text,
    });
    return res.json({ ok: true, note });
  } catch (err) {
    console.error('[admin-disputes:note]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not add note.' });
  }
});

app.get('/api/admin/disputes/:id/evidence-summary', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid dispute id.' });
    const result = await disputeEvidenceService.buildEvidenceSummary(supabase, stripe, { disputeId: id });
    return res.json(result);
  } catch (err) {
    console.error('[admin-disputes:evidence]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not generate evidence summary.' });
  }
});

app.get('/api/admin/bookings/:id/evidence-summary', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid booking id.' });
    const linked = await disputeService.getDisputeForBooking(supabase, id);
    const result = await disputeEvidenceService.buildEvidenceSummary(supabase, stripe, {
      disputeId: linked?.dispute?.id || null,
      bookingId: id,
    });
    return res.json(result);
  } catch (err) {
    console.error('[admin-booking-evidence]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not generate evidence summary.' });
  }
});

app.get('/api/admin/disputes/:id/evidence-pdf', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid dispute id.' });
    const pkg = await disputeExportService.loadEvidencePackage(supabase, stripe, { disputeId: id });
    const pdfBuffer = await disputeExportService.buildEvidencePdf(pkg);
    await disputeExportService.recordEvidenceExport(supabase, {
      disputeId: id,
      bookingId: pkg.bookingId,
      adminId: adminUser.id,
      format: 'pdf',
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="dispute-evidence-${id.slice(0, 8)}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('[admin-disputes:evidence-pdf]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not generate evidence PDF.' });
  }
});

app.get('/api/admin/disputes/:id/evidence-zip', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid dispute id.' });
    const pkg = await disputeExportService.loadEvidencePackage(supabase, stripe, { disputeId: id });
    const zipBuffer = await disputeExportService.buildEvidenceZip(supabase, pkg);
    await disputeExportService.recordEvidenceExport(supabase, {
      disputeId: id,
      bookingId: pkg.bookingId,
      adminId: adminUser.id,
      format: 'zip',
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="dispute-evidence-${id.slice(0, 8)}.zip"`);
    return res.send(zipBuffer);
  } catch (err) {
    console.error('[admin-disputes:evidence-zip]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not generate evidence ZIP.' });
  }
});

app.post('/api/admin/disputes/:id/submit-stripe-evidence', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid dispute id.' });
    const result = await disputeExportService.submitEvidenceToStripe(stripe, supabase, {
      disputeId: id,
      adminId: adminUser.id,
    });
    return res.json(result);
  } catch (err) {
    console.error('[admin-disputes:submit-stripe-evidence]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not submit evidence to Stripe.' });
  }
});

app.get('/api/admin/bookings/:id/evidence-pdf', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid booking id.' });
    const linked = await disputeService.getDisputeForBooking(supabase, id);
    const pkg = await disputeExportService.loadEvidencePackage(supabase, stripe, {
      disputeId: linked?.dispute?.id || null,
      bookingId: id,
    });
    const pdfBuffer = await disputeExportService.buildEvidencePdf(pkg);
    await disputeExportService.recordEvidenceExport(supabase, {
      disputeId: linked?.dispute?.id || null,
      bookingId: id,
      adminId: adminUser.id,
      format: 'pdf',
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="booking-evidence-${id.slice(0, 8)}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('[admin-booking-evidence-pdf]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not generate evidence PDF.' });
  }
});

app.get('/api/admin/bookings/:id/evidence-zip', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid booking id.' });
    const linked = await disputeService.getDisputeForBooking(supabase, id);
    const pkg = await disputeExportService.loadEvidencePackage(supabase, stripe, {
      disputeId: linked?.dispute?.id || null,
      bookingId: id,
    });
    const zipBuffer = await disputeExportService.buildEvidenceZip(supabase, pkg);
    await disputeExportService.recordEvidenceExport(supabase, {
      disputeId: linked?.dispute?.id || null,
      bookingId: id,
      adminId: adminUser.id,
      format: 'zip',
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="booking-evidence-${id.slice(0, 8)}.zip"`);
    return res.send(zipBuffer);
  } catch (err) {
    console.error('[admin-booking-evidence-zip]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not generate evidence ZIP.' });
  }
});

function moneyNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeOpsBooking(row) {
  const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
  const boat = Array.isArray(row.boats) ? row.boats[0] : row.boats;
  const total = moneyNumber(row.final_total ?? row.total_price ?? row.total_amount);
  const deposits = moneyNumber(row.deposit_paid ?? row.deposit_amount) + moneyNumber(row.amount_collected);
  const outstanding = moneyNumber(row.balance_due ?? Math.max(0, total - deposits));
  return {
    id: row.id,
    customer_name: customer?.full_name || row.name || 'Unknown customer',
    customer_phone: customer?.phone || row.phone || null,
    customer_email: customer?.email || row.email || null,
    boat_id: row.boat_id,
    boat_name: boat?.name || 'Unassigned boat',
    boat_type: boat?.type || null,
    location: row.rental_location || null,
    start_time: row.start_time,
    end_time: row.end_time,
    passenger_count: row.guest_count || row.passenger_count || 1,
    payment_status: row.payment_status || 'pending',
    status: row.status,
    booking_source: row.booking_source || (row.staff_created ? 'admin' : 'website'),
    booking_type: row.booking_type,
    charter_type: row.charter_type,
    waiver_done: Boolean(row.waiver_signed || (Array.isArray(row.waivers) && row.waivers.length > 0)),
    insurance_done: ['submitted', 'verified'].includes(String(row.insurance_status || '')),
    license_done: String(row.license_status || '') === 'verified' || Boolean(row.license_url),
    ready_for_departure: row.status === 'ready_for_departure' || row.status === 'completed',
    hold_expires_at: row.hold_expires_at || null,
    total,
    deposits,
    outstanding,
  };
}

function revenueForRows(rows) {
  const bookings = rows.filter((row) => row.status !== 'cancelled');
  const revenue = bookings.reduce((sum, row) => sum + moneyNumber(row.final_total ?? row.total_price ?? row.total_amount), 0);
  const deposits = bookings.reduce((sum, row) => sum + moneyNumber(row.deposit_paid ?? row.deposit_amount) + moneyNumber(row.amount_collected), 0);
  const outstanding = bookings.reduce((sum, row) => {
    const total = moneyNumber(row.final_total ?? row.total_price ?? row.total_amount);
    const collected = moneyNumber(row.deposit_paid ?? row.deposit_amount) + moneyNumber(row.amount_collected);
    return sum + moneyNumber(row.balance_due ?? Math.max(0, total - collected));
  }, 0);
  return {
    bookings: bookings.length,
    revenue: roundMoney(revenue),
    deposits: roundMoney(deposits),
    outstandingBalance: roundMoney(outstanding),
    averageBookingValue: bookings.length ? roundMoney(revenue / bookings.length) : 0,
  };
}

function actionItemsForBookings(bookings) {
  const items = [];
  const now = Date.now();
  const endOfToday = DateTime.now().setZone(availabilityService.BUSINESS_TZ).endOf('day').toMillis();
  for (const booking of bookings) {
    if (booking.status === 'cancelled' || booking.status === 'completed') continue;
    const startMs = new Date(booking.start_time).getTime();
    const base = {
      booking_id: booking.id,
      customer_name: booking.customer_name,
      boat_name: booking.boat_name,
      start_time: booking.start_time,
    };
    if (!booking.waiver_done) items.push({ ...base, type: 'missing_waiver', label: 'Missing waiver', urgency: 10 });
    if (!booking.insurance_done && booking.booking_type !== 'charter') items.push({ ...base, type: 'missing_insurance', label: 'Missing insurance', urgency: 9 });
    if (!booking.license_done) items.push({ ...base, type: 'missing_license', label: 'Missing license/documents', urgency: 8 });
    if (booking.outstanding > 0) items.push({ ...base, type: 'outstanding_balance', label: `Owes $${booking.outstanding.toFixed(2)}`, urgency: 7 });
    if (booking.status === 'pending_verification') items.push({ ...base, type: 'pending_verification', label: 'Pending verification', urgency: 8 });
    if (booking.status === 'hold' && booking.hold_expires_at) {
      const exp = new Date(booking.hold_expires_at).getTime();
      if (Number.isFinite(exp) && exp >= now && exp <= endOfToday) {
        items.push({ ...base, type: 'hold_expires_today', label: 'Hold expires today', urgency: 11, expires_at: booking.hold_expires_at });
      }
    }
    if (Number.isFinite(startMs) && startMs >= now && startMs <= now + 2 * 60 * 60 * 1000) {
      items.push({ ...base, type: 'upcoming_departure', label: 'Departure within 2 hours', urgency: 12 });
    }
  }
  return items.sort((a, b) => b.urgency - a.urgency || new Date(a.start_time).getTime() - new Date(b.start_time).getTime()).slice(0, 50);
}

app.get('/api/admin/operations-dashboard', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const now = DateTime.now().setZone(availabilityService.BUSINESS_TZ);
    const todayStart = now.startOf('day');
    const todayEnd = todayStart.plus({ days: 1 });
    const weekStart = now.startOf('week');
    const weekEnd = weekStart.plus({ weeks: 1 });
    const monthStart = now.startOf('month');
    const monthEnd = monthStart.plus({ months: 1 });
    const upcomingEnd = todayStart.plus({ days: 14 });

    const bookingSelect =
      'id, customer_id, boat_id, start_time, end_time, status, payment_status, booking_source, staff_created, rental_location, booking_type, charter_type, guest_count, waiver_signed, license_status, insurance_status, license_url, insurance_url, hold_expires_at, final_total, total_price, total_amount, deposit_paid, deposit_amount, amount_collected, balance_due, customers(full_name, email, phone), boats(id, name, type), waivers(id)';

    const [
      boatsResult,
      todayResult,
      upcomingResult,
      weekRevenueResult,
      monthRevenueResult,
      blockedResult,
      activityResult,
      commsResult,
      weatherResult,
    ] = await Promise.allSettled([
      supabase.from('boats').select('id, name, type, is_active').order('name'),
      supabase
        .from('bookings')
        .select(bookingSelect)
        .lt('start_time', todayEnd.toUTC().toISO())
        .gt('end_time', todayStart.toUTC().toISO())
        .order('start_time', { ascending: true }),
      supabase
        .from('bookings')
        .select(bookingSelect)
        .gte('start_time', todayStart.toUTC().toISO())
        .lt('start_time', upcomingEnd.toUTC().toISO())
        .order('start_time', { ascending: true }),
      supabase
        .from('bookings')
        .select('id, start_time, status, final_total, total_price, total_amount, deposit_paid, deposit_amount, amount_collected, balance_due')
        .gte('start_time', weekStart.toUTC().toISO())
        .lt('start_time', weekEnd.toUTC().toISO()),
      supabase
        .from('bookings')
        .select('id, start_time, status, final_total, total_price, total_amount, deposit_paid, deposit_amount, amount_collected, balance_due')
        .gte('start_time', monthStart.toUTC().toISO())
        .lt('start_time', monthEnd.toUTC().toISO()),
      loadCalendarBlockedDates({ fromIso: todayStart.toUTC().toISO(), toIso: todayEnd.toUTC().toISO(), boatId: null }),
      supabase
        .from('booking_activity_events')
        .select('id, booking_id, event_type, message, actor_type, created_at')
        .order('created_at', { ascending: false })
        .limit(40),
      supabase
        .from('booking_communications')
        .select('id, booking_id, channel, message_type, recipient, status, created_at')
        .order('created_at', { ascending: false })
        .limit(20),
      getMarineConditions({ locationKey: 'daytona' }),
    ]);

    const boats = boatsResult.status === 'fulfilled' && !boatsResult.value.error ? boatsResult.value.data || [] : [];
    const todayRows = todayResult.status === 'fulfilled' && !todayResult.value.error ? todayResult.value.data || [] : [];
    const upcomingRows = upcomingResult.status === 'fulfilled' && !upcomingResult.value.error ? upcomingResult.value.data || [] : [];
    const blockedDates = blockedResult.status === 'fulfilled' ? blockedResult.value || [] : [];
    const todayTrips = todayRows.map(normalizeOpsBooking);
    const upcomingBookings = upcomingRows.map(normalizeOpsBooking);

    const todayActive = todayTrips.filter((trip) => !['cancelled', 'completed'].includes(String(trip.status)));
    const blockedBoatIds = new Set((blockedDates || []).map((row) => row.boat_id).filter(Boolean));
    const boatStatus = boats.map((boat) => {
      const trips = todayActive.filter((trip) => trip.boat_id === boat.id);
      const inUse = trips.some((trip) => {
        const s = new Date(trip.start_time).getTime();
        const e = new Date(trip.end_time).getTime();
        return Number.isFinite(s + e) && s <= Date.now() && e >= Date.now();
      });
      let status = 'Available';
      if (boat.is_active === false) status = 'Out of Service';
      else if (blockedBoatIds.has(boat.id)) status = 'Blocked';
      else if (inUse) status = 'In Use';
      else if (trips.length > 0) status = 'Booked';
      return { ...boat, status, bookings: trips };
    });

    const sourceCounts = {};
    for (const row of upcomingBookings) {
      const key = String(row.booking_source || 'website').toLowerCase();
      sourceCounts[key] = (sourceCounts[key] || 0) + 1;
    }

    const activity =
      activityResult.status === 'fulfilled' && !activityResult.value.error ? activityResult.value.data || [] : [];
    const comms =
      commsResult.status === 'fulfilled' && !commsResult.value.error ? commsResult.value.data || [] : [];

    const alerts = actionItemsForBookings(upcomingBookings).filter((item) =>
      ['hold_expires_today', 'upcoming_departure', 'missing_waiver', 'missing_insurance', 'missing_license'].includes(item.type)
    );

    return res.json({
      today: todayStart.toISODate(),
      todayTrips,
      actionRequired: actionItemsForBookings(upcomingBookings),
      schedule: {
        boats: boatStatus,
        bookings: todayTrips,
        blockedDates,
      },
      boatStatus,
      revenue: {
        today: revenueForRows(todayRows),
        week: revenueForRows(weekRevenueResult.status === 'fulfilled' && !weekRevenueResult.value.error ? weekRevenueResult.value.data || [] : []),
        month: revenueForRows(monthRevenueResult.status === 'fulfilled' && !monthRevenueResult.value.error ? monthRevenueResult.value.data || [] : []),
      },
      bookingSources: sourceCounts,
      recentActivity: [
        ...activity.map((row) => ({ ...row, kind: 'activity' })),
        ...comms.map((row) => ({
          id: row.id,
          booking_id: row.booking_id,
          event_type: `communication_${row.message_type}`,
          message: `${row.channel?.toUpperCase()} ${row.message_type?.replace(/_/g, ' ')} ${row.status}`,
          created_at: row.created_at,
          kind: 'communication',
        })),
      ]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 40),
      weather:
        weatherResult.status === 'fulfilled'
          ? weatherResult.value
          : { success: false, error: weatherResult.reason?.message || 'Weather unavailable' },
      alerts,
    });
  } catch (err) {
    console.error('[admin-operations-dashboard]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not load operations dashboard.' });
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
 * Single Captain's Log article by slug (service role — fallback when browser Supabase fails).
 * GET /api/captains-log/:slug
 */
app.get('/api/captains-log/:slug', async (req, res) => {
  try {
    if (!supabaseConfigured) {
      return res.status(503).json({ error: 'Server not configured' });
    }
    const slug = String(req.params.slug || '').trim();
    if (!slug) {
      return res.status(400).json({ error: 'Slug is required' });
    }

    const { data, error } = await supabase
      .from('captains_log')
      .select('id, title, slug, content, image_url, image_alt, category, created_at')
      .eq('slug', slug)
      .maybeSingle();

    if (error) {
      console.error('[api/captains-log/:slug]', error.message);
      return res.status(500).json({ error: error.message || 'Could not load article' });
    }
    if (!data) {
      return res.status(404).json({ error: 'Article not found' });
    }
    return res.json({ article: data });
  } catch (err) {
    console.error('[api/captains-log/:slug]', err?.stack || err);
    return res.status(500).json({ error: err?.message || 'Could not load article' });
  }
});

/**
 * Browser admin check fallback — uses service role + JWT (never trust email query param alone).
 * GET /api/admin/verify — Authorization: Bearer &lt;access_token&gt;
 * Response: { isAdmin: boolean }
 */
app.get('/api/admin/verify', async (req, res) => {
  try {
    if (!supabaseConfigured) {
      return res.status(503).json({ error: 'Server not configured' });
    }
    const authHeader = req.headers.authorization || '';
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const jwt = m[1].trim();
    const { data: udat, error: authErr } = await authGetUserWithRetry(jwt);
    if (authErr || !udat?.user) {
      if (isSupabaseNetworkError(authErr)) {
        return res.status(503).json({
          error:
            authErr?.message ||
            'Cannot reach Supabase Auth. Check server connectivity and SUPABASE_* env on the API host.',
        });
      }
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const uid = udat.user.id;
    const { data: admById, error: errById } = await supabase
      .from('admins')
      .select('id')
      .eq('id', uid)
      .maybeSingle();
    if (!errById && admById) {
      return res.json({ isAdmin: true });
    }
    const email = (udat.user.email || '').trim();
    if (email) {
      const { data: admByEmail, error: errByEmail } = await supabase
        .from('admins')
        .select('id')
        .ilike('email', email)
        .maybeSingle();
      if (!errByEmail && admByEmail) {
        return res.json({ isAdmin: true });
      }
    }
    return res.json({ isAdmin: false });
  } catch (err) {
    console.error('[api/admin/verify]', err?.stack || err);
    return res.status(500).json({ error: err?.message || 'Verification failed' });
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
      minLeadHours: availabilityService.MIN_LEAD_HOURS,
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
      minLeadHours: availabilityService.MIN_LEAD_HOURS,
      durationHours,
      slots,
    });
  } catch (err) {
    console.error('[api/availability/times]', err);
    return res.status(500).json({ error: err.message || 'Availability times failed' });
  }
});

/**
 * Captain charter calendar availability (Fri/Sat nights + admin blocks).
 * GET /api/availability/charter?from=&to=&charterType=bio|rocket|sunset
 */
app.get('/api/availability/charter', async (req, res) => {
  try {
    if (!supabaseConfigured) {
      return res.status(503).json({ error: 'Server not configured' });
    }
    const charterType = cleanText(req.query.charterType || req.query.charter_type, 40) || 'bio';
    let from = String(req.query.from || '').trim();
    let to = String(req.query.to || '').trim();
    if (!from || !to) {
      const d = availabilityService.defaultFromTo();
      if (!from) from = d.from;
      if (!to) to = d.to;
    }

    const dates = await availabilityService.listCharterDatesAvailability(from, to, charterType);
    return res.json({
      charterType,
      timezone: availabilityService.BUSINESS_TZ,
      captainNights: 'Friday/Saturday 5:00 PM – 4:00 AM',
      from,
      to,
      dates,
    });
  } catch (err) {
    console.error('[api/availability/charter]', err);
    return res.status(500).json({ error: err.message || 'Charter availability failed' });
  }
});

/**
 * Captain charter start times for one calendar day.
 * GET /api/availability/charter/times?date=YYYY-MM-DD&charterType=
 */
app.get('/api/availability/charter/times', async (req, res) => {
  try {
    if (!supabaseConfigured) {
      return res.status(503).json({ error: 'Server not configured' });
    }
    const date = String(req.query.date || '').trim();
    if (!date) {
      return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
    }
    const charterType = cleanText(req.query.charterType || req.query.charter_type, 40) || 'bio';
    const slots = await availabilityService.listCharterSlotsForDay(date, charterType);
    return res.json({
      date,
      charterType,
      timezone: availabilityService.BUSINESS_TZ,
      durationHours: 1,
      slots,
    });
  } catch (err) {
    console.error('[api/availability/charter/times]', err);
    return res.status(500).json({ error: err.message || 'Charter availability times failed' });
  }
});

function parseNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function parseNullableInteger(value) {
  const n = parseNullableNumber(value);
  if (n === null) return null;
  if (!Number.isFinite(n)) return NaN;
  return Math.max(0, Math.floor(n));
}

function parseNullableIso(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
}

function promoPayloadFromRequest(body, { partial = false } = {}) {
  const out = {};
  const errors = [];
  const hasAny = (...keys) => keys.some((key) => Object.prototype.hasOwnProperty.call(body, key));

  if (!partial || hasAny('code')) {
    const code = normalizePromoCode(body.code);
    if (!code) errors.push('Code is required.');
    else out.code = code.slice(0, 80);
  }

  if (!partial || hasAny('description')) {
    const description = String(body.description || '').trim();
    out.description = description ? description.slice(0, 500) : null;
  }

  if (!partial || hasAny('discount_type', 'discountType')) {
    const discountType = String(body.discount_type || body.discountType || '').trim().toLowerCase();
    if (!['percent', 'fixed'].includes(discountType)) errors.push('Discount type must be percent or fixed.');
    else out.discount_type = discountType;
  }

  if (!partial || hasAny('discount_value', 'discountValue')) {
    const discountValue = Number(body.discount_value ?? body.discountValue);
    if (!Number.isFinite(discountValue) || discountValue < 0) errors.push('Discount value must be a positive number.');
    else out.discount_value = roundMoney(discountValue);
  }

  if (!partial || hasAny('max_uses', 'maxUses')) {
    const maxUses = parseNullableInteger(body.max_uses ?? body.maxUses);
    if (Number.isNaN(maxUses)) errors.push('Max uses must be a whole number.');
    else out.max_uses = maxUses;
  }

  if (!partial || hasAny('active')) {
    out.active = body.active == null ? true : Boolean(body.active);
  }

  if (!partial || hasAny('applies_to', 'appliesTo')) {
    out.applies_to = normalizeAppliesTo(body.applies_to ?? body.appliesTo);
  }

  if (!partial || hasAny('starts_at', 'startsAt')) {
    const startsAt = parseNullableIso(body.starts_at ?? body.startsAt);
    if (startsAt === undefined) errors.push('Start date is invalid.');
    else out.starts_at = startsAt;
  }

  if (!partial || hasAny('expires_at', 'expiresAt')) {
    const expiresAt = parseNullableIso(body.expires_at ?? body.expiresAt);
    if (expiresAt === undefined) errors.push('Expiration date is invalid.');
    else out.expires_at = expiresAt;
  }

  return { payload: out, errors };
}

app.get('/api/admin/shop-orders', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const filter = req.query.filter != null ? String(req.query.filter) : null;
    const status = req.query.status != null ? String(req.query.status) : null;
    const out = await shopService.listShopOrdersForAdmin({ supabase, filter, status });
    return res.json(out);
  } catch (err) {
    console.error('[admin/shop-orders]', err);
    return res.status(500).json({ error: 'Could not load shop orders.' });
  }
});

app.get('/api/admin/shop-orders/:id', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = String(req.params.id || '').trim();
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid order id.' });
    const { data, error } = await supabase
      .from('shop_orders')
      .select(
        'id, stripe_session_id, payment_intent_id, stripe_charge_id, customer_name, email, phone, quantity, shipping_name, shipping_address, amount_paid, currency, status, product_slug, confirmation_email_sent_at, paid_at, fulfilled_at, canceled_at, abandoned_at, metadata, created_at, updated_at'
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Order not found.' });
    return res.json({
      order: {
        ...data,
        order_number: shopService.formatOrderNumber(data.id),
        is_paid: shopService.isShopOrderPaid(data),
        is_unpaid: shopService.isShopOrderUnpaid(data),
      },
    });
  } catch (err) {
    console.error('[admin/shop-orders:get]', err);
    return res.status(500).json({ error: 'Could not load shop order.' });
  }
});

app.patch('/api/admin/shop-orders/:id', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = String(req.params.id || '').trim();
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid order id.' });
    const nextStatus = shopService.normalizeShopStatus(req.body?.status);
    if (!nextStatus) {
      return res.status(400).json({
        error: `Invalid status. Allowed: ${shopService.SHOP_ORDER_STATUSES.join(', ')}`,
      });
    }
    const order = await shopService.updateShopOrderStatus({ supabase, orderId: id, nextStatus });
    return res.json({ order });
  } catch (err) {
    console.error('[admin/shop-orders:patch]', err);
    const code = err.statusCode || 500;
    return res.status(code).json({ error: err.message || 'Could not update shop order.' });
  }
});

app.get('/api/admin/promo-codes', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const { data, error } = await supabase
      .from('promo_codes')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ promoCodes: data || [] });
  } catch (err) {
    console.error('[admin-promo-codes:list]', err);
    return res.status(500).json({ error: 'Could not load promo codes.' });
  }
});

app.post('/api/admin/promo-codes', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const { payload, errors } = promoPayloadFromRequest(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors[0] });
    const { data, error } = await supabase
      .from('promo_codes')
      .insert(payload)
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Promo code already exists.' });
      throw error;
    }
    return res.status(201).json({ promoCode: data });
  } catch (err) {
    console.error('[admin-promo-codes:create]', err);
    return res.status(500).json({ error: 'Could not create promo code.' });
  }
});

app.patch('/api/admin/promo-codes/:id', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = String(req.params.id || '').trim();
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid promo code id.' });
    const { payload, errors } = promoPayloadFromRequest(req.body || {}, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors[0] });
    const update = { ...payload, updated_at: new Date().toISOString() };
    const { data, error } = await supabase
      .from('promo_codes')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Promo code already exists.' });
      throw error;
    }
    return res.json({ promoCode: data });
  } catch (err) {
    console.error('[admin-promo-codes:update]', err);
    return res.status(500).json({ error: 'Could not update promo code.' });
  }
});

app.delete('/api/admin/promo-codes/:id', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = String(req.params.id || '').trim();
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid promo code id.' });

    const { data: existing, error: lookupError } = await supabase
      .from('promo_codes')
      .select('id, code, used_count')
      .eq('id', id)
      .single();
    if (lookupError || !existing) throw lookupError || new Error('Promo code not found.');

    const { count: bookingUseCount, error: bookingUseError } = await supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('promo_code', existing.code);
    if (bookingUseError) throw bookingUseError;

    const safeToDelete = Number(existing.used_count || 0) === 0 && Number(bookingUseCount || 0) === 0;
    if (safeToDelete) {
      const { error: deleteError } = await supabase.from('promo_codes').delete().eq('id', id);
      if (deleteError) throw deleteError;
      return res.json({ deleted: true, deactivated: false, promoCode: existing });
    }

    const { data, error } = await supabase
      .from('promo_codes')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return res.json({ deleted: false, deactivated: true, promoCode: data });
  } catch (err) {
    console.error('[admin-promo-codes:delete]', err);
    return res.status(500).json({ error: 'Could not delete or deactivate promo code.' });
  }
});

app.post('/api/promo/validate', async (req, res) => {
  try {
    if (!supabaseConfigured) {
      return res.status(503).json({ error: 'Server not configured' });
    }
    if (!isProduction) {
      console.info('[promo-validate] payload', req.body || {});
    }
    const result = await validatePromoCode(supabase, req.body || {});
    if (!isProduction) {
      console.info('[promo-validate] result', result);
      if (!result.ok) console.info('[promo-validate] reason', result.reasonCode || 'server_validation_failed');
    }
    if (!result.ok) {
      return res.status(400).json({
        error: result.error || 'Invalid promo code.',
        reasonCode: result.reasonCode || 'server_validation_failed',
      });
    }
    return res.json({
      originalSubtotal: result.originalSubtotal,
      finalSubtotal: result.finalSubtotal,
      securityDeposit: result.securityDeposit,
      originalTotal: result.originalTotal,
      discountAmount: result.discountAmount,
      finalTotal: result.finalTotal,
      promoCode: result.promoCode,
      description: result.description || null,
    });
  } catch (err) {
    console.error('[promo-validate]', err);
    return res.status(500).json({ error: 'Could not validate promo code.' });
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

    const bookingMode = String(booking.bookingMode || '').trim().toLowerCase();
    const isCharterBooking = bookingMode === 'charter';
    if (!customer.full_name || !customer.email || !customer.phone || (!isCharterBooking && !booking.boat_id)) {
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

    const charterType = String(booking.charterType || '').trim().toLowerCase();
    const charterVariant = String(booking.charterVariant || '').trim().toLowerCase();
    const rentalType = String(booking.rental_type || '').trim().toLowerCase();
    const startTime = new Date(String(booking.start_time || ''));
    const endTime = new Date(String(booking.end_time || ''));
    const durationHoursRaw = Number(booking.duration_hours);
    const durationHours = Number.isFinite(durationHoursRaw) ? Number(durationHoursRaw) : NaN;

    if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime())) {
      return res.status(400).json({ error: 'Invalid start or end time.' });
    }
    if (!isCharterBooking) {
      try {
        assertBookingLeadTime(startTime.toISOString());
      } catch (leadErr) {
        return res.status(leadErr.statusCode || 409).json({ error: leadErr.message || SLOT_TOO_SOON_USER_MESSAGE });
      }
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
      isCharterBooking &&
      ['bio', 'rocket', 'sunset'].includes(charterType) &&
      (passengerCount < BIO_SHARED_MIN_GUESTS || passengerCount > BIO_SHARED_MAX_GUESTS)
    ) {
      return res.status(400).json({
        error: `Select ${BIO_SHARED_MIN_GUESTS}-${BIO_SHARED_MAX_GUESTS} guests.`,
      });
    }

    // Server-authoritative pricing: compute expected totals server-side.
    let boatRow = null;
    if (!isCharterBooking) {
      const { data, error: boatErr } = await supabase
        .from('boats')
        .select('id, name, hourly_rate, half_day_rate, full_day_rate, type')
        .eq('id', String(booking.boat_id))
        .maybeSingle();
      if (boatErr) {
        console.warn('[pricing-authoritative] boat lookup error', boatErr.message);
      }
      if (!data) {
        return res.status(400).json({ error: 'Boat not found for pricing validation' });
      }
      boatRow = data;
    }

    let expected = computeExpectedBookingTotals({
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

    const promoApplied = await applyPromoToExpectedTotals(expected, {
      supabaseAdmin: supabase,
      booking,
      boatRow,
      bookingMode,
    });
    if (promoApplied.error) {
      return res.status(400).json({ error: promoApplied.error });
    }
    expected = promoApplied.expected;
    const promoFields = promoApplied.promo;

    const clientTotal = roundMoney(Number(booking.total_price || 0));
    const clientDueToday = roundMoney(Number(booking.deposit_amount || 0));
    const clientFinalTotal = roundMoney(Number(booking.finalTotal || booking.final_total || 0));
    const clientOriginalTotal = roundMoney(Number(booking.originalTotal || booking.original_total || 0));
    const totalDiff = roundMoney(Math.abs(expected.totalPrice - clientTotal));
    const dueTodayDiff = roundMoney(Math.abs(expected.amountDueToday - clientDueToday));
    const finalTotalDiff =
      promoFields && clientFinalTotal > 0
        ? roundMoney(Math.abs(expected.totalPrice - clientFinalTotal))
        : 0;
    const originalTotalDiff =
      promoFields && clientOriginalTotal > 0
        ? roundMoney(Math.abs(promoFields.original_total - clientOriginalTotal))
        : 0;
    if (
      totalDiff > 0.01 ||
      dueTodayDiff > 0.01 ||
      finalTotalDiff > 0.01 ||
      originalTotalDiff > 0.01
    ) {
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
      if (isCharterBooking) {
        const startMs = startTime.getTime();
        if (!Number.isFinite(startMs) || startMs < Date.now()) {
          const err = new Error('This charter time is in the past. Please choose another time.');
          err.statusCode = 409;
          throw err;
        }
        await availabilityService.assertCharterSlotAvailable({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          charterType,
        });
      } else {
        assertBookingLeadTime(startTime.toISOString());
        await availabilityService.assertBookingSlotAvailable({
          boatId: booking.boat_id,
          startTime: booking.start_time,
          endTime: booking.end_time,
          location: booking.rentalLocation || booking.rental_location || null,
        });
      }
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
      expires_at: Math.floor((Date.now() + BOOKING_HOLD_TTL_MS) / 1000),
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
      success_url: `${domain}/booking-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${domain}/booking`,
      metadata: {
        booking_mode: bookingMode || 'rental',
        booking_type: bookingMode || 'rental',
        boat_id: isCharterBooking ? '' : String(booking.boat_id || ''),
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        customer_email: String(customer.email || '').trim().toLowerCase(),
      },
    });

    if (!session?.id || !session?.url) {
      return res.status(500).json({ error: 'No checkout URL' });
    }

    const authoritativeBooking = {
      ...booking,
      total_price: expected.totalPrice,
      deposit_amount: expected.amountDueToday,
      balance_due: roundMoney(expected.totalPrice - expected.amountDueToday),
      promoCode: promoFields?.promo_code || null,
      discountAmount: promoFields?.discount_amount ?? null,
      originalTotal: promoFields?.original_total ?? expected.totalPrice,
      finalTotal: promoFields?.final_total ?? expected.totalPrice,
    };

    const captainFeeStored =
      bookingMode === 'rental' ? roundMoney(expected.captainFee || 0) : Number(booking.captain_fee || 0);
    const basePriceStored = roundMoney(
      expected.basePrice != null ? expected.basePrice : Number(booking.base_price || 0)
    );
    const expiresAt = new Date(Date.now() + BOOKING_HOLD_TTL_MS).toISOString();

    const holdInsert = {
      customer_id: customerRow.id,
      boat_id: isCharterBooking ? null : String(authoritativeBooking.boat_id),
      booking_type: isCharterBooking ? 'charter' : 'rental',
      charter_type: isCharterBooking ? charterType || null : null,
      guest_count: isCharterBooking ? passengerCount : 1,
      total_amount: expected.totalPrice,
      start_time: authoritativeBooking.start_time,
      end_time: isCharterBooking
        ? new Date(new Date(String(authoritativeBooking.start_time)).getTime() + 60 * 60 * 1000).toISOString()
        : authoritativeBooking.end_time,
      duration_hours: isCharterBooking ? 1 : Number(authoritativeBooking.duration_hours || 0),
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
      promo_code: promoFields?.promo_code || null,
      discount_amount: promoFields?.discount_amount ?? 0,
      original_total: promoFields?.original_total ?? expected.totalPrice,
      final_total: promoFields?.final_total ?? expected.totalPrice,
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

    await bookingReliability.createOrUpdateBookingDraft(supabase, {
      checkout_session_id: session.id,
      customer_email: String(customer.email || '').trim().toLowerCase(),
      customer_name: String(customer.full_name || ''),
      customer_phone: String(customer.phone || ''),
      booking_payload: {
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
      status: 'checkout_created',
      amount_due: expected.amountDueToday,
      currency: 'usd',
      expires_at: expiresAt,
    });

    await bookingReliability.insertActivity(supabase, {
      checkout_session_id: session.id,
      event_type: 'checkout_created',
      message: 'Stripe Checkout Session created and inventory hold saved.',
      payload: {
        amount_due: expected.amountDueToday,
        expires_at: expiresAt,
        booking_mode: bookingMode,
      },
    });

    return res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[create-checkout-session]', err);
    return res.status(500).json({ error: err.message || 'Failed to create checkout session' });
  }
});

/** Success-page finalization: verify paid Stripe session and finalize (shared logic with webhook). */
app.post('/api/finalize-checkout-session', async (req, res) => {
  try {
    const sessionId = req.body && req.body.sessionId ? String(req.body.sessionId).trim() : '';
    const out = await finalizeBookingFromSession(sessionId, { requestIp: requestIpBestEffort(req), source: 'success_page' });
    return res.json({ bookingId: out.bookingId, email: out.email, alreadyFinalized: out.alreadyFinalized });
  } catch (err) {
    console.error('[finalize-checkout-session]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to finalize booking' });
  }
});

/** Shop: create Stripe Checkout for Observation Bottle (reuses shared Stripe client). */
app.post('/api/shop/create-checkout-session', async (req, res) => {
  try {
    if (!supabaseConfigured) {
      return res.status(503).json({ error: 'Server not configured' });
    }
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe not configured' });
    }
    const quantity = req.body?.quantity;
    const out = await shopService.createShopCheckoutSession({ stripe, supabase, quantity });
    return res.json(out);
  } catch (err) {
    console.error('[shop/create-checkout-session]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create checkout session' });
  }
});

/** Shop: success-page finalization (idempotent; shared pattern with booking finalize). */
app.post('/api/shop/finalize-checkout-session', async (req, res) => {
  try {
    if (!supabaseConfigured) {
      return res.status(503).json({ error: 'Server not configured' });
    }
    const sessionId = req.body && req.body.sessionId ? String(req.body.sessionId).trim() : '';
    const out = await shopService.finalizeShopOrderFromSession({
      stripe,
      supabase,
      resend,
      resendFrom,
      sessionId,
      source: 'success_page',
    });
    return res.json(out);
  } catch (err) {
    console.error('[shop/finalize-checkout-session]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to finalize shop order' });
  }
});

/** Shop: poll order status after redirect (fallback if finalize is slow). */
app.get('/api/shop/order-status', async (req, res) => {
  try {
    if (!supabaseConfigured) {
      return res.status(503).json({ status: 'error', error: 'Server not configured' });
    }
    const sessionId = String(req.query.sessionId || req.query.session_id || '').trim();
    const out = await shopService.getShopOrderStatus(supabase, sessionId);
    if (out.status === 'error') {
      return res.status(400).json(out);
    }
    return res.json(out);
  } catch (err) {
    console.error('[shop/order-status]', err);
    return res.status(500).json({ status: 'error', error: err.message || 'Could not load order status' });
  }
});

app.get('/api/checkout-status', async (req, res) => {
  try {
    if (!supabaseConfigured) {
      return res.status(503).json({ status: 'error', error: 'Server not configured' });
    }
    const sessionId = String(req.query.sessionId || req.query.session_id || '').trim();
    if (!sessionId) return res.status(400).json({ status: 'error', error: 'sessionId is required' });

    const { data: booking } = await supabase
      .from('bookings')
      .select('id, status, payment_status, booking_confirmation_sent_at')
      .or(
        [
          `checkout_session_id.eq.${sessionId}`,
          `stripe_checkout_session_id.eq.${sessionId}`,
          `stripe_payment_id.eq.${sessionId}`,
        ].join(',')
      )
      .maybeSingle();
    if (booking?.id) {
      return res.json({
        status: 'confirmed',
        bookingId: booking.id,
        bookingStatus: booking.status,
        paymentStatus: booking.payment_status,
        confirmationEmailSent: Boolean(booking.booking_confirmation_sent_at),
      });
    }

    const { data: recovery } = await supabase
      .from('payment_recovery_queue')
      .select('id, status, reason, error, retry_count, next_retry_at')
      .eq('checkout_session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recovery?.id) {
      return res.json({
        status: recovery.status === 'resolved' ? 'confirmed' : 'needs_staff',
        recovery,
      });
    }

    const { data: draft } = await supabase
      .from('booking_drafts')
      .select('id, status, expires_at, reminder_count')
      .eq('checkout_session_id', sessionId)
      .maybeSingle();
    if (draft?.id) {
      return res.json({ status: draft.status === 'completed' ? 'confirmed' : 'pending', draft });
    }

    return res.json({ status: 'pending' });
  } catch (err) {
    console.error('[checkout-status]', err);
    return res.status(500).json({ status: 'error', error: 'Could not load checkout status' });
  }
});

app.get('/api/booking-drafts/resume/:token', async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: 'Server not configured' });
    const token = String(req.params.token || '').trim();
    if (!/^[a-f0-9]{32,80}$/i.test(token)) return res.status(400).json({ error: 'Invalid resume token.' });
    const { data, error } = await supabase
      .from('booking_drafts')
      .select('id, status, booking_payload, checkout_session_id, expires_at, created_at')
      .eq('resume_token', token)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Booking draft not found.' });
    if (data.status === 'completed') return res.status(409).json({ error: 'This booking was already completed.' });
    return res.json({
      draft: {
        id: data.id,
        status: data.status,
        booking_payload: data.booking_payload || {},
        checkout_session_id: data.checkout_session_id || null,
        expires_at: data.expires_at || null,
      },
    });
  } catch (err) {
    console.error('[booking-drafts/resume]', err);
    return res.status(500).json({ error: 'Could not load booking draft.' });
  }
});

async function retryPaymentRecoveryById(recoveryId, actorId = null) {
  const { data: row, error } = await supabase
    .from('payment_recovery_queue')
    .select('*')
    .eq('id', recoveryId)
    .maybeSingle();
  if (error || !row) {
    const err = new Error(error?.message || 'Recovery item not found');
    err.statusCode = 404;
    throw err;
  }
  if (!stripe) {
    const err = new Error('Stripe not configured');
    err.statusCode = 503;
    throw err;
  }
  const checkoutSessionId = String(row.checkout_session_id || '').trim();
  let sessionId = checkoutSessionId;
  if (!sessionId && row.payment_intent_id) {
    const found = await bookingReliability.findCheckoutSessionForPaymentIntent(stripe, row.payment_intent_id);
    sessionId = found?.id || '';
  }
  if (!sessionId) {
    const err = new Error('Recovery item does not have a Checkout Session ID');
    err.statusCode = 400;
    throw err;
  }

  await supabase
    .from('payment_recovery_queue')
    .update({
      status: 'retrying',
      retry_count: Number(row.retry_count || 0) + 1,
      last_retry_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);

  try {
    const out = await finalizeBookingFromSession(sessionId, { requestIp: null, source: 'admin_retry' });
    await bookingReliability.resolveRecovery(supabase, { id: row.id }, { booking_id: out.bookingId });
    await bookingReliability.insertActivity(supabase, {
      booking_id: out.bookingId,
      checkout_session_id: sessionId,
      payment_intent_id: row.payment_intent_id || null,
      event_type: 'admin_retry_booking',
      actor_type: 'admin',
      actor_id: actorId,
      message: 'Admin retried payment recovery and finalized booking.',
    });
    return out;
  } catch (err) {
    await bookingReliability.enqueueRecovery(supabase, {
      ...row,
      status: 'open',
      retry_count: Number(row.retry_count || 0) + 1,
      error: err.message || 'Recovery retry failed',
      reason: row.reason || 'booking_failed',
    });
    throw err;
  }
}

app.get('/api/admin/payment-recovery', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const { data, error } = await supabase
      .from('payment_recovery_queue')
      .select('*, boats(id, name), bookings(id, status, payment_status)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return res.json({ items: data || [] });
  } catch (err) {
    console.error('[admin/payment-recovery:list]', err);
    return res.status(500).json({ error: 'Could not load payment recovery queue.' });
  }
});

app.post('/api/admin/payment-recovery/:id/retry', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = String(req.params.id || '').trim();
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid recovery id.' });
    const out = await retryPaymentRecoveryById(id, adminUser.id);
    return res.json({ ok: true, ...out });
  } catch (err) {
    console.error('[admin/payment-recovery:retry]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not retry recovery.' });
  }
});

app.post('/api/admin/payment-recovery/:id/resolve', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = String(req.params.id || '').trim();
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid recovery id.' });
    const status = ['resolved', 'ignored'].includes(String(req.body?.status || ''))
      ? String(req.body.status)
      : 'resolved';
    const { data, error } = await supabase
      .from('payment_recovery_queue')
      .update({
        status,
        resolved_at: new Date().toISOString(),
        resolved_by: adminUser.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return res.json({ item: data });
  } catch (err) {
    console.error('[admin/payment-recovery:resolve]', err);
    return res.status(500).json({ error: 'Could not resolve recovery item.' });
  }
});

app.post('/api/admin/payment-recovery/:id/refund', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
    const id = String(req.params.id || '').trim();
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid recovery id.' });
    const { data: row, error } = await supabase
      .from('payment_recovery_queue')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !row) return res.status(404).json({ error: error?.message || 'Recovery item not found' });
    const paymentIntent = String(row.payment_intent_id || '').trim();
    if (!paymentIntent) return res.status(400).json({ error: 'PaymentIntent ID is required to refund.' });
    const refund = await stripe.refunds.create({ payment_intent: paymentIntent });
    const { data: updated, error: updErr } = await supabase
      .from('payment_recovery_queue')
      .update({
        status: 'refunded',
        resolved_at: new Date().toISOString(),
        resolved_by: adminUser.id,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (updErr) throw updErr;
    await bookingReliability.insertActivity(supabase, {
      checkout_session_id: row.checkout_session_id || null,
      payment_intent_id: paymentIntent,
      event_type: 'refunded',
      actor_type: 'admin',
      actor_id: adminUser.id,
      message: 'Admin refunded unmatched payment.',
      payload: { refund_id: refund.id },
    });
    return res.json({ item: updated, refundId: refund.id });
  } catch (err) {
    console.error('[admin/payment-recovery:refund]', err);
    return res.status(500).json({ error: err.message || 'Could not refund recovery item.' });
  }
});

app.get('/api/admin/payment-recovery/:id/logs', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = String(req.params.id || '').trim();
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid recovery id.' });
    const { data: row, error } = await supabase
      .from('payment_recovery_queue')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !row) return res.status(404).json({ error: error?.message || 'Recovery item not found' });
    const webhookFilters = [
      row.checkout_session_id ? `checkout_session_id.eq.${row.checkout_session_id}` : '',
      row.payment_intent_id ? `payment_intent_id.eq.${row.payment_intent_id}` : '',
    ].filter(Boolean);
    const activityFilters = [
      row.booking_id ? `booking_id.eq.${row.booking_id}` : '',
      row.checkout_session_id ? `checkout_session_id.eq.${row.checkout_session_id}` : '',
      row.payment_intent_id ? `payment_intent_id.eq.${row.payment_intent_id}` : '',
    ].filter(Boolean);
    const [webhooks, activity] = await Promise.all([
      webhookFilters.length > 0
        ? supabase
        .from('stripe_webhook_events')
        .select('event_id, event_type, processing_status, error, received_at, processed_at')
        .or(webhookFilters.join(','))
        .order('received_at', { ascending: false })
        .limit(50)
        : Promise.resolve({ data: [], error: null }),
      activityFilters.length > 0
        ? supabase
        .from('booking_activity_events')
        .select('*')
        .or(activityFilters.join(','))
        .order('created_at', { ascending: false })
        .limit(100)
        : Promise.resolve({ data: [], error: null }),
    ]);
    return res.json({
      webhooks: webhooks.data || [],
      activity: activity.data || [],
      errors: [webhooks.error?.message, activity.error?.message].filter(Boolean),
    });
  } catch (err) {
    console.error('[admin/payment-recovery:logs]', err);
    return res.status(500).json({ error: 'Could not load recovery logs.' });
  }
});

const DEFAULT_RESEND_FROM = 'Joshua at Launch Zone Charters <joshua@launchzonecharters.com>';
const resendApiKey = process.env.RESEND_API_KEY;
const resendFrom =
  (process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM || DEFAULT_RESEND_FROM).trim() ||
  DEFAULT_RESEND_FROM;

const resend = resendApiKey ? new Resend(resendApiKey) : null;

const CONFIRM_EMAIL_RATE_WINDOW_MS = 60 * 1000;
const CONFIRM_EMAIL_RATE_MAX = 10;
const confirmEmailRateByIp = new Map();

function checkConfirmEmailRate(ip) {
  const key = String(ip || 'unknown').trim() || 'unknown';
  const now = Date.now();
  const prev = confirmEmailRateByIp.get(key);
  if (!prev || now - prev.windowStart > CONFIRM_EMAIL_RATE_WINDOW_MS) {
    confirmEmailRateByIp.set(key, { windowStart: now, count: 1 });
    return true;
  }
  if (prev.count >= CONFIRM_EMAIL_RATE_MAX) return false;
  prev.count += 1;
  return true;
}

function requireCronBearer(req, res) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  const auth = String(req.headers.authorization || '');
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!secret || bearer !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function sendBookingConfirmationInternal({ bookingId, email, source = 'server' }) {
  const bookingIdSafe = String(bookingId || '').trim();
  if (!bookingIdSafe || !isBookingUuidParam(bookingIdSafe)) {
    const err = new Error('Valid bookingId is required');
    err.statusCode = 400;
    throw err;
  }
  if (!supabaseConfigured) {
    const err = new Error('Server not configured');
    err.statusCode = 503;
    throw err;
  }

  const loaded = await bookingAccess.loadBookingWithCustomer(supabase, bookingIdSafe);
  if (!loaded.ok) {
    const err = new Error(loaded.message || 'Booking not found');
    err.statusCode = loaded.statusCode || 404;
    throw err;
  }

  const allowedStatuses = ['pending', 'pending_verification', 'confirmed', 'ready_for_departure'];
  if (!allowedStatuses.includes(String(loaded.booking.status || ''))) {
    const err = new Error('Booking is not eligible for confirmation email');
    err.statusCode = 400;
    throw err;
  }

  let emailSafe = email ? String(email).trim().toLowerCase() : '';
  if (emailSafe && normalizeEmailParam(loaded.customer.email) !== emailSafe) {
    const err = new Error('Email does not match this booking');
    err.statusCode = 403;
    throw err;
  }
  emailSafe = normalizeEmailParam(loaded.customer.email);
  if (!emailSafe) {
    const err = new Error('Could not resolve customer email');
    err.statusCode = 400;
    throw err;
  }

  if (loaded.booking.booking_confirmation_sent_at) {
    return { ok: true, alreadySent: true };
  }

  if (!resend) {
    const err = new Error('Email service not configured');
    err.statusCode = 503;
    throw err;
  }

  const emailHtml = documentUrlValidation.escapeHtml(emailSafe);
  const customerSend = resend.emails.send({
    from: resendFrom,
    to: emailSafe,
    subject: 'Your Launch Zone Booking Confirmation',
    html: `
      <p>Thank you for booking with Launch Zone Rentals.</p>
      <p><strong>Booking ID:</strong> ${documentUrlValidation.escapeHtml(bookingIdSafe)}</p>
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
            <p><strong>Booking ID:</strong> ${documentUrlValidation.escapeHtml(bookingIdSafe)}</p>
            <p><strong>Customer email:</strong> ${emailHtml}</p>
            <p><strong>Source:</strong> ${documentUrlValidation.escapeHtml(source)}</p>
          `,
        })
      : Promise.resolve({ data: null, error: null });

  const [customerResult, adminResult] = await Promise.all([customerSend, adminSend]);
  if (customerResult.error) {
    const err = new Error(customerResult.error.message || 'Failed to send customer email');
    err.statusCode = 500;
    throw err;
  }
  if (adminResult.error) {
    console.error('[send-booking-confirmation] admin notify Resend error:', adminResult.error);
  }

  await bookingCommunications.logAutomatedCommunication(supabase, {
    bookingId: bookingIdSafe,
    channel: 'email',
    messageType: 'automated_booking_confirmation',
    recipient: emailSafe,
    subject: 'Your Launch Zone Booking Confirmation',
    body: [
      'Thank you for booking with Launch Zone Rentals.',
      `Booking ID: ${bookingIdSafe}`,
      'We will follow up with pickup details and next steps.',
      'If you have questions, call 803-542-1761.',
    ].join('\n'),
    providerMessageId: customerResult.data?.id || null,
  });

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
    /* fail silently — do not affect booking */
  }

  await supabase
    .from('bookings')
    .update({ booking_confirmation_sent_at: new Date().toISOString() })
    .eq('id', bookingIdSafe)
    .is('booking_confirmation_sent_at', null);

  await bookingReliability.insertActivity(supabase, {
    booking_id: bookingIdSafe,
    event_type: 'emails_sent',
    message: 'Booking confirmation email sent.',
    payload: { source, email: emailSafe },
  });

  return { ok: true };
}

app.post('/api/send-booking-confirmation', async (req, res) => {
  try {
    if (!checkConfirmEmailRate(requestIpBestEffort(req))) {
      return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
    }

    const { email, bookingId } = req.body || {};

    if (!bookingId || !isBookingUuidParam(bookingId)) {
      return res.status(400).json({ error: 'Valid bookingId is required' });
    }

    if (!supabaseConfigured) {
      return res.status(503).json({ error: 'Server not configured' });
    }

    const loaded = await bookingAccess.loadBookingWithCustomer(supabase, String(bookingId));
    if (!loaded.ok) {
      return res.status(loaded.statusCode || 404).json({ error: 'Booking not found' });
    }

    const allowedStatuses = ['pending', 'pending_verification', 'confirmed'];
    if (!allowedStatuses.includes(String(loaded.booking.status || ''))) {
      return res.status(400).json({ error: 'Booking is not eligible for confirmation email' });
    }

    let emailSafe = email ? String(email).trim().toLowerCase() : '';
    if (emailSafe && normalizeEmailParam(loaded.customer.email) !== emailSafe) {
      return res.status(403).json({ error: 'Email does not match this booking' });
    }
    emailSafe = normalizeEmailParam(loaded.customer.email);
    if (!emailSafe) {
      return res.status(400).json({ error: 'Could not resolve customer email' });
    }

    if (loaded.booking.booking_confirmation_sent_at) {
      return res.json({ ok: true, alreadySent: true });
    }

    if (!resend) {
      console.warn('[send-booking-confirmation] RESEND_API_KEY not set; skipping send');
      return res.status(503).json({ error: 'Email service not configured' });
    }

    const bookingIdSafe = String(bookingId);
    const emailHtml = documentUrlValidation.escapeHtml(emailSafe);

    const customerSend = resend.emails.send({
      from: resendFrom,
      to: emailSafe,
      subject: 'Your Launch Zone Booking Confirmation',
      html: `
        <p>Thank you for booking with Launch Zone Rentals.</p>
        <p><strong>Booking ID:</strong> ${documentUrlValidation.escapeHtml(bookingIdSafe)}</p>
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
              <p><strong>Booking ID:</strong> ${documentUrlValidation.escapeHtml(bookingIdSafe)}</p>
              <p><strong>Customer email:</strong> ${emailHtml}</p>
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

      await supabase
        .from('bookings')
        .update({ booking_confirmation_sent_at: new Date().toISOString() })
        .eq('id', bookingIdSafe)
        .is('booking_confirmation_sent_at', null);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[send-booking-confirmation]', err);
    return res.status(500).json({ error: 'Failed to send email' });
  }
});

function isBookingUuidParam(id) {
  const s = String(id || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function normalizeEmailParam(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase();
}

function normalizePhoneDigits(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function phoneDigitsMatch(customerPhone, inputPhone) {
  const a = normalizePhoneDigits(customerPhone);
  const b = normalizePhoneDigits(inputPhone);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 10 && b.length >= 10 && a.slice(-10) === b.slice(-10)) return true;
  return false;
}

function phoneLast4(raw) {
  const d = normalizePhoneDigits(raw);
  return d.length >= 4 ? d.slice(-4) : '';
}

const FIND_BOOKING_RATE_WINDOW_MS = 60 * 1000;
const FIND_BOOKING_RATE_MAX = 30;
const findBookingRateByIp = new Map();

function checkFindBookingRate(ip) {
  const key = String(ip || 'unknown').trim() || 'unknown';
  const now = Date.now();
  const prev = findBookingRateByIp.get(key);
  if (!prev || now - prev.windowStart > FIND_BOOKING_RATE_WINDOW_MS) {
    findBookingRateByIp.set(key, { windowStart: now, count: 1 });
    return true;
  }
  if (prev.count >= FIND_BOOKING_RATE_MAX) return false;
  prev.count += 1;
  return true;
}

function toPublicBookingRow(booking, customer, boat) {
  return {
    id: booking.id,
    customer_name: String(customer?.full_name || '').trim(),
    email: normalizeEmailParam(customer?.email),
    phone_last4: phoneLast4(customer?.phone),
    start_time: booking.start_time,
    end_time: booking.end_time,
    rental_type: String(booking.rental_type || ''),
    boat_id: String(booking.boat_id || ''),
    boat_name: boat?.name ? String(boat.name) : null,
    boat_type: boat?.type ? String(boat.type) : null,
    captain_included: Boolean(booking.captain_included),
    status: String(booking.status || ''),
    payment_status: String(booking.payment_status || ''),
    waiver_signed: Boolean(booking.waiver_signed),
    license_status: String(booking.license_status || 'pending'),
    insurance_status: String(booking.insurance_status || 'pending'),
    has_license_url: Boolean(String(booking.license_url || customer?.id_document_url || '').trim()),
    has_insurance_url: Boolean(
      String(booking.insurance_url || customer?.insurance_proof_url || '').trim()
    ),
  };
}

function pickBestBookingRow(rows) {
  if (!rows?.length) return null;
  const active = rows.filter((r) => !['cancelled', 'completed'].includes(String(r.status || '')));
  const pool = active.length > 0 ? active : rows;
  const now = Date.now();
  const future = pool
    .filter((r) => new Date(String(r.start_time || '')).getTime() >= now - 24 * 60 * 60 * 1000)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  if (future.length > 0) return future[0];
  return pool.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())[0];
}

/**
 * Magic link: load booking for /waivers-insurance?bookingId= (UUID is the capability token).
 */
app.get('/api/public/waivers-booking', async (req, res) => {
  const notFound = { message: 'Booking not found or no longer active.' };
  try {
    if (!supabaseConfigured) return res.status(503).json(notFound);

    const bookingId = String(req.query.bookingId || '').trim();
    if (!isBookingUuidParam(bookingId)) {
      return res.status(400).json({ message: 'Invalid booking id.' });
    }

    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select(
        'id, customer_id, boat_id, start_time, end_time, rental_type, captain_included, status, payment_status, waiver_signed, license_status, insurance_status, license_url, insurance_url, boats(id, name, type)'
      )
      .eq('id', bookingId)
      .maybeSingle();

    if (bErr || !booking) return res.status(404).json(notFound);
    if (['cancelled', 'completed'].includes(String(booking.status || ''))) {
      return res.status(404).json(notFound);
    }

    const { data: customer, error: cErr } = await supabase
      .from('customers')
      .select('id, full_name, email, phone, id_document_url, insurance_proof_url')
      .eq('id', booking.customer_id)
      .maybeSingle();

    if (cErr || !customer) return res.status(404).json(notFound);

    const boat = Array.isArray(booking.boats) ? booking.boats[0] : booking.boats;
    const publicRow = toPublicBookingRow(booking, customer, boat);
    delete publicRow.email;
    publicRow.email_masked = bookingAccess.maskEmail(customer.email);
    return res.json({ booking: publicRow });
  } catch (err) {
    console.error('[waivers-booking]', err);
    return res.status(500).json(notFound);
  }
});

/**
 * Magic link step 2: confirm phone to unlock full booking contact for waivers flow.
 */
app.post('/api/public/confirm-waivers-access', async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: 'Server not configured' });

    const bookingId = String(req.body?.bookingId || '').trim();
    const phone = String(req.body?.phone || '').trim();
    if (!isBookingUuidParam(bookingId) || !phone) {
      return res.status(400).json({ error: 'bookingId and phone are required' });
    }

    const ip = requestIpBestEffort(req);
    if (!checkFindBookingRate(ip)) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a minute.' });
    }

    const verified = await bookingAccess.verifyBookingContact(supabase, bookingId, '', phone, {
      requirePhone: true,
    });
    if (!verified.ok) {
      return res.status(verified.statusCode || 403).json({ error: verified.message || 'Could not verify' });
    }

    const { booking, customer, boat } = verified;
    if (['cancelled', 'completed'].includes(String(booking.status || ''))) {
      return res.status(404).json({ error: 'Booking not found or no longer active' });
    }

    return res.json({
      booking: toPublicBookingRow(booking, customer, boat),
    });
  } catch (err) {
    console.error('[confirm-waivers-access]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

/**
 * Legacy /verify page: load booking shell without customer PII.
 */
app.get('/api/public/verify-booking', async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: 'Server not configured' });
    const bookingId = String(req.query.bookingId || '').trim();
    if (!isBookingUuidParam(bookingId)) {
      return res.status(400).json({ error: 'Invalid booking id' });
    }

    const loaded = await bookingAccess.loadBookingWithCustomer(supabase, bookingId);
    if (!loaded.ok) {
      return res.status(loaded.statusCode || 404).json({ error: loaded.message || 'Not found' });
    }

    const { booking, boat } = loaded;
    if (!['pending', 'pending_verification'].includes(String(booking.status || ''))) {
      return res.status(400).json({ error: 'This booking is not awaiting verification', status: booking.status });
    }

    const { data: uv } = await supabase
      .from('user_verifications')
      .select('buoy_status, buoy_proof_url')
      .eq('booking_id', bookingId)
      .maybeSingle();

    return res.json({
      booking: {
        id: booking.id,
        status: booking.status,
        boat_id: booking.boat_id,
        boat_name: boat?.name || null,
        boat_type: boat?.type || null,
        license_status: booking.license_status,
        has_license_url: Boolean(String(booking.license_url || '').trim()),
        insurance_verification: uv
          ? { buoy_status: uv.buoy_status, has_proof: Boolean(uv.buoy_proof_url) }
          : { buoy_status: 'pending', has_proof: false },
      },
    });
  } catch (err) {
    console.error('[verify-booking]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

/**
 * Legacy /verify email gate — server-side only (no anon customer SELECT).
 */
app.post('/api/public/verify-booking-gate', async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: 'Server not configured' });
    const bookingId = String(req.body?.bookingId || '').trim();
    const email = normalizeEmailParam(req.body?.email);
    if (!isBookingUuidParam(bookingId) || !email) {
      return res.status(400).json({ error: 'bookingId and email are required' });
    }

    const ip = requestIpBestEffort(req);
    if (!checkFindBookingRate(ip)) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a minute.' });
    }

    const verified = await bookingAccess.verifyBookingContact(supabase, bookingId, email, '', {
      requirePhone: false,
    });
    if (!verified.ok) {
      return res.status(verified.statusCode || 403).json({ error: verified.message || 'Email does not match' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[verify-booking-gate]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

/**
 * Signed upload URL for license / insurance proof (service role; replaces anon storage INSERT).
 */
app.post('/api/public/booking-upload-url', async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: 'Server not configured' });

    const bookingId = String(req.body?.bookingId || '').trim();
    const email = normalizeEmailParam(req.body?.email);
    const phone = String(req.body?.phone || '').trim();
    const folder = String(req.body?.folder || '').trim();
    const fileName = String(req.body?.fileName || 'document').trim();

    if (!isBookingUuidParam(bookingId) || !email) {
      return res.status(400).json({ error: 'bookingId and email are required' });
    }
    if (!['licenses', 'insurance'].includes(folder)) {
      return res.status(400).json({ error: 'folder must be licenses or insurance' });
    }

    const verified = await bookingAccess.verifyBookingContact(supabase, bookingId, email, phone, {
      requirePhone: Boolean(phone),
    });
    if (!verified.ok) {
      return res.status(verified.statusCode || 403).json({ error: verified.message || 'Could not verify' });
    }

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'document';
    const bucket = folder === 'insurance' ? 'licenses' : 'documents';
    const objectPath =
      bucket === 'licenses'
        ? `${bookingId}/buoy-${Date.now()}-${safeName}`
        : `${folder}/${bookingId}/${Date.now()}-${safeName}`;

    const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(objectPath);
    if (error || !data?.signedUrl) {
      console.error('[booking-upload-url]', error?.message);
      return res.status(500).json({ error: 'Could not create upload URL' });
    }

    const ref = documentUrlValidation.supabaseProjectRef();
    const publicUrl = ref
      ? `https://${ref}.supabase.co/storage/v1/object/public/${bucket}/${objectPath}`
      : null;

    return res.json({
      signedUrl: data.signedUrl,
      path: objectPath,
      bucket,
      publicUrl,
    });
  } catch (err) {
    console.error('[booking-upload-url]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

/**
 * Save Buoy insurance proof + mark insurance submitted (replaces anon user_verifications upsert).
 */
app.post('/api/booking-mark-insurance-proof', async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: 'Server not configured' });

    const bookingId = String(req.body?.bookingId || '').trim();
    const email = normalizeEmailParam(req.body?.email);
    const phone = String(req.body?.phone || '').trim();
    const proofUrl = String(req.body?.proofUrl || req.body?.insuranceUrl || '').trim();

    if (!isBookingUuidParam(bookingId) || !email || !proofUrl) {
      return res.status(400).json({ error: 'bookingId, email, and proofUrl are required' });
    }

    const urlCheck = documentUrlValidation.validateCustomerDocumentUrl(proofUrl, { bookingId });
    if (!urlCheck.ok) {
      return res.status(400).json({ error: 'Invalid proof URL for this booking' });
    }

    const verified = await bookingAccess.verifyBookingContact(supabase, bookingId, email, phone, {
      requirePhone: Boolean(phone),
    });
    if (!verified.ok) {
      return res.status(verified.statusCode || 403).json({ error: verified.message || 'Could not verify' });
    }

    const stamp = new Date().toISOString();
    await supabase.from('user_verifications').upsert(
      {
        booking_id: bookingId,
        buoy_status: 'pending',
        buoy_proof_url: proofUrl,
        updated_at: stamp,
      },
      { onConflict: 'booking_id' }
    );

    if (verified.booking.insurance_status !== 'verified') {
      await supabase.from('bookings').update({ insurance_status: 'submitted' }).eq('id', bookingId);
    }

    void preTripNotifications.maybeSendBookingWaiversConfirmation({
      supabase,
      resend,
      resendFrom,
      bookingId,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[booking-mark-insurance-proof]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

/**
 * Public status for manual pre-trip submissions (submission id + email must match).
 */
app.get('/api/public/pre-trip-status', async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: 'Server not configured' });

    const submissionId = String(req.query.submissionId || '').trim();
    const email = normalizeEmailParam(req.query.email);
    if (!isBookingUuidParam(submissionId) || !email) {
      return res.status(400).json({ error: 'submissionId and email are required' });
    }

    const { data: submission, error: sErr } = await supabase
      .from('pre_trip_submissions')
      .select('*')
      .eq('id', submissionId)
      .maybeSingle();

    if (sErr || !submission) return res.status(404).json({ error: 'Not found' });
    if (normalizeEmailParam(submission.email) !== email) {
      return res.status(403).json({ error: 'Email does not match this submission' });
    }

    let matchedBooking = null;
    if (submission.matched_booking_id) {
      const { data: mb } = await supabase
        .from('bookings')
        .select('id, status, start_time, waiver_signed, license_status, insurance_status')
        .eq('id', submission.matched_booking_id)
        .maybeSingle();
      matchedBooking = mb;
    }

    return res.json({
      submission: {
        id: submission.id,
        customer_name: submission.customer_name,
        trip_type: submission.trip_type,
        groupon_code: submission.groupon_code,
        waiver_signed: submission.waiver_signed,
        license_status: submission.license_status,
        insurance_status: submission.insurance_status,
        has_license_url: Boolean(submission.license_url),
        has_insurance_url: Boolean(submission.insurance_url),
        admin_status: submission.admin_status,
        matched_booking_id: submission.matched_booking_id,
        created_at: submission.created_at,
      },
      matched_booking: matchedBooking
        ? {
            id: matchedBooking.id,
            status: matchedBooking.status,
            start_time: matchedBooking.start_time,
          }
        : null,
    });
  } catch (err) {
    console.error('[pre-trip-status]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

/**
 * Public lookup for /waivers-insurance — email + phone must match; optional booking id or promo code.
 */
app.post('/api/public/find-booking', async (req, res) => {
  const noMatchMessage =
    'We could not find a booking with that information. Double-check your email and phone, or call 803-542-1761.';

  try {
    if (!supabaseConfigured) return res.status(503).json({ message: noMatchMessage });

    const ip = requestIpBestEffort(req);
    if (!checkFindBookingRate(ip)) {
      return res.status(429).json({ message: 'Too many attempts. Please wait a minute and try again.' });
    }

    const email = normalizeEmailParam(req.body?.email);
    const phone = String(req.body?.phone || '').trim();
    const codeRaw = String(req.body?.code || '').trim();
    const code = codeRaw ? codeRaw.toUpperCase() : '';

    if (!email || !phone) {
      return res.status(400).json({ message: 'Email and phone are required.' });
    }

    const { data: customers, error: cErr } = await supabase
      .from('customers')
      .select('id, full_name, email, phone, id_document_url, insurance_proof_url')
      .ilike('email', email);

    if (cErr) {
      console.error('[find-booking] customers:', cErr.message);
      return res.status(500).json({ message: noMatchMessage });
    }

    const matchedCustomers = (customers || []).filter((c) => phoneDigitsMatch(c.phone, phone));
    if (matchedCustomers.length === 0) {
      return res.status(404).json({ message: noMatchMessage });
    }

    const customerIds = matchedCustomers.map((c) => c.id);
    const { data: bookings, error: bErr } = await supabase
      .from('bookings')
      .select(
        'id, customer_id, boat_id, start_time, end_time, rental_type, captain_included, status, payment_status, waiver_signed, license_status, insurance_status, license_url, insurance_url, promo_code, boats(id, name, type)'
      )
      .in('customer_id', customerIds)
      .not('status', 'eq', 'cancelled');

    if (bErr) {
      console.error('[find-booking] bookings:', bErr.message);
      return res.status(500).json({ message: noMatchMessage });
    }

    let candidates = bookings || [];

    if (code) {
      if (isBookingUuidParam(code)) {
        candidates = candidates.filter((b) => String(b.id).toLowerCase() === code.toLowerCase());
      } else {
        candidates = candidates.filter(
          (b) => String(b.promo_code || '').trim().toUpperCase() === code
        );
      }
    }

    const picked = pickBestBookingRow(candidates);
    if (!picked) {
      return res.status(404).json({ message: noMatchMessage });
    }

    const customer = matchedCustomers.find((c) => c.id === picked.customer_id) || matchedCustomers[0];
    const boat = Array.isArray(picked.boats) ? picked.boats[0] : picked.boats;

    return res.json({ booking: toPublicBookingRow(picked, customer, boat) });
  } catch (err) {
    console.error('[find-booking]', err);
    return res.status(500).json({ message: noMatchMessage });
  }
});

/**
 * Post-booking waiver signing for /waivers-insurance (email + phone must match customer).
 */
app.post('/api/booking-sign-waiver', async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: 'Server not configured' });

    const bookingId = String(req.body?.bookingId || '').trim();
    const email = normalizeEmailParam(req.body?.email);
    const phone = String(req.body?.phone || '').trim();
    const signature = String(req.body?.signature || '').trim();
    const termsAccepted = Boolean(req.body?.termsAccepted);
    const damageFeeAcknowledged = Boolean(req.body?.damageFeeAcknowledged);
    const waiverAgreed = Boolean(req.body?.waiverAgreed);

    if (!isBookingUuidParam(bookingId) || !email || !phone) {
      return res.status(400).json({ error: 'bookingId, email, and phone are required' });
    }
    if (!termsAccepted || !damageFeeAcknowledged || !waiverAgreed || !signature) {
      return res.status(400).json({ error: 'Complete all agreement checkboxes and your signature.' });
    }

    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select('id, customer_id, waiver_signed, status')
      .eq('id', bookingId)
      .maybeSingle();
    if (bErr || !booking) return res.status(404).json({ error: 'Booking not found' });
    if (['cancelled', 'completed'].includes(String(booking.status || ''))) {
      return res.status(400).json({ error: 'This booking is no longer open for document updates.' });
    }

    const { data: customer, error: cErr } = await supabase
      .from('customers')
      .select('id, email, phone')
      .eq('id', booking.customer_id)
      .maybeSingle();
    if (cErr || !customer?.email) return res.status(400).json({ error: 'Could not verify customer' });
    if (normalizeEmailParam(customer.email) !== email || !phoneDigitsMatch(customer.phone, phone)) {
      return res.status(403).json({ error: 'Email or phone does not match this booking' });
    }

    const signedAt = new Date().toISOString();
    const requestIp = requestIpBestEffort(req);

    if (!booking.waiver_signed) {
      const { error: uErr } = await supabase
        .from('bookings')
        .update({
          waiver_signed: true,
          waiver_signed_at: signedAt,
          terms_accepted: true,
          damage_fee_acknowledged: true,
        })
        .eq('id', bookingId);
      if (uErr) {
        console.error('[booking-sign-waiver] update:', uErr.message);
        return res.status(500).json({ error: 'Could not save waiver on booking' });
      }

      const { error: wErr } = await supabase.from('waivers').insert({
        booking_id: bookingId,
        customer_id: customer.id,
        electronic_signature: signature,
        signature_date: signedAt,
        ip_address: requestIp,
        waiver_content: 'Florida Boating Liability Waiver - signed via Waivers & Insurance page',
        accepted: true,
      });
      if (wErr) {
        console.warn('[booking-sign-waiver] waiver insert:', wErr.message);
      }
    }

    void preTripNotifications.maybeSendBookingWaiversConfirmation({
      supabase,
      resend,
      resendFrom,
      bookingId,
    });

    return res.json({ ok: true, waiver_signed: true });
  } catch (err) {
    console.error('[booking-sign-waiver]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

const PRE_TRIP_SUBMIT_RATE_WINDOW_MS = 60 * 1000;
const PRE_TRIP_SUBMIT_RATE_MAX = 15;
const preTripSubmitRateByIp = new Map();

const PRE_TRIP_TYPES = new Set(['pontoon_rental', 'center_console_rental', 'captain_charter']);
const PRE_TRIP_REG_BY_TYPE = {
  pontoon_rental: 'FL0278PU',
  center_console_rental: 'FL3827TT',
  captain_charter: null,
};

function checkPreTripSubmitRate(ip) {
  const key = String(ip || 'unknown').trim() || 'unknown';
  const now = Date.now();
  const prev = preTripSubmitRateByIp.get(key);
  if (!prev || now - prev.windowStart > PRE_TRIP_SUBMIT_RATE_WINDOW_MS) {
    preTripSubmitRateByIp.set(key, { windowStart: now, count: 1 });
    return true;
  }
  if (prev.count >= PRE_TRIP_SUBMIT_RATE_MAX) return false;
  prev.count += 1;
  return true;
}

/**
 * Off-platform pre-trip submission (no booking record yet).
 * POST /api/public/pre-trip-submission
 */
app.post('/api/public/pre-trip-submission', async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: 'Server not configured' });

    const ip = requestIpBestEffort(req);
    if (!checkPreTripSubmitRate(ip)) {
      return res.status(429).json({ error: 'Too many submissions. Please wait a minute and try again.' });
    }

    const body = req.body || {};
    const email = normalizeEmailParam(body.email);
    const phone = String(body.phone || '').trim();
    const customerName = String(body.customerName || body.customer_name || '').trim();
    const tripType = String(body.tripType || body.trip_type || '').trim();
    const grouponCode = String(body.grouponCode || body.groupon_code || '').trim().toUpperCase() || null;
    const requestedTripDateRaw = String(body.requestedTripDate || body.requested_trip_date || '').trim();
    const waiverSignature = String(body.waiverSignature || body.waiver_signature || body.signature || '').trim();
    const waiverAgreed = Boolean(body.waiverAgreed ?? body.waiver_agreed);
    const termsAccepted = Boolean(body.termsAccepted ?? body.terms_accepted);
    const damageFeeAcknowledged = Boolean(body.damageFeeAcknowledged ?? body.damage_fee_acknowledged);
    const licenseUrl = String(body.licenseUrl || body.license_url || '').trim() || null;
    const insuranceUrl = String(body.insuranceUrl || body.insurance_url || '').trim() || null;

    if (!email) return res.status(400).json({ error: 'Email is required.' });
    if (!PRE_TRIP_TYPES.has(tripType)) {
      return res.status(400).json({ error: 'Invalid trip type.' });
    }
    if (!termsAccepted || !damageFeeAcknowledged || !waiverAgreed || !waiverSignature) {
      return res.status(400).json({ error: 'Complete waiver, terms, and signature before submitting.' });
    }

    let requestedTripDate = null;
    if (requestedTripDateRaw) {
      const d = new Date(requestedTripDateRaw);
      if (!Number.isFinite(d.getTime())) {
        return res.status(400).json({ error: 'Invalid requested trip date.' });
      }
      requestedTripDate = d.toISOString();
    }

    const isRental = tripType !== 'captain_charter';
    if (isRental && !licenseUrl) {
      return res.status(400).json({ error: 'License / ID upload is required for rentals.' });
    }

    if (licenseUrl) {
      const licCheck = documentUrlValidation.validateCustomerDocumentUrl(licenseUrl);
      if (!licCheck.ok) {
        return res.status(400).json({ error: 'Invalid license document URL.' });
      }
    }
    if (insuranceUrl) {
      const insCheck = documentUrlValidation.validateCustomerDocumentUrl(insuranceUrl);
      if (!insCheck.ok) {
        return res.status(400).json({ error: 'Invalid insurance document URL.' });
      }
    }

    const signedAt = new Date().toISOString();
    const insuranceStatus = insuranceUrl ? 'submitted' : 'pending';

    const row = {
      customer_name: customerName || null,
      email,
      phone: phone || null,
      trip_type: tripType,
      selected_boat_reg_no: PRE_TRIP_REG_BY_TYPE[tripType] || null,
      groupon_code: grouponCode,
      requested_trip_date: requestedTripDate,
      waiver_signed: true,
      waiver_signed_at: signedAt,
      waiver_signature: waiverSignature,
      license_url: licenseUrl,
      insurance_url: insuranceUrl,
      license_status: licenseUrl ? 'pending' : 'pending',
      insurance_status: insuranceStatus,
      admin_status: 'pending',
      updated_at: signedAt,
    };

    const { data: inserted, error: insErr } = await supabase
      .from('pre_trip_submissions')
      .insert(row)
      .select('id')
      .single();

    if (insErr || !inserted?.id) {
      console.error('[pre-trip-submission] insert:', insErr?.message);
      return res.status(500).json({ error: 'Could not save submission. Try again or call us.' });
    }

    void preTripNotifications.onPreTripSubmissionCreated({
      supabase,
      resend,
      resendFrom,
      adminEmail: (process.env.ADMIN_EMAIL || '').trim(),
      businessName: (process.env.BUSINESS_NAME || 'Launch Zone Charters').trim(),
      submission: { ...row, id: inserted.id },
    });

    return res.json({ ok: true, submissionId: inserted.id });
  } catch (err) {
    console.error('[pre-trip-submission]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

async function copyPreTripSubmissionToBooking(submission, bookingId, requestIp) {
  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select('id, customer_id, waiver_signed, license_url, insurance_url, license_status, insurance_status')
    .eq('id', bookingId)
    .maybeSingle();
  if (bErr || !booking) {
    const err = new Error('Booking not found');
    err.statusCode = 404;
    throw err;
  }

  const bookingUpdates = { updated_at: new Date().toISOString() };
  if (submission.license_url && !booking.license_url) {
    bookingUpdates.license_url = submission.license_url;
    bookingUpdates.license_status = 'pending';
  }
  if (submission.insurance_url) {
    bookingUpdates.insurance_url = submission.insurance_url;
    bookingUpdates.insurance_status =
      submission.insurance_status === 'submitted' ? 'submitted' : 'pending';
  }
  if (submission.waiver_signed && !booking.waiver_signed) {
    bookingUpdates.waiver_signed = true;
    bookingUpdates.waiver_signed_at = submission.waiver_signed_at || new Date().toISOString();
    bookingUpdates.terms_accepted = true;
    bookingUpdates.damage_fee_acknowledged = true;
  }

  if (Object.keys(bookingUpdates).length > 1) {
    const { error: uErr } = await supabase.from('bookings').update(bookingUpdates).eq('id', bookingId);
    if (uErr) {
      const err = new Error(uErr.message || 'Could not update booking');
      err.statusCode = 500;
      throw err;
    }
  }

  if (submission.license_url) {
    await supabase
      .from('customers')
      .update({ id_document_url: submission.license_url })
      .eq('id', booking.customer_id);
  }
  if (submission.insurance_url) {
    await supabase
      .from('customers')
      .update({ insurance_proof_url: submission.insurance_url })
      .eq('id', booking.customer_id);
  }

  if (submission.waiver_signed && submission.waiver_signature) {
    const { data: existingWaiver } = await supabase
      .from('waivers')
      .select('id')
      .eq('booking_id', bookingId)
      .limit(1)
      .maybeSingle();
    if (!existingWaiver) {
      await supabase.from('waivers').insert({
        booking_id: bookingId,
        customer_id: booking.customer_id,
        electronic_signature: submission.waiver_signature,
        signature_date: submission.waiver_signed_at || new Date().toISOString(),
        ip_address: requestIp,
        waiver_content: 'Florida Boating Liability Waiver - from pre-trip submission',
        accepted: true,
      });
    }
  }

  if (submission.insurance_url) {
    await supabase.from('user_verifications').upsert(
      {
        booking_id: bookingId,
        buoy_status: 'pending',
        buoy_proof_url: submission.insurance_url,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'booking_id' }
    );
  }
}

/**
 * Admin: match / approve / reject pre-trip submissions.
 * PATCH /api/admin/pre-trip-submissions/:id
 * Body: { action: 'match'|'approve'|'reject', matched_booking_id?, admin_notes? }
 */
app.patch('/api/admin/pre-trip-submissions/:id', async (req, res) => {
  try {
    const adminUser = await verifyAdminRequest(req, res);
    if (!adminUser) return;

    const submissionId = String(req.params.id || '').trim();
    if (!isBookingUuidParam(submissionId)) {
      return res.status(400).json({ error: 'Invalid submission id' });
    }

    const action = String(req.body?.action || '').trim().toLowerCase();
    const matchedBookingId = String(req.body?.matched_booking_id || req.body?.matchedBookingId || '').trim();
    const adminNotes =
      req.body?.admin_notes != null
        ? String(req.body.admin_notes)
        : req.body?.adminNotes != null
          ? String(req.body.adminNotes)
          : null;

    if (!['match', 'approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action must be match, approve, or reject' });
    }

    const { data: submission, error: sErr } = await supabase
      .from('pre_trip_submissions')
      .select('*')
      .eq('id', submissionId)
      .maybeSingle();
    if (sErr || !submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const stamp = new Date().toISOString();
    const updates = { updated_at: stamp };
    if (adminNotes !== null) updates.admin_notes = adminNotes;

    if (action === 'reject') {
      updates.admin_status = 'rejected';
      const { error: uErr } = await supabase
        .from('pre_trip_submissions')
        .update(updates)
        .eq('id', submissionId);
      if (uErr) return res.status(500).json({ error: uErr.message });
      return res.json({ ok: true, admin_status: 'rejected' });
    }

    const bookingIdToMatch =
      matchedBookingId || (submission.matched_booking_id ? String(submission.matched_booking_id) : '');
    if ((action === 'match' || action === 'approve') && !isBookingUuidParam(bookingIdToMatch)) {
      return res.status(400).json({ error: 'matched_booking_id is required to match or approve' });
    }

    if (action === 'match' || action === 'approve') {
      await copyPreTripSubmissionToBooking(
        submission,
        bookingIdToMatch,
        requestIpBestEffort(req)
      );
      updates.matched_booking_id = bookingIdToMatch;
      updates.admin_status = action === 'approve' ? 'approved' : 'matched';
    }

    const { error: uErr } = await supabase
      .from('pre_trip_submissions')
      .update(updates)
      .eq('id', submissionId);
    if (uErr) return res.status(500).json({ error: uErr.message });

    return res.json({ ok: true, admin_status: updates.admin_status, matched_booking_id: bookingIdToMatch });
  } catch (err) {
    console.error('[admin/pre-trip-submissions]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Failed' });
  }
});

/**
 * Admin: suggest bookings to match a pre-trip submission (Groupon code, email, phone).
 */
app.get('/api/admin/pre-trip-submissions/:id/suggestions', async (req, res) => {
  try {
    const adminUser = await verifyAdminRequest(req, res);
    if (!adminUser) return;

    const submissionId = String(req.params.id || '').trim();
    if (!isBookingUuidParam(submissionId)) {
      return res.status(400).json({ error: 'Invalid submission id' });
    }

    const { data: submission, error: sErr } = await supabase
      .from('pre_trip_submissions')
      .select('id, email, phone, groupon_code, requested_trip_date')
      .eq('id', submissionId)
      .maybeSingle();
    if (sErr || !submission) return res.status(404).json({ error: 'Submission not found' });

    const suggestions = [];
    const seen = new Set();

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

    const groupon = String(submission.groupon_code || '').trim().toUpperCase();
    if (groupon) {
      const { data: promoBookings } = await supabase
        .from('bookings')
        .select('id, customer_id, start_time, status, promo_code, boats(name)')
        .ilike('promo_code', groupon)
        .not('status', 'eq', 'cancelled')
        .order('start_time', { ascending: false })
        .limit(5);

      for (const b of promoBookings || []) {
        const { data: customer } = await supabase
          .from('customers')
          .select('full_name, email')
          .eq('id', b.customer_id)
          .maybeSingle();
        const boat = Array.isArray(b.boats) ? b.boats[0] : b.boats;
        pushCandidate(b, customer, boat, 'Groupon code match');
      }
    }

    const emailNorm = normalizeEmailParam(submission.email);
    if (emailNorm) {
      const { data: customers } = await supabase
        .from('customers')
        .select('id, full_name, email, phone')
        .ilike('email', emailNorm);

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
          const reason =
            submission.phone && phoneDigitsMatch(c.phone, submission.phone)
              ? 'Email and phone match'
              : 'Email match';
          pushCandidate(b, c, boat, reason);
        }
      }
    }

    return res.json({ suggestions: suggestions.slice(0, 8) });
  } catch (err) {
    console.error('[admin/pre-trip-suggestions]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

/** Public read: insurance compliance flag for post-checkout confirmation UI (UUID is the capability token). */
app.get('/api/public/booking-insurance-status', async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: 'Server not configured' });
    const bookingId = String(req.query.bookingId || '').trim();
    if (!isBookingUuidParam(bookingId)) return res.status(400).json({ error: 'Invalid booking id' });
    const { data, error } = await supabase
      .from('bookings')
      .select('insurance_status, status')
      .eq('id', bookingId)
      .maybeSingle();
    if (error) {
      console.error('[booking-insurance-status]', error.message);
      return res.status(500).json({ error: 'Could not load booking' });
    }
    if (!data) return res.status(404).json({ error: 'Not found' });
    return res.json({ insurance_status: data.insurance_status, status: data.status });
  } catch (err) {
    console.error('[booking-insurance-status]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

/**
 * After Buoy proof upload on /verify — marks rental insurance as submitted for admin review (email must match customer).
 */
app.post('/api/booking-mark-insurance-submitted', async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: 'Server not configured' });
    const bookingId = String(req.body?.bookingId || '').trim();
    const email = normalizeEmailParam(req.body?.email);
    const phone = String(req.body?.phone || '').trim();
    if (!isBookingUuidParam(bookingId) || !email || !phone) {
      return res.status(400).json({ error: 'bookingId, email, and phone are required' });
    }

    const verified = await bookingAccess.verifyBookingContact(supabase, bookingId, email, phone, {
      requirePhone: true,
    });
    if (!verified.ok) {
      return res.status(verified.statusCode || 403).json({ error: verified.message || 'Could not verify' });
    }

    if (verified.booking.insurance_status === 'verified') {
      return res.json({ ok: true, insurance_status: 'verified' });
    }
    const { error: uErr } = await supabase
      .from('bookings')
      .update({ insurance_status: 'submitted' })
      .eq('id', bookingId);
    if (uErr) {
      console.error('[booking-mark-insurance-submitted]', uErr.message);
      return res.status(500).json({ error: 'Could not update booking' });
    }

    void preTripNotifications.maybeSendBookingWaiversConfirmation({
      supabase,
      resend,
      resendFrom,
      bookingId,
    });

    return res.json({ ok: true, insurance_status: 'submitted' });
  } catch (err) {
    console.error('[booking-mark-insurance-submitted]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

app.get('/api/cron/waivers-docs-reminders', async (req, res) => {
  try {
    if (!requireCronBearer(req, res)) return;
    const bookingResult = await waiversDocsReminders.runWaiversDocsReminders({
      supabase,
      resend,
      resendFrom,
    });
    const preTripResult = await waiversDocsReminders.runPreTripInsuranceReminders({
      supabase,
      resend,
      resendFrom,
    });
    return res.json({ bookings: bookingResult, preTrip: preTripResult });
  } catch (err) {
    console.error('[cron/waivers-docs-reminders]', err);
    return res.status(500).json({ error: err.message || 'Failed' });
  }
});

/**
 * After license upload on /verify — saves license URL on the booking (email must match customer).
 */
app.post('/api/booking-mark-license-submitted', async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: 'Server not configured' });
    const bookingId = String(req.body?.bookingId || '').trim();
    const email = normalizeEmailParam(req.body?.email);
    const phone = String(req.body?.phone || '').trim();
    const licenseUrl = String(req.body?.licenseUrl || '').trim();
    if (!isBookingUuidParam(bookingId) || !email || !licenseUrl) {
      return res.status(400).json({ error: 'bookingId, email, and licenseUrl are required' });
    }

    const urlCheck = documentUrlValidation.validateCustomerDocumentUrl(licenseUrl, { bookingId });
    const preTripCheck = urlCheck.ok
      ? urlCheck
      : documentUrlValidation.validateCustomerDocumentUrl(licenseUrl);
    if (!preTripCheck.ok) {
      return res.status(400).json({ error: 'Invalid license URL for this booking' });
    }

    const verified = await bookingAccess.verifyBookingContact(supabase, bookingId, email, phone, {
      requirePhone: Boolean(phone),
    });
    if (!verified.ok) {
      return res.status(verified.statusCode || 403).json({ error: verified.message || 'Could not verify' });
    }

    if (verified.booking.license_status === 'verified') {
      return res.json({ ok: true, license_status: 'verified', license_url: licenseUrl });
    }
    const { error: uErr } = await supabase
      .from('bookings')
      .update({ license_url: licenseUrl, license_status: 'pending' })
      .eq('id', bookingId);
    if (uErr) {
      console.error('[booking-mark-license-submitted]', uErr.message);
      return res.status(500).json({ error: 'Could not update booking' });
    }
    await supabase
      .from('customers')
      .update({ id_document_url: licenseUrl })
      .eq('id', verified.customer.id);

    void preTripNotifications.maybeSendBookingWaiversConfirmation({
      supabase,
      resend,
      resendFrom,
      bookingId,
    });

    return res.json({ ok: true, license_status: 'pending', license_url: licenseUrl });
  } catch (err) {
    console.error('[booking-mark-license-submitted]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

/** Secured cron hook + optional internal scheduler; same secret pattern as other automation. */
app.get('/api/cron/trip-insurance-reminders', async (req, res) => {
  try {
    if (!requireCronBearer(req, res)) return;
    const result = await insuranceTripReminders.runTripInsuranceReminders({
      supabase,
      resend,
      resendFrom,
    });
    return res.json(result);
  } catch (err) {
    console.error('[cron/trip-insurance-reminders]', err);
    return res.status(500).json({ error: err.message || 'Failed' });
  }
});

async function runPaymentRecoveryRetries(limit = 10) {
  if (!supabaseConfigured || !stripe) return { scanned: 0, retried: 0, skipped: 'not_configured' };
  const { data: rows, error } = await supabase
    .from('payment_recovery_queue')
    .select('id')
    .in('status', ['open', 'retrying'])
    .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  let retried = 0;
  const failures = [];
  for (const row of rows || []) {
    try {
      await retryPaymentRecoveryById(row.id);
      retried += 1;
    } catch (err) {
      failures.push({ id: row.id, error: err.message || 'retry failed' });
    }
  }
  return { scanned: (rows || []).length, retried, failures };
}

app.get('/api/cron/payment-recovery', async (req, res) => {
  try {
    if (!requireCronBearer(req, res)) return;
    const result = await runPaymentRecoveryRetries(25);
    return res.json(result);
  } catch (err) {
    console.error('[cron/payment-recovery]', err);
    return res.status(500).json({ error: err.message || 'Payment recovery failed' });
  }
});

app.get('/api/cron/abandoned-checkouts', async (req, res) => {
  try {
    if (!requireCronBearer(req, res)) return;
    const result = await bookingReliability.runAbandonedCheckoutReminders({
      supabase,
      resend,
      resendFrom,
      publicBase: String(process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || '').trim(),
    });
    return res.json(result);
  } catch (err) {
    console.error('[cron/abandoned-checkouts]', err);
    return res.status(500).json({ error: err.message || 'Abandoned checkout reminders failed' });
  }
});

async function bookingHealthSnapshot() {
  const checks = {};
  checks.supabase = { ok: false };
  checks.stripe = { ok: false };
  checks.webhook = { ok: false };
  checks.email = { ok: false };
  checks.storage = { ok: false };

  try {
    const { error } = await supabase.from('bookings').select('id', { count: 'exact', head: true });
    checks.supabase = { ok: !error, error: error?.message || null };
  } catch (err) {
    checks.supabase = { ok: false, error: err.message || 'Supabase check failed' };
  }

  try {
    if (!stripe) throw new Error('Stripe not configured');
    const acct = await stripe.accounts.retrieve();
    checks.stripe = { ok: Boolean(acct?.id), account: acct?.id || null };
  } catch (err) {
    checks.stripe = { ok: false, error: err.message || 'Stripe check failed' };
  }

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('stripe_webhook_events')
      .select('event_id, received_at, processing_status')
      .gte('received_at', since)
      .order('received_at', { ascending: false })
      .limit(1);
    checks.webhook = {
      ok: !error,
      lastEventAt: data?.[0]?.received_at || null,
      lastStatus: data?.[0]?.processing_status || null,
      error: error?.message || null,
    };
  } catch (err) {
    checks.webhook = { ok: false, error: err.message || 'Webhook check failed' };
  }

  checks.email = {
    ok: Boolean(resend),
    error: resend ? null : 'RESEND_API_KEY not configured',
  };

  try {
    const { data, error } = await supabase.storage.listBuckets();
    checks.storage = { ok: !error, buckets: Array.isArray(data) ? data.length : 0, error: error?.message || null };
  } catch (err) {
    checks.storage = { ok: false, error: err.message || 'Storage check failed' };
  }

  const ok = Object.values(checks).every((check) => check.ok);
  return { ok, checkedAt: new Date().toISOString(), checks };
}

app.get('/api/admin/booking-health', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    return res.json(await bookingHealthSnapshot());
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Health check failed' });
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

async function loadContactMessageForReply(id) {
  const { data, error } = await supabase
    .from('contact_messages')
    .select('id, full_name, email, message, is_read, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function validateContactReply(messageRow, body = {}) {
  const to = cleanText(body.to || messageRow?.email, 320).toLowerCase();
  const subject = cleanText(body.subject, 200);
  const message = cleanText(body.message || body.body, 12000);
  if (!to) {
    const err = new Error('Customer email is missing.');
    err.statusCode = 400;
    throw err;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    const err = new Error('Customer email is invalid.');
    err.statusCode = 400;
    throw err;
  }
  if (!subject) {
    const err = new Error('Subject is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!message) {
    const err = new Error('Message is required.');
    err.statusCode = 400;
    throw err;
  }
  return { to, subject, message };
}

app.post('/api/admin/contact-messages/:id/reply/preview', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid message id.' });
    const messageRow = await loadContactMessageForReply(id);
    if (!messageRow) return res.status(404).json({ error: 'Customer message not found.' });
    const reply = validateContactReply(messageRow, req.body || {});
    return res.json({
      preview: {
        from: resendFrom,
        to: reply.to,
        subject: reply.subject,
        message: reply.message,
        originalMessage: messageRow.message || '',
        customerName: messageRow.full_name || '',
      },
      resendConfigured: Boolean(resend && resendFrom),
    });
  } catch (err) {
    console.error('[admin-contact-reply:preview]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not preview reply.' });
  }
});

app.post('/api/admin/contact-messages/:id/reply/send', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = cleanText(req.params.id, 80);
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid message id.' });
    const messageRow = await loadContactMessageForReply(id);
    if (!messageRow) return res.status(404).json({ error: 'Customer message not found.' });
    const reply = validateContactReply(messageRow, req.body || {});

    if (!resend) {
      return res.status(503).json({ error: 'Email service is not configured.' });
    }

    const result = await resend.emails.send({
      from: resendFrom,
      to: reply.to,
      subject: reply.subject,
      text: reply.message,
      html: customEmailHtml(reply.message),
    });

    if (result.error) {
      return res.status(502).json({ error: result.error.message || 'Could not send reply.' });
    }

    await supabase.from('contact_messages').update({ is_read: true }).eq('id', id);
    return res.json({ ok: true, providerMessageId: result.data?.id || null });
  } catch (err) {
    console.error('[admin-contact-reply:send]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Could not send reply.' });
  }
});

// Future: cron trigger, email alert on failure (ADMIN_EMAIL), multi-instance lock (Redis).
// Debug only — disabled in production.
app.get('/api/test-supabase', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const { data, error } = await supabase.from('boats').select('id, name').limit(5);
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

  const projectRoot = path.resolve(__dirname, '..');
  const { command } = buildPythonSpawn(projectRoot);
  if (!fs.existsSync(command)) {
    return res.status(500).json({
      status: 'error',
      error: 'Captain\'s Log Python virtual environment is missing',
      details: formatCaptainsLogVenvSetupMessage(command),
    });
  }

  isGenerating = true;
  console.log('[generate-content] admin:', adminUser.id);

  runPythonScript()
    .then((result) => {
      console.log('[generate-content] Completed', result);
    })
    .catch((err) => {
      console.error('[generate-content] Error:', err);
    });

  return res.status(202).json({
    status: 'started',
    message: 'Captain\'s Log content generation started',
  });
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

cron.schedule(
  '*/15 * * * *',
  () => {
    insuranceTripReminders.runTripInsuranceReminders({ supabase, resend, resendFrom }).catch((e) => {
      console.error('[cron] trip-insurance-reminders:', e?.message || e);
    });
  },
  { timezone: 'America/New_York' }
);
console.log('⏰ Trip insurance reminders: every 15 minutes (America/New_York)');

cron.schedule(
  '*/5 * * * *',
  () => {
    runPaymentRecoveryRetries(10).catch((e) => {
      console.error('[cron] payment-recovery:', e?.message || e);
    });
    bookingHealthSnapshot().then((snapshot) => {
      if (!snapshot.ok) {
        console.error('[cron] booking-health degraded:', JSON.stringify(snapshot.checks));
      }
    }).catch((e) => {
      console.error('[cron] booking-health:', e?.message || e);
    });
  },
  { timezone: 'America/New_York' }
);
console.log('⏰ Payment recovery + booking health: every 5 minutes (America/New_York)');

cron.schedule(
  '*/30 * * * *',
  () => {
    bookingReliability.runAbandonedCheckoutReminders({
      supabase,
      resend,
      resendFrom,
      publicBase: String(process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || '').trim(),
    }).catch((e) => {
      console.error('[cron] abandoned-checkouts:', e?.message || e);
    });
  },
  { timezone: 'America/New_York' }
);
console.log('⏰ Abandoned checkout reminders: every 30 minutes (America/New_York)');

cron.schedule(
  '0 */6 * * *',
  () => {
    waiversDocsReminders.runWaiversDocsReminders({ supabase, resend, resendFrom }).catch((e) => {
      console.error('[cron] waivers-docs-reminders:', e?.message || e);
    });
    waiversDocsReminders.runPreTripInsuranceReminders({ supabase, resend, resendFrom }).catch((e) => {
      console.error('[cron] pre-trip-insurance-reminders:', e?.message || e);
    });
  },
  { timezone: 'America/New_York' }
);
console.log('⏰ Waivers/docs reminders: every 6 hours (America/New_York)');
