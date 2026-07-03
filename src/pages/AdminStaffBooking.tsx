import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarPlus, RotateCcw, Save } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import Logo from '../components/ui/Logo';
import { env } from '../config/env.js';
import { PRICING, captainFeeForHours } from '../config/pricing';

type BookingType = 'rental' | 'captain_charter';
type LocationValue = 'Port Orange' | 'Titusville';
type DurationPreset = '2' | '4' | '6' | '8' | 'custom';
type PaymentStatus = 'pending' | 'deposit_paid' | 'paid';
type PaymentMethod = '' | 'stripe' | 'cash' | 'venmo' | 'zelle' | 'paypal' | 'groupon' | 'comp' | 'other';

type BoatRow = {
  id: string;
  name: string;
  type: string | null;
  hourly_rate: number | string | null;
  half_day_rate: number | string | null;
  full_day_rate: number | string | null;
};

type AvailabilityConflict = {
  customer_name: string;
  boat_name: string;
  start_time: string;
  end_time: string;
  status: string;
} | null;

type AvailabilityState =
  | { status: 'idle'; message: string; conflict?: null }
  | { status: 'checking'; message: string; conflict?: null }
  | { status: 'available'; message: string; conflict?: null }
  | { status: 'unavailable'; message: string; conflict: AvailabilityConflict }
  | { status: 'error'; message: string; conflict?: null };

type StaffBookingRow = {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  payment_status: string | null;
  booking_source: string | null;
  rental_location: string | null;
  customers?: { full_name?: string | null; phone?: string | null; email?: string | null } | null;
  boats?: { name?: string | null } | null;
};

const todayYmd = () => new Date().toISOString().slice(0, 10);

const blankForm = () => ({
  customerName: '',
  phone: '',
  email: '',
  bookingType: 'rental' as BookingType,
  location: 'Port Orange' as LocationValue,
  boatId: '',
  date: todayYmd(),
  startTime: '',
  durationPreset: '4' as DurationPreset,
  customDuration: '',
  passengerCount: '1',
  originalPrice: '0.00',
  discount: '0.00',
  finalPrice: '0.00',
  paymentStatus: 'pending' as PaymentStatus,
  paymentMethod: '' as PaymentMethod,
  bookingSource: 'admin',
  staffNotes: '',
});

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function money(value: number): string {
  return (Number.isFinite(value) ? value : 0).toFixed(2);
}

function timeLabel(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  if (!Number.isFinite(s.getTime())) return '-';
  const startLabel = s.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const endLabel = Number.isFinite(e.getTime())
    ? e.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';
  return endLabel ? `${startLabel} - ${endLabel}` : startLabel;
}

