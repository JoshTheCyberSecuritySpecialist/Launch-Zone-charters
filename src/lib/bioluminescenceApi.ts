import { env } from '../config/env.js';
import { fetchWithRetry } from './fetchWithRetry';

export type GlowStatus = 'perfect' | 'good' | 'poor' | 'unknown';

export type GlowRatingLabel = 'HIGH' | 'MEDIUM' | 'LOW' | 'High' | 'Moderate' | 'Low';

export interface GlowReasonLine {
  kind: 'good' | 'bad' | 'warn' | 'info';
  text: string;
}

/** Normalized view model for GET /api/bioluminescence when status === OK */
export interface GlowCheckResponse {
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
  inDinoSeason?: boolean;
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

export type GlowFetchError = null | 'live' | 'format';

export type FetchBioluminescenceResult =
  | { ok: true; data: GlowCheckResponse }
  | { ok: false; error: GlowFetchError; message?: string };

export function mapApiOkToGlowResult(payload: GlowApiOk): GlowCheckResponse {
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
    inDinoSeason: d.inDinoSeason,
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

export function normalizeRating(r: string | undefined): 'HIGH' | 'MEDIUM' | 'LOW' | undefined {
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

export function glowStatusLabel(status: GlowStatus): string {
  if (status === 'perfect') return 'Strong glow potential';
  if (status === 'good') return 'Mixed conditions';
  if (status === 'poor') return 'Limited glow potential';
  return 'Unknown';
}

/** Fetches live bioluminescence snapshot from GET /api/bioluminescence. Never throws. */
export async function fetchBioluminescence(): Promise<FetchBioluminescenceResult> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    return { ok: false, error: 'live', message: 'Live glow data is unavailable (API URL not configured).' };
  }

  try {
    const res = await fetchWithRetry(`${env.apiUrl}/api/bioluminescence`, { method: 'GET' });

    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      return { ok: false, error: 'format' };
    }

    const body = raw as GlowApiOk | GlowApiUnavailable | Record<string, unknown>;

    if (body && typeof body === 'object' && 'status' in body && body.status === 'UNAVAILABLE') {
      const msg =
        typeof (body as GlowApiUnavailable).message === 'string'
          ? (body as GlowApiUnavailable).message
          : 'Live environmental data unavailable';
      return { ok: false, error: 'live', message: msg };
    }

    if (!res.ok) {
      return { ok: false, error: 'live' };
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
        return { ok: false, error: 'format' };
      }
      return { ok: true, data: mapApiOkToGlowResult(ok) };
    }

    return { ok: false, error: 'format' };
  } catch {
    return { ok: false, error: 'live' };
  }
}
