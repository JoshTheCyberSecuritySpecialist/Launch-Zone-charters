/** Customer-facing calendar weather presentation. Scoring stays in calendarInsights. */

import type { DayInsight, WeatherSample } from './calendarInsights';

export type CalendarOutlookLevel = 'favorable' | 'monitor' | 'concern' | 'unavailable';
export type CalendarWeatherKind =
  | 'clear'
  | 'partly_cloudy'
  | 'cloudy'
  | 'fog'
  | 'rain'
  | 'storm'
  | 'windy';

/** Same numbers as server/lib/charterWeatherOutlook.js — daily calendar only. */
const OUTLOOK_THRESHOLDS = {
  precipMonitorPct: 30,
  precipConcernPct: 50,
  windMonitorMph: 15,
  windConcernMph: 20,
  gustMonitorMph: 18,
  gustConcernMph: 25,
};

export const CALENDAR_OUTLOOK_LABELS: Record<CalendarOutlookLevel, string> = {
  favorable: 'Favorable',
  monitor: 'Monitor weather',
  concern: 'Weather concern',
  unavailable: 'Forecast unavailable',
};

export const CALENDAR_OUTLOOK_BADGE: Record<CalendarOutlookLevel, string> = {
  favorable: 'Favorable',
  monitor: 'Monitor',
  concern: 'Concern',
  unavailable: 'No forecast',
};

/** Short enough to fit a 320px calendar cell without truncating. */
export const CALENDAR_OUTLOOK_MOBILE_BADGE: Record<CalendarOutlookLevel, string> = {
  favorable: 'OK',
  monitor: 'Watch',
  concern: 'Alert',
  unavailable: '—',
};

const KIND_COPY: Record<
  CalendarWeatherKind,
  { short: string; sentenceLead: string }
> = {
  clear: { short: 'Clear', sentenceLead: 'Clear' },
  partly_cloudy: { short: 'Partly cloudy', sentenceLead: 'Partly cloudy' },
  cloudy: { short: 'Cloudy', sentenceLead: 'Cloudy' },
  fog: { short: 'Fog', sentenceLead: 'Foggy' },
  rain: { short: 'Rain possible', sentenceLead: 'Rain possible' },
  storm: { short: 'Storm concern', sentenceLead: 'Storms possible' },
  windy: { short: 'Windy', sentenceLead: 'Windy' },
};

function finite(value: number | null | undefined): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function calendarWeatherKind(weather: WeatherSample): CalendarWeatherKind {
  const code = finite(weather.weatherCode);
  if (code != null) {
    if (code >= 95) return 'storm';
    if ((code >= 51 && code < 70) || (code >= 80 && code < 90)) return 'rain';
    if (code === 45 || code === 48) return 'fog';
    if (weather.windSpeed > OUTLOOK_THRESHOLDS.windConcernMph) return 'windy';
    if (code === 0 || code === 1) return 'clear';
    if (code === 2) return 'partly_cloudy';
    return 'cloudy';
  }

  if (weather.rainProbability >= OUTLOOK_THRESHOLDS.precipMonitorPct) return 'rain';
  if (weather.windSpeed > OUTLOOK_THRESHOLDS.windConcernMph) return 'windy';
  if (weather.cloudCover < 35) return 'clear';
  if (weather.cloudCover < 70) return 'partly_cloudy';
  return 'cloudy';
}

export function calendarOutlookLevel(weather: WeatherSample | undefined | null): CalendarOutlookLevel {
  if (!weather) return 'unavailable';

  const kind = calendarWeatherKind(weather);
  const gust = finite(weather.gustMph) ?? 0;

  if (
    kind === 'storm' ||
    weather.rainProbability >= OUTLOOK_THRESHOLDS.precipConcernPct ||
    weather.windSpeed >= OUTLOOK_THRESHOLDS.windConcernMph ||
    gust >= OUTLOOK_THRESHOLDS.gustConcernMph
  ) {
    return 'concern';
  }

  if (
    kind === 'rain' ||
    weather.rainProbability >= OUTLOOK_THRESHOLDS.precipMonitorPct ||
    weather.windSpeed >= OUTLOOK_THRESHOLDS.windMonitorMph ||
    gust >= OUTLOOK_THRESHOLDS.gustMonitorMph
  ) {
    return 'monitor';
  }

  return 'favorable';
}

export function calendarConditionShort(weather: WeatherSample): string {
  return KIND_COPY[calendarWeatherKind(weather)].short;
}

function windPhrase(weather: WeatherSample): string {
  if (weather.windSpeed > OUTLOOK_THRESHOLDS.windConcernMph) return 'strong wind';
  if (weather.windSpeed >= OUTLOOK_THRESHOLDS.windMonitorMph) return 'breezy conditions';
  return 'light wind';
}

export function calendarConditionSentence(weather: WeatherSample): string {
  const kind = calendarWeatherKind(weather);
  return `${KIND_COPY[kind].sentenceLead} with ${windPhrase(weather)}`;
}

