/**
 * Upcoming launches from Launch Library 2 (The Space Devs).
 * ROCKET_API_URL defaults to public upcoming endpoint.
 */

const fetch = require('node-fetch');
const { filterVerifiedLaunches } = require('./launchVerification');

/** Request enough rows to survive Space Coast filtering (verified downstream). */
const DEFAULT_ROCKET_URL = 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=50';

/** Max missions after verification (customer-facing list). */
const MAX_VERIFIED_LAUNCHES = 8;

/** Reuse upstream responses briefly to limit rate impact on The Space Devs API. */
const CACHE_MS = 5 * 60 * 1000;
let launchCache = { at: 0, results: [] };

function mapRocketPreview(rocket) {
  if (!rocket || typeof rocket !== 'object') return undefined;
  const c = rocket.configuration;
  if (!c || typeof c !== 'object') return undefined;
  const fam = c.family;
  return {
    configuration: {
      full_name: typeof c.full_name === 'string' ? c.full_name : undefined,
      name: typeof c.name === 'string' ? c.name : undefined,
      family:
        fam && typeof fam === 'object' && typeof fam.name === 'string'
          ? { name: fam.name }
          : undefined,
    },
  };
}

function mapToPreview(launch) {
  if (!launch || typeof launch !== 'object') return null;
  return {
    id: launch.id,
    name: launch.name,
    net: launch.net ?? null,
    window_start: launch.window_start ?? null,
    status: launch.status,
    launch_service_provider: launch.launch_service_provider,
    pad: launch.pad,
    rocket: mapRocketPreview(launch.rocket),
  };
}

async function getLaunches() {
  const now = Date.now();
  if (launchCache.results.length && now - launchCache.at < CACHE_MS) {
    return launchCache.results;
  }

  try {
    const url = (process.env.ROCKET_API_URL || DEFAULT_ROCKET_URL).trim();
    console.log('[rocketScheduleService] fetching', url);

    const res = await fetch(url);

    if (!res.ok) {
      console.error('❌ Rocket API HTTP', res.status, await res.text().catch(() => ''));
      return [];
    }

    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];

    const verified = filterVerifiedLaunches(results);
    const sliced = verified.slice(0, MAX_VERIFIED_LAUNCHES);
    console.log(
      '[rocketScheduleService] verified launches=',
      sliced.length,
      'kept from',
      results.length,
      'raw'
    );
    launchCache = { at: now, results: sliced };
    return sliced;
  } catch (err) {
    console.error('❌ Rocket API error:', err?.message || err);
    if (err?.stack) console.error(err.stack);
    return [];
  }
}

/**
 * Public launch list for lightweight GET routes and UI previews (no weather / AI).
 */
async function getLaunchSchedulePreview() {
  const raw = await getLaunches();
  const launches = raw.map(mapToPreview).filter(Boolean);
  return {
    success: true,
    source: 'Launch Library 2 (The Space Devs)',
    /** All customer-facing rows pass server-side Space Coast verification. */
    verification: {
      applied: true,
      scope:
        'Florida Space Coast only — Kennedy Space Center & Cape Canaveral SFS area (water-viewing relevance)',
    },
    fetchedAt: new Date().toISOString(),
    launches,
  };
}

module.exports = {
  getLaunches,
  getLaunchSchedulePreview,
  DEFAULT_ROCKET_URL,
};
