import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Shield, Award, Star } from 'lucide-react';
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
    title: 'Rent a Boat (self-drive)',
    items: [
      { kind: 'link', name: 'Daytona Beach', path: 'fleet-daytona' },
      { kind: 'link', name: 'Titusville', path: 'fleet-titusville' },
    ],
  },
  {
    title: 'Charter Experiences (captain included)',
    items: [
      { kind: 'link', name: 'Rocket Launch Charters', path: 'launches' },
      { kind: 'link', name: 'Bioluminescent Tours', path: 'bioluminescent-tours' },
      { kind: 'link', name: 'Sunset / Private Charters', path: 'book-sunset' },
    ],
  },
  {
    title: 'Before your trip',
    items: [{ kind: 'link', name: 'Waivers & Insurance', path: 'waivers-insurance' }],
  },
  {
    title: 'Information',
    items: [
      { kind: 'link', name: 'Marine Conditions', path: 'conditions' },
      { kind: 'link', name: 'Bioluminescence Guide', path: 'bioluminescence' },
      { kind: 'link', name: 'Observation Bottle', path: 'observation-bottle' },
      { kind: 'link', name: "Captain's Log", path: 'captains-log' },
      { kind: 'link', name: 'FAQs', path: 'faqs' },
    ],
  },
  {
    title: 'Company',
    items: [
      { kind: 'link', name: 'About', path: 'about' },
      { kind: 'link', name: 'Contact', path: 'contact' },
    ],
  },
];

export default function Header({ onNavigate, currentPage }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { isAdmin } = useAuth();
  const headerRef = useRef<HTMLElement>(null);
  const lastScrollY = useRef(0);

  const navActive = (path: string) =>
    currentPage === path || (path === 'captains-log' && currentPage === 'log-article');

  const handleNavigation = (path: string) => {
    wrapSyncClick(`header_nav_${perfActionSegment(path)}`, () => {
      onNavigate(path);
      setMenuOpen(false);
    })();
  };

  const closeMenu = () => wrapSyncClick('header_menu_close', () => setMenuOpen(false))();

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
          <div className="lz-header-nav-shell mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-center gap-x-5 gap-y-0 px-4 py-0 text-[10px] md:justify-between md:text-[11px]">
            <div className="flex items-center gap-2 text-slate-300">
              <Shield className="h-3 w-3 shrink-0 text-lz-accent" aria-hidden />
              <span className="font-medium tracking-wide">Licensed & Insured</span>
            </div>
            <div className="hidden items-center gap-2 text-slate-300 sm:flex">
              <Award className="h-3 w-3 shrink-0 text-lz-accent" aria-hidden />
              <span className="font-medium tracking-wide">Local Experts</span>
            </div>
            <div className="hidden items-center gap-2 text-slate-300 sm:flex">
              <Star className="h-3 w-3 shrink-0 fill-lz-accent text-lz-accent" aria-hidden />
              <span className="font-medium tracking-wide">5-Star Service</span>
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
                onClick={() => handleNavigation('waivers-insurance')}
                className="hidden shrink-0 whitespace-nowrap rounded-lz border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white/90 backdrop-blur-md transition hover:border-cyan-400/40 hover:text-white md:inline-flex"
              >
                Waivers &amp; Insurance
              </button>
              <button
                type="button"
                onClick={() => handleNavigation('book')}
                className="lz-btn-nav-cta lz-btn-nav-cta--toolbar shrink-0 whitespace-nowrap sm:whitespace-normal"
              >
                Book Now
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
