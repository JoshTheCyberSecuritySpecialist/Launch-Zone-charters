import { DateTime } from 'luxon';
import { LogOut } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/useAuth';
import CaptainShell from '../components/captain/CaptainShell';
import CaptainTripCard from '../components/captain/CaptainTripCard';
import Spinner from '../components/Spinner';
import type { CaptainListBooking } from '../lib/captainApi';
import { BUSINESS_TZ } from '../lib/bookingDateTimeRange';
import { nextDepartureLabel } from '../lib/captainTripDisplay';
import { useCaptainApi } from '../hooks/useCaptainApi';

export default function CaptainDashboard() {
  const { captainProfile, signOut } = useAuth();
  const { captainFetch } = useCaptainApi();
  const [bookings, setBookings] = useState<CaptainListBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const todayLabel = DateTime.now().setZone(BUSINESS_TZ).toFormat('EEEE, MMMM d, yyyy');

  const load = useCallback(async () => {
    setError('');
    try {
      const payload = await captainFetch<{ bookings: CaptainListBooking[] }>(
        '/api/captain/bookings?view=today'
      );
      setBookings(Array.isArray(payload.bookings) ? payload.bookings : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load trips.';
      setError(message);
      setBookings([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [captainFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    void load();
  };

  return (
    <CaptainShell
      title={captainProfile?.full_name || 'Captain'}
      subtitle={todayLabel}
      onRefresh={handleRefresh}
      refreshing={refreshing || loading}
    >
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => void signOut()}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-base font-bold text-slate-700 hover:bg-slate-50"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out
        </button>
      </div>

      <section className="mb-5 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">Trips today</p>
          <p className="mt-1 text-3xl font-black text-slate-900">{loading ? '…' : bookings.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">Next departure</p>
          <p className="mt-1 text-lg font-bold leading-snug text-slate-900">
            {loading ? '…' : nextDepartureLabel(bookings)}
          </p>
        </div>
      </section>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-base text-red-800" role="alert">
          {error.includes('fetch') || error.includes('network')
            ? 'Connection issue — check signal and pull to refresh.'
            : error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : bookings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-lg font-bold text-slate-900">No trips today</p>
          <p className="mt-2 text-base text-slate-600">Assigned charter trips will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {bookings.map((trip) => (
            <CaptainTripCard key={trip.id} trip={trip} />
          ))}
        </div>
      )}
    </CaptainShell>
  );
}
