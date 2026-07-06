import { useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import {
  BIO_FAQ_CATEGORY_LABELS,
  BIO_GUIDE_FAQS,
  type BioFaqCategory,
  type BioGuideFaq,
} from '../../content/bioluminescence/faqs';

const ALL_CATEGORIES = Object.keys(BIO_FAQ_CATEGORY_LABELS) as BioFaqCategory[];

function matchesQuery(faq: BioGuideFaq, query: string): boolean {
  if (!query.trim()) return true;
  const blob = `${faq.question} ${faq.answer}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => blob.includes(term));
}

export default function BioFAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<BioFaqCategory | 'all'>('all');

  const filtered = useMemo(() => {
    return BIO_GUIDE_FAQS.filter((faq) => {
      const categoryOk =
        activeCategory === 'all' || faq.categories.includes(activeCategory);
      return categoryOk && matchesQuery(faq, query);
    });
  }, [query, activeCategory]);

  return (
    <section
      id="bio-guide-faq"
      className="scroll-mt-28 border-t border-white/10 pt-10"
      aria-labelledby="heading-bio-guide-faq"
    >
      <h2 id="heading-bio-guide-faq" className="text-2xl font-bold text-white sm:text-3xl">
        Frequently Asked Questions
      </h2>
      <p className="mt-2 text-sm text-slate-400">
        Search or filter by topic. {filtered.length} of {BIO_GUIDE_FAQS.length} shown.
      </p>

      <div className="mt-4 space-y-3 print:hidden">
        <label className="block">
          <span className="sr-only">Search FAQs</span>
          <span className="relative flex items-center">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-slate-500" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search questions…"
              className="w-full rounded-xl border border-white/10 bg-slate-950/70 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
              aria-controls="bio-faq-list"
            />
          </span>
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="FAQ categories">
          <button
            type="button"
            onClick={() => setActiveCategory('all')}
            aria-pressed={activeCategory === 'all'}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${
              activeCategory === 'all'
                ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100'
                : 'border-white/10 text-slate-400 hover:border-white/20'
            }`}
          >
            All
          </button>
          {ALL_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              aria-pressed={activeCategory === cat}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${
                activeCategory === cat
                  ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100'
                  : 'border-white/10 text-slate-400 hover:border-white/20'
              }`}
            >
              {BIO_FAQ_CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      </div>

      <div id="bio-faq-list" className="mt-6 divide-y divide-white/10 rounded-xl border border-white/10">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-400" role="status">
            No FAQs match your search. Try another keyword or category.
          </p>
        ) : null}
        {filtered.map((faq) => {
          const index = BIO_GUIDE_FAQS.indexOf(faq);
          const isOpen = openIndex === index;
          const panelId = `bio-faq-panel-${index}`;
          const btnId = `bio-faq-btn-${index}`;
          return (
            <div key={faq.question} className="bg-slate-950/40">
              <h3 className="m-0">
                <button
                  type="button"
                  id={btnId}
                  className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left text-sm font-semibold text-white transition hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/50 sm:text-base"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                >
                  {faq.question}
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-cyan-400 transition motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                </button>
              </h3>
              <div
                id={panelId}
                role="region"
                aria-labelledby={btnId}
                hidden={!isOpen}
                className="px-4 pb-4 text-sm leading-relaxed text-slate-300 sm:text-base"
              >
                {faq.answer}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
