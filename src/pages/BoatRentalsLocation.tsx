import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { wrapNavigateClick, wrapSyncClick } from '../lib/clickPerf';
import { Helmet } from 'react-helmet-async';
import type { LucideIcon } from 'lucide-react';
import { Anchor, MapPin, Phone, ShieldCheck, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logSupabaseError } from '../lib/supabaseErrors';
import { getBoatPlaceholderImage } from '../lib/boatPlaceholders';
import FullPageLoader from '../components/FullPageLoader';
import SafeImage from '../components/SafeImage';
import SmartImage from '../components/ui/SmartImage';

export type BoatRentalsLocationVariant = 'daytona' | 'titusville';

interface BoatRentalsLocationProps {
  onNavigate: (page: string) => void;
  variant: BoatRentalsLocationVariant;
}

interface Boat {
  id: string;
  name: string;
  type: 'standard' | 'premium';
  capacity: number;
  description: string | null;
  image_url: string | null;
  hourly_rate: number;
  half_day_rate: number;
  full_day_rate: number;
  is_active: boolean;
}

const DEFAULT_SITE_ORIGIN = 'https://launchzonecharters.com';

/** Matches Marine Conditions / Bioluminescent hero legibility */
const HERO_LINE_SHADOW = '0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,207,255,0.28)';
const HERO_SUB_SHADOW = '0 1px 8px rgba(0,0,0,0.65), 0 0 1px rgba(0,0,0,0.9)';

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

type ExperienceCard = {
  icon: string;
  title: string;
  body: string;
};

type SeoBlock = { id: string; title: string; paragraphs: string[] };
type CharterExperience = {
  id: 'rocket' | 'bio' | 'sunset';
  icon: string;
  title: string;
  description: string;
  bullets: string[];
  priceLabel: string;
  priceSub: string;
  cta: string;
};

type LocationCopy = {
  path: string;
  pageTitle: string;
  ogTitle: string;
  metaDescription: string;
  metaKeywords: string;
  heroImage: string;
  heroImageAlt: string;
  eyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  heroTrustLine: string;
  boatImageAltSuffix: string;
  introTitle: string;
  introParagraphs: string[];
  introBadges: { label: string; Icon: LucideIcon }[];
  fleetSectionTitle: string;
  fleetSectionSub: string;
  experienceHeading: string;
  experienceCards: ExperienceCard[];
  finalCtaTitle: string;
  finalCtaSub: string;
  seoSectionTitle: string;
  seoBlocks: SeoBlock[];
};

