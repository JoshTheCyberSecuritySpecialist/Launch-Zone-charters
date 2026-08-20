import { memo, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { OpsDashboardCounts } from '../../lib/adminOpsDashboard';

type ActionCenterItem = {
  key: string;
  count: number;
  label: string;
  hint: string;
  to: string;
  urgent: boolean;
};

type Props = {
  counts?: OpsDashboardCounts;
};

function buildActionCenterItems(counts?: OpsDashboardCounts): ActionCenterItem[] {
  return [
    {
      key: 'new',
      count: counts?.newBookings ?? 0,
      label: 'New bookings',
      hint: 'Since your last review',
      to: '#ops-new-bookings',
      urgent: (counts?.newBookings ?? 0) > 0,
    },
    {
      key: 'approvals',
      count: counts?.pendingApprovals ?? 0,
      label: 'Pending approvals',
      hint: 'Bookings & pre-trip',
      to: '/admin/approvals',
      urgent: (counts?.pendingApprovals ?? 0) > 0,
    },
    {
      key: 'groupon',
      count: counts?.grouponPending ?? 0,
      label: 'Groupon to review',
      hint: 'Voucher requests',
      to: '/admin/approvals',
      urgent: (counts?.grouponPending ?? 0) > 0,
    },
    {
      key: 'waivers',
      count: counts?.pendingWaivers ?? 0,
      label: 'Waivers needed',
      hint: 'Upcoming trips',
      to: '/admin/approvals',
      urgent: (counts?.pendingWaivers ?? 0) > 0,
    },
    {
      key: 'messages',
      count: counts?.unreadMessages ?? 0,
      label: 'Unread messages',
      hint: 'Contact inbox',
      to: '/admin/messages',
      urgent: (counts?.unreadMessages ?? 0) > 0,
    },
    {
      key: 'conflicts',
      count: counts?.conflicts ?? 0,
      label: 'Schedule warnings',
      hint: 'Possible conflicts',
      to: '#ops-conflicts',
      urgent: (counts?.conflicts ?? 0) > 0,
    },
  ].filter((item) => item.count > 0 || item.key === 'new');
}

function AdminOpsActionCenter({ counts }: Props) {
  const items = useMemo(() => buildActionCenterItems(counts), [counts]);

  return (
    <section aria-labelledby="ops-action-center">
      <h2 id="ops-action-center" className="text-lg font-black text-slate-900">
        Action center
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
        {items.map((item) => (
          <Link
            key={item.key}
            to={item.to.startsWith('#') ? `/admin${item.to}` : item.to}
            className={`flex min-h-[72px] flex-col justify-center rounded-2xl border px-4 py-3 ${
              item.urgent ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
            }`}
          >
            <span className="text-2xl font-black text-slate-900">{item.count}</span>
            <span className="text-sm font-bold text-slate-800">{item.label}</span>
            <span className="text-xs text-slate-600">{item.hint}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default memo(AdminOpsActionCenter);
