import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Cloud,
  Wind,
  Waves,
  Thermometer,
  AlertCircle,
  AlertTriangle,
  Check,
  Eye,
  ExternalLink,
  Anchor,
  ShieldCheck,
  Radio,
  MapPin,
  Users,
} from 'lucide-react';
import { env } from '../config/env';
import { beginAsyncInteraction, wrapNavigateClick } from '../lib/clickPerf';
import { getCancellationRefundWeatherBody } from '../content/cancellationRefundPolicy';
import CharterTimeForecast from '../components/conditions/CharterTimeForecast';

/** Matches server `LIVE_DATA_UNAVAILABLE`, user-facing when the pipeline yields no safe live read */
const LIVE_DATA_UNAVAILABLE = 'Live data temporarily unavailable';
const MARINE_FETCH_TIMEOUT_MS = 7000;

/** Subtle hero sparkle positions (percent of hero box) */
const HERO_PARTICLE_SPOTS: ReadonlyArray<{ l: string; t: string }> = [
  { l: '11%', t: '26%' },
  { l: '84%', t: '30%' },
  { l: '47%', t: '18%' },
  { l: '28%', t: '58%' },
  { l: '73%', t: '52%' },
  { l: '61%', t: '36%' },
];

const HERO_TRUST_BADGES = [
  { label: 'NOAA Data', Icon: ShieldCheck },
  { label: 'Real-Time Updates', Icon: Radio },
  { label: 'Local Water Conditions', Icon: MapPin },
  { label: 'Trusted by Local Boaters', Icon: Users },
] as const;

const MARINE_HERO_TEXT_SHADOW =
  '0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,207,255,0.3)';

interface ConditionsProps {
  onNavigate: (page: string) => void;
}

type MarineLocationKey = 'daytona' | 'titusville';

interface MarineAlert {
  event: string;
  headline: string;
  description: string;
  severity: string;
  areaDesc?: string;
}

interface ForecastPeriodRow {
  name: string;
  shortForecast: string;
  temperature: string;
  windSpeed: string;
  windDirection: string;
}

interface MarineConditionsOk {
  success: true;
  windSpeed: number | null;
  windDirection: string | null;
  waveHeightFt: number | null;
  waterTempF: number | null;
  airTempF: number | null;
  shortForecast: string | null;
  /** Reserved: when backend adds tide text/height, the dashboard tide card uses it */
  tideSummary?: string | null;
  nextHighTide?: { time: string | null; heightFt: number } | null;
  nextLowTide?: { time: string | null; heightFt: number } | null;
  tideStationId?: string | null;
  tideStationLabel?: string | null;
  forecast: string;
  forecastPeriods?: ForecastPeriodRow[];
  alerts: MarineAlert[];
  status: string;
  statusLevel: string;
  source: string;
  timestamp: string;
  locationLabel: string;
  cached?: boolean;
  meta?: {
    warnings?: string[];
    supplementalMarineLimited?: boolean;
  };
}

interface MarineConditionsFail {
  success: false;
  error: string;
  timestamp?: string;
  source?: string;
  locationLabel?: string;
}

type MarineResponse = MarineConditionsOk | MarineConditionsFail;

function formatMphParts(n: number | null | undefined): { value: string; unit: string } | null {
  if (n == null || Number.isNaN(n)) return null;
  return { value: n >= 10 ? n.toFixed(0) : n.toFixed(1), unit: 'mph' };
}

function formatFtParts(n: number | null | undefined): { value: string; unit: string } | null {
  if (n == null || Number.isNaN(n)) return null;
  return { value: n.toFixed(1), unit: 'ft' };
}

function formatTempFParts(n: number | null | undefined): { value: string; unit: string } | null {
  if (n == null || Number.isNaN(n)) return null;
  return { value: String(Math.round(n)), unit: '°F' };
}

