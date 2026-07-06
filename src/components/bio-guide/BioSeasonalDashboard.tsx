import { useCallback, useEffect, useState } from 'react';
import { Calendar, Cloud, Loader2, Moon, Thermometer, Waves } from 'lucide-react';
import { fetchBioluminescence, glowStatusLabel, normalizeRating } from '../../lib/bioluminescenceApi';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function seasonLabel(inDinoSeason: boolean | undefined): string {
  if (inDinoSeason === true) return 'Peak dinoflagellate season (May–Oct trend)';
  if (inDinoSeason === false) return 'Outside peak dinoflagellate season';
  return 'Season varies — check live data';
}

export default function BioSeasonalDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month] = useState(() => MONTH_NAMES[new Date().getMonth()]);
  const [snapshot, setSnapshot] = useState<{
    season: string;
    waterTemp?: string;
    viewing: string;
    moon?: string;
    forecast: string;
    clouds?: string;
    wind?: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchBioluminescence();
    if (!res.ok) {
      setSnapshot({
        season: seasonLabel(undefined),
        viewing: 'Unavailable',
        forecast: res.message ?? 'Live data temporarily unavailable — check marine conditions.',
      });
      setError('live');
      setLoading(false);
      return;
    }
    const d = res.data;
    setSnapshot({
      season: seasonLabel(d.inDinoSeason),
      waterTemp:
        d.waterTempF != null
          ? `${d.waterTempF}°F${d.waterTempSource ? ` (${d.waterTempSource})` : ''}`
          : 'Not reported',
      viewing: `${glowStatusLabel(d.status)}${d.rating && d.rating !== 'Unavailable' ? ` · ${normalizeRating(d.rating) ?? d.rating}` : ''}`,
      moon: d.data?.moonLabel
        ? `${d.data.moonLabel}${typeof d.data.moonIlluminationPercent === 'number' ? ` · ${d.data.moonIlluminationPercent}% lit` : ''}`
        : undefined,
      forecast: d.message || d.explanation || 'See tonight’s conditions widget for detail.',
      clouds: typeof d.clouds === 'number' ? `${d.clouds}% cover` : undefined,
      wind: typeof d.wind === 'number' ? `${d.wind} mph` : undefined,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      className="my-8 rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-slate-950/80 to-cyan-950/20 p-5 sm:p-6"
      aria-labelledby="bio-seasonal-dashboard-heading"
    >
      <h3 id="bio-seasonal-dashboard-heading" className="text-lg font-bold text-white sm:text-xl">
        Seasonal Snapshot
      </h3>
      <p className="mt-1 text-sm text-slate-400">
        Reuses live GET /api/bioluminescence — same model as our conditions widget.
      </p>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-400" role="status">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-400 motion-reduce:animate-none" aria-hidden />
          Loading seasonal dashboard…
        </div>
      ) : null}

      {snapshot ? (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-black/25 p-3">
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Calendar className="h-3.5 w-3.5" aria-hidden />
              Current month
            </dt>
            <dd className="mt-1 text-sm font-medium text-white">{month}</dd>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/25 p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bio season</dt>
            <dd className="mt-1 text-sm text-white">{snapshot.season}</dd>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/25 p-3">
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Thermometer className="h-3.5 w-3.5" aria-hidden />
              Water temperature
            </dt>
            <dd className="mt-1 text-sm text-white">{snapshot.waterTemp}</dd>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/25 p-3">
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Waves className="h-3.5 w-3.5" aria-hidden />
              Expected viewing quality
            </dt>
            <dd className="mt-1 text-sm text-white">{snapshot.viewing}</dd>
          </div>
          {snapshot.moon ? (
            <div className="rounded-lg border border-white/10 bg-black/25 p-3">
              <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <Moon className="h-3.5 w-3.5" aria-hidden />
                Moon phase
              </dt>
              <dd className="mt-1 text-sm text-white">{snapshot.moon}</dd>
            </div>
          ) : null}
          <div className="rounded-lg border border-white/10 bg-black/25 p-3 sm:col-span-2 lg:col-span-1">
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Cloud className="h-3.5 w-3.5" aria-hidden />
              Current forecast
            </dt>
            <dd className="mt-1 text-sm text-white">{snapshot.forecast}</dd>
            {snapshot.wind || snapshot.clouds ? (
              <dd className="mt-1 text-xs text-slate-400">
                {[snapshot.wind, snapshot.clouds].filter(Boolean).join(' · ')}
              </dd>
            ) : null}
          </div>
        </dl>
      ) : null}

      {error && !loading ? (
        <p className="mt-3 text-xs text-amber-200/90" role="status">
          Dashboard shows partial data when live API is unavailable.
        </p>
      ) : null}
    </section>
  );
}
