import { Check } from 'lucide-react';
import {
  ROCKET_DUO_EXTRA_DISCLOSURE,
  ROCKET_PACKAGE_DISPLAY,
  ROCKET_PRIVATE_CHARTER_DESCRIPTION,
  ROCKET_SHARED_CHARTER_DISCLOSURE,
  type RocketPackageDisplay,
  type RocketPackageId,
} from '../../lib/rocketLaunchPackages';

type Props = {
  selectedPackageId?: RocketPackageId | null;
  onSelect: (packageId: RocketPackageId) => void;
};

function formatUsd(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

function SharedDisclosure({ pkg }: { pkg: RocketPackageDisplay }) {
  return (
    <div
      className="mt-4 rounded-xl border border-amber-400/30 bg-amber-950/25 p-3 text-sm leading-relaxed text-amber-50/95"
      role="note"
    >
      <p className="text-xs font-bold uppercase tracking-wide text-amber-200/95">
        Shared charter — minimum guests required
      </p>
      <p className="mt-2">{ROCKET_SHARED_CHARTER_DISCLOSURE}</p>
      {pkg.id === 'rocket_duo' ? <p className="mt-2 font-medium text-amber-100/90">{ROCKET_DUO_EXTRA_DISCLOSURE}</p> : null}
    </div>
  );
}

function PackageCard({
  pkg,
  selected,
  onSelect,
}: {
  pkg: RocketPackageDisplay;
  selected: boolean;
  onSelect: (id: RocketPackageId) => void;
}) {
  const isPrivate = pkg.seating === 'private';

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
      <p className="mt-1 text-sm text-slate-400">
        {isPrivate ? 'Up to 5 guests' : pkg.guestCount === 1 ? '1 Person · Shared' : `${pkg.guestCount} People · Shared`}
      </p>
      <div className="mt-4">
        <p className="text-3xl font-bold text-white md:text-4xl">{formatUsd(pkg.directPriceUsd)}</p>
        {!isPrivate ? (
          <p className="mt-1 text-sm text-cyan-100/85">{formatUsd(pkg.perGuestUsd)} per person</p>
        ) : (
          <p className="mt-1 text-sm text-cyan-100/85">Flat rate · entire boat</p>
        )}
      </div>
      {isPrivate ? (
        <p className="mt-4 text-sm leading-relaxed text-slate-300">{ROCKET_PRIVATE_CHARTER_DESCRIPTION}</p>
      ) : (
        <SharedDisclosure pkg={pkg} />
      )}
      <ul className="mt-4 space-y-2 text-sm text-slate-300">
        {pkg.included.map((line) => (
          <li key={line} className="flex items-center gap-2">
            <Check className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden />
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

export default function RocketLaunchPackageCards({ selectedPackageId, onSelect }: Props) {
  return (
    <div className="grid gap-4 sm:gap-5 md:grid-cols-3">
      {ROCKET_PACKAGE_DISPLAY.map((pkg) => (
        <PackageCard
          key={pkg.id}
          pkg={pkg}
          selected={selectedPackageId === pkg.id}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
