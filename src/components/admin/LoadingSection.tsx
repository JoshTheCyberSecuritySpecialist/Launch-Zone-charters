type LoadingSectionProps = {
  message?: string;
  className?: string;
};

/** Inline section loader — keeps AdminShell/header visible. */
export default function LoadingSection({
  message = 'Loading…',
  className = '',
}: LoadingSectionProps) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm ${className}`.trim()}
      role="status"
      aria-live="polite"
    >
      <p className="text-base font-semibold text-slate-700">{message}</p>
    </div>
  );
}
