/**
 * Single source of truth for security deposit messaging (Stripe-aligned).
 * Amount must match server PRICING / booking logic ($300).
 */
export const SECURITY_DEPOSIT_AMOUNT = 300;

/** Prominent heading for cards / booking UI */
export const SECURITY_DEPOSIT_SECTION_HEADING = 'SECURITY DEPOSIT — $300';

/** Tooltips, tight UI, pricing footnotes */
export const SECURITY_DEPOSIT_SHORT_SUMMARY =
  'A refundable $300 security deposit is charged at booking and refunded after inspection. Deductions may apply for damage, cleaning, fuel, or late return.';

/** Terms / waiver — paragraph style */
export const SECURITY_DEPOSIT_TERMS_PARAGRAPH =
  'A refundable security deposit of $300 is charged at booking and held by our payment processor (Stripe). It is refunded after the vessel is returned and inspected. The deposit may be partially or fully retained for damage, excessive cleaning, fuel discrepancies, or late return. Any deductions are limited to the actual cost of repair, replacement, or related service or labor. Pre-existing conditions are documented before departure and are not charged to you. Photos and inspection notes may be used to assess charges. Refunds are issued to the original payment method; banks typically process refunds in 5–10 business days.';

export const SECURITY_DEPOSIT_AUTHORIZATION_CLAUSE =
  'By completing your booking, you authorize applicable charges to be deducted from the security deposit if necessary.';

/** Marketing cards — bullet lines (checkmark prepended in UI) */
export const SECURITY_DEPOSIT_MARKETING_BULLETS: string[] = [
  'Refunded after post-rental inspection',
  'May be partially or fully retained for damage, excessive cleaning, fuel discrepancies, or late return',
  'Any deductions are limited to the actual cost of repair, replacement, or related service/labor',
  'Pre-existing conditions are documented before departure and are not charged to you',
  'Photos and inspection notes may be used to assess charges',
  'Refunds are issued to the original payment method (banks typically process in 5–10 business days)',
];

export const SECURITY_DEPOSIT_CARD_INTRO =
  'A refundable security deposit is charged at booking and held by our payment processor (Stripe). It is refunded after the vessel is returned and inspected.';
