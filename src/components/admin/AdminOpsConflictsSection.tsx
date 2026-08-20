import { memo } from 'react';
import { Link } from 'react-router-dom';
import type { OpsConflict } from '../../lib/adminOpsDashboard';

type Props = {
  conflicts: OpsConflict[];
};

function AdminOpsConflictsSection({ conflicts }: Props) {
  if (conflicts.length === 0) return null;

  return (
    <section id="ops-conflicts" aria-labelledby="ops-conflicts-heading">
      <h2 id="ops-conflicts-heading" className="text-lg font-black text-red-900">
        Schedule warnings
      </h2>
      <ul className="mt-3 space-y-2">
        {conflicts.slice(0, 8).map((c) => (
          <li key={`${c.type}-${c.booking_id}-${c.other_booking_id || ''}`}>
            <Link
              to={`/admin/bookings/${c.booking_id}`}
              className="block min-h-11 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-950"
            >
              {c.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default memo(AdminOpsConflictsSection);
