import { memo } from 'react';
import { Link } from 'react-router-dom';
import type { OpsConflict } from '../../lib/adminOpsDashboard';

type Props = {
  conflicts: OpsConflict[];
  twoBoatCoverageEnabled?: boolean;
};

function AdminOpsConflictsSection({ conflicts, twoBoatCoverageEnabled }: Props) {
  if (conflicts.length === 0) return null;

  return (
    <section id="ops-conflicts" aria-labelledby="ops-conflicts-heading">
      <h2 id="ops-conflicts-heading" className="text-lg font-black text-red-900">
        Schedule warnings
      </h2>
      {twoBoatCoverageEnabled ? (
        <p className="mt-1 text-xs font-medium text-red-800/80">
          Two-boat operations enabled — overlapping boats need two different captains before ready for
          departure.
        </p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {conflicts.slice(0, 8).map((c) => {
          const high =
            c.type === 'dual_boat_captain_gap' ||
            c.type === 'center_console_missing_captain' ||
            c.type === 'captain_overlap';
          return (
            <li key={`${c.type}-${c.booking_id}-${c.other_booking_id || ''}`}>
              <Link
                to={`/admin/bookings/${c.booking_id}`}
                className={`block min-h-11 rounded-xl border px-4 py-3 text-sm font-semibold ${
                  high
                    ? 'border-amber-400 bg-amber-50 text-amber-950'
                    : 'border-red-200 bg-red-50 text-red-950'
                }`}
              >
                {c.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default memo(AdminOpsConflictsSection);
