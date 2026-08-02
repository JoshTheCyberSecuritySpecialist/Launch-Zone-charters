import { AlertTriangle, Cloud, RefreshCw, Waves, Wind } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import StatusBadge from '../admin/StatusBadge';
import {
  fetchMarineConditions,
  marineGoTone,
  marineLocationKeyFromRentalLocation,
  summarizeMarineConditions,
  type MarineConditionsOk,
  type MarineLocationKey,
} from '../../lib/marineConditions';

type CaptainMarineConditionsPanelProps = {
  rentalLocation: string | null | undefined;
  /** Optional override when showing a fixed location (e.g. dashboard default). */
  locationKey?: MarineLocationKey;
  compact?: boolean;
};

export default function CaptainMarineConditionsPanel({
  rentalLocation,
  locationKey,
  compact = false,
}: CaptainMarineConditionsPanelProps) {
  const resolvedKey = locationKey || marineLocationKeyFromRentalLocation(rentalLocation);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<MarineConditionsOk | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const payload = await fetchMarineConditions(resolvedKey);
      if (!payload.success) {
        setData(null);
        setError(payload.error || 'Live data temporarily unavailable');
        return;
      }
      setData(payload);
    } catch {
      setData(null);
      setError('Live data temporarily unavailable');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [resolvedKey]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    void load();
  };

  const summary = data ? summarizeMarineConditions(data) : null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="inline-flex items-center gap-2 text-lg font-bold text-slate-900">
            <Cloud className="h-5 w-5 text-sky-600" aria-hidden />
            Marine conditions
          </h2>
          <p className="mt-1 text-sm text-slate-600">{summary?.locationLabel || (resolvedKey === 'titusville' ? 'Titusville / Space Coast' : 'Port Orange / Daytona Beach')}</p>
        </div>
        <div className="flex items-center gap-2">
          {summary ? (
            <StatusBadge tone={marineGoTone(summary.statusLevel)}>{summary.goLabel}</StatusBadge>
          ) : null}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading || refreshing}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            aria-label="Refresh marine conditions"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing || loading ? 'animate-spin' : ''}`} aria-hidden />
          </button>
        </div>
      </div>

      {loading ? (
        <p className="mt-4 text-base text-slate-500" aria-live="polite">
          Loading NOAA conditions…
        </p>
      ) : error ? (
        <p className="mt-4 rounded-xl bg-slate-100 px-3 py-2 text-base text-slate-700" role="status">
          {error}
        </p>
      ) : summary ? (
        <>
          <dl className={`mt-4 grid gap-3 ${compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <dt className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Wind className="h-3.5 w-3.5" aria-hidden />
                Wind
              </dt>
              <dd className="mt-1 text-base font-bold text-slate-900">{summary.wind || '—'}</dd>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <dt className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Waves className="h-3.5 w-3.5" aria-hidden />
                Waves
              </dt>
              <dd className="mt-1 text-base font-bold text-slate-900">{summary.waves || '—'}</dd>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Air</dt>
              <dd className="mt-1 text-base font-bold text-slate-900">{summary.airTemp || '—'}</dd>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Water</dt>
              <dd className="mt-1 text-base font-bold text-slate-900">{summary.waterTemp || '—'}</dd>
            </div>
          </dl>

          {summary.forecast ? (
            <p className="mt-3 text-base leading-snug text-slate-800">{summary.forecast}</p>
          ) : null}

          {summary.alertCount > 0 ? (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                {summary.alertCount} active weather alert{summary.alertCount === 1 ? '' : 's'} for this area. Check NOAA before departure.
              </p>
            </div>
          ) : null}

          <p className="mt-3 text-xs text-slate-500">NOAA + Open-Meteo · refreshes every 5 minutes</p>
        </>
      ) : null}
    </section>
  );
}
