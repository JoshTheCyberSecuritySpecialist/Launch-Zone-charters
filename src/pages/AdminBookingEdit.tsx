import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Save, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import LoadingSection from '../components/admin/LoadingSection';
import { humanizeLabel, shortId } from '../components/admin/adminDisplay';
import { env } from '../config/env.js';
import {
  CHARTER_MAX_PASSENGERS,
  adminCharterCapacityLines,
  validateCharterPassengerCount,
} from '../lib/charterCapacity';
import { describeError, withTimeout } from '../lib/adminDiagnostics';
import {
  END_BEFORE_START_MESSAGE,
  formatEndDayNote,
  resolveBookingDateTimeRange,
} from '../lib/bookingDateTimeRange';
import {
  type AdminBookingFormState,
  applyDurationToForm,
  bookingToFormState,
  buildPatchBody,
  scheduleChangedFromBooking,
} from '../lib/adminBookingFormState';

type BoatRow = { id: string; name: string; type?: string | null };

type DetailPayload = {
  booking: Record<string, unknown>;
  updateMeta?: { customerFacingChanges?: boolean; changeSummaries?: string[] };
};

const statusOptions = ['hold', 'pending', 'pending_verification', 'confirmed', 'ready_for_departure', 'completed', 'cancelled'];
const sourceOptions = ['website', 'admin', 'phone', 'groupon', 'boatsetter', 'airbnb', 'walk-in', 'repeat customer'];
const paymentMethods = ['', 'stripe', 'cash', 'venmo', 'zelle', 'paypal', 'groupon', 'comp', 'other'];
const paymentStatuses = ['pending', 'deposit_paid', 'paid'];
const licenseStatuses = ['pending', 'verified', 'rejected'];
const insuranceStatuses = ['pending', 'submitted', 'verified', 'rejected'];

const sectionClass = 'rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm';
const labelClass = 'block text-base font-bold text-slate-800';
const inputClass =
  'mt-2 min-h-[3rem] w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-lg text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200';

