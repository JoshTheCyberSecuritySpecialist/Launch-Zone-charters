import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, List } from 'lucide-react';

export type TocItem = {
  id: string;
  title: string;
  level: 2 | 3;
};

type PillarTOCProps = {
  items: TocItem[];
  onActiveTitleChange?: (title: string | null) => void;
};

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
}

export default function PillarTOC({ items, onActiveTitleChange }: PillarTOCProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    const ids = items.map((i) => i.id);
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el != null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) {
          const id = visible[0].target.id;
          setActiveId(id);
          const match = items.find((i) => i.id === id);
          onActiveTitleChange?.(match?.title ?? null);
        }
      },
      { rootMargin: '-20% 0px -55% 0px', threshold: [0, 0.25, 0.5] }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items, onActiveTitleChange]);

  const handleClick = useCallback((id: string) => {
    scrollToSection(id);
    setMobileOpen(false);
  }, []);

  const navList = (
    <nav aria-label="Table of contents">
      <ul className="space-y-1 text-sm">
        {items.map((item) => {
          const isActive = activeId === item.id;
          return (
            <li key={item.id} className={item.level === 3 ? 'pl-3' : undefined}>
              <button
                type="button"
                onClick={() => handleClick(item.id)}
                className={`w-full rounded-lg px-2 py-1.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${
                  isActive
                    ? 'bg-cyan-500/15 font-medium text-cyan-200'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                } ${item.level === 3 ? 'text-xs' : ''}`}
                aria-current={isActive ? 'location' : undefined}
              >
                {item.title}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  return (
    <>
      {/* Mobile collapsible TOC */}
      <div className="mb-6 lg:hidden print:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm font-semibold text-white"
          aria-expanded={mobileOpen}
          aria-controls="bio-guide-toc-mobile"
        >
          <span className="inline-flex items-center gap-2">
            <List className="h-4 w-4 text-cyan-400" aria-hidden />
            On this page
          </span>
          <ChevronDown
            className={`h-4 w-4 transition motion-reduce:transition-none ${mobileOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
        {mobileOpen ? (
          <div
            id="bio-guide-toc-mobile"
            className="mt-2 max-h-[50vh] overflow-y-auto rounded-xl border border-white/10 bg-slate-950/80 p-3"
          >
            {navList}
          </div>
        ) : null}
      </div>

      {/* Desktop sticky TOC */}
      <aside
        className="hidden lg:block print:hidden"
        aria-label="Table of contents sidebar"
      >
        <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto rounded-xl border border-white/10 bg-slate-950/50 p-4 backdrop-blur-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/80">
            On this page
          </p>
          {navList}
        </div>
      </aside>
    </>
  );
}
