import { ArrowLeft, MapPin, Phone } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import CaptainShell from '../components/captain/CaptainShell';
import CaptainMarineConditionsPanel from '../components/captain/CaptainMarineConditionsPanel';
import CaptainVerificationSummary from '../components/captain/CaptainVerificationSummary';
import Spinner from '../components/Spinner';
import StatusBadge from '../components/admin/StatusBadge';
import { humanizeLabel } from '../components/admin/adminDisplay';
import type { CaptainBookingDetail, CaptainProgressAction } from '../lib/captainApi';
import {
  bookingStatusTone,
  captainProgressTone,
  customerSmsHref,
  customerTelHref,
  directionsLinks,
  formatTripTimeRange,
  overnightTripNote,
} from '../lib/captainTripDisplay';
import { useCaptainApi } from '../hooks/useCaptainApi';

function nextProgressAction(progress: string): CaptainProgressAction | null {
  if (progress === 'not_started') return 'arrived';
  if (progress === 'arrived') return 'start';
  if (progress === 'in_progress') return 'complete';
  return null;
}

function progressActionLabel(action: CaptainProgressAction) {
  if (action === 'arrived') return 'Mark Arrived';
  if (action === 'start') return 'Start Trip';
  return 'Complete Trip';
}

export default function CaptainBookingDetail() {
  const { id } = useParams<{ id: string }>();
  const { captainFetch } = useCaptainApi();
  const [booking, setBooking] = useState<CaptainBookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError('');
    try {
      const payload = await captainFetch<{ booking: CaptainBookingDetail }>(`/api/captain/bookings/${id}`);
      setBooking(payload.booking);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load trip.';
      setError(message);
      setBooking(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [captainFetch, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    void load();
  };

  const pendingAction = useMemo(
    () => (booking ? nextProgressAction(booking.captain_progress) : null),
    [booking]
  );

  const runProgressAction = async () => {
    if (!id || !pendingAction || actionLoading) return;
    setActionError('');
    setActionLoading(true);
    try {
      const payload = await captainFetch<{ captain_progress: string }>(
        `/api/captain/bookings/${id}/progress`,
        {
          method: 'PATCH',
          body: JSON.stringify({ action: pendingAction }),
        }
      );
      setBooking((prev) => (prev ? { ...prev, captain_progress: payload.captain_progress } : prev));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update progress.');
    } finally {
      setActionLoading(false);
    }
  };

  if (!id) {
    return (
      <CaptainShell title="Trip">
        <p className="text-base text-red-700">Invalid trip link.</p>
      </CaptainShell>
    );
  }

  if (loading) {
    return (
      <CaptainShell title="Trip" onRefresh={handleRefresh} refreshing={refreshing}>
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      </CaptainShell>
    );
  }

  if (error || !booking) {
    return (
      <CaptainShell title="Trip" onRefresh={handleRefresh} refreshing={refreshing}>
        <Link to="/captain" className="mb-4 inline-flex min-h-11 items-center gap-2 text-base font-bold text-sky-700">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to today
        </Link>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-base text-red-800">{error || 'Trip not found.'}</div>
      </CaptainShell>
    );
  }

  const { startLabel, endLabel, dayLabel } = formatTripTimeRange(booking.start_time, booking.end_time);
  const overnight = overnightTripNote(booking.start_time, booking.end_time);
  const tel = customerTelHref(booking.customer.phone);
  const sms = customerSmsHref(booking.customer.phone);
  const maps = directionsLinks(booking.rental_location);

  return (
    <CaptainShell title={booking.customer.full_name} subtitle={`${dayLabel} · ${startLabel} – ${endLabel}`} onRefresh={handleRefresh} refreshing={refreshing}>
      <Link to="/captain" className="mb-4 inline-flex min-h-11 items-center gap-2 text-base font-bold text-sky-700">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to today
      </Link>

      <div className="mb-4 flex flex-wrap gap-2">
        <StatusBadge tone={bookingStatusTone(booking.status)}>{humanizeLabel(booking.status)}</StatusBadge>
        <StatusBadge tone={captainProgressTone(booking.captain_progress)}>
          {humanizeLabel(booking.captain_progress)}
        </StatusBadge>
        <StatusBadge tone={booking.payment_display === 'Ready' ? 'success' : 'warning'}>
          Payment {booking.payment_display}
        </StatusBadge>
      </div>

      {overnight ? (
        <p className="mb-4 rounded-xl bg-violet-50 px-4 py-3 text-base font-semibold text-violet-900">{overnight}</p>
      ) : null}

      <section className="mb-4 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Customer</h2>
        <p className="text-base">
          <span className="font-bold">{booking.customer.full_name}</span>
          <br />
          {booking.customer.phone || 'No phone on file'}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {tel ? (
            <a href={tel} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-sky-600 px-3 font-bold text-white">
              <Phone className="h-4 w-4" aria-hidden />
              Call
            </a>
          ) : null}
          {sms ? (
            <a href={sms} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 font-bold text-slate-800">
              Text
            </a>
          ) : null}
        </div>
      </section>

      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Trip</h2>
        <dl className="mt-3 space-y-2 text-base">
          <div>
            <dt className="text-sm font-semibold text-slate-500">Passengers</dt>
            <dd>{booking.guest_count}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-slate-500">Boat</dt>
            <dd>{booking.boat?.name || 'Unassigned'}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-slate-500">Captain</dt>
            <dd>{booking.captain?.full_name || '—'}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-slate-500">Departure</dt>
            <dd className="inline-flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              {booking.rental_location || 'TBD'}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-slate-500">Charter type</dt>
            <dd>{humanizeLabel(booking.charter_type)}</dd>
          </div>
        </dl>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <a href={maps.apple} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 font-bold text-slate-800">
            Apple Maps
          </a>
          <a href={maps.google} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 font-bold text-slate-800">
            Google Maps
          </a>
        </div>
      </section>

      <div className="mb-4">
        <CaptainMarineConditionsPanel rentalLocation={booking.rental_location} />
      </div>

      {booking.passengers.length > 0 ? (
        <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Guest names</h2>
          <ul className="mt-3 space-y-2 text-base">
            {booking.passengers.map((p) => (
              <li key={p.passenger_number} className="rounded-xl bg-slate-50 px-3 py-2">
                <span className="font-semibold">{p.passenger_name}</span>
                <span className="text-slate-600"> · {humanizeLabel(p.passenger_type)}</span>
                {p.mobility_assistance_required ? (
                  <p className="mt-1 text-sm text-amber-900">
                    Accessibility: {p.mobility_notes || 'Assistance required'}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(booking.trip_notes.special_requests || booking.trip_notes.staff_notes) && (
        <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Trip notes</h2>
          {booking.trip_notes.special_requests ? (
            <p className="mt-2 text-base text-slate-800">{booking.trip_notes.special_requests}</p>
          ) : null}
          {booking.trip_notes.staff_notes ? (
            <p className="mt-2 text-base text-slate-700">{booking.trip_notes.staff_notes}</p>
          ) : null}
        </section>
      )}

      {booking.emergency_contact_notes ? (
        <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <h2 className="text-lg font-bold text-amber-950">Emergency contact</h2>
          <p className="mt-2 whitespace-pre-wrap text-base text-amber-950">{booking.emergency_contact_notes}</p>
          <p className="mt-2 text-sm text-amber-900">Not the customer phone — use only in an emergency.</p>
        </section>
      ) : null}

      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Verification</h2>
        <div className="mt-3">
          <CaptainVerificationSummary items={booking.verification_summary.items} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Trip progress</h2>
        {booking.captain_progress === 'completed' ? (
          <p className="mt-3 text-base font-semibold text-green-800">Trip marked complete.</p>
        ) : pendingAction ? (
          <button
            type="button"
            onClick={() => void runProgressAction()}
            disabled={actionLoading}
            className="mt-3 inline-flex min-h-[3.25rem] w-full items-center justify-center rounded-xl bg-sky-600 text-lg font-bold text-white hover:bg-sky-700 disabled:bg-slate-300"
          >
            {actionLoading ? 'Updating…' : progressActionLabel(pendingAction)}
          </button>
        ) : null}
        {actionError ? (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-base text-red-800" role="alert">
            {actionError}
          </p>
        ) : null}
      </section>
    </CaptainShell>
  );
}