export default function AdminBookingEdit() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [booking, setBooking] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<AdminBookingFormState | null>(null);
  const [initialForm, setInitialForm] = useState<AdminBookingFormState | null>(null);
  const [boats, setBoats] = useState<BoatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [availability, setAvailability] = useState<'idle' | 'checking' | 'available' | 'conflict' | 'error'>('idle');
  const availabilityCheckSeq = useRef(0);

  const getAdminToken = useCallback(async () => {
    const { data } = await withTimeout('Admin session lookup', supabase.auth.getSession(), 12000);
    return data.session?.access_token || null;
  }, []);

  const authedFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      if (!env.apiUrlConfigured || !env.apiUrl) throw new Error('API URL is not configured.');
      const token = await getAdminToken();
      if (!token) throw new Error('Admin session expired. Sign in again.');
      return withTimeout(
        `Admin booking edit ${path}`,
        fetch(`${env.apiUrl}${path}`, {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(init.headers || {}),
          },
        }),
        20000
      );
    },
    [getAdminToken]
  );

  const load = useCallback(async () => {
    if (!isAdmin || !id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const [bookingRes, boatsRes] = await Promise.all([
        authedFetch(`/api/admin/bookings/${id}`),
        fetch(`${env.apiUrl}/api/boats`),
      ]);
      const payload = (await bookingRes.json().catch(() => ({}))) as DetailPayload & { error?: string };
      if (!bookingRes.ok) throw new Error(payload.error || 'Could not load booking.');
      const boatsPayload = (await boatsRes.json().catch(() => ({}))) as { boats?: BoatRow[] };
      setBooking(payload.booking);
      const nextForm = bookingToFormState(payload.booking);
      setForm(nextForm);
      setInitialForm(nextForm);
      setBoats(Array.isArray(boatsPayload.boats) ? boatsPayload.boats : []);
      setAvailability('idle');
    } catch (err) {
      setNotice({ variant: 'error', text: describeError(err, 'Could not load booking.') });
    } finally {
      setLoading(false);
    }
  }, [authedFetch, id, isAdmin]);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    void load();
  }, [authLoading, isAdmin, load]);

  const scheduleChanged = useMemo(() => {
    if (!form || !booking) return false;
    return scheduleChangedFromBooking(form, booking);
  }, [booking, form]);

  const overnightEndNote = useMemo(
    () => formatEndDayNote(form?.date || '', form?.startTime || '', form?.endTime || ''),
    [form?.date, form?.endTime, form?.startTime]
  );

  useEffect(() => {
    const seq = ++availabilityCheckSeq.current;
    if (!form || !scheduleChanged || !form.boatId || !form.date || !form.startTime || !form.endTime) {
      setAvailability('idle');
      return;
    }

    const resolved = resolveBookingDateTimeRange({
      date: form.date,
      startTime: form.startTime,
      endTime: form.endTime,
    });
    if (!resolved.ok) {
      setAvailability('error');
      return;
    }

    setAvailability('checking');
    const timer = window.setTimeout(async () => {
      if (seq !== availabilityCheckSeq.current) return;
      try {
        const res = await authedFetch('/api/admin/staff-bookings/check', {
          method: 'POST',
          body: JSON.stringify({
            boat_id: form.boatId,
            booking_type: form.bookingType === 'captain_charter' ? 'captain_charter' : 'rental',
            date: form.date,
            startTime: form.startTime,
            endTime: form.endTime,
            durationHours: form.duration,
            rental_location: form.location,
            passenger_count: form.bookingType === 'captain_charter' ? Math.floor(Number(form.passengers) || 1) : 1,
            exclude_booking_id: id,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { available?: boolean };
        if (seq !== availabilityCheckSeq.current) return;
        if (!res.ok) {
          setAvailability('error');
          return;
        }
        setAvailability(body.available ? 'available' : 'conflict');
      } catch {
        if (seq !== availabilityCheckSeq.current) return;
        setAvailability('error');
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [authedFetch, form, id, scheduleChanged]);

  const setField = (key: keyof AdminBookingFormState, value: string) => {
    setForm((prev) => {
      if (!prev) return prev;
      let next = { ...prev, [key]: value };
      if (key === 'duration') {
        const hours = Number(value);
        if (Number.isFinite(hours) && hours > 0) {
          next = applyDurationToForm(next, hours);
        }
      }
      return next;
    });
  };

  const saveDisabled =
    saving ||
    !form ||
    !env.apiUrlConfigured ||
    (scheduleChanged && (availability === 'conflict' || availability === 'checking'));

  const saveDisabledReason = saving
    ? 'Saving your changes…'
    : scheduleChanged && availability === 'checking'
      ? 'Checking whether this time is available…'
      : scheduleChanged && availability === 'conflict'
        ? 'This time overlaps another booking for this vessel. Please select a different time.'
        : '';

  const cancelEdit = () => {
    if (
      form &&
      initialForm &&
      JSON.stringify(form) !== JSON.stringify(initialForm) &&
      !window.confirm('Discard your unsaved changes?')
    ) {
      return;
    }
    navigate(`/admin/bookings/${id}`);
  };

  const save = async () => {
    if (!form || !booking) return;
    if (!form.boatId) {
      setNotice({ variant: 'error', text: 'Please select a vessel.' });
      return;
    }
    if (scheduleChanged && availability === 'conflict') {
      setNotice({
        variant: 'error',
        text: 'This time overlaps another booking for this vessel. Please select a different time.',
      });
      return;
    }
    if (form.bookingType === 'captain_charter') {
      const validation = validateCharterPassengerCount(form.passengers);
      if (!validation.valid) {
        setNotice({ variant: 'error', text: validation.error });
        return;
      }
    }
    const range = resolveBookingDateTimeRange({
      date: form.date,
      startTime: form.startTime,
      endTime: form.endTime,
    });
    if (!range.ok) {
      setNotice({ variant: 'error', text: range.error || END_BEFORE_START_MESSAGE });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const res = await authedFetch(`/api/admin/bookings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(buildPatchBody(form)),
      });
      const payload = (await res.json().catch(() => ({}))) as DetailPayload & { error?: string };
      if (!res.ok) {
        throw new Error(
          payload.error ||
            (res.status === 409
              ? 'This time overlaps another booking for this vessel. Please select a different time.'
              : 'Could not save booking.')
        );
      }
      navigate(`/admin/bookings/${id}`, {
        replace: true,
        state: {
          bookingUpdated: true,
          customerFacingChanges: Boolean(payload.updateMeta?.customerFacingChanges),
        },
      });
    } catch (err) {
      console.error('Admin booking edit save failed:', err);
      setNotice({ variant: 'error', text: describeError(err, 'Could not save booking.') });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) return <FullPageLoader message="Checking admin access…" />;
  if (!isAdmin) return <AdminAccessDenied signedIn={Boolean(user)} />;
  if (loading && !form) {
    return (
      <AdminShell title="Edit Booking" subtitle="Loading…" showMobileBottomNav={false}>
        <LoadingSection message="Loading booking to edit…" />
      </AdminShell>
    );
  }
  if (!form || !booking) {
    return (
      <AdminShell title="Edit Booking" showMobileBottomNav={false}>
        <div className="rounded-xl bg-red-50 p-6 text-lg font-semibold text-red-800">
          {notice?.text || 'Booking not found.'}
        </div>
        <Link to="/admin/bookings/list" className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-slate-900 px-6 py-3 font-bold text-white">
          Back to bookings
        </Link>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      title="Edit Booking"
      mobileTitle="Edit"
      subtitle={<span title={String(booking.id)}>Ref {shortId(String(booking.id), 8)}</span>}
      showMobileBottomNav={false}
      actions={
        <Link
          to={`/admin/bookings/${id}`}
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-500 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          View booking
        </Link>
      }
    >
      <div className="mx-auto max-w-3xl space-y-6 pb-36">
        {!env.apiUrlConfigured ? (
          <div className="rounded-xl bg-red-100 px-4 py-3 text-lg font-semibold text-red-900">
            API URL is not configured. Saving will not work until VITE_API_URL is set.
          </div>
        ) : null}

        {notice ? (
          <div
            className={`rounded-xl px-4 py-3 text-lg font-semibold ${
              notice.variant === 'success' ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'
            }`}
            role="alert"
          >
            {notice.text}
          </div>
        ) : null}

        <p className="text-lg text-slate-700">
          Update the reservation below, then tap <strong>Save Changes</strong>. You do not need to re-enter fields you are not changing.
        </p>

        <section className={sectionClass}>
          <h2 className="flex items-center gap-2 text-2xl font-black text-slate-900">
            <Pencil className="h-6 w-6 text-amber-600" aria-hidden />
            Customer Information
          </h2>
          <div className="mt-5 space-y-4">
            <label className={labelClass}>
              Customer name
              <input className={inputClass} value={form.customerName} onChange={(e) => setField('customerName', e.target.value)} />
            </label>
            <label className={labelClass}>
              Email
              <input className={inputClass} type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
            </label>
            <label className={labelClass}>
              Phone
              <input className={inputClass} type="tel" value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
            </label>
            <label className={labelClass}>
              Customer-visible notes
              <textarea
                className={`${inputClass} min-h-[120px]`}
                value={form.customerNotes}
                onChange={(e) => setField('customerNotes', e.target.value)}
              />
            </label>
          </div>
        </section>

        <section className={sectionClass}>
          <h2 className="text-2xl font-black text-slate-900">Trip Details</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className={`${labelClass} sm:col-span-2`}>
              Vessel
              <select className={inputClass} value={form.boatId} onChange={(e) => setField('boatId', e.target.value)}>
                <option value="">Select vessel</option>
                {boats.map((boat) => (
                  <option key={boat.id} value={boat.id}>
                    {boat.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Booking type
              <select className={inputClass} value={form.bookingType} onChange={(e) => setField('bookingType', e.target.value)}>
                <option value="rental">Rental</option>
                <option value="captain_charter">Captain charter</option>
              </select>
            </label>
            <label className={labelClass}>
              Location
              <input className={inputClass} value={form.location} onChange={(e) => setField('location', e.target.value)} />
            </label>
            <label className={labelClass}>
              Date
              <input className={inputClass} type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} />
            </label>
            <label className={labelClass}>
              Start time
              <input className={inputClass} type="time" value={form.startTime} onChange={(e) => setField('startTime', e.target.value)} />
            </label>
            <label className={labelClass}>
              End time
              <input className={inputClass} type="time" value={form.endTime} onChange={(e) => setField('endTime', e.target.value)} />
            </label>
            {overnightEndNote ? (
              <p className="sm:col-span-2 text-sm font-semibold text-cyan-900">{overnightEndNote}</p>
            ) : null}
            <label className={labelClass}>
              Duration (hours)
              <input className={inputClass} type="number" step="0.5" min="0.5" value={form.duration} onChange={(e) => setField('duration', e.target.value)} />
            </label>
            <label className={labelClass}>
              Booking source
              <select className={inputClass} value={form.source} onChange={(e) => setField('source', e.target.value)}>
                {sourceOptions.map((s) => (
                  <option key={s} value={s}>
                    {humanizeLabel(s)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 text-base font-bold text-slate-700">
            {availability === 'available' ? <span className="text-green-800">This time looks available.</span> : null}
            {availability === 'error' ? (
              <span className="text-amber-900">Could not verify availability online. Save will still check on the server.</span>
            ) : null}
            {saveDisabledReason ? <span className="text-red-800">{saveDisabledReason}</span> : null}
          </div>
        </section>

        <section className={sectionClass}>
          <h2 className="text-2xl font-black text-slate-900">Passengers</h2>
          <label className={`${labelClass} mt-4`}>
            Number of passengers
            {form.bookingType === 'captain_charter' ? (
              <span className="mt-1 block text-base font-semibold text-purple-900">Maximum {CHARTER_MAX_PASSENGERS} guests (plus captain).</span>
            ) : null}
            <input
              className={inputClass}
              type="number"
              min={1}
              max={form.bookingType === 'captain_charter' ? CHARTER_MAX_PASSENGERS : undefined}
              value={form.passengers}
              onChange={(e) => setField('passengers', e.target.value)}
            />
          </label>
          {form.bookingType === 'captain_charter' ? (
            <div className="mt-3 rounded-xl bg-purple-50 p-4 text-base font-semibold text-purple-950">
              {(() => {
                const lines = adminCharterCapacityLines(Number(form.passengers) || 1);
                return (
                  <>
                    <div>{lines.passengerLine}</div>
                    <div>{lines.captainLine}</div>
                    <div>{lines.totalLine}</div>
                  </>
                );
              })()}
            </div>
          ) : null}
        </section>

        <section className={sectionClass}>
          <h2 className="text-2xl font-black text-slate-900">Pricing and Payment</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Original price
              <input className={inputClass} type="number" step="0.01" value={form.originalPrice} onChange={(e) => setField('originalPrice', e.target.value)} />
            </label>
            <label className={labelClass}>
              Discount
              <input className={inputClass} type="number" step="0.01" value={form.discount} onChange={(e) => setField('discount', e.target.value)} />
            </label>
            <label className={`${labelClass} sm:col-span-2`}>
              Discount reason
              <input className={inputClass} value={form.discountReason} onChange={(e) => setField('discountReason', e.target.value)} />
            </label>
            <label className={labelClass}>
              Final price
              <input className={inputClass} type="number" step="0.01" value={form.finalPrice} onChange={(e) => setField('finalPrice', e.target.value)} />
            </label>
            <label className={labelClass}>
              Deposit paid
              <input className={inputClass} type="number" step="0.01" value={form.depositPaid} onChange={(e) => setField('depositPaid', e.target.value)} />
            </label>
            <label className={labelClass}>
              Amount collected
              <input className={inputClass} type="number" step="0.01" value={form.amountCollected} onChange={(e) => setField('amountCollected', e.target.value)} />
            </label>
            <label className={labelClass}>
              Remaining balance
              <input className={inputClass} type="number" step="0.01" value={form.remainingBalance} onChange={(e) => setField('remainingBalance', e.target.value)} />
            </label>
            <label className={labelClass}>
              Promo code
              <input className={inputClass} value={form.promoCode} onChange={(e) => setField('promoCode', e.target.value.toUpperCase())} />
            </label>
            <label className={labelClass}>
              Payment method
              <select className={inputClass} value={form.paymentMethod} onChange={(e) => setField('paymentMethod', e.target.value)}>
                {paymentMethods.map((m) => (
                  <option key={m || 'none'} value={m}>
                    {m || 'None'}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Payment status
              <select className={inputClass} value={form.paymentStatus} onChange={(e) => setField('paymentStatus', e.target.value)}>
                {paymentStatuses.map((s) => (
                  <option key={s} value={s}>
                    {humanizeLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Booking status
              <select className={inputClass} value={form.status} onChange={(e) => setField('status', e.target.value)}>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {humanizeLabel(s)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className={sectionClass}>
          <h2 className="text-2xl font-black text-slate-900">Verification</h2>
          <p className="mt-2 text-base text-slate-600">Adjust status flags only when you have verified documents in the admin workflow.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Waiver signed
              <select className={inputClass} value={form.waiverSigned} onChange={(e) => setField('waiverSigned', e.target.value)}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </label>
            <label className={labelClass}>
              License verification
              <select className={inputClass} value={form.licenseStatus} onChange={(e) => setField('licenseStatus', e.target.value)}>
                {licenseStatuses.map((s) => (
                  <option key={s} value={s}>
                    {humanizeLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Insurance status
              <select className={inputClass} value={form.insuranceStatus} onChange={(e) => setField('insuranceStatus', e.target.value)}>
                {insuranceStatuses.map((s) => (
                  <option key={s} value={s}>
                    {humanizeLabel(s)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className={sectionClass}>
          <h2 className="text-2xl font-black text-slate-900">Admin Notes</h2>
          <label className={`${labelClass} mt-4`}>
            Internal notes (staff only)
            <textarea className={`${inputClass} min-h-[140px]`} value={form.internalNotes} onChange={(e) => setField('internalNotes', e.target.value)} />
          </label>
        </section>
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-slate-200 bg-white/95 px-4 py-4 backdrop-blur-sm md:static md:mx-auto md:mt-8 md:max-w-3xl md:rounded-2xl md:border md:px-6"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        {saveDisabledReason ? <p className="mb-3 text-center text-base font-semibold text-red-800">{saveDisabledReason}</p> : null}
        <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={cancelEdit}
            disabled={saving}
            className="inline-flex min-h-14 flex-1 touch-manipulation items-center justify-center gap-2 rounded-xl border-2 border-slate-400 bg-white px-6 text-xl font-black text-slate-900 disabled:opacity-50"
          >
            <X className="h-6 w-6" aria-hidden />
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saveDisabled}
            className="inline-flex min-h-14 flex-1 touch-manipulation items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 text-xl font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-6 w-6" aria-hidden />
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </AdminShell>
  );
}
