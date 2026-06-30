import { CheckCircle2, Circle, AlertCircle, Ship } from 'lucide-react';
import type { ChecklistItem, PreTripOverallStatus } from '../../lib/preTripStatus';
import { STATUS_COPY } from '../../lib/preTripStatus';

interface PreTripStatusPanelProps {
  status: PreTripOverallStatus;
  checklist: ChecklistItem[];
  referenceId?: string;
  className?: string;
}

function statusStyles(status: PreTripOverallStatus) {
  switch (status) {
    case 'ready_for_departure':
      return {
        border: 'border-emerald-400/40',
        bg: 'bg-emerald-950/25',
        icon: 'text-emerald-300',
        badge: 'bg-emerald-500/20 text-emerald-100 border-emerald-400/30',
      };
    case 'submitted_for_review':
      return {
        border: 'border-cyan-400/35',
        bg: 'bg-cyan-950/25',
        icon: 'text-cyan-300',
        badge: 'bg-cyan-500/20 text-cyan-100 border-cyan-400/30',
      };
    case 'missing_items':
      return {
        border: 'border-amber-400/35',
        bg: 'bg-amber-950/20',
        icon: 'text-amber-300',
        badge: 'bg-amber-500/20 text-amber-100 border-amber-400/30',
      };
    case 'rejected':
      return {
        border: 'border-rose-400/35',
        bg: 'bg-rose-950/25',
        icon: 'text-rose-300',
        badge: 'bg-rose-500/20 text-rose-100 border-rose-400/30',
      };
  }
}

function StatusIcon({ status }: { status: PreTripOverallStatus }) {
  const styles = statusStyles(status);
  if (status === 'ready_for_departure') {
    return <Ship className={`mx-auto h-12 w-12 ${styles.icon}`} aria-hidden />;
  }
  if (status === 'rejected') {
    return <AlertCircle className={`mx-auto h-12 w-12 ${styles.icon}`} aria-hidden />;
  }
  return <CheckCircle2 className={`mx-auto h-12 w-12 ${styles.icon}`} aria-hidden />;
}

export default function PreTripStatusPanel({
  status,
  checklist,
  referenceId,
  className = '',
}: PreTripStatusPanelProps) {
  const styles = statusStyles(status);
  const copy = STATUS_COPY[status];

  return (
    <section
      className={`lz-card-glass rounded-[var(--lz-radius-card)] border p-6 md:p-8 ${styles.border} ${styles.bg} ${className}`}
    >
      <div className="text-center">
        <StatusIcon status={status} />
        <span
          className={`mt-4 inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-widest ${styles.badge}`}
        >
          {copy.title}
        </span>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">{copy.description}</p>
        {referenceId ? (
          <p className="mt-3 font-mono text-xs text-slate-500">Reference: {referenceId}</p>
        ) : null}
      </div>

      <ul className="mt-6 space-y-2">
        {checklist.map((item) => (
          <li
            key={item.key}
            className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm"
          >
            {item.done ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
            ) : (
              <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-white">{item.label}</p>
              {item.note ? <p className="text-xs text-slate-400">{item.note}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
