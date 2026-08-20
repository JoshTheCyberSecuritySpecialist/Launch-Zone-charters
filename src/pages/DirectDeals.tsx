import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import DirectPackageSelector from '../components/booking/DirectPackageSelector';
import { env } from '../config/env.js';
import {
  BIO_PACKAGE_PRICING_DISCLAIMER,
  isDirectBioPackagePricingEnabled,
} from '../lib/bioluminescencePackages';
import {
  bookingUrlForDirectPackage,
  DIRECT_DEALS_PATH,
  parseDirectExperienceParam,
} from '../lib/directBookingFlow.js';
import { trackDirectBookingEvent } from '../lib/directBookingMarketing';
import {
  buildDirectExperienceCards,
  isKnownDirectPackageId,
  type DirectExperienceCard,
} from '../lib/directDealsCatalog';
import { isDirectRocketPackagePricingEnabled } from '../lib/rocketLaunchPackages';
import { isDirectSunsetPackagePricingEnabled } from '../lib/sunsetPackages';

interface DirectDealsProps {
  onNavigate: (page: string) => void;
}

const EXPERIENCE_COPY = {
  bio: {
    title: 'Bioluminescence Night Tour',
    heading: 'Choose your bio package',
    note: BIO_PACKAGE_PRICING_DISCLAIMER,
  },
  rocket: {
    title: 'Rocket Launch Experience',
    heading: 'Choose your rocket launch package',
    note: 'Guest packages — not boats. Launch Zone assigns your vessel based on availability.',
  },
  sunset: {
    title: 'Sunset & Wildlife Cruise',
    heading: 'Choose your sunset package',
    note: 'Shared and private cruise options. Sunset Solo can only join an already-paid shared departure.',
  },
} as const;

function ExperienceCard({ card }: { card: DirectExperienceCard }) {
  return (
    <Link
      to={card.href}
      aria-label={`${card.ctaLabel}: ${card.name}`}
      className="group flex h-full min-h-[20rem] flex-col rounded-2xl border border-white/12 bg-slate-950/55 p-6 shadow-lg transition hover:border-cyan-400/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050a14] md:p-8"
      onClick={() =>
        trackDirectBookingEvent('direct_experience_selected', {
          experienceId: card.id,
        })
      }
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/90">{card.category}</p>
      <h2 className="mt-2 font-display text-xl font-bold text-white md:text-2xl">{card.name}</h2>
      <p className="mt-3 text-sm leading-relaxed text-slate-300">{card.description}</p>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{card.supportingText}</p>
      <div className="mt-auto pt-6">
        <p className="text-lg font-semibold text-white">
          {card.fromPriceLabel ?? 'View booking options'}
        </p>
        <span className="lz-btn-primary pointer-events-none mt-4 min-h-[48px] w-full justify-center text-sm font-semibold uppercase tracking-[0.1em]">
          {card.ctaLabel}
        </span>
      </div>
    </Link>
  );
}

