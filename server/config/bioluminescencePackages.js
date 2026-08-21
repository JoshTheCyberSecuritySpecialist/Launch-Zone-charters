/**
 * Authoritative direct-booking bioluminescence packages (Groupon deal parity).
 * Prices are integer cents only — never trust browser-supplied amounts.
 */

const BIOLUMINESCENCE_PACKAGES = {
  bio_solo: {
    id: 'bio_solo',
    name: 'Solo Bioluminescence Tour',
    guestCount: 1,
    standardValueCents: 7500,
    priceCents: 4689,
    badge: null,
    active: true,
  },
  bio_two: {
    id: 'bio_two',
    name: 'Bioluminescence Tour for Two',
    guestCount: 2,
    standardValueCents: 15000,
    priceCents: 9609,
    badge: null,
    active: true,
  },
  bio_four: {
    id: 'bio_four',
    name: 'Bioluminescence Tour for Four',
    guestCount: 4,
    standardValueCents: 30000,
    priceCents: 19209,
    badge: 'Best Value',
    active: true,
  },
};

const BIOLUMINESCENCE_PACKAGE_IDS = Object.freeze(Object.keys(BIOLUMINESCENCE_PACKAGES));

/**
 * Direct bio package pricing (BookNow + Stripe) is OFF unless explicitly enabled.
 * Set DIRECT_BIO_PACKAGE_PRICING_ENABLED=true in production after migration + deploy.
 * Missing, empty, or any value other than "true" keeps legacy $150×guests direct bio pricing.
 */
function isDirectBioPackagePricingEnabled() {
  return process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED === 'true';
}

function getBioluminescencePackage(packageId) {
  const id = String(packageId || '').trim();
  if (!id) {
    const err = new Error('Bioluminescence package is required.');
    err.statusCode = 400;
    throw err;
  }
  const pkg = BIOLUMINESCENCE_PACKAGES[id];
  if (!pkg) {
    const err = new Error(`Unknown bioluminescence package: ${id}`);
    err.statusCode = 400;
    throw err;
  }
  if (!pkg.active) {
    const err = new Error(`Bioluminescence package is not available: ${id}`);
    err.statusCode = 400;
    throw err;
  }
  return pkg;
}

module.exports = {
  BIOLUMINESCENCE_PACKAGES,
  BIOLUMINESCENCE_PACKAGE_IDS,
  getBioluminescencePackage,
  isDirectBioPackagePricingEnabled,
};
