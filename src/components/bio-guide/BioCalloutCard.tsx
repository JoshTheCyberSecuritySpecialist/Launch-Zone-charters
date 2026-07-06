import type { BioCallout, BioCalloutVariant } from '../../content/bioluminescence/callouts';
import { BookOpen, Compass, Leaf, Lightbulb, Ship } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const VARIANT_META: Record<
  BioCalloutVariant,
  { label: string; icon: LucideIcon; className: string }
> = {
  'did-you-know': {
    label: 'Did You Know?',
    icon: Lightbulb,
    className: 'border-cyan-500/30 bg-cyan-950/25 text-cyan-50',
  },
  'marine-biology': {
    label: 'Marine Biology',
    icon: BookOpen,
    className: 'border-emerald-500/30 bg-emerald-950/25 text-emerald-50',
  },
  'local-tip': {
    label: 'Local Tip',
    icon: Compass,
    className: 'border-amber-500/30 bg-amber-950/25 text-amber-50',
  },
  'captains-tip': {
    label: "Captain's Tip",
    icon: Ship,
    className: 'border-sky-500/30 bg-sky-950/25 text-sky-50',
  },
  'conservation-tip': {
    label: 'Conservation Tip',
    icon: Leaf,
    className: 'border-teal-500/30 bg-teal-950/25 text-teal-50',
  },
};

type BioCalloutCardProps = BioCallout;

export default function BioCalloutCard({ variant, body }: BioCalloutCardProps) {
  const meta = VARIANT_META[variant];
  const Icon = meta.icon;
  return (
    <aside
      className={`my-4 rounded-xl border p-4 text-sm leading-relaxed motion-reduce:transition-none ${meta.className}`}
      aria-label={meta.label}
    >
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] opacity-90">
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        {meta.label}
      </p>
      <p className="mt-2">{body}</p>
    </aside>
  );
}

export function BioCalloutList({ callouts }: { callouts: BioCallout[] }) {
  if (!callouts.length) return null;
  return (
    <div className="space-y-3" role="list" aria-label="Guide callouts">
      {callouts.map((c) => (
        <div key={`${c.variant}-${c.body.slice(0, 24)}`} role="listitem">
          <BioCalloutCard {...c} />
        </div>
      ))}
    </div>
  );
}
