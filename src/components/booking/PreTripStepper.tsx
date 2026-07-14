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
  const current = steps[currentIndex];

  return (
    <nav aria-label="Form progress" className={className}>
      <p className="text-lg font-bold text-white" aria-live="polite">
        Step {currentIndex + 1} of {steps.length}
        {current ? `: ${current.label}` : ''}
      </p>

      <ol className="mt-4 space-y-3">
        {steps.map((step, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;
          return (
            <li
              key={step.key}
              className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 py-3 ${
                active
                  ? 'border-[var(--lz-cta)]/45 bg-[var(--lz-cta)]/10'
                  : done
                    ? 'border-emerald-400/30 bg-emerald-950/20'
                    : 'border-white/10 bg-slate-950/35'
              }`}
            >
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold ${
                  done
                    ? 'bg-emerald-500/30 text-emerald-100'
                    : active
                      ? 'bg-[var(--lz-cta)]/35 text-white'
                      : 'bg-slate-800 text-slate-300'
                }`}
                aria-current={active ? 'step' : undefined}
              >
                {done ? '✓' : index + 1}
              </span>
              <span
                className={`text-lg font-semibold ${
                  active ? 'text-white' : done ? 'text-emerald-100' : 'text-slate-300'
                }`}
              >
                {step.label}
              </span>
              <span className="sr-only">
                {done ? 'Completed' : active ? 'Current step' : 'Not started'}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
