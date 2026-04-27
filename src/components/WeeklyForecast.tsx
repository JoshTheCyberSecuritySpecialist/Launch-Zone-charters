import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarRange, Loader2, Sparkles } from 'lucide-react';
import { env } from '../config/env.js';
import { beginAsyncInteraction, wrapRouterNavigate } from '../lib/clickPerf';

/** Same fields as server `weeklyForecastService` / live `bioGlowModel` assessment */
export interface ForecastDay {
  date: string;
  dateLabel?: string;
  /** glowStatus: perfect | good | poor */
  status: 'perfect' | 'good' | 'poor';
  /** tier: HIGH | MEDIUM | LOW (matches live /api/bioluminescence) */
  rating?: 'HIGH' | 'MEDIUM' | 'LOW';
  score: number;
  airTempF?: number;
  waterTempF?: number | null;
  waterTempSource?: string;
  waterTempEstimate?: boolean;
  hardFailed?: boolean;
  wind: number;
  clouds: number;
  moon: number;
  moonIlluminationPercent?: number;
  moonLabel?: string;
  estimated?: boolean;
}

function cardClass(day: ForecastDay) {
  const r = day.rating;
  if (r === 'HIGH' || day.status === 'perfect') {
    return 'border-emerald-500/60 bg-emerald-950/45 shadow-[0_0_28px_rgba(52,211,153,0.2)]';
  }
  if (r === 'MEDIUM' || day.status === 'good') {
    return 'border-amber-400/55 bg-amber-950/35 shadow-[0_0_24px_rgba(251,191,36,0.15)]';
  }
  return 'border-rose-500/50 bg-rose-950/35 shadow-[0_0_20px_rgba(244,63,94,0.12)]';
}

function displayRating(day: ForecastDay): string {
  if (day.rating === 'HIGH' || day.rating === 'MEDIUM' || day.rating === 'LOW') {
    return day.rating;
  }
  if (day.status === 'perfect') return 'HIGH';
  if (day.status === 'good') return 'MEDIUM';
  return 'LOW';
}

interface WeeklyForecastProps {
  /** Tighter layout inside command center (no outer lz-bio-glow-card chrome) */
  embedded?: boolean;
  /** Section heading */
  heading?: string;
  subheading?: string;
  loadButtonLabel?: string;
  /** Desktop: horizontal scroll row; mobile: stacked */
  layout?: 'grid' | 'horizontal';
}

