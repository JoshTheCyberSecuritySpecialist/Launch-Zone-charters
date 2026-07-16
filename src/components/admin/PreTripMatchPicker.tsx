import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { PreTripMatchSuggestion } from '../../lib/publicBooking';
import { shortId } from './adminDisplay';

type PreTripMatchPickerProps = {
  submissionId: string;
  matchedBookingId: string | null;
  customerEmail: string;
  customerName?: string | null;
  suggestions: PreTripMatchSuggestion[] | undefined;
  suggestionsLoading: boolean;
  selectedId: string | null;
  onSelect: (bookingId: string) => void;
  onLoadSuggestions: () => void;
  onSearch: (query: string) => void;
};

function SuggestionList({
  submissionId,
  list,
  activeId,
  onSelect,
}: {
  submissionId: string;
  list: PreTripMatchSuggestion[];
  activeId: string | null;
  onSelect: (bookingId: string) => void;
}) {
  return (
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
  );
}

/** Pick a booking from suggestions — no manual UUID entry. */
export default function PreTripMatchPicker({
  submissionId,
  matchedBookingId,
  customerEmail,
  customerName,
  suggestions,
  suggestionsLoading,
  selectedId,
  onSelect,
  onLoadSuggestions,
  onSearch,
}: PreTripMatchPickerProps) {
  const [searchQuery, setSearchQuery] = useState(customerEmail || customerName || '');
  const activeId = selectedId || matchedBookingId;
  const list = suggestions ?? [];
  const loaded = suggestions !== undefined;

  return (
    <div className="space-y-3">
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
        <p className="text-sm font-semibold text-slate-700">
          Step 1: Tap the customer&apos;s booking below. Step 2: Tap Approve.
        </p>
      )}

      {suggestionsLoading ? (
        <p className="text-sm font-semibold text-slate-500">Finding matching bookings…</p>
      ) : null}

      {!loaded && !suggestionsLoading ? (
        <button
          type="button"
          onClick={onLoadSuggestions}
          className="min-h-11 w-full rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-900"
        >
          Find matching bookings
        </button>
      ) : null}

      {list.length > 0 ? (
        <SuggestionList
          submissionId={submissionId}
          list={list}
          activeId={activeId}
          onSelect={onSelect}
        />
      ) : null}

      {loaded && list.length === 0 && !suggestionsLoading ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
          <p className="font-semibold">No booking matched automatically.</p>
          <p className="mt-1">Try searching by a different email, phone, or name.</p>
        </div>
      ) : null}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <label className="block text-sm font-bold text-slate-800">
          Search bookings
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Email, phone, or customer name"
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-900"
          />
        </label>
        <button
          type="button"
          disabled={suggestionsLoading || !searchQuery.trim()}
          onClick={() => onSearch(searchQuery.trim())}
          className="mt-2 min-h-11 w-full rounded-lg bg-amber-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {suggestionsLoading ? 'Searching…' : 'Search for booking'}
        </button>
      </div>
    </div>
  );
}
