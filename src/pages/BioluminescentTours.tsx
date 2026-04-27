import { useCallback, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Check, Phone, AlertTriangle, Info, XCircle } from 'lucide-react';
import { parseAiGoNoGo } from '../lib/aiDecision';
import { fetchWithRetry } from '../lib/fetchWithRetry';
import WeeklyForecast from '../components/WeeklyForecast';
import SubscribeAlerts from '../components/SubscribeAlerts';
import Logo from '../components/ui/Logo';
import { env } from '../config/env.js';
import { beginAsyncInteraction, wrapRouterNavigate, wrapSyncClick } from '../lib/clickPerf';

const BIO_HERO_IMAGE =
  '/images/bioluminescent-boat-tour-titusville-florida-glowing-water-night-kayak-indian-river-lagoon-adventure-launch-zone-charters.png';
const BIO_HERO_ALT =
  'Bioluminescent boat tour in Titusville Florida under Max Brewer Bridge, Indian River Lagoon at night';

/** Canonical copy for this experience */
export const BIO_LOCATION_FULL =
  'Titusville, Florida. Max Brewer Bridge / Haulover Canal (Indian River Lagoon)';

interface BioluminescentToursProps {
  onNavigate: (page: string) => void;
}

type GlowStatus = 'perfect' | 'good' | 'poor' | 'unknown';

/** Normalized view model for GET /api/bioluminescence when status === OK */
interface GlowCheckResponse {
  success: boolean;
  status: GlowStatus;
  message: string;
  explanation?: string;
  score?: number;
  aiSummary?: string;
  wind?: number;
  clouds?: number;
  rating?: GlowRatingLabel | 'Unavailable';
  conditions?: string[];
  reasoning?: GlowReasonLine[];
  nextNewMoon?: { daysFromNow: number; dateLabel: string } | null;
  airTempF?: number;
  waterTempF?: number | null;
  waterTempSource?: string;
  hardFailed?: boolean;
  hardFailReasons?: string[];
  data?: {
    wind?: number;
    clouds?: number;
    moonPhase?: number;
    moonIlluminationPercent?: number;
    moonLabel?: string;
    tideSummary?: string;
    tideExtremes?: unknown;
  };
}

type GlowRatingLabel = 'HIGH' | 'MEDIUM' | 'LOW' | 'High' | 'Moderate' | 'Low';

interface GlowReasonLine {
  kind: 'good' | 'bad' | 'warn' | 'info';
  text: string;
}

interface GlowApiOk {
  status: 'OK';
  data: {
    glowStatus: GlowStatus;
    score: number;
    message: string;
    explanation?: string;
    wind: number;
    clouds: number;
    moonPhase: number;
    moonLabel: string;
    moonIlluminationPercent: number;
    tideSummary: string;
    tideExtremes?: unknown;
    rating: GlowRatingLabel;
    conditions: string[];
    reasoning?: GlowReasonLine[];
    nextNewMoon?: { daysFromNow: number; dateLabel: string } | null;
    airTempF?: number;
    waterTempF?: number | null;
    waterTempSource?: string;
    waterTempEstimate?: boolean;
    hardFailed?: boolean;
    hardFailReasons?: string[];
    inDinoSeason?: boolean;
  };
  analysis: { text: string } | null;
}

interface GlowApiUnavailable {
  status: 'UNAVAILABLE';
  message: string;
}

type GlowFetchError = null | 'live' | 'format';

type GlowTier = 'high' | 'moderate' | 'poor';

function normalizeRating(r: string | undefined): 'HIGH' | 'MEDIUM' | 'LOW' | undefined {
  if (!r || r === 'Unavailable') return undefined;
  if (r === 'High') return 'HIGH';
  if (r === 'Moderate') return 'MEDIUM';
  if (r === 'Low') return 'LOW';
  const u = r.toUpperCase();
  if (u === 'HIGH') return 'HIGH';
  if (u === 'MEDIUM') return 'MEDIUM';
  if (u === 'LOW') return 'LOW';
  return undefined;
}

function glowTierFromResult(r: GlowCheckResponse | null): GlowTier | null {
  if (!r?.success) return null;
  const nr = normalizeRating(r.rating);
  if (nr === 'HIGH' || r.rating === 'High' || r.status === 'perfect') return 'high';
  if (nr === 'MEDIUM' || r.rating === 'Moderate' || r.status === 'good') return 'moderate';
  if (nr === 'LOW' || r.rating === 'Low' || r.status === 'poor') return 'poor';
  return null;
}

