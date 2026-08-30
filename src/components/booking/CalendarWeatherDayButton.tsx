import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSun, Sun, Wind } from 'lucide-react';
import type { DayInsight } from '../../lib/calendarInsights';
import {
  presentCalendarDay,
  type CalendarOutlookLevel,
  type CalendarWeatherKind,
} from '../../lib/calendarWeatherPresentation';

const WEATHER_ICONS: Record<
  CalendarWeatherKind,
  { Icon: typeof Sun; label: string }
> = {
  clear: { Icon: Sun, label: 'Clear' },
  partly_cloudy: { Icon: CloudSun, label: 'Partly cloudy' },
  cloudy: { Icon: Cloud, label: 'Cloudy' },
  fog: { Icon: CloudFog, label: 'Fog' },
  rain: { Icon: CloudRain, label: 'Rain possible' },
  storm: { Icon: CloudLightning, label: 'Storm concern' },
  windy: { Icon: Wind, label: 'Windy' },
};

function outlookBadgeClass(level: CalendarOutlookLevel): string {
  if (level === 'favorable') {
    return 'border border-solid border-emerald-300/70 bg-emerald-950/40 text-emerald-50';
  }
  if (level === 'monitor') {
    return 'border-2 border-dashed border-amber-200/80 bg-amber-950/35 text-amber-50';
  }
  if (level === 'concern') {
    return 'border-2 border-double border-rose-200/80 bg-rose-950/40 text-rose-50';
  }
  return 'border-2 border-dotted border-slate-400/70 bg-slate-900/50 text-slate-200';
}

function daySurfaceClass(input: {
  past: boolean;
  booked: boolean;
  selected: boolean;
  outlook: CalendarOutlookLevel;
}): string {
  if (input.past || input.booked) {
    return 'cursor-not-allowed border border-transparent bg-slate-950/30 text-slate-500';
  }

  let ring =
    input.outlook === 'favorable'
      ? 'border border-solid border-emerald-500/40 bg-emerald-950/20 text-emerald-50'
      : input.outlook === 'monitor'
        ? 'border-2 border-dashed border-amber-400/50 bg-amber-950/25 text-amber-50'
        : input.outlook === 'concern'
          ? 'border-2 border-double border-rose-400/55 bg-rose-950/25 text-rose-50'
          : 'border-2 border-dotted border-white/20 bg-slate-900/60 text-slate-200';

  if (input.selected) {
    ring += ' ring-2 ring-[var(--lz-cta)] ring-offset-2 ring-offset-[#050a14]';
  }
  return ring;
}

type Props = {
  iso: string;
  label: number;
  selected: boolean;
  past: boolean;
  booked: boolean;
  insight?: DayInsight;
  boatsRemaining?: number | null;
  onSelect: () => void;
};

export default function CalendarWeatherDayButton({
  iso,
  label,
  selected,
  past,
  booked,
  insight,
  boatsRemaining,
  onSelect,
}: Props) {
  const presentation = presentCalendarDay({
    iso,
    past,
    booked,
    selected,
    insight,
    boatsRemaining,
  });
  const weatherIcon = presentation.kind ? WEATHER_ICONS[presentation.kind] : null;
  const showWeather = !past && !booked && Boolean(insight) && weatherIcon;

  return (
    <button
      type="button"
      disabled={past || booked}
      aria-pressed={selected && !past && !booked}
      aria-label={presentation.accessibleLabel}
      onClick={() => {
        if (past || booked) return;
        onSelect();
      }}
      className={`flex min-h-11 w-full flex-col items-center justify-start gap-0.5 overflow-visible rounded-lg px-0.5 py-1 text-xs font-semibold leading-none transition sm:min-h-[4.75rem] ${daySurfaceClass(
        {
          past,
          booked,
          selected,
          outlook: presentation.outlook,
        }
      )}`}
    >
      <span className="leading-none">{label}</span>
      {showWeather && weatherIcon ? (
        <>
          <weatherIcon.Icon
            className="h-4 w-4 shrink-0 leading-none min-[400px]:h-5 min-[400px]:w-5 sm:h-6 sm:w-6"
            strokeWidth={2.25}
            aria-hidden
          />
          <span className="hidden max-w-full px-0.5 text-center text-[10px] font-medium leading-tight sm:block">
            {presentation.conditionShort}
          </span>
          <span
            className={`mt-0.5 h-1.5 w-4 rounded-sm min-[400px]:hidden ${outlookBadgeClass(
              presentation.outlook
            )}`}
            aria-hidden
          />
          <span
            className={`hidden max-w-full whitespace-nowrap rounded px-0.5 py-0.5 text-center text-[8px] font-semibold leading-none min-[400px]:inline sm:px-1 sm:text-[10px] ${outlookBadgeClass(
              presentation.outlook
            )}`}
          >
            <span className="sm:hidden">{presentation.mobileBadgeLabel}</span>
            <span className="hidden sm:inline">{presentation.badgeLabel}</span>
          </span>
        </>
      ) : null}
      {!past && booked ? (
        <span className="text-[10px] font-medium leading-tight text-slate-400">Booked</span>
      ) : null}
    </button>
  );
}
