import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Menu, X } from 'lucide-react';
import { LOGO_ALT } from '../ui/Logo';
import { SITE_LOGO_PATH } from '../../constants/branding';
import { useAuth } from '../../contexts/useAuth';
import { ADMIN_NAV_ITEMS, isAdminNavActive } from './adminNav';

type AdminShellProps = {
  title: string;
  subtitle?: ReactNode;
  /** Page-specific CTAs (refresh, create, etc.) */
  actions?: ReactNode;
  /** Full-bleed strip under the shell header (e.g. calendar tools) */
  belowHeader?: ReactNode;
  children: ReactNode;
  /** Content max width */
  maxWidth?: '5xl' | '7xl';
  className?: string;
};

const MAX_WIDTH: Record<NonNullable<AdminShellProps['maxWidth']>, string> = {
  '5xl': 'max-w-5xl',
  '7xl': 'max-w-7xl',
};

export default function AdminShell({
  title,
  subtitle,
  actions,
  belowHeader,
  children,
  maxWidth = '7xl',
  className = '',
}: AdminShellProps) {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const drawerTitleId = useId();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const prevOverflow = document.body.style.overflow;
    const prevPadding = document.body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPadding;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
    navigate('/');
  };

  const widthClass = MAX_WIDTH[maxWidth];

  return (
    <div className={`min-h-screen bg-slate-50 text-slate-900 ${className}`.trim()}>
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-900 text-white">
        <div className={`mx-auto ${widthClass} px-3 sm:px-6 lg:px-8`}>
          <div className="flex min-h-14 items-center gap-2 py-2 sm:min-h-16 sm:gap-3">
            <button
              type="button"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 md:hidden"
              aria-label={menuOpen ? 'Close admin menu' : 'Open admin menu'}
              aria-expanded={menuOpen}
              aria-controls="admin-nav-drawer"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
            </button>

            <Link
              to="/admin"
              className="inline-flex shrink-0 items-center"
              aria-label="Admin dashboard"
              onClick={() => setMenuOpen(false)}
            >
              <img
                src={SITE_LOGO_PATH}
                alt={LOGO_ALT}
                className="block h-auto w-[72px] object-contain md:w-[100px]"
                loading="eager"
                decoding="async"
              />
            </Link>

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-bold leading-tight sm:text-2xl">{title}</h1>
              {subtitle ? (
                <div className="mt-0.5 truncate text-xs text-slate-400 sm:text-sm">{subtitle}</div>
              ) : null}
            </div>

            {actions ? (
              <div className="hidden flex-wrap items-center justify-end gap-2 lg:flex">{actions}</div>
            ) : null}

            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-slate-800 px-3 text-sm font-semibold hover:bg-slate-700"
              aria-label="Sign out"
            >
              <LogOut className="h-5 w-5" aria-hidden />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>

          {/* Desktop: horizontal nav — not a compressing sidebar */}
          <nav
            className="-mx-1 hidden gap-1 overflow-x-auto pb-3 md:flex"
            aria-label="Admin sections"
          >
            {ADMIN_NAV_ITEMS.map((item) => {
              const active = isAdminNavActive(location.pathname, item);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`inline-flex h-10 shrink-0 items-center rounded-lg px-3 text-sm font-semibold whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-amber-600 text-white'
                      : 'bg-slate-800 text-slate-100 hover:bg-slate-700'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {actions ? (
            <div className="flex flex-wrap gap-2 pb-3 lg:hidden">{actions}</div>
          ) : null}

          {user?.email ? (
            <p className="sr-only">Signed in as {user.email}</p>
          ) : null}
        </div>
      </header>

      {belowHeader}

      <div className={`mx-auto ${widthClass} px-3 py-5 sm:px-6 sm:py-6 lg:px-8`}>
        {children}
      </div>

      {/* Mobile drawer */}
      {menuOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/70"
            aria-label="Close admin menu"
            onClick={() => setMenuOpen(false)}
          />
          <aside
            id="admin-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby={drawerTitleId}
            className="absolute inset-y-0 left-0 flex w-[min(100%,20rem)] max-w-full flex-col bg-slate-900 text-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <h2 id={drawerTitleId} className="text-base font-bold">
                Admin menu
              </h2>
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700"
                aria-label="Close admin menu"
                onClick={() => setMenuOpen(false)}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-3" aria-label="Admin sections">
              <ul className="space-y-1">
                {ADMIN_NAV_ITEMS.map((item) => {
                  const active = isAdminNavActive(location.pathname, item);
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        className={`flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold ${
                          active
                            ? 'bg-amber-600 text-white'
                            : 'bg-slate-800/80 text-slate-100 hover:bg-slate-800'
                        }`}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => setMenuOpen(false)}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="border-t border-slate-800 p-3">
              {user?.email ? (
                <p className="mb-2 truncate px-1 text-xs text-slate-400">{user.email}</p>
              ) : null}
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-3 text-sm font-semibold hover:bg-slate-700"
              >
                <LogOut className="h-5 w-5" aria-hidden />
                Sign Out
              </button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
