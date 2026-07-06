import { ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { wrapSyncClick } from '../../lib/clickPerf';

type BioSectionNavProps = {
  prev?: { id: string; title: string };
  next?: { id: string; title: string };
};

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
}

export default function BioSectionNav({ prev, next }: BioSectionNavProps) {
  return (
    <nav
      className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-6 print:hidden"
      aria-label="Section navigation"
    >
      {prev ? (
        <button
          type="button"
          onClick={wrapSyncClick('bio_guide_prev_section', () => scrollToId(prev.id))}
          className="inline-flex max-w-[48%] items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-left text-xs text-slate-300 transition hover:border-cyan-500/30 hover:text-cyan-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
        >
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            <span className="block text-[10px] uppercase tracking-wide text-slate-500">Previous</span>
            <span className="font-medium">{prev.title}</span>
          </span>
        </button>
      ) : (
        <span />
      )}
      {next ? (
        <button
          type="button"
          onClick={wrapSyncClick('bio_guide_next_section', () => scrollToId(next.id))}
          className="inline-flex max-w-[48%] items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-right text-xs text-slate-300 transition hover:border-cyan-500/30 hover:text-cyan-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
        >
          <span>
            <span className="block text-[10px] uppercase tracking-wide text-slate-500">Next</span>
            <span className="font-medium">{next.title}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        </button>
      ) : null}
    </nav>
  );
}

export function BioBackToTop() {
  return (
    <button
      type="button"
      onClick={wrapSyncClick('bio_guide_back_to_top', () => {
        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: prefersReduced ? 'auto' : 'smooth' });
      })}
      className="fixed bottom-6 right-4 z-50 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-slate-950/90 px-3 py-2 text-xs font-semibold text-slate-200 shadow-lg backdrop-blur-sm transition hover:border-cyan-500/40 hover:text-cyan-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 print:hidden motion-reduce:transition-none lg:bottom-8 lg:right-8"
      aria-label="Back to top"
    >
      <ArrowUp className="h-4 w-4" aria-hidden />
      Top
    </button>
  );
}
