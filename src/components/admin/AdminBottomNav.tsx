import { Link, useLocation } from 'react-router-dom';
import { CalendarDays, Grid3X3, Home, Mail, Ship } from 'lucide-react';

const NAV = [
  { label: 'Home', to: '/admin', icon: Home, match: 'exact' as const },
  { label: 'Calendar', to: '/admin/calendar', icon: CalendarDays, match: 'prefix' as const },
  { label: 'Bookings', to: '/admin/bookings/list', icon: Ship, match: 'bookings' as const },
  { label: 'Messages', to: '/admin/messages', icon: Mail, match: 'prefix' as const },
  { label: 'More', to: '/admin/more', icon: Grid3X3, match: 'prefix' as const },
];

function isActive(pathname: string, item: (typeof NAV)[number]): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (item.match === 'exact') {
    return path === item.to;
  }
  if (item.match === 'bookings') {
    return (
      path === '/admin/bookings/list' ||
      path.startsWith('/admin/bookings/') ||
      path === '/admin/staff-booking'
    );
  }
  const href = item.to.replace(/\/+$/, '') || '/';
  return path === href || path.startsWith(`${href}/`);
}

export default function AdminBottomNav() {
  const location = useLocation();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-800 bg-slate-900 text-white md:hidden"
      aria-label="Admin mobile navigation"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around px-1 pt-1">
        {NAV.map((item) => {
          const active = isActive(location.pathname, item);
          const Icon = item.icon;
          return (
            <li key={item.to} className="flex-1">
              <Link
                to={item.to}
                className={`flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-center ${
                  active ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-6 w-6" aria-hidden />
                <span className="text-[11px] font-bold leading-none">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
