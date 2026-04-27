/**
 * Launch Zone — customer-facing schedule verification.
 * Raw Launch Library 2 rows are filtered before cache, API responses, and AI context.
 */

/** Rough bounding box: Kennedy + Cape Canaveral SFS (Brevard County coast). */
const SPACE_COAST = {
  minLat: 28.3,
  maxLat: 28.85,
  minLon: -81.0,
  maxLon: -80.35,
};

const EXCLUDE_HAYSTACK = new RegExp(
  [
    'vandenberg',
    'california',
    '\\bvsfb\\b',
    'wallops',
    'virginia',
    'alaska',
    'kodiak',
    'china',
    'wenchang',
    'jiuquan',
    'kazakh',
    'baikonur',
    'russia',
    'plesetsk',
    'india',
    'sriharikota',
    'french guiana',
    'kourou',
    'new zealand',
    'mahia',
    'ukraine',
    'sea launch',
    'starbase',
    'boca chica',
    'south texas',
    'united kingdom',
    'scotland',
    'norway',
    'sweden',
    'japan',
    'tanegashima',
    'north korea',
    'south korea',
    'naro',
  ].join('|'),
  'i'
);

/** Pads / sites at KSC or Cape Canaveral SFS (avoid generic “SLC” that matches other ranges). */
const KSC_CCSFS_PAD = new RegExp(
  [
    '\\bslc[- ]?40\\b',
    '\\bslc[- ]?41\\b',
    '\\bslc[- ]?37\\b',
    '\\blc[- ]?39',
    'pad\\s*39\\s*[ab]?',
    'launch complex 39',
    'launch complex 40',
    'launch complex 41',
    'kennedy space center',
    '\\bksc\\b',
    'cape canaveral space force',
    '\\bccsfs\\b',
    'space launch complex 40',
    'space launch complex 41',
    'space launch complex 37',
  ].join('|'),
  'i'
);

const FLORIDA_CONTEXT = new RegExp(
  ['florida', 'cape canaveral', 'kennedy', 'merritt island', 'brevard'].join('|'),
  'i'
);

function parseLaunchTime(launch) {
  const raw = launch.net || launch.window_start;
  if (raw == null || typeof raw !== 'string') return null;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function getStatusHay(launch) {
  const s = launch.status;
  if (!s) return '';
  if (typeof s === 'object' && s.name != null) return String(s.name).toLowerCase();
  if (typeof s === 'string') return s.toLowerCase();
  return '';
}

function verifyLaunch(launch) {
  if (!launch || typeof launch !== 'object') {
    return { ok: false, reason: 'not_object' };
  }

  if (launch.id == null || launch.id === '') {
    return { ok: false, reason: 'missing_id' };
  }

  const name = typeof launch.name === 'string' ? launch.name.trim() : '';
  if (name.length < 2) {
    return { ok: false, reason: 'short_name' };
  }
  if (/^(tbd|unknown|mission)$/i.test(name)) {
    return { ok: false, reason: 'placeholder_name' };
  }

  const when = parseLaunchTime(launch);
  if (!when) {
    return { ok: false, reason: 'bad_time' };
  }
  if (when.getTime() < Date.now() - 2 * 60 * 60 * 1000) {
    return { ok: false, reason: 'stale_time' };
  }

  const st = getStatusHay(launch);
  if (st && /\b(cancelled|canceled|scrubbed|delayed indefinitely)\b/i.test(st)) {
    return { ok: false, reason: 'bad_status' };
  }

  const pad = launch.pad;
  if (!pad || typeof pad !== 'object') {
    return { ok: false, reason: 'missing_pad' };
  }

  const padName = typeof pad.name === 'string' ? pad.name : '';
  const loc = pad.location && typeof pad.location === 'object' ? pad.location : null;

  const hay = [
    padName,
    loc && typeof loc.name === 'string' ? loc.name : '',
    loc && typeof loc.region === 'string' ? loc.region : '',
    loc && typeof loc.country_code === 'string' ? loc.country_code : '',
    name,
  ]
    .join(' ')
    .toLowerCase();

  if (EXCLUDE_HAYSTACK.test(hay)) {
    return { ok: false, reason: 'excluded_region' };
  }

  let lat;
  let lon;
  if (loc) {
    const plat = parseFloat(loc.latitude);
    const plon = parseFloat(loc.longitude);
    if (!Number.isNaN(plat) && !Number.isNaN(plon)) {
      lat = plat;
      lon = plon;
    }
  }

  if (lat != null && lon != null) {
    if (lat >= SPACE_COAST.minLat && lat <= SPACE_COAST.maxLat && lon >= SPACE_COAST.minLon && lon <= SPACE_COAST.maxLon) {
      return { ok: true, reason: 'coords_space_coast' };
    }
    if (lat < 24 || lat > 31.5 || lon > -79 || lon < -82) {
      return { ok: false, reason: 'coords_outside_us_se_coast' };
    }
  }

  const country = loc && typeof loc.country_code === 'string' ? loc.country_code.toUpperCase() : '';
  if (country && country !== 'USA' && country !== 'US') {
    return { ok: false, reason: 'non_us' };
  }

  const padMatches = KSC_CCSFS_PAD.test(padName) || KSC_CCSFS_PAD.test(hay);
  const inFloridaContext = FLORIDA_CONTEXT.test(hay);

  if (padMatches && inFloridaContext) {
    return { ok: true, reason: 'pad_and_florida_context' };
  }

  if (padMatches && country === 'USA') {
    const region = loc && typeof loc.region === 'string' ? loc.region.toLowerCase() : '';
    if (region.includes('florida') || region === 'fl') {
      return { ok: true, reason: 'pad_and_fl_region' };
    }
  }

  return { ok: false, reason: 'not_verified_space_coast' };
}

function filterVerifiedLaunches(launches) {
  if (!Array.isArray(launches)) return [];

  const seen = new Set();
  const out = [];

  for (const L of launches) {
    const { ok } = verifyLaunch(L);
    if (!ok) continue;

    const id = String(L.id);
    if (seen.has(id)) continue;
    seen.add(id);

    out.push(L);
  }

  return out;
}

module.exports = {
  verifyLaunch,
  filterVerifiedLaunches,
  SPACE_COAST,
};
