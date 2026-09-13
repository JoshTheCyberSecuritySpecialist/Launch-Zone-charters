import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { BIO_GUIDE_FAQS } from '../../content/bioluminescence/faqs';

/** Simple FAQ accordion — kept for reuse; guide page may inline its own. */
export default function BioFAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const faqs = useMemo(() => BIO_GUIDE_FAQS, []);

  return (
    <section
      id="bio-guide-faq"
      className="scroll-mt-28 border-t border-white/10 pt-10"
      aria-labelledby="heading-bio-guide-faq"
    >
      <h2 id="heading-bio-guide-faq" className="text-2xl font-bold text-white sm:text-3xl">
        Frequently Asked Questions
      </h2>
      <div id="bio-faq-list" className="mt-6 divide-y divide-white/10 rounded-xl border border-white/10">
        {faqs.map((faq, index) => {
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
                    className={`h-5 w-5 shrink-0 text-cyan-400 transition motion-reduce:transition-none ${
                      isOpen ? 'rotate-180' : ''
                    }`}
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
