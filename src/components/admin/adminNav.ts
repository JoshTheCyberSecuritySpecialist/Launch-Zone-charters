export type AdminNavItem = {
  label: string;
  to: string;
  /** Match nested routes (e.g. /admin/bookings/:id) */
  match?: 'exact' | 'prefix';
};

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { label: 'Dashboard', to: '/admin', match: 'exact' },
  { label: 'Bookings', to: '/admin/bookings', match: 'prefix' },
  { label: 'Staff Booking', to: '/admin/staff-booking', match: 'exact' },
  { label: 'Calendar', to: '/admin/calendar', match: 'exact' },
  { label: 'Outbox', to: '/admin/outbox', match: 'exact' },
  { label: 'Disputes', to: '/admin/disputes', match: 'exact' },
  { label: 'Shop Orders', to: '/admin/shop-orders', match: 'exact' },
  { label: 'Boats', to: '/admin/boats', match: 'exact' },
];

export function isAdminNavActive(pathname: string, item: AdminNavItem): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  const href = item.to.replace(/\/+$/, '') || '/';
  if (item.match === 'exact' || !item.match) {
    return path === href;
  }
  return path === href || path.startsWith(`${href}/`);
}

/** True for /admin, /admin/*, and /admin-login */
export function isAdminAreaPath(pathname: string): boolean {
  return (
    pathname === '/admin-login' ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/')
  );
}
