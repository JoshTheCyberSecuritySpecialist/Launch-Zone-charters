interface WaiversHelpCardProps {
  className?: string;
}

const HELP_PHONE_DISPLAY = '803-542-1761';
const HELP_PHONE_HREF = 'tel:8035421761';

export default function WaiversHelpCard({ className = '' }: WaiversHelpCardProps) {
  return (
    <aside
      className={`rounded-2xl border border-white/10 bg-slate-950/45 px-5 py-5 text-left ${className}`}
      aria-label="Need help"
    >
      <h2 className="text-lg font-semibold text-white">Need Help?</h2>
      <p className="mt-2 text-base leading-relaxed text-slate-300 sm:text-[17px]">
        Call or text Launch Zone Charters and we&apos;ll help you complete your documents.
      </p>
      <a
        href={HELP_PHONE_HREF}
        className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-950/30 px-5 py-3.5 text-lg font-semibold text-cyan-100 hover:bg-cyan-950/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
      >
        Call or Text Us · {HELP_PHONE_DISPLAY}
      </a>
    </aside>
  );
}