function LiveDashCard({
  delayIndex,
  icon,
  label,
  valueMain,
  unit,
  subtitle,
  loading,
  hasValue,
}: {
  delayIndex: number;
  icon: ReactNode;
  label: string;
  valueMain: string | null;
  unit: string | null;
  subtitle?: string | null;
  loading: boolean;
  hasValue: boolean;
}) {
  const showData = !loading && hasValue && valueMain != null;
  const showUnavailable = !loading && !hasValue;

  return (
    <div
      className="lz-live-dash-card flex flex-col gap-3 rounded-[14px] border border-white/10 p-5 text-white shadow-lg backdrop-blur-md"
      style={{
        background: 'linear-gradient(165deg, rgba(0,0,0,0.6), rgba(0,0,0,0.8))',
        animationDelay: `${delayIndex * 0.08}s`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={`rounded-xl border border-white/10 p-3 text-cyan-300 [&_svg]:h-6 [&_svg]:w-6 ${
            loading ? 'lz-skeleton-icon-wrap lz-skeleton-pulse [&_svg]:opacity-40' : 'bg-white/10'
          }`}
          aria-hidden
        >
          {icon}
        </div>
      </div>
      <div>
        {!loading ? (
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55">{label}</div>
        ) : (
          <div
            className="lz-skeleton-block mt-0.5 h-2.5 w-16 rounded-sm lz-skeleton-pulse"
            aria-hidden
          />
        )}
        {loading ? (
          <div className="mt-3 space-y-2.5" aria-busy="true" aria-label={`Loading ${label}`}>
            <div className="flex items-end gap-2">
              <div
                className="lz-skeleton-block h-10 w-[4.5rem] rounded-md lz-skeleton-pulse"
                style={{ animationDelay: '0.05s' }}
              />
              <div
                className="lz-skeleton-block mb-0.5 h-7 w-10 rounded-md lz-skeleton-pulse"
                style={{ animationDelay: '0.12s' }}
              />
            </div>
            <div
              className="lz-skeleton-block h-2.5 w-[min(100%,7rem)] rounded-sm lz-skeleton-pulse opacity-90"
              style={{ animationDelay: '0.2s' }}
            />
          </div>
        ) : showData ? (
          <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-0">
            <span
              className={`font-display font-bold tabular-nums tracking-tight ${
                unit ? 'text-3xl sm:text-4xl' : 'max-w-full text-xl leading-snug sm:text-2xl'
              }`}
            >
              {valueMain}
            </span>
            {unit ? (
              <span className="text-lg font-semibold text-white/75">{unit}</span>
            ) : null}
          </div>
        ) : showUnavailable ? (
          <p className="mt-2 font-display text-lg font-bold leading-snug text-white/85 sm:text-xl">Data unavailable</p>
        ) : null}
        {subtitle && showData ? (
          <p className="mt-1 text-xs font-medium text-white/55">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}

function LiveConditionsDashboard({
  loading,
  ok,
  failed,
}: {
  loading: boolean;
  ok: MarineConditionsOk | null;
  failed: boolean;
}) {
  const busted = failed || (!loading && !ok);
  const wind = ok ? formatMphParts(ok.windSpeed) : null;
  const waves = ok ? formatFtParts(ok.waveHeightFt) : null;
  const water = ok ? formatTempFParts(ok.waterTempF) : null;
  const air = ok ? formatTempFParts(ok.airTempF) : null;
  const tideText = ok?.tideSummary?.trim() || null;
  const locationLine = ok?.locationLabel ? `Location: ${ok.locationLabel}` : null;
  const sourceLine = ok?.source ? `Source: ${ok.source}` : null;
  const updatedLine = ok?.timestamp
    ? `Updated: ${new Date(ok.timestamp).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })}${ok.cached ? ' (cached ≤5 min)' : ''}`
    : null;

  return (
    <section
      className="relative border-b border-cyan-500/10 bg-[#050a14] py-12 sm:py-16"
      aria-labelledby="live-dash-heading"
    >
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(0,207,255,0.08),transparent)]" />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-28 sm:h-36 md:h-40"
        style={{
          background: 'linear-gradient(to bottom, #020617, rgba(5, 10, 20, 0))',
        }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2
          id="live-dash-heading"
          className="mb-8 text-center font-display text-xl font-bold uppercase tracking-[0.22em] text-white/90 sm:text-2xl"
        >
          Live Conditions Dashboard
        </h2>
        {!loading && ok ? (
          <p className="mb-6 text-center text-xs text-white/65">
            {[locationLine, sourceLine, updatedLine].filter(Boolean).join(' · ')}
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <LiveDashCard
            delayIndex={0}
            icon={<Wind />}
            label="Wind"
            loading={loading}
            hasValue={!busted && wind != null}
            valueMain={wind?.value ?? null}
            unit="mph"
            subtitle={ok?.windDirection ? `From ${ok.windDirection}` : null}
          />
          <LiveDashCard
            delayIndex={1}
            icon={<Waves />}
            label="Wave height"
            loading={loading}
            hasValue={!busted && waves != null}
            valueMain={waves?.value ?? null}
            unit="ft"
          />
          <LiveDashCard
            delayIndex={2}
            icon={<Thermometer />}
            label="Water temp"
            loading={loading}
            hasValue={!busted && water != null}
            valueMain={water?.value ?? null}
            unit="°F"
          />
          <LiveDashCard
            delayIndex={3}
            icon={<Cloud />}
            label="Air temp"
            loading={loading}
            hasValue={!busted && air != null}
            valueMain={air?.value ?? null}
            unit="°F"
          />
          <LiveDashCard
            delayIndex={4}
            icon={<Anchor />}
            label="Tide"
            loading={loading}
            hasValue={Boolean(!busted && tideText)}
            valueMain={tideText || 'Use NOAA'}
            unit={null}
          />
        </div>
        <p className="mt-6 text-center text-xs text-white/45">
          {!tideText && ok
            ? 'Live tide heights are not included in this feed. Use NOAA Tides & Currents for official predictions.'
            : null}
        </p>
      </div>
    </section>
  );
}

type CaptainLevel = 'NO-GO' | 'CAUTION' | 'GOOD' | 'PRIME';

function normalizeCaptainLevel(entry: MarineConditionsOk): CaptainLevel {
  const text = `${entry.shortForecast || ''} ${entry.forecast || ''}`.toLowerCase();
  const hasStormRisk = /\b(thunderstorm|thunderstorms|showers|squall)\b/i.test(text);
  if (hasStormRisk) return 'CAUTION';
  if (entry.statusLevel === 'rough') return 'NO-GO';
  if (entry.statusLevel === 'moderate') return 'GOOD';
  if (entry.statusLevel === 'excellent') return 'PRIME';
  return 'CAUTION';
}

function captainLevelIndex(level: CaptainLevel): number {
  switch (level) {
    case 'NO-GO':
      return 0;
    case 'CAUTION':
      return 1;
    case 'GOOD':
      return 2;
    case 'PRIME':
      return 3;
    default:
      return 1;
  }
}

function signalValue(label: 'wind' | 'water' | 'storm' | 'visibility', entry: MarineConditionsOk): string {
  if (label === 'wind') {
    const v = entry.windSpeed ?? Number.NaN;
    if (!Number.isFinite(v)) return 'N/A';
    if (v <= 8) return 'LOW';
    if (v <= 15) return 'MOD';
    return 'HIGH';
  }
  if (label === 'water') {
    const v = entry.waveHeightFt ?? Number.NaN;
    if (!Number.isFinite(v)) return 'N/A';
    if (v <= 1.5) return 'CALM';
    if (v <= 3) return 'CHOP';
    return 'ROUGH';
  }
  if (label === 'storm') {
    const text = `${entry.shortForecast || ''} ${entry.forecast || ''}`.toLowerCase();
    return /\b(thunderstorm|thunderstorms|showers|squall)\b/i.test(text) ? 'RISK' : 'LOW';
  }
  const visText = `${entry.shortForecast || ''} ${entry.forecast || ''}`.toLowerCase();
  if (/fog|haze|smoke|mist|poor visibility/.test(visText)) return 'LOW';
  return 'CLEAR';
}

export default function Conditions({ onNavigate }: ConditionsProps) {
  const [loadingByLocation, setLoadingByLocation] = useState<Record<MarineLocationKey, boolean>>({
    daytona: true,
    titusville: true,
  });
  const [dataByLocation, setDataByLocation] = useState<Record<MarineLocationKey, MarineResponse | null>>({
    daytona: null,
    titusville: null,
  });
  const [fetchErrorByLocation, setFetchErrorByLocation] = useState<Record<MarineLocationKey, string | null>>({
    daytona: null,
    titusville: null,
  });

  const CONDITION_LOCATIONS: ReadonlyArray<{
    key: MarineLocationKey;
    heading: string;
    subtitle: string;
  }> = [
    {
      key: 'daytona',
      heading: 'Port Orange / Daytona Beach',
      subtitle:
        'Based on current nearshore model and NWS forecast for Port Orange / Daytona Beach, FL.',
    },
    {
      key: 'titusville',
      heading: 'Titusville / Space Coast (Indian River Lagoon)',
      subtitle:
        'Based on current nearshore model and NWS forecast for Titusville / Space Coast, FL.',
    },
  ];

  const loadLocation = useCallback(async (locationKey: MarineLocationKey) => {
    setLoadingByLocation((prev) => ({ ...prev, [locationKey]: true }));
    setFetchErrorByLocation((prev) => ({ ...prev, [locationKey]: null }));
    try {
      if (!env.apiUrlConfigured || !env.apiUrl) {
        setDataByLocation((prev) => ({
          ...prev,
          [locationKey]: { success: false, error: LIVE_DATA_UNAVAILABLE },
        }));
        return;
      }
      const ac = new AbortController();
      const t = window.setTimeout(() => ac.abort(), MARINE_FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(`${env.apiUrl}/api/marine-conditions?location=${locationKey}`, {
          method: 'GET',
          signal: ac.signal,
        });
      } finally {
        window.clearTimeout(t);
      }

      let json: MarineResponse;
      try {
        const text = await res.text();
        json = text
          ? (JSON.parse(text) as MarineResponse)
          : ({ success: false, error: LIVE_DATA_UNAVAILABLE } as MarineResponse);
      } catch {
        console.warn('[marine-conditions] invalid JSON or empty body from API');
        setDataByLocation((prev) => ({
          ...prev,
          [locationKey]: { success: false, error: LIVE_DATA_UNAVAILABLE },
        }));
        return;
      }

      if (!res.ok) {
        const fromBody =
          json &&
          typeof json === 'object' &&
          'success' in json &&
          json.success === false &&
          'error' in json &&
          typeof (json as MarineConditionsFail).error === 'string'
            ? (json as MarineConditionsFail).error
            : null;
        setDataByLocation((prev) => ({
          ...prev,
          [locationKey]: {
            success: false,
            error: fromBody || LIVE_DATA_UNAVAILABLE,
          },
        }));
        return;
      }

      if (!json || typeof json !== 'object' || !('success' in json)) {
        console.warn('[marine-conditions] unexpected response shape');
        setDataByLocation((prev) => ({
          ...prev,
          [locationKey]: { success: false, error: LIVE_DATA_UNAVAILABLE },
        }));
        return;
      }

      setDataByLocation((prev) => ({ ...prev, [locationKey]: json }));
    } catch (e) {
      console.warn('[marine-conditions]', e instanceof Error ? e.message : e);
      setFetchErrorByLocation((prev) => ({ ...prev, [locationKey]: 'network' }));
      setDataByLocation((prev) => ({
        ...prev,
        [locationKey]: {
          success: false,
          error: LIVE_DATA_UNAVAILABLE,
        },
      }));
    } finally {
      setLoadingByLocation((prev) => ({ ...prev, [locationKey]: false }));
    }
  }, []);

  const load = useCallback(async () => {
    await Promise.all(CONDITION_LOCATIONS.map((entry) => loadLocation(entry.key)));
  }, [loadLocation]);

  useEffect(() => {
    void load();
  }, [load]);

  const heroSectionRef = useRef<HTMLElement | null>(null);
  const heroBgRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const section = heroSectionRef.current;
    const bg = heroBgRef.current;
    if (!section || !bg) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    let rafId = 0;
    const PARALLAX = 0.2;

    const update = () => {
      const rect = section.getBoundingClientRect();
      const scrolled = Math.max(0, -rect.top);
      const y = scrolled * PARALLAX;
      bg.style.transform = `translate3d(0, ${y}px, 0)`;
    };

    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    update();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const daytonaData = dataByLocation.daytona;
  const titusvilleData = dataByLocation.titusville;
  const daytonaOk = daytonaData && daytonaData.success === true ? daytonaData : null;
  const titusvilleOk = titusvilleData && titusvilleData.success === true ? titusvilleData : null;
  const ok = daytonaOk || titusvilleOk;
  const data = daytonaData || titusvilleData;
  /** Wait for both locations so we never render "all unavailable" while the other request is still in flight. */
  const loading = loadingByLocation.daytona || loadingByLocation.titusville;
  const fetchError = fetchErrorByLocation.daytona && fetchErrorByLocation.titusville;
  const failed = Boolean(
    !loading &&
      !ok &&
      ((daytonaData && daytonaData.success === false) || (titusvilleData && titusvilleData.success === false))
  );

  return (
    <div className="min-h-screen bg-lz-surface">
      <section
        ref={heroSectionRef}
        className="relative flex min-h-[70vh] w-full flex-col items-center justify-end overflow-visible bg-[#020617]"
        aria-label="Marine conditions hero"
      >
        <div
          ref={heroBgRef}
          className="lz-hero-parallax-bg pointer-events-none absolute inset-0 overflow-visible"
          aria-hidden
        >
          <div
            className="lz-hero-bg-zoom lz-hero-bg-zoom--marine"
            style={{
              backgroundImage:
                'url("/images/titusville-florida-bioluminescent-boat-tour-marine-conditions-indian-river-lagoon.png")',
            }}
          />
        </div>
        <div
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.2), rgba(0,0,0,0.4))',
          }}
          aria-hidden
        />
        <div
          className="lz-hero-particles pointer-events-none absolute inset-0 z-[6]"
          aria-hidden
        >
          {HERO_PARTICLE_SPOTS.map((p, i) => (
            <span
              key={`${p.l}-${p.t}`}
              className="lz-hero-particle"
              style={{
                left: p.l,
                top: p.t,
                animationDelay: `${i * 1.75}s`,
                animationDuration: `${14 + i * 2}s`,
              }}
            />
          ))}
        </div>
        <div className="relative z-10 mx-auto w-full max-w-[1200px] px-4 pb-[50px] pt-4 text-center sm:px-6 md:px-8 lg:pb-[80px]">
          <div className="mx-auto w-full max-w-md px-2 py-2 sm:px-3">
            <h1 className="sr-only">Marine Conditions</h1>
            <p
              className="text-pretty text-sm font-medium leading-snug tracking-wide text-white sm:text-base"
              style={{ textShadow: MARINE_HERO_TEXT_SHADOW }}
            >
              Real-time coastal conditions for the Space Coast
            </p>
            <p
              className="mt-2 text-xs font-normal leading-relaxed text-white/85 sm:text-[0.8125rem]"
              style={{ textShadow: '0 1px 8px rgba(0,0,0,0.65), 0 0 1px rgba(0,0,0,0.9)' }}
            >
              NOAA data &amp; coastal models · Live dashboard below
            </p>
          </div>
        </div>
      </section>

      <section className="marine-intro" aria-labelledby="marine-intro-heading">
        <div className="marine-intro__inner">
          <div className="marine-intro__card">
            <h2
              id="marine-intro-heading"
              className="font-display text-center text-xl font-bold uppercase tracking-[0.14em] text-white sm:text-2xl sm:tracking-[0.12em] md:text-[1.65rem]"
            >
              Real-Time Marine Conditions for Port Orange &amp; Daytona Beach
            </h2>
            <p className="mt-6 text-center text-base leading-relaxed text-white/88 sm:text-lg">
              Stay informed with live marine conditions across Port Orange, Daytona Beach, and the Indian River
              Lagoon. This dashboard provides real-time updates on wind speed, wave height, water temperature, and
              overall boating safety conditions using NOAA data and coastal weather models.
            </p>
            <p className="mt-4 text-center text-base leading-relaxed text-white/82 sm:text-lg">
              Whether you&apos;re planning a boat rental, fishing trip, or watching a rocket launch from the water,
              use these insights to make safer and smarter decisions before heading out.
            </p>
            <ul
              className="mt-8 flex flex-wrap items-center justify-center gap-2 sm:mt-10 sm:gap-3"
              aria-label="Data quality and trust indicators"
            >
              {HERO_TRUST_BADGES.map(({ label, Icon }) => (
                <li key={label}>
                  <span className="marine-intro__badge">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-cyan-300/90" strokeWidth={2} aria-hidden />
                    {label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div
        className="relative z-[4] flex min-h-[14px] flex-col justify-end bg-gradient-to-b from-[#020617] to-[#050a14]"
        aria-hidden
      >
        <div className="lz-hero-glow-divider w-full shrink-0" />
      </div>

      <LiveConditionsDashboard
        loading={loading}
        ok={ok}
        failed={Boolean(failed || fetchError)}
      />

      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <CharterTimeForecast />
          {loading ? (
            <div
              className="space-y-8 py-6"
              aria-busy="true"
              aria-label="Loading full marine conditions report"
            >
              <div className="lz-page-skeleton max-w-4xl mx-auto h-36 rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200/70 shadow-inner lz-skeleton-pulse sm:h-44" />
              <div className="grid md:grid-cols-2 gap-8">
                <div className="h-52 rounded-xl border border-slate-200/70 bg-slate-100/90 shadow-sm lz-skeleton-pulse" />
                <div
                  className="h-52 rounded-xl border border-slate-200/70 bg-slate-100/90 shadow-sm lz-skeleton-pulse"
                  style={{ animationDelay: '0.08s' }}
                />
              </div>
              <div className="h-64 rounded-xl border border-slate-200/70 bg-slate-100/85 lz-skeleton-pulse" />
              <p className="text-center text-sm font-medium text-slate-500">Checking live marine conditions…</p>
            </div>
          ) : fetchError || failed || !ok ? (
            <div
              className="border-2 border-amber-300 bg-amber-50 rounded-xl p-8 mb-12 text-center text-amber-900"
              role="alert"
            >
              <AlertCircle className="h-10 w-10 mx-auto mb-3" aria-hidden />
              <p className="text-lg font-semibold">
                {(data && 'error' in data && data.error) || LIVE_DATA_UNAVAILABLE}
              </p>
              <p className="mt-2 text-sm text-amber-800/90">
                Check your connection or try again shortly. We do not show guessed conditions.
              </p>
              <button
                type="button"
                onClick={() => {
                  const perf = beginAsyncInteraction('conditions_retry_load');
                  perf.markNetworkStart();
                  void load().finally(() => perf.end('retry_done'));
                }}
                className="mt-6 px-6 py-2 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              {[daytonaOk, titusvilleOk].some(Boolean) ? (
                <div className="mb-12 grid max-w-6xl gap-6 lg:grid-cols-2">
                  {[daytonaOk, titusvilleOk].map((entry, idx) => {
                    if (!entry) return null;
                    const level = normalizeCaptainLevel(entry);
                    const idxLevel = captainLevelIndex(level);
                    const markerLeft = `${12.5 + idxLevel * 25}%`;
                    const segments: CaptainLevel[] = ['NO-GO', 'CAUTION', 'GOOD', 'PRIME'];
                    return (
                      <div
                        key={`${entry.locationLabel}-${idx}`}
                        role="status"
                        aria-live="polite"
                        className="group relative overflow-hidden rounded-2xl border border-[rgba(0,207,255,0.2)] bg-[rgba(10,20,30,0.75)] p-6 text-left shadow-lg backdrop-blur-[12px] lz-marine-status-fade-in transition-transform duration-200 hover:-translate-y-0.5 hover:border-cyan-300/35 sm:p-8"
                        style={{
                          boxShadow: '0 0 20px rgba(0, 207, 255, 0.12)',
                        }}
                      >
                        <div
                          className="pointer-events-none absolute inset-x-0 top-0 h-[2px] opacity-85"
                          style={{
                            background:
                              'linear-gradient(90deg, rgba(34,211,238,0.7) 0%, rgba(148,163,184,0.18) 45%, rgba(16,185,129,0.68) 100%)',
                          }}
                          aria-hidden
                        />
                        <div className="flex flex-col gap-5">
                          <div>
                            <div className="mb-2 flex items-center justify-between gap-3 text-[11px] uppercase tracking-wide text-cyan-300/85">
                              <span>{entry.locationLabel}</span>
                              <span className="font-semibold text-white/90">{level}</span>
                            </div>
                            <div className="relative grid grid-cols-4 overflow-hidden rounded-md border border-white/15 bg-slate-950/55 text-[10px] font-semibold uppercase tracking-wide">
                              {segments.map((segment) => (
                                <div
                                  key={segment}
                                  className={`px-2 py-2 text-center ${
                                    segment === level
                                      ? 'bg-cyan-100/12 text-white'
                                      : 'border-r border-white/5 text-white/55 last:border-r-0'
                                  }`}
                                >
                                  {segment}
                                </div>
                              ))}
                              <span
                                className="pointer-events-none absolute -bottom-1 h-[calc(100%+2px)] w-[2px] bg-cyan-300"
                                style={{ left: markerLeft }}
                                aria-hidden
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span
                              className={`inline-flex h-10 w-10 items-center justify-center rounded-full border ${
                                level === 'PRIME' || level === 'GOOD'
                                  ? 'border-emerald-300/40 bg-emerald-400/15 text-emerald-200'
                                  : level === 'CAUTION'
                                    ? 'border-amber-300/45 bg-amber-400/15 text-amber-200'
                                    : 'border-red-300/45 bg-red-400/15 text-red-200'
                              }`}
                              aria-hidden
                            >
                              {level === 'PRIME' || level === 'GOOD' ? (
                                <Check className="h-5 w-5" />
                              ) : (
                                <AlertTriangle className="h-5 w-5" />
                              )}
                            </span>
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
                                Captain&apos;s call
                              </p>
                              <p className="font-display text-[1.35rem] font-bold uppercase tracking-[0.08em] text-white sm:text-[1.5rem]">
                                {level}
                              </p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <div className="rounded-md border border-cyan-300/15 bg-cyan-950/20 px-3 py-2">
                              <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-white/60">
                                <Wind className="h-3.5 w-3.5 text-cyan-300/80" aria-hidden />
                                Wind
                              </p>
                              <p className="mt-1 text-xs font-semibold text-white">
                                {signalValue('wind', entry)}
                              </p>
                            </div>
                            <div className="rounded-md border border-cyan-300/15 bg-cyan-950/20 px-3 py-2">
                              <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-white/60">
                                <Waves className="h-3.5 w-3.5 text-cyan-300/80" aria-hidden />
                                Water
                              </p>
                              <p className="mt-1 text-xs font-semibold text-white">
                                {signalValue('water', entry)}
                              </p>
                            </div>
                            <div className="rounded-md border border-amber-300/20 bg-amber-950/20 px-3 py-2">
                              <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-white/60">
                                <AlertTriangle className="h-3.5 w-3.5 text-cyan-300/80" aria-hidden />
                                Storm
                              </p>
                              <p className="mt-1 text-xs font-semibold text-white">
                                {signalValue('storm', entry)}
                              </p>
                            </div>
                            <div className="rounded-md border border-cyan-300/15 bg-cyan-950/20 px-3 py-2">
                              <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-white/60">
                                <Eye className="h-3.5 w-3.5 text-cyan-300/80" aria-hidden />
                                Visibility
                              </p>
                              <p className="mt-1 text-xs font-semibold text-white">
                                {signalValue('visibility', entry)}
                              </p>
                            </div>
                          </div>
                          {entry.shortForecast ? (
                            <p className="text-base leading-relaxed text-white/92 sm:text-lg">
                              {entry.shortForecast}
                            </p>
                          ) : null}
                          <p className="text-sm leading-relaxed text-white/72 sm:text-base">
                            Based on current nearshore model and NWS forecast for{' '}
                            <span className="text-white/85">{entry.locationLabel}</span>. Informational only,
                            not a safety guarantee.
                          </p>
                          <p className="text-xs font-medium uppercase tracking-wider text-[#00cfff]/70">
                            Last updated:{' '}
                            {entry.timestamp
                              ? new Date(entry.timestamp).toLocaleString(undefined, {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                })
                              : 'N/A'}
                            {entry.cached ? ' · cached (≤5 min)' : ''}
                            {entry.source ? ` · ${entry.source}` : ''}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="mb-12 grid gap-8 md:grid-cols-2">
                <div className="rounded-2xl border border-cyan-300/20 bg-[rgba(10,20,30,0.72)] p-8 text-white shadow-lg backdrop-blur-[10px]">
                  <h3 className="mb-4 text-2xl font-bold text-white">Tides</h3>
                  <div className="mb-4 grid gap-4 sm:grid-cols-2">
                    {[daytonaOk, titusvilleOk].map((entry, idx) => {
                      if (!entry) return null;
                      return (
                        <div
                          key={`${entry.locationLabel}-${idx}`}
                          className="rounded-lg border border-white/15 bg-slate-950/35 p-4"
                        >
                          <p className="text-sm font-semibold uppercase tracking-wide text-cyan-200/90">
                            {entry.locationLabel}
                          </p>
                          <div className="mt-3 space-y-2 text-white/85">
                            {entry.nextHighTide ? (
                              <p>
                                <span className="font-semibold text-white">Next High Tide:</span>{' '}
                                {entry.nextHighTide.time || 'N/A'}
                                {Number.isFinite(entry.nextHighTide.heightFt)
                                  ? ` (${entry.nextHighTide.heightFt.toFixed(1)} ft)`
                                  : ''}
                              </p>
                            ) : null}
                            {entry.nextLowTide ? (
                              <p>
                                <span className="font-semibold text-white">Next Low Tide:</span>{' '}
                                {entry.nextLowTide.time || 'N/A'}
                                {Number.isFinite(entry.nextLowTide.heightFt)
                                  ? ` (${entry.nextLowTide.heightFt.toFixed(1)} ft)`
                                  : ''}
                              </p>
                            ) : null}
                            {!entry.nextHighTide && !entry.nextLowTide ? (
                              <p className="text-white/70">
                                Live tide predictions are temporarily unavailable for this location.
                              </p>
                            ) : null}
                            {entry.tideStationId ? (
                              <p className="text-xs text-white/55">
                                NOAA station: {entry.tideStationLabel || 'Station'} ({entry.tideStationId})
                              </p>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mb-4 text-xs text-white/55">
                    Informational only. Always verify with NOAA.
                  </p>
                  <a
                    href="https://tidesandcurrents.noaa.gov/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 font-semibold text-cyan-300 transition-colors hover:text-cyan-200"
                  >
                    NOAA Tides &amp; Currents
                    <ExternalLink className="h-4 w-4" aria-hidden />
                  </a>
                </div>

                <div className="rounded-2xl border border-cyan-300/20 bg-[rgba(10,20,30,0.72)] p-8 text-white shadow-lg backdrop-blur-[10px]">
                  <h3 className="mb-4 text-2xl font-bold text-white">Alerts (NWS)</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {[daytonaOk, titusvilleOk].map((entry, idx) => {
                      if (!entry) return null;
                      return (
                        <section
                          key={`${entry.locationLabel}-alerts-${idx}`}
                          className="rounded-lg border border-white/15 bg-slate-950/35 p-4"
                          aria-label={`${entry.locationLabel} weather alerts`}
                        >
                          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-cyan-200/90">
                            {entry.locationLabel}
                          </p>
                          {entry.alerts.length === 0 ? (
                            <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/80">
                              No active marine warnings.
                            </div>
                          ) : (
                            <ul className="space-y-4">
                              {entry.alerts.map((a, i) => (
                                <li
                                  key={`${a.headline}-${i}`}
                                  className="rounded-r-lg border-l-4 border-amber-400 bg-amber-300/10 p-4"
                                >
                                  <p className="font-bold text-amber-100">{a.headline || a.event}</p>
                                  {a.severity ? (
                                    <p className="mt-1 text-xs uppercase tracking-wide text-amber-200/90">
                                      {a.severity}
                                    </p>
                                  ) : null}
                                  {a.description ? (
                                    <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm text-amber-100/90">
                                      {a.description}
                                    </p>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          )}
                          <p className="mt-4 text-xs text-white/55">
                            Updated: {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'N/A'} · Source:{' '}
                            {entry.source}
                            {entry.cached ? ' (cached ≤5 min)' : ''}
                          </p>
                        </section>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mb-12 rounded-2xl border border-cyan-300/20 bg-[rgba(10,20,30,0.72)] p-8 text-white shadow-lg backdrop-blur-[10px]">
                <h3 className="mb-2 text-2xl font-bold text-white">Forecast</h3>
                <p className="mb-6 whitespace-pre-wrap text-white/85">{ok.forecast}</p>
                <h4 className="mb-4 text-lg font-semibold text-cyan-100">NWS periods (grid forecast)</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/20">
                        <th className="px-2 py-3 text-left font-semibold text-cyan-100">Period</th>
                        <th className="px-2 py-3 text-left font-semibold text-cyan-100">Conditions</th>
                        <th className="px-2 py-3 text-center font-semibold text-cyan-100">Temp</th>
                        <th className="px-2 py-3 text-center font-semibold text-cyan-100">Wind</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(ok.forecastPeriods || []).map((row, index) => (
                        <tr key={`${row.name}-${index}`} className="border-b border-white/10">
                          <td className="px-2 py-3 font-medium text-white">{row.name}</td>
                          <td className="px-2 py-3 text-white/80">{row.shortForecast}</td>
                          <td className="px-2 py-3 text-center text-white/90">{row.temperature}</td>
                          <td className="px-2 py-3 text-center text-white/90">
                            {row.windSpeed}
                            {row.windDirection ? ` ${row.windDirection}` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(() => {
                  const marineWarnings = (ok.meta?.warnings ?? []).filter(
                    (w) => !/HTTP\s*429|rate limit/i.test(String(w))
                  );
                  return (
                    <>
                      {marineWarnings.length > 0 ? (
                        <p className="mt-4 text-xs text-amber-200/95">{marineWarnings.join(' · ')}</p>
                      ) : null}
                      {ok.meta?.supplementalMarineLimited ? (
                        <p className="mt-3 text-xs text-white/45">
                          Supplemental marine data temporarily unavailable
                        </p>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            </>
          )}

          {!loading && ok && (
            <p className="text-center text-sm text-slate-500 mb-8">
              Location: {ok.locationLabel} · Data as of {new Date(ok.timestamp).toLocaleString()} · {ok.source}
            </p>
          )}
        </div>
      </section>

      <section className="py-16 bg-blue-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Safety is Our Priority</h2>
            <p className="text-xl text-blue-100 max-w-3xl mx-auto">
              We continuously monitor conditions and reserve the right to cancel or reschedule rentals for
              your safety.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 text-center">
            <div>
              <div className="w-16 h-16 bg-blue-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <Cloud className="h-8 w-8 text-cyan-300" />
              </div>
              <h3 className="text-xl font-bold mb-2">Live monitoring</h3>
              <p className="text-blue-100">
                Forecasts and models update frequently; always verify before departure.
              </p>
            </div>
            <div>
              <div className="w-16 h-16 bg-blue-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="h-8 w-8 text-cyan-300" />
              </div>
              <h3 className="text-xl font-bold mb-2">Proactive communication</h3>
              <p className="text-blue-100">
                We will contact you if conditions deteriorate before your rental when possible.
              </p>
            </div>
            <div>
              <div className="w-16 h-16 bg-blue-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="h-8 w-8 text-cyan-300" />
              </div>
              <h3 className="text-xl font-bold mb-2">Flexible policies</h3>
              <p className="text-blue-100">{getCancellationRefundWeatherBody()}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-slate-900 mb-4">Ready to book?</h2>
          <p className="text-xl text-slate-600 mb-8">
            Review the live data above, then reserve your boat when conditions work for your group.
          </p>
          <button
            type="button"
            onClick={wrapNavigateClick('conditions', 'book', onNavigate)}
            className="px-10 py-4 bg-amber-600 hover:bg-amber-700 text-white font-bold text-lg rounded-lg shadow-xl transition-all transform hover:scale-105"
          >
            Book Now
          </button>
        </div>
      </section>
    </div>
  );
}