export default function DirectDeals({ onNavigate }: DirectDealsProps) {
  void onNavigate;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const viewedRef = useRef(false);
  const [serverBioEnabled, setServerBioEnabled] = useState<boolean | null>(null);
  const [serverRocketEnabled, setServerRocketEnabled] = useState<boolean | null>(null);
  const [serverSunsetEnabled, setServerSunsetEnabled] = useState<boolean | null>(null);

  const loadConfig = useCallback((signal?: AbortSignal) => {
    if (!env.apiUrlConfigured || !env.apiUrl) {
      return;
    }
    fetch(`${env.apiUrl}/api/public/booking-config`, { signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('booking-config'))))
      .then(
        (data: {
          directBioPackagePricingEnabled?: boolean;
          directRocketPackagePricingEnabled?: boolean;
          directSunsetPackagePricingEnabled?: boolean;
        }) => {
          setServerBioEnabled(Boolean(data.directBioPackagePricingEnabled));
          setServerRocketEnabled(Boolean(data.directRocketPackagePricingEnabled));
          setServerSunsetEnabled(Boolean(data.directSunsetPackagePricingEnabled));
        }
      )
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setServerBioEnabled(null);
        setServerRocketEnabled(null);
        setServerSunsetEnabled(null);
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

  const experienceParam = searchParams.get('experience');
  const selectedExperience = parseDirectExperienceParam(experienceParam);
  const unknownExperience = Boolean(experienceParam) && !selectedExperience;
  const packageParam = searchParams.get('package');
  const unknownPackage = Boolean(packageParam) && !isKnownDirectPackageId(packageParam);

  const bioPackagesEnabled = isDirectBioPackagePricingEnabled() || serverBioEnabled === true;
  const rocketPackagesEnabled =
    isDirectRocketPackagePricingEnabled() || serverRocketEnabled === true;
  const sunsetPackagesEnabled =
    isDirectSunsetPackagePricingEnabled() || serverSunsetEnabled === true;

  const cards = useMemo(
    () =>
      buildDirectExperienceCards({
        bioPackagesEnabled,
        rocketPackagesEnabled,
        sunsetPackagesEnabled,
      }),
    [bioPackagesEnabled, rocketPackagesEnabled, sunsetPackagesEnabled]
  );

  if (selectedExperience) {
    const copy = EXPERIENCE_COPY[selectedExperience];
    return (
      <div className="min-h-screen bg-lz-bg text-slate-100">
        <Helmet prioritizeSeoTags>
          <title>{copy.title} | Book Direct | Launch Zone Charters</title>
          <meta name="description" content={`${copy.heading} before choosing a date.`} />
          <link rel="canonical" href="https://launchzonecharters.com/booking/direct" />
        </Helmet>

        <section className="lz-page-hero py-12 md:py-16">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/90">Direct booking</p>
            <h1 className="lz-page-hero-heading mt-3 font-display text-white">{copy.title}</h1>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-300 md:text-lg">
              {copy.heading}
            </p>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-slate-400 md:text-base">
              {copy.note}
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8">
          <Link
            to={DIRECT_DEALS_PATH}
            className="inline-flex min-h-[44px] items-center text-sm font-semibold text-cyan-300 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
          >
            All experiences
          </Link>
          <div className="mt-6">
            <DirectPackageSelector
              experience={selectedExperience}
              onSelect={(packageId) => {
                const href = bookingUrlForDirectPackage(selectedExperience, packageId);
                if (!href) return;
                trackDirectBookingEvent('direct_package_selected', {
                  experienceId: selectedExperience,
                  packageId,
                });
                const date = searchParams.get('date');
                const next =
                  date && /^\d{4}-\d{2}-\d{2}$/.test(date)
                    ? `${href}&date=${encodeURIComponent(date)}`
                    : href;
                navigate(next);
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-lz-bg text-slate-100">
      <Helmet prioritizeSeoTags>
        <title>Book Direct | Launch Zone Charters</title>
        <meta
          name="description"
          content="Choose a Launch Zone Charters experience: bioluminescence night tour, rocket launch charter, or sunset and wildlife cruise."
        />
        <link rel="canonical" href="https://launchzonecharters.com/booking/direct" />
      </Helmet>

      <section className="lz-page-hero py-12 md:py-16">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/90">Direct booking</p>
          <h1 className="lz-page-hero-heading mt-3 font-display text-white">Book Direct</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-300 md:text-lg">
            Choose the experience you want. Package options, dates, and checkout come next.
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-slate-400 md:text-base">
            Book directly with Launch Zone Charters for simple scheduling and local support.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8">
        <p
          className="rounded-2xl border border-cyan-400/20 bg-cyan-950/25 px-4 py-3 text-sm text-cyan-50"
          role="note"
        >
          We assign your vessel — you do not pick a boat here. Choose an experience to see packages,
          then pick a date.
        </p>

        {unknownExperience || unknownPackage ? (
          <p className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
            That booking link is no longer valid. Choose an experience below to continue.
          </p>
        ) : null}

        <div className="mt-8 grid gap-5 sm:gap-6 lg:grid-cols-3">
          {cards.map((card) => (
            <ExperienceCard key={card.id} card={card} />
          ))}
        </div>

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
