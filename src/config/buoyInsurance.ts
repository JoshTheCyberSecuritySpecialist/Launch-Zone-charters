export type BuoyInsuranceConfig = {
  label: string;
  regNo: string;
  qrImage: string;
  checkoutUrl: string;
};

export const PONTOON_INSURANCE: BuoyInsuranceConfig = {
  label: 'Pontoon Rental Insurance',
  regNo: 'FL0278PU',
  qrImage: '/images/insurance/buoy-insurance-qr.png',
  checkoutUrl:
    'https://prod-api.buoy-service.link/integration/api/links/trip/createAndPay?reg_no=FL0278PU',
};

export const CENTER_CONSOLE_INSURANCE: BuoyInsuranceConfig = {
  label: 'Center Console Rental Insurance',
  regNo: 'FL3827TT',
  qrImage: '/images/insurance/center-console-buoy-insurance-qr.png',
  checkoutUrl:
    'https://prod-api.buoy-service.link/integration/api/links/trip/createAndPay?reg_no=FL3827TT',
};

const PONTOON_TOKENS = ['pontoon', 'standard', 'standard_pontoon', 'fl0278pu'];
const CENTER_CONSOLE_TOKENS = [
  'center_console',
  'centerconsole',
  'center-console',
  'key_largo',
  'key_largo_18',
  'premium',
  'fl3827tt',
];

function normalizeToken(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function includesAnyToken(haystack: string, tokens: string[]): boolean {
  return tokens.some((token) => haystack.includes(normalizeToken(token)));
}

/**
 * Resolve Buoy insurance mapping from any booking/boat-like object.
 * Defaults to pontoon and warns if no known match is found.
 */
export function getInsuranceConfigForBooking(booking: unknown): BuoyInsuranceConfig {
  const source = (booking ?? {}) as Record<string, unknown>;
  const boatRecord =
    (source.boat as Record<string, unknown> | undefined) ??
    (source.boats as Record<string, unknown> | undefined) ??
    {};

  const rawTokens = [
    source.boat_id,
    source.boatId,
    source.boat_name,
    source.boatName,
    source.boat_type,
    source.boatType,
    source.boat_slug,
    source.boatSlug,
    boatRecord.id,
    boatRecord.name,
    boatRecord.type,
    boatRecord.slug,
  ];

  const normalized = rawTokens
    .map((value) => normalizeToken(value))
    .filter((value) => value.length > 0)
    .join(' ');

  if (includesAnyToken(normalized, CENTER_CONSOLE_TOKENS)) return CENTER_CONSOLE_INSURANCE;
  if (includesAnyToken(normalized, PONTOON_TOKENS)) return PONTOON_INSURANCE;

  if (typeof console !== 'undefined') {
    console.warn('[buoyInsurance] Unknown boat mapping; defaulting to pontoon.', {
      boat_id: source.boat_id ?? source.boatId,
      boat_name: source.boat_name ?? source.boatName ?? boatRecord.name,
      boat_type: source.boat_type ?? source.boatType ?? boatRecord.type,
      boat_slug: source.boat_slug ?? source.boatSlug ?? boatRecord.slug,
    });
  }
  return PONTOON_INSURANCE;
}

export type PreTripTripType = 'pontoon_rental' | 'center_console_rental' | 'captain_charter';

export function getInsuranceConfigForTripType(tripType: PreTripTripType): BuoyInsuranceConfig | null {
  if (tripType === 'center_console_rental') return CENTER_CONSOLE_INSURANCE;
  if (tripType === 'pontoon_rental') return PONTOON_INSURANCE;
  return null;
}

export function regNoForTripType(tripType: PreTripTripType): string | null {
  const cfg = getInsuranceConfigForTripType(tripType);
  return cfg?.regNo ?? null;
}

export function bookingModeForTripType(tripType: PreTripTripType): 'rental' | 'charter' {
  return tripType === 'captain_charter' ? 'charter' : 'rental';
}