export default function AdminStaffBooking() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [form, setForm] = useState(blankForm);
  const [boats, setBoats] = useState<BoatRow[]>([]);
  const [boatsLoading, setBoatsLoading] = useState(true);
  const [availability, setAvailability] = useState<AvailabilityState>({
    status: 'idle',
    message: 'Select a boat, date, time, and duration.',
  });
  const [saving, setSaving] = useState<'hold' | 'booking' | null>(null);
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [todayRows, setTodayRows] = useState<StaffBookingRow[]>([]);
  const [todayLoading, setTodayLoading] = useState(false);

  const selectedBoat = boats.find((boat) => boat.id === form.boatId) || null;
  const durationHours = useMemo(() => {
    if (form.durationPreset === 'custom') {
      const n = Number(form.customDuration);
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
    return Number(form.durationPreset);
  }, [form.customDuration, form.durationPreset]);

  const getAdminToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }, []);

  useEffect(() => {
    const boatId = searchParams.get('boatId') || searchParams.get('boat_id') || '';
    const date = searchParams.get('date') || '';
    const startTime = searchParams.get('startTime') || searchParams.get('time') || '';
    const location = searchParams.get('location') || '';
    const duration = searchParams.get('durationHours') || '';
    if (!boatId && !date && !startTime && !location && !duration) return;
    setForm((prev) => ({
      ...prev,
      boatId: boatId || prev.boatId,
      date: date || prev.date,
      startTime: startTime || prev.startTime,
      location: location === 'Titusville' || location === 'Port Orange' ? (location as LocationValue) : prev.location,
      durationPreset: ['2', '4', '6', '8'].includes(duration) ? (duration as DurationPreset) : prev.durationPreset,
      customDuration: duration && !['2', '4', '6', '8'].includes(duration) ? duration : prev.customDuration,
    }));
  }, [searchParams]);

  const authedFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      if (!env.apiUrlConfigured || !env.apiUrl) throw new Error('API URL is not configured.');
      const token = await getAdminToken();
      if (!token) throw new Error('Admin session expired. Sign in again.');
      return fetch(`${env.apiUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.headers || {}),
        },
      });
    },
    [getAdminToken]
  );

  const loadToday = useCallback(async () => {
    if (!isAdmin) return;
    setTodayLoading(true);
    try {
      const res = await authedFetch('/api/admin/staff-bookings/today');
      const payload = (await res.json().catch(() => ({}))) as {
        bookings?: StaffBookingRow[];
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error || 'Could not load staff bookings.');
      setTodayRows(Array.isArray(payload.bookings) ? payload.bookings : []);
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not load staff bookings.' });
    } finally {
      setTodayLoading(false);
    }
  }, [authedFetch, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setBoatsLoading(true);
    fetch(`${env.apiUrl}/api/boats`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Could not load boats.'))))
      .then((payload: { boats?: BoatRow[] }) => {
        if (cancelled) return;
        const rows = Array.isArray(payload.boats) ? payload.boats : [];
        setBoats(rows);
      })
      .catch((err) => {
        if (!cancelled) setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not load boats.' });
      })
      .finally(() => {
        if (!cancelled) setBoatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  useEffect(() => {
    if (!selectedBoat || durationHours <= 0) return;
    const hourly = Number(selectedBoat.hourly_rate || 0);
    const half = Number(selectedBoat.half_day_rate || 0);
    const full = Number(selectedBoat.full_day_rate || 0);
    let base = hourly * durationHours;
    if (Math.abs(durationHours - 4) < 0.01) base = half || base;
    if (Math.abs(durationHours - 8) < 0.01) base = full || base;
    if (form.bookingType === 'captain_charter') base += captainFeeForHours(durationHours);
    const discount = Number(form.discount) || 0;
    setForm((prev) => ({
      ...prev,
      originalPrice: money(base),
      finalPrice: money(Math.max(0, base - discount)),
    }));
  }, [durationHours, form.bookingType, form.discount, selectedBoat]);

  useEffect(() => {
    if (!form.boatId) {
      setAvailability({ status: 'idle', message: 'Select a boat first.' });
      return;
    }
    if (!form.date || !form.startTime || durationHours <= 0) {
      setAvailability({ status: 'idle', message: 'Select a date, time, and duration.' });
      return;
    }

    const timer = window.setTimeout(async () => {
      setAvailability({ status: 'checking', message: 'Checking availability...' });
      try {
        const res = await authedFetch('/api/admin/staff-bookings/check', {
          method: 'POST',
          body: JSON.stringify({
            boat_id: form.boatId,
            date: form.date,
            startTime: form.startTime,
            durationHours,
            rental_location: form.location,
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          available?: boolean;
          conflict?: AvailabilityConflict;
          error?: string;
        };
        if (!res.ok) throw new Error(payload.error || 'Could not check availability.');
        setAvailability(
          payload.available
            ? { status: 'available', message: 'Available' }
            : { status: 'unavailable', message: 'Already Booked', conflict: payload.conflict || null }
        );
      } catch (err) {
        setAvailability({
          status: 'error',
          message: err instanceof Error ? err.message : 'Could not check availability.',
        });
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [authedFetch, durationHours, form.boatId, form.date, form.location, form.startTime]);

  const reset = (clearNotice = true) => {
    setForm(blankForm());
    setAvailability({ status: 'idle', message: 'Select a boat first.' });
    if (clearNotice) setNotice(null);
  };

  const save = async (action: 'hold' | 'booking') => {
    setNotice(null);
    if (!form.customerName.trim()) {
      setNotice({ variant: 'error', text: 'Customer name is required.' });
      return;
    }
    if (!form.boatId) {
      setNotice({ variant: 'error', text: 'Select a boat first.' });
      return;
    }
    if (!form.date || !form.startTime || durationHours <= 0) {
      setNotice({ variant: 'error', text: 'Date, start time, and duration are required.' });
      return;
    }
    if (availability.status === 'unavailable') {
      setNotice({ variant: 'error', text: 'This slot is already booked.' });
      return;
    }

    setSaving(action);
    try {
      const res = await authedFetch('/api/admin/staff-bookings', {
        method: 'POST',
        body: JSON.stringify({
          action,
          customer_name: form.customerName,
          phone: form.phone,
          email: form.email,
          booking_type: form.bookingType,
          rental_location: form.location,
          boat_id: form.boatId,
          date: form.date,
          startTime: form.startTime,
          durationHours,
          passenger_count: form.passengerCount,
          original_price: form.originalPrice,
          discount: form.discount,
          final_price: form.finalPrice,
          payment_status: form.paymentStatus,
          payment_method: form.paymentMethod || null,
          booking_source: form.bookingSource,
          staff_notes: form.staffNotes,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { booking?: { id?: string }; error?: string };
      if (!res.ok) throw new Error(payload.error || 'Could not save booking.');
      setNotice({
        variant: 'success',
        text: action === 'hold' ? 'Hold saved and availability blocked.' : 'Staff booking created.',
      });
      reset(false);
      await loadToday();
      if (payload.booking?.id) navigate(`/admin/bookings/${payload.booking.id}`);
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not save booking.' });
    } finally {
      setSaving(null);
    }
  };

  if (authLoading) return <FullPageLoader message="Checking admin access..." />;

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow-lg">
          <h1 className="text-2xl font-bold text-slate-900">Access denied</h1>
          <p className="mt-2 text-slate-600">
            {user ? 'This account is not authorized to create staff bookings.' : 'Sign in with an admin account.'}
          </p>
          <Link to="/admin-login" className="mt-6 inline-flex rounded-lg bg-amber-600 px-6 py-3 font-bold text-white">
            Admin Login
          </Link>
        </div>
      </div>
    );
  }

  const inputClass =
    'mt-1 min-h-[52px] w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200';
  const labelClass = 'block text-sm font-bold text-slate-700';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="border-b border-slate-200 bg-slate-900 py-6 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Logo variant="admin" />
            <div>
              <h1 className="text-3xl font-bold">Staff Booking</h1>
              <p className="text-sm text-slate-400">Fast internal phone bookings and holds</p>
            </div>
          </div>
          <Link to="/admin" className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-3 font-semibold hover:bg-slate-700">
            <ArrowLeft className="h-4 w-4" />
            Admin
          </Link>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {notice ? (
          <div
            className={`mb-6 rounded-xl px-4 py-3 text-sm font-semibold ${
              notice.variant === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}
            role="status"
          >
            {notice.text}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.9fr)]">
          <section className="rounded-2xl bg-white p-5 shadow">
            <div className="mb-5 flex items-center gap-2">
              <CalendarPlus className="h-6 w-6 text-amber-600" />
              <h2 className="text-2xl font-bold">New Booking</h2>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className={labelClass}>
                Customer Name *
                <input className={inputClass} value={form.customerName} onChange={(e) => setForm((p) => ({ ...p, customerName: e.target.value }))} autoFocus />
              </label>
              <label className={labelClass}>
                Phone *
                <input className={inputClass} inputMode="tel" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: formatPhone(e.target.value) }))} />
              </label>
              <label className={labelClass}>
                Email
                <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
              </label>
              <label className={labelClass}>
                Booking Type
                <select className={inputClass} value={form.bookingType} onChange={(e) => setForm((p) => ({ ...p, bookingType: e.target.value as BookingType }))}>
                  <option value="rental">Rental</option>
                  <option value="captain_charter">Captain Charter</option>
                </select>
              </label>
              <label className={labelClass}>
                Location
                <select className={inputClass} value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value as LocationValue }))}>
                  <option value="Port Orange">Port Orange</option>
                  <option value="Titusville">Titusville</option>
                </select>
              </label>
              <label className={labelClass}>
                Boat
                <select className={inputClass} value={form.boatId} onChange={(e) => setForm((p) => ({ ...p, boatId: e.target.value }))} disabled={boatsLoading}>
                  <option value="">{boatsLoading ? 'Loading boats...' : 'Select boat'}</option>
                  {boats.map((boat) => (
                    <option key={boat.id} value={boat.id}>
                      {boat.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Date
                <input className={inputClass} type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} />
              </label>
              <label className={labelClass}>
                Start Time
                <input className={inputClass} type="time" value={form.startTime} onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))} />
              </label>
              <label className={labelClass}>
                Duration
                <select className={inputClass} value={form.durationPreset} onChange={(e) => setForm((p) => ({ ...p, durationPreset: e.target.value as DurationPreset }))}>
                  <option value="2">2 hr</option>
                  <option value="4">4 hr</option>
                  <option value="6">6 hr</option>
                  <option value="8">8 hr</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {form.durationPreset === 'custom' ? (
                <label className={labelClass}>
                  Custom Hours
                  <input className={inputClass} type="number" min="0.5" step="0.5" value={form.customDuration} onChange={(e) => setForm((p) => ({ ...p, customDuration: e.target.value }))} />
                </label>
              ) : null}
              <label className={labelClass}>
                Passenger Count
                <input className={inputClass} type="number" min="1" step="1" value={form.passengerCount} onChange={(e) => setForm((p) => ({ ...p, passengerCount: e.target.value }))} />
              </label>
              <label className={labelClass}>
                Original Price
                <input className={inputClass} type="number" min="0" step="0.01" value={form.originalPrice} onChange={(e) => setForm((p) => ({ ...p, originalPrice: e.target.value, finalPrice: money(Math.max(0, Number(e.target.value || 0) - Number(p.discount || 0))) }))} />
              </label>
              <label className={labelClass}>
                Discount
                <input className={inputClass} type="number" min="0" step="0.01" value={form.discount} onChange={(e) => setForm((p) => ({ ...p, discount: e.target.value, finalPrice: money(Math.max(0, Number(p.originalPrice || 0) - Number(e.target.value || 0))) }))} />
              </label>
              <label className={labelClass}>
                Final Price
                <input className={inputClass} type="number" min="0" step="0.01" value={form.finalPrice} onChange={(e) => setForm((p) => ({ ...p, finalPrice: e.target.value }))} />
              </label>
              <label className={labelClass}>
                Payment Status
                <select className={inputClass} value={form.paymentStatus} onChange={(e) => setForm((p) => ({ ...p, paymentStatus: e.target.value as PaymentStatus }))}>
                  <option value="pending">Pending</option>
                  <option value="deposit_paid">Deposit paid</option>
                  <option value="paid">Paid</option>
                </select>
              </label>
              <label className={labelClass}>
                Payment Method
                <select className={inputClass} value={form.paymentMethod} onChange={(e) => setForm((p) => ({ ...p, paymentMethod: e.target.value as PaymentMethod }))}>
                  <option value="">Select method</option>
                  <option value="cash">Cash</option>
                  <option value="venmo">Venmo</option>
                  <option value="zelle">Zelle</option>
                  <option value="paypal">PayPal</option>
                  <option value="groupon">Groupon</option>
                  <option value="comp">Comp</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className={labelClass}>
                Booking Source
                <input className={inputClass} value={form.bookingSource} onChange={(e) => setForm((p) => ({ ...p, bookingSource: e.target.value }))} />
              </label>
              <label className={`${labelClass} md:col-span-2`}>
                Staff Notes
                <textarea className={`${inputClass} min-h-[120px]`} value={form.staffNotes} onChange={(e) => setForm((p) => ({ ...p, staffNotes: e.target.value }))} />
              </label>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={() => void save('hold')} disabled={saving != null || availability.status === 'unavailable'} className="inline-flex min-h-[54px] flex-1 items-center justify-center gap-2 rounded-xl bg-amber-600 px-5 py-3 text-lg font-bold text-white hover:bg-amber-700 disabled:opacity-50">
                <Save className="h-5 w-5" />
                {saving === 'hold' ? 'Saving...' : 'Save Hold'}
              </button>
              <button type="button" onClick={() => void save('booking')} disabled={saving != null || availability.status === 'unavailable'} className="inline-flex min-h-[54px] flex-1 items-center justify-center gap-2 rounded-xl bg-green-700 px-5 py-3 text-lg font-bold text-white hover:bg-green-800 disabled:opacity-50">
                <CalendarPlus className="h-5 w-5" />
                {saving === 'booking' ? 'Creating...' : 'Create Booking'}
              </button>
              <button type="button" onClick={() => reset()} className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-lg font-bold text-slate-800 hover:bg-slate-50">
                <RotateCcw className="h-5 w-5" />
                Reset
              </button>
            </div>
          </section>

          <aside className="rounded-2xl bg-white p-5 shadow">
            <h2 className="text-2xl font-bold text-slate-900">Live Availability</h2>
            <div
              className={`mt-4 rounded-2xl border p-5 ${
                availability.status === 'available'
                  ? 'border-green-200 bg-green-50'
                  : availability.status === 'unavailable'
                    ? 'border-red-200 bg-red-50'
                    : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="text-2xl font-black">
                {availability.status === 'available' ? '✅ Available' : availability.status === 'unavailable' ? '❌ Already Booked' : availability.message}
              </div>
              {availability.status === 'unavailable' && availability.conflict ? (
                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="font-bold text-slate-600">Customer</dt>
                    <dd className="text-lg font-semibold text-slate-900">{availability.conflict.customer_name}</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-slate-600">Boat</dt>
                    <dd className="text-lg font-semibold text-slate-900">{availability.conflict.boat_name}</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-slate-600">Time</dt>
                    <dd className="text-lg font-semibold text-slate-900">{timeLabel(availability.conflict.start_time, availability.conflict.end_time)}</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-slate-600">Status</dt>
                    <dd className="text-lg font-semibold capitalize text-slate-900">{availability.conflict.status.replace(/_/g, ' ')}</dd>
                  </div>
                </dl>
              ) : availability.status === 'error' ? (
                <p className="mt-3 text-sm font-semibold text-red-800">{availability.message}</p>
              ) : null}
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="font-bold text-slate-900">Current Selection</h3>
              <p className="mt-2 text-sm text-slate-600">
                {selectedBoat?.name || 'No boat selected'} · {form.location} · {durationHours || '-'} hr
              </p>
              <p className="mt-2 text-3xl font-black text-slate-900">${Number(form.finalPrice || 0).toFixed(2)}</p>
              {form.bookingType === 'captain_charter' ? (
                <p className="mt-1 text-xs text-slate-500">Includes captain fee at ${PRICING.captainHourly}/hr.</p>
              ) : null}
            </div>
          </aside>
        </div>

        <section className="mt-8 rounded-2xl bg-white shadow">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-2xl font-bold">Today&apos;s Staff Bookings</h2>
              <p className="text-sm text-slate-500">Holds and bookings created by staff today.</p>
            </div>
            <button type="button" onClick={() => void loadToday()} className="rounded-lg border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50">
              {todayLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-5 py-3">Time</th>
                  <th className="px-5 py-3">Customer</th>
                  <th className="px-5 py-3">Boat</th>
                  <th className="px-5 py-3">Location</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Payment Status</th>
                  <th className="px-5 py-3">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {todayRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                      No staff bookings yet today.
                    </td>
                  </tr>
                ) : (
                  todayRows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-5 py-4 font-semibold">
                        <Link to={`/admin/bookings/${row.id}`} className="text-amber-700 hover:text-amber-800 hover:underline">
                          {timeLabel(row.start_time, row.end_time)}
                        </Link>
                      </td>
                      <td className="px-5 py-4">{row.customers?.full_name || row.customers?.phone || '-'}</td>
                      <td className="px-5 py-4">{row.boats?.name || '-'}</td>
                      <td className="px-5 py-4">{row.rental_location || '-'}</td>
                      <td className="px-5 py-4 capitalize">{row.status.replace(/_/g, ' ')}</td>
                      <td className="px-5 py-4 capitalize">{String(row.payment_status || 'pending').replace(/_/g, ' ')}</td>
                      <td className="px-5 py-4">{row.booking_source || 'admin'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
