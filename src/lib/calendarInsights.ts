/** Calendar scoring + copy for BookNow (weather + Launch Library 2 upcoming data). */

export type Tier = 'best' | 'good' | 'poor';
export type Confidence = 'high' | 'medium' | 'low';

export interface WeatherSample {
  windSpeed: number;
  rainProbability: number;
  cloudCover: number;
}

export interface LaunchDayAgg {
  hasLaunch: boolean;
  nightLaunch: boolean;
  /** Per-day certainty bucket derived from Next Spaceflight status. */
  certainty: 'confirmed' | 'net' | 'tbd';
}

export interface DayInsight {
  score: number;
  tier: Tier;
  weather: WeatherSample;
  launch: LaunchDayAgg;
  /** Plain-language reason for the “Best Launch Day” header. */
  insightReason: string;
}

const LAUNCH_API = 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/';
const BUSINESS_TZ = 'America/New_York';
const YMD_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const HOUR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TZ,
  hour: '2-digit',
  hour12: false,
});

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Calendar grid dates are EST/EDT-local — match launch instants to America/New_York day. */
export function localYmdFromInstant(iso: string): string {
  const parts = YMD_FORMATTER.formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

export function localHourFromInstant(iso: string): number {
  const hh = HOUR_FORMATTER.format(new Date(iso));
  return Number.parseInt(hh, 10);
}

/** 7PM–6AM local → night launch window. */
export function isNightLaunchLocal(windowStart: string): boolean {
  const h = localHourFromInstant(windowStart);
  return h >= 19 || h < 6;
}

export function inferConfidence(status: { abbrev?: string; name?: string } | null | undefined): Confidence {
  const s = `${status?.abbrev || ''} ${status?.name || ''}`.toUpperCase();
  if (/\bTBD\b/.test(s) || s.includes('TO BE DETERMINED')) return 'low';
  if (/\bNET\b/.test(s) || s.includes('NO EARLIER THAN')) return 'medium';
  if (/\bGO\b/.test(s) || s.includes('GO FOR LAUNCH') || s.includes('GO FOR')) return 'high';
  return 'medium';
}

function certaintyFromStatus(
  status: { abbrev?: string; name?: string } | null | undefined
): LaunchDayAgg['certainty'] {
  const c = inferConfidence(status);
  if (c === 'high') return 'confirmed';
  if (c === 'medium') return 'net';
  return 'tbd';
}

function certaintyRank(c: LaunchDayAgg['certainty']): number {
  if (c === 'confirmed') return 3;
  if (c === 'net') return 2;
  return 1;
}

export function isSpaceCoastLaunch(pad: { location?: { name?: string | null; region?: string | null } } | null | undefined): boolean {
  const blob = `${pad?.location?.name || ''} ${pad?.location?.region || ''}`.toLowerCase();
  if (!blob.trim()) return false;
  if (blob.includes('vandenberg') || blob.includes('california')) return false;
  if (
    blob.includes('canaveral') ||
    blob.includes('kennedy') ||
    blob.includes('ksc') ||
    blob.includes('patrick') ||
    blob.includes('slc-40') ||
    blob.includes('lc-39') ||
    blob.includes('titussville') ||
    blob.includes('space force') ||
    blob.includes('florida')
  ) {
    return true;
  }
  return false;
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

export function scoreWeatherBase(w: WeatherSample): number {
  let score = 10;
  if (w.windSpeed > 20) score -= 5;
  else if (w.windSpeed > 15) score -= 3;
  if (w.rainProbability > 30) score -= 3;
  if (w.cloudCover > 70) score -= 2;
  return clampScore(score);
}

export function applyLaunchAdjustments(baseScore: number, launch: LaunchDayAgg): number {
  let s = baseScore;
  if (launch.hasLaunch) s += 2;
  if (launch.nightLaunch) s += 2;
  if (launch.certainty === 'tbd') s -= 1;
  return clampScore(s);
}

export function tierFromScore(score: number): Tier {
  if (score >= 8) return 'best';
  if (score >= 5) return 'good';
  return 'poor';
}

function skyToken(c: number): string {
  if (c < 35) return '✨ Clear';
  if (c < 70) return '✨ Fair';
  return '⚠️ Cloudy';
}

function windToken(w: number): string {
  if (w > 20) return '⚠️ Windy';
  if (w > 15) return '💨 Breezy';
  if (w > 10) return '💨 Light wind';
  return '💨 Low wind';
}

function waterToken(w: number): string {
  if (w > 20) return '🌊 Choppy';
  if (w > 12) return '🌊 Light chop';
  return '🌊 Calm';
}

function rainNote(p: number): string | null {
  if (p > 35) return '⚠️ Wet';
  return null;
}

/** Priority: launch → sky/wind → water / caution */
export function buildTileLines(
  w: WeatherSample,
  launch: LaunchDayAgg,
  opts: { isTopPick: boolean }
): { line1: string; line2: string } {
  const sky = skyToken(w.cloudCover);
  const wind = windToken(w.windSpeed);
  const water = waterToken(w.windSpeed);
  const wet = rainNote(w.rainProbability);

  if (launch.hasLaunch) {
    const rocketDay = launch.nightLaunch ? '🚀🌙 Night' : '🚀 Day';
    const first = `${rocketDay} • ${sky}`;
    let second = wet ? `${wind} • ${wet}` : `${wind} • ${water}`;
    if (launch.certainty === 'tbd') {
      second = `⚠️ TBC • ${wet ? wind : water}`;
    }
    if (opts.isTopPick) {
      return { line1: '⭐ Best', line2: first };
    }
    return { line1: first, line2: second };
  }

  const a = `${sky} • ${water}`;
  let b = wet ? `${wind} • ${wet}` : wind;
  if (w.windSpeed > 20 || w.rainProbability > 35) {
    b = `⚠️ Rough • ${wind}`;
  }

  if (opts.isTopPick) {
    return { line1: '⭐ Best', line2: a };
  }
  return { line1: a, line2: b };
}

export function buildInsightReason(w: WeatherSample, launch: LaunchDayAgg): string {
  const parts: string[] = [];
  if (launch.hasLaunch) {
    parts.push(launch.nightLaunch ? 'Night launch' : 'Day launch');
    if (launch.certainty === 'tbd') parts.push('Date TBC');
    else if (launch.certainty === 'net') parts.push('NET window');
    else parts.push('Confirmed window');
  }
  if (w.cloudCover < 40 && w.rainProbability < 25) parts.push('Clear skies');
  else if (w.cloudCover < 70) parts.push('Fair visibility');
  else parts.push('Cloudier skies');

  if (w.windSpeed <= 12) parts.push('Calm water');
  else if (w.windSpeed <= 20) parts.push('Light wind');
  else parts.push('Windy');

  return parts.slice(0, 4).join(' • ');
}

/** Merge Open-Meteo samples + aggregated Space Coast launches into daily insights. */
export function mergeCalendarInsights(
  weatherByDate: Map<string, WeatherSample>,
  launchByDate: Map<string, LaunchDayAgg>,
  windowKeys: Set<string>
): Map<string, DayInsight> {
  const out = new Map<string, DayInsight>();
  windowKeys.forEach((iso) => {
    const w = weatherByDate.get(iso) ?? { windSpeed: 0, rainProbability: 0, cloudCover: 0 };
    const l = launchByDate.get(iso) ?? { hasLaunch: false, nightLaunch: false, certainty: 'tbd' };
    const base = scoreWeatherBase(w);
    const score = applyLaunchAdjustments(base, l);
    const tier = tierFromScore(score);
    out.set(iso, {
      score,
      tier,
      weather: w,
      launch: l,
      insightReason: buildInsightReason(w, l),
    });
  });
  return out;
}

/** Next 7 calendar days starting from `fromYmd` (YYYY-MM-DD), inclusive. */
export function nextSevenDayKeys(fromYmd: string): Set<string> {
  const [y, m, d] = fromYmd.split('-').map(Number);
  const start = new Date(y, (m || 1) - 1, d || 1);
  const keys = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const dt = new Date(start);
    dt.setDate(start.getDate() + i);
    keys.add(`${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`);
  }
  return keys;
}

export interface LaunchListResult {
  byDate: Map<string, LaunchDayAgg>;
}

export async function fetchLaunchDaysSpaceCoast(
  windowKeys: Set<string>,
  signal: AbortSignal
): Promise<LaunchListResult> {
  const params = new URLSearchParams({
    mode: 'detailed',
    limit: '100',
  });
  const res = await fetch(`${LAUNCH_API}?${params.toString()}`, { signal });
  if (!res.ok) throw new Error('launch_fetch');
  const data = (await res.json()) as {
    results?: Array<{
      window_start?: string | null;
      status?: { abbrev?: string; name?: string };
      pad?: { location?: { name?: string; region?: string } };
    }>;
  };

  const byDate = new Map<string, LaunchDayAgg>();

  for (const row of data.results || []) {
    const ws = row.window_start;
    if (!ws) continue;
    if (!isSpaceCoastLaunch(row.pad)) continue;
    const ymd = localYmdFromInstant(ws);
    if (!windowKeys.has(ymd)) continue;

    const certainty = certaintyFromStatus(row.status);
    const night = isNightLaunchLocal(ws);
    const prev = byDate.get(ymd) || {
      hasLaunch: false,
      nightLaunch: false,
      certainty: 'tbd' as const,
    };
    prev.hasLaunch = true;
    prev.nightLaunch = prev.nightLaunch || night;
    if (certaintyRank(certainty) > certaintyRank(prev.certainty)) {
      prev.certainty = certainty;
    }
    byDate.set(ymd, prev);
  }

  return { byDate };
}

/** Calendar API may expose either legacy booleans or fleet rows with `{ available }`. */
export type CalendarDayAvailability =
  | boolean
  | {
      available: boolean;
      boatsRemaining?: number;
      totalBoats?: number;
    };

export function isDayMarkedUnavailable(
  availabilityByDate: Map<string, CalendarDayAvailability>,
  iso: string
): boolean {
  if (availabilityByDate.size === 0) return false;
  const v = availabilityByDate.get(iso);
  if (v === undefined) return false;
  if (typeof v === 'boolean') return v === false;
  return v.available === false;
}

export function pickTopPickIso(
  conditions: Map<string, DayInsight>,
  availabilityByDate: Map<string, CalendarDayAvailability>,
  todayYmd: string
): { iso: string; score: number } | null {
  let best: { iso: string; score: number } | null = null;
  conditions.forEach((c, iso) => {
    if (iso < todayYmd) return;
    if (isDayMarkedUnavailable(availabilityByDate, iso)) return;
    if (!best || c.score > best.score || (c.score === best.score && iso < best.iso)) {
      best = { iso, score: c.score };
    }
  });
  return best;
}

/** Launch-only top day: confirmed > NET > TBD, then night launches, then weather score. */
export function pickBestLaunchDayIso(
  conditions: Map<string, DayInsight>,
  availabilityByDate: Map<string, CalendarDayAvailability>,
  todayYmd: string
): { iso: string; score: number } | null {
  let best: { iso: string; score: number } | null = null;
  conditions.forEach((c, iso) => {
    if (iso < todayYmd) return;
    if (!c.launch.hasLaunch) return;
    if (isDayMarkedUnavailable(availabilityByDate, iso)) return;
    if (!best) {
      best = { iso, score: c.score };
      return;
    }
    const prev = conditions.get(best.iso);
    if (!prev) {
      best = { iso, score: c.score };
      return;
    }
    const certaintyDelta = certaintyRank(c.launch.certainty) - certaintyRank(prev.launch.certainty);
    if (certaintyDelta > 0) {
      best = { iso, score: c.score };
      return;
    }
    if (certaintyDelta < 0) return;
    if (c.launch.nightLaunch && !prev.launch.nightLaunch) {
      best = { iso, score: c.score };
      return;
    }
    if (!c.launch.nightLaunch && prev.launch.nightLaunch) return;
    if (c.score > prev.score || (c.score === prev.score && iso < best.iso)) {
      best = { iso, score: c.score };
    }
  });
  return best;
}
