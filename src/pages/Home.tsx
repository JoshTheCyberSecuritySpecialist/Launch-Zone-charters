import { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useNavigate } from 'react-router-dom';
import { Anchor, Award, Calendar, Clock, Loader2, Shield, Star, Volume2, VolumeX } from 'lucide-react';
import SmartImage from '../components/ui/SmartImage';
import LaunchCountdown from '../components/LaunchCountdown';
import ObservationBottlePromo from '../components/ObservationBottlePromo';
import { formatBestViewingWindow, getLaunchConfidence } from '../lib/launchFormat';
import { getBookingWindow } from '../lib/launchBookingWindow';
import { env } from '../config/env.js';
import { wrapNavigateClick, wrapRouterNavigate } from '../lib/clickPerf';

const DEFAULT_SITE_ORIGIN = 'https://launchzonecharters.com';

function siteOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  const url = import.meta.env.VITE_SITE_URL as string | undefined;
  if (url && typeof url === 'string') {
    return url.replace(/\/$/, '');
  }
  return DEFAULT_SITE_ORIGIN;
}

/** Rocket launch + water: full-bleed hero in /public/images (use a text-free master when available). */
const HERO_IMAGE_SRC = '/images/hero-rocket-launch-background.png';
const HERO_CINEMATIC_VIDEO_SRC = '/videos/launch-zone-action.mp4';

/** SEO / accessibility */
const HERO_BG_ALT =
  'Night rocket launch over the water with a boat in the foreground, Space Coast Florida';

interface HomeProps {
  onNavigate: (page: string) => void;
}

type LaunchPreviewRow = {
  name?: string;
  net?: string | null;
  window_start?: string | null;
  status?: { name?: string } | string;
};

