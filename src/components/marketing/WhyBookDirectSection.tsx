import { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Headphones, ListChecks, MessageSquare, ClipboardList } from 'lucide-react';
import {
  BIO_PACKAGE_DISPLAY,
  formatBioPackagePriceUsd,
} from '../../lib/bioluminescencePackages';
import { DIRECT_DEALS_PATH } from '../../lib/directDealsCatalog';
import { trackDirectBookingEvent } from '../../lib/directBookingMarketing';
import { wrapRouterNavigate } from '../../lib/clickPerf';
import DirectBookingSteps from './DirectBookingSteps';
import DirectBookingFAQ from './DirectBookingFAQ';

const DIRECT_BENEFITS = [
  {
    icon: Headphones,
    title: 'Direct Local Support',
    body: 'Communicate directly with the Launch Zone Charters booking team about your reservation and trip details.',
  },
  {
    icon: ListChecks,
    title: 'Simple Online Reservation',
    body: 'Choose the available package, date and time directly through the Launch Zone Charters booking system.',
  },
  {
    icon: MessageSquare,
    title: 'Clear Trip Communication',
    body: 'Receive booking confirmations, reminders and important trip instructions directly from Launch Zone Charters.',
  },
  {
    icon: ClipboardList,
    title: 'Easy Reservation Management',
    body: 'Keep reservation details, required forms and trip information connected to your direct booking.',
  },
] as const;

const startingAtUsd = Math.min(...BIO_PACKAGE_DISPLAY.map((p) => p.directPriceUsd));

export default function WhyBookDirectSection() {
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLElement>(null);
  const viewedRef = useRef(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el || viewedRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !viewedRef.current) {
          viewedRef.current = true;
          trackDirectBookingEvent('why_book_direct_viewed');
          trackDirectBookingEvent('direct_booking_section_viewed');
        }
      },
      { rootMargin: '0px', threshold: 0.12 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const goBookDirect = wrapRouterNavigate(
    'home_why_direct',
    'book_direct',
    navigate,
    DIRECT_DEALS_PATH
  );

  return (
    <section
      ref={sectionRef}
      id="why-book-direct"
      className="lz-home-section border-t border-cyan-500/15 bg-gradient-to-b from-cyan-950/20 to-transparent"
      aria-labelledby="why-book-direct-heading"
    >
      <div className="lz-home-inner">
        <div className="lz-home-section__head text-center">
          <h2
            id="why-book-direct-heading"
            className="font-display text-2xl font-bold uppercase tracking-[0.1em] text-white md:text-3xl"
          >
            Book Direct with Launch Zone Charters
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-base leading-relaxed text-slate-300 md:text-lg">
            Reserve directly with our local booking team for straightforward scheduling, direct trip
            communication and easy access to your reservation details. Already purchased a Groupon? You
            can still redeem your voucher through our dedicated Groupon booking page.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:gap-5">
          {DIRECT_BENEFITS.map(({ icon: Icon, title, body }) => (
            <article key={title} className="lz-card-glass p-5 md:p-6">
              <Icon className="h-6 w-6 text-cyan-300/90" aria-hidden />
              <h3 className="mt-3 text-sm font-bold uppercase tracking-wide text-white">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">{body}</p>
            </article>
          ))}
        </div>

        <DirectBookingSteps />

        <DirectBookingFAQ />

        <div className="mt-10 flex flex-col items-center gap-4">
          <p className="text-center text-sm text-slate-300 md:text-base">
            Direct charter packages from {formatBioPackagePriceUsd(startingAtUsd)}. Choose bioluminescence,
            rocket launch, or sunset after you book direct.
          </p>
          <button
            type="button"
            onClick={() => {
              trackDirectBookingEvent('direct_booking_cta_clicked', { target: 'book_direct' });
              goBookDirect();
            }}
            className="lz-btn-primary min-h-[48px] w-full max-w-md"
          >
            Book Direct
          </button>
          <p className="text-center text-sm text-slate-400">
            Already have a Groupon voucher?{' '}
            <Link
              to="/booking/groupon"
              className="font-semibold text-cyan-300 underline underline-offset-2"
              onClick={() =>
                trackDirectBookingEvent('groupon_redemption_link_clicked', {
                  placement: 'why_book_direct',
                })
              }
            >
              Redeem it here
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
