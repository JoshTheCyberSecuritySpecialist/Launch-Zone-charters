import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Check, Info, Plus } from 'lucide-react';
import SmartImage from '../components/ui/SmartImage';
import { PRICING } from '../config/pricing';
import {
  SECURITY_DEPOSIT_CARD_INTRO,
  SECURITY_DEPOSIT_MARKETING_BULLETS,
  SECURITY_DEPOSIT_SECTION_HEADING,
} from '../content/securityDeposit';
import { supabase } from '../lib/supabase';
import { wrapNavigateClick, wrapSyncClick } from '../lib/clickPerf';

interface PricingProps {
  onNavigate: (page: string) => void;
}

interface BoatPricingRow {
  id: string;
  name: string;
  type: 'standard' | 'premium';
  hourly_rate: number;
  half_day_rate: number;
  full_day_rate: number;
  is_active: boolean;
}

const DEFAULT_SITE_ORIGIN = 'https://launchzonecharters.com';
const PRICING_HERO_IMAGE =
  '/images/transparent-pricing-boat-rentals-titusville-florida-space-coast-launch-zone-charters.jpg';
const PRICING_HERO_ALT =
  'transparent pricing boat rentals Titusville Florida center console charter Space Coast Launch Zone Charters';

function siteOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  const env = import.meta.env.VITE_SITE_URL as string | undefined;
  if (env && typeof env === 'string') {
    return env.replace(/\/$/, '');
  }
  return DEFAULT_SITE_ORIGIN;
}

