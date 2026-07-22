import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, RefreshCw } from 'lucide-react';
import type { PreTripMatchSuggestion } from '../../lib/publicBooking';
import { shortId } from './adminDisplay';

type PreTripMatchPickerProps = {
  submissionId: string;
  matchedBookingId: string | null;
  customerEmail: string;
  customerName?: string | null;
  customerPhone?: string | null;
  suggestions: PreTripMatchSuggestion[] | undefined;
  suggestionsLoading: boolean;
  selectedId: string | null;
  createBookingUrl: string;
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
    <ul className="space-y-2" role="listbox" aria-label="Matching bookings">
      {list.map((s) => {
        const picked = activeId === s.id;
        return (
          <li key={`${submissionId}-${s.id}`}>
            <button
              type="button"
              role="option"
              aria-selected={picked}
              onClick={() => onSelect(s.id)}
              className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition active:scale-[0.99] ${
                picked
                  ? 'border-emerald-500 bg-emerald-100 ring-2 ring-emerald-400'
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

/** Pick a booking from suggestions — cards, search, and create-booking shortcut. */
export default function PreTripMatchPicker({
  submissionId,
  matchedBookingId,
  customerEmail,
  customerName,
  customerPhone,
  suggestions,
  suggestionsLoading,
  selectedId,
  createBookingUrl,
  onSelect,
  onLoadSuggestions,
  onSearch,
}: PreTripMatchPickerProps) {
  const defaultSearch = customerEmail || customerPhone || customerName || '';
  const [searchQuery, setSearchQuery] = useState(defaultSearch);
  const activeId = selectedId || matchedBookingId;
  const list = suggestions ?? [];
  const loaded = suggestions !== undefined;
  const activeSuggestion = list.find((s) => s.id === activeId);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-2 border-cyan-200 bg-cyan-50/80 p-4">
        <h3 className="text-base font-black text-slate-900">Link to booking</h3>
        <p className="mt-1 text-sm text-slate-700">
          Tap a matching reservation below, then approve. A booking must be selected before approval.
        </p>

        {activeId ? (
          <div className="mt-3 rounded-lg border border-emerald-300 bg-white px-3 py-3 text-sm shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-emerald-800">Selected booking</div>
            <div className="mt-1 font-bold text-slate-900">
              {activeSuggestion?.customer_name || customerName || 'Customer'}
              {activeSuggestion?.start_time
                ? ` · ${new Date(activeSuggestion.start_time).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}`
                : ''}
            </div>
            <Link
              to={`/admin/bookings/${activeId}`}
              className="mt-2 inline-flex min-h-11 items-center font-bold text-amber-800 underline"
            >
              Open booking {shortId(activeId, 10)}
            </Link>
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
            No booking selected yet — choose one from the matches below.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={suggestionsLoading}
          onClick={onLoadSuggestions}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-cyan-300 bg-white px-3 py-2 text-sm font-bold text-cyan-900 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${suggestionsLoading ? 'animate-spin' : ''}`} aria-hidden />
          {suggestionsLoading ? 'Searching…' : loaded ? 'Refresh matches' : 'Find matching bookings'}
        </button>
        <Link
          to={createBookingUrl}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800"
        >
          <CalendarPlus className="h-4 w-4" aria-hidden />
          Create Booking from Submission
        </Link>
      </div>

      {suggestionsLoading ? (
        <p className="text-sm font-semibold text-slate-500">Finding matching bookings…</p>
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
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950">
          <p className="font-bold">No booking found. Search manually or create a new booking.</p>
          <p className="mt-2 text-slate-700">
            We searched by email, phone, customer name, and requested trip date. Try a different search term or create
            the reservation first.
          </p>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <label className="block text-sm font-bold text-slate-800">
          Manual booking search
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Email, phone, or customer name"
            className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-900"
          />
        </label>
        <button
          type="button"
          disabled={suggestionsLoading || !searchQuery.trim()}
          onClick={() => onSearch(searchQuery.trim())}
          className="mt-3 min-h-11 w-full rounded-lg bg-amber-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {suggestionsLoading ? 'Searching…' : 'Search for booking'}
        </button>
      </div>
    </div>
  );
}
