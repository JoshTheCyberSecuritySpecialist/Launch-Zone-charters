/**
 * Launch Zone API: booking confirmation + contact form (Resend + Supabase).
 * From /server: npm install && npm start
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { spawn, execFile } = require('child_process');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Resend } = require('resend');
const supabase = require('./supabaseClient');
const contactSubmission = require('./services/contactSubmission');
const verificationReminder = require('./services/verificationReminder');
const verificationSms = require('./services/verificationSms');
const insuranceTripReminders = require('./services/insuranceTripReminders');
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
const SLOT_TOO_SOON_USER_MESSAGE =
  'This time is no longer available. Please choose a later time.';

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

// --- Groupon / voucher redemption helpers ---------------------------------
// All Groupon validation and discounting happens here on the server. The
// frontend only forwards the raw code; it never sends a discount amount.

/** Trim + uppercase a raw Groupon code; returns '' when absent. */
function normalizeGrouponCode(raw) {
  return String(raw || '').trim().toUpperCase();
}

/**
 * Build the list of `applies_to` values a booking is eligible for, most general
 * first. A code matches when its `applies_to` is any of these. Keeps the DB
 * value flexible (e.g. a 'bio_tour' code works for both shared and private bio).
 */
function buildGrouponApplies(bookingMode, charterType, charterVariant) {
  const out = new Set(['any']);
  if (bookingMode === 'charter') {
    out.add('charter_any');
    if (charterType === 'bio') {
      out.add('bio_any');
      out.add('bio_tour');
    }
    if (charterType === 'rocket') {
      out.add('rocket_any');
      out.add('rocket_tour');
    }
    if (charterType === 'sunset') {
      out.add('sunset_any');
      out.add('sunset_tour');
    }
    if (charterType && charterVariant) out.add(`${charterType}_${charterVariant}`);
  } else if (bookingMode === 'rental') {
    out.add('rental');
  }
  return [...out];
}

/** Discount in USD the code applies against `dueToday`, floored at 0 and capped at `dueToday`. */
function computeGrouponDiscount(groupon, dueToday) {
  const amt = Number(groupon?.discount_amount) || 0;
  let discount;
  if (String(groupon?.discount_type) === 'percent') {
    discount = roundMoney(dueToday * (amt / 100));
  } else {
    discount = roundMoney(amt);
  }
  if (!Number.isFinite(discount) || discount < 0) discount = 0;
  return Math.min(discount, roundMoney(dueToday));
}

/** Map a reserve_groupon_code RPC error to a user-friendly Error with statusCode. */
function grouponError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode || 400;
  return err;
}

function mapGrouponRpcError(rpcError) {
  const raw = String(rpcError?.message || '');
  if (/groupon_not_found/.test(raw)) return grouponError('That reservation code was not found. Check it and try again.', 400);
  if (/groupon_inactive/.test(raw)) return grouponError('This reservation code is no longer active.', 400);
  if (/groupon_expired/.test(raw)) return grouponError('This reservation code has expired.', 400);
  if (/groupon_used_up/.test(raw)) return grouponError('This reservation code has already been used.', 409);
  if (/groupon_not_eligible/.test(raw)) return grouponError('This reservation code is not valid for the selected trip.', 400);
  return grouponError('Could not apply the reservation code. Please try again.', 500);
}

/**
 * Read-only validation used to give immediate feedback and to compute the
 * discount before deciding the Stripe path. The authoritative race-safe check
 * happens later in reserveGrouponCode (atomic increment).
 */
async function validateGrouponCode(code, appliesCandidates) {
  const { data, error } = await supabase
    .from('groupon_codes')
    .select('id, code, status, discount_type, discount_amount, applies_to, max_uses, used_count, expires_at')
    .eq('code', code)
    .maybeSingle();
  if (error) throw grouponError('Could not validate the reservation code. Please try again.', 500);
  if (!data) throw grouponError('That reservation code was not found. Check it and try again.', 400);
  if (data.status !== 'active') throw grouponError('This reservation code is no longer active.', 400);
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    throw grouponError('This reservation code has expired.', 400);
  }
  if (Number(data.used_count) >= Number(data.max_uses)) {
    throw grouponError('This reservation code has already been used.', 409);
  }
  if (!appliesCandidates.includes(data.applies_to)) {
    throw grouponError('This reservation code is not valid for the selected trip.', 400);
  }
  return data;
}