export default function Pricing({ onNavigate }: PricingProps) {
  const canonicalUrl = useMemo(() => `${siteOrigin()}/pricing`, []);
  const [standardRates, setStandardRates] = useState({ hourly: 70, halfDay: 280, fullDay: 450 });
  const [keyLargoRates, setKeyLargoRates] = useState({ hourly: 80, halfDay: 300, fullDay: 500 });

  useEffect(() => {
    let cancelled = false;
    async function loadLiveBoatRates() {
      const { data, error } = await supabase
        .from('boats')
        .select('id, name, type, hourly_rate, half_day_rate, full_day_rate, is_active')
        .eq('is_active', true)
        .order('hourly_rate', { ascending: true });
      if (error || !data || cancelled) return;

      const boats = data as BoatPricingRow[];
      const byName = (q: string) =>
        boats.find((b) => b.name.toLowerCase().includes(q.toLowerCase()));
      const byType = (type: 'standard' | 'premium') =>
        boats.find((b) => b.type === type);

      const standardBoat = byName('pontoon') || byType('standard') || boats[0];
      const keyLargoBoat = byName('key largo') || byType('premium') || boats[1] || boats[0];

      if (standardBoat) {
        setStandardRates({
          hourly: Number(standardBoat.hourly_rate),
          halfDay: Number(standardBoat.half_day_rate),
          fullDay: Number(standardBoat.full_day_rate),
        });
      }
      if (keyLargoBoat) {
        setKeyLargoRates({
          hourly: Number(keyLargoBoat.hourly_rate),
          halfDay: Number(keyLargoBoat.half_day_rate),
          fullDay: Number(keyLargoBoat.full_day_rate),
        });
      }
    }
    void loadLiveBoatRates();
    return () => {
      cancelled = true;
    };
  }, []);
  const goToPrefilledRental = (boat: 'standard_pontoon' | 'key_largo_18') => {
    if (typeof window !== 'undefined') {
      window.location.assign(`/booking?bookingMode=rental&boat=${boat}`);
      return;
    }
    onNavigate('book');
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200">
      <Helmet prioritizeSeoTags>
        <title>Transparent Pricing | Launch Zone Charters Titusville Boat Rentals</title>
        <meta
          name="description"
          content="Transparent Florida boat pricing for Launch Zone Charters. Compare hourly, half-day, and full-day rates for center console and pontoon boat rentals in Titusville and across the Space Coast."
        />
        <meta
          name="keywords"
          content="boat rentals Titusville Florida, Space Coast boat charters, center console boat rental, Florida boat pricing, transparent boat rental pricing"
        />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content="Transparent Pricing | Launch Zone Charters" />
        <meta
          property="og:description"
          content="No hidden fees. Compare straightforward rates for Space Coast boat charters and center console rentals."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={`${siteOrigin()}${PRICING_HERO_IMAGE}`} />
      </Helmet>

      <section
        className="relative isolate flex min-h-[68vh] items-end overflow-hidden border-b border-cyan-500/15 bg-[#020617] md:min-h-[76vh]"
        aria-label="Transparent pricing hero image"
      >
        <SmartImage
          src={PRICING_HERO_IMAGE}
          alt={PRICING_HERO_ALT}
          priority
          sizes="100vw"
          className="absolute inset-0 h-full w-full object-contain object-center"
          style={{ objectFit: 'contain' }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to right, rgba(0,0,0,0.45), rgba(0,0,0,0.25))",
          }}
          aria-hidden
        />
      </section>

      <section className="border-b border-cyan-500/15 bg-gradient-to-b from-[#08121c] via-[#020617] to-[#020617] px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="mx-auto max-w-5xl text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/90">
            Transparent pricing
          </p>
          <h1 className="mt-4 max-w-4xl font-display text-4xl font-bold tracking-tight text-white md:text-5xl">
            Transparent Pricing
          </h1>
          <p
            className="mt-6 max-w-3xl text-lg leading-relaxed text-slate-300 md:text-xl"
            style={{ textShadow: '0 2px 10px rgba(0,0,0,0.6)' }}
          >
            No hidden fees. No surprises. Just straightforward pricing for an amazing day on the water.
          </p>
          <p className="mt-4 max-w-4xl text-base leading-relaxed text-slate-400 md:text-lg">
            Launch Zone Charters keeps <span className="text-slate-200">boat rentals Titusville Florida</span>{' '}
            simple with clear rates for <span className="text-slate-200">Space Coast boat charters</span>, including
            every <span className="text-slate-200">center console boat rental</span> package and competitive{' '}
            <span className="text-slate-200">Florida boat pricing</span>.
          </p>
        </div>
      </section>

      <section className="lz-home-section">
        <div className="lz-home-inner">
          <div className="grid gap-8 md:grid-cols-2 md:gap-10">
            <article className="lz-card-glass group relative flex h-full flex-col overflow-hidden border border-lz-cta/45 bg-gradient-to-br from-[#102033]/95 via-[#0d1b2c]/95 to-[#0f2940]/95 p-8 transition-all duration-300 hover:-translate-y-1 hover:border-lz-cta/70 hover:shadow-[0_0_38px_rgba(255,140,43,0.3)]">
              <div className="absolute right-4 top-4">
                <span className="rounded-full border border-cyan-300/35 bg-cyan-500/15 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-cyan-100">
                  Most affordable
                </span>
              </div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 pr-28">
                <h2 className="text-2xl font-bold uppercase tracking-wide text-white md:text-3xl">Standard Pontoon</h2>
                <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-cyan-200">
                  Up to 6 passengers
                </span>
              </div>
              <ul className="mb-6 space-y-2 text-sm text-slate-300">
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-cyan-300" />
                  <span>No hidden fees</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-cyan-300" />
                  <span>Fuel explained upfront</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-cyan-300" />
                  <span>Easy booking</span>
                </li>
              </ul>
              <div className="mb-6 rounded-xl border border-white/10 bg-slate-950/25 p-4 text-sm text-slate-300">
                Family-friendly setup for cruising and relaxed sandbar days at the most affordable rate.
              </div>
              <div className="space-y-5">
                <div className="flex items-end justify-between border-b border-white/10 pb-4">
                  <div>
                    <p className="text-sm uppercase tracking-wider text-slate-400">Hourly rate</p>
                    <p className="mt-1 text-sm text-slate-500">Minimum 2 hours</p>
                  </div>
                  <p className="text-3xl font-bold text-lz-cta">
                    ${standardRates.hourly.toFixed(0)}
                    <span className="text-lg text-slate-400">/hr</span>
                  </p>
                </div>
                <div className="flex items-end justify-between border-b border-white/10 pb-4">
                  <div>
                    <p className="text-sm uppercase tracking-wider text-slate-400">Half-day rental</p>
                    <p className="mt-1 text-sm text-slate-500">4 hours</p>
                  </div>
                  <p className="text-3xl font-bold text-lz-cta">${standardRates.halfDay.toFixed(2)}</p>
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-sm uppercase tracking-wider text-slate-400">Full-day rental</p>
                    <p className="mt-1 text-sm text-slate-500">6 to 8 hours</p>
                  </div>
                  <p className="text-3xl font-bold text-lz-cta">${standardRates.fullDay.toFixed(2)}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={wrapSyncClick('pricing_prefill_standard_pontoon', () =>
                  goToPrefilledRental('standard_pontoon')
                )}
                className="lz-btn-primary mt-8 w-full justify-center"
              >
                Book Standard
              </button>
            </article>

            <article className="lz-card-glass group relative flex h-full flex-col overflow-hidden border border-lz-cta/45 bg-gradient-to-br from-[#102033]/95 via-[#0d1b2c]/95 to-[#0f2940]/95 p-8 transition-all duration-300 hover:-translate-y-1 hover:border-lz-cta/70 hover:shadow-[0_0_38px_rgba(255,140,43,0.3)]">
              <div className="absolute right-4 top-4">
                <span className="rounded-full bg-lz-cta px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-[#02111f]">
                  Best value
                </span>
              </div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 pr-24">
                <h2 className="text-2xl font-bold uppercase tracking-wide text-white md:text-3xl">
                  Key Largo 18ft Center Console
                </h2>
              </div>
              <ul className="mb-6 space-y-2 text-sm text-slate-300">
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-cyan-300" />
                  <span>No hidden fees</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-cyan-300" />
                  <span>Fuel explained upfront</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-cyan-300" />
                  <span>Easy booking</span>
                </li>
              </ul>
              <div className="mb-6 rounded-xl border border-white/10 bg-slate-950/25 p-4 text-sm text-slate-300">
                Ideal for cruising, fishing, and sandbar trips. Easy to handle and perfect for small groups.
              </div>
              <div className="space-y-5">
                <div className="flex items-end justify-between border-b border-white/10 pb-4">
                  <div>
                    <p className="text-sm uppercase tracking-wider text-cyan-200/90">Hourly rate</p>
                    <p className="mt-1 text-sm text-cyan-100/70">Flexible booking</p>
                  </div>
                  <p className="text-3xl font-bold text-lz-cta">
                    ${keyLargoRates.hourly.toFixed(0)}
                    <span className="text-lg text-cyan-100/70">/hr</span>
                  </p>
                </div>
                <div className="flex items-end justify-between border-b border-white/10 pb-4">
                  <div>
                    <p className="text-sm uppercase tracking-wider text-cyan-200/90">Half-day rental</p>
                    <p className="mt-1 text-sm text-cyan-100/70">4 hours</p>
                  </div>
                  <p className="text-3xl font-bold text-lz-cta">${keyLargoRates.halfDay.toFixed(2)}</p>
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-sm uppercase tracking-wider text-cyan-200/90">Full-day rental</p>
                    <p className="mt-1 text-sm text-cyan-100/70">6 to 8 hours</p>
                  </div>
                  <p className="text-3xl font-bold text-lz-cta">${keyLargoRates.fullDay.toFixed(2)}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={wrapSyncClick('pricing_prefill_key_largo_18', () => goToPrefilledRental('key_largo_18'))}
                className="lz-btn-primary mt-8 w-full justify-center"
              >
                Book Key Largo
              </button>
            </article>
          </div>
        </div>
      </section>

      <section className="lz-home-section border-t border-cyan-500/10">
        <div className="lz-home-inner">
          <div className="lz-card-glass p-8">
            <h3 className="mb-6 flex items-center text-2xl font-bold text-white">
              <Plus className="mr-2 h-6 w-6 text-lz-cta" />
              Optional Add-Ons
            </h3>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-6 transition-colors hover:border-cyan-300/25">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h4 className="text-xl font-semibold text-white">Professional Captain</h4>
                  <span className="text-2xl font-bold text-lz-cta">${PRICING.captainHourly}/hr</span>
                </div>
                <p className="mb-4 text-slate-300">
                  Relax and enjoy while our USCG certified captain handles navigation and boat operation.
                </p>
                <ul className="space-y-2 text-sm text-slate-400">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-cyan-300" />
                    <span>USCG certified and experienced</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-cyan-300" />
                    <span>Local area expertise</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-cyan-300" />
                    <span>
                      {`Billed at $${PRICING.captainHourly}/hr for your rental hours (e.g. 4 hr = $${PRICING.captainHourly * 4}; 8 hr = $${PRICING.captainHourly * 8})`}
                    </span>
                  </li>
                </ul>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-6 transition-colors hover:border-cyan-300/25">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h4 className="text-xl font-semibold text-white">{SECURITY_DEPOSIT_SECTION_HEADING}</h4>
                </div>
                <p className="mb-4 text-slate-300">{SECURITY_DEPOSIT_CARD_INTRO}</p>
                <ul className="space-y-2 text-sm text-slate-400">
                  {SECURITY_DEPOSIT_MARKETING_BULLETS.map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="lz-home-section border-t border-cyan-500/10 pt-0">
        <div className="lz-home-inner">
          <div className="lz-card-glass p-8">
            <h3 className="mb-6 flex items-center text-2xl font-bold text-white">
              <Info className="mr-2 h-6 w-6 text-lz-cta" />
              Important Information
            </h3>
            <div className="grid gap-6 text-slate-300 md:grid-cols-2">
              <div>
                <h4 className="mb-2 font-semibold text-white">What's Included</h4>
                <ul className="space-y-2 text-sm text-slate-400">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-cyan-300" />
                    <span>Life jackets for all passengers</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-cyan-300" />
                    <span>Safety equipment</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-cyan-300" />
                    <span>Fuel for standard cruising</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-cyan-300" />
                    <span>Basic instruction and orientation</span>
                  </li>
                </ul>
              </div>

              <div>
                <h4 className="mb-2 font-semibold text-white">Peak Pricing</h4>
                <p className="mb-4 text-sm text-slate-400">
                  Premium rates may apply during holidays, special events, and rocket launches.
                </p>
                <ul className="space-y-2 text-sm text-slate-400">
                  <li>Memorial Day Weekend: +15%</li>
                  <li>4th of July Weekend: +20%</li>
                  <li>Labor Day Weekend: +15%</li>
                  <li>Major Rocket Launches: +10-20%</li>
                </ul>
              </div>

              <div>
                <h4 className="mb-2 font-semibold text-white">Requirements</h4>
                <ul className="space-y-2 text-sm text-slate-400">
                  <li>Minimum age: 25 years old</li>
                  <li>Valid boating license (if self-driving)</li>
                  <li>Government-issued ID required</li>
                  <li>Signed liability waiver</li>
                </ul>
              </div>

              <div>
                <h4 className="mb-2 font-semibold text-white">Late Returns</h4>
                <p className="text-sm text-slate-400">
                  Late returns are billed in 15-minute increments at the hourly rate. Please plan accordingly and contact us if you anticipate delays.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="lz-home-section border-t border-cyan-500/15 text-white" aria-labelledby="pricing-cta-heading">
        <div className="lz-home-inner">
          <div className="lz-card-glass mx-auto max-w-4xl px-6 py-10 text-center sm:px-10 md:px-12 md:py-14">
          <h2 id="pricing-cta-heading" className="mb-6 font-display text-3xl font-bold uppercase tracking-[0.1em] text-white md:text-4xl">
            Ready to Book Your Adventure?
          </h2>
          <p className="mb-8 text-base font-semibold uppercase leading-relaxed tracking-[0.12em] text-slate-200 md:text-lg">
            Choose your boat, pick your time, and get ready for an unforgettable experience.
          </p>
            <div className="flex flex-col justify-center gap-4 sm:flex-row sm:items-center sm:justify-center">
              <button type="button" onClick={wrapNavigateClick('pricing', 'book', onNavigate)} className="lz-btn-primary">
                Book now
              </button>
              <button
                type="button"
                onClick={wrapNavigateClick('pricing', 'fleet-daytona', onNavigate)}
                className="lz-btn-secondary"
              >
                View rentals
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
