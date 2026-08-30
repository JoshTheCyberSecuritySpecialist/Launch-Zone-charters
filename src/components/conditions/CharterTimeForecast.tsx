import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Clock, MapPin } from 'lucide-react';
import { DateTime } from 'luxon';
import { env } from '../../config/env';
import { BUSINESS_TZ } from '../../lib/bookingDateTimeRange';
import { formatCharterDurationLabel } from '../../lib/charterDuration';
import type {
  CharterWeatherHour,
  CharterWeatherLocationId,
  CharterWeatherResponse,
} from '../../lib/charterWeather';
import { outlookTone } from '../../lib/charterWeather';

type ExperienceKey = 'explore' | 'bio' | 'sunset' | 'rocket';

type AvailabilitySlot = {
  start: string;
  startHHMM: string;
  label: string;
  available?: boolean;
};

const EXPERIENCES: ReadonlyArray<{ key: ExperienceKey; label: string; charterType: string | null }> = [
  { key: 'explore', label: 'Just exploring', charterType: null },
  { key: 'bio', label: 'Bioluminescence', charterType: 'bio' },
  { key: 'sunset', label: 'Sunset', charterType: 'sunset' },
  { key: 'rocket', label: 'Rocket launch', charterType: 'rocket' },
];

const LOCATIONS: ReadonlyArray<{ id: CharterWeatherLocationId; label: string }> = [
  { id: 'titusville', label: 'Titusville' },
  { id: 'daytona', label: 'Port Orange' },
];

const DEBOUNCE_MS = 350;

function todayYmd(): string {
  return DateTime.now().setZone(BUSINESS_TZ).toFormat('yyyy-MM-dd');
}

function parseLocation(value: string | null): CharterWeatherLocationId {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'daytona' || raw === 'port_orange' || raw === 'port orange') return 'daytona';
  return 'titusville';
}

function parseExperience(value: string | null): ExperienceKey {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'bio' || raw === 'night_bio') return 'bio';
  if (raw === 'sunset' || raw === 'sunset_cruise') return 'sunset';
  if (raw === 'rocket' || raw === 'rocket_launch') return 'rocket';
  return 'explore';
}

function parseClock(value: string | null): string {
  const raw = String(value || '').trim();
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  return '';
}

function formatUpdated(iso: string): string {
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return 'just now';
  const mins = Math.max(0, Math.round(DateTime.now().diff(dt, 'minutes').minutes));
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  return `${mins} minutes ago`;
}

function formatAlertTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dt = DateTime.fromISO(iso).setZone(BUSINESS_TZ);
  return dt.isValid ? dt.toFormat('ccc, LLL d · h:mm a') : '—';
}

