import { memo } from 'react';
import {
  OPS_FILTER_OPTIONS,
  OPS_SORT_OPTIONS,
  type OpsDashboardSort,
  type OpsNewBookingGroup,
} from '../../lib/adminOpsDashboard';
import AdminOpsNewBookingCard from './AdminOpsNewBookingCard';

type Props = {
  groups: OpsNewBookingGroup[];
  newBookingsCount: number;
  opsSort: OpsDashboardSort;
  onSortChange: (sort: OpsDashboardSort) => void;
  opsFilter: string;
  onFilterChange: (filter: string) => void;
  queryMatchesApplied: boolean;
  bookingsRefreshing: boolean;
  bookingsError: string | null;
  onRetry: () => void;
  onMarkAllReviewed: () => void;
  onMarkReviewed: (bookingId: string) => void;
};

function AdminOpsNewBookingsSection({
  groups,
  newBookingsCount,
  opsSort,
  onSortChange,
  opsFilter,
  onFilterChange,
  queryMatchesApplied,
  bookingsRefreshing,
  bookingsError,
  onRetry,
  onMarkAllReviewed,
  onMarkReviewed,
}: Props) {
  return (
    <section id="ops-new-bookings" aria-labelledby="ops-new-bookings-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ops-new-bookings-heading" className="text-lg font-black text-slate-900">
          New bookings
        </h2>
        {newBookingsCount > 0 ? (
          <button
            type="button"
            onClick={onMarkAllReviewed}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
          >
            Mark all reviewed
          </button>
        ) : null}
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex min-h-11 flex-1 items-center gap-2 text-sm font-semibold text-slate-800">
          Sort
          <select
            value={opsSort}
            onChange={(e) => onSortChange(e.target.value as OpsDashboardSort)}
            className="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {OPS_SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
        {OPS_FILTER_OPTIONS.map((f) => {
          const active = opsFilter === f.id && queryMatchesApplied;
          const pending = opsFilter === f.id && !queryMatchesApplied && bookingsRefreshing;
          return (
            <button
              key={f.id || 'all'}
              type="button"
              onClick={() => onFilterChange(f.id)}
              aria-pressed={opsFilter === f.id}
              className={`shrink-0 min-h-11 rounded-full px-4 py-2 text-sm font-semibold touch-manipulation ${
                active
                  ? 'bg-slate-900 text-white'
                  : pending
                    ? 'border border-slate-900 bg-slate-100 text-slate-900'
                    : 'border border-slate-300 bg-white text-slate-800'
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {bookingsError ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950">
          <p className="font-semibold">{bookingsError}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 min-h-11 rounded-lg bg-red-900 px-4 py-2 text-sm font-bold text-white"
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="relative mt-4 space-y-6" aria-busy={bookingsRefreshing}>
        {bookingsRefreshing && !queryMatchesApplied ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-base font-semibold text-slate-700">
            Refreshing bookings…
          </p>
        ) : null}
        {!bookingsRefreshing && queryMatchesApplied && groups.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-base text-slate-600">
            No new bookings match this filter.
          </p>
        ) : null}
        {queryMatchesApplied && groups.length > 0
          ? groups.map((group) => (
              <div key={group.groupKey}>
                <header className="border-b border-slate-200 pb-2">
                  {group.headerRelative ? (
                    <p className="text-sm font-black tracking-wide text-amber-800">{group.headerRelative}</p>
                  ) : group.groupKey === 'needs-review' ? (
                    <p className="text-sm font-black text-red-800">NEEDS SCHEDULING REVIEW</p>
                  ) : (
                    <p className="text-sm font-black text-slate-600">LATER</p>
                  )}
                  <p className="text-base font-bold text-slate-900">{group.headerDate}</p>
                </header>
                <div className="mt-3 space-y-3">
                  {group.bookings.map((booking) => (
                    <AdminOpsNewBookingCard
                      key={booking.id}
                      booking={booking}
                      onMarkReviewed={onMarkReviewed}
                    />
                  ))}
                </div>
              </div>
            ))
          : null}
        {bookingsRefreshing && queryMatchesApplied ? (
          <p className="text-center text-sm font-semibold text-slate-500">Refreshing bookings…</p>
        ) : null}
      </div>
    </section>
  );
}

export default memo(AdminOpsNewBookingsSection);
