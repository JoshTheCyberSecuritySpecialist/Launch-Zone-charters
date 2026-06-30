interface PreTripStepperProps {
  steps: { key: string; label: string }[];
  currentKey: string;
  className?: string;
}

export default function PreTripStepper({ steps, currentKey, className = '' }: PreTripStepperProps) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((s) => s.key === currentKey)
  );

  return (
    <nav aria-label="Progress" className={`mb-6 ${className}`}>
      <ol className="flex items-center justify-between gap-1">
        {steps.map((step, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;
          return (
            <li key={step.key} className="flex flex-1 flex-col items-center gap-1">
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                  done
                    ? 'bg-emerald-500/25 text-emerald-200 ring-2 ring-emerald-400/40'
                    : active
                      ? 'bg-[var(--lz-cta)]/25 text-white ring-2 ring-[var(--lz-cta)]/50'
                      : 'bg-slate-800/80 text-slate-500 ring-1 ring-white/10'
                }`}
                aria-current={active ? 'step' : undefined}
              >
                {done ? '✓' : index + 1}
              </span>
              <span
                className={`hidden text-center text-[10px] font-semibold uppercase leading-tight tracking-wide sm:block ${
                  active ? 'text-cyan-100' : done ? 'text-emerald-200/80' : 'text-slate-500'
                }`}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-center text-sm font-semibold text-cyan-100 sm:hidden">
        Step {currentIndex + 1} of {steps.length}: {steps[currentIndex]?.label}
      </p>
    </nav>
  );
}
