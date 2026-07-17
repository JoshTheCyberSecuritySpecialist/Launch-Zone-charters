/**
 * Canonical waiver text stored at sign time.
 * Keep aligned with src/components/booking/WaiverBlock.tsx and src/content/* policy files.
 */

const WAIVER_VERSION = '1.0';
const WAIVER_VERSION_EFFECTIVE_AT = '2026-01-01T00:00:00.000Z';

const CANCELLATION_REFUND_POLICY_TITLE = '5. Cancellation and Refund Policy';
const CANCELLATION_REFUND_POLICY_SUBSECTIONS = [
  { heading: '48+ Hours Before Rental', body: 'Full refund of all payments.' },
  {
    heading: '24–48 Hours Before Rental',
    body: 'No refund. A credit may be issued toward a future rental at the sole discretion of Launch Zone Charters.',
  },
  { heading: 'Less Than 24 Hours Before Rental', body: 'No refund or credit.' },
  { heading: 'No-Shows', body: 'Charged in full with no refund or credit.' },
  {
    heading: 'Weather Cancellations',
    body: 'Weather-related cancellations are determined solely by Launch Zone Charters. If we cancel due to unsafe conditions, a refund, credit, or reschedule option may be provided at our discretion. Rain alone does not qualify for cancellation.',
  },
];
const CANCELLATION_REFUND_POLICY_WAIVER_ACKNOWLEDGMENT =
  'I acknowledge and agree to the Cancellation and Refund Policy stated above and understand that refunds, credits, or rescheduling are subject to these terms.';

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
  const lines = [CANCELLATION_REFUND_POLICY_TITLE];
  for (const section of CANCELLATION_REFUND_POLICY_SUBSECTIONS) {
    lines.push(`${section.heading}: ${section.body}`);
  }
  lines.push(CANCELLATION_REFUND_POLICY_WAIVER_ACKNOWLEDGMENT);
  return lines.join('\n\n');
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
