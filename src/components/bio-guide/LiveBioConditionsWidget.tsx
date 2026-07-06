import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Loader2, Moon, RefreshCw, Thermometer, Wind } from 'lucide-react';
import {
  fetchBioluminescence,
  glowStatusLabel,
  normalizeRating,
  type GlowCheckResponse,
  type GlowFetchError,
} from '../../lib/bioluminescenceApi';
import { beginAsyncInteraction, wrapSyncClick } from '../../lib/clickPerf';

function ratingAccentClass(rating: string | undefined) {
  const n = normalizeRating(rating);
  if (n === 'HIGH' || rating === 'High') {
    return 'border-emerald-400/50 bg-emerald-950/35 text-emerald-100';
  }
  if (n === 'MEDIUM' || rating === 'Moderate') {
    return 'border-amber-400/45 bg-amber-950/30 text-amber-50';
  }
  if (n === 'LOW' || rating === 'Low') {
    return 'border-rose-500/45 bg-rose-950/35 text-rose-50';
  }
  return 'border-slate-500/50 bg-slate-950/50 text-slate-200';
}

function viewingWindowHint(result: GlowCheckResponse | null): string {
  if (!result?.success) {
    return 'Check back after sunset on clear, calm nights — typically strongest between about 9:00 PM and midnight when skies are dark.';
  }
  if (result.explanation?.trim()) return result.explanation;
  if (result.message?.trim()) return result.message;
  return 'Plan for the first hours after full darkness on nights with low wind and minimal cloud cover.';
}

function marineWarnings(result: GlowCheckResponse | null): string[] {
  if (!result) return [];
  const lines: string[] = [];
  if (result.hardFailed && Array.isArray(result.hardFailReasons)) {
    lines.push(...result.hardFailReasons.filter(Boolean));
  }
  result.reasoning
    ?.filter((r) => r.kind === 'bad' || r.kind === 'warn')
    .forEach((r) => {
      if (r.text && !lines.includes(r.text)) lines.push(r.text);
    });
  if (typeof result.wind === 'number' && result.wind >= 15) {
    lines.push(`Elevated wind (~${result.wind} mph) may chop the surface and reduce visibility.`);
  }
  return lines;
}

