import { Link } from 'react-router-dom';
import type { OpsNewBookingCard } from '../../lib/adminOpsDashboard';
import { formatRelativeTime, sourceBadgeClass } from '../../lib/adminOpsDashboard';

type Props = {
  booking: OpsNewBookingCard;
  onMarkReviewed: (id: string) => void;
};

export default function AdminOpsNewBookingCard({ booking, onMarkReviewed }: Props) {
  const hasConflict = booking.conflictStatus !== 'No conflict';

  return (
    <article className="rounded-2xl border border-cyan-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-2">
        <span className="rounded-full bg-cyan-600 px-2 py-0.5 text-xs font-bold uppercase text-white">
          New
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold ${sourceBadgeClass(booking.source_label)}`}
        >
          {booking.source_label}
        </span>
        {booking.charterMode && booking.charterMode !== 'NEEDS REVIEW' ? (
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-bold uppercase text-white">
            {booking.charterMode}
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-950">
            Trip type: Needs review
          </span>
        )}
      </div>

      <h3 className="mt-3 text-lg font-black uppercase tracking-tight text-slate-900">
        {booking.customer_name}
      </h3>

      {booking.relativeDateLabel ? (
        <p className="mt-1 text-sm font-black tracking-wide text-amber-800">{booking.relativeDateLabel}</p>
      ) : null}

      <p className="mt-1 text-base font-bold leading-snug text-slate-900 md:text-lg">
        <span className="md:hidden">{booking.tripDateCompact}</span>
        <span className="hidden md:inline">{booking.tripDateLong}</span>
      </p>
      <p className="mt-1 text-base font-semibold text-slate-800">{booking.scheduledTimeDisplay}</p>

      <p className="mt-3 text-sm font-bold text-slate-800">{booking.serviceName}</p>
      <p className="mt-2 text-sm text-slate-700">{booking.capacityText}</p>

      <dl className="mt-3 space-y-1 text-sm text-slate-800">
        <div>
          <dt className="inline font-semibold">Boat: </dt>
          <dd className={`inline ${booking.boatMissing ? 'font-bold text-red-800' : ''}`}>
            {booking.boatDisplay}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">Captain: </dt>
          <dd className={`inline ${booking.captainMissing ? 'font-bold text-red-800' : ''}`}>
            {booking.captainDisplay}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">Departure: </dt>
          <dd className="inline">{booking.departureDisplay}</dd>
        </div>
      </dl>

      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-800">
        <p className="font-semibold">Readiness</p>
        <p>
          Payment: {booking.readinessStatus.payment} · Waiver: {booking.readinessStatus.waiver} · Insurance:{' '}
          {booking.readinessStatus.insurance}
        </p>
        <p>
          Captain: {booking.readinessStatus.captain} · Boat: {booking.readinessStatus.boat}
        </p>
      </div>

      {hasConflict ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-950">
          <p className="font-bold">{booking.conflictStatus}</p>
          {(booking.conflictDetails || []).slice(0, 2).map((d) => (
            <p key={`${d.type}-${d.overlappingBookingId || ''}`} className="mt-1 break-words">
              {d.message}
              {d.overlappingCustomerDisplayName ? ` — ${d.overlappingCustomerDisplayName}` : ''}
            </p>
          ))}
          {booking.conflictDetails?.[0]?.overlappingBookingId ? (
            <Link
              to={`/admin/bookings/${booking.conflictDetails[0].overlappingBookingId}`}
              className="mt-2 inline-block min-h-11 font-semibold underline"
            >
              Open conflict
            </Link>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm font-semibold text-green-800">No conflict</p>
      )}

      {booking.turnaroundWarning ? (
        <p className="mt-2 text-sm font-semibold text-amber-900">{booking.turnaroundWarning}</p>
      ) : null}
      {booking.sameDayContext ? (
        <p className="mt-1 text-xs text-slate-600">{booking.sameDayContext}</p>
      ) : null}

      <p className="mt-3 text-xs text-slate-500">
        Booked {formatRelativeTime(booking.created_at)}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {booking.customer_phone ? (
          <a
            href={`tel:${String(booking.customer_phone).replace(/\D/g, '')}`}
            className="inline-flex min-h-11 min-w-[4.5rem] items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-bold text-white"
          >
            Call
          </a>
        ) : null}
        {booking.customer_phone ? (
          <a
            href={`sms:${String(booking.customer_phone).replace(/\D/g, '')}`}
            className="inline-flex min-h-11 min-w-[4.5rem] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-900"
          >
            Text
          </a>
        ) : null}
        <Link
          to={`/admin/bookings/${booking.id}`}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-600 px-4 text-sm font-bold text-white"
        >
          Open booking
        </Link>
        <button
          type="button"
          onClick={() => onMarkReviewed(booking.id)}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-800"
        >
          Mark reviewed
        </button>
      </div>
    </article>
  );
}