/** Atomically reserve (increment used_count). Throws a mapped Error on failure. */
async function reserveGrouponCode(code, appliesCandidates) {
  const { data, error } = await supabase.rpc('reserve_groupon_code', {
    p_code: code,
    p_applies: appliesCandidates,
  });
  if (error) throw mapGrouponRpcError(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw grouponError('This reservation code could not be applied. Please try again.', 409);
  return row;
}

// NOTE: Redemption (stamping redeemed_booking_id/redeemed_at) is no longer done
// here. It happens in the database via the trg_bookings_groupon_redeem trigger
// when staff approve a booking (status -> 'confirmed'/'completed'). See
// supabase/migrations/20260621000000_groupon_redeem_on_approval.sql.

/** Roll back a reservation when checkout fails before finalize. Best-effort. */
async function releaseGrouponCodeSafe(id) {
  if (!id) return;
  const { error } = await supabase.rpc('release_groupon_code', { p_id: id });
  if (error) console.warn('[groupon] release failed:', error.message);
}

function assertBookingLeadTime(startIso) {
  if (!availabilityService.isStartTimeAllowed(startIso)) {
    const err = new Error(SLOT_TOO_SOON_USER_MESSAGE);
    err.statusCode = 409;
    err.code = 'slot_too_soon';
    throw err;
  }
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
    .select('id, stripe_checkout_session_id, groupon_code');
  if (error) {
    console.warn('[booking-hold-cleanup]', error.message);
    return { deleted: 0, error };
  }
  const n = Array.isArray(data) ? data.length : 0;
  if (n > 0) {
    console.log('[booking-hold-cleanup] removed', n, 'expired pending hold(s)');
    // Release any Groupon codes that were reserved for these abandoned holds.
    await releaseGrouponsForExpiredHolds(data);
  }
  return { deleted: n };
}

/** For expired holds that carried a Groupon, look up the draft reservation id and release it. */
async function releaseGrouponsForExpiredHolds(rows) {
  const sessionIds = rows
    .filter((r) => r && r.groupon_code && r.stripe_checkout_session_id)
    .map((r) => String(r.stripe_checkout_session_id));
  if (sessionIds.length === 0) return;
  const { data: drafts, error } = await supabase
    .from('checkout_drafts')
    .select('payload')
    .in('stripe_session_id', sessionIds);
  if (error) {
    console.warn('[booking-hold-cleanup] groupon draft lookup:', error.message);
    return;
  }
  for (const draft of drafts || []) {
    const id = draft?.payload?.groupon?.id;
    if (id) await releaseGrouponCodeSafe(String(id));
  }
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
 * Ensure Python deps for Captain's Log exist (auto-install from requirements.txt when missing).
 * Prevents runtime failures like ModuleNotFoundError: requests on cloud hosts.
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

  const importCheck = 'import requests, bs4, supabase, dotenv';
  try {
    await runFile(command, ['-c', importCheck], { cwd: projectRoot, env: process.env });
    return;
  } catch (checkErr) {
    console.warn(
      '[generate-content] Python dependency precheck failed, attempting pip install:',
      checkErr?.stderr || checkErr?.message || checkErr
    );
  }

  const requirementsPath = path.join(projectRoot, 'ai-content', 'requirements.txt');
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
    // Hold expired before payment cleared: free any reserved Groupon code.
    if (payload.groupon?.id) {
      await releaseGrouponCodeSafe(String(payload.groupon.id));
    }
    const err = new Error(
      'Your checkout reservation expired before payment cleared. Your card was refunded. Please choose another time.'
    );
    err.statusCode = 409;
    throw err;
  }

  const { customer, booking, waiver, legal, groupon } = payload;
  const grouponCodeApplied = groupon?.code ? normalizeGrouponCode(groupon.code) : '';
  const grouponDiscountApplied = roundMoney(Number(groupon?.discount_amount) || 0);
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

  const stripePaid =
    typeof session.amount_total === 'number'
      ? Math.round((session.amount_total / 100) * 100) / 100
      : Number(booking.deposit_amount || 0);
  // Amount covered today = Stripe cash + any Groupon discount applied to the deposit.
  const paidDeposit = roundMoney(stripePaid + grouponDiscountApplied);
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
  if (grouponCodeApplied) {
    adminNotesParts.push(`Groupon ${grouponCodeApplied} (-$${grouponDiscountApplied.toFixed(2)})`);
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
    groupon_code: grouponCodeApplied || null,
    groupon_discount_amount: grouponDiscountApplied > 0 ? grouponDiscountApplied : null,
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
    assertBookingLeadTime(booking.start_time);
    await assertSlotAvailable(booking.boat_id, booking.start_time, booking.end_time, holdRow?.id || null);
  } catch (slotErr) {
    await refundStripeCheckoutSession(session);
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

  // NOTE: The Groupon code was already *reserved* at checkout (used_count++), so
  // it cannot be reused while this booking is pending. It is only *redeemed*
  // (redeemed_booking_id/redeemed_at stamped) once staff approve the customer's
  // insurance/ID and the booking flips to 'confirmed' — handled by the
  // trg_bookings_groupon_redeem database trigger. If the booking is cancelled
  // first, that same trigger releases the reservation.

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
    try {
      assertBookingLeadTime(startTime.toISOString());
    } catch (leadErr) {
      return res.status(leadErr.statusCode || 409).json({ error: leadErr.message || SLOT_TOO_SOON_USER_MESSAGE });
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

    // Optional Groupon/voucher: validate (read-only) and compute a server-side
    // discount against the amount due today. The atomic reservation happens
    // later, just before the booking/hold is committed (Path A or Path B).
    const grouponCodeNorm = normalizeGrouponCode(payload.grouponCode);
    const grouponApplies = buildGrouponApplies(bookingMode, charterType, charterVariant);
    let grouponDiscount = 0;
    if (grouponCodeNorm) {
      try {
        const validated = await validateGrouponCode(grouponCodeNorm, grouponApplies);
        grouponDiscount = computeGrouponDiscount(validated, depositUsd);
      } catch (gErr) {
        return res.status(gErr.statusCode || 400).json({ error: gErr.message });
      }
    }
    const dueTodayAfterGroupon = roundMoney(depositUsd - grouponDiscount);
    const stripeCents = Math.round(dueTodayAfterGroupon * 100);
    // Below Stripe's ~$0.50 minimum we treat the deposit as fully covered by the voucher.
    const grouponCoversCheckout = Boolean(grouponCodeNorm) && stripeCents < 50;
    if (!grouponCoversCheckout && stripeCents < 50) {
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

    const isCharterBooking = bookingMode === 'charter';
    const captainFeeStored =
      bookingMode === 'rental' ? roundMoney(expected.captainFee || 0) : Number(booking.captain_fee || 0);
    const basePriceStored = roundMoney(
      expected.basePrice != null ? expected.basePrice : Number(booking.base_price || 0)
    );

    // ---- Path A: Groupon covers the full amount due today → skip Stripe.
    // Reserve the code atomically, create a finalized booking + waiver directly,
    // then send the customer to the insurance/verification step (same landing
    // page the post-payment flow uses).
    if (grouponCoversCheckout) {
      let reserved;
      try {
        reserved = await reserveGrouponCode(grouponCodeNorm, grouponApplies);
      } catch (gErr) {
        return res.status(gErr.statusCode || 409).json({ error: gErr.message });
      }

      // The voucher waives the entire amount due today.
      const covered = roundMoney(depositUsd);
      const paymentStatus = covered >= expected.totalPrice ? 'paid' : 'deposit_paid';
      const freeAdminNotes = [`Groupon ${grouponCodeNorm} applied (covered $${covered.toFixed(2)})`];
      if (booking.special_requests) {
        freeAdminNotes.push(`Special requests: ${String(booking.special_requests).trim()}`);
      }

      const freeBookingInsert = {
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
        deposit_amount: 0,
        deposit_paid: covered,
        balance_due: roundMoney(expected.totalPrice - covered),
        payment_status: paymentStatus,
        status: 'pending_verification',
        expires_at: null,
        stripe_checkout_session_id: null,
        stripe_payment_id: null,
        is_night_tour: Boolean(booking.is_night_tour),
        is_rocket_tour: Boolean(booking.is_rocket_tour),
        license_status: isCharterBooking ? 'verified' : booking.license_status || 'pending',
        insurance_status: isCharterBooking ? 'verified' : booking.insurance_status || 'pending',
        waiver_signed: true,
        terms_accepted: true,
        damage_fee_acknowledged: true,
        groupon_code: grouponCodeNorm,
        groupon_discount_amount: covered,
        admin_notes: freeAdminNotes.join('\n'),
        license_url: booking.license_url || null,
        insurance_url: booking.insurance_url || null,
      };

      const { data: freeRow, error: freeErr } = await supabase
        .from('bookings')
        .insert(freeBookingInsert)
        .select('id')
        .single();
      if (freeErr || !freeRow) {
        await releaseGrouponCodeSafe(reserved.id);
        if (isOverlapConstraintError(freeErr)) {
          return res.status(409).json({ error: SLOT_TAKEN_USER_MESSAGE });
        }
        console.error('[create-checkout-session] groupon booking insert:', freeErr?.message);
        return res.status(500).json({ error: 'Could not create your booking. Please try again.' });
      }

      const { error: waiverErr } = await supabase.from('waivers').insert({
        booking_id: freeRow.id,
        customer_id: customerRow.id,
        electronic_signature: waiverSignature,
        signature_date: legalAcceptedAt,
        ip_address: requestIpBestEffort(req),
        waiver_content: String(
          waiver?.waiverContent || waiver?.content || 'Florida Boating Liability Waiver'
        ).trim(),
        accepted: true,
      });
      if (waiverErr) {
        console.warn('[create-checkout-session] groupon waiver insert:', waiverErr.message);
      }

      // Code stays reserved (not redeemed) until staff approve insurance/ID and the
      // booking is confirmed — see trg_bookings_groupon_redeem. Cancelling the
      // booking before approval releases the reservation via the same trigger.

      return res.json({
        url: `${domain}/insurance-required?bookingId=${encodeURIComponent(freeRow.id)}`,
        grouponApplied: true,
        skipStripe: true,
      });
    }

    // ---- Path B: standard checkout (optionally with a partial Groupon discount).
    // Reserve the code first so it cannot be reused while this Stripe session is
    // open; it is redeemed at finalize or released if anything below fails.
    let grouponReservedId = null;
    if (grouponCodeNorm) {
      try {
        const reserved = await reserveGrouponCode(grouponCodeNorm, grouponApplies);
        grouponReservedId = reserved.id;
      } catch (gErr) {
        return res.status(gErr.statusCode || 409).json({ error: gErr.message });
      }
    }

    const checkoutBookingMode = String(booking.bookingMode || '').trim().toLowerCase();
    const checkoutCharterVariant = String(booking.charterVariant || '').trim().toLowerCase();
    const baseLineItemName =
      checkoutBookingMode === 'charter'
        ? checkoutCharterVariant === 'shared'
          ? 'Shared Charter Seat'
          : 'Private Charter Booking'
        : 'Boat Rental Deposit';
    const lineItemName = grouponDiscount > 0 ? `${baseLineItemName} (Groupon Applied)` : baseLineItemName;

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: lineItemName,
              },
              unit_amount: stripeCents,
            },
            quantity: 1,
          },
        ],
        success_url: `${domain}/insurance-required?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${domain}/booking`,
      });
    } catch (stripeErr) {
      await releaseGrouponCodeSafe(grouponReservedId);
      throw stripeErr;
    }

    if (!session?.id || !session?.url) {
      await releaseGrouponCodeSafe(grouponReservedId);
      return res.status(500).json({ error: 'No checkout URL' });
    }

    const authoritativeBooking = {
      ...booking,
      total_price: expected.totalPrice,
      deposit_amount: dueTodayAfterGroupon,
      balance_due: roundMoney(expected.totalPrice - expected.amountDueToday),
    };

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
      deposit_amount: dueTodayAfterGroupon,
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
      groupon_code: grouponCodeNorm || null,
      groupon_discount_amount: grouponDiscount > 0 ? grouponDiscount : null,
      admin_notes:
        grouponDiscount > 0
          ? `Checkout hold · expires ${expiresAt} · Groupon ${grouponCodeNorm} (-$${grouponDiscount.toFixed(2)})`
          : `Checkout hold · expires ${expiresAt}`,
      license_url: authoritativeBooking.license_url || null,
      insurance_url: authoritativeBooking.insurance_url || null,
    };

    const { error: holdErr } = await supabase.from('bookings').insert(holdInsert);
    if (holdErr) {
      await stripe.checkout.sessions.expire(session.id).catch(() => {});
      await releaseGrouponCodeSafe(grouponReservedId);
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
          // Carried to finalize: redeem this reservation and record the discount.
          groupon: grouponReservedId
            ? { id: grouponReservedId, code: grouponCodeNorm, discount_amount: grouponDiscount }
            : null,
        },
      },
      { onConflict: 'stripe_session_id' }
    );
    if (draftErr) {
      console.error('[create-checkout-session] checkout_drafts:', draftErr.message);
      await supabase.from('bookings').delete().eq('stripe_checkout_session_id', session.id);
      await stripe.checkout.sessions.expire(session.id).catch(() => {});
      await releaseGrouponCodeSafe(grouponReservedId);
      return res.status(500).json({ error: 'Could not save checkout session. Try again.' });
    }

    return res.json({ url: session.url });
  } catch (err) {
    console.error('[create-checkout-session]', err);
    return res.status(500).json({ error: err.message || 'Failed to create checkout session' });
  }
});

