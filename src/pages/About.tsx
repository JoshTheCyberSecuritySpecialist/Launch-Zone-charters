import { useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { Shield, Award, Users, Heart } from 'lucide-react';
import SmartImage from '../components/ui/SmartImage';

interface AboutProps {
  onNavigate: (page: string) => void;
}

const DEFAULT_SITE_ORIGIN = 'https://launchzonecharters.com';

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

/** Repo asset is PNG; filename is keyword-rich for SEO */
const ABOUT_HERO_IMAGE =
  '/images/launch-zone-charters-titusville-boat-rentals-rocket-launch-view-indian-river-lagoon-florida.png';
const ABOUT_HERO_ALT =
  'Titusville boat rentals and rocket launch viewing on the Indian River Lagoon, Space Coast Florida. Launch Zone Charters.';

/**
 * Secondary feature image for the Our story column only (not the top full-bleed hero).
 * Full scene: Falcon 9 launch viewing from a pontoon on the Space Coast.
 */
const ABOUT_STORY_FEATURE_IMAGE =
  '/images/titusville-florida-rocket-launch-boat-tour-space-coast-pontoon-rental-falcon-9-viewing-launch-zone-charters-hero-image2.jpg';
const ABOUT_STORY_FEATURE_ALT =
  'Falcon 9 rocket launch viewing from a Space Coast pontoon rental on the water, Launch Zone Charters Titusville Florida';

export default function About({ onNavigate }: AboutProps) {
  const canonicalUrl = useMemo(() => `${siteOrigin()}/about`, []);

  const jsonLd = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@type': 'AboutPage',
      name: 'About Launch Zone Charters',
      description:
        'Space Coast boat rentals and rocket launch viewing from the water near Titusville and the Indian River Lagoon. Licensed, insured, local crew.',
      url: canonicalUrl,
      mainEntity: {
        '@type': 'LocalBusiness',
        name: 'Launch Zone Charters',
        description:
          'Titusville and Space Coast boat rentals, rocket launch viewing on the lagoon, and Indian River Lagoon trips. Book online or call.',
        areaServed: {
          '@type': 'State',
          name: 'Florida',
        },
      },
    }),
    [canonicalUrl]
  );

  return (
    <div className="about-page min-h-screen bg-[#020617] text-slate-200">
      <Helmet prioritizeSeoTags>
        <title>About Launch Zone Charters | Titusville Boat Rentals &amp; Rocket Launch Viewing</title>
        <meta
          name="description"
          content="Launch Zone Charters is a Space Coast crew offering Titusville and Daytona area boat rentals, rocket launch viewing from the water, Indian River Lagoon trips, and sandbar friendly days when you want shallow water and room to breathe. Licensed and insured."
        />
        <meta
          name="keywords"
          content="boat rentals Titusville, rocket launch viewing Florida, Indian River Lagoon boat tours, Space Coast charters, sandbar boat rentals Port Orange, Daytona Beach boat rentals, Launch Zone Charters"
        />
        <link rel="canonical" href={canonicalUrl} />
        <link rel="preload" as="image" href={ABOUT_HERO_IMAGE} />
        <meta property="og:title" content="About Launch Zone Charters | Space Coast Boat Rentals" />
        <meta
          property="og:description"
          content="Boat rentals and launch nights on the Indian River Lagoon without the shoulder to shoulder shoreline scene. Licensed, insured, local team."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={`${siteOrigin()}${ABOUT_HERO_IMAGE}`} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      {/* Full-bleed image only. Copy lives in the section below. */}
      <section
        className="about-page-hero"
        aria-label="About Launch Zone Charters. Titusville boat rentals and Indian River Lagoon"
      >
        <div className="about-page-hero__media">
          <SmartImage
            src={ABOUT_HERO_IMAGE}
            alt={ABOUT_HERO_ALT}
            priority
            sizes="100vw"
            className="about-page-hero__img"
          />
        </div>
        <div className="about-page-hero__overlay" aria-hidden />
        <div className="about-page-hero__kicker">
          <span className="about-page-hero__kicker-label">About us</span>
        </div>
      </section>

      <section
        className="border-t border-cyan-500/15 bg-gradient-to-b from-[#08121c] via-[#020617] to-[#020617] px-4 py-16 sm:px-6 sm:py-20 lg:px-8"
        aria-labelledby="about-hero-heading"
      >
        <div className="mx-auto max-w-5xl text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/90">
            Space Coast · Titusville · Indian River Lagoon
          </p>
          <h1
            id="about-hero-heading"
            className="lz-page-hero-heading mt-5 max-w-4xl font-display font-bold tracking-tight text-white"
          >
            About Launch Zone Charters
          </h1>
          <p className="mt-6 max-w-3xl text-pretty text-lg leading-[1.65] text-slate-300 md:text-xl">
            We run boat rentals and on-the-water nights around{' '}
            <span className="text-slate-100">Titusville</span> and the{' '}
            <span className="text-slate-100">Indian River Lagoon</span>, including launch windows when
            the schedule lines up. We also serve guests staging from{' '}
            <span className="text-slate-100">Port Orange</span> and{' '}
            <span className="text-slate-100">Daytona Beach</span> for Intracoastal sandbar days. The pitch
            is simple: feel the rumble on the water, not from a packed lot near the causeway. You get a
            maintained fleet, clear expectations about weather and holds, and a crew that treats this
            stretch of Florida like home because it is.
          </p>
          <div className="mt-10 flex w-full max-w-xl flex-col flex-wrap gap-3 sm:max-w-none sm:flex-row sm:items-stretch sm:gap-4">
            <button
              type="button"
              onClick={() => onNavigate('book')}
              className="lz-btn-primary relative z-[2] w-full shrink-0 justify-center shadow-[0_4px_20px_rgba(0,0,0,0.35),0_0_24px_rgba(255,140,43,0.35)] sm:w-auto sm:min-w-[200px]"
            >
              Book now
            </button>
            <button
              type="button"
              onClick={() => onNavigate('fleet-daytona')}
              className="lz-btn-secondary w-full sm:w-auto sm:min-w-[200px]"
            >
              View rentals
            </button>
            <button
              type="button"
              onClick={() => onNavigate('launches')}
              className="lz-btn-secondary w-full sm:w-auto sm:min-w-[200px]"
            >
              Check availability
            </button>
          </div>
        </div>
      </section>

      <section
        className="about-story-section lz-home-section border-t border-cyan-500/15"
        aria-labelledby="our-story-heading"
      >
        <div className="lz-home-inner">
          <div className="grid items-center gap-10 md:grid-cols-2 md:items-start md:gap-12 lg:gap-14">
            <div>
              <h2 id="our-story-heading" className="text-3xl font-bold text-white md:text-4xl">
                Why we&apos;re here
              </h2>
              <div className="mt-6 space-y-5 text-lg leading-relaxed text-slate-300">
                <p>
                  Most visitors never see the Space Coast from the lagoon, and that&apos;s the whole point.
                  A slow evening on glassy water is its own reward. When a launch lines up,{' '}
                  <strong className="font-semibold text-slate-100">rocket launch viewing from the water</strong>{' '}
                  beats fighting for curb space. Open sky, the sound rolling across the river, and room for
                  your crew to actually enjoy it.
                </p>
                <p>
                  We&apos;re set up for{' '}
                  <strong className="font-semibold text-slate-100">Titusville boat rentals</strong> and
                  trips on the <strong className="font-semibold text-slate-100">Indian River Lagoon</strong>.
                  Family days, date nights, photographers, and anyone who wants salt air without the
                  guesswork. Pick-up details and ramps are confirmed when you book. We&apos;re upfront when
                  weather or a scrub changes the plan.
                </p>
                <p>
                  Licensed, insured, and serious about the briefing before you leave the dock. No inflated
                  promises. Just boats kept for real saltwater use and a team that wants you off the water
                  with a story worth retelling.
                </p>
              </div>
            </div>
            <div className="about-story-feature relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-cyan-400/15 bg-[#030712] shadow-[0_0_40px_rgba(0,207,255,0.12)] md:aspect-[5/3] lg:aspect-[3/2]">
              <SmartImage
                src={ABOUT_STORY_FEATURE_IMAGE}
                alt={ABOUT_STORY_FEATURE_ALT}
                width={1600}
                height={900}
                sizes="(min-width: 1024px) 560px, (min-width: 768px) 45vw, 100vw"
                className="pointer-events-none select-none"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="lz-home-section" aria-labelledby="trust-pillars-heading">
        <div className="lz-home-inner">
          <div className="mb-10 max-w-2xl">
            <h2 id="trust-pillars-heading" className="text-3xl font-bold text-white md:text-4xl">
              What you can count on
            </h2>
            <p className="mt-3 text-base leading-relaxed text-slate-400 md:text-lg">
              The stuff that actually matters when you&apos;re putting family or friends on the water.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                Icon: Shield,
                title: 'Licensed & insured',
                body: 'Commercial marine coverage and operations run the way regulators expect. No shortcuts.',
              },
              {
                Icon: Award,
                title: 'USCG-certified captains',
                body: 'Add a captain when you want a pro on the throttles and local water in your corner.',
              },
              {
                Icon: Users,
                title: 'Family-owned',
                body: 'Space Coast people, not a call center. Straight talk about ramps, timing, and tides.',
              },
              {
                Icon: Heart,
                title: 'Clear before you cast off',
                body: 'Safety and expectations covered before lines come off the dock. Every trip.',
              },
            ].map(({ Icon, title, body }) => (
              <div key={title} className="lz-card-glass p-7 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-cyan-400/25 bg-cyan-500/10">
                  <Icon className="h-7 w-7 text-cyan-300" aria-hidden />
                </div>
                <h3 className="text-lg font-bold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        className="lz-home-section border-t border-cyan-500/15 bg-[#050a14]/80"
        aria-labelledby="what-sets-apart-heading"
      >
        <div className="lz-home-inner">
          <h2
            id="what-sets-apart-heading"
            className="text-center text-3xl font-bold text-white md:text-4xl"
          >
            Built for real days on the water
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-base leading-relaxed text-slate-400 md:text-lg">
            From sunset cruises to launch nights near Kennedy Space Center, we plan around how this coast
            actually behaves. Not a brochure fantasy.
          </p>
          <div className="mt-10 grid gap-8 md:grid-cols-2">
            <div className="rounded-2xl border border-cyan-400/15 bg-slate-950/50 p-8 backdrop-blur-sm">
              <h3 className="text-lg font-bold uppercase tracking-wider text-cyan-300">Boats meant to be used</h3>
              <p className="mt-3 leading-relaxed text-slate-300">
                Pontoons and center consoles kept for salt, sun, and real passengers. Not just a static
                marina photo. You step aboard knowing the vessel is maintained for the kind of day you
                booked.
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-400/15 bg-slate-950/50 p-8 backdrop-blur-sm">
              <h3 className="text-lg font-bold uppercase tracking-wider text-cyan-300">Local water, local angles</h3>
              <p className="mt-3 leading-relaxed text-slate-300">
                Titusville and the lagoon reward patience: where the horizon opens up, how traffic moves on
                launch days, and when it makes sense to adjust. We help you align time on the water with
                what you came to see.
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-400/15 bg-slate-950/50 p-8 backdrop-blur-sm">
              <h3 className="text-lg font-bold uppercase tracking-wider text-cyan-300">Plans that flex</h3>
              <p className="mt-3 leading-relaxed text-slate-300">
                Hourly to full-day options, add a captain if you want the helm off your plate, and honest
                answers when weather or a slip in the countdown changes the night. Your Indian River Lagoon
                time should fit the crew. Not the other way around.
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-400/15 bg-slate-950/50 p-8 backdrop-blur-sm">
              <h3 className="text-lg font-bold uppercase tracking-wider text-cyan-300">Launch nights, honestly</h3>
              <p className="mt-3 leading-relaxed text-slate-300">
                Rocket launch viewing in Florida is unforgettable when it works. It can be unpredictable when
                it doesn&apos;t. We track windows, communicate when things shift, and keep expectations
                grounded so you still get a night on the water you&apos;re glad you booked.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="lz-home-section" aria-labelledby="safety-heading">
        <div className="lz-home-inner">
          <div className="mb-12 text-center">
            <h2 id="safety-heading" className="text-3xl font-bold text-white md:text-4xl">
              Safety first, every departure
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-400">
              No trip is worth cutting corners. We run briefings and equipment checks like our name is on
              the transom. Because it is.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <div className="text-center">
              <div className="text-5xl font-bold text-lz-cta">100%</div>
              <div className="mt-1 font-semibold text-slate-200">Standards met</div>
              <p className="mt-2 text-sm text-slate-500">
                Gear and vessels aligned with USCG requirements for how we operate.
              </p>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold text-lz-cta">24/7</div>
              <div className="mt-1 font-semibold text-slate-200">Reachable when it counts</div>
              <p className="mt-2 text-sm text-slate-500">
                Emergency and trip contact paths included with your confirmation, so you&apos;re never
                guessing who to call.
              </p>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold text-lz-cta">Pre-trip</div>
              <div className="mt-1 font-semibold text-slate-200">Briefing every time</div>
              <p className="mt-2 text-sm text-slate-500">
                Expectations, boundaries, and safety gear. Covered before lines come off the cleat.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-cyan-500/15 bg-[#020617] px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Pick a night on the lagoon
          </h2>
          <p className="mt-3 text-base text-slate-400 sm:text-lg">
            Lock in a Titusville rental, ask about a launch window, or tell us what kind of crew
            you&apos;re bringing. We&apos;ll help you choose a trip that fits.
          </p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:gap-4">
            <button type="button" onClick={() => onNavigate('book')} className="lz-btn-primary px-8 py-3">
              Book now
            </button>
            <button
              type="button"
              onClick={() => onNavigate('launches')}
              className="lz-btn-secondary px-8 py-3"
            >
              Check availability
            </button>
            <button
              type="button"
              onClick={() => onNavigate('contact')}
              className="lz-btn-secondary px-8 py-3"
            >
              Ask a question
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
