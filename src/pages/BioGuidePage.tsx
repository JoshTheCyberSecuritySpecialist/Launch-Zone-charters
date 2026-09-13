import { useCallback, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ChevronDown, MapPin, Moon, Users, Anchor } from 'lucide-react';
import LiveBioConditionsWidget from '../components/bio-guide/LiveBioConditionsWidget';
import BioSchema from '../components/bio-guide/BioSchema';
import {
  BIO_GUIDE_META,
  BIO_GUIDE_PHOTOS,
  BIO_GUIDE_WPM,
} from '../content/bioluminescence/meta';
import { BIO_GUIDE_FAQS } from '../content/bioluminescence/faqs';
import { TITUSVILLE_MEETING_LOCATION } from '../lib/meetingLocations';
import { siteOrigin } from '../lib/siteOrigin';
import { wrapSyncClick } from '../lib/clickPerf';

interface BioGuidePageProps {
  onNavigate: (page: string) => void;
}

const PACKAGES_HREF = '/bioluminescent-tours#packages';
const GLOW_SECTION_ID = 'tonights-conditions';

const SEE_CARDS = [
  {
    title: 'Water that flashes when it moves',
    body: 'As the boat cuts through the lagoon, disturbed water can sparkle with blue-green light. Trails behind the hull and along the wake are often the first thing guests notice.',
  },
  {
    title: 'Hands and paddles that light up',
    body: 'When conditions are good, dipping a hand or stirring the surface can create brief flashes. It is the same natural response — movement waking tiny organisms in the water.',
  },
  {
    title: 'A dark lagoon night',
    body: 'Away from bright shore lights, the Indian River Lagoon feels quiet and open. On the best nights, the glow is the main show under a dark sky.',
  },
] as const;

const WHAT_TO_BRING = [
  'Dark or muted clothing (bright whites bounce light)',
  'Light jacket or layers — evenings cool after sunset',
  'Closed-toe shoes that can get wet at the ramp',
  'Bug spray for the dock and shoreline',
  'Phone with night mode / low brightness for photos',
  'A charged battery and a small towel',
] as const;

const GUIDE_BODY_WORDS = [
  BIO_GUIDE_META.headline,
  BIO_GUIDE_META.subheading,
  ...SEE_CARDS.flatMap((c) => [c.title, c.body]),
  ...WHAT_TO_BRING,
  ...BIO_GUIDE_FAQS.flatMap((f) => [f.question, f.answer]),
].join(' ');

function GuidePhoto({
  src,
  alt,
  caption,
  priority = false,
  className = '',
}: {
  src: string;
  alt: string;
  caption?: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <figure className={className}>
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950 aspect-[4/3] sm:aspect-[16/10]">
        <img
          src={src}
          alt={alt}
          width={1600}
          height={1000}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          className="h-full w-full object-cover"
        />
      </div>
      {caption ? <figcaption className="mt-2 text-sm text-slate-400">{caption}</figcaption> : null}
    </figure>
  );
}

