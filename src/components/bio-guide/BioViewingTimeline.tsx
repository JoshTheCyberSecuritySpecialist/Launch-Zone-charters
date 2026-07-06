import { BIO_VIEWING_TIMELINE } from '../../content/bioluminescence/timeline';

export default function BioViewingTimeline() {
  return (
    <section
      className="my-8 rounded-xl border border-white/10 bg-slate-950/40 p-4 sm:p-6"
      aria-labelledby="bio-timeline-heading"
    >
      <h3 id="bio-timeline-heading" className="text-lg font-semibold text-white sm:text-xl">
        Typical Viewing Night Timeline
      </h3>
      <p className="mt-1 text-sm text-slate-400">How an evening on the lagoon often unfolds.</p>
      <ol
        className="mt-6 flex gap-4 overflow-x-auto pb-2 motion-reduce:scroll-auto lg:grid lg:grid-cols-6 lg:overflow-visible lg:pb-0"
        aria-label="Bioluminescence viewing timeline"
      >
        {BIO_VIEWING_TIMELINE.map((step, index) => (
          <li
            key={step.id}
            className="relative min-w-[10.5rem] flex-1 rounded-lg border border-cyan-500/20 bg-black/30 p-3 lg:min-w-0"
          >
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400/90">
              Step {index + 1}
            </span>
            <p className="mt-1 text-sm font-semibold text-white">{step.title}</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">{step.description}</p>
            {index < BIO_VIEWING_TIMELINE.length - 1 ? (
              <span
                className="pointer-events-none absolute -right-3 top-1/2 hidden -translate-y-1/2 text-cyan-500/60 lg:inline"
                aria-hidden
              >
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
