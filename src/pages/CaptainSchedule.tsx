import { useCallback, useEffect, useMemo, useState } from 'react';
import CaptainShell from '../components/captain/CaptainShell';
import CaptainTripCard from '../components/captain/CaptainTripCard';
import Spinner from '../components/Spinner';
import type { CaptainListBooking, CaptainScheduleView } from '../lib/captainApi';
import { readCaptainScheduleView, writeCaptainScheduleView } from '../lib/captainApi';
import { formatTripDayHeading, formatTripDayKey } from '../lib/captainTripDisplay';
import { useCaptainApi } from '../hooks/useCaptainApi';

const VIEW_OPTIONS: Array<{ id: CaptainScheduleView; label: string }> = [
  { id: 'agenda', label: 'Agenda' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

export default function CaptainSchedule() {
  const { captainFetch } = useCaptainApi();
  const [view, setView] = useState<CaptainScheduleView>(() => readCaptainScheduleView());
  const [bookings, setBookings] = useState<CaptainListBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const payload = await captainFetch<{ bookings: CaptainListBooking[] }>(
        `/api/captain/bookings?view=${encodeURIComponent(view)}`
      );
      setBookings(Array.isArray(payload.bookings) ? payload.bookings : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load schedule.';
      setError(message);
      setBookings([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [captainFetch, view]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, CaptainListBooking[]>();
    for (const trip of bookings) {
      const key = formatTripDayKey(trip.start_time);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(trip);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [bookings]);

  const handleViewChange = (next: CaptainScheduleView) => {
    setView(next);
    writeCaptainScheduleView(next);
    setLoading(true);
  };

  const handleRefresh = () => {
    setRefreshing(true);
    void load();
  };

  return (
    <CaptainShell title="Schedule" subtitle="Assigned captain charters" onRefresh={handleRefresh} refreshing={refreshing || loading}>
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {VIEW_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => handleViewChange(option.id)}
            className={`min-h-11 rounded-xl px-3 text-base font-bold ${
              view === option.id
                ? 'bg-sky-600 text-white'
                : 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-base text-red-800" role="alert">
          {error.includes('fetch') || error.includes('network')
            ? 'Connection issue — check signal and refresh.'
            : error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : bookings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-lg font-bold text-slate-900">No upcoming trips</p>
          <p className="mt-2 text-base text-slate-600">Nothing assigned for this period.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([dayKey, dayTrips]) => (
            <section key={dayKey}>
              <h2 className="mb-3 text-lg font-black text-slate-900">{formatTripDayHeading(dayKey)}</h2>
              <div className="space-y-4">
                {dayTrips.map((trip) => (
                  <CaptainTripCard key={trip.id} trip={trip} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </CaptainShell>
  );
}
