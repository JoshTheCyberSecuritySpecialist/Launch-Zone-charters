import { Link } from 'react-router-dom';
import { ArrowDown, CalendarClock } from 'lucide-react';
import {
  BIO_GUIDE_HERO_ALT,
  BIO_GUIDE_HERO_IMAGE,
  BIO_GUIDE_LAST_UPDATED,
  BIO_GUIDE_META,
} from '../../content/bioluminescence/meta';
import { wrapSyncClick } from '../../lib/clickPerf';

type PillarHeroProps = {
  readingTimeMinutes: number;
  onScrollToConditions: () => void;
};

export default function PillarHero({ readingTimeMinutes, onScrollToConditions }: PillarHeroProps) {
  return (
    <header className="relative overflow-hidden border-b border-white/10 bg-black">
      <div className="relative mx-auto max-w-[1920px]">
        <img
          src={BIO_GUIDE_HERO_IMAGE}
          alt={BIO_GUIDE_HERO_ALT}
          className="mx-auto block h-auto max-h-[min(52vh,640px)] w-full max-w-[1920px] object-contain object-center"
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-black/35 to-[#020617]"
          aria-hidden
        />
        <div className="absolute inset-x-0 bottom-0 px-4 pb-8 pt-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300/90">
              Space Coast · Indian River Lagoon
            </p>
            <h1 className="mt-3 text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
              {BIO_GUIDE_META.headline}
            </h1>
            <p
              className="mt-4 max-w-2xl text-base leading-relaxed text-slate-200 sm:text-lg bio-guide-speakable"
            >
              {BIO_GUIDE_META.subheading}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5 text-cyan-400/80" aria-hidden />
                Updated {BIO_GUIDE_LAST_UPDATED}
              </span>
              <span>{readingTimeMinutes} min read</span>
            </div>
            <div className="mt-6 flex flex-wrap gap-3 print:hidden">
              <Link
                to="/bioluminescent-tours"
                className="inline-flex items-center justify-center rounded-xl bg-[var(--lz-cta)] px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-950 shadow-lg transition hover:brightness-110"
              >
                Book a Bioluminescence Tour
              </Link>
              <button
                type="button"
                onClick={wrapSyncClick('bio_guide_hero_conditions', onScrollToConditions)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/35 bg-transparent px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200 transition hover:border-cyan-300/55 hover:bg-cyan-500/10"
              >
                View Tonight&apos;s Conditions
                <ArrowDown className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
