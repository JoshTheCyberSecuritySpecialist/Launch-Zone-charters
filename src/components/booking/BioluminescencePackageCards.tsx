import { Check } from 'lucide-react';
import {
  BIO_PACKAGE_DISPLAY,
  type BioPackageDisplay,
  type BioPackageId,
} from '../../lib/bioluminescencePackages';

type Props = {
  selectedPackageId?: BioPackageId | null;
  onSelect: (packageId: BioPackageId) => void;
  /** When true, cards navigate via onSelect only (parent handles routing). */
  compact?: boolean;
};

function formatUsd(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

function PackageCard({
  pkg,
  selected,
  onSelect,
}: {
  pkg: BioPackageDisplay;
  selected: boolean;
  onSelect: (id: BioPackageId) => void;
}) {
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
        {pkg.guestCount === 1 ? '1 Guest' : `${pkg.guestCount} Guests`}
      </p>
      <div className="mt-4">
        {pkg.promotionActive ? (
          <>
            <p className="text-base text-slate-500 line-through">{formatUsd(pkg.regularPriceUsd)}</p>
            <p className="mt-1 text-3xl font-bold text-white md:text-4xl">{formatUsd(pkg.directPriceUsd)}</p>
            {pkg.promotionLabel ? (
              <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--lz-cta)]">
                {pkg.promotionLabel}
              </p>
            ) : null}
            {pkg.savingsUsd > 0 ? (
              <p className="mt-1 text-sm font-medium text-emerald-300/95">Save {formatUsd(pkg.savingsUsd)}</p>
            ) : null}
          </>
        ) : (
          <p className="text-3xl font-bold text-white md:text-4xl">{formatUsd(pkg.directPriceUsd)}</p>
        )}
        {pkg.guestCount > 1 ? (
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">Total</p>
        ) : null}
        <p className="mt-1 text-sm text-cyan-100/85">{formatUsd(pkg.perGuestUsd)} per person</p>
      </div>
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

export default function BioluminescencePackageCards({ selectedPackageId, onSelect }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-4">
      {BIO_PACKAGE_DISPLAY.map((pkg) => (
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