/**
 * Inline Groupon preview for the booking form. Read-only: prices the trip
 * server-side, validates the code, and reports the discount WITHOUT reserving
 * the code. The authoritative reservation still happens at checkout.
 */
app.post('/api/validate-groupon', async (req, res) => {
  try {
    if (!supabaseConfigured) {
      return res.status(503).json({ valid: false, error: 'Server not configured' });
    }
    const payload = req.body || {};
    const grouponCodeNorm = normalizeGrouponCode(payload.grouponCode);
    if (!grouponCodeNorm) {
      return res.status(400).json({ valid: false, error: 'Enter a reservation code.' });
    }

    const booking = payload.booking || {};
    if (!booking.boat_id) {
      return res.status(400).json({ valid: false, error: 'Select your boat and trip details first.' });
    }
    const bookingMode = String(booking.bookingMode || '').trim().toLowerCase();
    const charterType = String(booking.charterType || '').trim().toLowerCase();
    const charterVariant = String(booking.charterVariant || '').trim().toLowerCase();
    const passengerCountRaw = Number(booking.passengerCount);
    const passengerCount = Number.isFinite(passengerCountRaw) ? Math.max(1, Math.round(passengerCountRaw)) : 1;

    const { data: boatRow, error: boatErr } = await supabase
      .from('boats')
      .select('id, hourly_rate, half_day_rate, full_day_rate')
      .eq('id', String(booking.boat_id))
      .maybeSingle();
    if (boatErr || !boatRow) {
      return res.status(400).json({ valid: false, error: 'Could not price this trip yet.' });
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
    const dueToday = roundMoney(Number(expected.amountDueToday || 0));
    if (!Number.isFinite(dueToday) || dueToday <= 0) {
      return res.status(400).json({ valid: false, error: 'Could not price this trip yet.' });
    }

    const applies = buildGrouponApplies(bookingMode, charterType, charterVariant);
    let validated;
    try {
      validated = await validateGrouponCode(grouponCodeNorm, applies);
    } catch (gErr) {
      return res.status(gErr.statusCode || 400).json({ valid: false, error: gErr.message });
    }

    const discount = computeGrouponDiscount(validated, dueToday);
    const amountAfter = roundMoney(dueToday - discount);
    const coversFull = amountAfter < 0.5;
    return res.json({
      valid: true,
      code: grouponCodeNorm,
      discountType: validated.discount_type,
      discountAmount: discount,
      amountDueToday: dueToday,
      amountAfter: coversFull ? 0 : amountAfter,
      coversFull,
    });
  } catch (err) {
    console.error('[validate-groupon]', err);
    return res.status(500).json({ valid: false, error: 'Could not validate the code right now.' });
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

    // Trip Checklist deep link. No public confirmation code exists, so the booking
    // UUID + matching email act as the capability token for the email-gated page.
    const checklistBase = (verificationReminder.publicAppBase() || 'https://launchzonecharters.com').replace(
      /\/+$/,
      ''
    );
    const checklistUrl = `${checklistBase}/trip-checklist?bookingId=${encodeURIComponent(
      bookingIdSafe
    )}&email=${encodeURIComponent(emailSafe)}`;

    const customerSend = resend.emails.send({
      from: resendFrom,
      to: emailSafe,
      subject: 'Your Launch Zone Booking Confirmation',
      html: `
        <p>Thank you for booking with Launch Zone Rentals.</p>
        <p><strong>Booking ID:</strong> ${bookingIdSafe}</p>
        <p>We will follow up with pickup details and next steps.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0" />
        <h2 style="margin:0 0 8px;font-size:18px">Complete Your Trip Checklist</h2>
        <p style="margin:0 0 14px">
          Before your trip, please complete your Trip Checklist. This is where you confirm your deposit
          status, sign your waiver, get Buoy insurance, upload proof, and upload any required ID or
          boating documents.
        </p>
        <p style="margin:0 0 18px">
          <a href="${checklistUrl}"
             style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">
            Complete Your Trip Checklist
          </a>
        </p>
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

function isBookingUuidParam(id) {
  const s = String(id || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** Public read: insurance compliance flag for post-checkout confirmation UI (UUID is the capability token). */
app.get('/api/public/booking-insurance-status', async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: 'Server not configured' });
    const bookingId = String(req.query.bookingId || '').trim();
    if (!isBookingUuidParam(bookingId)) return res.status(400).json({ error: 'Invalid booking id' });
    const { data, error } = await supabase
      .from('bookings')
      .select('insurance_status')
      .eq('id', bookingId)
      .maybeSingle();
    if (error) {
      console.error('[booking-insurance-status]', error.message);
      return res.status(500).json({ error: 'Could not load booking' });
    }
    if (!data) return res.status(404).json({ error: 'Not found' });
    return res.json({ insurance_status: data.insurance_status });
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
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!isBookingUuidParam(bookingId) || !email) {
      return res.status(400).json({ error: 'bookingId and email are required' });
    }
    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select('id, customer_id, insurance_status')
      .eq('id', bookingId)
      .maybeSingle();
    if (bErr || !booking) return res.status(404).json({ error: 'Booking not found' });
    const { data: customer, error: cErr } = await supabase
      .from('customers')
      .select('email')
      .eq('id', booking.customer_id)
      .maybeSingle();
    if (cErr || !customer?.email) return res.status(400).json({ error: 'Could not verify customer' });
    if (customer.email.trim().toLowerCase() !== email) {
      return res.status(403).json({ error: 'Email does not match this booking' });
    }
    if (booking.insurance_status === 'verified') {
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
    return res.json({ ok: true, insurance_status: 'submitted' });
  } catch (err) {
    console.error('[booking-mark-insurance-submitted]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

// --- Trip Checklist: waiver signing + private document uploads -------------
const TRIP_DOC_BUCKET = 'trip-documents';
const TRIP_DOC_TYPES = ['buoy_insurance_proof', 'government_id', 'boater_safety_card'];
const TRIP_DOC_MAX_BYTES = 5 * 1024 * 1024;
/** Allowed upload MIME types -> file extension. */
const TRIP_DOC_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};
const tripDocUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TRIP_DOC_MAX_BYTES, files: 1 },
});

/**
 * Confirm the supplied email matches the booking's customer (the capability check
 * for every customer-facing checklist write). Throws an Error with .statusCode.
 */
async function assertBookingEmail(bookingId, email) {
  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select('id, customer_id')
    .eq('id', bookingId)
    .maybeSingle();
  if (bErr) {
    const e = new Error('Could not load booking');
    e.statusCode = 500;
    throw e;
  }
  if (!booking) {
    const e = new Error('Booking not found');
    e.statusCode = 404;
    throw e;
  }
  const { data: customer, error: cErr } = await supabase
    .from('customers')
    .select('email')
    .eq('id', booking.customer_id)
    .maybeSingle();
  if (cErr || !customer?.email) {
    const e = new Error('Could not verify customer');
    e.statusCode = 400;
    throw e;
  }
  if (customer.email.trim().toLowerCase() !== String(email || '').trim().toLowerCase()) {
    const e = new Error('That email does not match this booking.');
    e.statusCode = 403;
    throw e;
  }
  return booking;
}

function safeDocSegment(name) {
  return String(name || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80) || 'document';
}

/** Latest booking_documents row per type (most recent upload wins). */
function latestDocsByType(rows) {
  const map = {};
  for (const row of rows || []) {
    const t = row.document_type;
    if (!map[t] || new Date(row.uploaded_at) > new Date(map[t].uploaded_at)) {
      map[t] = row;
    }
  }
  return map;
}

/**
 * Sign the liability waiver by typing a full legal name (email-gated). Records an
 * immutable booking_waivers row and mirrors waiver_signed onto the booking so the
 * existing admin view stays accurate.
 */
app.post('/api/trip-checklist/sign-waiver', async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: 'Server not configured' });
    const bookingId = String(req.body?.bookingId || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const typedName = String(req.body?.typedName || '').trim();
    const agreedTerms = req.body?.agreedTerms === true || req.body?.agreedTerms === 'true';
    const agreedSafety = req.body?.agreedSafety === true || req.body?.agreedSafety === 'true';
    if (!isBookingUuidParam(bookingId) || !email) {
      return res.status(400).json({ error: 'bookingId and email are required' });
    }
    if (typedName.length < 2) {
      return res.status(400).json({ error: 'Please type your full legal name.' });
    }
    if (!agreedTerms || !agreedSafety) {
      return res.status(400).json({ error: 'You must agree to both the terms and the safety acknowledgement.' });
    }

    await assertBookingEmail(bookingId, email);

    const { error: wErr } = await supabase.from('booking_waivers').insert({
      booking_id: bookingId,
      typed_name: typedName,
      agreed_terms: agreedTerms,
      agreed_safety: agreedSafety,
      ip_address: requestIpBestEffort(req),
    });
    if (wErr) {
      console.error('[sign-waiver]', wErr.message);
      return res.status(500).json({ error: 'Could not save your waiver. Please try again.' });
    }

    await supabase
      .from('bookings')
      .update({ waiver_signed: true, waiver_signed_at: new Date().toISOString() })
      .eq('id', bookingId);

    return res.json({ ok: true });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error('[sign-waiver]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

/**
 * Upload a pre-trip document to the PRIVATE trip-documents bucket (email-gated,
 * multipart). File type + size are validated server-side; the browser never gets
 * a public URL. Records a booking_documents row with status 'uploaded'.
 */
app.post('/api/trip-checklist/upload-document', tripDocUpload.single('file'), async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: 'Server not configured' });
    const bookingId = String(req.body?.bookingId || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const documentType = String(req.body?.documentType || '').trim();
    const file = req.file;

    if (!isBookingUuidParam(bookingId) || !email) {
      return res.status(400).json({ error: 'bookingId and email are required' });
    }
    if (!TRIP_DOC_TYPES.includes(documentType)) {
      return res.status(400).json({ error: 'Invalid document type' });
    }
    if (!file || !file.buffer || file.size === 0) {
      return res.status(400).json({ error: 'No file received' });
    }
    if (file.size > TRIP_DOC_MAX_BYTES) {
      return res.status(400).json({ error: 'File must be 5 MB or smaller.' });
    }
    const ext = TRIP_DOC_MIME[file.mimetype];
    if (!ext) {
      return res.status(400).json({ error: 'Please upload a JPEG, PNG, WebP, GIF, or PDF.' });
    }

    await assertBookingEmail(bookingId, email);

    const storagePath = `${bookingId}/${documentType}/${Date.now()}-${safeDocSegment(file.originalname)}`;
    const { error: upErr } = await supabase.storage
      .from(TRIP_DOC_BUCKET)
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
    if (upErr) {
      console.error('[upload-document] storage:', upErr.message);
      return res.status(500).json({ error: 'Upload failed. Please try again.' });
    }

    const { error: insErr } = await supabase.from('booking_documents').insert({
      booking_id: bookingId,
      document_type: documentType,
      storage_path: storagePath,
      status: 'uploaded',
    });
    if (insErr) {
      console.error('[upload-document] insert:', insErr.message);
      return res.status(500).json({ error: 'Could not record your upload. Please try again.' });
    }

    return res.json({ ok: true, status: 'uploaded' });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File must be 5 MB or smaller.' : 'Upload error' });
    }
    console.error('[upload-document]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

/**
 * Trip Checklist (public, email-gated). Returns the server-computed state of every
 * pre-trip requirement plus an overall Ready-For-Departure flag. The booking UUID +
 * matching customer email act as the capability token. All values are read/derived
 * server-side (never trust the client), and reads use the service role so this works
 * even after the booking is confirmed (anon RLS only exposes pending bookings).
 */
app.get('/api/public/trip-checklist', async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: 'Server not configured' });
    const bookingId = String(req.query.bookingId || '').trim();
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!isBookingUuidParam(bookingId)) return res.status(400).json({ error: 'Invalid booking id' });
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select(
        'id, customer_id, status, payment_status, deposit_paid, deposit_amount, balance_due, total_price, waiver_signed, insurance_status, license_status, license_url, captain_included, rental_type, boater_safety_required, ready_for_departure_override, boat_id'
      )
      .eq('id', bookingId)
      .maybeSingle();
    if (bErr) {
      console.error('[trip-checklist]', bErr.message);
      return res.status(500).json({ error: 'Could not load booking' });
    }
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const { data: customer, error: cErr } = await supabase
      .from('customers')
      .select('email, full_name')
      .eq('id', booking.customer_id)
      .maybeSingle();
    if (cErr || !customer?.email) return res.status(400).json({ error: 'Could not verify customer' });
    if (customer.email.trim().toLowerCase() !== email) {
      return res.status(403).json({ error: 'That email does not match this booking.' });
    }

    // New source of truth: booking_documents (private bucket) + booking_waivers.
    // Legacy user_verifications is read only as a fallback for older bookings.
    const [{ data: docRows }, { data: waiverRows }, { data: uvRaw }] = await Promise.all([
      supabase
        .from('booking_documents')
        .select('document_type, status, rejection_note, uploaded_at')
        .eq('booking_id', bookingId),
      supabase.from('booking_waivers').select('id').eq('booking_id', bookingId).limit(1),
      supabase.from('user_verifications').select('*').eq('booking_id', bookingId).maybeSingle(),
    ]);
    const docs = latestDocsByType(docRows);
    const uv = uvRaw || {};

    // Map a booking_documents row (uploaded/approved/rejected) to checklist shape,
    // falling back to the legacy status/value when no new document exists yet.
    const docState = (type, legacyStatus, legacyVerified) => {
      const row = docs[type];
      if (row) {
        return {
          status: row.status,
          verified: row.status === 'approved',
          uploaded: true,
          rejectionNote: row.rejection_note || null,
        };
      }
      return {
        status: legacyStatus || 'pending',
        verified: Boolean(legacyVerified),
        uploaded: false,
        rejectionNote: null,
      };
    };

    // Boater card: admin override wins; otherwise required only for self-drive (no captain).
    const boaterCardRequired =
      booking.boater_safety_required === true
        ? true
        : booking.boater_safety_required === false
          ? false
          : booking.captain_included === false;

    const depositPaid =
      ['deposit_paid', 'paid'].includes(String(booking.payment_status)) ||
      Number(booking.deposit_paid || 0) > 0;
    const waiverSigned = (Array.isArray(waiverRows) && waiverRows.length > 0) || booking.waiver_signed === true;

    const insurance = docState(
      'buoy_insurance_proof',
      uv.buoy_status === 'verified' ? 'approved' : uv.buoy_proof_url ? 'uploaded' : 'pending',
      uv.buoy_status === 'verified' || booking.insurance_status === 'verified'
    );
    const idDocument = docState(
      'government_id',
      booking.license_status === 'verified' ? 'approved' : booking.license_url ? 'uploaded' : 'pending',
      booking.license_status === 'verified'
    );
    const boaterCard = docState('boater_safety_card', 'pending', false);

    // Auto-readiness from the individual requirements; the admin override (when set)
    // wins so staff can force-clear (true) or force-hold (false) a booking.
    const autoReady =
      depositPaid &&
      waiverSigned &&
      insurance.verified &&
      idDocument.verified &&
      (!boaterCardRequired || boaterCard.verified);
    const readyForDeparture =
      booking.ready_for_departure_override === true
        ? true
        : booking.ready_for_departure_override === false
          ? false
          : autoReady;

    return res.json({
      bookingId: booking.id,
      bookingStatus: booking.status,
      boatId: booking.boat_id,
      customerName: customer.full_name || null,
      deposit: {
        paid: depositPaid,
        amountPaid: Number(booking.deposit_paid || 0),
        balanceDue: Number(booking.balance_due || 0),
        totalPrice: Number(booking.total_price || 0),
        paymentStatus: booking.payment_status || 'pending',
      },
      waiver: { signed: waiverSigned },
      // Note: file URLs are intentionally NOT exposed to customers (private bucket).
      insurance,
      idDocument,
      boaterCard: { ...boaterCard, required: boaterCardRequired },
      readyForDeparture,
    });
  } catch (err) {
    console.error('[trip-checklist]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

/**
 * Record a customer-uploaded pre-trip document (email-gated). The file itself is
 * uploaded to the public `licenses` Storage bucket by the client first; this only
 * stores the resulting URL + marks it submitted for admin review.
 */
app.post('/api/booking-submit-document', async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: 'Server not configured' });
    const bookingId = String(req.body?.bookingId || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const type = String(req.body?.type || '').trim();
    const url = String(req.body?.url || '').trim();
    if (!isBookingUuidParam(bookingId) || !email || !url) {
      return res.status(400).json({ error: 'bookingId, email, type and url are required' });
    }
    if (!['id', 'boater', 'buoy'].includes(type)) {
      return res.status(400).json({ error: 'Invalid document type' });
    }

    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select('id, customer_id')
      .eq('id', bookingId)
      .maybeSingle();
    if (bErr || !booking) return res.status(404).json({ error: 'Booking not found' });
    const { data: customer, error: cErr } = await supabase
      .from('customers')
      .select('email')
      .eq('id', booking.customer_id)
      .maybeSingle();
    if (cErr || !customer?.email) return res.status(400).json({ error: 'Could not verify customer' });
    if (customer.email.trim().toLowerCase() !== email) {
      return res.status(403).json({ error: 'Email does not match this booking' });
    }

    const patch = { booking_id: bookingId, updated_at: new Date().toISOString() };
    if (type === 'buoy') {
      patch.buoy_proof_url = url;
      patch.buoy_status = 'pending';
    } else if (type === 'id') {
      patch.id_document_url = url;
      patch.id_document_status = 'submitted';
    } else {
      patch.boater_card_url = url;
      patch.boater_card_status = 'submitted';
    }

    const { error: upErr } = await supabase
      .from('user_verifications')
      .upsert(patch, { onConflict: 'booking_id' });
    if (upErr) {
      console.error('[booking-submit-document]', upErr.message);
      return res.status(500).json({ error: 'Could not save document' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[booking-submit-document]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

/** Admin: list a booking's signed waiver(s) + uploaded documents (statuses only). */
app.get('/api/admin/booking-documents', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const bookingId = String(req.query.bookingId || '').trim();
    if (!isBookingUuidParam(bookingId)) return res.status(400).json({ error: 'Invalid booking id' });
    const [{ data: documents, error: dErr }, { data: waivers, error: wErr }] = await Promise.all([
      supabase
        .from('booking_documents')
        .select('id, document_type, status, rejection_note, uploaded_at, approved_at')
        .eq('booking_id', bookingId)
        .order('uploaded_at', { ascending: false }),
      supabase
        .from('booking_waivers')
        .select('id, typed_name, agreed_terms, agreed_safety, signed_at')
        .eq('booking_id', bookingId)
        .order('signed_at', { ascending: false }),
    ]);
    if (dErr || wErr) {
      console.error('[admin/booking-documents]', dErr?.message || wErr?.message);
      return res.status(500).json({ error: 'Could not load documents' });
    }
    return res.json({ documents: documents || [], waivers: waivers || [] });
  } catch (err) {
    console.error('[admin/booking-documents]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

/** Admin: short-lived signed URL to view a private document (never exposed publicly). */
app.get('/api/admin/booking-document/:id/signed-url', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = String(req.params.id || '').trim();
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid document id' });
    const { data: doc, error } = await supabase
      .from('booking_documents')
      .select('storage_path')
      .eq('id', id)
      .maybeSingle();
    if (error || !doc) return res.status(404).json({ error: 'Document not found' });
    const { data: signed, error: sErr } = await supabase.storage
      .from(TRIP_DOC_BUCKET)
      .createSignedUrl(doc.storage_path, 120);
    if (sErr || !signed?.signedUrl) {
      console.error('[admin/document-signed-url]', sErr?.message);
      return res.status(500).json({ error: 'Could not create signed URL' });
    }
    return res.json({ url: signed.signedUrl });
  } catch (err) {
    console.error('[admin/document-signed-url]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

/** Admin: approve or reject an uploaded document. */
app.post('/api/admin/booking-document/:id/status', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = String(req.params.id || '').trim();
    const status = String(req.body?.status || '').trim();
    const rejectionNote = req.body?.rejectionNote
      ? String(req.body.rejectionNote).trim().slice(0, 500)
      : null;
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid document id' });
    if (!['uploaded', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const patch = {
      status,
      approved_at: status === 'approved' ? new Date().toISOString() : null,
      rejection_note: status === 'rejected' ? rejectionNote : null,
    };
    const { error } = await supabase.from('booking_documents').update(patch).eq('id', id);
    if (error) {
      console.error('[admin/document-status]', error.message);
      return res.status(500).json({ error: 'Could not update status' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin/document-status]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

/**
 * Compute the Trip Readiness summary for a single booking row, given its related
 * documents/waivers/legacy verification. Mirrors the public /api/public/trip-checklist
 * logic so staff and customers always see the same readiness verdict.
 */
function computeTripReadiness(booking, docsRow, hasWaiver, uvRow) {
  const docs = docsRow || {};
  const uv = uvRow || {};
  const docState = (type, legacyStatus, legacyVerified) => {
    const row = docs[type];
    if (row) {
      return { status: row.status, verified: row.status === 'approved', uploaded: true };
    }
    return { status: legacyStatus || 'pending', verified: Boolean(legacyVerified), uploaded: false };
  };

  const boaterCardRequired =
    booking.boater_safety_required === true
      ? true
      : booking.boater_safety_required === false
        ? false
        : booking.captain_included === false;

  const depositPaid =
    ['deposit_paid', 'paid'].includes(String(booking.payment_status)) ||
    Number(booking.deposit_paid || 0) > 0;
  const waiverSigned = Boolean(hasWaiver) || booking.waiver_signed === true;

  const insurance = docState(
    'buoy_insurance_proof',
    uv.buoy_status === 'verified' ? 'approved' : uv.buoy_proof_url ? 'uploaded' : 'pending',
    uv.buoy_status === 'verified' || booking.insurance_status === 'verified'
  );
  const idDocument = docState(
    'government_id',
    booking.license_status === 'verified' ? 'approved' : booking.license_url ? 'uploaded' : 'pending',
    booking.license_status === 'verified'
  );
  const boaterCard = docState('boater_safety_card', 'pending', false);

  const autoReady =
    depositPaid &&
    waiverSigned &&
    insurance.verified &&
    idDocument.verified &&
    (!boaterCardRequired || boaterCard.verified);
  const readyForDeparture =
    booking.ready_for_departure_override === true
      ? true
      : booking.ready_for_departure_override === false
        ? false
        : autoReady;

  return {
    depositPaid,
    waiverSigned,
    insurance: { status: insurance.status, verified: insurance.verified },
    idDocument: { status: idDocument.status, verified: idDocument.verified },
    boaterCard: { status: boaterCard.status, verified: boaterCard.verified, required: boaterCardRequired },
    autoReady,
    readyForDeparture,
    readyOverride: booking.ready_for_departure_override ?? null,
  };
}

/**
 * Admin: searchable Trip Readiness list. Returns recent bookings with a server-computed
 * readiness summary (deposit / waiver / Buoy proof / ID / boater card) so staff can triage
 * pre-trip requirements from one screen. Optional `?search=` matches customer name/email.
 */
app.get('/api/admin/trip-readiness', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const statusFilter = String(req.query.status || '').trim();

    let q = supabase
      .from('bookings')
      .select(
        'id, status, payment_status, deposit_paid, balance_due, total_price, waiver_signed, insurance_status, license_status, license_url, captain_included, boater_safety_required, ready_for_departure_override, start_time, boat_id, customers(full_name, email), boats(name)'
      )
      .order('start_time', { ascending: false })
      .limit(200);
    if (statusFilter) q = q.eq('status', statusFilter);

    const { data: rows, error } = await q;
    if (error) {
      console.error('[admin/trip-readiness]', error.message);
      return res.status(500).json({ error: 'Could not load bookings' });
    }

    let bookings = rows || [];
    if (search) {
      bookings = bookings.filter((b) => {
        const c = Array.isArray(b.customers) ? b.customers[0] : b.customers;
        const name = String(c?.full_name || '').toLowerCase();
        const email = String(c?.email || '').toLowerCase();
        return name.includes(search) || email.includes(search) || String(b.id).includes(search);
      });
    }
    bookings = bookings.slice(0, 50);
    const ids = bookings.map((b) => b.id);

    let docsByBooking = {};
    let waiverIds = new Set();
    let uvByBooking = {};
    if (ids.length) {
      const [{ data: docRows }, { data: waiverRows }, { data: uvRows }] = await Promise.all([
        supabase
          .from('booking_documents')
          .select('booking_id, document_type, status, rejection_note, uploaded_at')
          .in('booking_id', ids),
        supabase.from('booking_waivers').select('booking_id').in('booking_id', ids),
        supabase.from('user_verifications').select('*').in('booking_id', ids),
      ]);
      const grouped = {};
      (docRows || []).forEach((r) => {
        (grouped[r.booking_id] = grouped[r.booking_id] || []).push(r);
      });
      Object.keys(grouped).forEach((bid) => {
        docsByBooking[bid] = latestDocsByType(grouped[bid]);
      });
      waiverIds = new Set((waiverRows || []).map((r) => r.booking_id));
      (uvRows || []).forEach((r) => {
        uvByBooking[r.booking_id] = r;
      });
    }

    const result = bookings.map((b) => {
      const c = Array.isArray(b.customers) ? b.customers[0] : b.customers;
      const boat = Array.isArray(b.boats) ? b.boats[0] : b.boats;
      return {
        id: b.id,
        status: b.status,
        startTime: b.start_time,
        customerName: c?.full_name || null,
        customerEmail: c?.email || null,
        boatName: boat?.name || null,
        balanceDue: Number(b.balance_due || 0),
        totalPrice: Number(b.total_price || 0),
        ...computeTripReadiness(b, docsByBooking[b.id], waiverIds.has(b.id), uvByBooking[b.id]),
      };
    });

    return res.json({ bookings: result });
  } catch (err) {
    console.error('[admin/trip-readiness]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

/**
 * Admin: set per-booking trip flags. Accepts any subset of:
 *   - boaterSafetyRequired: boolean | null  (null = auto: required when no captain)
 *   - readyOverride:        boolean | null  (null = auto-compute readiness)
 */
app.post('/api/admin/booking/:id/trip-flags', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = String(req.params.id || '').trim();
    if (!isBookingUuidParam(id)) return res.status(400).json({ error: 'Invalid booking id' });

    const patch = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'boaterSafetyRequired')) {
      const v = req.body.boaterSafetyRequired;
      if (v !== null && typeof v !== 'boolean') return res.status(400).json({ error: 'boaterSafetyRequired must be boolean or null' });
      patch.boater_safety_required = v;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'readyOverride')) {
      const v = req.body.readyOverride;
      if (v !== null && typeof v !== 'boolean') return res.status(400).json({ error: 'readyOverride must be boolean or null' });
      patch.ready_for_departure_override = v;
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No recognized flags provided' });

    const { error } = await supabase.from('bookings').update(patch).eq('id', id);
    if (error) {
      console.error('[admin/trip-flags]', error.message);
      return res.status(500).json({ error: 'Could not update booking' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin/trip-flags]', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

/** Secured cron hook + optional internal scheduler; same secret pattern as other automation. */
app.get('/api/cron/trip-insurance-reminders', async (req, res) => {
  try {
    const secret = String(process.env.CRON_SECRET || '').trim();
    const auth = String(req.headers.authorization || '');
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const tok = bearer || String(req.query.secret || '').trim();
    if (!secret || tok !== secret) return res.status(401).json({ error: 'Unauthorized' });
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

/** Admin-only: list Groupon/voucher codes with redemption status + linked booking. */
app.get('/api/admin/groupon-codes', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const { data, error } = await supabase
      .from('groupon_codes')
      .select(
        'id, code, status, discount_type, discount_amount, applies_to, max_uses, used_count, expires_at, redeemed_booking_id, redeemed_at, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      console.error('[admin-groupon] select error:', error.message);
      return res.status(500).json({ error: 'Could not load Groupon codes' });
    }
    return res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error('[admin-groupon]', err?.stack || err);
    return res.status(500).json({ error: 'Could not load Groupon codes' });
  }
});

/** Admin-only: create or update a single Groupon code (bulk import uses the CSV script). */
app.post('/api/admin/groupon-codes', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const body = req.body || {};
    const code = normalizeGrouponCode(body.code);
    if (!code) return res.status(400).json({ error: 'Code is required.' });

    const discountType = ['fixed', 'percent'].includes(String(body.discount_type))
      ? String(body.discount_type)
      : 'fixed';

    const discountAmount = Number(body.discount_amount);
    if (!Number.isFinite(discountAmount) || discountAmount < 0) {
      return res.status(400).json({ error: 'Discount amount must be a non-negative number.' });
    }

    const appliesTo = String(body.applies_to || 'bio_tour').trim() || 'bio_tour';

    const maxUsesRaw = Number(body.max_uses);
    const maxUses = Number.isFinite(maxUsesRaw) && maxUsesRaw >= 1 ? Math.round(maxUsesRaw) : 1;

    let expiresAt = null;
    if (body.expires_at) {
      const d = new Date(String(body.expires_at));
      if (!Number.isFinite(d.getTime())) {
        return res.status(400).json({ error: 'Invalid expiry date.' });
      }
      expiresAt = d.toISOString();
    }

    // Upsert on code: re-saving an existing code updates its terms without
    // resetting used_count / redemption history (those columns are omitted).
    const { data, error } = await supabase
      .from('groupon_codes')
      .upsert(
        {
          code,
          status: 'active',
          discount_type: discountType,
          discount_amount: discountAmount,
          applies_to: appliesTo,
          max_uses: maxUses,
          expires_at: expiresAt,
        },
        { onConflict: 'code', ignoreDuplicates: false }
      )
      .select('id, code')
      .single();
    if (error) {
      console.error('[admin-groupon] upsert error:', error.message);
      return res.status(500).json({ error: 'Could not save the code.' });
    }
    return res.json({ success: true, id: data.id, code: data.code });
  } catch (err) {
    console.error('[admin-groupon-create]', err?.stack || err);
    return res.status(500).json({ error: 'Could not save the code.' });
  }
});

/** Admin-only: activate or disable a Groupon code (does not affect redeemed history). */
app.post('/api/admin/groupon-codes/:id/status', async (req, res) => {
  const adminUser = await verifyAdminRequest(req, res);
  if (!adminUser) return;
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Code id is required.' });
    const status = String((req.body || {}).status || '').trim().toLowerCase();
    if (!['active', 'disabled'].includes(status)) {
      return res.status(400).json({ error: "Status must be 'active' or 'disabled'." });
    }
    const { data, error } = await supabase
      .from('groupon_codes')
      .update({ status })
      .eq('id', id)
      .select('id, status')
      .single();
    if (error || !data) {
      console.error('[admin-groupon-status] update error:', error?.message);
      return res.status(500).json({ error: 'Could not update the code.' });
    }
    return res.json({ success: true, id: data.id, status: data.status });
  } catch (err) {
    console.error('[admin-groupon-status]', err?.stack || err);
    return res.status(500).json({ error: 'Could not update the code.' });
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