function ratingAccentClass(rating: string | undefined) {
  const n = normalizeRating(rating) ?? (rating === 'High' ? 'HIGH' : rating === 'Moderate' ? 'MEDIUM' : rating === 'Low' ? 'LOW' : undefined);
  if (n === 'HIGH' || rating === 'High') {
    return 'border-emerald-400/50 bg-emerald-950/35 text-emerald-100 shadow-[0_0_24px_rgba(52,211,153,0.2)]';
  }
  if (n === 'MEDIUM' || rating === 'Moderate') {
    return 'border-amber-400/45 bg-amber-950/30 text-amber-50 shadow-[0_0_22px_rgba(251,191,36,0.15)]';
  }
  if (n === 'LOW' || rating === 'Low') {
    return 'border-rose-500/45 bg-rose-950/35 text-rose-50 shadow-[0_0_20px_rgba(244,63,94,0.12)]';
  }
  return 'border-slate-500/50 bg-slate-950/50 text-slate-200 shadow-[inset_0_0_20px_rgba(0,0,0,0.35)]';
}

function mapApiOkToGlowResult(payload: GlowApiOk): GlowCheckResponse {
  const d = payload.data;
  return {
    success: true,
    status: d.glowStatus,
    message: d.message,
    explanation: d.explanation,
    score: d.score,
    wind: d.wind,
    clouds: d.clouds,
    rating: d.rating,
    conditions: d.conditions,
    reasoning: d.reasoning,
    nextNewMoon: d.nextNewMoon,
    airTempF: d.airTempF,
    waterTempF: d.waterTempF ?? undefined,
    waterTempSource: d.waterTempSource,
    hardFailed: d.hardFailed,
    hardFailReasons: d.hardFailReasons,
    aiSummary: payload.analysis?.text ?? '',
    data: {
      wind: d.wind,
      clouds: d.clouds,
      moonPhase: d.moonPhase,
      moonIlluminationPercent: d.moonIlluminationPercent,
      moonLabel: d.moonLabel,
      tideSummary: d.tideSummary,
      tideExtremes: d.tideExtremes,
    },
  };
}

const accent = '#00cfff';

/** Hero taglines: same legibility treatment as Marine Conditions hero */
const BIO_HERO_LINE_SHADOW = '0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,207,255,0.28)';

const glowCheckSecondaryBtn =
  'inline-flex items-center justify-center rounded-xl border border-cyan-400/35 bg-transparent px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/95 shadow-[0_0_16px_rgba(34,211,238,0.12)] transition hover:border-cyan-300/55 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-60';

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

