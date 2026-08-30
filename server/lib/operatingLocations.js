/**
 * Server-controlled operating areas. Do not accept arbitrary coordinates from clients.
 */

const BUSINESS_TZ = 'America/New_York';

const OPERATING_LOCATIONS = {
  titusville: {
    id: 'titusville',
    name: 'Titusville',
    label: 'Titusville / Space Coast (Indian River Lagoon), FL',
    lat: 28.6122,
    lon: -80.8076,
    timeZone: BUSINESS_TZ,
    meetingLocationId: 'parrish_park',
    defaultMapZoom: 11,
    supportedExperiences: ['bio', 'rocket', 'sunset'],
    tideStation: '8721604',
    tideStationLabel: 'Trident Pier, Port Canaveral, FL',
  },
  daytona: {
    id: 'daytona',
    name: 'Port Orange',
    label: 'Port Orange / Daytona Beach, FL',
    lat: 29.1383,
    lon: -80.9956,
    timeZone: BUSINESS_TZ,
    meetingLocationId: 'port_orange',
    defaultMapZoom: 11,
    supportedExperiences: ['sunset'],
    tideStation: '8721138',
    tideStationLabel: 'Daytona Beach Shores, FL',
  },
};

/** @type {Record<string, keyof typeof OPERATING_LOCATIONS>} */
const LOCATION_ALIASES = {
  titusville: 'titusville',
  'space coast': 'titusville',
  spacecoast: 'titusville',
  canaveral: 'titusville',
  daytona: 'daytona',
  'daytona beach': 'daytona',
  'port orange': 'daytona',
  port_orange: 'daytona',
  portorange: 'daytona',
};

function normalizeLocationInput(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * @param {unknown} value
 * @param {{ defaultKey?: keyof typeof OPERATING_LOCATIONS | null }} [options]
 */
function resolveOperatingLocation(value, options = {}) {
  const raw = normalizeLocationInput(value);
  if (!raw) {
    if (!options.defaultKey) {
      return { ok: false, error: 'Unknown location' };
    }
    return { ok: true, location: OPERATING_LOCATIONS[options.defaultKey], fromDefault: true };
  }
  const aliased = LOCATION_ALIASES[raw] || LOCATION_ALIASES[raw.replace(/\s/g, '')];
  if (!aliased || !OPERATING_LOCATIONS[aliased]) {
    return { ok: false, error: 'Unknown location' };
  }
  return { ok: true, location: OPERATING_LOCATIONS[aliased], fromDefault: false };
}

function isKnownOperatingLocation(value) {
  return resolveOperatingLocation(value, { defaultKey: null }).ok && Boolean(String(value || '').trim());
}

module.exports = {
  BUSINESS_TZ,
  OPERATING_LOCATIONS,
  isKnownOperatingLocation,
  resolveOperatingLocation,
};
