import { Fragment, lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { Loader2, Printer, Share2 } from 'lucide-react';
import PillarHero from '../components/bio-guide/PillarHero';
import PillarTOC from '../components/bio-guide/PillarTOC';
import ReadingProgressBar from '../components/bio-guide/ReadingProgressBar';
import BioSection from '../components/bio-guide/BioSection';
import LiveBioConditionsWidget from '../components/bio-guide/LiveBioConditionsWidget';
import BioSchema from '../components/bio-guide/BioSchema';
import BioFloatingTocHighlight from '../components/bio-guide/BioFloatingTocHighlight';
import ObservationBottlePromo from '../components/ObservationBottlePromo';
import { BioBackToTop } from '../components/bio-guide/BioSectionNav';
import {
  BIO_GUIDE_HERO_IMAGE,
  BIO_GUIDE_META,
  BIO_GUIDE_WPM,
} from '../content/bioluminescence/meta';
import { BIO_GUIDE_FAQS } from '../content/bioluminescence/faqs';
import {
  BIO_GUIDE_SECTIONS,
  bioGuideTocItems,
  bioGuideWordCount,
} from '../content/bioluminescence/sections';
import { siteOrigin } from '../lib/siteOrigin';
import { wrapSyncClick } from '../lib/clickPerf';

const WeeklyForecast = lazy(() => import('../components/WeeklyForecast'));
const InternalLinkGrid = lazy(() => import('../components/bio-guide/InternalLinkGrid'));
const BioFAQ = lazy(() => import('../components/bio-guide/BioFAQ'));
const BioSeasonalDashboard = lazy(() => import('../components/bio-guide/BioSeasonalDashboard'));
const BioComparisonTable = lazy(() => import('../components/bio-guide/BioComparisonTable'));
const BioViewingTimeline = lazy(() => import('../components/bio-guide/BioViewingTimeline'));

function LazySectionFallback() {
  return (
    <div className="flex items-center justify-center py-12 text-sm text-slate-400" role="status">
      <Loader2 className="mr-2 h-5 w-5 animate-spin text-cyan-400 motion-reduce:animate-none" aria-hidden />
      Loading…
    </div>
  );
}

interface BioGuidePageProps {
  onNavigate: (page: string) => void;
}

export default function BioGuidePage({ onNavigate }: BioGuidePageProps) {
  void onNavigate;

  const canonicalUrl = useMemo(() => `${siteOrigin()}/bioluminescence`, []);
  const sectionWordCount = useMemo(() => bioGuideWordCount(), []);
  const faqWordCount = useMemo(
    () =>
      BIO_GUIDE_FAQS.reduce(
        (n, f) => n + f.question.split(/\s+/).length + f.answer.split(/\s+/).length,
        0
      ),
    []
  );
  const totalWordCount = sectionWordCount + faqWordCount;
  const readingTimeMinutes = Math.max(1, Math.ceil(totalWordCount / BIO_GUIDE_WPM));
  const tocItems = useMemo(() => bioGuideTocItems(), []);
  const [activeTocTitle, setActiveTocTitle] = useState<string | null>(tocItems[0]?.title ?? null);

  const scrollToConditions = useCallback(() => {
    const el = document.getElementById('tonights-conditions');
    if (!el) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
  }, []);

  const handleShare = useCallback(async () => {
    const url = canonicalUrl;
    const title = BIO_GUIDE_META.headline;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* fall through */
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    }
  }, [canonicalUrl]);

  const handlePrint = useCallback(() => {
    window.print();
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
        <meta property="og:image" content={`${siteOrigin()}${BIO_GUIDE_HERO_IMAGE}`} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={BIO_GUIDE_META.title} />
        <meta name="twitter:description" content={BIO_GUIDE_META.description} />
        <meta name="twitter:image" content={`${siteOrigin()}${BIO_GUIDE_HERO_IMAGE}`} />
        <BioSchema canonicalUrl={canonicalUrl} wordCount={totalWordCount} />
      </Helmet>

      <ReadingProgressBar />
      <BioFloatingTocHighlight activeTitle={activeTocTitle} />
      <BioBackToTop />

      <PillarHero readingTimeMinutes={readingTimeMinutes} onScrollToConditions={scrollToConditions} />

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <nav aria-label="Breadcrumb" className="text-xs text-slate-500">
            <ol className="flex flex-wrap items-center gap-1">
              <li>
                <Link
                  to="/"
                  className="hover:text-cyan-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
                >
                  Home
                </Link>
              </li>
              <li aria-hidden>/</li>
              <li className="text-slate-300" aria-current="page">
                Bioluminescence Guide
              </li>
            </ol>
          </nav>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={wrapSyncClick('bio_guide_share', () => void handleShare())}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
              aria-label="Share this guide"
            >
              <Share2 className="h-3.5 w-3.5" aria-hidden />
              Share
            </button>
            <button
              type="button"
              onClick={wrapSyncClick('bio_guide_print', handlePrint)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
              aria-label="Print this guide"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden />
              Print
            </button>
          </div>
        </div>

        <div className="lg:grid lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <PillarTOC items={tocItems} onActiveTitleChange={setActiveTocTitle} />

          <article className="min-w-0 max-w-3xl lg:max-w-none xl:max-w-3xl">
            <p className="bio-guide-speakable mb-8 text-base leading-relaxed text-slate-300">
              This guide explains how bioluminescence works on Florida&apos;s east-coast lagoons, when conditions
              tend to favor visibility, and how to observe responsibly. For captain-led trips from Titusville, see our{' '}
              <Link
                to="/bioluminescent-tours"
                className="text-cyan-300 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
              >
                bioluminescent tours page
              </Link>
              .
            </p>

            <Suspense fallback={<LazySectionFallback />}>
              <BioSeasonalDashboard />
            </Suspense>

            <div className="space-y-10">
              {BIO_GUIDE_SECTIONS.map((section, index) => {
                const prev =
                  index > 0
                    ? { id: BIO_GUIDE_SECTIONS[index - 1].id, title: BIO_GUIDE_SECTIONS[index - 1].title }
                    : undefined;
                const next =
                  index < BIO_GUIDE_SECTIONS.length - 1
                    ? {
                        id: BIO_GUIDE_SECTIONS[index + 1].id,
                        title: BIO_GUIDE_SECTIONS[index + 1].title,
                      }
                    : undefined;

                return (
                  <Fragment key={section.id}>
                    <BioSection
                      id={section.id}
                      title={section.title}
                      paragraphs={section.paragraphs}
                      subsections={section.subsections}
                      relatedLinks={section.relatedLinks}
                      prev={prev}
                      next={next}
                    />
                    {section.id === 'responsible-observation-ethics' ? (
                      <ObservationBottlePromo variant="guide" />
                    ) : null}
                    {section.id === 'dinoflagellates-comb-jellies' ? (
                      <Suspense fallback={<LazySectionFallback />}>
                        <BioComparisonTable />
                      </Suspense>
                    ) : null}
                    {section.id === 'best-time-florida' ? (
                      <Suspense fallback={<LazySectionFallback />}>
                        <BioViewingTimeline />
                      </Suspense>
                    ) : null}
                  </Fragment>
                );
              })}
            </div>

            <div className="mt-10">
              <LiveBioConditionsWidget />
            </div>

            <section id="weekly-outlook" className="scroll-mt-28 mt-10 print:hidden">
              <Suspense fallback={<LazySectionFallback />}>
                <WeeklyForecast
                  embedded
                  heading="Weekly bioluminescence outlook"
                  subheading="Same model as our tour page — load when you want a multi-day view."
                  loadButtonLabel="Load 7-day outlook"
                  layout="horizontal"
                />
              </Suspense>
            </section>

            <Suspense fallback={<LazySectionFallback />}>
              <InternalLinkGrid />
            </Suspense>

            <Suspense fallback={<LazySectionFallback />}>
              <BioFAQ />
            </Suspense>

            <aside className="mt-12 rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-950/30 to-slate-950/50 p-6 print:hidden">
              <h2 className="text-lg font-bold text-white">Ready for a night on the lagoon?</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                A captain-led charter handles navigation, lighting, and realistic timing — especially if you are new
                to night boating on the Indian River Lagoon.
              </p>
              <Link
                to="/bioluminescent-tours"
                className="mt-4 inline-flex rounded-xl bg-[var(--lz-cta)] px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-slate-950 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
              >
                View tours &amp; book
              </Link>
            </aside>
          </article>
        </div>
      </div>
    </div>
  );
}