export default function BioGuidePage({ onNavigate }: BioGuidePageProps) {
  void onNavigate;

  const canonicalUrl = useMemo(() => `${siteOrigin()}/bioluminescence`, []);
  const wordCount = useMemo(() => GUIDE_BODY_WORDS.trim().split(/\s+/).filter(Boolean).length, []);
  const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / BIO_GUIDE_WPM));
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const scrollToGlow = useCallback(() => {
    const el = document.getElementById(GLOW_SECTION_ID);
    if (!el) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
  }, []);

  return (
    <div className="bio-guide-page min-h-screen bg-[#020617] text-slate-200">
      <Helmet prioritizeSeoTags>
        <title>{BIO_GUIDE_META.title}</title>
        <meta name="description" content={BIO_GUIDE_META.description} />
        <meta name="keywords" content={BIO_GUIDE_META.keywords} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={BIO_GUIDE_META.title} />
        <meta property="og:description" content={BIO_GUIDE_META.description} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={`${siteOrigin()}${BIO_GUIDE_PHOTOS.hero.src}`} />
        <meta property="og:image:alt" content={BIO_GUIDE_PHOTOS.hero.alt} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={BIO_GUIDE_META.title} />
        <meta name="twitter:description" content={BIO_GUIDE_META.description} />
        <meta name="twitter:image" content={`${siteOrigin()}${BIO_GUIDE_PHOTOS.hero.src}`} />
        <meta name="robots" content="index,follow,max-image-preview:large" />
      </Helmet>
      <BioSchema canonicalUrl={canonicalUrl} wordCount={wordCount} />

      {/* 1. Hero */}
      <header className="relative isolate min-h-[88vh] overflow-hidden">
        <img
          src={BIO_GUIDE_PHOTOS.hero.src}
          alt=""
          aria-hidden
          width={1600}
          height={1000}
          className="absolute inset-0 h-full w-full object-cover"
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
        <div
          className="absolute inset-0 bg-gradient-to-b from-slate-950/55 via-slate-950/70 to-[#020617]"
          aria-hidden
        />
        <div className="relative z-10 mx-auto flex min-h-[88vh] max-w-4xl flex-col justify-end px-4 pb-14 pt-28 sm:px-6 sm:pb-20">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200/90">
            Launch Zone Charters
          </p>
          <h1 className="bio-guide-speakable mt-3 max-w-3xl text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
            {BIO_GUIDE_META.headline}
          </h1>
          <p className="bio-guide-speakable mt-4 max-w-2xl text-base leading-relaxed text-slate-200 sm:text-lg">
            {BIO_GUIDE_META.subheading}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              to={PACKAGES_HREF}
              className="inline-flex items-center justify-center rounded-xl bg-orange-500 px-6 py-3.5 text-center text-base font-bold text-white shadow-lg shadow-orange-900/40 transition hover:bg-orange-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
              onClick={wrapSyncClick('bio_guide_hero_packages')}
            >
              View Bioluminescence Packages
            </Link>
            <button
              type="button"
              className="lz-btn-glow-forecast"
              onClick={wrapSyncClick('bio_guide_hero_glow', scrollToGlow)}
            >
              Check Tonight&apos;s Glow Forecast
            </button>
          </div>
          <p className="mt-4 text-xs text-slate-400">About {readingTimeMinutes} min read · Titusville, Florida</p>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        {/* 2. Quick info */}
        <section
          aria-labelledby="heading-quick-info"
          className="rounded-2xl border border-white/10 bg-slate-950/50 p-6 sm:p-8"
        >
          <h2 id="heading-quick-info" className="text-xl font-bold text-white sm:text-2xl">
            Trip essentials
          </h2>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            <li className="flex gap-3 text-sm text-slate-300">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" aria-hidden />
              <span>
                <span className="font-semibold text-white">Location:</span> Titusville, Florida — Indian
                River Lagoon
              </span>
            </li>
            <li className="flex gap-3 text-sm text-slate-300">
              <Anchor className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" aria-hidden />
              <span>
                <span className="font-semibold text-white">Meet:</span>{' '}
                {TITUSVILLE_MEETING_LOCATION.name}
              </span>
            </li>
            <li className="flex gap-3 text-sm text-slate-300">
              <Users className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" aria-hidden />
              <span>
                <span className="font-semibold text-white">Group size:</span> Up to 5 guests + captain
              </span>
            </li>
            <li className="flex gap-3 text-sm text-slate-300">
              <Moon className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" aria-hidden />
              <span>
                <span className="font-semibold text-white">Style:</span> Captain-led evening boat tours
              </span>
            </li>
          </ul>
        </section>

        {/* 3. Intro + photo */}
        <section className="mt-16" aria-labelledby="heading-intro">
          <h2 id="heading-intro" className="text-2xl font-bold text-white sm:text-3xl">
            What bioluminescence looks like here
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-300 sm:text-lg">
            On good nights near Titusville, the lagoon answers movement with light. Tiny organisms in the
            water flash blue-green when the boat, a wake, or a hand disturbs them. It is quiet, dark, and
            surprisingly vivid when conditions line up — not a light show you can schedule, but a real
            Florida night-water experience.
          </p>
          <GuidePhoto
            className="mt-8"
            src={BIO_GUIDE_PHOTOS.handClose.src}
            alt={BIO_GUIDE_PHOTOS.handClose.alt}
            caption={BIO_GUIDE_PHOTOS.handClose.caption}
          />
        </section>

        {/* 4. What you may see */}
        <section className="mt-16" aria-labelledby="heading-may-see">
          <h2 id="heading-may-see" className="text-2xl font-bold text-white sm:text-3xl">
            What you may see
          </h2>
          <p className="mt-3 text-slate-400">
            Every night is different. These are the moments guests talk about most.
          </p>
          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            {SEE_CARDS.map((card) => (
              <article
                key={card.title}
                className="rounded-2xl border border-cyan-500/15 bg-slate-950/40 p-5"
              >
                <h3 className="text-base font-semibold text-white">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{card.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* 5. Glow forecast */}
        <section className="mt-16" aria-labelledby="heading-glow-forecast">
          <h2 id="heading-glow-forecast" className="sr-only">
            Glow forecast
          </h2>
          <p className="mb-6 text-base leading-relaxed text-slate-300">
            Before you book or drive to the ramp, check tonight&apos;s glow outlook. It uses the same
            conditions model as our tour page — helpful for planning, not a guarantee of visibility.
          </p>
          <LiveBioConditionsWidget />
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              to={PACKAGES_HREF}
              className="inline-flex items-center justify-center rounded-xl bg-orange-500 px-5 py-3 text-center text-sm font-bold text-white transition hover:bg-orange-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
              onClick={wrapSyncClick('bio_guide_mid_packages')}
            >
              View Packages
            </Link>
            <button
              type="button"
              className="lz-btn-glow-forecast"
              onClick={wrapSyncClick('bio_guide_mid_glow', scrollToGlow)}
            >
              Check Tonight&apos;s Glow Forecast
            </button>
          </div>
        </section>

        {/* 6. What the trip is like + photo */}
        <section className="mt-16" aria-labelledby="heading-trip-like">
          <h2 id="heading-trip-like" className="text-2xl font-bold text-white sm:text-3xl">
            What the trip is like
          </h2>
          <div className="mt-4 space-y-4 text-base leading-relaxed text-slate-300 sm:text-lg">
            <p>
              You meet at {TITUSVILLE_MEETING_LOCATION.name}, board a small charter boat with your captain,
              and head onto the Indian River Lagoon after dark. The ride is unhurried — time to let your
              eyes adjust, watch the water, and see whether the glow shows up in the wake or around your
              hands.
            </p>
            <p>
              Groups stay small (up to five guests plus the captain), so the night feels personal rather
              than crowded. Shared and private package options are listed on the booking page.
            </p>
          </div>
          <GuidePhoto
            className="mt-8"
            src={BIO_GUIDE_PHOTOS.armReach.src}
            alt={BIO_GUIDE_PHOTOS.armReach.alt}
            caption={BIO_GUIDE_PHOTOS.armReach.caption}
          />
        </section>

        {/* 7. Best viewing conditions */}
        <section className="mt-16" aria-labelledby="heading-conditions">
          <h2 id="heading-conditions" className="text-2xl font-bold text-white sm:text-3xl">
            Best viewing conditions
          </h2>
          <ul className="mt-5 list-disc space-y-2 pl-5 text-slate-300">
            <li>Darker nights (less moonlight) usually help the glow stand out</li>
            <li>Calm wind and smoother water make flashes easier to see</li>
            <li>Warmer months are often stronger on the Space Coast, but local conditions still decide</li>
            <li>Clear skies help; heavy rain or rough weather can end a trip early</li>
          </ul>
          <p className="mt-4 text-sm text-slate-400">
            Use the glow forecast above as a planning tool — your eyes on the water are the final judge.
          </p>
        </section>

        {/* 8. What to bring */}
        <section className="mt-16" aria-labelledby="heading-bring">
          <h2 id="heading-bring" className="text-2xl font-bold text-white sm:text-3xl">
            What to bring
          </h2>
          <ul className="mt-5 grid gap-2 sm:grid-cols-2">
            {WHAT_TO_BRING.map((item) => (
              <li
                key={item}
                className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-300"
              >
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* 9. Gallery */}
        <section className="mt-16" aria-labelledby="heading-gallery">
          <h2 id="heading-gallery" className="text-2xl font-bold text-white sm:text-3xl">
            From recent trips
          </h2>
          <p className="mt-2 text-slate-400">Customer photos from Launch Zone Charters nights on the lagoon.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {(
              [
                BIO_GUIDE_PHOTOS.hero,
                BIO_GUIDE_PHOTOS.handClose,
                BIO_GUIDE_PHOTOS.armReach,
              ] as const
            ).map((photo) => (
              <GuidePhoto key={photo.src} src={photo.src} alt={photo.alt} caption={photo.caption} />
            ))}
          </div>
        </section>

        {/* 10. FAQ */}
        <section className="mt-16" id="bio-guide-faq" aria-labelledby="heading-faq">
          <h2 id="heading-faq" className="text-2xl font-bold text-white sm:text-3xl">
            Frequently asked questions
          </h2>
          <div className="mt-6 divide-y divide-white/10 rounded-2xl border border-white/10">
            {BIO_GUIDE_FAQS.map((faq, index) => {
              const isOpen = openFaq === index;
              const panelId = `bio-faq-panel-${index}`;
              const btnId = `bio-faq-btn-${index}`;
              return (
                <div key={faq.question} className="bg-slate-950/40">
                  <h3 className="m-0">
                    <button
                      type="button"
                      id={btnId}
                      className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left text-sm font-semibold text-white transition hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/50 sm:text-base"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => setOpenFaq(isOpen ? null : index)}
                    >
                      {faq.question}
                      <ChevronDown
                        className={`h-5 w-5 shrink-0 text-cyan-400 transition motion-reduce:transition-none ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                        aria-hidden
                      />
                    </button>
                  </h3>
                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={btnId}
                    hidden={!isOpen}
                    className="px-4 pb-4 text-sm leading-relaxed text-slate-300 sm:text-base"
                  >
                    {faq.answer}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 11. Final CTAs */}
        <section
          className="mt-16 rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-slate-950 via-slate-950 to-cyan-950/30 p-8 text-center sm:p-10"
          aria-labelledby="heading-book"
        >
          <h2 id="heading-book" className="text-2xl font-bold text-white sm:text-3xl">
            Ready for a night on the lagoon?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-300">
            Pick a package that fits your group, or check tonight&apos;s glow outlook before you decide.
          </p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Link
              to={PACKAGES_HREF}
              className="inline-flex items-center justify-center rounded-xl bg-orange-500 px-6 py-3.5 text-center text-base font-bold text-white shadow-lg shadow-orange-900/40 transition hover:bg-orange-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
              onClick={wrapSyncClick('bio_guide_footer_packages')}
            >
              View Bioluminescence Packages
            </Link>
            <button
              type="button"
              className="lz-btn-glow-forecast"
              onClick={wrapSyncClick('bio_guide_footer_glow', scrollToGlow)}
            >
              Check Tonight&apos;s Glow Forecast
            </button>
          </div>
          <p className="mt-6 text-sm text-slate-500">
            Or browse the{' '}
            <Link to="/bioluminescent-tours" className="text-cyan-300 underline-offset-2 hover:underline">
              full tour page
            </Link>{' '}
            for packages, weekly outlook, and booking.
          </p>
        </section>
      </main>
    </div>
  );
}
