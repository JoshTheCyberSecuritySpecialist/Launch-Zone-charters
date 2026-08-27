/**
 * Server-side mirror of src/content/cancellationRefundPolicy.ts
 * Keep wording aligned when policy changes.
 */

const calc = require('../lib/customerCancellationRefund');

const CANCELLATION_REFUND_POLICY_TITLE = '5. Cancellation and Refund Policy';

const CANCELLATION_REFUND_POLICY_SUBSECTIONS = [
  {
    heading: `${calc.CUSTOMER_REFUND_MIN_HOURS}+ Hours Before Rental`,
    body: `Refund of the amount paid, minus the payment processing and administrative fee of ${calc.FEE_PERCENT}% of the original payment plus $${(calc.FEE_FLAT_CENTS / 100).toFixed(2)}.`,
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
      'Weather-related cancellations are determined solely by Launch Zone Charters. If we cancel due to unsafe conditions, a refund, credit, or reschedule option may be provided at our discretion and is not reduced by the payment processing and administrative fee. Rain alone does not qualify for cancellation.',
  },
  {
    heading: 'Payment Processing and Administrative Fee',
    body: calc.feePolicySentence(),
  },
];

const CANCELLATION_REFUND_POLICY_WAIVER_ACKNOWLEDGMENT =
  'I acknowledge and agree to the Cancellation and Refund Policy stated above, including that approved customer-cancellation refunds may have a payment processing and administrative fee deducted, and I understand that refunds, credits, or rescheduling are subject to these terms.';

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
