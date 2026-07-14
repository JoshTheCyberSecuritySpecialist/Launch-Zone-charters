import { CheckCircle2, Circle, AlertCircle, Ship } from 'lucide-react';
import type { ChecklistItem, PreTripOverallStatus } from '../../lib/preTripStatus';
import { STATUS_COPY } from '../../lib/preTripStatus';
import { WI_SECTION } from '../../lib/waiversSeniorUi';

interface PreTripStatusPanelProps {
  status: PreTripOverallStatus;
  checklist: ChecklistItem[];
  referenceId?: string;
  customerName?: string | null;
  tripDateLabel?: string | null;
  className?: string;
  showSuccessHeadline?: boolean;
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
  customerName,
  tripDateLabel,
  className = '',
  showSuccessHeadline = false,
}: PreTripStatusPanelProps) {
  const styles = statusStyles(status);
  const copy = STATUS_COPY[status];
  const isSubmittedView =
    showSuccessHeadline &&
    (status === 'submitted_for_review' || status === 'ready_for_departure');

  return (
    <section
      className={`${WI_SECTION} border ${styles.border} ${styles.bg} ${className}`}
    >
      <div className="text-center">
        <StatusIcon status={status} />
        {isSubmittedView ? (
          <>
            <h2 className="mt-4 text-2xl font-bold text-white md:text-3xl">
              Your Trip Documents Were Submitted
            </h2>
            <p className="mt-3 text-lg leading-relaxed text-slate-200">
              Thank you. Launch Zone Charters has received your information. You do not need to
              complete this form again.
            </p>
          </>
        ) : (
          <>
            <span
              className={`mt-4 inline-flex rounded-lg border px-3 py-2 text-base font-bold ${styles.badge}`}
            >
              {copy.title}
            </span>
            <p className="mt-3 text-lg leading-relaxed text-slate-200">{copy.description}</p>
          </>
        )}

        {(customerName || tripDateLabel || referenceId) && (
          <dl className="mx-auto mt-6 max-w-md space-y-2 text-left text-lg text-slate-200">
            {customerName ? (
              <div>
                <dt className="font-semibold text-white">Name</dt>
                <dd>{customerName}</dd>
              </div>
            ) : null}
            {tripDateLabel ? (
              <div>
                <dt className="font-semibold text-white">Trip date</dt>
                <dd>{tripDateLabel}</dd>
              </div>
            ) : null}
            {referenceId ? (
              <div>
                <dt className="font-semibold text-white">Confirmation number</dt>
                <dd className="break-all font-mono text-base">{referenceId}</dd>
              </div>
            ) : null}
          </dl>
        )}

        {isSubmittedView ? (
          <div className="mt-6 rounded-xl border border-white/10 bg-slate-950/40 px-4 py-4 text-left text-lg leading-relaxed text-slate-200">
            <p className="font-semibold text-white">What happens next</p>
            <p className="mt-2">
              Our team will review your documents and match them to your trip. You are not cleared
              until we mark you Ready for Departure.
            </p>
            <p className="mt-3">
              Questions? Call or text{' '}
              <a href="tel:8035421761" className="font-semibold text-cyan-200 underline">
                803-542-1761
              </a>
              .
            </p>
          </div>
        ) : null}
      </div>

      <ul className="mt-6 space-y-3">
        {checklist.map((item) => (
          <li
            key={item.key}
            className="flex min-h-12 items-start gap-3 rounded-xl border border-white/10 bg-slate-950/40 px-4 py-4 text-lg"
          >
            {item.done ? (
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-400" aria-hidden />
            ) : (
              <Circle className="mt-0.5 h-6 w-6 shrink-0 text-slate-400" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-white">
                {item.label}
                <span className="ml-2 font-normal text-slate-300">
                  — {item.done ? 'Completed' : 'Needs attention'}
                </span>
              </p>
              {item.note ? <p className="mt-1 text-base text-slate-300">{item.note}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
