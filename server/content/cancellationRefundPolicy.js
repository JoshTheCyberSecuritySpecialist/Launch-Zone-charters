/**
 * Server-side mirror of src/content/cancellationRefundPolicy.ts
 * Keep wording aligned when policy changes.
 */

const CANCELLATION_REFUND_POLICY_TITLE = '5. Cancellation and Refund Policy';

const CANCELLATION_REFUND_POLICY_SUBSECTIONS = [
  {
    heading: '48+ Hours Before Rental',
    body: 'Full refund of all payments.',
  },
  {
    heading: '24–48 Hours Before Rental',
    body:
      'No refund. A credit may be issued toward a future rental at the sole discretion of Launch Zone Charters.',
  },
  {
    heading: 'Less Than 24 Hours Before Rental',
    body: 'No refund or credit.',
  },
  {
    heading: 'No-Shows',
    body: 'Charged in full with no refund or credit.',
  },
  {
    heading: 'Weather Cancellations',
    body:
      'Weather-related cancellations are determined solely by Launch Zone Charters. If we cancel due to unsafe conditions, a refund, credit, or reschedule option may be provided at our discretion. Rain alone does not qualify for cancellation.',
  },
];

const CANCELLATION_REFUND_POLICY_WAIVER_ACKNOWLEDGMENT =
  'I acknowledge and agree to the Cancellation and Refund Policy stated above and understand that refunds, credits, or rescheduling are subject to these terms.';

function formatRefundPolicyText() {
  const lines = [CANCELLATION_REFUND_POLICY_TITLE, ''];
  for (const section of CANCELLATION_REFUND_POLICY_SUBSECTIONS) {
    lines.push(`${section.heading}: ${section.body}`);
  }
  lines.push('');
  lines.push(`Waiver acknowledgment: ${CANCELLATION_REFUND_POLICY_WAIVER_ACKNOWLEDGMENT}`);
  return lines.join('\n');
}

module.exports = {
  CANCELLATION_REFUND_POLICY_SUBSECTIONS,
  CANCELLATION_REFUND_POLICY_TITLE,
  CANCELLATION_REFUND_POLICY_WAIVER_ACKNOWLEDGMENT,
  formatRefundPolicyText,
};
