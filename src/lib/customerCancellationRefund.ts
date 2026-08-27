/** Keep aligned with server/lib/customerCancellationRefund.js */

export const CUSTOMER_CANCELLATION_FEE_PERCENT = 2.9;
export const CUSTOMER_CANCELLATION_FEE_FLAT_USD = 0.3;
export const CUSTOMER_REFUND_MIN_HOURS = 48;

export const CUSTOMER_CANCELLATION_FEE_POLICY_SENTENCE =
  `Approved customer-cancellation refunds have a payment processing and administrative fee of ${CUSTOMER_CANCELLATION_FEE_PERCENT}% of the original payment plus $${CUSTOMER_CANCELLATION_FEE_FLAT_USD.toFixed(2)} deducted from the refund. This fee covers non-refundable transaction costs associated with processing the original payment and issuing the refund. The fee is deducted from the refund amount and is shown before a refund is issued. Cancellations by Launch Zone Charters because of unsafe weather, mechanical issues, or other operator cancellations are not subject to this fee.`;

export const CUSTOMER_CANCELLATION_FEE_CHECKOUT_NOTE =
  `If you cancel ${CUSTOMER_REFUND_MIN_HOURS}+ hours before your trip, approved refunds deduct a payment processing and administrative fee of ${CUSTOMER_CANCELLATION_FEE_PERCENT}% of the original payment plus $${CUSTOMER_CANCELLATION_FEE_FLAT_USD.toFixed(2)}. Operator cancellations (unsafe weather or mechanical issues) are not subject to this fee.`;
