import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Shield, Award, Star, ClipboardCheck } from 'lucide-react';
import { useAuth } from '../contexts/useAuth';
import Logo from './ui/Logo';
import { perfActionSegment, wrapSyncClick } from '../lib/clickPerf';

interface HeaderProps {
  onNavigate: (page: string) => void;
  currentPage: string;
}

type DrawerLink = { kind: 'link'; name: string; path: string };
type DrawerGroup = { kind: 'group'; title: string; items: { name: string; path: string }[] };
type DrawerEntry = DrawerLink | DrawerGroup;

type MenuSection = { title: string; items: DrawerEntry[] };

/**
 * Grouped nav: `path` is the app page key (see navigation.ts), not raw hrefs.
 */
const MENU_SECTIONS: MenuSection[] = [
  {
    title: 'Experiences',
    items: [
      { kind: 'link', name: 'Bioluminescence Tours', path: 'bioluminescent-tours' },
      { kind: 'link', name: 'Rocket Launch Charters', path: 'launches' },
      { kind: 'link', name: 'Sunset and Wildlife Cruise', path: 'sunset-wildlife' },
      { kind: 'link', name: 'View All Experiences', path: 'experiences' },
    ],
  },
  {
    title: 'Rent a Boat',
    items: [
      { kind: 'link', name: 'Daytona and Port Orange Rentals', path: 'fleet-daytona' },
      { kind: 'link', name: 'Titusville Rentals', path: 'fleet-titusville' },
      { kind: 'link', name: 'Rental Pricing', path: 'pricing' },
    ],
  },
  {
    title: 'Plan Your Trip',
    items: [
      { kind: 'link', name: 'Waivers & Insurance', path: 'waivers-insurance' },
      { kind: 'link', name: 'Marine Conditions', path: 'conditions' },
      { kind: 'link', name: 'Bioluminescence Guide', path: 'bioluminescence' },
      { kind: 'link', name: 'Rocket Launch Schedule', path: 'launches' },
      { kind: 'link', name: 'FAQs', path: 'faqs' },
      { kind: 'link', name: 'Contact', path: 'contact' },
    ],
  },
  {
    title: 'Groupon',
    items: [{ kind: 'link', name: 'Redeem Groupon Voucher', path: 'groupon-redeem' }],
  },
  {
    title: 'Company',
    items: [
      { kind: 'link', name: 'About', path: 'about' },
      { kind: 'link', name: "Captain's Log", path: 'captains-log' },
      { kind: 'link', name: 'Observation Bottle', path: 'observation-bottle' },
    ],
  },
  {
    title: 'Staff',
    items: [{ kind: 'link', name: 'Staff Login', path: 'admin' }],
  },
];

const TRUST_TICKER_STATIC = [
  { id: 'licensed', label: 'Licensed & Insured', icon: 'shield' as const, path: null },
  { id: 'local', label: 'Local Experts', icon: 'award' as const, path: null },
  { id: 'stars', label: '5-Star Service', icon: 'star' as const, path: null },
  {
    id: 'waivers',
    label: 'Complete Waivers & Insurance',
    icon: 'clipboard' as const,
    path: 'waivers-insurance' as const,
  },
];

function TrustTickerIcon({ kind }: { kind: 'shield' | 'award' | 'star' | 'clipboard' }) {
  const cls = 'h-3.5 w-3.5 shrink-0';
  if (kind === 'award') return <Award className={`${cls} text-lz-accent`} aria-hidden />;
  if (kind === 'star') return <Star className={`${cls} fill-lz-accent text-lz-accent`} aria-hidden />;
  if (kind === 'clipboard') return <ClipboardCheck className={`${cls} text-cyan-300`} aria-hidden />;
  return <Shield className={`${cls} text-lz-accent`} aria-hidden />;
}

