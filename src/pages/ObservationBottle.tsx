import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, Droplets, Leaf, Sparkles } from 'lucide-react';
import SmartImage from '../components/ui/SmartImage';
import { siteOrigin } from '../lib/siteOrigin';
import {
  OBSERVATION_BOTTLE,
  OBSERVATION_BOTTLE_CONSERVATION,
  OBSERVATION_BOTTLE_FAQS,
  OBSERVATION_BOTTLE_FEATURES,
  OBSERVATION_BOTTLE_HOW_TO_USE,
  OBSERVATION_BOTTLE_RELATED_LINKS,
} from '../content/observationBottle';

interface ObservationBottleProps {
  onNavigate: (page: string) => void;
}

export default function ObservationBottle({ onNavigate }: ObservationBottleProps) {
  void onNavigate;
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const canonicalUrl = useMemo(
    () => `${siteOrigin()}${OBSERVATION_BOTTLE.route}`,
    []
  );
  const ogImage = useMemo(
    () => `${siteOrigin()}${OBSERVATION_BOTTLE.imagePath}`,
    []
  );

  const jsonLd = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Product',
          name: OBSERVATION_BOTTLE.name,
          description:
            'Premium borosilicate observation bottle for brief, responsible viewing of Florida bioluminescent lagoon water. Observe, learn, and return water to the same location.',
          image: ogImage,
          brand: {
            '@type': 'Brand',
            name: OBSERVATION_BOTTLE.brand,
          },
          // TODO(commerce): add offers.price, offers.priceCurrency, sku, and availability when storefront is live.
        },
        {
          '@type': 'FAQPage',
          mainEntity: OBSERVATION_BOTTLE_FAQS.map((faq) => ({
            '@type': 'Question',
            name: faq.question,
            acceptedAnswer: {
              '@type': 'Answer',
              text: faq.answer,
            },
          })),
        },
      ],
    }),
    [ogImage]
  );

  const metaDescription =
    'Launch Zone Observation Bottle — catch the glow, return the magic. A reusable 16 oz borosilicate bottle for brief, responsible bioluminescence observation on Florida\'s Space Coast lagoon.';

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200">
      <Helmet prioritizeSeoTags>
        <title>{OBSERVATION_BOTTLE.name} | {OBSERVATION_BOTTLE.brand}</title>
        <meta name="description" content={metaDescription} />
        <meta
          name="keywords"
          content="Launch Zone Observation Bottle, bioluminescence bottle, Florida lagoon souvenir, eco-friendly observation bottle, Space Coast bioluminescence, Launch Zone Charters"
        />
        <link rel="canonical" href={canonicalUrl} />
        <link rel="preload" as="image" href={OBSERVATION_BOTTLE.imagePath} />
        <meta property="og:title" content={`${OBSERVATION_BOTTLE.name} | ${OBSERVATION_BOTTLE.brand}`} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:type" content="product" />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={ogImage} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      {/* Hero — primary product image (do not replace) */}
      <section
        className="relative overflow-hidden border-b border-cyan-500/15 bg-[#030712]"
        aria-labelledby="observation-bottle-heading"
      >
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-14 lg:py-16">
          <div className="order-2 lg:order-1">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/90">
              {OBSERVATION_BOTTLE.brand}
            </p>
            <h1
              id="observation-bottle-heading"
              className="lz-page-hero-heading mt-4 font-display font-bold tracking-tight text-white"
            >
              {OBSERVATION_BOTTLE.name}
            </h1>
            <p className="mt-4 text-xl font-medium text-cyan-200/95 sm:text-2xl">
              {OBSERVATION_BOTTLE.tagline}
            </p>
            <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-slate-300 sm:text-lg">
              Designed for the brief observation of Florida&apos;s naturally glowing lagoon waters —
              then returning the magic exactly where you found it.
            </p>
            {/* TODO(commerce): replace with purchase CTA when price, SKU, and inventory are implemented. */}
            <p className="mt-6 rounded-xl border border-cyan-400/20 bg-cyan-950/25 px-4 py-3 text-sm text-slate-300">
              Available on select bioluminescence experiences.{' '}
              <Link to="/bioluminescent-tours" className="font-semibold text-cyan-300 underline-offset-2 hover:underline">
                Book a tour
              </Link>{' '}
              or{' '}
              <Link to="/contact" className="font-semibold text-cyan-300 underline-offset-2 hover:underline">
                contact us
              </Link>{' '}
              for availability.
            </p>
          </div>
          <div className="order-1 lg:order-2">
            <div className="relative mx-auto w-full max-w-xl overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#050a14] shadow-[0_0_48px_rgba(0,207,255,0.15)] lg:max-w-none">
              <SmartImage
                src={OBSERVATION_BOTTLE.imagePath}
                alt={OBSERVATION_BOTTLE.imageAlt}
                priority
                width={1535}
                height={1024}
                sizes="(min-width: 1024px) 480px, 90vw"
                className="block h-auto w-full !object-contain"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Mission */}
      <section className="lz-home-section border-t border-cyan-500/10" aria-labelledby="mission-heading">
        <div className="lz-home-inner max-w-4xl">
          <h2 id="mission-heading" className="text-3xl font-bold text-white md:text-4xl">
            Our mission
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-slate-300">
            The Observation Bottle was created to help people experience one of Florida&apos;s most
            incredible natural wonders while encouraging responsible stewardship of our waterways.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {(['Observe.', 'Learn.', 'Return.'] as const).map((word) => (
              <div
                key={word}
                className="lz-card-glass flex items-center justify-center gap-2 p-6 text-center"
              >
                <Sparkles className="h-5 w-5 shrink-0 text-cyan-400" aria-hidden />
                <span className="text-lg font-semibold text-white">{word}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Description */}
      <section
        className="lz-home-section border-t border-cyan-500/10 bg-[#050a14]/50"
        aria-labelledby="description-heading"
      >
        <div className="lz-home-inner max-w-4xl">
          <h2 id="description-heading" className="text-3xl font-bold text-white md:text-4xl">
            Product description
          </h2>
          <div className="mt-6 space-y-5 text-lg leading-relaxed text-slate-300">
            <p>
              The Launch Zone Observation Bottle is designed for the brief observation of
              Florida&apos;s naturally glowing lagoon waters.
            </p>
            <p>
              During your adventure, gently collect a small amount of bioluminescent water, enjoy
              the natural light display for a few moments, learn about the fascinating organisms
              that create the glow, and then return the water to the exact location where it was
              collected.
            </p>
            <p className="font-medium text-slate-100">
              The goal isn&apos;t to keep nature. The goal is to experience it, appreciate it, and
              leave it exactly as you found it.
            </p>
          </div>
        </div>
      </section>

      {/* Features + How to use */}
      <section className="lz-home-section border-t border-cyan-500/10" aria-labelledby="features-heading">
        <div className="lz-home-inner">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <h2 id="features-heading" className="text-3xl font-bold text-white md:text-4xl">
                Features
              </h2>
              <ul className="mt-6 space-y-3">
                {OBSERVATION_BOTTLE_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-slate-300">
                    <Check className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" aria-hidden />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 id="how-to-use-heading" className="text-3xl font-bold text-white md:text-4xl">
                How to use
              </h2>
              <ol className="mt-6 space-y-4" aria-labelledby="how-to-use-heading">
                {OBSERVATION_BOTTLE_HOW_TO_USE.map((step, index) => (
                  <li key={step} className="flex gap-4">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-500/10 text-sm font-bold text-cyan-200"
                      aria-hidden
                    >
                      {index + 1}
                    </span>
                    <p className="pt-1 leading-relaxed text-slate-300">{step}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* Conservation + Fun fact */}
      <section
        className="lz-home-section border-t border-cyan-500/10 bg-gradient-to-b from-[#08121c]/80 to-[#020617]"
        aria-labelledby="conservation-heading"
      >
        <div className="lz-home-inner">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
            <div>
              <div className="mb-4 flex items-center gap-2 text-cyan-300">
                <Leaf className="h-6 w-6" aria-hidden />
                <h2 id="conservation-heading" className="text-3xl font-bold text-white md:text-4xl">
                  Conservation promise
                </h2>
              </div>
              <p className="text-lg leading-relaxed text-slate-300">
                Launch Zone Charters believes unforgettable experiences and environmental stewardship
                go hand in hand.
              </p>
              <p className="mt-4 text-slate-400">We encourage every guest to:</p>
              <ul className="mt-4 space-y-2">
                {OBSERVATION_BOTTLE_CONSERVATION.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-slate-300">
                    <Droplets className="mt-1 h-4 w-4 shrink-0 text-cyan-400" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-slate-300">
                This bottle is designed for education, appreciation, and conservation.
              </p>
            </div>
            <div className="lz-card-glass flex flex-col justify-center p-8">
              <h3 className="text-lg font-bold uppercase tracking-wider text-cyan-300">Fun fact</h3>
              <p className="mt-4 text-lg leading-relaxed text-slate-200">
                The blue glow is produced by tiny marine organisms that emit light when disturbed as
                part of a natural defense mechanism that has evolved over millions of years.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section
        className="lz-home-section border-t border-cyan-500/10"
        aria-labelledby="faq-heading"
      >
        <div className="lz-home-inner max-w-3xl">
          <h2 id="faq-heading" className="text-3xl font-bold text-white md:text-4xl">
            Frequently asked questions
          </h2>
          <div className="mt-8 space-y-3" role="list">
            {OBSERVATION_BOTTLE_FAQS.map((faq, index) => {
              const isOpen = openFaq === index;
              const panelId = `observation-faq-panel-${index}`;
              const buttonId = `observation-faq-button-${index}`;
              return (
                <div
                  key={faq.question}
                  className="overflow-hidden rounded-xl border border-white/10 bg-slate-950/50"
                  role="listitem"
                >
                  <button
                    id={buttonId}
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpenFaq(isOpen ? null : index)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-semibold text-white transition hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
                  >
                    <span>{faq.question}</span>
                    <ChevronDown
                      className={`h-5 w-5 shrink-0 text-cyan-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      aria-hidden
                    />
                  </button>
                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={buttonId}
                    hidden={!isOpen}
                    className="border-t border-white/5 px-5 py-4 text-sm leading-relaxed text-slate-300 sm:text-base"
                  >
                    {faq.answer}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Related links */}
      <section
        className="border-t border-cyan-500/15 bg-[#020617] px-4 py-14 sm:px-6 sm:py-16 lg:px-8"
        aria-labelledby="related-heading"
      >
        <div className="mx-auto max-w-3xl text-center">
          <h2 id="related-heading" className="text-2xl font-bold text-white sm:text-3xl">
            Explore the Space Coast
          </h2>
          <p className="mt-3 text-slate-400">
            Pair your observation experience with guides and conditions for Florida&apos;s lagoon.
          </p>
          <nav className="mt-8 flex flex-wrap items-center justify-center gap-3" aria-label="Related pages">
            {OBSERVATION_BOTTLE_RELATED_LINKS.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className="lz-btn-secondary px-5 py-2.5 text-sm"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </section>
    </div>
  );
}
