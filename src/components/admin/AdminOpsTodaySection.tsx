import { memo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Users } from 'lucide-react';
import { adminCharterCapacityLines } from '../../lib/charterCapacity';
import {
  sourceLabel,
  StatusPill,
  timeLabel,
  type OpsActionItem,
  type OpsTodayTrip,
} from '../../lib/adminOpsDisplay';

export type AdminOpsTodayProps = {
  todayTrips: OpsTodayTrip[];
  actionRequired: OpsActionItem[];
  nextTrip: OpsTodayTrip | null;
  paperworkMissing: number;
};

export const AdminOpsTodaySummary = memo(function AdminOpsTodaySummary({
  todayTrips,
  actionRequired,
  nextTrip,
  paperworkMissing,
}: AdminOpsTodayProps) {
  return (
    <article className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900">Today&apos;s Operations</h2>
          <p className="mt-1 text-base text-slate-700">
            <span className="font-bold">{todayTrips.length}</span> trip{todayTrips.length === 1 ? '' : 's'} today
          </p>
        </div>
        {actionRequired.length > 0 ? (
          <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-bold text-red-800">
            {actionRequired.length} urgent
          </span>
        ) : null}
      </div>
      {nextTrip ? (
        <dl className="mt-4 space-y-1 text-base text-slate-800">
          <div>
            <dt className="inline font-semibold text-slate-600">Next trip: </dt>
            <dd className="inline">{timeLabel(nextTrip.start_time, nextTrip.end_time)}</dd>
          </div>
          <div>
            <dt className="inline font-semibold text-slate-600">Customer: </dt>
            <dd className="inline">{nextTrip.customer_name}</dd>
          </div>
          {nextTrip.booking_type === 'charter' ? (
            <div>
              <dt className="inline font-semibold text-slate-600">Guests: </dt>
              <dd className="inline">{nextTrip.passenger_count}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="mt-4 text-base text-slate-600">No departures scheduled today.</p>
      )}
      {paperworkMissing > 0 ? (
        <p className="mt-3 text-base font-semibold text-amber-900">
          {paperworkMissing} trip{paperworkMissing === 1 ? '' : 's'} missing paperwork
        </p>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <a
          href="#mobile-today-detail"
          onClick={() => {
            const el = document.getElementById('mobile-today-detail');
            if (el instanceof HTMLDetailsElement) el.open = true;
          }}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-3 text-center text-sm font-bold text-white lg:hidden"
        >
          View Trips
        </a>
        <Link
          to="/admin/calendar"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-center text-sm font-bold text-slate-900"
        >
          Calendar
        </Link>
        <a
          href="#today-trips"
          className="hidden min-h-11 items-center justify-center rounded-xl bg-slate-900 px-3 text-center text-sm font-bold text-white lg:inline-flex"
        >
          View Trips
        </a>
      </div>
    </article>
  );
});

export const AdminOpsTodayMobileDetail = memo(function AdminOpsTodayMobileDetail({
  todayTrips,
  actionRequired,
}: Pick<AdminOpsTodayProps, 'todayTrips' | 'actionRequired'>) {
  return (
    <details
      id="mobile-today-detail"
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:hidden"
    >
      <summary className="cursor-pointer text-lg font-black text-slate-900">
        Today&apos;s trips &amp; schedule
      </summary>
      <div className="mt-4 space-y-4">
        {todayTrips.length === 0 ? (
          <p className="text-slate-600">No departures today.</p>
        ) : (
          todayTrips.map((trip) => (
            <Link
              key={trip.id}
              to={`/admin/bookings/${trip.id}`}
              className="block rounded-xl border border-slate-200 p-4 hover:border-amber-300"
            >
              <div className="font-bold text-slate-900">{trip.customer_name}</div>
              <div className="text-sm text-slate-600">
                {timeLabel(trip.start_time, trip.end_time)} · {trip.boat_name}
              </div>
            </Link>
          ))
        )}
        {actionRequired.length > 0 ? (
          <div>
            <h3 className="font-bold text-red-800">Needs attention</h3>
            <ul className="mt-2 space-y-2">
              {actionRequired.slice(0, 6).map((item) => (
                <li key={`${item.booking_id}-${item.type}`}>
                  <Link
                    to={`/admin/bookings/${item.booking_id}`}
                    className="block rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-900"
                  >
                    {item.label} — {item.customer_name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
});

export const AdminOpsTodayDesktopPanel = memo(function AdminOpsTodayDesktopPanel({
  todayTrips,
  actionRequired,
}: Pick<AdminOpsTodayProps, 'todayTrips' | 'actionRequired'>) {
  return (
    <>
      <div id="today-trips" className="rounded-2xl bg-white p-5 shadow">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-amber-600" />
          <h2 className="text-2xl font-black">Today&apos;s Trips</h2>
        </div>
        <div className="mt-4 grid gap-3">
          {todayTrips.length === 0 ? (
            <p className="text-slate-500">No departures today.</p>
          ) : (
            todayTrips.map((trip) => (
              <Link
                key={trip.id}
                to={`/admin/bookings/${trip.id}`}
                className="rounded-xl border border-slate-200 p-4 transition hover:border-amber-300 hover:bg-amber-50"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-lg font-black">{trip.customer_name}</h3>
                    <p className="text-sm text-slate-600">
                      {trip.boat_name} · {trip.location || 'No location'} ·{' '}
                      {timeLabel(trip.start_time, trip.end_time)}
                    </p>
                    {trip.booking_type === 'charter' ? (
                      <div className="mt-1 text-sm text-slate-600">
                        {(() => {
                          const lines = adminCharterCapacityLines(trip.passenger_count);
                          return (
                            <>
                              <div>{lines.passengerLine}</div>
                              <div>{lines.captainLine}</div>
                              <div>{lines.totalLine}</div>
                            </>
                          );
                        })()}
                        <div className="mt-1">{sourceLabel(trip.booking_source)}</div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-600">
                        {trip.passenger_count} passengers · {sourceLabel(trip.booking_source)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold capitalize">
                      {String(trip.payment_status || 'pending').replace(/_/g, ' ')}
                    </span>
                    <StatusPill ok={Boolean(trip.waiver_done)} label="Waiver" />
                    <StatusPill ok={Boolean(trip.insurance_done)} label="Insurance" />
                    <StatusPill ok={Boolean(trip.license_done)} label="License" />
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-bold ${trip.ready_for_departure ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}
                    >
                      Ready: {trip.ready_for_departure ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <h2 className="text-2xl font-black">Action Required</h2>
        </div>
        <div className="mt-4 space-y-2">
          {actionRequired.slice(0, 12).map((item) => (
            <Link
              key={`${item.booking_id}-${item.type}`}
              to={`/admin/bookings/${item.booking_id}`}
              className="block rounded-lg border border-slate-200 p-3 hover:bg-red-50"
            >
              <div className="font-black">{item.label}</div>
              <div className="text-sm text-slate-600">
                {item.customer_name}
                {item.boat_name ? ` · ${item.boat_name}` : ''}
                {item.start_time ? ` · ${timeLabel(item.start_time)}` : ''}
              </div>
            </Link>
          ))}
          {actionRequired.length === 0 ? (
            <p className="text-slate-500">Nothing needs attention.</p>
          ) : null}
        </div>
      </div>
    </>
  );
});