export default function Header({ onNavigate, currentPage }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { isAdmin } = useAuth();
  const headerRef = useRef<HTMLElement>(null);
  const lastScrollY = useRef(0);

  const navActive = (path: string) =>
    currentPage === path || (path === 'captains-log' && currentPage === 'log-article');

  const handleNavigation = (path: string, source: 'mobile_menu' | 'desktop_menu' | 'announcement_bar' = 'mobile_menu') => {
    const action =
      path === 'waivers-insurance'
        ? `waivers_entry_${source}`
        : `header_nav_${perfActionSegment(path)}`;
    wrapSyncClick(action, () => {
      onNavigate(path);
      setMenuOpen(false);
    })();
  };

  const closeMenu = () => wrapSyncClick('header_menu_close', () => setMenuOpen(false))();

  const renderTrustItem = (
    item: (typeof TRUST_TICKER_STATIC)[number],
    opts: { interactive: boolean; keyPrefix: string }
  ) => {
    const content = (
      <>
        <TrustTickerIcon kind={item.icon} />
        <span
          className={`font-semibold tracking-wide ${
            item.path ? 'text-cyan-200 underline decoration-cyan-400/40 underline-offset-2' : 'text-slate-200'
          }`}
        >
          {item.label}
        </span>
      </>
    );
    if (item.path && opts.interactive) {
      return (
        <button
          key={`${opts.keyPrefix}-${item.id}`}
          type="button"
          onClick={() => handleNavigation(item.path!, 'announcement_bar')}
          className="lz-trust-ticker__item lz-trust-ticker__item--link inline-flex min-h-11 items-center gap-2 px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
        >
          {content}
        </button>
      );
    }
    return (
      <span
        key={`${opts.keyPrefix}-${item.id}`}
        className="lz-trust-ticker__item inline-flex min-h-11 items-center gap-2 px-3 py-2"
        aria-hidden={!opts.interactive}
      >
        {content}
      </span>
    );
  };

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // Keep drawer state local to the current page view.
  // If navigation happens outside header controls, force-close the menu.
  useEffect(() => {
    setMenuOpen(false);
  }, [currentPage]);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const onScroll = () => {
      if (menuOpen) {
        header.style.transform = 'translateY(0)';
        lastScrollY.current = window.scrollY;
        return;
      }
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY.current && currentScrollY > 100) {
        header.style.transform = 'translateY(-110%)';
      } else {
        header.style.transform = 'translateY(0)';
      }
      lastScrollY.current = currentScrollY;
    };

    lastScrollY.current = window.scrollY;
    header.style.transform = 'translateY(0)';
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [menuOpen]);

  const drawer =
    menuOpen &&
    createPortal(
      <>
        <button
          type="button"
          className="lz-nav-drawer-backdrop"
          aria-label="Close menu"
          onClick={closeMenu}
        />
        <aside
          id="lz-main-nav-menu"
          className="lz-nav-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Site navigation"
        >
          <div className="lz-nav-drawer__head">
            <p className="lz-nav-drawer__title">Menu</p>
            <button
              type="button"
              aria-label="Close menu"
              onClick={closeMenu}
              className="lz-nav-drawer__close"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <div className="logo-container flex justify-center border-b border-white/10 px-2 pb-4 pt-1">
            <Logo variant="mobile" onClick={closeMenu} />
          </div>

          <nav className="lz-nav-drawer__body flex flex-col gap-6" aria-label="Primary">
            {MENU_SECTIONS.map((section, idx) => (
              <div key={section.title} className={idx === 0 ? '' : 'border-t border-white/10 pt-5'}>
                <h3 className="lz-nav-drawer__section-title">{section.title}</h3>
                <div className="flex flex-col gap-2">
                  {section.items.map((item) =>
                    item.kind === 'group' ? (
                      <div key={item.title} className="flex flex-col gap-2">
                        <h4 className="lz-nav-drawer__section-title">{item.title}</h4>
                        <div className="flex flex-col gap-2">
                          {item.items.map((sub) => (
                            <button
                              key={sub.path}
                              type="button"
                              onClick={() => handleNavigation(sub.path)}
                              className={`lz-nav-drawer__link ${
                                navActive(sub.path) ? 'lz-nav-drawer__link--active' : ''
                              }`}
                            >
                              {sub.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <button
                        key={item.path}
                        type="button"
                        onClick={() => handleNavigation(item.path)}
                        className={`lz-nav-drawer__link ${navActive(item.path) ? 'lz-nav-drawer__link--active' : ''}`}
                      >
                        {item.name}
                      </button>
                    )
                  )}
                </div>
              </div>
            ))}

            {isAdmin && (
              <div>
                <h3 className="lz-nav-drawer__section-title">Admin</h3>
                <button
                  type="button"
                  onClick={() => handleNavigation('admin')}
                  className={`lz-nav-drawer__link lz-nav-drawer__link--admin ${
                    currentPage === 'admin' ? 'lz-nav-drawer__link--active' : ''
                  }`}
                >
                  Dashboard
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigation('admin-bookings')}
                  className="lz-nav-drawer__link lz-nav-drawer__link--admin"
                >
                  Bookings
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigation('admin-staff-booking')}
                  className="lz-nav-drawer__link lz-nav-drawer__link--admin"
                >
                  Staff Booking
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigation('admin-calendar')}
                  className="lz-nav-drawer__link lz-nav-drawer__link--admin"
                >
                  Calendar
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigation('admin-disputes')}
                  className="lz-nav-drawer__link lz-nav-drawer__link--admin"
                >
                  Disputes
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigation('admin-outbox')}
                  className="lz-nav-drawer__link lz-nav-drawer__link--admin"
                >
                  Outbox
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigation('admin-shop-orders')}
                  className="lz-nav-drawer__link lz-nav-drawer__link--admin"
                >
                  Shop Orders
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigation('admin-boats')}
                  className="lz-nav-drawer__link lz-nav-drawer__link--admin"
                >
                  Boats
                </button>
              </div>
            )}
          </nav>

          <div className="lz-nav-drawer__footer">
            <a href="tel:803-542-1761" className="lz-nav-drawer__phone">
              Call 803-542-1761
            </a>
          </div>
        </aside>
      </>,
      document.body
    );

  return (
    <>
      <header ref={headerRef} className="lz-header fixed top-0 left-0 z-50 w-full text-white">
        <div className="lz-header-trust border-b border-white/10 border-opacity-50 bg-transparent">
          <div className="lz-header-nav-shell mx-auto w-full max-w-[1200px] overflow-hidden px-2 sm:px-4">
            <div className="lz-trust-ticker" aria-label="Site highlights">
              <div className="lz-trust-ticker__track">
                <div className="lz-trust-ticker__group">
                  {TRUST_TICKER_STATIC.map((item) =>
                    renderTrustItem(item, { interactive: true, keyPrefix: 'a' })
                  )}
                </div>
                <div className="lz-trust-ticker__group" aria-hidden="true">
                  {TRUST_TICKER_STATIC.map((item) =>
                    renderTrustItem(item, { interactive: false, keyPrefix: 'b' })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lz-header-main relative w-full">
          <div className="lz-header-inner lz-header-nav-shell mx-auto w-full max-w-[1200px]">
            <div className="lz-header-left m-0">
              <div className="m-0 flex flex-shrink-0 items-center">
                <Logo
                  variant="nav"
                  className="lz-header-logo m-0 shrink-0"
                  onClick={wrapSyncClick('header_logo_click', () => setMenuOpen(false))}
                />
              </div>
            </div>

            <div className="lz-header-right lz-header-right--compact m-0">
              <button
                type="button"
                onClick={() => handleNavigation('fleet-daytona')}
                className="hidden shrink-0 whitespace-nowrap rounded-lz border border-white/15 bg-white/[0.06] px-2.5 py-2 text-[11px] font-semibold text-white/90 backdrop-blur-md transition hover:border-amber-400/40 hover:text-white sm:inline-flex md:px-3 md:text-xs"
              >
                Rent a Boat
              </button>
              <button
                type="button"
                onClick={() => handleNavigation('book-direct')}
                className="lz-btn-nav-cta lz-btn-nav-cta--toolbar shrink-0 whitespace-nowrap text-[11px] sm:text-xs sm:whitespace-normal"
              >
                Book Direct
              </button>
              <button
                type="button"
                onClick={() => handleNavigation('experiences')}
                className="hidden shrink-0 whitespace-nowrap rounded-lz border border-white/15 bg-white/[0.06] px-2.5 py-2 text-[11px] font-semibold text-white/90 backdrop-blur-md transition hover:border-amber-400/40 hover:text-white md:inline-flex md:px-3 md:text-xs"
              >
                Experiences
              </button>
              <button
                type="button"
                aria-expanded={menuOpen}
                aria-controls="lz-main-nav-menu"
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                onClick={wrapSyncClick('header_menu_toggle', () => setMenuOpen((o) => !o))}
                className="lz-nav-hamburger flex h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lz border border-white/15 bg-white/[0.06] px-3 text-base text-white/90 backdrop-blur-md transition-all duration-200 hover:border-lz-accent/40 hover:bg-white/10 hover:shadow-[0_0_20px_rgba(34,211,238,0.15)] hover:text-white"
              >
                {menuOpen ? <X className="h-5 w-5" aria-hidden /> : <span aria-hidden>☰</span>}
              </button>
            </div>
          </div>
        </div>
      </header>
      {drawer}
    </>
  );
}
