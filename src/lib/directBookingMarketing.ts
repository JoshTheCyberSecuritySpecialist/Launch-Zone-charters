/** Lightweight hooks for future analytics — no PII. */
export type DirectBookingMarketingEvent =
  | 'why_book_direct_viewed'
  | 'direct_booking_section_viewed'
  | 'direct_booking_cta_clicked'
  | 'direct_packages_clicked'
  | 'groupon_redemption_link_clicked'
  | 'sticky_direct_bar_viewed'
  | 'sticky_direct_bar_clicked'
  | 'sticky_direct_bar_dismissed'
  | 'direct_booking_faq_opened'
  | 'direct_deals_viewed'
  | 'direct_package_selected';

export function trackDirectBookingEvent(
  name: DirectBookingMarketingEvent,
  detail?: Record<string, string>
): void {
  if (import.meta.env.DEV) {
    console.info('[direct-booking-marketing]', name, detail ?? {});
  }
}

export const STICKY_DIRECT_BAR_SESSION_KEY = 'lz_dismiss_sticky_direct_bar';
