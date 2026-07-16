import { Link } from 'react-router-dom';
import type { PreTripMatchSuggestion } from '../../lib/publicBooking';
import { shortId } from './adminDisplay';

type PreTripMatchPickerProps = {
  submissionId: string;
  matchedBookingId: string | null;
  customerEmail: string;
  suggestions: PreTripMatchSuggestion[] | undefined;
  suggestionsLoading: boolean;
  selectedId: string | null;
  onSelect: (bookingId: string) => void;
  onLoadSuggestions: () => void;
};

/** Pick a booking from suggestions — no manual UUID entry. */
export default function PreTripMatchPicker({
  submissionId,
  matchedBookingId,
  customerEmail,
  suggestions,
  suggestionsLoading,
  selectedId,
  onSelect,
  onLoadSuggestions,
}: PreTripMatchPickerProps) {
  const activeId = selectedId || matchedBookingId;
  const list = suggestions ?? [];
  const loaded = suggestions !== undefined;

  return (
    <div className="space-y-2">
      {activeId ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
          <div className="font-semibold text-emerald-950">Selected booking</div>
          <Link
            to={`/admin/bookings/${activeId}`}
            className="mt-1 inline-block font-bold text-amber-800 underline"
          >
            Open booking {shortId(activeId, 10)}
          </Link>
        </div>
      ) : (
        <p className="text-sm text-slate-600">Tap a suggested booking below.</p>
      )}

      {suggestionsLoading ? (
        <p className="text-sm font-semibold text-slate-500">Finding matching bookings…</p>
      ) : null}

      {!loaded && !suggestionsLoading ? (
        <button
          type="button"
          onClick={onLoadSuggestions}
          className="rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-900"
        >
          Find matching bookings
        </button>
      ) : null}

      {loaded && list.length === 0 && !suggestionsLoading ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-semibold">No automatic match found.</p>
          <p className="mt-1">
            Search{' '}
            <Link to="/admin/bookings/list" className="font-bold underline">
              All Bookings
            </Link>{' '}
            for <span className="font-semibold">{customerEmail}</span>, open the reservation, then return here.
          </p>
        </div>
      ) : null}

      {list.length > 0 ? (
        <ul className="space-y-2">
          {list.map((s) => {
            const picked = activeId === s.id;
            return (
              <li key={`${submissionId}-${s.id}`}>
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  className={`w-full rounded-lg border px-3 py-3 text-left text-sm transition ${
                    picked
                      ? 'border-emerald-400 bg-emerald-100 ring-2 ring-emerald-300'
                      : 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100'
                  }`}
                >
                  <div className="font-bold text-emerald-950">{s.match_reason}</div>
                  <div className="mt-0.5 text-slate-800">
                    {s.customer_name || 'Customer'} ·{' '}
                    {new Date(s.start_time).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </div>
                  {s.boat_name ? <div className="text-xs text-slate-600">Boat: {s.boat_name}</div> : null}
                  {s.promo_code ? (
                    <div className="text-xs font-medium text-emerald-800">Promo: {s.promo_code}</div>
                  ) : null}
                  <div className="mt-1 font-mono text-xs text-slate-500" title={s.id}>
                    Ref {shortId(s.id, 10)}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
