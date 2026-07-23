import { CalendarDays, Home } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

const NAV = [
  { label: 'Today', to: '/captain', icon: Home, match: 'exact' as const },
  { label: 'Schedule', to: '/captain/schedule', icon: CalendarDays, match: 'prefix' as const },
];

function isActive(pathname: string, item: (typeof NAV)[number]): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (item.match === 'exact') {
    return path === item.to || path.startsWith('/captain/booking/');
  }
  return path === item.to || path.startsWith(`${item.to}/`);
}

export default function CaptainBottomNav() {
  const location = useLocation();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white text-slate-900"
      aria-label="Captain mobile navigation"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around px-2 pt-1">
        {NAV.map((item) => {
          const active = isActive(location.pathname, item);
          const Icon = item.icon;
          return (
            <li key={item.to} className="flex-1">
              <Link
                to={item.to}
                className={`flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1 text-center ${
                  active ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-6 w-6" aria-hidden />
                <span className="text-xs font-bold leading-none">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