export default function BioluminescentTours(_props: BioluminescentToursProps) {
  const navigate = useNavigate();
  const [glowLoading, setGlowLoading] = useState(false);
  const [glowResult, setGlowResult] = useState<GlowCheckResponse | null>(null);
  const [glowFetchError, setGlowFetchError] = useState<GlowFetchError>(null);
  const [glowUnavailableMessage, setGlowUnavailableMessage] = useState<string | null>(null);

  const checkTonightsGlow = useCallback(async () => {
    const perf = beginAsyncInteraction('bio_tonights_glow_check');
    let outcome = 'completed';
    setGlowLoading(true);
    setGlowFetchError(null);
    setGlowResult(null);
    setGlowUnavailableMessage(null);

    try {
      if (!env.apiUrlConfigured || !env.apiUrl) {
        setGlowUnavailableMessage('Live glow data is unavailable (API URL not configured).');
        setGlowFetchError('live');
        outcome = 'no_api';
        return;
      }
      perf.markNetworkStart();
      const res = await fetchWithRetry(`${env.apiUrl}/api/bioluminescence`, { method: 'GET' });

      let raw: unknown;
      try {
        raw = await res.json();
      } catch {
        if (import.meta.env.DEV) {
          console.error('Glow check failed: invalid JSON body');
        }
        setGlowFetchError('format');
        outcome = 'bad_json';
        return;
      }

      const body = raw as GlowApiOk | GlowApiUnavailable | Record<string, unknown>;

      if (body && typeof body === 'object' && 'status' in body && body.status === 'UNAVAILABLE') {
        const msg =
          typeof (body as GlowApiUnavailable).message === 'string'
            ? (body as GlowApiUnavailable).message
            : 'Live environmental data unavailable';
        setGlowUnavailableMessage(msg);
        outcome = 'unavailable';
        return;
      }

      if (!res.ok) {
        if (import.meta.env.DEV) {
          console.error('Glow check failed:', res.status, body);
        }
        setGlowFetchError('live');
        outcome = 'http_error';
        return;
      }

      if (
        body &&
        typeof body === 'object' &&
        'status' in body &&
        body.status === 'OK' &&
        'data' in body &&
        'analysis' in body
      ) {
        const ok = body as GlowApiOk;
        if (!ok.data?.rating || !Array.isArray(ok.data.conditions)) {
          if (import.meta.env.DEV) {
            console.error('Glow check failed: invalid OK payload');
          }
          setGlowFetchError('format');
          outcome = 'bad_payload';
          return;
        }
        setGlowResult(mapApiOkToGlowResult(ok));
        outcome = 'success';
        return;
      }

      if (import.meta.env.DEV) {
        console.error('Glow check failed: unexpected response shape');
      }
      setGlowFetchError('format');
      outcome = 'unexpected_shape';
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('Glow check failed:', err);
      }
      setGlowFetchError('live');
      outcome = 'error';
    } finally {
      setGlowLoading(false);
      perf.end(outcome);
    }
  }, []);

  const glowCardClass = (() => {
    if (!glowResult) return '';
    const s = glowResult.status;
    if (s === 'perfect') {
      return 'border-emerald-400/70 bg-emerald-950/40 shadow-[0_0_40px_rgba(52,211,153,0.2)]';
    }
    if (s === 'good') {
      return 'border-amber-400/70 bg-amber-950/30 shadow-[0_0_36px_rgba(251,191,36,0.18)]';
    }
    if (s === 'poor') {
      return 'border-rose-500/60 bg-rose-950/35 shadow-[0_0_32px_rgba(244,63,94,0.15)]';
    }
    return 'border-slate-500/60 bg-slate-950/50';
  })();

  const statusLabel = (s: GlowStatus) => {
    if (s === 'perfect') return 'Strong glow potential';
    if (s === 'good') return 'Mixed conditions';
    if (s === 'poor') return 'Limited glow potential';
    return 'Unknown';
  };

  const aiGoNoGo =
    glowResult?.success && glowResult.aiSummary ? parseAiGoNoGo(glowResult.aiSummary) : null;

  const glowActionTier = glowResult?.success ? glowTierFromResult(glowResult) : null;

  const scrollToGlowCheck = useMemo(
    () =>
      wrapSyncClick('bio_scroll_glow_check', () => {
        document.getElementById('glow-live-status')?.scrollIntoView({ behavior: 'smooth' });
      }),
    []
  );

  const navigateBookBioCharter = useMemo(
    () =>
      wrapRouterNavigate(
        'bio_tours',
        'book_charter_bio',
        navigate,
        '/booking?bookingMode=charter&charterType=bio'
      ),
    [navigate]
  );

  const friendlyConditionsError =
    "We're having trouble loading live conditions right now. Try again in a moment.";

  const metaDescription = useMemo(
    () =>
      'Night bioluminescence charters and boat rentals on the Indian River Lagoon, Titusville FL. Captain-led evening glow tours plus pontoon and boat rental options. Book near Max Brewer Bridge and check live conditions.',
    []
  );

  const canonicalUrl = useMemo(() => `${siteOrigin()}/bioluminescent-tours`, []);

  const serviceJsonLd = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Night bioluminescence charters and boat rentals, Titusville FL',
      description: metaDescription,
      url: canonicalUrl,
      serviceType: ['Boat tour', 'Boat rental', 'Night charter'],
      areaServed: {
        '@type': 'City',
        name: 'Titusville',
        containedInPlace: { '@type': 'State', name: 'Florida' },
      },
      provider: {
        '@type': 'LocalBusiness',
        name: 'Launch Zone Charters',
        telephone: '+1-803-542-1761',
        url: siteOrigin(),
      },
    }),
    [canonicalUrl, metaDescription]
  );

  return (
    <div className="min-h-screen bg-lz-bg text-white">
      <Helmet prioritizeSeoTags>
        <title>
          Night Boat Rentals &amp; Bioluminescence Charters Titusville FL | Launch Zone Charters
        </title>
        <meta name="description" content={metaDescription} />
        <meta
          name="keywords"
          content="Indian River Lagoon boat tours, Titusville boat rentals, bioluminescence boat tour, night boat rental Florida, Space Coast charters, rocket launch viewing Florida, Max Brewer Bridge"
        />
        <link rel="canonical" href={canonicalUrl} />
        <meta
          property="og:title"
          content="Night Boat Rentals &amp; Bioluminescence Charters Titusville FL | Launch Zone Charters"
        />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={`${siteOrigin()}${BIO_HERO_IMAGE}`} />
        <script type="application/ld+json">{JSON.stringify(serviceJsonLd)}</script>
      </Helmet>

      {/* Hero: img drives frame height (no vw/background letterboxing); logo/subtitle scale with hero width */}
      <section className="bg-lz-bg" aria-label="Bioluminescent tours hero">
        <div className="bio-hero-frame relative isolate mx-auto w-full max-w-[1920px] overflow-hidden bg-black">
          <div className="relative w-full">
            <img
              src={BIO_HERO_IMAGE}
              alt={BIO_HERO_ALT}
              className="relative z-0 mx-auto block h-auto w-full max-w-[1920px] max-h-[min(70vh,800px)] object-contain object-center"
              loading="eager"
              decoding="async"
            />
            <div
              className="pointer-events-none absolute inset-0 z-[1]"
              style={{
                background:
                  'linear-gradient(to bottom, rgba(0,0,0,0.5), rgba(0,0,0,0.28), rgba(0,0,0,0.72))',
              }}
              aria-hidden
            />
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-14 bg-gradient-to-t from-[#020617] via-[#020617]/45 to-transparent sm:h-20"
              aria-hidden
            />

            {/* Brand: % of hero width tracks the bitmap; extra top inset so it sits lower on the art */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-[2.5%] pt-[clamp(1rem,4.25cqw,2.5rem)] sm:px-[3%] sm:pt-[clamp(1.15rem,4.75cqw,2.75rem)] md:pt-[clamp(1.25rem,5cqw,3rem)]">
              <div className="lz-hero-fade lz-hero-fade--delay-1 flex w-full max-w-[min(92%,560px)] flex-col items-center">
                <div className="pointer-events-auto drop-shadow-[0_4px_20px_rgba(0,0,0,0.92)]">
                  <div className="mx-auto w-[min(46%,300px)] sm:w-[min(44%,340px)] md:w-[min(42%,380px)] lg:w-[min(40%,420px)]">
                    <Logo variant="hero" imgClassName="!h-auto !w-full !max-w-none" />
                  </div>
                </div>
                <div className="pointer-events-auto mt-3 flex w-full flex-col items-center gap-1.5 text-center sm:mt-4 sm:gap-2 md:mt-5">
                  <p
                    className="max-w-[min(92%,420px)] font-display text-[clamp(0.5625rem,3.1cqw,1rem)] font-semibold uppercase leading-snug tracking-[0.2em] text-cyan-50/95 sm:tracking-[0.24em]"
                    style={{ textShadow: BIO_HERO_LINE_SHADOW }}
                  >
                    Bioluminescent tours
                  </p>
                  <p
                    className="max-w-[min(92%,400px)] font-display text-[clamp(0.5rem,2.85cqw,0.875rem)] font-medium uppercase leading-snug tracking-[0.12em] text-white/82 sm:tracking-[0.16em]"
                    style={{ textShadow: '0 1px 6px rgba(0,0,0,0.8)' }}
                  >
                    Indian River Lagoon · Titusville
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lz-hero-content relative border-t border-white/5 bg-lz-bg">
          <div className="lz-hero-fade lz-hero-fade--delay-2 mx-auto w-full max-w-2xl px-4 py-8 text-center sm:px-6 md:py-10 lg:px-8">
            <h1 className="font-display text-balance text-xl font-bold tracking-tight text-white sm:text-2xl md:text-[1.65rem] md:leading-snug">
              Bioluminescent night tours and boat rentals on the Indian River Lagoon
            </h1>
            <p
              className="mt-3 text-pretty text-sm font-medium leading-snug tracking-wide text-white sm:text-base"
              style={{ textShadow: BIO_HERO_LINE_SHADOW }}
            >
              Captain-led evenings when the lagoon glows, plus rental and charter options on the Space Coast
            </p>
            <p
              className="mt-2 text-xs font-normal leading-relaxed text-white/85 sm:text-[0.8125rem]"
              style={{ textShadow: '0 1px 8px rgba(0,0,0,0.65), 0 0 1px rgba(0,0,0,0.9)' }}
            >
              Book below. Live glow check and weekly outlook on this page.
            </p>
            <div className="mt-6 flex flex-col items-center gap-4 md:mt-7 md:gap-5">
              <div className="max-w-xl space-y-2">
                <p className="text-pretty text-sm font-semibold leading-relaxed text-slate-200/95 sm:text-base">
                  Reserve your evening ride, then scroll to see if tonight&apos;s conditions score a glow night.
                </p>
              </div>
              <div className="flex w-full max-w-lg flex-col gap-3 sm:flex-row sm:justify-center sm:gap-4">
                <button
                  type="button"
                  onClick={navigateBookBioCharter}
                  className="btn-primary order-1 w-full sm:order-none sm:min-w-0 sm:flex-1 sm:max-w-[min(100%,280px)]"
                >
                  Book Your Night Ride
                </button>
                <button
                  type="button"
                  onClick={scrollToGlowCheck}
                  className={`${glowCheckSecondaryBtn} order-2 w-full sm:order-none sm:min-w-0 sm:flex-1 sm:max-w-[min(100%,280px)]`}
                >
                  Check tonight&apos;s glow
                </button>
              </div>
              <p className="max-w-md text-center text-[11px] font-medium uppercase tracking-[0.18em] text-white/65 sm:text-xs">
                Licensed &amp; Insured • Titusville, FL • Indian River Lagoon
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Local SEO: charters + rentals (crawlable, aligned column) */}
      <section
        className="border-t border-white/5 bg-lz-bg py-10 md:py-14"
        aria-labelledby="bio-seo-heading"
      >
        <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:max-w-3xl lg:px-8">
          <h2
            id="bio-seo-heading"
            className="font-display text-balance text-center text-lg font-bold tracking-tight text-white sm:text-xl md:text-2xl"
          >
            Boat rentals and bioluminescence charters in Titusville, FL
          </h2>
          <p className="mt-5 text-pretty text-left text-sm leading-relaxed text-slate-300 sm:text-base">
            Launch Zone Charters runs <strong className="font-semibold text-slate-100">boat rentals</strong> and{' '}
            <strong className="font-semibold text-slate-100">private boat charters</strong> on the Space Coast. For{' '}
            <strong className="font-semibold text-slate-100">night bioluminescence</strong>, we focus on{' '}
            <strong className="font-semibold text-slate-100">captain-led evening charters</strong> out of{' '}
            <strong className="font-semibold text-slate-100">Titusville</strong> on the{' '}
            <strong className="font-semibold text-slate-100">Indian River Lagoon</strong>, near the{' '}
            <strong className="font-semibold text-slate-100">Max Brewer Bridge</strong> and Haulover Canal, so you get
            darkness, open water, and a full view of the glow from the deck.
          </p>
          <p className="mt-4 text-pretty text-left text-sm leading-relaxed text-slate-400 sm:text-base">
            Looking for <strong className="font-semibold text-slate-200">pontoon rentals</strong>, half-day or full-day{' '}
            <strong className="font-semibold text-slate-200">boat rental</strong> blocks, or hourly options for your crew?
            Browse our{' '}
            <Link
              to="/boat-rentals/daytona"
              className="font-semibold text-cyan-300 underline decoration-cyan-500/40 underline-offset-2 transition hover:text-cyan-200"
            >
              Space Coast boat rentals &amp; fleet
            </Link>
            . Then come back here to book a dedicated <strong className="font-semibold text-slate-200">night glow</strong>{' '}
            trip when conditions look good.
          </p>

          <h3 className="font-display mt-10 text-center text-base font-bold tracking-tight text-cyan-200/95 sm:text-lg">
            Charters vs. rentals: what&apos;s the difference?
          </h3>
          <p className="mt-3 text-pretty text-left text-sm leading-relaxed text-slate-300 sm:text-base">
            A <strong className="font-semibold text-slate-100">charter</strong> (especially for bioluminescence) is a
            scheduled experience: we route the boat for viewing, safety, and timing around sunset and tide. A{' '}
            <strong className="font-semibold text-slate-100">rental</strong> puts you at the helm on your own schedule
            with the qualifications and paperwork the law requires, ideal for daytime sandbar runs, rocket-view windows,
            or flexible hours. Many guests use{' '}
            <strong className="font-semibold text-slate-100">rentals by day</strong> and a{' '}
            <strong className="font-semibold text-slate-100">captain charter at night</strong> for the glow.
          </p>

          <h3 className="font-display mt-10 text-center text-base font-bold tracking-tight text-cyan-200/95 sm:text-lg">
            Night boat rental searches on the Space Coast
          </h3>
          <p className="mt-3 text-pretty text-left text-sm leading-relaxed text-slate-300 sm:text-base">
            If you&apos;re Googling <strong className="font-semibold text-slate-100">boat rentals at night</strong>,{' '}
            <strong className="font-semibold text-slate-100">Titusville FL boat rental</strong>, or{' '}
            <strong className="font-semibold text-slate-100">Indian River Lagoon rental</strong>: you&apos;re in the
            right estuary. We serve <strong className="font-semibold text-slate-100">North Brevard</strong>,{' '}
            <strong className="font-semibold text-slate-100">Merritt Island</strong>, and visitors from Orlando and
            Melbourne who want real lagoon miles, not a parking-lot view.
          </p>

          <h3 className="font-display mt-10 text-center text-base font-bold tracking-tight text-cyan-200/95 sm:text-lg">
            Indian River Lagoon and bioluminescence: what to expect
          </h3>
          <p className="mt-3 text-pretty text-left text-sm leading-relaxed text-slate-300 sm:text-base">
            Peak glow varies with season, rain, and moonlight, so we publish a live score and weekly outlook. When
            conditions align, the water behind the motor can flash electric blue and green; fish and manatees may leave
            glowing trails. It&apos;s a real Florida estuary at night, best on a stable boat with a licensed operator.
          </p>

          <h3 className="font-display mt-10 text-center text-base font-bold tracking-tight text-cyan-200/95 sm:text-lg">
            Before you book (rental or charter)
          </h3>
          <ul className="mt-4 list-disc space-y-2 pl-6 text-left text-sm leading-relaxed text-slate-300 sm:pl-7 sm:text-base">
            <li>
              <strong className="font-semibold text-slate-200">Night glow trips:</strong> evening start times; we confirm
              details when you book.
            </li>
            <li>
              <strong className="font-semibold text-slate-200">Daytime rentals:</strong> hourly, half-day, and full-day
              blocks. See fleet pricing and availability on the rentals page.
            </li>
            <li>Bring layers; the lagoon cools after dark even in summer.</li>
            <li>
              Questions about qualifications for bareboat rental vs. adding a captain? Call and we&apos;ll walk you
              through it.
            </li>
          </ul>

          <p className="mt-8 text-pretty text-left text-sm leading-relaxed text-slate-400 sm:text-base">
            <strong className="font-semibold text-slate-300">Brevard County &amp; Space Coast:</strong>{' '}
            <strong className="font-semibold text-slate-200">Cocoa</strong>,{' '}
            <strong className="font-semibold text-slate-200">Cape Canaveral</strong>, and{' '}
            <strong className="font-semibold text-slate-200">Titusville</strong>. Call{' '}
            <a href="tel:8035421761" className="font-semibold text-cyan-300 underline-offset-2 hover:text-cyan-200">
              803-542-1761
            </a>{' '}
            for rentals, charters, or last-minute schedule questions.
          </p>
        </div>
      </section>

      {/* Core product: live glow command center */}
      <section
        id="glow-live-status"
        className="relative scroll-mt-24 border-t border-[#00cfff]/35 bg-lz-bg py-16 md:py-24"
        aria-labelledby="bio-command-heading"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-100"
          style={{
            background: `radial-gradient(ellipse 90% 50% at 50% 0%, rgba(0, 207, 255, 0.18), transparent 52%), radial-gradient(ellipse 70% 45% at 50% 100%, rgba(6, 182, 212, 0.1), transparent 55%)`,
          }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="mb-10 text-center md:mb-12">
            <h2
              id="bio-command-heading"
              className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl"
            >
              IS TONIGHT THE NIGHT?
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-base text-zinc-400 md:text-lg">
              Check real lagoon conditions before you go.
            </p>
          </div>

          <div className="rounded-3xl border border-cyan-400/40 bg-zinc-950/55 p-6 shadow-[0_0_60px_rgba(0,207,255,0.16),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl md:p-8">
            {/* Tonight */}
            <div className="pb-10 md:pb-12">
              <p className="text-center text-xs font-bold uppercase tracking-[0.28em] text-cyan-200/95">
                Tonight&apos;s glow conditions
              </p>
              <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-zinc-400 md:text-base">
                Live wind, clouds, moon phase, and tide, updated instantly.
              </p>

          <div className="mt-8 space-y-6">
          {(glowFetchError || glowUnavailableMessage) && (
            <div
              className="lz-bio-glow-card border-slate-500/50 bg-slate-950/55 text-left shadow-[0_0_40px_rgba(148,163,184,0.12)] backdrop-blur-md"
              role="alert"
              aria-live="assertive"
            >
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">
                Live glow status unavailable
              </p>
              <p className="mt-3 text-base leading-relaxed text-slate-200">{friendlyConditionsError}</p>
              <p className="mt-4 flex items-start gap-2 text-sm text-slate-400">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400/90" aria-hidden />
                Tours still operate during peak glow season · {BIO_LOCATION_FULL}
              </p>
              <button
                type="button"
                onClick={() => {
                  void checkTonightsGlow();
                }}
                disabled={glowLoading}
                className="lz-btn-secondary mt-4 w-full !py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {glowLoading ? (
                  <>
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden />
                    Checking…
                  </>
                ) : (
                  'Try again'
                )}
              </button>
            </div>
          )}

          {glowResult && (
            <div className={`lz-bio-glow-card text-left ${glowCardClass}`} role="status" aria-live="polite">
              {glowResult.rating && glowResult.rating !== 'Unavailable' && (
                <div className={`mb-4 rounded-xl border px-4 py-3 ${ratingAccentClass(glowResult.rating)}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/80">Glow rating</p>
                  <p className="mt-1 font-display text-2xl font-bold tracking-tight md:text-3xl">
                    {normalizeRating(glowResult.rating) ?? glowResult.rating}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-white/75">
                    Decision model: outside May–October or water under 70°F forces LOW. Otherwise weights are season
                    (40%), water (25%), moon (20%), wind (10%), clouds (5%). Sea temperature from Open-Meteo marine
                    when available; otherwise estimated from air.
                  </p>
                </div>
              )}

              {glowResult.hardFailed && (
                <p className="mb-4 rounded-lg border border-amber-500/35 bg-amber-950/25 px-3 py-2 text-xs text-amber-50/95 sm:text-sm">
                  Hard limits applied: we do not show MEDIUM or HIGH when it is not peak season (May–Oct) or when water
                  is below 70°F.
                </p>
              )}

              {glowResult.nextNewMoon && glowResult.nextNewMoon.daysFromNow >= 0 && (
                <p className="mb-4 rounded-lg border border-cyan-500/25 bg-cyan-950/20 px-3 py-2 text-center text-xs text-cyan-100/95 sm:text-sm">
                  <span className="font-semibold text-cyan-200">Darkest skies:</span> next new-moon night around{' '}
                  <span className="font-mono text-cyan-50">{glowResult.nextNewMoon.dateLabel}</span>
                  {glowResult.nextNewMoon.daysFromNow > 0
                    ? ` (${glowResult.nextNewMoon.daysFromNow} day${glowResult.nextNewMoon.daysFromNow === 1 ? '' : 's'} away)`
                    : ' (tonight)'}
                  . Great nights to plan around for visibility.
                </p>
              )}

              {Array.isArray(glowResult.reasoning) && glowResult.reasoning.length > 0 && (
                <div className="mb-4 rounded-xl border border-white/10 bg-black/25 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200/90">
                    Conditions breakdown
                  </p>
                  <ul className="mt-3 space-y-2.5 text-sm leading-snug text-slate-200">
                    {glowResult.reasoning.map((line, i) => (
                      <li key={`${line.kind}-${i}`} className="flex gap-2.5">
                        {line.kind === 'good' && (
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400/95" aria-hidden />
                        )}
                        {line.kind === 'bad' && (
                          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400/95" aria-hidden />
                        )}
                        {line.kind === 'warn' && (
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400/95" aria-hidden />
                        )}
                        {line.kind === 'info' && (
                          <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400/85" aria-hidden />
                        )}
                        <span>{line.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {Array.isArray(glowResult.conditions) && glowResult.conditions.length > 0 && (
                <ul className="mb-4 space-y-2 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-200">
                  {glowResult.conditions.map((line) => (
                    <li key={line} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400/90" aria-hidden />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/90">
                  {statusLabel(glowResult.status)}
                </p>
                {typeof glowResult.score === 'number' && (
                  <span className="rounded-md border border-white/15 bg-black/30 px-2 py-0.5 font-mono text-xs text-cyan-100/90">
                    Score {glowResult.score}/100
                  </span>
                )}
              </div>
              <p className="mt-3 text-base font-semibold leading-relaxed text-slate-50 md:text-lg">
                {glowResult.message}
              </p>
              {glowResult.explanation && (
                <p className="mt-2 text-sm leading-relaxed text-slate-300 md:text-base">{glowResult.explanation}</p>
              )}
              {glowResult.success && glowResult.aiSummary && glowResult.aiSummary.trim().length > 0 && (
                <div className="mt-6 rounded-xl border border-white/10 bg-black/25 p-4 text-left">
                  {aiGoNoGo === 'go' && <p className="text-lg font-bold text-emerald-300">🔥 GO</p>}
                  {aiGoNoGo === 'no-go' && <p className="text-lg font-bold text-rose-300">❌ NO-GO</p>}
                  {!aiGoNoGo && (
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">AI summary</p>
                  )}
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-200 md:text-base">
                    {glowResult.aiSummary}
                  </p>
                  <p className="mt-3 text-[11px] leading-snug text-slate-500">
                    AI text is advisory only. The rating above uses live weather rules. Always use good judgment and
                    check local conditions before boating.
                  </p>
                </div>
              )}
              {glowResult.success && glowResult.wind != null && glowResult.clouds != null && (
                <dl className="mt-6 grid gap-2 border-t border-white/10 pt-4 text-sm text-slate-300">
                  {glowResult.airTempF != null && (
                    <div className="flex justify-between gap-4">
                      <dt>Air temp</dt>
                      <dd className="font-mono text-cyan-100/90">
                        {Math.round(glowResult.airTempF * 10) / 10}°F
                      </dd>
                    </div>
                  )}
                  {glowResult.waterTempF != null && (
                    <div className="flex justify-between gap-4">
                      <dt>
                        {glowResult.waterTempSource === 'open-meteo-marine' ? 'Water (marine)' : 'Water (est.)'}
                      </dt>
                      <dd className="max-w-[65%] text-right font-mono text-cyan-100/90">
                        ~{Math.round(glowResult.waterTempF * 10) / 10}°F
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-4">
                    <dt>Moon</dt>
                    <dd className="max-w-[65%] text-right font-mono text-cyan-100/90">
                      {glowResult.data?.moonLabel != null && glowResult.data?.moonIlluminationPercent != null
                        ? `${glowResult.data.moonLabel} (~${glowResult.data.moonIlluminationPercent}% lit)`
                        : 'N/A'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Tide</dt>
                    <dd className="max-w-[65%] text-right text-xs leading-snug text-cyan-100/90 md:text-sm">
                      {glowResult.data?.tideSummary ?? 'N/A'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Wind</dt>
                    <dd className="font-mono text-cyan-100/90">{Math.round(glowResult.wind * 10) / 10} mph</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Cloud cover</dt>
                    <dd className="font-mono text-cyan-100/90">{Math.round(glowResult.clouds)}%</dd>
                  </div>
                </dl>
              )}

              {glowResult.success && glowActionTier && (
                <div className="mt-6 border-t border-white/10 pt-5">
                  {glowActionTier === 'high' && (
                    <>
                      <p className="text-base font-medium leading-relaxed text-slate-100">
                        🔥 Tonight looks like a great night to go
                      </p>
                      <p className="mt-1 text-xs leading-snug text-slate-500">
                        Conditions look favorable based on live data.
                      </p>
                      <button
                        type="button"
                        onClick={navigateBookBioCharter}
                        className="lz-btn-primary mt-4 w-full !py-2.5 text-sm sm:w-auto"
                      >
                        Book an Evening Charter
                      </button>
                    </>
                  )}
                  {glowActionTier === 'moderate' && (
                    <>
                      <p className="text-base font-medium leading-relaxed text-slate-100">
                        👍 Conditions may be decent tonight
                      </p>
                      <button
                        type="button"
                        onClick={navigateBookBioCharter}
                        className="lz-btn-primary mt-4 w-full !py-2.5 text-sm sm:w-auto"
                      >
                        Check Availability
                      </button>
                    </>
                  )}
                  {glowActionTier === 'poor' && (
                    <>
                      <p className="text-base font-medium leading-relaxed text-amber-100/95">
                        ⚠️ Conditions aren&apos;t ideal tonight
                      </p>
                      <p className="mt-3 text-sm text-slate-400">
                        <a
                          href="#weekly-glow-outlook"
                          className="text-[#00cfff] underline decoration-[#00cfff]/40 underline-offset-2 transition-colors hover:brightness-125"
                        >
                          Check other days below
                        </a>
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {!glowFetchError && !glowUnavailableMessage && !glowResult && (
            <div
              className="rounded-2xl border border-cyan-400/25 bg-black/30 px-4 py-6 text-center shadow-[0_0_40px_rgba(0,207,255,0.1)] backdrop-blur-sm sm:px-8"
              role="region"
              aria-label="Check live glow conditions"
            >
              <button
                type="button"
                onClick={() => {
                  void checkTonightsGlow();
                }}
                disabled={glowLoading}
                className={`${glowCheckSecondaryBtn} disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {glowLoading ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Checking…
                  </span>
                ) : (
                  "Check tonight's glow"
                )}
              </button>
            </div>
          )}
          </div>
            </div>

            <div
              id="weekly-glow-outlook"
              className="border-t border-white/10 pt-10 md:pt-12"
              aria-labelledby="heading-weekly-forecast"
            >
              <h2 id="heading-weekly-forecast" className="sr-only">
                Weekly bioluminescence forecast
              </h2>
              <WeeklyForecast
                embedded
                layout="horizontal"
                heading="Best nights this week"
                subheading="Same engine as tonight: forecast wind, clouds, and air from OpenWeather; marine SST from Open-Meteo when available; moon phase; identical hard limits and scoring."
                loadButtonLabel="View weekly forecast"
              />
            </div>

            <div className="border-t border-white/10 pt-10 md:pt-12" aria-labelledby="heading-bio-alerts">
              <h2 id="heading-bio-alerts" className="sr-only">
                Alerts for perfect bioluminescence nights
              </h2>
              <div className="mx-auto max-w-md">
                <SubscribeAlerts
                  subscribedTo="bio"
                  title="Get alerted when conditions are perfect"
                  subtitle={"We'll notify you when it's the perfect night to go."}
                  submitLabel="Get alerts"
                  primaryCta
                  className="border-cyan-400/30 bg-black/30"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        className="border-t border-[#00cfff]/20 bg-lz-bg py-12 md:py-16"
        aria-labelledby="bio-features-heading"
      >
        <h2 id="bio-features-heading" className="sr-only">
          Why a boat tour, what you will see, and tour details
        </h2>
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 px-4 md:grid-cols-3 md:gap-6 md:px-6 lg:px-8">
          {[
            {
              title: 'Why It’s Better on a Boat',
              items: ['Stronger glow from motor wake', 'Covers more water than kayaks', 'No paddling, just relax'],
            },
            {
              title: 'What You’ll See',
              items: [
                'Electric blue water glowing behind the boat',
                'Glowing trails across the lagoon',
                'Night skyline views',
              ],
            },
            {
              title: 'Details',
              items: ['Up to 6 passengers', 'Night tours only', 'Smooth, comfortable ride'],
            },
          ].map((block) => (
            <div
              key={block.title}
              className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_0_28px_rgba(0,0,0,0.25)] backdrop-blur-md md:p-7"
            >
              <h3 className="font-display text-lg font-bold tracking-tight text-cyan-300">{block.title}</h3>
              <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-200/95">
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section
        className="relative border-t border-[#00cfff]/30 bg-gradient-to-b from-black via-zinc-950 to-black py-20 md:py-28"
        aria-labelledby="heading-final-cta"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            background: `radial-gradient(ellipse 70% 50% at 50% 100%, ${accent}33, transparent 55%)`,
          }}
          aria-hidden
        />
        <div className="relative z-10 mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 id="heading-final-cta" className="font-display text-3xl font-bold text-white md:text-4xl lg:text-5xl">
            Don&apos;t just see it. Ride through it
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-zinc-400">{BIO_LOCATION_FULL}</p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button
              type="button"
              onClick={navigateBookBioCharter}
              className="btn-primary w-full sm:w-auto"
            >
              Book Now
            </button>
            <a
              href="tel:8035421761"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#00cfff]/50 px-10 py-4 text-sm font-semibold text-[#00cfff] transition hover:bg-[#00cfff]/10 sm:w-auto sm:text-base"
            >
              <Phone className="h-5 w-5 shrink-0" aria-hidden />
              803-542-1761
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
