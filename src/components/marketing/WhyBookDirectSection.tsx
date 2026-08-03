import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Anchor,
  CreditCard,
  Headphones,
  Heart,
  ListChecks,
  Shield,
  Sparkles,
  Tag,
} from 'lucide-react';
import { env } from '../../config/env.js';
import { trackDirectBookingEvent } from '../../lib/directBookingMarketing';
import { wrapRouterNavigate } from '../../lib/clickPerf';
import DirectBookingComparison from './DirectBookingComparison';
import DirectBookingSteps from './DirectBookingSteps';
import DirectBookingFAQ from './DirectBookingFAQ';

const PHONE_DISPLAY = env.contactPhone || '803-542-1761';
const PHONE_TEL = `tel:${PHONE_DISPLAY.replace(/\D/g, '')}`;

const FEATURES = [
  {
    icon: Tag,
    title: 'Same Standard Package Pricing',
    body: 'Book our standard bioluminescence packages directly without purchasing a separate voucher.',
  },
  {
    icon: ListChecks,
    title: 'One Simple Booking Process',
    body: 'Choose your experience, select your preferred date, and submit your request in one place.',
  },
  {
    icon: Headphones,
    title: 'Direct Local Support',
    body: 'Call or text the local booking team that manages your reservation and trip details.',
  },
  {
    icon: CreditCard,
    title: 'Secure Online Payment',
    body: 'Complete checkout securely through Stripe with clear totals before you pay.',
  },
  {
    icon: Heart,
    title: 'Support a Local Business',
    body: 'Direct bookings support a locally owned Space Coast business and the team operating your trip.',
  },
  {
    icon: Shield,
    title: 'Captain & Safety Included',
    body: 'Captain-led experiences include the captain, fuel, and required safety equipment. Self-drive rentals do not include a captain.',
  },
] as const;

const TRUST_BADGES = [
  'Family-Owned Business',
  'Captain-Led Experiences',
  'Titusville & Daytona Beach',
  'Space Coast Specialists',
  'Secure Stripe Checkout',
  'Direct Phone & Text Support',
] as const;

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
          observer.disconnect();
        }
      },
      { rootMargin: '0px', threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const goExperiences = wrapRouterNavigate(
    'home_why_direct',
    'book_experience',
    navigate,
    '/experiences'
  );
  const goPackages = wrapRouterNavigate(
    'home_why_direct',
    'bio_packages',
    navigate,
    '/bioluminescent-tours#packages'
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
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/90">
            Book direct
          </p>
          <h2
            id="why-book-direct-heading"
            className="mt-2 font-display text-2xl font-bold uppercase tracking-[0.1em] text-white md:text-3xl"
          >
            Book Direct With Launch Zone Charters
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-base leading-relaxed text-slate-300 md:text-lg">
            Book with the local team that operates your experience, receive direct support, and avoid
            unnecessary voucher-redemption steps.
          </p>
          <p className="mx-auto mt-4 max-w-3xl text-sm leading-relaxed text-slate-400 md:text-base">
            When you book directly, you work with the same local team that schedules, operates, and
            supports your trip from start to finish.
          </p>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-500">
            Choose your experience, request your preferred date, and receive confirmation details after
            secure online checkout.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <article
              key={title}
              className="lz-card-glass p-5 transition motion-safe:hover:border-cyan-400/25 md:p-6"
            >
              <Icon className="h-6 w-6 text-cyan-300/90" aria-hidden />
              <h3 className="mt-3 text-sm font-bold uppercase tracking-wide text-white">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">{body}</p>
            </article>
          ))}
        </div>

        <DirectBookingComparison />
        <DirectBookingSteps />

        <div className="mt-12 flex flex-wrap justify-center gap-2 md:gap-3">
          {TRUST_BADGES.map((label) => (
            <span
              key={label}
              className="rounded-full border border-white/10 bg-slate-950/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-300 md:text-xs"
            >
              {label}
            </span>
          ))}
        </div>

        <div className="lz-card-glass mx-auto mt-12 max-w-3xl border border-[var(--lz-cta)]/25 bg-[rgba(255,140,43,0.06)] p-6 text-center md:p-8">
          <Sparkles className="mx-auto h-7 w-7 text-[var(--lz-cta)]" aria-hidden />
          <h3 className="mt-3 font-display text-lg font-bold uppercase tracking-wide text-white md:text-xl">
            Thank You for Supporting Local
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-slate-300 md:text-base">
            When you book directly, more of your purchase supports the locally owned team that maintains
            the boats, invests in safety, and operates your experience on Florida&apos;s Space Coast.
          </p>
        </div>

        <DirectBookingFAQ />

        <div className="mt-12 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => {
              trackDirectBookingEvent('direct_booking_cta_clicked', { target: 'experiences' });
              goExperiences();
            }}
            className="lz-btn-primary min-h-[48px] w-full min-w-[12rem] sm:w-auto"
          >
            Book Your Experience
          </button>
          <button
            type="button"
            onClick={() => {
              trackDirectBookingEvent('direct_packages_clicked', { target: 'bio_packages' });
              goPackages();
            }}
            className="lz-btn-secondary min-h-[48px] w-full min-w-[12rem] sm:w-auto"
          >
            View Bioluminescence Packages
          </button>
        </div>
        <p className="mt-4 text-center text-sm text-slate-400">
          <Anchor className="mr-1 inline h-4 w-4 text-cyan-400/80" aria-hidden />
          <a
            href={PHONE_TEL}
            className="font-semibold text-cyan-300 underline underline-offset-2"
            onClick={() =>
              trackDirectBookingEvent('direct_booking_cta_clicked', { target: 'phone' })
            }
          >
            Call or Text {PHONE_DISPLAY}
          </a>
        </p>
      </div>
    </section>
  );
}