const COPY: Record<BoatRentalsLocationVariant, LocationCopy> = {
  daytona: {
    path: '/boat-rentals/daytona',
    pageTitle: 'Daytona Beach Boat Rentals | Sandbar Days & Pontoon Charters | Launch Zone Charters',
    ogTitle: 'Daytona Beach Boat Rentals | Port Orange & New Smyrna Sandbar Trips | Launch Zone Charters',
    metaDescription:
      'Daytona Beach boat rentals and sandbar friendly pontoon charters along the Intracoastal Waterway and toward New Smyrna Beach. Family sandbar day trips, disappearing island style hangs, sunset runs, and launch views when timing lines up. Licensed and insured. Book online or call 803-542-1761.',
    metaKeywords:
      'sandbar boat rentals Daytona Beach, sandbar boat rentals Port Orange, Daytona Beach boat rental, New Smyrna Beach pontoon rental, Ponce Inlet boat rental, disappearing island boat day, Intracoastal Waterway charter, Space Coast boat rental',
    heroImage: '/images/daytona-beach-boat-rentals-pontoon-center-console-launch-zone-charters-hero.jpeg',
    heroImageAlt:
      'Launch Zone Charters pontoon and center-console rental boats on the water near Daytona Beach Florida',
    eyebrow: 'Intracoastal · New Smyrna · Ponce Inlet',
    heroTitle: 'Daytona Beach boat rentals',
    heroSubtitle:
      'Half-day, full-day, and sunset runs on pontoons and center consoles. Sandbar days, Intracoastal cruising, and launch windows when the schedule cooperates. Pick-up details are confirmed when you book.',
    heroTrustLine: 'Licensed & insured · Local fleet · Same-day when available',
    boatImageAltSuffix: 'pontoon boat rental Daytona Beach New Smyrna Ponce Inlet Intracoastal',
    introTitle: 'Plan your day from Daytona Beach to Ponce Inlet',
    introParagraphs: [
      'Our fleet is built for real Space Coast days: wide, stable pontoons with room for coolers, kids, and camera gear. Cruise the Intracoastal, spend a relaxing day on the water with friends and family at a shallow sandbar, or time a run when a launch window lines up.',
      'Pick-up details and ramp locations are confirmed at booking. We serve guests across Daytona Beach, Port Orange, New Smyrna Beach, and nearby ramps toward Ponce Inlet depending on availability.',
    ],
    introBadges: [
      { label: 'Intracoastal & inlet cruising', Icon: Anchor },
      { label: 'New Smyrna & Ponce Inlet access', Icon: MapPin },
      { label: 'Launch-day & sunset trips', Icon: Sparkles },
    ],
    fleetSectionTitle: 'Choose your pontoon',
    fleetSectionSub: 'Rates shown are starting points; final pricing is confirmed when you book.',
    experienceHeading: 'Popular ways to use your rental',
    experienceCards: [
      {
        icon: '🚀',
        title: 'Rocket launches from the water',
        body: 'Feel the rumble with a clear view of Space Coast launches—away from the shore crowds.',
      },
      {
        icon: '🌅',
        title: 'Sunset & Intracoastal cruises',
        body: 'Golden-hour runs from Daytona Beach toward New Smyrna and Ponce Inlet—perfect for photos.',
      },
      {
        icon: '🎣',
        title: 'Fishing & inshore days',
        body: 'Saltwater-friendly pontoons for inshore trips along the Intracoastal and nearby flats.',
      },
      {
        icon: '🌊',
        title: 'Sandbars & disappearing island days',
        body:
          'Anchor near shallow hangout spots from Ponce Inlet north toward New Smyrna. Popular for family sandbar day trips and easy swimming in knee-deep water.',
      },
    ],
    finalCtaTitle: 'Ready to reserve?',
    finalCtaSub: 'Book online in minutes, or call for same-day availability and launch-day timing.',
    seoSectionTitle: 'Daytona Beach & Intracoastal boat rental guide',
    seoBlocks: [
      {
        id: 'sandbar',
        title: 'Sandbar boat rentals in Port Orange and Daytona Beach',
        paragraphs: [
          'Guests often ask about a Port Orange sandbar boat day or Daytona Beach sandbar boat rentals when they want waist-deep water, a packed cooler, and nowhere to be in a hurry. A pontoon gives you room to spread out, shade for the kids, and a stable platform while you float.',
          'Routes and timing depend on tide, wind, and how busy the channel is. Tell us your comfort level when you book and we will suggest a plan that fits, including Intracoastal stretches that line up with a disappearing island style afternoon.',
        ],
      },
      {
        id: 'intracoastal',
        title: 'Intracoastal Waterway & Ponce Inlet',
        paragraphs: [
          'A pontoon rental is one of the easiest ways to experience the Halifax River and the wider Intracoastal corridor—calm water, predictable depths in many areas, and plenty of room for groups. Heading toward Ponce Inlet adds variety: inlet breeze, channel traffic, and iconic Florida coastal views.',
          'If you are new to the area, tell us how comfortable your crew is with boat handling—we will recommend routes and timing that match your experience level.',
        ],
      },
      {
        id: 'new-smyrna',
        title: 'New Smyrna Beach & Daytona staging',
        paragraphs: [
          'Many guests stage from Port Orange or Daytona Beach to maximize time on the water. New Smyrna Beach visitors often combine a half-day rental with beach time; we can help you understand run times so you are not rushing back at sunset.',
          'We are licensed and insured, with safety gear and orientation covered before you leave the dock.',
        ],
      },
      {
        id: 'launches',
        title: 'Rocket launch viewing from the water',
        paragraphs: [
          'Launch viewing is weather- and schedule-dependent: scrubs and delays happen. When timing aligns, viewing from the water can be unforgettable—bring layers, charge batteries, and plan a flexible return window.',
          'Ask when you book about launch windows and how we handle weather holds.',
        ],
      },
    ],
  },
  titusville: {
    path: '/boat-rentals/titusville',
    pageTitle: 'Titusville Boat Rentals | Indian River Lagoon & Launch Viewing | Launch Zone Charters',
    ogTitle: 'Titusville Boat Rentals | Indian River Lagoon Tours | Launch Zone Charters',
    metaDescription:
      'Titusville boat rentals on the Indian River Lagoon: pontoon charters, rocket launch viewing from the water, wildlife runs, shallow coves, and Space Coast days you can feel from the deck. Licensed and insured. Book online or call 803-542-1761.',
    metaKeywords:
      'Titusville boat rentals, Indian River Lagoon boat tours, rocket launch viewing Florida, Indian River Lagoon pontoon rental, rocket launch boat viewing, Max Brewer Bridge boat rental, Space Coast charters, Cape Canaveral launch viewing boat',
    heroImage:
      '/images/bioluminescent-boat-tour-titusville-florida-indian-river-lagoon-night-glowing-water-launch-zone-charters-pontoon-center-console.png',
    heroImageAlt:
      'Bioluminescent night boating scene in Titusville on the Indian River Lagoon with Launch Zone Charters vessels',
    eyebrow: 'Titusville · Indian River Lagoon',
    heroTitle: 'Titusville boat rentals',
    heroSubtitle:
      'Pontoon and center-console rentals for lagoon cruising, launch nights, and seasonal glow-water adventures.',
    heroTrustLine: 'Licensed & insured · Local lagoon routes · Launch-night ready',
    boatImageAltSuffix: 'pontoon boat rental Titusville Indian River Lagoon Space Coast',
    introTitle: 'Explore Titusville from the Indian River Lagoon',
    introParagraphs: [
      'Titusville sits on one of Florida’s most scenic brackish waterways. Our pontoons are ideal for wide-open lagoon runs, dolphin and manatee sightings, and positioning for Cape Canaveral launches when schedules cooperate.',
      'Pair daytime cruising with our other experiences. Many guests combine rentals with bioluminescence season or rocket-focused evenings. Pick-up details are confirmed when you book.',
    ],
    introBadges: [
      { label: 'Indian River Lagoon routes', Icon: Anchor },
      { label: 'Launch viewing positioning', Icon: Sparkles },
      { label: 'Max Brewer & waterfront sights', Icon: MapPin },
    ],
    fleetSectionTitle: 'Choose your pontoon',
    fleetSectionSub: 'Rates shown are starting points; final pricing is confirmed when you book.',
    experienceHeading: 'Popular ways to use your rental',
    experienceCards: [
      {
        icon: '🚀',
        title: 'Rocket launch viewing',
        body: 'Line up on the Indian River Lagoon for Cape Canaveral launches—feel the rumble from the water.',
      },
      {
        icon: '🌊',
        title: 'Indian River Lagoon',
        body: 'Calm, scenic runs with dolphins, manatees, and wide-open views along the Space Coast.',
      },
      {
        icon: '🌌',
        title: 'Night & bioluminescence season',
        body: 'Plan around clear nights when the lagoon glows—pair with our bioluminescence tour options.',
      },
      {
        icon: '📍',
        title: 'Space Coast landmarks',
        body: 'Cruise near Max Brewer Bridge and iconic Titusville waterfront sights with local guidance.',
      },
    ],
    finalCtaTitle: 'Ready to reserve?',
    finalCtaSub: 'Book online in minutes, or call for lagoon conditions and launch-day timing.',
    seoSectionTitle: 'Titusville & Indian River Lagoon rental guide',
    seoBlocks: [
      {
        id: 'lagoon',
        title: 'Indian River Lagoon boating',
        paragraphs: [
          'The lagoon offers protected water and long sightlines. That makes it a strong fit for first-time renters who want a stable platform and room to move around. Wildlife encounters are common. We recommend respectful distances and slow passes near manatees.',
          'Weather and wind still matter. We monitor conditions and may reschedule for safety.',
        ],
      },
      {
        id: 'sandbar-shallow',
        title: 'Shallow water hangs and quiet coves',
        paragraphs: [
          'If your group wants a mellow sandbar style afternoon without fighting beach traffic, ask about calmer stretches and shallow coves suited to your boat and tide window. We still treat every trip with safety first: life jackets, briefing, and realistic timing so you are not racing sunset.',
          'For Intracoastal sandbar trips closer to Port Orange or Daytona Beach, our Daytona fleet page covers those routes in more detail.',
        ],
      },
      {
        id: 'launches',
        title: 'Rocket launches from the water',
        paragraphs: [
          'Launch viewing is never guaranteed—scrubs, slips, and weather can change plans. When it comes together, the lagoon can deliver an incredible perspective with reflection, sound, and open horizon.',
          'Ask about timing windows and how we handle delays when you book.',
        ],
      },
      {
        id: 'night',
        title: 'Nights, bio season, and add-ons',
        paragraphs: [
          'Clear nights can make the lagoon unforgettable—especially during bioluminescence season. If you want a captain-led glow-focused trip, explore our dedicated bioluminescence experience and ask how it pairs with a daytime rental.',
          'Night operation may require approval and can carry different rules; we will confirm what applies to your date.',
        ],
      },
    ],
  },
};

