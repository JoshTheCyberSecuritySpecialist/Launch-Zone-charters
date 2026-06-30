/**
 * Groupon direct-booking promo codes (Port Orange / Daytona standard pontoon rentals).
 * Adjust final prices here when Groupon deal terms change.
 */
export const GROUPON_PROMO_PRICES = {
  /** Standard Groupon deal — 4hr $171.00, 8hr $315.00 */
  GROUPON: { half_day: 171.0, full_day: 315.0 },
  /** Groupon Fun deal — 4hr $153.90, 8hr $283.50 */
  GROUPONFUN: { half_day: 153.9, full_day: 283.5 },
} as const;

export type GrouponPromoCode = keyof typeof GROUPON_PROMO_PRICES;

export type RentalLocation = 'daytona' | 'titusville' | null;

export interface PromoEligibilityInput {
  bookingMode: 'rental' | 'charter';
  /** Port Orange area = `daytona` (matches ?location=daytona deep links). */
  rentalLocation: RentalLocation;
  boatType: 'standard' | 'premium';
  rentalType: 'hourly' | 'half_day' | 'full_day';
  captainIncluded: boolean;
}

export type PromoEvaluation =
  | { status: 'none' }
  | { status: 'unknown'; promoCode: string }
  | { status: 'wrong_trip'; promoCode: string }
  | {
      status: 'applied';
      promoCode: string;
      originalTotal: number;
      finalTotal: number;
      discountAmount: number;
    };

function roundMoney(v: number): number {
  return Math.round(v * 100) / 100;
}

export function normalizePromoCode(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase();
}

/** True when the trip qualifies for Port Orange pontoon Groupon price matching. */
export function isPortOrangePontoonRental(input: PromoEligibilityInput): boolean {
  return (
    input.bookingMode === 'rental' &&
    input.rentalLocation === 'daytona' &&
    input.boatType === 'standard' &&
    (input.rentalType === 'half_day' || input.rentalType === 'full_day') &&
    !input.captainIncluded
  );
}

export function evaluateGrouponPromo(
  rawCode: string,
  originalTotal: number,
  input: PromoEligibilityInput
): PromoEvaluation {
  const promoCode = normalizePromoCode(rawCode);
  if (!promoCode) return { status: 'none' };

  const priceTable = GROUPON_PROMO_PRICES[promoCode as GrouponPromoCode];
  if (!priceTable) return { status: 'unknown', promoCode };

  if (!isPortOrangePontoonRental(input)) {
    return { status: 'wrong_trip', promoCode };
  }

  const finalTotal =
    input.rentalType === 'half_day' ? priceTable.half_day : priceTable.full_day;
  const discountAmount = roundMoney(Math.max(0, originalTotal - finalTotal));

  return {
    status: 'applied',
    promoCode,
    originalTotal: roundMoney(originalTotal),
    finalTotal: roundMoney(finalTotal),
    discountAmount,
  };
}
