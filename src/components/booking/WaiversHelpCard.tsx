interface WaiversHelpCardProps {
  className?: string;
}

export default function WaiversHelpCard({ className = '' }: WaiversHelpCardProps) {
  return (
    <aside
      className={`rounded-2xl border border-cyan-400/20 bg-slate-950/50 px-5 py-5 text-left ${className}`}
      aria-label="Need help"
    >
      <h2 className="text-lg font-bold text-white">Need help?</h2>
      <p className="mt-2 text-lg leading-relaxed text-slate-200">
        Call or text Launch Zone Charters at{' '}
        <a
          href="tel:8035421761"
          className="font-semibold text-cyan-200 underline decoration-cyan-400/50 underline-offset-2"
        >
          803-542-1761
        </a>
        . We can help you complete this form.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-base leading-relaxed text-slate-300">
        <li>Your progress is saved automatically.</li>
        <li>You can return to this page if you need more time.</li>
        <li>You will not need to start over.</li>
      </ul>
    </aside>
  );
}