export default function WeeklyForecast({
  embedded = false,
  heading,
  subheading,
  loadButtonLabel,
  layout = 'grid',
}: WeeklyForecastProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<ForecastDay[] | null>(null);

  const loadForecast = useCallback(async () => {
    const perf = beginAsyncInteraction('weekly_forecast_load');
    let outcome = 'completed';
    setLoading(true);
    setError(null);
    setDays(null);
    try {
      if (!env.apiUrlConfigured || !env.apiUrl) {
        setError('⚠️ Forecast unavailable (API URL not configured)');
        outcome = 'no_api';
        return;
      }
      perf.markNetworkStart();
      const res = await fetch(`${env.apiUrl}/api/weekly-forecast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = (await res.json()) as {
        success?: boolean;
        forecast?: ForecastDay[];
        message?: string;
      };
      if (import.meta.env.DEV) {
        console.log('[weekly-forecast] client', json?.success, json?.forecast?.length);
      }
      if (!res.ok || json.success === false || !Array.isArray(json.forecast) || json.forecast.length === 0) {
        setError('⚠️ Unable to load forecast');
        outcome = 'api_empty';
        return;
      }
      setDays(json.forecast);
      outcome = 'success';
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error('[weekly-forecast]', e);
      }
      setError('⚠️ Unable to load forecast');
      outcome = 'error';
    } finally {
      setLoading(false);
      perf.end(outcome);
    }
  }, []);

  const highCount = days?.filter((d) => d.rating === 'HIGH' || d.status === 'perfect').length ?? 0;

  const bookNight = (isoDate: string) => {
    wrapRouterNavigate(
      'weekly_forecast',
      `book_night_${isoDate}`,
      navigate,
      `/booking?date=${encodeURIComponent(isoDate)}&bookingMode=charter&charterType=bio`
    )();
  };

  const shell = embedded
    ? 'rounded-2xl border border-cyan-400/20 bg-black/25 p-5 md:p-6'
    : 'lz-bio-glow-card border-cyan-400/20';

  const listClass =
    layout === 'horizontal'
      ? 'flex flex-col gap-4 md:flex-row md:flex-nowrap md:overflow-x-auto md:pb-2 md:[&>li]:min-w-[min(100%,220px)] md:[&>li]:max-w-[260px] md:[&>li]:shrink-0'
      : 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

  return (
    <div className={shell}>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 text-cyan-300">
          <CalendarRange className="h-8 w-8 shrink-0" aria-hidden />
          <div>
            <h2 className="font-display text-lg font-bold uppercase tracking-[0.15em] text-white md:text-xl">
              {heading ?? 'Weekly glow outlook'}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {subheading ??
                'Uses the same engine as “Check tonight’s glow”: Open-Meteo marine SST when available, OpenWeather forecast wind/clouds/air, moon phase, and the same hard limits (May–Oct, water ≥70°F).'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={loadForecast}
          disabled={loading}
          className="w-full shrink-0 rounded-xl border border-cyan-400/45 bg-transparent px-5 py-3 text-sm font-bold uppercase tracking-widest text-cyan-200 shadow-[0_0_20px_rgba(34,211,238,0.15)] transition hover:border-cyan-300/70 hover:shadow-[0_0_28px_rgba(34,211,238,0.28)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden />
              Loading…
            </>
          ) : (
            loadButtonLabel ?? 'View weekly forecast'
          )}
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-950/40 px-4 py-3 text-amber-100" role="alert">
          {error}
        </p>
      )}

      {days && highCount >= 2 && (
        <div className="mb-6 rounded-xl border border-orange-400/40 bg-gradient-to-r from-orange-950/50 to-amber-950/40 px-4 py-3 text-center text-sm font-semibold text-orange-100 shadow-[0_0_24px_rgba(251,146,60,0.2)]">
          🔥 Best nights this week are filling fast. Lock a date while captains still have openings.
        </div>
      )}

      {days && (
        <ul className={listClass}>
          {days.map((d) => {
            const label = displayRating(d);
            const isHigh = d.rating === 'HIGH' || d.status === 'perfect';
            return (
              <li
                key={d.date}
                className={`flex flex-col rounded-xl border p-4 text-left transition-transform hover:scale-[1.02] ${cardClass(d)}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-widest text-white/90">
                    {d.dateLabel || d.date}
                  </p>
                  {d.estimated && (
                    <span className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] text-slate-400">Est. wx</span>
                  )}
                </div>
                <p className="mt-2 font-display text-xl font-bold tracking-tight text-white">{label}</p>
                <p className="text-[10px] font-medium uppercase tracking-wider text-white/50">Glow rating</p>
                {d.hardFailed && (
                  <p className="mt-1 text-[10px] leading-snug text-amber-200/90">
                    Hard limits (off-season or water &lt; 70°F)
                  </p>
                )}
                <p className="mt-2 font-mono text-xs text-slate-400">Score {d.score}/100</p>
                <dl className="mt-3 space-y-1 text-xs text-slate-300">
                  {typeof d.airTempF === 'number' && Number.isFinite(d.airTempF) && (
                    <div className="flex justify-between gap-2">
                      <dt>Air</dt>
                      <dd className="font-mono text-cyan-100/90">{d.airTempF}°F</dd>
                    </div>
                  )}
                  {d.waterTempF != null && (
                    <div className="flex justify-between gap-2">
                      <dt>{d.waterTempSource === 'open-meteo-marine' ? 'Water (marine)' : 'Water (est.)'}</dt>
                      <dd className="font-mono text-cyan-100/90">~{d.waterTempF}°F</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-2">
                    <dt>Wind</dt>
                    <dd className="font-mono text-cyan-100/90">{d.wind} mph</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Clouds</dt>
                    <dd className="font-mono text-cyan-100/90">{d.clouds}%</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Moon</dt>
                    <dd className="max-w-[58%] text-right font-mono text-[11px] leading-tight text-cyan-100/90">
                      {d.moonLabel && d.moonIlluminationPercent != null
                        ? `${d.moonLabel} (~${d.moonIlluminationPercent}%)`
                        : d.moonIlluminationPercent != null
                          ? `~${d.moonIlluminationPercent}% lit`
                          : String(d.moon)}
                    </dd>
                  </div>
                </dl>

                {isHigh && (
                  <div className="mt-4 border-t border-white/10 pt-4">
                    <p className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                      <Sparkles className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden />
                      Strong night on the model: spots can fill fast
                    </p>
                    <button
                      type="button"
                      onClick={() => bookNight(d.date)}
                      className="lz-btn-primary mt-3 w-full !py-2 !text-xs !uppercase"
                    >
                      Book This Night
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
