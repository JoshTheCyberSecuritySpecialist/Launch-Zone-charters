export type CharterWeatherLocationId = 'titusville' | 'daytona';

export type CharterWeatherOutlookLevel = 'favorable' | 'monitor' | 'concern' | 'unavailable';

export type CharterWeatherHour = {
  time: string;
  timeLabel: string;
  condition: string | null;
  temperatureF: number | null;
  feelsLikeF: number | null;
  precipChancePct: number | null;
  precipIn: number | null;
  windMph: number | null;
  gustMph: number | null;
  windDirection: string | null;
  visibilityMi: number | null;
  cloudCoverPct: number | null;
  humidityPct: number | null;
  waveHeightFt: number | null;
  waterTempF: number | null;
};

export type CharterWeatherAlert = {
  event: string;
  headline: string;
  description: string;
  severity: string;
  areaDesc?: string;
  effective?: string | null;
  expires?: string | null;
  officialUrl?: string | null;
};

export type CharterWeatherOk = {
  success: true;
  location: {
    id: CharterWeatherLocationId;
    name: string;
    label: string;
    timeZone: string;
  };
  requestedWindow: {
    start: string;
    end: string;
    date: string;
    startTime: string;
    durationMinutes: number;
    crossesMidnight: boolean;
    label: string;
  };
  hourly: CharterWeatherHour[];
  window: {
    condition: string | null;
    temperatureF: number | null;
    feelsLikeF: number | null;
    precipChancePct: number | null;
    precipIn: number | null;
    windMph: number | null;
    gustMph: number | null;
    windDirection: string | null;
    visibilityMi: number | null;
    cloudCoverPct: number | null;
    humidityPct: number | null;
    waveHeightFt: number | null;
    waterTempF: number | null;
  };
  alerts: CharterWeatherAlert[];
  outlook: {
    level: CharterWeatherOutlookLevel;
    label: string;
    reasons: string[];
  };
  sources: Array<{ name: string; usedFor: string }>;
  updatedAt: string;
  stale?: boolean;
  cached?: boolean;
  warnings?: string[];
};

export type CharterWeatherFail = {
  success: false;
  error: string;
  outlook?: {
    level: CharterWeatherOutlookLevel;
    label: string;
    reasons: string[];
  };
};

export type CharterWeatherResponse = CharterWeatherOk | CharterWeatherFail;

export function outlookTone(level: CharterWeatherOutlookLevel | undefined): 'success' | 'warning' | 'danger' | 'neutral' {
  if (level === 'favorable') return 'success';
  if (level === 'monitor') return 'warning';
  if (level === 'concern') return 'danger';
  return 'neutral';
}
