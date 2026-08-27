/**
 * Canonical waiver text stored at sign time.
 * Keep aligned with src/components/booking/WaiverBlock.tsx and src/content/* policy files.
 */

const policy = require('./cancellationRefundPolicy');

const WAIVER_VERSION = '1.1';
const WAIVER_VERSION_EFFECTIVE_AT = '2026-08-27T00:00:00.000Z';

const SECURITY_DEPOSIT_TERMS_PARAGRAPH =
  'A refundable security deposit of $300 is charged at booking and held by our payment processor (Stripe). It is refunded after the vessel is returned and inspected. The deposit may be partially or fully retained for damage, excessive cleaning, fuel discrepancies, or late return. Any deductions are limited to the actual cost of repair, replacement, or related service or labor. Pre-existing conditions are documented before departure and are not charged to you. Photos and inspection notes may be used to assess charges. Refunds are issued to the original payment method; banks typically process refunds in 5–10 business days.';
const SECURITY_DEPOSIT_AUTHORIZATION_CLAUSE =
  'By completing your booking, you authorize applicable charges to be deducted from the security deposit if necessary.';

function normalizeBookingMode(raw) {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (value === 'charter' || value === 'captain_charter' || value === 'captain-led charter') {
    return 'charter';
  }
  return 'rental';
}

function buildCancellationSection() {
  return policy.formatRefundPolicyText();
}

function buildWaiverContent(bookingMode = 'rental') {
  const mode = normalizeBookingMode(bookingMode);
  const lines = [
    'Florida Boating Liability Waiver',
    `Version ${WAIVER_VERSION} (effective ${WAIVER_VERSION_EFFECTIVE_AT.slice(0, 10)})`,
    '',
    'By signing this waiver, I acknowledge and agree to the following terms and conditions:',
    '',
    'Assumption of Risk',
    'I understand that boating activities involve inherent risks including but not limited to: injury, death, property damage, weather hazards, marine hazards, and equipment failure. I voluntarily assume all such risks.',
    '',
    'Release of Liability',
    'I hereby release, waive, discharge, and covenant not to sue Launch Zone Charters, its owners, employees, and agents from any and all liability for injury, death, or property damage arising from my participation in boating activities.',
    '',
    'Indemnification',
    'I agree to indemnify and hold harmless Launch Zone Charters from any claims, damages, or expenses arising from my use of the rental vessel.',
    '',
    'Acknowledgments',
  ];

  if (mode === 'rental') {
    lines.push(
      '- I am at least 25 years of age',
      '- I possess a valid boating license (if operating the vessel)',
      '- I am physically capable of operating the vessel safely',
      '- I will follow all maritime laws and regulations',
      '- I am responsible for all passengers and their safety',
      '- I am responsible for any damage to the vessel beyond normal wear and tear',
      '- I understand late return fees apply'
    );
  } else {
    lines.push(
      '- I will follow captain safety instructions at all times.',
      '- I understand charter timing can shift for weather and launch delays.',
      '- I acknowledge reschedule rules for launch and marine conditions.'
    );
  }

  lines.push('', buildCancellationSection());

  if (mode === 'rental') {
    lines.push(
      '',
      'Security deposit',
      SECURITY_DEPOSIT_TERMS_PARAGRAPH,
      `Authorization. ${SECURITY_DEPOSIT_AUTHORIZATION_CLAUSE}`
    );
  }

  lines.push('', 'For full terms and conditions, see the Launch Zone Charters Terms & Conditions page.');
  return lines.join('\n');
}

function waiverInsertFields(bookingMode = 'rental') {
  return {
    waiver_content: buildWaiverContent(bookingMode),
    waiver_version: WAIVER_VERSION,
    waiver_version_effective_at: WAIVER_VERSION_EFFECTIVE_AT,
  };
}

module.exports = {
  WAIVER_VERSION,
  WAIVER_VERSION_EFFECTIVE_AT,
  buildWaiverContent,
  normalizeBookingMode,
  waiverInsertFields,
};
