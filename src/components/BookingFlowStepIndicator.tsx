import { Check } from 'lucide-react';

const STEPS_RENTAL = [
  { id: 1 as const, short: 'Details', label: 'Details' },
  { id: 2 as const, short: 'Add-ons', label: 'Add-ons' },
  { id: 3 as const, short: 'Payment', label: 'Payment' },
];

const STEPS_CHARTER = [
  { id: 1 as const, short: 'Details', label: 'Details' },
  { id: 2 as const, short: 'Experience', label: 'Experience' },
  { id: 3 as const, short: 'Payment', label: 'Payment' },
];

/** Step 1–3 = active booking step; step 4 = flow complete (all prior steps checked). */
export type BookingFlowStep = 1 | 2 | 3 | 4;

type BookingFlowStepIndicatorProps = {
  /** Active step (1–3), or 4 when checkout/verification is done. */
  currentStep: BookingFlowStep;
  /** Charter shows "Experience" on step 2; rental shows "Add-ons". */
  flow?: 'charter' | 'rental';
  className?: string;
};

export default function BookingFlowStepIndicator({
  currentStep,
  flow = 'rental',
  className = '',
}: BookingFlowStepIndicatorProps) {
  const STEPS = flow === 'charter' ? STEPS_CHARTER : STEPS_RENTAL;

  return (
    <nav className={`lz-booking-flow-steps ${className}`.trim()} aria-label="Booking progress">
      <ol className="flex min-w-0 items-start justify-between gap-0 overflow-x-auto pb-1 pt-0.5 [scrollbar-width:thin]">
        {STEPS.map((s, index) => {
          const isComplete = currentStep > s.id;
          const isCurrent = currentStep === s.id;

          return (
            <li
              key={s.id}
              className="flex min-w-[4.5rem] flex-1 flex-col items-center last:min-w-[4.75rem] sm:min-w-0"
              aria-current={isCurrent ? 'step' : undefined}
            >
              <div className="flex w-full items-center">
                {index > 0 && (
                  <div
                    className={`h-[2px] min-w-[6px] flex-1 rounded-full ${
                      currentStep > STEPS[index - 1].id ? 'bg-cyan-400/70' : 'bg-white/12'
                    }`}
                    aria-hidden
                  />
                )}
                <div
                  className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-all sm:h-9 sm:w-9 sm:text-sm ${
                    isComplete
                      ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.25)]'
                      : isCurrent
                        ? 'border-[var(--lz-cta)] bg-[rgba(255,140,43,0.15)] text-white shadow-[0_0_16px_rgba(255,140,43,0.35)]'
                        : 'border-white/20 bg-slate-950/40 text-slate-500'
                  }`}
                >
                  {isComplete ? <Check className="h-4 w-4 text-cyan-200" strokeWidth={2.5} aria-hidden /> : s.id}
                </div>
                {index < STEPS.length - 1 && (
                  <div
                    className={`h-[2px] min-w-[6px] flex-1 rounded-full ${
                      currentStep > s.id ? 'bg-cyan-400/70' : 'bg-white/12'
                    }`}
                    aria-hidden
                  />
                )}
              </div>
              <span
                className={`mt-1.5 max-w-[6rem] text-center text-[10px] font-semibold uppercase leading-tight tracking-wide sm:max-w-none sm:text-xs ${
                  isCurrent ? 'text-cyan-100' : isComplete ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                <span className="sm:hidden">{s.short}</span>
                <span className="hidden sm:inline">{s.label}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