function formatNum(value: number | null | undefined, suffix: string, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}${suffix}`;
}

export default function CharterTimeForecast() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [locationId, setLocationId] = useState<CharterWeatherLocationId>(() =>
    parseLocation(searchParams.get('location'))
  );
  const [experience, setExperience] = useState<ExperienceKey>(() =>
    parseExperience(searchParams.get('charterType') || searchParams.get('experience'))
  );
  const [date, setDate] = useState(() => {
    const d = searchParams.get('date');
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayYmd();
  });
  const [startTime, setStartTime] = useState(() => parseClock(searchParams.get('time')) || '20:00');
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [forecast, setForecast] = useState<CharterWeatherResponse | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [peekHour, setPeekHour] = useState<CharterWeatherHour | null>(null);

  const durationMinutes = 60;
  const experienceMeta = EXPERIENCES.find((item) => item.key === experience) || EXPERIENCES[0];

  useEffect(() => {
    if (experience === 'bio' || experience === 'rocket') {
      setLocationId('titusville');
    }
  }, [experience]);

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('location', locationId);
        next.set('date', date);
        next.set('time', startTime);
        if (experienceMeta.charterType) next.set('charterType', experienceMeta.charterType);
        else next.delete('charterType');
        return next;
      },
      { replace: true }
    );
  }, [date, experience, experienceMeta.charterType, locationId, setSearchParams, startTime]);

  useEffect(() => {
    if (experience === 'explore' || !env.apiUrlConfigured || !env.apiUrl || !date) {
      setSlots([]);
      setSlotsError(null);
      return;
    }
    const ac = new AbortController();
    setSlotsLoading(true);
    setSlotsError(null);
    const charterType = experienceMeta.charterType || 'bio';
    const fetchDay = (day: string) => {
      const q = new URLSearchParams({ date: day, charterType });
      return fetch(`${env.apiUrl}/api/availability/charter/times?${q}`, { signal: ac.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('times'))))
        .then((data: { slots?: AvailabilitySlot[] }) => (Array.isArray(data.slots) ? data.slots : []));
    };
    const nextDay = DateTime.fromISO(date, { zone: BUSINESS_TZ }).plus({ days: 1 }).toFormat('yyyy-MM-dd');
    const load =
      experience === 'bio' ? Promise.all([fetchDay(date), fetchDay(nextDay)]) : fetchDay(date).then((daySlots) => [daySlots, [] as AvailabilitySlot[]]);
    load
      .then(([todaySlots, tomorrowSlots]) => {
        const nextSlots = [...todaySlots];
        for (const slot of tomorrowSlots) {
          const hour = Number(String(slot.startHHMM || '').slice(0, 2));
          if (Number.isFinite(hour) && hour >= 0 && hour <= 4) nextSlots.push(slot);
        }
        setSlots(nextSlots);
        if (nextSlots.length) {
          setStartTime((current) =>
            nextSlots.some((slot) => slot.startHHMM === current) ? current : nextSlots[0].startHHMM
          );
        }
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setSlots([]);
        setSlotsError('Live departure times could not be loaded. You can still enter a time to view weather.');
      })
      .finally(() => setSlotsLoading(false));
    return () => ac.abort();
  }, [date, experience, experienceMeta.charterType]);

  const loadForecast = useCallback(
    async (signal?: AbortSignal) => {
      if (!env.apiUrlConfigured || !env.apiUrl || !date || !startTime) {
        setForecastError('Weather service is not configured.');
        return;
      }
      setForecastLoading(true);
      setForecastError(null);
      const q = new URLSearchParams({
        location: locationId,
        date,
        startTime,
        durationMinutes: String(durationMinutes),
      });
      try {
        const res = await fetch(`${env.apiUrl}/api/marine-conditions?${q}`, { signal });
        const json = (await res.json()) as CharterWeatherResponse;
        if (!res.ok || !json || json.success !== true) {
          setForecast(json?.success === false ? json : null);
          setForecastError((json && 'error' in json && json.error) || 'Forecast not yet available.');
          return;
        }
        setForecast(json);
        setPeekHour(null);
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setForecast(null);
        setForecastError('Forecast is temporarily unavailable. Try again shortly.');
      } finally {
        setForecastLoading(false);
      }
    },
    [date, durationMinutes, locationId, startTime]
  );

  useEffect(() => {
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      void loadForecast(ac.signal);
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [loadForecast]);

  const ok = forecast && forecast.success ? forecast : null;
  const detail = peekHour || ok?.window || null;
  const selectedStillOffered = experience === 'explore' || slots.length === 0 || slots.some((slot) => slot.startHHMM === startTime);

  const bookingHref = useMemo(() => {
    const q = new URLSearchParams();
    if (experienceMeta.charterType) {
      q.set('bookingMode', 'charter');
      q.set('charterType', experienceMeta.charterType);
    }
    q.set('date', date);
    q.set('time', startTime);
    if (experience === 'explore') q.set('location', locationId);
    return `/booking?${q.toString()}`;
  }, [date, experience, experienceMeta.charterType, locationId, startTime]);

  const outlookClass =
    outlookTone(ok?.outlook.level) === 'success'
      ? 'border-emerald-300/40 bg-emerald-950/30 text-emerald-100'
      : outlookTone(ok?.outlook.level) === 'warning'
        ? 'border-amber-300/40 bg-amber-950/30 text-amber-100'
        : outlookTone(ok?.outlook.level) === 'danger'
          ? 'border-rose-300/40 bg-rose-950/30 text-rose-100'
          : 'border-white/15 bg-slate-950/40 text-white';

  return (
    <section
      className="mb-12 rounded-2xl border border-cyan-300/20 bg-[rgba(10,20,30,0.72)] p-5 text-white shadow-lg backdrop-blur-[10px] sm:p-8"
      aria-labelledby="charter-time-forecast-heading"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="charter-time-forecast-heading" className="text-2xl font-bold text-white">
            Conditions for your charter time
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-white/75 sm:text-base">
            Check expected conditions for a date and start time. Viewing weather does not reserve that time.
          </p>
        </div>
        {ok ? (
          <p className="text-xs font-medium uppercase tracking-wide text-cyan-200/80">
            Last updated {formatUpdated(ok.updatedAt)}
            {ok.stale ? ' · stale' : ''}
          </p>
        ) : null}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2" role="group" aria-label="Charter location">
        {LOCATIONS.map((loc) => (
          <button
            key={loc.id}
            type="button"
            onClick={() => setLocationId(loc.id)}
            className={`min-h-[48px] rounded-xl border px-4 py-3 text-left text-base font-semibold ${
              locationId === loc.id
                ? 'border-cyan-300 bg-cyan-400/15 text-white'
                : 'border-white/15 bg-slate-950/40 text-white/80'
            }`}
            aria-pressed={locationId === loc.id}
          >
            <span className="inline-flex items-center gap-2">
              <MapPin className="h-4 w-4" aria-hidden />
              {loc.label}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="block text-sm text-white/80">
          Charter date
          <input
            type="date"
            value={date}
            min={todayYmd()}
            onChange={(event) => setDate(event.target.value)}
            className="mt-2 w-full rounded-lg border border-white/15 bg-slate-950/60 px-3 py-3 text-white"
          />
        </label>
        <label className="block text-sm text-white/80">
          Experience
          <select
            value={experience}
            onChange={(event) => setExperience(event.target.value as ExperienceKey)}
            className="mt-2 w-full rounded-lg border border-white/15 bg-slate-950/60 px-3 py-3 text-white"
          >
            {EXPERIENCES.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4">
        <p className="text-sm text-white/80">
          Start time · {formatCharterDurationLabel(durationMinutes)}
        </p>
        {experience !== 'explore' && slotsLoading ? (
          <p className="mt-2 text-sm text-white/60">Loading available departure times…</p>
        ) : experience !== 'explore' && slots.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Available start times">
            {slots.map((slot) => (
              <button
                key={slot.start || slot.startHHMM}
                type="button"
                onClick={() => setStartTime(slot.startHHMM)}
                className={`min-h-[44px] rounded-lg border px-3 py-2 text-sm font-semibold ${
                  startTime === slot.startHHMM
                    ? 'border-cyan-300 bg-cyan-400/15 text-white'
                    : 'border-white/15 bg-slate-950/40 text-white/80'
                }`}
                aria-pressed={startTime === slot.startHHMM}
              >
                {slot.label || slot.startHHMM}
              </button>
            ))}
          </div>
        ) : (
          <label className="mt-2 block">
            <span className="sr-only">Start time</span>
            <input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              className="w-full rounded-lg border border-white/15 bg-slate-950/60 px-3 py-3 text-white sm:max-w-xs"
            />
          </label>
        )}
        {slotsError ? <p className="mt-2 text-sm text-amber-100">{slotsError}</p> : null}
        {!selectedStillOffered ? (
          <p className="mt-2 text-sm text-amber-100">
            That departure may no longer be available to book. Weather for this time is still shown below.
          </p>
        ) : null}
        <p className="mt-2 text-xs text-white/55">
          Times use Eastern Time. This page does not hold a reservation.
        </p>
      </div>

      <div className="mt-6">
        <button
          type="button"
          onClick={() => void loadForecast()}
          className="min-h-[44px] rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/5"
        >
          Refresh forecast
        </button>
      </div>

      {forecastLoading ? (
        <div className="mt-6 h-40 rounded-xl border border-white/10 bg-slate-950/50 lz-skeleton-pulse" aria-busy="true">
          <span className="sr-only">Loading charter forecast</span>
        </div>
      ) : forecastError && !ok ? (
        <p className="mt-6 rounded-xl border border-amber-300/30 bg-amber-950/30 p-4 text-amber-50" role="status">
          {forecastError}
        </p>
      ) : ok ? (
        <div className="mt-6 space-y-5">
          <div className={`rounded-xl border p-4 ${outlookClass}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-white/70">{ok.requestedWindow.label}</p>
            <p className="mt-1 text-xl font-bold">{ok.outlook.label}</p>
            {ok.outlook.reasons.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {ok.outlook.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-white/80">No weather concerns stand out in this forecast window.</p>
            )}
          </div>

          {detail ? (
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
                <dt className="text-white/55">Condition</dt>
                <dd className="mt-1 font-semibold">{detail.condition || ok.window.condition || '—'}</dd>
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
                <dt className="text-white/55">Temperature</dt>
                <dd className="mt-1 font-semibold">
                  {formatNum(detail.temperatureF, '°F')}
                  {detail.feelsLikeF != null ? ` · feels ${formatNum(detail.feelsLikeF, '°F')}` : ''}
                </dd>
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
                <dt className="text-white/55">Rain chance</dt>
                <dd className="mt-1 font-semibold">{formatNum(detail.precipChancePct, '%')}</dd>
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
                <dt className="text-white/55">Wind / gusts</dt>
                <dd className="mt-1 font-semibold">
                  {formatNum(detail.windMph, ' mph', 1)}
                  {detail.gustMph != null ? ` / ${formatNum(detail.gustMph, ' mph', 1)}` : ''}
                  {detail.windDirection ? ` ${detail.windDirection}` : ''}
                </dd>
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
                <dt className="text-white/55">Visibility</dt>
                <dd className="mt-1 font-semibold">{formatNum(detail.visibilityMi, ' mi', 1)}</dd>
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
                <dt className="text-white/55">Clouds / humidity</dt>
                <dd className="mt-1 font-semibold">
                  {formatNum(detail.cloudCoverPct, '%')} / {formatNum(detail.humidityPct, '%')}
                </dd>
              </div>
              {detail.waveHeightFt != null ? (
                <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
                  <dt className="text-white/55">Waves</dt>
                  <dd className="mt-1 font-semibold">{formatNum(detail.waveHeightFt, ' ft', 1)}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          {ok.hourly.length > 0 ? (
            <div>
              <p className="text-sm font-semibold text-white">Hourly during this charter</p>
              <p className="text-xs text-white/55">Select an hour to inspect details. This does not change your booking time.</p>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-2" role="list">
                {ok.hourly.map((hour) => (
                  <button
                    key={hour.time}
                    type="button"
                    role="listitem"
                    onClick={() => setPeekHour(hour)}
                    className={`min-w-[7.5rem] rounded-lg border px-3 py-2 text-left text-sm ${
                      peekHour?.time === hour.time
                        ? 'border-cyan-300 bg-cyan-400/15'
                        : 'border-white/10 bg-slate-950/40'
                    }`}
                  >
                    <span className="block font-semibold">{hour.timeLabel}</span>
                    <span className="block text-white/70">{hour.condition || '—'}</span>
                    <span className="block text-white/70">{formatNum(hour.precipChancePct, '% rain')}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-white/70">Forecast not yet available for every hour in this window.</p>
          )}

          {ok.alerts.length > 0 ? (
            <div>
              <h3 className="text-lg font-bold">Active National Weather Service alerts</h3>
              <ul className="mt-3 space-y-3">
                {ok.alerts.map((alert) => (
                  <li key={`${alert.event}-${alert.effective}`} className="rounded-lg border border-amber-300/40 bg-amber-950/30 p-4">
                    <p className="font-bold text-amber-50">{alert.event}</p>
                    <p className="mt-1 text-xs uppercase tracking-wide text-amber-100/80">{alert.severity || 'Advisory'}</p>
                    <p className="mt-2 text-sm text-amber-50/90">
                      Effective {formatAlertTime(alert.effective)} · Expires {formatAlertTime(alert.expires)}
                    </p>
                    {alert.officialUrl ? (
                      <a
                        href={alert.officialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block text-sm font-semibold text-cyan-200 underline"
                      >
                        Official NWS alert
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {ok.warnings && ok.warnings.length > 0 ? (
            <p className="text-xs text-white/55">{ok.warnings.join(' ')}</p>
          ) : null}
        </div>
      ) : null}

      <p className="mt-6 rounded-xl border border-white/15 bg-slate-950/50 p-4 text-sm text-white/85">
        Forecasts can change quickly. The captain makes the final operating decision based on conditions at the
        time of departure. Do not use this page as your only source of emergency weather information.
      </p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Link
          to={bookingHref}
          className="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-amber-600 px-6 py-3 text-center text-sm font-bold text-white hover:bg-amber-700"
        >
          Check Times &amp; Book
        </Link>
        <p className="inline-flex items-center gap-2 text-xs text-white/55">
          <Clock className="h-4 w-4" aria-hidden />
          Selected time is not reserved until booking confirms availability.
        </p>
      </div>
    </section>
  );
}