const CHARTER_EXPERIENCES: CharterExperience[] = [
  {
    id: 'rocket',
    icon: '🚀',
    title: 'Rocket Launch Charter',
    description: 'Watch a SpaceX or NASA launch from the water.',
    bullets: ['Private experience', 'Captain included', 'Fuel included'],
    priceLabel: 'Starting rates available',
    priceSub: 'Final price shown before checkout',
    cta: 'Book Charter',
  },
  {
    id: 'bio',
    icon: '🌌',
    title: 'Bioluminescence Tour',
    description: 'Experience glowing waters in the Indian River Lagoon.',
    bullets: ['Private experience', 'Calm guided tour'],
    priceLabel: 'Private and shared options available',
    priceSub: 'Final price shown before checkout',
    cta: 'Book Tour',
  },
  {
    id: 'sunset',
    icon: '🌅',
    title: 'Sunset Cruise',
    description: 'Relax and enjoy scenic views on the Space Coast.',
    bullets: ['Private experience', 'Perfect for groups'],
    priceLabel: 'Starting rates available',
    priceSub: 'Final price shown before checkout',
    cta: 'Book Cruise',
  },
];

/** Shared headline + CTAs; Daytona renders this below the image hero; Titusville keeps copy inside the hero. */
function BoatRentalsHeroContent({
  variant,
  copy,
  onNavigate,
  onScrollToFleet,
}: {
  variant: BoatRentalsLocationVariant;
  copy: LocationCopy;
  onNavigate: (page: string) => void;
  onScrollToFleet: () => void;
}) {
  const prefix = `boat_rentals_${variant}`;
  const rentalBookPageKey = variant === 'daytona' ? 'book-rental-daytona' : 'book-rental-titusville';
  const isDaytona = variant === 'daytona';
  return (
    <>
      <p
        className={`lz-hero-fade lz-hero-fade--delay-1 max-w-xl text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/95${
          isDaytona ? '' : ' mx-auto text-center'
        }`}
        style={{ textShadow: HERO_LINE_SHADOW }}
      >
        {copy.eyebrow}
      </p>
      <h1
        id={isDaytona ? 'daytona-hero-heading' : 'titusville-hero-heading'}
        className={`lz-hero-fade lz-hero-fade--delay-2 mt-4 text-balance font-display font-bold tracking-tight text-white${
          isDaytona ? ' max-w-xl text-2xl sm:text-3xl md:text-4xl' : ' text-3xl sm:text-4xl md:text-5xl'
        }`}
        style={{ textShadow: HERO_LINE_SHADOW }}
      >
        {copy.heroTitle}
      </h1>
      <p
        className={`lz-hero-fade lz-hero-fade--delay-2 mt-4 max-w-2xl text-pretty text-base leading-relaxed sm:text-lg${
          isDaytona ? ' max-w-xl text-white/95' : ' mx-auto mt-5 text-white/95'
        }`}
        style={{ textShadow: HERO_SUB_SHADOW }}
      >
        {copy.heroSubtitle}
      </p>

      <div
        className={`lz-hero-fade lz-hero-fade--delay-3 mt-9 flex w-full flex-col gap-3 sm:mt-10 sm:flex-row sm:flex-wrap sm:items-stretch sm:gap-4${
          isDaytona ? ' sm:max-w-2xl' : ' sm:mx-auto sm:max-w-2xl sm:justify-center'
        }`}
      >
        <button
          type="button"
          onClick={wrapNavigateClick(prefix, rentalBookPageKey, onNavigate)}
          className="lz-btn-primary relative z-[2] w-full shrink-0 justify-center shadow-[0_4px_20px_rgba(0,0,0,0.35),0_0_24px_rgba(255,140,43,0.35)] sm:w-auto sm:min-w-[180px]"
        >
          Book now
        </button>
        <button
          type="button"
          onClick={wrapNavigateClick(prefix, 'pricing', onNavigate)}
          className="lz-btn-secondary w-full shrink-0 justify-center sm:w-auto sm:min-w-[180px]"
        >
          View pricing
        </button>
        <button
          type="button"
          onClick={onScrollToFleet}
          className="lz-btn-secondary w-full shrink-0 justify-center border-cyan-400/25 sm:w-auto sm:min-w-[180px]"
        >
          View rentals
        </button>
      </div>
      <p
        className={`lz-hero-fade lz-hero-fade--delay-3 mt-4 max-w-xl text-sm text-white/70 ${isDaytona ? '' : 'mx-auto text-center'}`}
      >
        {isDaytona ? (
          <>
            Have a Groupon pontoon voucher?{' '}
            <Link
              to="/booking/groupon"
              className="font-semibold text-cyan-300/95 underline decoration-cyan-500/35 underline-offset-[5px] transition hover:text-cyan-200"
            >
              Book with Groupon
            </Link>
            {' · '}
          </>
        ) : null}
        Need dates before you commit?{' '}
        <button
          type="button"
          onClick={wrapNavigateClick(prefix, rentalBookPageKey, onNavigate)}
          className="font-semibold text-cyan-300/95 underline decoration-cyan-500/35 underline-offset-[5px] transition hover:text-cyan-200"
        >
          Check availability
        </button>
      </p>
      <p
        className={`lz-hero-fade lz-hero-fade--delay-3 mt-7 max-w-md text-[11px] font-medium uppercase leading-relaxed tracking-[0.16em] text-white/75 sm:mt-8 sm:text-xs${
          isDaytona ? '' : ' mx-auto text-center text-white/65'
        }`}
        style={{ textShadow: HERO_SUB_SHADOW }}
      >
        {copy.heroTrustLine}
      </p>
    </>
  );
}

