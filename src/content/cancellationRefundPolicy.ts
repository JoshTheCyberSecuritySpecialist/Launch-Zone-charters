/**
 * Single source of truth for cancellation / refund policy wording (waiver, Terms, Refund Policy, FAQs).
 * Update here only; keep legal tone aligned across surfaces.
 * Fee numbers must match src/lib/customerCancellationRefund.ts and server/lib/customerCancellationRefund.js.
 */

import {
  CUSTOMER_CANCELLATION_FEE_CHECKOUT_NOTE,
  CUSTOMER_CANCELLATION_FEE_FLAT_USD,
  CUSTOMER_CANCELLATION_FEE_PERCENT,
  CUSTOMER_CANCELLATION_FEE_POLICY_SENTENCE,
  CUSTOMER_REFUND_MIN_HOURS,
} from '../lib/customerCancellationRefund';

export const CANCELLATION_REFUND_POLICY_TITLE = '5. Cancellation and Refund Policy';

export type CancellationRefundSubsection = { heading: string; body: string };

export const CANCELLATION_REFUND_POLICY_SUBSECTIONS: CancellationRefundSubsection[] = [
  {
    heading: `${CUSTOMER_REFUND_MIN_HOURS}+ Hours Before Rental`,
    body: `Refund of the amount paid, minus the payment processing and administrative fee of ${CUSTOMER_CANCELLATION_FEE_PERCENT}% of the original payment plus $${CUSTOMER_CANCELLATION_FEE_FLAT_USD.toFixed(2)}.`,
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
    body: CUSTOMER_CANCELLATION_FEE_POLICY_SENTENCE,
  },
];

/** Shown inside the electronic waiver scroll area (BookNow), immediately after the policy subsections. */
export const CANCELLATION_REFUND_POLICY_WAIVER_ACKNOWLEDGMENT =
  'I acknowledge and agree to the Cancellation and Refund Policy stated above, including that approved customer-cancellation refunds may have a payment processing and administrative fee deducted, and I understand that refunds, credits, or rescheduling are subject to these terms.';

/** FAQ / marketing short form — same substance as subsections. */
export const CANCELLATION_REFUND_POLICY_FAQ_SUMMARY =
  `48+ hours before your rental: refund of the amount paid minus a payment processing and administrative fee of ${CUSTOMER_CANCELLATION_FEE_PERCENT}% of the original payment plus $${CUSTOMER_CANCELLATION_FEE_FLAT_USD.toFixed(2)}. 24–48 hours before: no refund; a credit may be issued toward a future rental at our sole discretion. Less than 24 hours: no refund or credit. No-shows are charged in full with no refund or credit. Weather-related cancellations are determined solely by Launch Zone Charters; if we cancel due to unsafe conditions, a refund, credit, or reschedule option may be provided at our discretion and is not reduced by that fee. Rain alone does not qualify for cancellation.`;

export const CANCELLATION_REFUND_POLICY_CHECKOUT_NOTE = CUSTOMER_CANCELLATION_FEE_CHECKOUT_NOTE;

/** Weather subsection body only — use anywhere a short weather-cancellation paragraph is needed. */
export function getCancellationRefundWeatherBody(): string {
  const row = CANCELLATION_REFUND_POLICY_SUBSECTIONS.find((s) => s.heading === 'Weather Cancellations');
  return row?.body ?? '';
}

/** Appended to weather body in FAQ-style answers where proactive monitoring is mentioned. */
export const CANCELLATION_REFUND_POLICY_WEATHER_MONITORING_SENTENCE =
  'We monitor marine forecasts continuously and will contact you if conditions deteriorate.';
