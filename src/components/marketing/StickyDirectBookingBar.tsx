import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import {
  STICKY_DIRECT_BAR_SESSION_KEY,
  trackDirectBookingEvent,
} from '../../lib/directBookingMarketing';
import { wrapRouterNavigate } from '../../lib/clickPerf';
import { DIRECT_DEALS_PATH } from '../../lib/directDealsCatalog';

type StickyDirectBookingBarProps = {
  heroSentinelId?: string;
  onVisibilityChange?: (visible: boolean) => void;
};

export default function StickyDirectBookingBar({
  heroSentinelId = 'home-hero',
  onVisibilityChange,
}: StickyDirectBookingBarProps) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof sessionStorage === 'undefined') return false;
    return sessionStorage.getItem(STICKY_DIRECT_BAR_SESSION_KEY) === '1';
  });
  const [pastHero, setPastHero] = useState(false);
  const viewedRef = useRef(false);

  const visible = pastHero && !dismissed;

  useEffect(() => {
    onVisibilityChange?.(visible);
  }, [visible, onVisibilityChange]);

  useEffect(() => {
    if (!visible || viewedRef.current) return;
    viewedRef.current = true;
    trackDirectBookingEvent('sticky_direct_bar_viewed');
  }, [visible]);

  useEffect(() => {
    const sentinel = document.getElementById(heroSentinelId);
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setPastHero(entry ? !entry.isIntersecting : false);
      },
      { threshold: 0, rootMargin: '0px 0px -1px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [heroSentinelId]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    sessionStorage.setItem(STICKY_DIRECT_BAR_SESSION_KEY, '1');
    trackDirectBookingEvent('sticky_direct_bar_dismissed');
  }, []);

  const goBookDirect = wrapRouterNavigate(
    'home_sticky_direct',
    'book_direct',
    navigate,
    DIRECT_DEALS_PATH
  );

  if (!visible) return null;

  return (
    <aside
      className="fixed inset-x-0 bottom-0 z-40 border-t border-cyan-400/25 bg-slate-950/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md motion-safe:transition-opacity motion-reduce:transition-none"
      aria-label="Direct booking reminder"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white md:text-base">
            <span className="md:hidden">Book Direct</span>
            <span className="hidden md:inline">Book Direct With Launch Zone Charters</span>
          </p>
          <p className="mt-0.5 hidden text-xs text-slate-400 md:block">
            Direct local support · Secure checkout ·{' '}
            <Link
              to="/booking/groupon"
              className="text-cyan-300/90 underline underline-offset-2"
              onClick={() =>
                trackDirectBookingEvent('groupon_redemption_link_clicked', { placement: 'sticky_bar' })
              }
            >
              Groupon redemption
            </Link>
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-400 md:hidden">
            Direct booking · Local support
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            to="/bioluminescent-tours#packages"
            className="hidden text-xs font-semibold text-cyan-300 underline underline-offset-2 sm:inline"
            onClick={() => trackDirectBookingEvent('sticky_direct_bar_clicked', { target: 'packages' })}
          >
            View Packages
          </Link>
          <button
            type="button"
            onClick={() => {
              trackDirectBookingEvent('sticky_direct_bar_clicked', { target: 'book_direct' });
              goBookDirect();
            }}
            className="lz-btn-primary min-h-[44px] px-4 py-2 text-xs font-semibold uppercase tracking-wide sm:min-h-[48px] sm:px-5 sm:text-sm"
          >
            <span className="sm:hidden">Book</span>
            <span className="hidden sm:inline">Book Direct</span>
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/15 text-slate-300 transition hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
            aria-label="Dismiss direct-booking reminder"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </aside>
  );
}