export default function BoatRentalsLocation({ onNavigate, variant }: BoatRentalsLocationProps) {
  const [boats, setBoats] = useState<Boat[]>([]);
  const [loading, setLoading] = useState(true);
  const copy = COPY[variant];
  const rentalBookPageKey = variant === 'daytona' ? 'book-rental-daytona' : 'book-rental-titusville';
  const goToRentalBookingWithBoat = (boatId: string) => {
    if (typeof window !== 'undefined') {
      const locationParam = variant === 'daytona' ? 'daytona' : 'titusville';
      const boatParam = encodeURIComponent(boatId);
      window.location.assign(`/booking?bookingMode=rental&location=${locationParam}&boat=${boatParam}`);
      return;
    }
    onNavigate(rentalBookPageKey);
  };

  const scrollToFleet = useMemo(
    () =>
      wrapSyncClick(`boat_rentals_${variant}_scroll_fleet`, () => {
        document.getElementById('fleet-heading')?.scrollIntoView({ behavior: 'smooth' });
      }),
    [variant]
  );

  const canonicalUrl = useMemo(() => `${siteOrigin()}${copy.path}`, [copy.path]);

  const serviceJsonLd = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: copy.pageTitle,
      description: copy.metaDescription,
      url: canonicalUrl,
      serviceType: ['Boat rental', 'Pontoon rental', 'Boat charter'],
      areaServed:
        variant === 'daytona'
          ? [
              { '@type': 'City', name: 'Daytona Beach', containedInPlace: { '@type': 'State', name: 'Florida' } },
              { '@type': 'City', name: 'Port Orange', containedInPlace: { '@type': 'State', name: 'Florida' } },
              { '@type': 'City', name: 'New Smyrna Beach', containedInPlace: { '@type': 'State', name: 'Florida' } },
            ]
          : {
              '@type': 'City',
              name: 'Titusville',
              containedInPlace: { '@type': 'State', name: 'Florida' },
            },
      provider: {
        '@type': 'LocalBusiness',
        name: 'Launch Zone Charters',
        telephone: '+1-803-542-1761',
        url: siteOrigin(),
      },
    }),
    [canonicalUrl, copy.metaDescription, copy.pageTitle, variant]
  );

  useEffect(() => {
    const loadBoats = async () => {
      const { data, error } = await supabase
        .from('boats')
        .select('*')
        .eq('is_active', true)
        .order('type', { ascending: false });

      logSupabaseError('BoatRentalsLocation.loadBoats', error);
      if (!error && data) {
        setBoats(data as Boat[]);
      }
      setLoading(false);
    };
    loadBoats();
  }, []);

  if (loading) {
    return <FullPageLoader variant="dark" message="Loading boat rentals…" />;
  }

  return (
    <div className="boat-rentals-page min-h-screen bg-[#020617] text-slate-200">
      <Helmet prioritizeSeoTags>
        <title>{copy.pageTitle}</title>
        <meta name="description" content={copy.metaDescription} />
        <meta name="keywords" content={copy.metaKeywords} />
        <link rel="canonical" href={canonicalUrl} />
        <link rel="preload" as="image" href={copy.heroImage} />
        <meta property="og:title" content={copy.ogTitle} />
        <meta property="og:description" content={copy.metaDescription} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={`${siteOrigin()}${copy.heroImage}`} />
        <script type="application/ld+json">{JSON.stringify(serviceJsonLd)}</script>
      </Helmet>

      {variant === 'daytona' ? (
        <>
          <section
            className="boat-rentals-hero-daytona relative isolate w-full overflow-hidden bg-[#0a1628] min-h-[min(58vh,480px)] sm:min-h-[min(64vh,540px)] md:min-h-[min(70vh,620px)] lg:min-h-[min(74vh,700px)] xl:min-h-[min(76vh,760px)] max-h-[92vh] 2xl:max-h-[min(88vh,900px)]"
            aria-label="Daytona Beach boat rentals — hero photo"
          >
            <div
              className="absolute inset-0 z-0 overflow-hidden bg-gradient-to-b from-[#060d16] via-[#0a1628] to-[#0c1a2e]"
              aria-hidden
            >
              <SmartImage
                src={copy.heroImage}
                alt={copy.heroImageAlt}
                priority
                sizes="100vw"
                className="boat-rentals-hero-daytona__img"
              />
            </div>
          </section>

          <section
            className="border-t border-cyan-500/15 bg-gradient-to-b from-[#08121c] via-[#020617] to-[#020617] px-4 py-10 sm:px-8 sm:py-12 md:px-12 md:py-14"
            aria-labelledby="daytona-hero-heading"
          >
            <div className="mx-auto w-full max-w-2xl text-left lg:max-w-3xl">
              <BoatRentalsHeroContent
                variant="daytona"
                copy={copy}
                onNavigate={onNavigate}
                onScrollToFleet={scrollToFleet}
              />
            </div>
          </section>
        </>
      ) : (
        <>
          <section
            className="boat-rentals-hero-titusville relative isolate w-full overflow-hidden bg-[#060d16] min-h-[min(58vh,480px)] sm:min-h-[min(64vh,540px)] md:min-h-[min(70vh,620px)] lg:min-h-[min(74vh,700px)] xl:min-h-[min(76vh,760px)] max-h-[92vh] 2xl:max-h-[min(88vh,900px)]"
            aria-label="Titusville boat rentals — hero photo"
          >
            <div
              className="absolute inset-0 z-0 overflow-hidden bg-gradient-to-b from-[#05111f] via-[#071729] to-[#081f36]"
              aria-hidden
            >
              <SmartImage
                src={copy.heroImage}
                alt={copy.heroImageAlt}
                priority
                sizes="100vw"
                className="boat-rentals-hero-titusville__img"
              />
            </div>
          </section>

          <section
            className="border-t border-cyan-500/15 bg-gradient-to-b from-[#091b2f] via-[#020617] to-[#020617] px-4 py-10 sm:px-8 sm:py-12 md:px-12 md:py-14"
            aria-labelledby="titusville-hero-heading"
          >
            <div className="mx-auto w-full max-w-2xl text-left lg:max-w-3xl">
              <BoatRentalsHeroContent
                variant="titusville"
                copy={copy}
                onNavigate={onNavigate}
                onScrollToFleet={scrollToFleet}
              />
            </div>
          </section>
        </>
      )}

      <div
        className="relative z-[4] flex min-h-[14px] flex-col justify-end bg-gradient-to-b from-[#020617] to-[#050a14]"
        aria-hidden
      >
        <div className="lz-hero-glow-divider w-full shrink-0" />
      </div>

      <section className="marine-intro border-t border-white/[0.06]" aria-labelledby="rentals-intro-heading">
        <div className="marine-intro__inner">
          <div className="marine-intro__card">
            <h2
              id="rentals-intro-heading"
              className="text-center font-display text-xl font-bold uppercase tracking-[0.12em] text-white sm:text-2xl sm:tracking-[0.1em] md:text-[1.65rem]"
            >
              {copy.introTitle}
            </h2>
            {copy.introParagraphs.map((p, i) => (
              <p key={i} className="mt-6 text-center text-base leading-relaxed text-white/88 sm:text-lg">
                {p}
              </p>
            ))}
            <ul
              className="mt-8 flex flex-wrap items-center justify-center gap-2 sm:mt-10 sm:gap-3"
              aria-label="Trip highlights"
            >
              {copy.introBadges.map(({ label, Icon }) => (
                <li key={label}>
                  <span className="marine-intro__badge">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-cyan-300/90" strokeWidth={2} aria-hidden />
                    {label}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-10 text-center text-sm text-slate-500">
              {variant === 'daytona' ? (
                <>
                  Lagoon side of the coast? Explore{' '}
                  <button
                    type="button"
                    onClick={wrapNavigateClick(`boat_rentals_${variant}`, 'fleet-titusville', onNavigate)}
                    className="font-semibold text-cyan-300/95 underline decoration-cyan-500/35 underline-offset-2 transition hover:text-cyan-200"
                  >
                    Titusville boat rentals
                  </button>{' '}
                  for Indian River Lagoon miles and launch nights.
                </>
              ) : (
                <>
                  Want Intracoastal sandbar days? See{' '}
                  <button
                    type="button"
                    onClick={wrapNavigateClick(`boat_rentals_${variant}`, 'fleet-daytona', onNavigate)}
                    className="font-semibold text-cyan-300/95 underline decoration-cyan-500/35 underline-offset-2 transition hover:text-cyan-200"
                  >
                    Daytona Beach boat rentals
                  </button>{' '}
                  for Halifax River and inlet routes.
                </>
              )}
            </p>
          </div>
        </div>
      </section>

      <section
        className="border-t border-cyan-500/15 bg-[#020617] py-10 sm:py-12"
        aria-labelledby="booking-intent-heading"
      >
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="lz-card-glass border-cyan-400/20 p-5 sm:p-7">
            <p className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/90">
              Choose your trip style
            </p>
            <h2
              id="booking-intent-heading"
              className="mt-3 text-center font-display text-xl font-bold tracking-tight text-white sm:text-2xl"
            >
              Rent a Boat or Book a Charter
            </h2>
            <div className="mt-6 grid gap-3 md:grid-cols-2 md:gap-4">
              <a
                href="#fleet-heading"
                onClick={wrapSyncClick(`boat_rentals_${variant}_hash_fleet`, () => {
                /* in-page hash nav */
              })}
                className="rounded-xl border border-cyan-400/25 bg-cyan-500/[0.08] px-4 py-4 text-left transition hover:border-cyan-300/40 hover:bg-cyan-500/[0.14]"
              >
                <p className="text-base font-bold text-white">🚤 Rent a Boat</p>
                <p className="mt-1 text-sm text-slate-300">Drive it yourself with flexible rental timing.</p>
              </a>
              <a
                href="#charter-experiences-heading"
                onClick={wrapSyncClick(`boat_rentals_${variant}_hash_charter_experiences`, () => {
                /* in-page hash nav */
              })}
                className="rounded-xl border border-cyan-400/25 bg-cyan-500/[0.08] px-4 py-4 text-left transition hover:border-cyan-300/40 hover:bg-cyan-500/[0.14]"
              >
                <p className="text-base font-bold text-white">🌊 Book a Charter</p>
                <p className="mt-1 text-sm text-slate-300">Captain included for guided Space Coast experiences.</p>
              </a>
            </div>
          </div>
        </div>
      </section>

      <section
        className="border-t border-white/[0.06] bg-gradient-to-b from-[#0a1628] to-[#050a14] py-16 md:py-20"
        aria-labelledby="charter-experiences-heading"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2
              id="charter-experiences-heading"
              className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl"
            >
              Charter Experiences
            </h2>
            <p className="mx-auto mt-3 max-w-3xl text-sm leading-relaxed text-slate-300 sm:text-base">
              Captain-led private experiences built for launch nights, glowing water, and relaxed coastal evenings.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {CHARTER_EXPERIENCES.map((charter) => (
              <article
                key={charter.id}
                className="lz-card-glass flex h-full flex-col border-cyan-400/20 p-6 transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-cyan-300/35 hover:shadow-[0_0_40px_rgba(34,211,238,0.12)]"
              >
                <p className="text-3xl" aria-hidden>
                  {charter.icon}
                </p>
                <h3 className="mt-4 text-xl font-bold text-white">{charter.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{charter.description}</p>
                <ul className="mt-5 space-y-1.5 text-sm text-slate-300">
                  {charter.bullets.map((item) => (
                    <li key={item}>✔ {item}</li>
                  ))}
                </ul>
                <p className="mt-6 text-base font-semibold text-white">{charter.priceLabel}</p>
                <p className="mt-2 text-xs leading-relaxed text-cyan-100/90">{charter.priceSub}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  Up to 6 passengers included
                  <br />
                  Captain &amp; fuel included
                </p>
                <a
                  href={`/booking?bookingMode=charter&charterType=${charter.id}`}
                  onClick={wrapSyncClick(`boat_rentals_${variant}_charter_${charter.id}`, () => {
                  /* client nav via href */
                })}
                  className="lz-btn-primary mt-6 w-full justify-center"
                >
                  {charter.cta}
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/[0.06] bg-[#050a14] py-16 md:py-20" aria-labelledby="fleet-heading">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2
            id="fleet-heading"
            className="text-center font-display text-2xl font-bold tracking-tight text-white sm:text-3xl"
          >
            {copy.fleetSectionTitle}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-slate-400 sm:text-base">
            {copy.fleetSectionSub}
          </p>

          {boats.length === 0 ? (
            <p className="mt-12 text-center text-slate-400">
              Our rental lineup is updating. Call{' '}
              <a href="tel:803-542-1761" className="font-semibold text-cyan-300/95 underline-offset-2 hover:underline">
                803-542-1761
              </a>{' '}
              or book online and we&apos;ll match you with availability.
            </p>
          ) : (
            <div className="mt-12 grid gap-8 md:grid-cols-2">
              {boats.map((boat) => (
                <article
                  key={boat.id}
                  className="group overflow-hidden rounded-2xl border border-cyan-500/15 bg-slate-950/45 shadow-[0_0_40px_rgba(6,182,212,0.06)] backdrop-blur-sm transition-[border-color,box-shadow] duration-300 hover:border-cyan-400/30 hover:shadow-[0_0_48px_rgba(34,211,238,0.1)]"
                >
                  <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-900">
                    <SafeImage
                      src={boat.image_url || getBoatPlaceholderImage(boat.type)}
                      fallbackSrc={getBoatPlaceholderImage(boat.type)}
                      alt={`${boat.name}, ${copy.boatImageAltSuffix}`}
                      className="h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.02]"
                    />
                    <span
                      className={`absolute right-3 top-3 rounded-full px-3 py-1 text-xs font-bold ${
                        boat.type === 'premium' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-white'
                      }`}
                    >
                      {boat.type === 'premium' ? 'Premium' : 'Standard'}
                    </span>
                  </div>
                  <div className="border-t border-white/[0.06] p-6 md:p-8">
                    <h3 className="text-2xl font-bold text-white">{boat.name}</h3>
                    <p className="mt-3 leading-relaxed text-slate-400">
                      {boat.description ??
                        `${boat.type === 'premium' ? 'Premium' : 'Standard'} pontoon, ideal for groups on the Intracoastal and Space Coast.`}
                    </p>
                    <p className="mt-4 font-semibold text-slate-200">{boat.capacity} passengers</p>
                    <p className="mt-2 text-sm text-slate-500">
                      From ${boat.hourly_rate}/hr · Half day ${boat.half_day_rate} · Full day ${boat.full_day_rate}
                    </p>
                    <button
                      type="button"
                      onClick={() => goToRentalBookingWithBoat(String(boat.id))}
                      className="lz-btn-primary mt-6 w-full justify-center"
                    >
                      Reserve Rental
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section
        className="border-t border-white/[0.06] bg-[#020617] py-16 md:py-20"
        aria-labelledby="experiences-heading"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 id="experiences-heading" className="text-center font-display text-2xl font-bold text-white sm:text-3xl">
            {copy.experienceHeading}
          </h2>
          <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {copy.experienceCards.map((card) => (
              <li
                key={card.title}
                className="lz-bio-glow-card flex flex-col border-cyan-400/20 p-6 text-left transition-[transform,box-shadow] duration-300 hover:border-cyan-300/35"
              >
                <span className="text-3xl" aria-hidden>
                  {card.icon}
                </span>
                <h3 className="mt-3 text-lg font-bold text-white">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{card.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        className="border-t border-cyan-500/10 bg-gradient-to-b from-[#0a1628] to-[#020617] px-4 py-16 sm:px-6 sm:py-20 lg:px-8"
        aria-labelledby="seo-guide-heading"
      >
        <div className="mx-auto max-w-3xl">
          <div className="faqs-page-section-head text-center">
            <h2 id="seo-guide-heading" className="faqs-page-section-title">
              {copy.seoSectionTitle}
            </h2>
            <div className="faqs-page-section-rule mx-auto max-w-md" aria-hidden />
          </div>
          <div className="mt-10 space-y-10">
            {copy.seoBlocks.map((block) => (
              <div key={block.id}>
                <h3 className="text-lg font-bold tracking-tight text-white sm:text-xl">{block.title}</h3>
                {block.paragraphs.map((para, j) => (
                  <p key={j} className="mt-3 text-base leading-relaxed text-slate-400">
                    {para}
                  </p>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-10 border-t border-white/[0.06] pt-10">
            <p className="text-center text-sm text-slate-500">
              <button
                type="button"
                onClick={wrapNavigateClick(
                  `boat_rentals_${variant}`,
                  variant === 'daytona' ? 'fleet-titusville' : 'fleet-daytona',
                  onNavigate
                )}
                className="font-medium text-cyan-300/90 underline decoration-cyan-500/30 underline-offset-2 transition hover:text-cyan-200"
              >
                {variant === 'daytona' ? 'View Titusville boat rentals' : 'View Daytona Beach boat rentals'}
              </button>
              <span className="mx-2 text-slate-600" aria-hidden>
                ·
              </span>
              <button
                type="button"
                onClick={wrapNavigateClick(`boat_rentals_${variant}`, 'launches', onNavigate)}
                className="font-medium text-cyan-300/90 underline decoration-cyan-500/30 underline-offset-2 transition hover:text-cyan-200"
              >
                Rocket launch schedule
              </button>
            </p>
            <ul className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm text-slate-500">
              <li className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-cyan-400/90" aria-hidden />
                Licensed &amp; insured operator
              </li>
              <li className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-cyan-400/90" aria-hidden />
                <a href="tel:803-542-1761" className="text-cyan-300/90 hover:underline">
                  803-542-1761
                </a>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="border-t border-white/[0.06] bg-[#020617] px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{copy.finalCtaTitle}</h2>
          <p className="mt-3 text-base text-slate-400 sm:text-lg">{copy.finalCtaSub}</p>
          <div className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:gap-4">
            <button
              type="button"
              onClick={wrapNavigateClick(`boat_rentals_${variant}`, rentalBookPageKey, onNavigate)}
              className="lz-btn-primary order-1 w-full justify-center sm:order-none sm:min-w-[220px]"
            >
              Book now
            </button>
            <a
              href="tel:803-542-1761"
              className="lz-btn-secondary order-2 w-full justify-center sm:order-none sm:min-w-[220px]"
            >
              Call 803-542-1761
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
