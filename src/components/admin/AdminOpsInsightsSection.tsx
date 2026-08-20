import { memo } from 'react';
import { Link } from 'react-router-dom';
import { CloudSun } from 'lucide-react';
import { sourceLabel, weatherDisplay, type OpsActionItem } from '../../lib/adminOpsDisplay';

type Props = {
  sourceRows: Array<[string, number]>;
  weather: Record<string, unknown>;
  alerts: OpsActionItem[];
};

function AdminOpsInsightsSection({ sourceRows, weather, alerts }: Props) {
  return (
    <section className="grid gap-5 lg:grid-cols-3">
      <div className="rounded-2xl bg-white p-5 shadow">
        <h2 className="text-2xl font-black">Booking Sources</h2>
        <div className="mt-4 space-y-2">
          {sourceRows.length === 0 ? <p className="text-slate-500">No source data yet.</p> : null}
          {sourceRows.map(([source, count]) => (
            <div key={source} className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2">
              <span className="font-bold">{sourceLabel(source)}</span>
              <span className="text-lg font-black">{count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow">
        <div className="flex items-center gap-2">
          <CloudSun className="h-5 w-5 text-sky-700" />
          <h2 className="text-2xl font-black">Weather Snapshot</h2>
        </div>
        <div className="mt-4 grid gap-2 text-sm">
          <div>
            <span className="font-bold">Conditions:</span>{' '}
            {weatherDisplay(weather.status) ||
              weatherDisplay(weather.shortForecast) ||
              weatherDisplay(weather.error) ||
              'Unavailable'}
          </div>
          <div>
            <span className="font-bold">Wind:</span>{' '}
            {weather.windSpeed != null
              ? `${Math.round(Number(weather.windSpeed))} mph ${String(weather.windDirection || '')}`
              : 'Unavailable'}
          </div>
          <div>
            <span className="font-bold">Temperature:</span>{' '}
            {weather.airTempF != null ? `${Math.round(Number(weather.airTempF))}°F` : 'Unavailable'}
          </div>
          <div>
            <span className="font-bold">Wave Height:</span>{' '}
            {weather.waveHeightFt != null ? `${Number(weather.waveHeightFt).toFixed(1)} ft` : 'Unavailable'}
          </div>
          <div>
            <span className="font-bold">Rain Chance:</span>{' '}
            {weatherDisplay(
              Array.isArray(weather.forecastPeriods)
                ? (weather.forecastPeriods as Array<{ shortForecast?: string }>)[0]?.shortForecast
                : null
            ) ||
              weatherDisplay(weather.shortForecast) ||
              'Unavailable'}
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow">
        <h2 className="text-2xl font-black">Alerts</h2>
        <div className="mt-4 space-y-2">
          {alerts.slice(0, 8).map((alert) => (
            <Link
              key={`${alert.booking_id}-${alert.type}-alert`}
              to={`/admin/bookings/${alert.booking_id}`}
              className="block rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-900"
            >
              {alert.label}: {alert.customer_name}
            </Link>
          ))}
          {alerts.length === 0 ? <p className="text-slate-500">No urgent alerts.</p> : null}
        </div>
      </div>
    </section>
  );
}

export default memo(AdminOpsInsightsSection);