export default function Home({ onNavigate }: HomeProps) {
  const navigate = useNavigate();
  const [nextLaunch, setNextLaunch] = useState<LaunchPreviewRow | null>(null);
  const [launchPreviewLoading, setLaunchPreviewLoading] = useState(true);
  const [launchPreviewFailed, setLaunchPreviewFailed] = useState(false);
  const [heroVideoError, setHeroVideoError] = useState(false);
  const [heroVideoMuted, setHeroVideoMuted] = useState(true);
  const heroVideoRef = useRef<HTMLVideoElement | null>(null);

  const toggleHeroSound = () => {
    const el = heroVideoRef.current;
    if (!el) return;
    const newMutedState = !el.muted;
    el.muted = newMutedState;
    void el.play().catch(() => {});
    setHeroVideoMuted(newMutedState);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!env.apiUrlConfigured || !env.apiUrl) {
          if (!cancelled) setLaunchPreviewFailed(true);
          return;
        }
        const res = await fetch(`${env.apiUrl}/api/launch-schedule-preview`);
        if (!res.ok) {
          if (!cancelled) setLaunchPreviewFailed(true);
          return;
        }
        const data = (await res.json()) as { success?: boolean; launches?: LaunchPreviewRow[] };
        if (cancelled) return;
        if (data?.success && Array.isArray(data.launches)) {
          setNextLaunch(data.launches[0] ?? null);
        } else {
          setLaunchPreviewFailed(true);
        }
      } catch {
        if (!cancelled) setLaunchPreviewFailed(true);
      } finally {
        if (!cancelled) setLaunchPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const goToLaunchSchedule = wrapRouterNavigate(
    'home',
    'launches_schedule',
    navigate,
    '/launches#launch-schedule'
  );

  const canonicalUrl = useMemo(() => `${siteOrigin()}/`, []);

  const homeJsonLd = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Launch Zone Charters | Space Coast boat rentals and rocket launch viewing',
      description:
        'Boat rentals, rocket launch viewing, and sandbar days across the Space Coast. Daytona Beach, Port Orange, Titusville, and the Indian River Lagoon.',
      url: canonicalUrl,
    }),
    [canonicalUrl]
  );

  return (
    <div className="min-h-screen bg-lz-bg">
      <Helmet prioritizeSeoTags>
        <title>Launch Zone Charters | Space Coast Boat Rentals &amp; Rocket Launch Viewing</title>
        <meta
          name="description"
          content="Space Coast boat rentals and on-water rocket launch viewing from Titusville, Daytona Beach, and Port Orange. Book pontoons and center consoles for Indian River Lagoon cruising, sandbar days, and disappearing island trips."
        />
        <meta
          name="keywords"
          content="Space Coast boat rentals, Titusville rocket launch viewing, Daytona Beach boat rentals, Port Orange sandbar rentals, Indian River Lagoon boat tours, disappearing island boat trips"
        />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content="Launch Zone Charters | Space Coast Boat Rentals &amp; Launch Viewing" />
        <meta
          property="og:description"
          content="Boat rentals, sandbar trips, and launch nights from the lagoon. Local crew, clear booking, real Space Coast water time."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={`${siteOrigin()}/og-image.png`} />
        <script type="application/ld+json">{JSON.stringify(homeJsonLd)}</script>
      </Helmet>

      <section className="relative isolate flex min-h-[700px] flex-col overflow-visible bg-lz-bg md:min-h-[70vh]">
        {/* Layered hero: bg + overlay (hover depth on .lz-hero-container) */}
        <div className="home-hero-bg lz-hero-container absolute inset-0 z-0 overflow-visible" aria-hidden>
          <div className="lz-hero-cinematic-wrap">
            <SmartImage
              src={HERO_IMAGE_SRC}
              alt={HERO_BG_ALT}
              width={1920}
              height={1080}
              sizes="100vw"
              priority
              className="lz-hero-bg lz-hero-cinematic-img block h-full w-full max-w-none"
            />
          </div>
          <div className="lz-hero-overlay" aria-hidden />
        </div>

        {/* Ease into content bands (same shell as below: #020617) */}
        <div className="pointer-events-none absolute inset-0 z-[1]" aria-hidden>
          <div className="absolute inset-x-0 bottom-0 h-[min(38vh,380px)] bg-gradient-to-t from-lz-bg via-lz-bg/55 to-transparent" />
        </div>

        <p className="pointer-events-none absolute bottom-3 left-4 z-20 max-w-[min(100%,520px)] text-left text-[10px] leading-snug text-white/45 sm:left-6 sm:max-w-none md:left-8 lg:left-10">
          Launch Zone Charters: Space Coast from the water
        </p>

        {/* z-20: brand mark top-center + copy lower-left */}
        <div className="lz-hero-content relative z-20 flex min-h-[700px] w-full flex-1 flex-col justify-between md:min-h-[70vh]">
          <div className="flex justify-center px-4 pb-5 pt-9 sm:pb-7 sm:pt-10">
            <div className="home-hero-brandmark-wrap home-hero-brandmark-wrap--top">
              <div className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-2xl border border-cyan-400/30 bg-black shadow-2xl">
                <video
                  ref={heroVideoRef}
                  className="w-full aspect-video object-cover"
                  src={HERO_CINEMATIC_VIDEO_SRC}
                  autoPlay
                  muted={heroVideoMuted}
                  loop
                  playsInline
                  preload="metadata"
                  onLoadStart={() => {
                    setHeroVideoError(false);
                  }}
                  onError={() => {
                    setHeroVideoError(true);
                  }}
                />
                {!heroVideoError && (
                  <button
                    type="button"
                    onClick={toggleHeroSound}
                    className="absolute bottom-3 right-3 z-10 flex items-center gap-2 rounded-lg border border-white/20 bg-black/70 px-3 py-2 text-sm font-medium text-white shadow-lg backdrop-blur-sm transition hover:bg-black/90 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 sm:bottom-4 sm:right-4"
                    aria-label={heroVideoMuted ? 'Unmute hero video' : 'Mute hero video'}
                  >
                    {heroVideoMuted ? (
                      <>
                        <Volume2 className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden />
                        Sound on
                      </>
                    ) : (
                      <>
                        <VolumeX className="h-4 w-4 shrink-0 text-cyan-200/90" aria-hidden />
                        Sound off
                      </>
                    )}
                  </button>
                )}
              </div>
              {heroVideoError && (
                <p className="mt-2 text-center text-sm text-amber-200/95">
                  Hero video failed to load. Check public/videos/launch-zone-action.mp4
                </p>
              )}
            </div>
          </div>
          <div className="lz-hero-fade lz-hero-fade--delay-2 mx-auto w-full max-w-[1200px] px-4 pb-20 pt-2 text-left sm:px-6 md:px-8 md:pb-24 md:pt-4 lg:px-10 lg:pb-28">
            <div className="w-full min-w-0">
              <div className="mb-8 flex flex-wrap items-center gap-2 md:mb-10 md:gap-2.5">
                <div className="lz-hero-badge">
                  <Shield className="h-3.5 w-3.5 shrink-0 text-cyan-300/90" aria-hidden />
                  <span className="font-semibold uppercase tracking-wider text-cyan-100/90">
                    <span aria-hidden="true" className="mr-1.5">
                      ✔
                    </span>
                    Licensed &amp; Insured
                  </span>
                </div>
                <div className="lz-hero-badge">
                  <Star className="h-3.5 w-3.5 shrink-0 fill-cyan-300 text-cyan-300" aria-hidden />
                  <span className="font-semibold uppercase tracking-wider text-cyan-100/90">
                    <span aria-hidden="true" className="mr-1.5">
                      ✔
                    </span>
                    5-Star Experience
                  </span>
                </div>
                <div className="lz-hero-badge">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-cyan-300/90" aria-hidden />
                  <span className="font-semibold uppercase tracking-wider text-cyan-100/90">
                    <span aria-hidden="true" className="mr-1.5">
                      ✔
                    </span>
                    Easy Booking
                  </span>
                </div>
              </div>
              <p className="mb-3 max-w-2xl text-sm font-medium uppercase tracking-[0.18em] text-cyan-200/85 md:text-base">
                Pontoon rentals · Rocket launch viewing · Sandbar days
              </p>
              <h1 className="mb-6 min-w-0">
                <span className="lz-hero-title-accent lz-hero-heading-line block">
                  Watch Rocket Launches
                </span>
                <span className="lz-hero-title-accent lz-hero-heading-subline lz-hero-heading-subline--paired mt-2.5 block md:mt-3">
                  From the Water
                </span>
              </h1>
              <p className="mb-4 text-base font-semibold uppercase tracking-[0.2em] text-cyan-100/90 md:text-lg">
                This is an experience you don&apos;t want to miss
              </p>
              <p className="mb-8 max-w-2xl text-lg leading-relaxed text-slate-100/95 md:text-xl">
                Plan your day on the water with clear options: Titusville launch-viewing nights on the lagoon,
                Daytona and Port Orange sandbar runs, and disappearing island friendly pontoon rentals. Licensed,
                insured, and upfront about weather, timing, and holds.
              </p>
              <div className="hero-buttons">
                <button
                  type="button"
                  onClick={wrapNavigateClick('home', 'book', onNavigate)}
                  className="lz-btn-primary w-full min-h-[48px] sm:w-auto"
                >
                  Book now
                </button>
                <button
                  type="button"
                  onClick={wrapNavigateClick('home', 'fleet-daytona', onNavigate)}
                  className="lz-btn-secondary lz-btn-secondary-hero w-full min-h-[48px] sm:w-auto"
                >
                  View rentals
                </button>
                <button
                  type="button"
                  onClick={goToLaunchSchedule}
                  className="lz-btn-secondary lz-btn-secondary-hero w-full min-h-[48px] sm:w-auto"
                >
                  See launch dates
                </button>
              </div>
              <p className="mt-4 text-sm text-cyan-100/90">
                Have a Groupon voucher?{' '}
                <Link
                  to="/booking/groupon"
                  className="font-semibold text-cyan-200 underline underline-offset-2"
                >
                  Book with Groupon
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="lz-home-section" aria-label="Quick facts">
        <div className="lz-home-inner">
          <div className="grid grid-cols-2 gap-4 text-center md:grid-cols-4 md:gap-6">
            <div className="lz-card-glass p-6">
              <div className="mb-2 text-4xl font-bold text-lz-cta">7</div>
              <div className="text-sm font-medium text-slate-300 md:text-base">Days a Week</div>
            </div>
            <div className="lz-card-glass p-6">
              <div className="mb-2 text-4xl font-bold text-lz-cta">Limited</div>
              <div className="text-sm font-medium text-slate-300 md:text-base">Boats Available</div>
            </div>
            <div className="lz-card-glass p-6">
              <div className="mb-2 text-4xl font-bold text-lz-cta">100%</div>
              <div className="text-sm font-medium text-slate-300 md:text-base">Licensed & Insured</div>
            </div>
            <div className="lz-card-glass p-6">
              <div className="mb-2 text-4xl font-bold text-lz-cta">24/7</div>
              <div className="text-sm font-medium text-slate-300 md:text-base">Online Booking</div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="experience-space"
        className="lz-home-section relative overflow-hidden"
        aria-labelledby="experience-space-heading"
      >
        <div className="relative z-10 lz-home-inner">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div className="order-2 lg:order-1">
              <h2
                id="experience-space-heading"
                className="font-display text-3xl font-bold uppercase leading-tight tracking-[0.1em] text-white shadow-lz-glow md:text-4xl lg:text-[2.35rem]"
              >
                Not Just a Boat Ride: A Front Row Seat to Space
              </h2>
              <p className="mt-6 text-lg leading-relaxed text-slate-300 md:text-xl">
                Feel the rumble across the water as history lifts off miles away. No stadium seats. No
                shoulder to shoulder crowds on the shore. Just you, the lagoon, and open sky. This is the
                Space Coast the way locals love to show it.
              </p>
              <div className="mt-8 space-y-4 md:mt-10">
                {launchPreviewLoading && (
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-cyan-400/90" aria-hidden />
                    <span>Loading verified Space Coast schedule…</span>
                  </div>
                )}
                {!launchPreviewLoading && nextLaunch && (
                  <div className="lz-card-glass max-w-lg border border-white/10 p-5 text-left shadow-[0_0_28px_rgba(0,0,0,0.25)]">
                    {(() => {
                      const previewWhen = nextLaunch.net || nextLaunch.window_start;
                      const previewStatus =
                        typeof nextLaunch.status === 'object'
                          ? nextLaunch.status?.name
                          : nextLaunch.status || '';
                      const confidence = getLaunchConfidence(previewWhen, previewStatus);
                      return (
                        <>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200/85">
                      Next launch
                    </p>
                    <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-400/35 bg-amber-950/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-100/95">
                      🔥 Recommended Booking Window
                    </p>
                    <p className="mt-2 text-lg font-semibold leading-snug text-white">
                      {nextLaunch.name || 'Upcoming mission'}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-slate-200/95">
                      Best Booking Window: {getBookingWindow(nextLaunch)}
                    </p>
                    <p className="mt-1 text-[11px] leading-snug text-slate-500">
                      Exact launch timing may change - this window reflects the best viewing experience.
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {formatBestViewingWindow(previewWhen, previewStatus)}
                    </p>
                    <LaunchCountdown
                      iso={previewWhen}
                      status={previewStatus}
                      confidence={confidence}
                      className="mt-2"
                    />
                    <p className="mt-2 text-[11px] text-slate-400">Confidence: {confidence}</p>
                    <p className="mt-3 text-[11px] leading-snug text-slate-500">
                      Kennedy / Cape Canaveral-area missions only · times from Launch Library 2 (public feed;
                      subject to change)
                    </p>
                        </>
                      );
                    })()}
                  </div>
                )}
                {!launchPreviewLoading && !nextLaunch && !launchPreviewFailed && (
                  <p className="max-w-lg text-sm leading-relaxed text-slate-400">
                    No verified Space Coast missions in the feed right now — see Rocket Launches for the
                    full curated list when it updates.
                  </p>
                )}
                {!launchPreviewLoading && launchPreviewFailed && (
                  <p className="max-w-lg text-sm leading-relaxed text-slate-400">
                    We couldn&apos;t load the preview — open Rocket Launches for the full schedule, local
                    weather, and an advisory.
                  </p>
                )}
                <div>
                  <button
                    type="button"
                    onClick={goToLaunchSchedule}
                    className="lz-btn-primary"
                    aria-label="View full rocket launch schedule and conditions"
                  >
                    See Rocket Launch Dates
                  </button>
                  <p className="mt-3 max-w-lg text-xs leading-snug text-slate-500">
                    Opens the same verified schedule as this site; add weather and an advisory on that page.
                  </p>
                </div>
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <div className="lz-card-glass relative overflow-hidden p-0">
                <div
                  className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-lz-bg/90 via-transparent to-lz-accent/5"
                  aria-hidden
                />
                <img
                  src={HERO_IMAGE_SRC}
                  alt="Boat on the water at night with a rocket launch on the horizon, Space Coast Florida"
                  width={1200}
                  height={800}
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  loading="lazy"
                  decoding="async"
                  className="aspect-[4/3] w-full object-cover object-center"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="lz-home-section" aria-labelledby="why-choose-heading">
        <div className="lz-home-inner">
          <div className="lz-home-section__head text-center">
            <h2
              id="why-choose-heading"
              className="mb-4 font-display text-3xl font-bold uppercase tracking-[0.1em] text-white md:text-4xl"
            >
              Why Choose Launch Zone Charters
            </h2>
            <p className="mx-auto max-w-3xl text-lg leading-relaxed text-slate-300 md:text-xl">
              Clear booking, boats kept for salt and sun, and a crew that knows Daytona to Titusville by heart.
              You get straight answers and time on the water that feels worth the drive.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3 md:gap-8">
            <div className="lz-card-glass p-8">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-lz border border-lz-accent/25 bg-lz-accent/10 backdrop-blur-sm">
                <Shield className="h-8 w-8 text-lz-accent" />
              </div>
              <h3 className="mb-4 text-xl font-bold uppercase tracking-wide text-white">Licensed &amp; Insured</h3>
              <p className="leading-relaxed text-slate-300">
                Fully licensed and commercially insured for your peace of mind. Our captains are USCG certified with
                years of experience.
              </p>
            </div>

            <div className="lz-card-glass p-8">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-lz border border-lz-accent/25 bg-lz-accent/10 backdrop-blur-sm">
                <Star className="h-8 w-8 text-lz-accent" />
              </div>
              <h3 className="mb-4 text-xl font-bold uppercase tracking-wide text-white">Premium Boat Rentals</h3>
              <p className="leading-relaxed text-slate-300">
                Modern, well-maintained pontoon boats with all amenities. Choose from standard or premium options to
                match your needs.
              </p>
            </div>

            <div className="lz-card-glass p-8">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-lz border border-lz-accent/25 bg-lz-accent/10 backdrop-blur-sm">
                <Award className="h-8 w-8 text-lz-accent" />
              </div>
              <h3 className="mb-4 text-xl font-bold uppercase tracking-wide text-white">Rocket Launch Tours</h3>
              <p className="leading-relaxed text-slate-300">
                Exclusive front-row seats to SpaceX and NASA launches from the water. Experience the power of space
                exploration up close.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="sandbar-boat-rentals"
        className="lz-home-section border-t border-cyan-500/10"
        aria-labelledby="sandbar-heading"
      >
        <div className="lz-home-inner">
          <div className="lz-home-section__head text-center">
            <h2
              id="sandbar-heading"
              className="mb-4 font-display text-3xl font-bold uppercase tracking-[0.08em] text-white md:text-4xl"
            >
                Sandbar rentals from Port Orange and Daytona Beach
            </h2>
            <p className="mx-auto max-w-3xl text-lg leading-relaxed text-slate-300 md:text-xl">
                Want a true sandbar day? A pontoon keeps it simple. Many crews launch from Port Orange or Daytona
                Beach for a disappearing island run, then cruise back before sunset.
            </p>
          </div>
          <div className="mx-auto mt-10 grid max-w-5xl gap-8 md:grid-cols-2 md:gap-10">
            <div className="lz-card-glass p-8 text-left">
              <h3 className="text-xl font-bold uppercase tracking-wide text-white">Family sandbar day trips</h3>
              <p className="mt-4 leading-relaxed text-slate-300">
                Pack the cooler and keep it simple. We point you toward routes that match your comfort on the
                water, including calmer stretches toward New Smyrna Beach and Ponce Inlet when you want a longer
                coastal run. Booking takes minutes, and pick-up details are confirmed so you are not guessing at the
                ramp.
              </p>
            </div>
            <div className="lz-card-glass p-8 text-left">
              <h3 className="text-xl font-bold uppercase tracking-wide text-white">Daytona Beach sandbar boat rentals</h3>
              <p className="mt-4 leading-relaxed text-slate-300">
                If you searched for sandbar boat rentals Daytona Beach or a Port Orange sandbar boat day, you are
                in the right place. We focus on sandbar friendly setups, easy orientation, and local knowledge so
                your group spends less time figuring logistics and more time in the water.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={wrapNavigateClick('home', 'fleet-daytona', onNavigate)}
                  className="lz-btn-primary justify-center"
                >
                  Daytona rentals
                </button>
                <button
                  type="button"
                  onClick={wrapNavigateClick('home', 'fleet-titusville', onNavigate)}
                  className="lz-btn-secondary justify-center"
                >
                  Titusville lagoon rentals
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        className="lz-home-section border-t border-cyan-500/10 py-10 md:py-12"
        aria-label="Featured product"
      >
        <div className="lz-home-inner max-w-4xl">
          <ObservationBottlePromo variant="featured" />
        </div>
      </section>

      <section className="lz-home-section text-white" aria-labelledby="service-areas-heading">
        <div className="lz-home-inner">
          <div className="grid items-center gap-8 md:grid-cols-2 md:gap-10 lg:gap-12">
            <div className="lz-card-glass p-8">
              <h2
                id="service-areas-heading"
                className="mb-6 font-display text-3xl font-bold uppercase tracking-[0.08em] text-white md:text-4xl"
              >
                Service Areas
              </h2>
              <p className="mb-8 text-xl leading-relaxed text-slate-300">
                We proudly serve Florida&apos;s Space Coast with pickup plans that match the trip you booked. Same
                crew for sandbar afternoons and launch nights when the window cooperates.
              </p>
              <ul className="space-y-4">
                <li className="flex items-center gap-3">
                  <Anchor className="h-6 w-6 shrink-0 text-lz-cta" aria-hidden />
                  <span className="text-lg text-slate-200">Port Orange, FL</span>
                </li>
                <li className="flex items-center gap-3">
                  <Anchor className="h-6 w-6 shrink-0 text-lz-cta" aria-hidden />
                  <span className="text-lg text-slate-200">Daytona Beach, FL</span>
                </li>
                <li className="flex items-center gap-3">
                  <Anchor className="h-6 w-6 shrink-0 text-lz-cta" aria-hidden />
                  <span className="text-lg text-slate-200">Titusville, FL</span>
                </li>
                <li className="flex items-center gap-3">
                  <Anchor className="h-6 w-6 shrink-0 text-lz-cta" aria-hidden />
                  <span className="text-lg text-slate-200">Orlando, FL</span>
                </li>
              </ul>
            </div>
            <div className="lz-card-glass p-8">
              <h3 className="mb-6 text-xl font-bold uppercase tracking-wide text-white">Operating Hours</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <span className="text-slate-300">Every Day</span>
                  <span className="font-semibold text-white">Sunrise to Sunset</span>
                </div>
                <div className="flex items-center space-x-3 text-lz-cta">
                  <Clock className="h-5 w-5 shrink-0" />
                  <span>Night tours available with advance reservation</span>
                </div>
                <div className="flex items-center space-x-3 text-lz-cta">
                  <Calendar className="h-5 w-5 shrink-0" />
                  <span>24-hour advance booking preferred</span>
                </div>
                <div className="flex items-center space-x-3 text-lz-cta">
                  <Calendar className="h-5 w-5 shrink-0" />
                  <span>Same-day bookings accepted if available</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="lz-home-section text-white" aria-labelledby="cta-heading">
        <div className="lz-home-inner">
          <div className="lz-card-glass mx-auto max-w-4xl px-6 py-10 text-center sm:px-10 md:px-12 md:py-14">
            <h2
              id="cta-heading"
              className="mb-6 font-display text-3xl font-bold uppercase tracking-[0.12em] text-white md:text-4xl lg:text-5xl"
            >
              Ready for Your Adventure?
            </h2>
            <p className="mb-8 text-base font-semibold uppercase leading-relaxed tracking-widest text-slate-200 md:text-lg">
              Pick a date, choose a boat, and get confirmation you can trust. Questions first? Call and we will
              walk you through ramps, timing, and what to bring.
            </p>
            <div className="flex flex-col justify-center gap-4 sm:flex-row sm:items-center sm:justify-center">
              <button type="button" onClick={wrapNavigateClick('home', 'book', onNavigate)} className="lz-btn-primary">
                Book now
              </button>
              <button
                type="button"
                onClick={wrapNavigateClick('home', 'fleet-daytona', onNavigate)}
                className="lz-btn-secondary"
              >
                View rentals
              </button>
              <a href="tel:803-542-1761" className="lz-btn-secondary">
                Call 803-542-1761
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
