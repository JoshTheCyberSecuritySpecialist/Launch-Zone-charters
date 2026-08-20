import { memo } from 'react';
import { Link } from 'react-router-dom';
import { DollarSign } from 'lucide-react';
import { humanizeLabel } from './adminDisplay';

type ActivityEvent = {
  id: string;
  booking_id?: string | null;
  event_type: string;
  message?: string | null;
  created_at: string;
};

type Props = {
  events: ActivityEvent[];
};

function AdminOpsRecentActivitySection({ events }: Props) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow">
      <div className="flex items-center gap-2">
        <DollarSign className="h-5 w-5 text-green-700" />
        <h2 className="text-2xl font-black">Recent Activity</h2>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {events.slice(0, 16).map((event) => (
          <Link
            key={event.id}
            to={event.booking_id ? `/admin/bookings/${event.booking_id}` : '/admin/bookings'}
            className="rounded-lg border border-slate-200 p-3 hover:bg-slate-50"
          >
            <div className="font-bold">{humanizeLabel(event.event_type)}</div>
            <div className="text-sm text-slate-600">{event.message || 'Booking activity'}</div>
            <div className="text-xs text-slate-500">{new Date(event.created_at).toLocaleString()}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default memo(AdminOpsRecentActivitySection);
