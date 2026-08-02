const ROUTES = {
  home: '/',
  /** Boat rental landing pages by location (legacy URLs redirect here). */
  boatRentalsDaytona: '/boat-rentals/daytona',
  boatRentalsTitusville: '/boat-rentals/titusville',
  booking: '/booking',
  bookingReceived: '/booking-received',
  bookingSuccess: '/booking-success',
  bookingDepositCancel: '/booking-deposit-cancel',
  waiversInsurance: '/waivers-insurance',
  pricing: '/pricing',
  launches: '/launches',
  conditions: '/conditions',
  faqs: '/faqs',
  about: '/about',
  contact: '/contact',
  captainsLog: '/captains-log',
  terms: '/terms',
  refundPolicy: '/refund-policy',
  adminLogin: '/admin-login',
  admin: '/admin',
  adminBookings: '/admin/bookings',
  adminStaffBooking: '/admin/staff-booking',
  adminCalendar: '/admin/calendar',
  verify: '/verify',
  bioluminescenceGuide: '/bioluminescence',
  bioluminescentTours: '/bioluminescent-tours',
  experiences: '/experiences',
  observationBottle: '/shop/observation-bottle',
  grouponRedeem: '/booking/groupon',
  shopOrderSuccess: '/shop/order-success',
  adminShopOrders: '/admin/shop-orders',
  adminDisputes: '/admin/disputes',
  adminOutbox: '/admin/outbox',
  adminBoats: '/admin/boats',
  insuranceRequired: '/insurance-required',
} as const;

/** Deep links: charter flow with preset experience (matches BookNow searchParams). */
const BOOKING_BIO_CHARTER = `${ROUTES.booking}?bookingMode=charter&charterType=bio`;
const BOOKING_ROCKET_CHARTER = `${ROUTES.booking}?bookingMode=charter&charterType=rocket_launch`;
const BOOKING_SUNSET_CHARTER = `${ROUTES.booking}?bookingMode=charter&charterType=sunset`;

/** Deep link: skip experience chooser, start rental booking (matches BoatRentalsLocation). */
const BOOKING_RENTAL_DAYTONA = `${ROUTES.booking}?bookingMode=rental&location=daytona`;
const BOOKING_RENTAL_TITUSVILLE = `${ROUTES.booking}?bookingMode=rental&location=titusville`;

const PAGE_TO_PATH: Record<string, string> = {
  home: ROUTES.home,
  book: ROUTES.booking,
  experiences: ROUTES.experiences,
  'book-bio': BOOKING_BIO_CHARTER,
  'book-rental-daytona': BOOKING_RENTAL_DAYTONA,
  'book-rental-titusville': BOOKING_RENTAL_TITUSVILLE,
  'book-rocket': BOOKING_ROCKET_CHARTER,
  'book-sunset': BOOKING_SUNSET_CHARTER,
  'groupon-redeem': ROUTES.grouponRedeem,
  /** @deprecated Use fleet-daytona; resolves to Daytona rentals for backward compatibility. */
  fleet: ROUTES.boatRentalsDaytona,
  'fleet-daytona': ROUTES.boatRentalsDaytona,
  'fleet-titusville': ROUTES.boatRentalsTitusville,
  'booking-received': ROUTES.bookingReceived,
  'booking-success': ROUTES.bookingSuccess,
  'booking-deposit-cancel': ROUTES.bookingDepositCancel,
  'waivers-insurance': ROUTES.waiversInsurance,
  pricing: ROUTES.pricing,
  launches: ROUTES.launches,
  conditions: ROUTES.conditions,
  faqs: ROUTES.faqs,
  about: ROUTES.about,
  contact: ROUTES.contact,
  'captains-log': ROUTES.captainsLog,
  terms: ROUTES.terms,
  'refund-policy': ROUTES.refundPolicy,
  'admin-login': ROUTES.adminLogin,
  admin: ROUTES.admin,
  'admin-bookings': ROUTES.adminBookings,
  'admin-staff-booking': ROUTES.adminStaffBooking,
  'admin-calendar': ROUTES.adminCalendar,
  verify: ROUTES.verify,
  bioluminescence: ROUTES.bioluminescenceGuide,
  'bioluminescent-tours': ROUTES.bioluminescentTours,
  'sunset-wildlife': `${ROUTES.experiences}#sunset-wildlife`,
  'observation-bottle': ROUTES.observationBottle,
  'shop-order-success': ROUTES.shopOrderSuccess,
  'admin-shop-orders': ROUTES.adminShopOrders,
  'admin-disputes': ROUTES.adminDisputes,
  'admin-outbox': ROUTES.adminOutbox,
  'admin-boats': ROUTES.adminBoats,
  'insurance-required': ROUTES.insuranceRequired,
};

const PATH_TO_PAGE: Record<string, string> = Object.fromEntries(
  Object.entries(PAGE_TO_PATH).map(([page, path]) => [path, page])
);

export function pathFromPageKey(pageKey: string): string {
  return PAGE_TO_PATH[pageKey] ?? ROUTES.home;
}

export function pageKeyFromPath(pathname: string): string {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path.startsWith('/shop/')) return 'observation-bottle';
  if (path === ROUTES.captainsLog) return 'captains-log';
  if (path === ROUTES.verify) return 'verify';
  if (path.startsWith('/log/')) return 'log-article';
  if (path === '/insurance-required') return 'insurance-required';
  if (path === '/waivers-insurance') return 'waivers-insurance';
  if (path === ROUTES.experiences) return 'experiences';
  if (path === ROUTES.grouponRedeem) return 'groupon-redeem';
  if (path === ROUTES.bioluminescentTours) return 'bioluminescent-tours';
  if (path === ROUTES.launches) return 'launches';
  if (path === ROUTES.pricing) return 'pricing';
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
  if (path === '/boats' || path === '/boat-rentals-daytona-beach') return 'fleet-daytona';
  return PATH_TO_PAGE[path] ?? 'home';
}
