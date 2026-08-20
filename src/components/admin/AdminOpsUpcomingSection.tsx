import { memo } from 'react';
import { Link } from 'react-router-dom';

type UpcomingCounts = {
  today: number;
  tomorrow: number;
  weekend: number;
  nextSevenDays: number;
};

type Props = {
  upcoming?: UpcomingCounts | null;
};

const UPCOMING_BUCKETS = [
  ['Today', 'today'],
  ['Tomorrow', 'tomorrow'],
  ['Weekend', 'weekend'],
  ['Next 7 days', 'week'],
] as const;

function AdminOpsUpcomingSection({ upcoming }: Props) {
  if (!upcoming) return null;

  const values: Record<(typeof UPCOMING_BUCKETS)[number][1], number> = {
    today: upcoming.today,
    tomorrow: upcoming.tomorrow,
    weekend: upcoming.weekend,
    week: upcoming.nextSevenDays,
  };

  return (
    <section aria-labelledby="ops-upcoming-heading">
      <h2 id="ops-upcoming-heading" className="text-lg font-black text-slate-900">
        Upcoming
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {UPCOMING_BUCKETS.map(([label, key]) => (
          <Link
            key={label}
            to="/admin/calendar"
            className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-3 text-center"
          >
            <div className="text-xl font-black text-slate-900">{values[key]}</div>
            <div className="text-xs font-semibold text-slate-600">{label}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default memo(AdminOpsUpcomingSection);
