import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useSearchParams } from 'react-router-dom';
import Spinner from '../components/Spinner';
import { env } from '../config/env.js';
import {
  isDirectBioPackagePricingEnabled,
} from '../lib/bioluminescencePackages';
import { trackDirectBookingEvent } from '../lib/directBookingMarketing';
import {
  buildDirectDealSections,
  isKnownDirectPackageId,
  type DirectDealCard,
  type DirectDealSection,
} from '../lib/directDealsCatalog';
import { isDirectRocketPackagePricingEnabled } from '../lib/rocketLaunchPackages';
import { isDirectSunsetPackagePricingEnabled, SUNSET_WILDLIFE_DISCLAIMER } from '../lib/sunsetPackages';

interface DirectDealsProps {
  onNavigate: (page: string) => void;
}

type ConfigStatus = 'loading' | 'ready' | 'error';

function DealCard({ card }: { card: DirectDealCard }) {
  const showSharedNote =
    card.disclosure === 'bio_shared' ||
    card.disclosure === 'rocket_shared' ||
    card.disclosure === 'sunset_shared';
  const isPrivate = card.disclosure === 'rocket_private' || card.disclosure === 'sunset_private';

  return (
    <article className="flex h-full flex-col rounded-2xl border border-white/12 bg-slate-950/55 p-4 shadow-lg md:p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/90">
        {card.experienceId === 'bio'
          ? 'Bioluminescence'
          : card.experienceId === 'rocket_launch'
            ? 'Rocket launch'
            : 'Sunset cruise'}
      </p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-white md:text-xl">{card.name}</h3>
        {card.badge ? (
          <span
            className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${
              isPrivate
                ? 'border border-amber-300/40 bg-amber-500/15 text-amber-100'
                : 'bg-[var(--lz-cta)] text-[#02111f]'
            }`}
          >
            {card.badge}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-300">{card.description}</p>
      <p className="mt-3 text-sm font-semibold text-slate-100">
        {card.guestLabel}
        <span className="mx-2 text-slate-500" aria-hidden>
          ·
        </span>
        <span className={isPrivate ? 'uppercase tracking-wide text-amber-100' : 'text-cyan-100/90'}>
          {card.seatingLabel}
        </span>
      </p>
      {card.priceLabel ? (
        <p className="mt-3 text-3xl font-bold text-white">{card.priceLabel}</p>
      ) : (
        <p className="mt-3 text-sm font-medium text-slate-400">Pricing shown in the next step</p>
      )}
      {showSharedNote && card.disclosureBody ? (
        <div
          className="mt-4 rounded-xl border border-amber-400/30 bg-amber-950/25 p-3 text-sm leading-relaxed text-amber-50/95"
          role="note"
        >
          <p className="text-xs font-bold uppercase tracking-wide text-amber-200/95">
            {card.seatingLabel}
          </p>
          <p className="mt-2">{card.disclosureBody}</p>
          {card.extraDisclosure ? <p className="mt-2 font-medium text-amber-100/90">{card.extraDisclosure}</p> : null}
        </div>
      ) : null}
      {isPrivate ? (
        <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-amber-100">Private charter</p>
      ) : null}
      {!showSharedNote && !isPrivate && card.disclosureBody ? (
        <p className="mt-4 text-sm leading-relaxed text-slate-400">{card.disclosureBody}</p>
      ) : null}
      <Link
        to={card.href}
        className="lz-btn-primary mt-5 min-h-[48px] w-full justify-center text-sm font-semibold uppercase tracking-[0.1em] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050a14]"
        onClick={() =>
          trackDirectBookingEvent('direct_package_selected', {
            experienceId: card.experienceId,
            packageId: card.packageId ?? 'none',
          })
        }
      >
        Book This Experience
      </Link>
    </article>
  );
}

function DealSection({ section }: { section: DirectDealSection }) {
  return (
    <section aria-labelledby={`direct-deals-${section.id}-heading`} className="mt-10 first:mt-0">
      <h2
        id={`direct-deals-${section.id}-heading`}
        className="font-display text-lg font-bold uppercase tracking-[0.14em] text-white md:text-xl"
      >
        {section.heading}
      </h2>
      {section.id === 'sunset' ? (
        <p className="mt-2 text-sm leading-relaxed text-slate-400">{SUNSET_WILDLIFE_DISCLAIMER}</p>
      ) : null}
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {section.cards.map((card) => (
          <DealCard key={card.id} card={card} />
        ))}
      </div>
    </section>
  );
}

export default function DirectDeals({ onNavigate }: DirectDealsProps) {
  void onNavigate;
  const [searchParams] = useSearchParams();
  const viewedRef = useRef(false);
  const [status, setStatus] = useState<ConfigStatus>(() =>
    env.apiUrlConfigured && env.apiUrl ? 'loading' : 'ready'
  );
  const [serverBioEnabled, setServerBioEnabled] = useState<boolean | null>(null);
  const [serverRocketEnabled, setServerRocketEnabled] = useState<boolean | null>(null);
  const [serverSunsetEnabled, setServerSunsetEnabled] = useState<boolean | null>(null);

  const loadConfig = useCallback((signal?: AbortSignal) => {
    if (!env.apiUrlConfigured || !env.apiUrl) {
      setStatus('ready');
      return;
    }
    setStatus('loading');
    fetch(`${env.apiUrl}/api/public/booking-config`, { signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('booking-config'))))
      .then((data: {
        directBioPackagePricingEnabled?: boolean;
        directRocketPackagePricingEnabled?: boolean;
        directSunsetPackagePricingEnabled?: boolean;
      }) => {
        setServerBioEnabled(Boolean(data.directBioPackagePricingEnabled));
        setServerRocketEnabled(Boolean(data.directRocketPackagePricingEnabled));
        setServerSunsetEnabled(Boolean(data.directSunsetPackagePricingEnabled));
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setServerBioEnabled(null);
        setServerRocketEnabled(null);
        setServerSunsetEnabled(null);
        setStatus('error');
      });
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    loadConfig(ac.signal);
    return () => ac.abort();
  }, [loadConfig]);

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    trackDirectBookingEvent('direct_deals_viewed');
  }, []);

  const packageParam = searchParams.get('package');
  const unknownPackage = Boolean(packageParam) && !isKnownDirectPackageId(packageParam);

  const bioPackagesEnabled =
    isDirectBioPackagePricingEnabled() || serverBioEnabled === true;
  const rocketPackagesEnabled =
    isDirectRocketPackagePricingEnabled() || serverRocketEnabled === true;
  const sunsetPackagesEnabled =
    isDirectSunsetPackagePricingEnabled() || serverSunsetEnabled === true;

  const sections = useMemo(
    () => buildDirectDealSections({ bioPackagesEnabled, rocketPackagesEnabled, sunsetPackagesEnabled }),
    [bioPackagesEnabled, rocketPackagesEnabled, sunsetPackagesEnabled]
  );

  return (
    <div className="min-h-screen bg-lz-bg text-slate-100">
      <Helmet prioritizeSeoTags>
        <title>Book Direct | Launch Zone Charters</title>
        <meta
          name="description"
          content="Choose a Launch Zone Charters direct booking package: bioluminescence tours, rocket launch experiences, or a sunset cruise."
        />
        <link rel="canonical" href="https://launchzonecharters.com/booking/direct" />
      </Helmet>

      <section className="lz-page-hero py-12 md:py-16">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/90">Direct booking</p>
          <h1 className="lz-page-hero-heading mt-3 font-display text-white">Book Direct</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-300 md:text-lg">
            Choose the experience that works best for your group.
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-slate-400 md:text-base">
            Book directly with Launch Zone Charters for simple scheduling, local support, and access to our
            direct booking packages.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8">
        <p
          className="rounded-2xl border border-cyan-400/20 bg-cyan-950/25 px-4 py-3 text-sm text-cyan-50"
          role="note"
        >
          We assign your vessel — you do not pick a boat here. Availability, dates, and checkout stay in the
          booking form after you choose a package.
        </p>

        {unknownPackage ? (
          <p className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
            That package link is no longer valid. Choose an experience below to continue.
          </p>
        ) : null}

        {status === 'error' ? (
          <div
            className="mt-4 rounded-2xl border border-red-400/35 bg-red-950/30 px-4 py-4"
            role="alert"
          >
            <p className="font-semibold text-red-50">We couldn&apos;t load booking options right now.</p>
            <p className="mt-1 text-sm text-red-100/85">
              You can try again, or continue with the experiences shown below.
            </p>
            <button
              type="button"
              onClick={() => loadConfig()}
              className="lz-btn-secondary mt-3 min-h-[44px] px-4 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
            >
              Try Again
            </button>
          </div>
        ) : null}

        {status === 'loading' ? (
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
            <Spinner size="sm" tone="onDark" />
            <p className="text-sm text-slate-400">Loading booking options…</p>
          </div>
        ) : null}

        {sections.map((section) => (
          <DealSection key={section.id} section={section} />
        ))}

        <p className="mt-12 text-center text-sm text-slate-400">
          Already have a Groupon voucher?{' '}
          <Link
            to="/booking/groupon"
            className="font-semibold text-cyan-300 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
            onClick={() =>
              trackDirectBookingEvent('groupon_redemption_link_clicked', { placement: 'direct_deals' })
            }
          >
            Redeem it here
          </Link>
          . Groupon redemption is separate from direct checkout.
        </p>
      </div>
    </div>
  );
}
