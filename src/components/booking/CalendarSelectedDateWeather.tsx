import type { Ref } from 'react';
import type { DayInsight } from '../../lib/calendarInsights';
import {
  CALENDAR_OUTLOOK_LABELS,
  calendarOutlookLevel,
  formatCalendarDateHeading,
  formatForecastUpdatedAt,
  presentCalendarDay,
} from '../../lib/calendarWeatherPresentation';

type Props = {
  iso: string | null;
  insight?: DayInsight | null;
  booked: boolean;
  isTopPick: boolean;
  boatsRemaining?: number | null;
  updatedAt?: Date | null;
  panelRef?: Ref<HTMLDivElement>;
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/55 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function outlookPanelClass(level: ReturnType<typeof calendarOutlookLevel>): string {
  if (level === 'favorable') return 'border-solid border-emerald-400/40 bg-emerald-950/20';
  if (level === 'monitor') return 'border-dashed border-amber-300/50 bg-amber-950/20';
  if (level === 'concern') return 'border-double border-rose-300/50 bg-rose-950/25';
  return 'border-dotted border-white/20 bg-slate-950/40';
}

export default function CalendarSelectedDateWeather({
  iso,
  insight,
  booked,
  isTopPick,
  boatsRemaining,
  updatedAt,
  panelRef,
}: Props) {
  if (!iso) {
    return (
      <div
        ref={panelRef}
        className="mt-4 rounded-xl border border-dashed border-white/15 bg-slate-950/40 px-4 py-3"
      >
        <p className="text-sm text-slate-400">Tap a date to see the full forecast for that day.</p>
      </div>
    );
  }

  const presentation = presentCalendarDay({
    iso,
    past: false,
    booked,
    selected: true,
    insight,
    boatsRemaining,
  });
  const weather = insight?.weather;
  const outlook = presentation.outlook;
  const rain =
    weather && Number.isFinite(weather.rainProbability) ? `${Math.round(weather.rainProbability)}%` : null;
  const wind = weather && Number.isFinite(weather.windSpeed) ? `${Math.round(weather.windSpeed)} mph` : null;
  const gusts =
    weather?.gustMph != null && Number.isFinite(weather.gustMph)
      ? `${Math.round(weather.gustMph)} mph`
      : null;
  const temperature =
    weather?.temperatureF != null && Number.isFinite(weather.temperatureF)
      ? `${Math.round(weather.temperatureF)}°F`
      : null;

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className={`mt-4 scroll-mt-24 rounded-xl border px-4 py-4 ${outlookPanelClass(outlook)}`}
    >
      <p className="text-base font-bold text-white">{formatCalendarDateHeading(iso)}</p>
      {isTopPick && outlook === 'favorable' ? (
        <p className="mt-1 text-sm font-semibold text-emerald-100">Best conditions</p>
      ) : (
        <p className="mt-1 text-sm font-semibold text-slate-100">{presentation.outlookLabel}</p>
      )}
      <p className="mt-1 text-sm text-slate-200">{presentation.conditionSentence}</p>

      {presentation.showWarningCopy
        ? presentation.reasons.map((reason) => (
            <p key={reason} className="mt-2 text-sm leading-snug text-slate-100">
              {reason}
            </p>
          ))
        : null}

      {booked ? <p className="mt-2 text-sm text-slate-300">This date is booked.</p> : null}
      {boatsRemaining === 1 && !booked ? (
        <p className="mt-2 text-sm text-amber-100">1 boat left for this trip length.</p>
      ) : null}
      {insight?.launch.hasLaunch ? (
        <p className="mt-2 text-sm text-slate-200">
          {insight.launch.nightLaunch ? 'Night launch scheduled' : 'Launch scheduled'}
          {insight.launch.certainty === 'tbd'
            ? ' — time to be confirmed'
            : insight.launch.certainty === 'net'
              ? ' — no earlier than the listed window'
              : ''}
          .
        </p>
      ) : null}

      {weather ? (
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {rain ? <Stat label="Rain chance" value={rain} /> : null}
          {wind ? <Stat label="Wind" value={wind} /> : null}
          {gusts ? <Stat label="Gusts" value={gusts} /> : null}
          {temperature ? <Stat label="Temperature" value={temperature} /> : null}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-slate-400">{CALENDAR_OUTLOOK_LABELS.unavailable}.</p>
      )}

      <p className="mt-3 text-xs text-slate-400">{formatForecastUpdatedAt(updatedAt)}</p>
    </div>
  );
}
