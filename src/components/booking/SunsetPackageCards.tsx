import { Check } from 'lucide-react';
import PackageDurationLine from './PackageDurationLine';
import {
  SUNSET_PACKAGE_DISPLAY,
  SUNSET_PRIVATE_CHARTER_DESCRIPTION,
  SUNSET_SOLO_JOIN_DISCLOSURE,
  SUNSET_TOUR_PAGE,
  SUNSET_TWO_OPENER_DISCLOSURE,
  SUNSET_WILDLIFE_DISCLAIMER,
  type SunsetPackageDisplay,
  type SunsetPackageId,
} from '../../lib/sunsetPackages';

type Props = {
  selectedPackageId?: SunsetPackageId | null;
  onSelect: (packageId: SunsetPackageId) => void;
  /** When false, omit page intro (parent already shows heading/notices). Default true. */
  showIntro?: boolean;
};

function formatUsd(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

function guestLine(pkg: SunsetPackageDisplay): string {
  if (pkg.seating === 'private') {
    return `Up to ${pkg.maxGuests ?? 5} guests · Private boat`;
  }
  if (pkg.guestCount === 1) return '1 guest · Shared tour';
  return `${pkg.guestCount} guests · Shared tour`;
}

function departureRoleLabel(pkg: SunsetPackageDisplay): string {
  if (pkg.seating === 'private') return 'Private — no other guests join';
  if (pkg.id === 'sunset_solo' || !pkg.canOpenSharedDeparture) {
    return 'Joins an existing paid shared departure';
  }
  return 'Opens a shared departure';
}

function SharedDisclosure({ pkg }: { pkg: SunsetPackageDisplay }) {
  const isSolo = pkg.id === 'sunset_solo' || !pkg.canOpenSharedDeparture;
  return (
    <div
      className="mt-4 rounded-xl border border-amber-400/30 bg-amber-950/25 p-3 text-sm leading-relaxed text-amber-50/95"
      role="note"
    >
      <p className="text-xs font-bold uppercase tracking-wide text-amber-200/95">
        {isSolo ? 'Join-only shared seat' : 'Opens shared departure'}
      </p>
      <p className="mt-2">{isSolo ? SUNSET_SOLO_JOIN_DISCLOSURE : SUNSET_TWO_OPENER_DISCLOSURE}</p>
    </div>
  );
}

function PackageCard({
  pkg,
  selected,
  onSelect,
}: {
  pkg: SunsetPackageDisplay;
  selected: boolean;
  onSelect: (id: SunsetPackageId) => void;
}) {
  const isPrivate = pkg.seating === 'private';
  const maxGuests = pkg.maxGuests ?? pkg.guestCount;

  return (
    <article
      className={`flex h-full flex-col rounded-2xl border p-5 shadow-lg transition md:p-6 ${
        selected
          ? 'border-[var(--lz-cta)] bg-[rgba(255,140,43,0.12)] shadow-[0_0_24px_rgba(255,140,43,0.18)]'
          : 'border-white/12 bg-slate-950/55 hover:border-cyan-400/35'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-white md:text-xl">{pkg.cardTitle}</h3>
        {pkg.badge ? (
          <span className="rounded-full bg-[var(--lz-cta)] px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-[#02111f]">
            {pkg.badge}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-slate-400">{guestLine(pkg)}</p>
      <PackageDurationLine durationMinutes={pkg.durationMinutes} />
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-cyan-200/80">
        {departureRoleLabel(pkg)}
      </p>
      <div className="mt-4">
        <p className="text-3xl font-bold text-white md:text-4xl">{formatUsd(pkg.directPriceUsd)}</p>
        <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">
          {isPrivate ? 'Flat rate total' : 'Total'}
        </p>
        {!isPrivate ? (
          <p className="mt-1 text-sm text-cyan-100/85">{formatUsd(pkg.perGuestUsd)} per person</p>
        ) : (
          <p className="mt-1 text-sm text-cyan-100/85">
            Same price for 1–{maxGuests} guests · private boat
          </p>
        )}
      </div>
      {isPrivate ? (
        <p className="mt-4 text-sm leading-relaxed text-slate-300">{SUNSET_PRIVATE_CHARTER_DESCRIPTION}</p>
      ) : (
        <SharedDisclosure pkg={pkg} />
      )}
      <ul className="mt-4 space-y-2 text-sm text-slate-300">
        {pkg.included.map((line) => (
          <li key={line} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onSelect(pkg.id)}
        className={`lz-btn-primary mt-6 min-h-[48px] w-full justify-center text-sm font-semibold uppercase tracking-[0.1em] ${
          selected ? 'ring-2 ring-white/25' : ''
        }`}
      >
        {selected ? 'Selected' : pkg.ctaLabel}
      </button>
    </article>
  );
}

export default function SunsetPackageCards({
  selectedPackageId,
  onSelect,
  showIntro = true,
}: Props) {
  return (
    <div className="space-y-4">
      {showIntro ? (
        <div className="space-y-3">
          <p
            className="rounded-xl border border-cyan-400/20 bg-cyan-950/20 px-4 py-3 text-sm leading-relaxed text-cyan-50"
            role="note"
          >
            {SUNSET_TOUR_PAGE.directBookingMessage}
          </p>
          <p className="text-sm leading-relaxed text-slate-400">{SUNSET_WILDLIFE_DISCLAIMER}</p>
        </div>
      ) : null}
      <div className="grid gap-4 sm:gap-5 md:grid-cols-2">
        {SUNSET_PACKAGE_DISPLAY.map((pkg) => (
          <PackageCard
            key={pkg.id}
            pkg={pkg}
            selected={selectedPackageId === pkg.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
