import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  ArrowRight,
  Calendar,
  CloudSun,
  Loader2,
  MapPin,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Telescope,
  Waves,
} from 'lucide-react';
import { parseAiGoNoGo } from '../lib/aiDecision';
import {
  formatBestViewingWindow,
  getLaunchConfidence,
} from '../lib/launchFormat';
import {
  getLaunchTimeCategory,
  isNightViewingHighlight,
  pickBestLaunchIndex,
} from '../lib/launchTimeCategory';
import { beginAsyncInteraction, wrapNavigateClick } from '../lib/clickPerf';
import {
  pickBestLaunchByScore,
  scoreLaunches,
  type LaunchScoreConditions,
} from '../lib/launchScoring';
import { getBookingWindow } from '../lib/launchBookingWindow';
import { env } from '../config/env.js';
import SubscribeAlerts from '../components/SubscribeAlerts';
import LaunchCountdown from '../components/LaunchCountdown';
import LaunchCardViewingInfo from '../components/LaunchCardViewingInfo';
import SmartImage from '../components/ui/SmartImage';

const DEFAULT_SITE_ORIGIN = 'https://launchzonecharters.com';

function siteOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  const env = import.meta.env.VITE_SITE_URL as string | undefined;
  if (env && typeof env === 'string') {
    return env.replace(/\/$/, '');
  }
  return DEFAULT_SITE_ORIGIN;
}

const LAUNCH_HERO_IMAGE =
  '/images/rocket-launch-viewing-titusville-florida-boat-charter-falcon9-night-water.png';
const LAUNCH_HERO_ALT =
  'Rocket launch viewing from a boat on the water at night, Space Coast Florida, Launch Zone Charters';
const ROCKET_AVAILABILITY_PATH =
  '/booking?bookingMode=charter&charterType=rocket_launch#availability-calendar';

interface LaunchesProps {
  onNavigate: (page: string) => void;
}

/** Launch Library 2 shape (partial). */
interface SpaceDevsLaunch {
  id?: string | number;
  name?: string;
  net?: string | null;
  window_start?: string | null;
  status?: { name?: string } | string;
  launch_service_provider?: { name?: string };
  pad?: { name?: string; location?: { name?: string } };
  rocket?: {
    configuration?: {
      full_name?: string | null;
      name?: string | null;
      family?: { name?: string | null };
    };
  };
}

interface RocketCheckResult {
  success: boolean;
  score?: number;
  status?: 'perfect' | 'good' | 'poor' | 'unknown';
  message?: string;
  explanation?: string;
  aiSummary?: string;
  wind?: number;
  clouds?: number;
  launches?: SpaceDevsLaunch[];
  data?: {
    wind?: number;
    clouds?: number;
    launches?: SpaceDevsLaunch[];
  };
}

function statusBadgeClass(status: RocketCheckResult['status']) {
  if (status === 'perfect') return 'border-emerald-400/50 bg-emerald-950/35 text-emerald-200';
  if (status === 'good') return 'border-amber-400/50 bg-amber-950/30 text-amber-100';
  if (status === 'poor') return 'border-rose-400/45 bg-rose-950/28 text-rose-100';
  return 'border-white/15 bg-white/[0.06] text-slate-200';
}

function confidenceBadgeClass(level: 'High' | 'Medium' | 'Low') {
  if (level === 'High') return 'border-emerald-400/45 bg-emerald-950/40 text-emerald-100';
  if (level === 'Medium') return 'border-amber-400/40 bg-amber-950/35 text-amber-100';
  return 'border-slate-400/35 bg-slate-950/45 text-slate-300';
}