export default function LiveBioConditionsWidget() {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<GlowCheckResponse | null>(null);
  const [fetchError, setFetchError] = useState<GlowFetchError>(null);
  const [unavailableMessage, setUnavailableMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const perf = beginAsyncInteraction('bio_guide_live_conditions');
    setLoading(true);
    setFetchError(null);
    setUnavailableMessage(null);
    setResult(null);

    const res = await fetchBioluminescence();
    if (res.ok) {
      setResult(res.data);
      perf.end('success');
    } else {
      setFetchError(res.error);
      setUnavailableMessage(res.message ?? null);
      perf.end(res.error ?? 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const warnings = marineWarnings(result);
  const seasonNote =
    result?.inDinoSeason === false
      ? 'Outside peak dinoflagellate season — strong glow is less likely even on dark nights.'
      : result?.inDinoSeason === true
        ? 'Within typical dinoflagellate season for the Space Coast.'
        : null;

  return (
    <section
      id="tonights-conditions"
      className="scroll-mt-28 rounded-2xl border border-cyan-500/20 bg-slate-950/60 p-6 shadow-[inset_0_0_40px_rgba(0,207,255,0.04)]"
      aria-labelledby="heading-tonights-conditions"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="heading-tonights-conditions" className="text-xl font-bold text-white sm:text-2xl">
            Tonight&apos;s Bioluminescence Conditions
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Live snapshot from the same server model used on our{' '}
            <Link to="/bioluminescent-tours" className="text-cyan-300 underline-offset-2 hover:underline">
              tour operations page
            </Link>
            . Not a guarantee of visibility.
          </p>
        </div>
        <button
          type="button"
          onClick={wrapSyncClick('bio_guide_conditions_refresh', () => void load())}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:bg-white/10 disabled:opacity-60 print:hidden"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
          Refresh
        </button>
      </div>

      {loading && !result ? (
        <div className="mt-6 flex items-center gap-3 text-sm text-slate-400" role="status">
          <Loader2 className="h-5 w-5 animate-spin text-cyan-400" aria-hidden />
          Loading live environmental data…
        </div>
      ) : null}

      {!loading && fetchError && !result ? (
        <div
          className="mt-6 rounded-xl border border-amber-500/30 bg-amber-950/25 p-4 text-sm text-amber-100"
          role="status"
        >
          {unavailableMessage ?? (
            <>
              Live conditions are temporarily unavailable. Check{' '}
              <Link to="/conditions" className="font-semibold text-amber-50 underline-offset-2 hover:underline">
                marine forecasts
              </Link>{' '}
              before heading out.
            </>
          )}
        </div>
      ) : null}

      {result?.success ? (
        <div className="mt-6 space-y-4">
          <div
            className={`rounded-xl border p-4 ${ratingAccentClass(result.rating)}`}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.15em] opacity-80">Season rating</p>
            <p className="mt-1 text-lg font-bold">{glowStatusLabel(result.status)}</p>
            {result.rating && result.rating !== 'Unavailable' ? (
              <p className="mt-1 text-sm opacity-90">Model tier: {normalizeRating(result.rating) ?? result.rating}</p>
            ) : null}
            {typeof result.score === 'number' ? (
              <p className="mt-1 text-xs opacity-75">Score: {result.score}</p>
            ) : null}
            {seasonNote ? <p className="mt-2 text-sm opacity-90">{seasonNote}</p> : null}
          </div>

          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {result.data?.moonLabel ? (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <Moon className="h-3.5 w-3.5" aria-hidden />
                  Moon
                </dt>
                <dd className="mt-1 text-sm text-white">{result.data.moonLabel}</dd>
                {typeof result.data.moonIlluminationPercent === 'number' ? (
                  <dd className="text-xs text-slate-400">{result.data.moonIlluminationPercent}% illuminated</dd>
                ) : null}
              </div>
            ) : null}
            {typeof result.clouds === 'number' ? (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Cloud cover</dt>
                <dd className="mt-1 text-sm text-white">{result.clouds}%</dd>
              </div>
            ) : null}
            {typeof result.wind === 'number' ? (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <Wind className="h-3.5 w-3.5" aria-hidden />
                  Wind
                </dt>
                <dd className="mt-1 text-sm text-white">{result.wind} mph</dd>
              </div>
            ) : null}
            {result.waterTempF != null ? (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <Thermometer className="h-3.5 w-3.5" aria-hidden />
                  Water temp
                </dt>
                <dd className="mt-1 text-sm text-white">
                  {result.waterTempF}°F
                  {result.waterTempSource ? (
                    <span className="block text-xs text-slate-400">{result.waterTempSource}</span>
                  ) : null}
                </dd>
              </div>
            ) : null}
            {result.data?.tideSummary ? (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3 sm:col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tide</dt>
                <dd className="mt-1 text-sm text-white">{result.data.tideSummary}</dd>
              </div>
            ) : null}
          </dl>

          <div className="rounded-xl border border-white/10 bg-black/25 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300/80">Best viewing window</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-200">{viewingWindowHint(result)}</p>
            {result.nextNewMoon ? (
              <p className="mt-2 text-xs text-slate-400">
                Next darker-sky period near new moon: {result.nextNewMoon.dateLabel} (
                {result.nextNewMoon.daysFromNow} days)
              </p>
            ) : null}
          </div>

          {Array.isArray(result.conditions) && result.conditions.length > 0 ? (
            <ul className="space-y-1 text-sm text-slate-300">
              {result.conditions.map((c) => (
                <li key={c} className="flex gap-2">
                  <span className="text-cyan-400" aria-hidden>
                    ·
                  </span>
                  {c}
                </li>
              ))}
            </ul>
          ) : null}

          {warnings.length > 0 ? (
            <div
              className="rounded-xl border border-amber-500/35 bg-amber-950/20 p-4"
              role="alert"
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-100">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                Marine condition notes
              </p>
              <ul className="mt-2 space-y-1 text-sm text-amber-50/90">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
