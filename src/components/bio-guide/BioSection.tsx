import { Link } from 'react-router-dom';
import { BIO_SECTION_CALLOUTS } from '../../content/bioluminescence/callouts';
import type { BioGuideRelatedLink, BioGuideSubsection } from '../../content/bioluminescence/sections';
import { BIO_SECTION_IMAGES, type BioGuideImageKey } from '../../content/bioluminescence/images';
import { BioCalloutList } from './BioCalloutCard';
import BioGuideImage from './BioGuideImage';
import BioSectionNav from './BioSectionNav';

type BioSectionProps = {
  id: string;
  title: string;
  paragraphs: string[];
  subsections?: BioGuideSubsection[];
  relatedLinks?: BioGuideRelatedLink[];
  imageKey?: BioGuideImageKey;
  prev?: { id: string; title: string };
  next?: { id: string; title: string };
};

function RelatedLinks({ links, label }: { links: BioGuideRelatedLink[]; label: string }) {
  if (!links.length) return null;
  return (
    <nav className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label={label}>
      {links.map((link) => (
        <Link
          key={link.path}
          to={link.path}
          className="font-medium text-cyan-300 underline-offset-2 transition hover:text-cyan-200 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export default function BioSection({
  id,
  title,
  paragraphs,
  subsections,
  relatedLinks,
  imageKey,
  prev,
  next,
}: BioSectionProps) {
  const resolvedImage = imageKey ?? BIO_SECTION_IMAGES[id];

  return (
    <section id={id} className="scroll-mt-28 border-b border-white/5 pb-10 last:border-b-0">
      <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h2>
      {resolvedImage ? <BioGuideImage imageKey={resolvedImage} /> : null}
      <div className="mt-4 space-y-4 text-base leading-relaxed text-slate-300">
        {paragraphs.map((p) => (
          <p key={p.slice(0, 48)}>{p}</p>
        ))}
      </div>
      <BioCalloutList callouts={BIO_SECTION_CALLOUTS[id] ?? []} />
      <RelatedLinks links={relatedLinks ?? []} label={`Related links for ${title}`} />
      {subsections?.map((sub) => (
        <div key={sub.id} id={sub.id} className="scroll-mt-28 mt-8">
          <h3 className="text-lg font-semibold text-cyan-100/95 sm:text-xl">{sub.title}</h3>
          {BIO_SECTION_IMAGES[sub.id] ? <BioGuideImage imageKey={BIO_SECTION_IMAGES[sub.id]!} /> : null}
          <div className="mt-3 space-y-3 text-base leading-relaxed text-slate-300">
            {sub.paragraphs.map((p) => (
              <p key={p.slice(0, 48)}>{p}</p>
            ))}
          </div>
          <BioCalloutList callouts={BIO_SECTION_CALLOUTS[sub.id] ?? []} />
          <RelatedLinks links={sub.relatedLinks ?? []} label={`Related links for ${sub.title}`} />
        </div>
      ))}
      <BioSectionNav prev={prev} next={next} />
    </section>
  );
}
