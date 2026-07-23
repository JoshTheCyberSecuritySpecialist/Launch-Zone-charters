import { Link } from 'react-router-dom';
import { FileText, MapPin, Phone, Users } from 'lucide-react';
import StatusBadge from '../admin/StatusBadge';
import { humanizeLabel } from '../admin/adminDisplay';
import type { CaptainListBooking } from '../../lib/captainApi';
import {
  bookingStatusTone,
  captainProgressTone,
  customerSmsHref,
  customerTelHref,
  directionsLinks,
  formatTripTimeRange,
  overnightTripNote,
} from '../../lib/captainTripDisplay';
import CaptainVerificationSummary from './CaptainVerificationSummary';

type CaptainTripCardProps = {
  trip: CaptainListBooking;
  showDay?: boolean;
};

export default function CaptainTripCard({ trip, showDay = false }: CaptainTripCardProps) {
  const { startLabel, endLabel, dayLabel } = formatTripTimeRange(trip.start_time, trip.end_time);
  const overnight = overnightTripNote(trip.start_time, trip.end_time);
  const tel = customerTelHref(trip.customer_phone);
  const sms = customerSmsHref(trip.customer_phone);
  const maps = directionsLinks(trip.rental_location);

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          {showDay ? <p className="text-sm font-semibold text-sky-700">{dayLabel}</p> : null}
          <p className="text-lg font-black text-slate-900">
            {startLabel} – {endLabel}
          </p>
          {overnight ? <p className="mt-1 text-sm font-medium text-violet-700">{overnight}</p> : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge tone={bookingStatusTone(trip.status)}>{humanizeLabel(trip.status)}</StatusBadge>
          <StatusBadge tone={captainProgressTone(trip.captain_progress)}>
            {humanizeLabel(trip.captain_progress)}
          </StatusBadge>
        </div>
      </div>

      <dl className="mt-4 space-y-2 text-base">
        <div className="flex items-start gap-2">
          <Users className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden />
          <div>
            <dt className="sr-only">Customer</dt>
            <dd className="font-bold text-slate-900">{trip.customer_name}</dd>
            <dd className="text-slate-600">{trip.guest_count} passenger{trip.guest_count === 1 ? '' : 's'}</dd>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden />
          <div>
            <dt className="sr-only">Departure</dt>
            <dd>{trip.rental_location || 'Departure TBD'}</dd>
            <dd className="text-slate-600">{trip.boat_name}</dd>
          </div>
        </div>
      </dl>

      <CaptainVerificationSummary
        compact
        paymentDisplay={trip.verification_summary.payment_display}
        items={[
          {
            key: 'summary',
            label: 'Verification',
            done: trip.verification_summary.missing_count === 0,
            note: trip.verification_summary.payment_display,
          },
        ]}
      />

      {trip.has_notes ? (
        <p className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-amber-800">
          <FileText className="h-4 w-4" aria-hidden />
          Notes on file
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link
          to={`/captain/booking/${trip.id}`}
          className="col-span-2 inline-flex min-h-11 items-center justify-center rounded-xl bg-sky-600 px-4 text-base font-bold text-white hover:bg-sky-700"
        >
          View Trip
        </Link>
        {tel ? (
          <a
            href={tel}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-base font-bold text-slate-800 hover:bg-slate-50"
          >
            <Phone className="h-4 w-4" aria-hidden />
            Call
          </a>
        ) : (
          <span className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-100 px-3 text-sm text-slate-500">
            No phone
          </span>
        )}
        {sms ? (
          <a
            href={sms}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-base font-bold text-slate-800 hover:bg-slate-50"
          >
            Text
          </a>
        ) : null}
        <a
          href={maps.apple}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-base font-bold text-slate-800 hover:bg-slate-50"
        >
          Apple Maps
        </a>
        <a
          href={maps.google}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-base font-bold text-slate-800 hover:bg-slate-50"
        >
          Google Maps
        </a>
      </div>
    </article>
  );
}
