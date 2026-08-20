import { memo } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import AdminResponsiveList from './AdminResponsiveList';
import { humanizeLabel } from './adminDisplay';
import { timeLabel, type OpsScheduleBoat } from '../../lib/adminOpsDisplay';

type Props = {
  boats: OpsScheduleBoat[];
};

function AdminOpsScheduleSection({ boats }: Props) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-5 w-5 text-cyan-700" />
        <h2 className="text-2xl font-black">Today&apos;s Schedule</h2>
      </div>
      <div className="mt-4">
        {boats.length === 0 ? (
          <p className="text-slate-500">No boats scheduled.</p>
        ) : (
          <AdminResponsiveList
            desktop={
              <div className="overflow-x-auto">
                <div className="min-w-[760px] space-y-3">
                  {boats.map((boat) => (
                    <div key={boat.id} className="grid grid-cols-[160px_1fr] items-stretch gap-3">
                      <div className="rounded-lg bg-slate-100 p-3 font-black">{boat.name}</div>
                      <div className="flex min-h-[56px] gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                        {boat.bookings.length === 0 ? (
                          <span className="self-center text-sm text-slate-500">Open all day</span>
                        ) : (
                          boat.bookings.map((booking) => (
                            <Link
                              key={booking.id}
                              to={`/admin/bookings/${booking.id}`}
                              className="min-w-[180px] rounded-lg bg-blue-100 px-3 py-2 text-sm font-bold text-blue-950"
                            >
                              {timeLabel(booking.start_time, booking.end_time)}
                              <br />
                              {booking.customer_name}
                            </Link>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            }
            mobile={
              <div className="space-y-3">
                {boats.map((boat) => (
                  <article key={boat.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-base font-black text-slate-900">{boat.name}</h3>
                      <span className="text-xs font-semibold text-slate-500">
                        {boat.bookings.length === 0
                          ? 'Open'
                          : `${boat.bookings.length} trip${boat.bookings.length === 1 ? '' : 's'}`}
                      </span>
                    </div>
                    {boat.bookings.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-500">Open all day</p>
                    ) : (
                      <ul className="mt-3 space-y-2">
                        {boat.bookings.map((booking) => (
                          <li key={booking.id}>
                            <Link
                              to={`/admin/bookings/${booking.id}`}
                              className="block rounded-lg bg-blue-100 px-3 py-3 text-sm font-bold text-blue-950"
                            >
                              <div>{timeLabel(booking.start_time, booking.end_time)}</div>
                              <div className="mt-0.5">{booking.customer_name}</div>
                              <div className="mt-0.5 text-xs font-semibold text-blue-900/80">
                                {humanizeLabel(booking.status)} · {humanizeLabel(booking.payment_status)}
                              </div>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                ))}
              </div>
            }
          />
        )}
      </div>
    </section>
  );
}

export default memo(AdminOpsScheduleSection);
