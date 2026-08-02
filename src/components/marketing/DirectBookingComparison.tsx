import { Check, Minus } from 'lucide-react';

const DIRECT_ROWS = [
  'Communicate with the local booking team',
  'No separate voucher-redemption step',
  'Request dates directly on the website',
  'Secure Stripe payment at online checkout',
  'Access trip details and waiver links directly',
  'Support a locally owned business',
  'Same standard package pricing',
] as const;

const MARKETPLACE_ROWS = [
  'Purchase may happen separately from scheduling',
  'Voucher redemption may still be required',
  'Preferred dates still depend on availability',
  'Marketplace promotions and terms may vary',
  'Third-party support policies may apply',
] as const;

export default function DirectBookingComparison() {
  return (
    <div className="mt-12">
      <h3 className="text-center font-display text-xl font-bold uppercase tracking-[0.12em] text-white md:text-2xl">
        Why Guests Choose to Book Direct
      </h3>
      <div className="mt-8 hidden gap-6 md:grid md:grid-cols-2">
        <div className="lz-card-glass border border-cyan-400/20 p-6 md:p-8">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-200">Book Direct</p>
          <ul className="mt-5 space-y-3 text-sm text-slate-200">
            {DIRECT_ROWS.map((row) => (
              <li key={row} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
                <span>{row}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="lz-card-glass border border-white/10 p-6 md:p-8">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
            Third-Party Marketplace
          </p>
          <ul className="mt-5 space-y-3 text-sm text-slate-300">
            {MARKETPLACE_ROWS.map((row) => (
              <li key={row} className="flex gap-2">
                <Minus className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                <span>{row}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-8 space-y-4 md:hidden">
        <div className="lz-card-glass border border-cyan-400/20 p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Book Direct</p>
          <ul className="mt-4 space-y-2.5 text-sm text-slate-200">
            {DIRECT_ROWS.map((row) => (
              <li key={row} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
                <span>{row}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="lz-card-glass border border-white/10 p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
            Third-Party Marketplace
          </p>
          <ul className="mt-4 space-y-2.5 text-sm text-slate-300">
            {MARKETPLACE_ROWS.map((row) => (
              <li key={row} className="flex gap-2">
                <Minus className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                <span>{row}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
