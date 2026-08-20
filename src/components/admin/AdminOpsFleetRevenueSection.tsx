import { memo } from 'react';
import { Link } from 'react-router-dom';
import { ShipWheel } from 'lucide-react';
import { money, type OpsBoatStatusRow, type OpsRevenueSummary } from '../../lib/adminOpsDisplay';

type Props = {
  boatStatus: OpsBoatStatusRow[];
  revenue: {
    today: OpsRevenueSummary;
    week: OpsRevenueSummary;
    month: OpsRevenueSummary;
  };
};

function RevenueCard({ title, row }: { title: string; row: OpsRevenueSummary }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow">
      <h3 className="font-black text-slate-900">{title}</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-slate-500">Bookings</div>
          <div className="text-xl font-black">{row.bookings}</div>
        </div>
        <div>
          <div className="text-slate-500">Revenue</div>
          <div className="text-xl font-black">{money(row.revenue)}</div>
        </div>
        <div>
          <div className="text-slate-500">Deposits</div>
          <div className="font-bold">{money(row.deposits)}</div>
        </div>
        <div>
          <div className="text-slate-500">Outstanding</div>
          <div className="font-bold text-amber-700">{money(row.outstandingBalance)}</div>
        </div>
        <div className="col-span-2">
          <div className="text-slate-500">Average Booking Value</div>
          <div className="font-bold">{money(row.averageBookingValue)}</div>
        </div>
      </div>
    </div>
  );
}

function boatStatusClass(status: string) {
  if (status === 'Available') return 'bg-green-100 text-green-800';
  if (status === 'In Use') return 'bg-blue-100 text-blue-800';
  if (status === 'Booked') return 'bg-amber-100 text-amber-800';
  if (status === 'Blocked') return 'bg-slate-200 text-slate-800';
  return 'bg-red-100 text-red-800';
}

function AdminOpsFleetRevenueSection({ boatStatus, revenue }: Props) {
  return (
    <section className="grid gap-5 lg:grid-cols-3">
      <div className="rounded-2xl bg-white p-5 shadow">
        <div className="flex items-center gap-2">
          <ShipWheel className="h-5 w-5 text-blue-700" />
          <h2 className="text-2xl font-black">Boat Status</h2>
        </div>
        <div className="mt-4 grid gap-2">
          {boatStatus.map((boat) => (
            <div key={boat.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <span className="font-bold">{boat.name}</span>
              <span className={`rounded-full px-3 py-1 text-xs font-black ${boatStatusClass(boat.status)}`}>
                {boat.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-3 lg:col-span-2">
        <RevenueCard title="Today" row={revenue.today} />
        <RevenueCard title="This Week" row={revenue.week} />
        <RevenueCard title="This Month" row={revenue.month} />
      </div>
      <p className="text-sm text-slate-600 lg:col-span-3">
        <Link to="/admin/analytics" className="font-semibold text-amber-800 underline">
          View lifetime analytics
        </Link>
      </p>
    </section>
  );
}

export default memo(AdminOpsFleetRevenueSection);