export default function Launches({ onNavigate }: LaunchesProps) {
  const [rocketLoading, setRocketLoading] = useState(false);
  const [rocketResult, setRocketResult] = useState<RocketCheckResult | null>(null);
  const [previewLaunches, setPreviewLaunches] = useState<SpaceDevsLaunch[]>([]);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState(false);
  const [verificationScope, setVerificationScope] = useState<string | null>(null);

  const metaDescription = useMemo(
    () =>
      'Rocket launch viewing boat charters from Titusville and the Space Coast. Check the public launch schedule, local weather, and an advisory summary before you book. Captain-led evenings on the Indian River Lagoon and surrounding waters.',
    []
  );

  const canonicalUrl = useMemo(() => `${siteOrigin()}/launches`, []);

  const serviceJsonLd = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Rocket launch viewing boat charters — Titusville & Space Coast FL',
      description: metaDescription,
      url: canonicalUrl,
      serviceType: ['Boat charter', 'Rocket launch viewing', 'Sightseeing cruise'],
      areaServed: [
        {
          '@type': 'City',
          name: 'Titusville',
          containedInPlace: { '@type': 'State', name: 'Florida' },
        },
        { '@type': 'AdministrativeArea', name: 'Space Coast' },
      ],
      provider: {
        '@type': 'LocalBusiness',
        name: 'Launch Zone Charters',
        telephone: '+1-803-542-1761',
        url: siteOrigin(),
      },
    }),
    [canonicalUrl, metaDescription]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!env.apiUrlConfigured || !env.apiUrl) {
          if (!cancelled) setPreviewError(true);
          return;
        }
        const res = await fetch(`${env.apiUrl}/api/launch-schedule-preview`);
        if (!res.ok) {
          if (!cancelled) setPreviewError(true);
          return;
        }
        const data = (await res.json()) as {
          success?: boolean;
          launches?: SpaceDevsLaunch[];
          verification?: { applied?: boolean; scope?: string };
        };
        if (cancelled) return;
        if (data?.success && Array.isArray(data.launches)) {
          setPreviewLaunches(data.launches);
          if (typeof data.verification?.scope === 'string') {
            setVerificationScope(data.verification.scope);
          }
        } else {
          setPreviewError(true);
        }
      } catch {
        if (!cancelled) setPreviewError(true);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const checkLaunchConditions = useCallback(async () => {
    const perf = beginAsyncInteraction('launches_rocket_check');
    let outcome = 'completed';
    setRocketLoading(true);
    setRocketResult(null);
    try {
      if (!env.apiUrlConfigured || !env.apiUrl) {
        setRocketResult({
          success: false,
          message: 'API URL is not configured.',
          aiSummary: 'Unable to reach the server.',
        });
        outcome = 'no_api';
        return;
      }
      perf.markNetworkStart();
      const res = await fetch(`${env.apiUrl}/api/rocket-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (await res.json()) as RocketCheckResult;
      if (import.meta.env.DEV) {
        console.log('[rocket-check] client response', data?.success, data?.score);
      }
      setRocketResult(data);
      outcome = 'success';
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error('[rocket-check]', e);
      }
      setRocketResult({
        success: false,
        message: 'Unable to reach the server.',
        aiSummary: 'Unable to reach the server.',
      });
      outcome = 'error';
    } finally {
      setRocketLoading(false);
      perf.end(outcome);
    }
  }, []);

  const rocketDecision =
    rocketResult?.success && rocketResult.aiSummary ? parseAiGoNoGo(rocketResult.aiSummary) : null;

  const apiLaunches: SpaceDevsLaunch[] =
    rocketResult?.launches?.length
      ? rocketResult.launches
      : rocketResult?.data?.launches?.length
        ? rocketResult.data.launches
        : [];

  const displayLaunches: SpaceDevsLaunch[] =
    apiLaunches.length > 0 ? apiLaunches : previewLaunches;

  const enhancedLaunches = useMemo(
    () =>
      displayLaunches.map((launch) => ({
        ...launch,
        bookingWindow: getBookingWindow(launch),
      })),
    [displayLaunches]
  );

  const scoringConditions = useMemo((): LaunchScoreConditions => {
    const cloudCoverRaw =
      rocketResult?.clouds ??
      rocketResult?.data?.clouds;
    const cloudCover = typeof cloudCoverRaw === 'number' ? cloudCoverRaw : undefined;

    const water: LaunchScoreConditions['water'] =
      rocketResult?.status === 'perfect'
        ? 'calm'
        : rocketResult?.status === 'good'
          ? 'moderate'
          : rocketResult?.status === 'poor'
            ? 'rough'
            : undefined;

    return { cloudCover, water };
  }, [rocketResult?.clouds, rocketResult?.data?.clouds, rocketResult?.status]);

  const scoredLaunches = useMemo(
    () => scoreLaunches(enhancedLaunches, scoringConditions),
    [enhancedLaunches, scoringConditions]
  );

  const bestScored = useMemo(() => pickBestLaunchByScore(scoredLaunches), [scoredLaunches]);

  const bestLaunchIdx = useMemo(() => pickBestLaunchIndex(displayLaunches), [displayLaunches]);

  return (
    <div className="launch-page min-h-screen bg-[#020617] text-slate-200">
      <Helmet prioritizeSeoTags>
        <title>Rocket Launch Viewing Boat Charters — Titusville &amp; Space Coast FL | Launch Zone Charters</title>
        <meta name="description" content={metaDescription} />
        <link rel="canonical" href={canonicalUrl} />
        <meta
          property="og:title"
          content="Rocket Launch Viewing Boat Charters — Titusville &amp; Space Coast FL | Launch Zone Charters"
        />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={`${siteOrigin()}${LAUNCH_HERO_IMAGE}`} />
        <meta name="twitter:card" content="summary_large_image" />
        <script type="application/ld+json">{JSON.stringify(serviceJsonLd)}</script>
      </Helmet>

      <section
        className="hero-section launch-page-hero lz-hero-container relative isolate"
        aria-label="Rocket launch viewing — full-bleed photograph"
      >
        <div className="absolute inset-0 z-0 overflow-visible" aria-hidden>
          <SmartImage
            src={LAUNCH_HERO_IMAGE}
            alt={LAUNCH_HERO_ALT}
            priority
            sizes="100vw"
            className="lz-hero-bg hero-img-launch absolute inset-0 h-full w-full"
          />
        </div>
        <div className="launch-page-hero-overlay" aria-hidden />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-[min(32vh,260px)] bg-gradient-to-t from-[#020617] via-[#020617]/55 to-transparent"
          aria-hidden
        />
      </section>

      <section
        className="launch-page__intro border-t border-white/[0.06] bg-[#020617] py-12 md:py-14"
        aria-labelledby="launches-hero-heading"
      >
        <div className="mx-auto max-w-7xl px-[5%] sm:px-6 lg:px-8">
          <div className="lz-hero-fade lz-hero-fade--delay-1 mx-auto max-w-3xl text-center md:text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/90">
              Space Coast · Titusville
            </p>
            <h1 id="launches-hero-heading" className="mt-3 max-w-3xl">
              <span className="lz-hero-title-accent lz-hero-heading-line block text-balance">
                Rocket launch viewing from the water
              </span>
              <span className="lz-hero-title lz-hero-title-sub lz-hero-heading-subline mt-3 block text-balance md:mt-4">
                Charters on the lagoon
              </span>
            </h1>
            <p className="mt-5 text-pretty text-base leading-relaxed text-slate-300 md:text-lg">
              Unobstructed sightlines toward the Cape, calm waterfront evenings, and a crew that knows how
              to time the window. Built around the attempt — not the parking-lot crowd.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-2 md:justify-start md:gap-2.5">
              <div className="lz-hero-badge">
                <Shield className="h-3.5 w-3.5 shrink-0 text-cyan-300/90" aria-hidden />
                <span className="font-semibold uppercase tracking-wider text-cyan-100/90">
                  Licensed &amp; insured
                </span>
              </div>
              <div className="lz-hero-badge">
                <Star className="h-3.5 w-3.5 shrink-0 fill-cyan-300 text-cyan-300" aria-hidden />
                <span className="font-semibold uppercase tracking-wider text-cyan-100/90">
                  Captain-led
                </span>
              </div>
              <div className="lz-hero-badge">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-cyan-300/90" aria-hidden />
                <span className="font-semibold uppercase tracking-wider text-cyan-100/90">
                  Waterfront positioning
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="launch-conditions-check"
        className="launch-page__conditions-cta border-t border-white/[0.06] bg-[#020617] py-12 md:py-14"
        aria-labelledby="launch-conditions-heading"
      >
        <div className="mx-auto max-w-7xl px-[5%] sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h2
              id="launch-conditions-heading"
              className="font-display text-balance text-2xl font-bold tracking-tight text-white md:text-3xl"
            >
              Schedule, weather &amp; advisory
            </h2>
            <p className="mt-4 text-pretty text-base leading-relaxed text-slate-300 md:text-lg">
              On demand, we pull the public launch schedule, blend it with local conditions, and summarize
              what it could mean for an evening on the water. Nothing loads until you ask — you stay in
              control.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3">
              <button
                type="button"
                className="lz-btn-primary inline-flex w-full max-w-md items-center justify-center gap-2.5 shadow-[0_4px_20px_rgba(0,0,0,0.32),0_0_28px_rgba(255,140,43,0.35)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:scale-100 sm:w-auto sm:min-w-[280px] sm:px-10"
                onClick={checkLaunchConditions}
                disabled={rocketLoading}
              >
                {rocketLoading ? (
                  <>
                    <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
                    <span>Checking schedule &amp; weather…</span>
                  </>
                ) : (
                  <>
                    <Waves className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
                    <span>Check Launch Conditions</span>
                    <ArrowRight className="h-5 w-5 shrink-0" strokeWidth={2.25} aria-hidden />
                  </>
                )}
              </button>
              <p className="max-w-md text-center text-xs leading-snug text-slate-500">
                Advisory only — not a go/no-go for safety. Forecasts change; your captain has the final
                word on the dock.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="launch-page__body border-t border-white/[0.06] py-14 md:py-16">
        <div className="mx-auto max-w-7xl px-[5%] sm:px-6 lg:px-8">
          {rocketResult && (
            <div className="hero-api-panel card mb-12 text-left text-slate-200 shadow-[0_0_40px_rgba(6,182,212,0.08)]">
              {rocketResult.success && (
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  {typeof rocketResult.score === 'number' && (
                    <span className="rounded-lg border border-white/10 bg-black/35 px-3 py-1 font-mono text-sm text-cyan-100">
                      Score {rocketResult.score}/6
                    </span>
                  )}
                  {rocketResult.status && (
                    <span
                      className={`rounded-lg border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${statusBadgeClass(rocketResult.status)}`}
                    >
                      {rocketResult.status}
                    </span>
                  )}
                </div>
              )}

              {rocketResult.message && (
                <p className="text-lg font-semibold text-white">{rocketResult.message}</p>
              )}
              {rocketResult.explanation && (
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{rocketResult.explanation}</p>
              )}

              {rocketResult.success && rocketResult.aiSummary && (
                <div className="mt-5 border-t border-white/10 pt-5">
                  {rocketDecision === 'go' && (
                    <p className="text-lg font-bold uppercase tracking-wide text-emerald-300">GO</p>
                  )}
                  {rocketDecision === 'no-go' && (
                    <p className="text-lg font-bold uppercase tracking-wide text-rose-300">NO-GO</p>
                  )}
                  {!rocketDecision && (
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                      AI recommendation
                    </p>
                  )}
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed md:text-base">
                    {rocketResult.aiSummary}
                  </p>
                </div>
              )}

              {rocketResult.wind != null && rocketResult.clouds != null && (
                <p className="mt-4 text-xs text-slate-500">
                  Weather snapshot: wind {Math.round(rocketResult.wind * 10) / 10} mph · clouds{' '}
                  {Math.round(rocketResult.clouds)}%
                </p>
              )}

              {!rocketResult.success && (
                <p className="mt-2 text-amber-200/90">
                  {rocketResult.aiSummary || rocketResult.message || 'Unable to analyze conditions.'}
                </p>
              )}

              <p className="mt-4 text-[11px] leading-snug text-slate-500">
                AI is for explanation only, not a safety decision. Captain&apos;s judgment, forecasts, and
                Coast Guard rules always come first.
              </p>
            </div>
          )}

          <div className="launch-info card border-cyan-500/20 p-6 md:p-7">
            <h2 className="mb-2 text-lg font-bold tracking-wide text-white md:text-xl">
              Important launch information
            </h2>
            <p className="leading-relaxed text-slate-300">
              Launch timing is never guaranteed. Delays and scrubs are common due to technical issues,
              weather, or other factors. If a launch is delayed, your tour may proceed as a sightseeing
              cruise. Confirm details when you book.
            </p>
          </div>

          <section
            id="launch-schedule"
            className="mt-12 space-y-6 scroll-mt-24 border-t border-white/[0.06] pt-12 md:mt-14 md:pt-14"
            aria-label="Launch schedule"
          >
            {previewLoading && displayLaunches.length === 0 && (
              <div className="card mx-auto max-w-2xl p-8 text-center md:p-10">
                <Loader2
                  className="mx-auto h-8 w-8 animate-spin text-cyan-400/80"
                  aria-hidden
                />
                <p className="mt-4 text-sm text-slate-400">Loading public launch schedule…</p>
              </div>
            )}

            {!previewLoading && previewError && displayLaunches.length === 0 && (
              <div className="card mx-auto max-w-2xl p-8 text-center md:p-10">
                <h3 className="mb-2 text-xl font-bold text-white">Launch schedule unavailable</h3>
                <p className="mx-auto max-w-lg text-slate-400">
                  We couldn&apos;t load the live list right now. Use{' '}
                  <strong className="text-slate-200">Check Launch Conditions</strong> above to retry, or
                  visit{' '}
                  <a
                    href="https://thespacedevs.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
                  >
                    Launch Library
                  </a>
                  .
                </p>
              </div>
            )}

            {!previewLoading && !previewError && displayLaunches.length === 0 && (
              <div className="card mx-auto max-w-2xl p-8 text-center md:p-10">
                <h3 className="mb-2 text-xl font-bold text-white">No verified Space Coast launches right now</h3>
                <p className="mx-auto max-w-lg text-slate-400">
                  We only list Kennedy Space Center &amp; Cape Canaveral-area missions that pass our checks.
                  Nothing matched the feed at the moment — try again later, or use{' '}
                  <strong className="text-slate-200">Check Launch Conditions</strong> after the schedule
                  updates.
                </p>
              </div>
            )}

            {displayLaunches.length > 0 && (
              <>
                <div className="mx-auto mb-6 max-w-2xl rounded-xl border border-emerald-500/20 bg-emerald-950/20 px-4 py-3 text-left sm:px-5 sm:py-4">
                  <div className="flex gap-3">
                    <ShieldCheck
                      className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300/90"
                      strokeWidth={2}
                      aria-hidden
                    />
                    <div>
                      <p className="text-sm font-semibold text-emerald-100/95">Curated Space Coast schedule</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">
                        {verificationScope ||
                          'Florida Space Coast pads only — irrelevant or unverifiable missions are hidden.'}{' '}
                        Feed updates often; timings can shift.
                      </p>
                    </div>
                  </div>
                </div>
                <h2
                  id="launch-schedule-heading"
                  className="text-center font-display text-2xl font-bold tracking-tight text-white md:text-[1.65rem]"
                >
                  Upcoming launches
                </h2>
                <p className="mx-auto max-w-2xl text-center text-sm text-slate-500">
                  Run <span className="text-slate-400">Check Launch Conditions</span> above to layer local
                  weather and an advisory on top of this list.
                </p>
              </>
            )}

            {displayLaunches.length > 0 &&
              enhancedLaunches.map((launch, idx) => {
                const scoreRow = scoredLaunches[idx];
                const when = launch.net || launch.window_start;
                const timeCategory = getLaunchTimeCategory(when);
                const provider = launch.launch_service_provider?.name || 'Provider TBD';
                const pad =
                  launch.pad?.name ||
                  launch.pad?.location?.name ||
                  'Pad TBD';
                const st =
                  typeof launch.status === 'object' && launch.status?.name
                    ? launch.status.name
                    : typeof launch.status === 'string'
                      ? launch.status
                      : 'Scheduled';
                const scoredKey = bestScored ? String(bestScored.id ?? bestScored.name ?? '') : '';
                const launchKey = String(launch.id ?? launch.name ?? '');
                const isBestPick =
                  (scoredKey && launchKey && scoredKey === launchKey) ||
                  (!scoredKey && bestLaunchIdx >= 0 && idx === bestLaunchIdx);
                const nightHighlight = isNightViewingHighlight(timeCategory);
                const confidence = getLaunchConfidence(when, st);

                return (
                  <div
                    key={String(launch.id ?? launch.name ?? idx)}
                    className={`card overflow-hidden transition-shadow duration-300 hover:shadow-[0_0_36px_rgba(6,182,212,0.12)] ${
                      nightHighlight
                        ? 'border border-cyan-400/25 bg-white/[0.035] shadow-[0_0_36px_rgba(34,211,238,0.1)]'
                        : ''
                    }`}
                  >
                    <div className="p-5 md:p-8">
                      <div className="mb-5 flex flex-col items-start gap-3 md:mb-4 md:flex-row md:flex-wrap md:justify-between md:gap-4">
                        <div className="min-w-0 flex-1">
                          {isBestPick && (
                            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-amber-400/35 bg-amber-950/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-100/95">
                              <Star className="h-3 w-3 shrink-0 text-amber-300/90" aria-hidden />
                              Best upcoming launch to book
                            </div>
                          )}
                          <h3 className="text-pretty whitespace-normal break-words text-xl font-bold leading-[1.25] text-white md:text-2xl md:leading-tight">
                            {launch.name || 'Upcoming mission'}
                          </h3>
                          <p className="mt-2 text-slate-400">{provider}</p>
                        </div>
                        <div className="flex w-full max-w-full flex-wrap items-center justify-start gap-2 md:w-auto md:justify-end">
                          {isBestPick && (
                            <span className="hidden text-right text-[10px] leading-tight text-amber-200/80 sm:block sm:max-w-[140px]">
                              Best viewing conditions expected · score {scoreRow?.score ?? 0}
                            </span>
                          )}
                          <span className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                            Space Coast
                          </span>
                          {timeCategory === 'night' && (
                            <span className="rounded-full border border-indigo-400/35 bg-indigo-950/35 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-100/90">
                              Night
                            </span>
                          )}
                          {timeCategory === 'twilight' && (
                            <span className="rounded-full border border-sky-400/30 bg-sky-950/30 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-100/90">
                              Twilight
                            </span>
                          )}
                          {timeCategory === 'day' && (
                            <span className="rounded-full border border-amber-400/25 bg-amber-950/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-100/85">
                              Day
                            </span>
                          )}
                          <div className="rounded-full border border-cyan-500/30 bg-cyan-950/25 px-3 py-1 text-xs font-semibold capitalize text-cyan-100 md:text-sm">
                            {st}
                          </div>
                          <div
                            className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${confidenceBadgeClass(
                              confidence
                            )}`}
                          >
                            Confidence: {confidence}
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-6 md:grid-cols-2">
                        <div className="flex items-start gap-3">
                          <Calendar className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400/80" aria-hidden />
                          <div className="min-w-0">
                            {!isBestPick && (
                              <div className="font-semibold text-white">{formatBestViewingWindow(when, st)}</div>
                            )}
                            {isBestPick ? (
                              <div className="mt-0.5 space-y-1.5">
                                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200/90">
                                  Best Booking Window
                                </p>
                                <p className="text-sm font-semibold text-amber-100">{launch.bookingWindow}</p>
                                <p className="text-[11px] leading-snug text-slate-500">
                                  Exact launch timing may change - this window reflects the best viewing
                                  experience.
                                </p>
                                <p className="text-[11px] text-slate-500">{formatBestViewingWindow(when, st)}</p>
                                <LaunchCountdown
                                  iso={when}
                                  status={st}
                                  confidence={confidence}
                                  className="mt-2"
                                />
                              </div>
                            ) : (
                              <LaunchCountdown
                                iso={when}
                                status={st}
                                confidence={confidence}
                                className="mt-3"
                              />
                            )}
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400/80" aria-hidden />
                          <div>
                            <div className="font-semibold text-white">Launch site</div>
                            <div className="text-sm text-slate-400">{pad}</div>
                          </div>
                        </div>
                      </div>

                      <LaunchCardViewingInfo launch={launch} timeCategory={timeCategory} />

                      <div className="mt-7 flex flex-col gap-3 border-t border-white/10 pt-6 sm:flex-row sm:justify-end">
                        <button
                          type="button"
                          onClick={wrapNavigateClick('launches', 'book-rocket', onNavigate)}
                          className={`lz-btn-primary inline-flex w-full justify-center px-5 py-3 sm:w-auto sm:min-w-[220px] ${
                            isBestPick || nightHighlight ? 'shadow-[0_0_24px_rgba(251,191,36,0.12)]' : ''
                          }`}
                        >
                          Book launch tour
                        </button>
                        <a
                          href={ROCKET_AVAILABILITY_PATH}
                          className="lz-btn-secondary inline-flex w-full justify-center px-5 py-3 sm:w-auto sm:min-w-[220px]"
                        >
                          View availability
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
          </section>

          <section
            className="mt-12 space-y-6 border-t border-white/[0.06] pt-12 md:mt-14 md:pt-14"
            aria-labelledby="launch-viewing-seo-heading"
          >
            <h2
              id="launch-viewing-seo-heading"
              className="font-display text-balance text-center text-xl font-bold tracking-tight text-white md:text-2xl"
            >
              Why Titusville &amp; the Space Coast for launch viewing
            </h2>
            <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-2 md:gap-10">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200/90">
                  Location &amp; sightlines
                </h3>
                <p className="mt-3 text-pretty leading-relaxed text-slate-300">
                  Titusville sits along the Indian River Lagoon with a direct line of sight toward Cape
                  Canaveral and Kennedy Space Center. From the water, you escape the shore-side crowds and
                  gain a wide, open horizon — ideal for night launches when the sky and reflection matter
                  most.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200/90">
                  What moves the window
                </h3>
                <p className="mt-3 text-pretty leading-relaxed text-slate-300">
                  Cloud cover, wind, visibility, and range safety drive go/no-go calls — not the
                  brochure. We combine the public schedule with local conditions so you can plan with a
                  clearer picture, then adapt if the mission or weather shifts.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200/90">
                  Before you book
                </h3>
                <p className="mt-3 text-pretty leading-relaxed text-slate-300">
                  Have a flexible mindset: slips, holds, and scrubs are part of the mission. Ask about
                  boarding time, route, and what happens if the launch moves — we&apos;ll align expectations up
                  front so the evening still feels premium.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200/90">
                  On the water
                </h3>
                <p className="mt-3 text-pretty leading-relaxed text-slate-300">
                  Expect a calm, captain-led experience: stable deck space, clear communication, and
                  room to take in the burn and trail. You&apos;re not racing for a fence line — you&apos;re
                  positioned for the show with hospitality and safety first.
                </p>
              </div>
            </div>
          </section>

          <div className="launch-subscribe mx-auto mt-12 max-w-2xl md:mt-14">
            <SubscribeAlerts subscribedTo="rocket" variant="dark" />
          </div>
        </div>
      </section>

      <section
        className="launch-page__bottom border-t border-white/[0.06] py-16 md:py-20"
        aria-labelledby="why-book-launches-heading"
      >
        <div className="mx-auto max-w-7xl px-[5%] sm:px-6 lg:px-8">
          <div className="mb-12 text-center md:mb-14">
            <h2
              id="why-book-launches-heading"
              className="font-display text-balance text-3xl font-bold tracking-tight text-white md:text-[2rem]"
            >
              Why book a rocket launch tour?
            </h2>
            <p className="mt-3 text-pretty text-lg text-slate-400 md:text-xl">
              Space history from the water — unobstructed, unhurried, and hosted by a licensed crew
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <div className="card p-8 text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/5">
                <Telescope className="h-7 w-7 text-cyan-300/90" aria-hidden />
              </div>
              <h3 className="mb-2 text-lg font-bold text-white">Unobstructed views</h3>
              <p className="text-sm leading-relaxed text-slate-400">
                Watch launches from the water with open sightlines toward the pads.
              </p>
            </div>
            <div className="card p-8 text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/5">
                <CloudSun className="h-7 w-7 text-cyan-300/90" aria-hidden />
              </div>
              <h3 className="mb-2 text-lg font-bold text-white">Weather + schedule snapshot</h3>
              <p className="text-sm leading-relaxed text-slate-400">
                On demand, we combine local conditions with the public launch schedule and an advisory
                summary. You stay in control of when data loads.
              </p>
            </div>
            <div className="card p-8 text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/5">
                <Sparkles className="h-7 w-7 text-cyan-300/90" aria-hidden />
              </div>
              <h3 className="mb-2 text-lg font-bold text-white">Flexible options</h3>
              <p className="text-sm leading-relaxed text-slate-400">
                Even if a launch scrubs, enjoy a premium cruise on Florida&apos;s waterways.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
