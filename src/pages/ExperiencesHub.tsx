import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import {
  CHARTER_GUEST_LIMIT_LABEL,
  EXPERIENCE_CATALOG_ORDER,
  type ExperienceCatalogEntry,
} from '../lib/experienceCatalog';

interface ExperiencesHubProps {
  onNavigate: (page: string) => void;
}

function KindBadge({ kind }: { kind: 'captain-led' | 'self-drive' }) {
  return (
    <span
      className={
        kind === 'captain-led'
          ? 'inline-flex rounded-full border border-cyan-400/35 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100'
          : 'inline-flex rounded-full border border-amber-400/35 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100'
      }
    >
      {kind === 'captain-led' ? 'Captain-led' : 'Self-drive rental'}
    </span>
  );
}

function ExperienceCard({ entry }: { entry: ExperienceCatalogEntry }) {
  if (entry.id === 'rental') {
    return (
      <article className="lz-card-glass flex h-full flex-col border-white/10 p-6 md:p-7">
        <p className="text-3xl" aria-hidden>
          {entry.icon}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <KindBadge kind={entry.kind} />
        </div>
        <h2 className="mt-3 font-display text-xl font-bold text-white">{entry.publicName}</h2>
        <p className="mt-2 text-sm text-slate-300">{entry.tagline}</p>
        <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-400">{entry.locationLabel}</p>
        <p className="mt-3 text-xs text-slate-400">
          Deposit and renter insurance required · Captain optional add-on on rentals
        </p>
        <div className="mt-auto flex flex-col gap-2 pt-6">
          <Link
            to={entry.marketingUrlDaytona}
            className="lz-btn-secondary w-full justify-center text-center"
          >
            Daytona &amp; Port Orange
          </Link>
          <Link
            to={entry.marketingUrlTitusville}
            className="lz-btn-secondary w-full justify-center text-center"
          >
            Titusville rentals
          </Link>
        </div>
      </article>
    );
  }

  const marketingTo =
    entry.id === 'sunset' ? '/experiences#sunset-wildlife' : entry.marketingUrl;

  return (
    <article
      id={entry.id === 'sunset' ? 'sunset-wildlife' : undefined}
      className="lz-card-glass flex h-full flex-col border-white/10 p-6 md:p-7"
    >
      <p className="text-3xl" aria-hidden>
        {entry.icon}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <KindBadge kind={entry.kind} />
        {entry.id === 'bio' ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Nighttime</span>
        ) : null}
      </div>
      <h2 className="mt-3 font-display text-xl font-bold text-white">{entry.publicName}</h2>
      <p className="mt-2 text-sm text-slate-300">{entry.tagline}</p>
      {entry.id === 'bio' ? (
        <p className="mt-2 text-sm font-semibold text-cyan-100/90">Packages available for one, two, or four guests.</p>
      ) : null}
      {entry.wildlifeDisclaimer ? (
        <p className="mt-2 text-xs text-slate-400">{entry.wildlifeDisclaimer}</p>
      ) : null}
      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-400">{entry.locationLabel}</p>
      {entry.kind === 'captain-led' ? (
        <p className="mt-2 text-xs text-cyan-100/80">{CHARTER_GUEST_LIMIT_LABEL}</p>
      ) : null}
      <div className="mt-auto flex flex-col gap-2 pt-6 sm:flex-row">
        <Link to={marketingTo} className="lz-btn-secondary flex-1 justify-center text-center">
          Learn more
        </Link>
        <Link to={entry.bookingUrl} className="lz-btn-primary flex-1 justify-center text-center">
          {entry.bookCta}
        </Link>
      </div>
    </article>
  );
}

export default function ExperiencesHub({ onNavigate }: ExperiencesHubProps) {
  void onNavigate;

  return (
    <div className="min-h-screen bg-lz-bg text-slate-100">
      <Helmet prioritizeSeoTags>
        <title>Space Coast Boat Experiences | Launch Zone Charters</title>
        <meta
          name="description"
          content="Choose a captain-led bioluminescence tour, rocket launch charter, sunset and wildlife cruise, or self-drive boat rental with Launch Zone Charters."
        />
        <link rel="canonical" href="https://launchzonecharters.com/experiences" />
      </Helmet>

      <section className="lz-page-hero py-14 md:py-20">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/90">Launch Zone Charters</p>
          <h1 className="lz-page-hero-heading mt-3 font-display text-white">Choose your experience</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-300 md:text-lg">
            Pick a captain-led charter or a self-drive rental. Each product has its own requirements, pricing, and
            booking path.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8" aria-labelledby="experiences-grid-heading">
        <h2 id="experiences-grid-heading" className="sr-only">
          Available experiences
        </h2>
        <div className="grid gap-6 md:grid-cols-2">
          {EXPERIENCE_CATALOG_ORDER.map((entry) => (
            <ExperienceCard key={entry.id} entry={entry} />
          ))}
        </div>

        <div className="mt-12 rounded-2xl border border-white/10 bg-slate-950/40 px-5 py-6 text-center text-sm text-slate-400">
          <p>
            Already purchased a Groupon voucher?{' '}
            <Link to="/booking/groupon" className="font-semibold text-cyan-300 underline underline-offset-2">
              Redeem it here
            </Link>
            . Direct booking and Groupon redemption use separate checkout flows.
          </p>
        </div>
      </section>
    </div>
  );
}