export function calendarOutlookReasons(weather: WeatherSample): string[] {
  const kind = calendarWeatherKind(weather);
  const gust = finite(weather.gustMph) ?? 0;
  const reasons: string[] = [];

  if (kind === 'storm') {
    reasons.push('Thunderstorms are possible.');
  } else if (
    kind === 'rain' ||
    weather.rainProbability >= OUTLOOK_THRESHOLDS.precipMonitorPct
  ) {
    reasons.push('Rain is possible during part of the day.');
  }

  if (
    weather.windSpeed >= OUTLOOK_THRESHOLDS.windConcernMph ||
    gust >= OUTLOOK_THRESHOLDS.gustConcernMph
  ) {
    reasons.push('Strong wind or gusts are possible.');
  } else if (
    weather.windSpeed >= OUTLOOK_THRESHOLDS.windMonitorMph ||
    gust >= OUTLOOK_THRESHOLDS.gustMonitorMph
  ) {
    reasons.push('Breezy conditions are possible.');
  }

  return reasons;
}

function formatYmdParts(
  iso: string,
  options: Intl.DateTimeFormatOptions
): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  const utcNoonEt = new Date(Date.UTC(year, month - 1, day, 16, 0, 0));
  return utcNoonEt.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    ...options,
  });
}

export function formatCalendarDateHeading(iso: string): string {
  return formatYmdParts(iso, { weekday: 'long', month: 'long', day: 'numeric' });
}

export function formatCalendarDateSpoken(iso: string): string {
  return formatYmdParts(iso, { month: 'long', day: 'numeric' });
}

export function formatForecastUpdatedAt(updatedAt: Date | null | undefined): string {
  if (!updatedAt) return 'Forecast updated: time unavailable';
  const minutes = Math.max(0, Math.round((Date.now() - updatedAt.getTime()) / 60000));
  if (minutes < 1) return 'Forecast updated: just now';
  if (minutes === 1) return 'Forecast updated: 1 minute ago';
  if (minutes < 60) return `Forecast updated: ${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return 'Forecast updated: 1 hour ago';
  return `Forecast updated: ${hours} hours ago`;
}

export function calendarDayAccessibleLabel(input: {
  iso: string;
  past: boolean;
  booked: boolean;
  selected: boolean;
  insight?: DayInsight | null;
  boatsRemaining?: number | null;
}): string {
  const dateSpoken = formatCalendarDateSpoken(input.iso);
  if (input.past) return `${dateSpoken}: past date, unavailable`;
  if (input.booked) return `${dateSpoken}: booked, unavailable`;

  const details: string[] = [];
  if (input.insight) {
    details.push(calendarConditionSentence(input.insight.weather).toLowerCase());
    const outlook = calendarOutlookLevel(input.insight.weather);
    details.push(CALENDAR_OUTLOOK_LABELS[outlook].toLowerCase());
    if (outlook !== 'favorable') {
      details.push(...calendarOutlookReasons(input.insight.weather));
    }
    if (input.insight.launch.hasLaunch) {
      details.push(input.insight.launch.nightLaunch ? 'night launch scheduled' : 'launch scheduled');
    }
  } else {
    details.push(CALENDAR_OUTLOOK_LABELS.unavailable.toLowerCase());
  }

  if (input.boatsRemaining === 1) details.push('1 boat left');
  if (input.selected) details.push('selected');
  return `${dateSpoken}: ${details.join(', ')}`;
}

export type CalendarDayPresentation = {
  kind: CalendarWeatherKind | null;
  outlook: CalendarOutlookLevel;
  outlookLabel: string;
  badgeLabel: string;
  mobileBadgeLabel: string;
  conditionShort: string;
  conditionSentence: string;
  reasons: string[];
  showWarningCopy: boolean;
  accessibleLabel: string;
};

export function presentCalendarDay(input: {
  iso: string;
  past: boolean;
  booked: boolean;
  selected: boolean;
  insight?: DayInsight | null;
  boatsRemaining?: number | null;
}): CalendarDayPresentation {
  const insight = input.insight ?? null;
  const outlook = insight ? calendarOutlookLevel(insight.weather) : 'unavailable';
  const reasons = insight && outlook !== 'favorable' ? calendarOutlookReasons(insight.weather) : [];
  const showWarningCopy = outlook === 'monitor' || outlook === 'concern';

  return {
    kind: insight ? calendarWeatherKind(insight.weather) : null,
    outlook,
    outlookLabel: CALENDAR_OUTLOOK_LABELS[outlook],
    badgeLabel: CALENDAR_OUTLOOK_BADGE[outlook],
    mobileBadgeLabel: CALENDAR_OUTLOOK_MOBILE_BADGE[outlook],
    conditionShort: insight ? calendarConditionShort(insight.weather) : '',
    conditionSentence: insight ? calendarConditionSentence(insight.weather) : CALENDAR_OUTLOOK_LABELS.unavailable,
    reasons: showWarningCopy && reasons.length === 0
      ? ['Conditions may change. Details are listed below.']
      : reasons,
    showWarningCopy,
    accessibleLabel: calendarDayAccessibleLabel(input),
  };
}
