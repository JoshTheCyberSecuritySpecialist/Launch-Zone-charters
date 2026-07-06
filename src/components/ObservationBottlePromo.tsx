import { Link } from 'react-router-dom';
import SmartImage from './ui/SmartImage';
import { OBSERVATION_BOTTLE } from '../content/observationBottle';

type ObservationBottlePromoVariant = 'guide' | 'callout' | 'featured';

interface ObservationBottlePromoProps {
  variant?: ObservationBottlePromoVariant;
}

/**
 * Subtle cross-links to the Observation Bottle product page — not a full product rebuild.
 */
export default function ObservationBottlePromo({ variant = 'guide' }: ObservationBottlePromoProps) {
  if (variant === 'callout') {
    return (
      <aside
        className="mt-6 rounded-xl border border-cyan-400/15 bg-cyan-950/20 px-4 py-3 sm:px-5 sm:py-4"
        aria-label="Launch Zone Observation Bottle"
      >
        <p className="text-sm leading-relaxed text-slate-300">
          <span className="font-semibold text-cyan-200/95">Observe. Learn. Return.</span>{' '}
          Our reusable{' '}
          <Link
            to={OBSERVATION_BOTTLE.route}
            className="font-medium text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
          >
            Observation Bottle
          </Link>{' '}
          supports brief, responsible lagoon sampling on select bioluminescence experiences — then returning
          water to the same spot.
        </p>
      </aside>
    );
  }

  if (variant === 'featured') {
    return (
      <aside
        className="lz-card-glass flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-6"
        aria-label="Featured product: Launch Zone Observation Bottle"
      >
        <div className="mx-auto h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-cyan-400/15 bg-[#050a14] sm:mx-0">
          <SmartImage
            src={OBSERVATION_BOTTLE.imagePath}
            alt={OBSERVATION_BOTTLE.imageAlt}
            width={96}
            height={96}
            className="h-full w-full object-contain p-2"
          />
        </div>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300/90">
            From Launch Zone Charters
          </p>
          <p className="mt-1 font-semibold text-white">{OBSERVATION_BOTTLE.name}</p>
          <p className="mt-1 text-sm text-slate-400">{OBSERVATION_BOTTLE.tagline}</p>
          <Link
            to={OBSERVATION_BOTTLE.route}
            className="mt-3 inline-block text-sm font-medium text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
          >
            Learn about responsible observation
          </Link>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="mt-6 overflow-hidden rounded-xl border border-cyan-400/20 bg-slate-950/60 shadow-[0_0_24px_rgba(0,207,255,0.08)]"
      aria-labelledby="observation-bottle-promo-heading"
    >
      <div className="flex flex-col sm:flex-row">
        <div className="flex shrink-0 items-center justify-center bg-[#050a14] p-4 sm:w-36 md:w-40">
          <SmartImage
            src={OBSERVATION_BOTTLE.imagePath}
            alt={OBSERVATION_BOTTLE.imageAlt}
            width={120}
            height={120}
            className="h-28 w-28 object-contain sm:h-24 sm:w-24"
          />
        </div>
        <div className="flex flex-1 flex-col justify-center p-5 sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300/90">
            Conservation tool
          </p>
          <h3 id="observation-bottle-promo-heading" className="mt-1 text-lg font-semibold text-white">
            {OBSERVATION_BOTTLE.name}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            {OBSERVATION_BOTTLE.tagline} A reusable bottle for brief lagoon observation — collect a small
            sample, learn about the organisms that glow, and return the water where you found it.
          </p>
          <Link
            to={OBSERVATION_BOTTLE.route}
            className="mt-4 inline-flex w-fit text-sm font-medium text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
          >
            See how the Observation Bottle works
          </Link>
        </div>
      </div>
    </aside>
  );
}
