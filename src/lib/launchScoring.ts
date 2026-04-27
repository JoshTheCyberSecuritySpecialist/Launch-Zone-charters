type LaunchStatusLike = { name?: string } | string | null | undefined;

type LaunchLike = {
  id?: string | number;
  name?: string;
  net?: string | null;
  window_start?: string | null;
  status?: LaunchStatusLike;
  launch_service_provider?: { name?: string } | null;
};

export type LaunchScoreConditions = {
  cloudCover?: number | null;
  /** Expected sea state from existing condition signal mapping. */
  water?: 'calm' | 'moderate' | 'rough' | null;
};

function launchIso(launch: LaunchLike): string | null {
  return launch.window_start || launch.net || null;
}

function statusName(status: LaunchStatusLike): string {
  if (typeof status === 'string') return status;
  if (status && typeof status === 'object' && typeof status.name === 'string') return status.name;
  return '';
}

/**
 * Non-destructive scoring overlay for highlighting one "best" upcoming launch.
 * Existing fetch, filtering, and ordering remain unchanged.
 */
export function scoreLaunch(launch: LaunchLike, conditions?: LaunchScoreConditions): number {
  let score = 0;
  const iso = launchIso(launch);
  const when = iso ? new Date(iso) : null;
  const now = new Date();

  // Time of day
  const hour = when && !Number.isNaN(when.getTime()) ? when.getHours() : null;
  if (hour != null) {
    if (hour >= 20 || hour <= 5) score += 5;
    else if (hour >= 17 || hour <= 7) score += 4;
    else score += 2;
  }

  // Weather
  if (typeof conditions?.cloudCover === 'number') {
    if (conditions.cloudCover < 30) score += 4;
    else if (conditions.cloudCover < 60) score += 2;
    else score -= 3;
  }

  // Water
  if (conditions?.water === 'calm') score += 3;
  else if (conditions?.water === 'moderate') score += 1;
  else if (conditions?.water === 'rough') score -= 2;

  // Proximity
  if (when && !Number.isNaN(when.getTime())) {
    const daysAway = (when.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysAway <= 2) score += 4;
    else if (daysAway <= 5) score += 2;
    else score += 1;
  }

  // Status
  const st = statusName(launch.status).toLowerCase();
  if (st === 'go') score += 5;
  else if (st === 'tbd') score += 2;
  else if (st) score -= 3;

  // Bonus
  const provider = launch.launch_service_provider?.name || '';
  if (provider.includes('SpaceX')) score += 2;

  return score;
}

export function scoreLaunches<T extends LaunchLike>(launches: T[], conditions?: LaunchScoreConditions) {
  return launches.map((launch) => ({
    ...launch,
    score: scoreLaunch(launch, conditions),
  }));
}

export function pickBestLaunchByScore<T extends { score: number }>(scoredLaunches: T[]): T | null {
  if (!scoredLaunches.length) return null;
  return [...scoredLaunches].sort((a, b) => b.score - a.score)[0] ?? null;
}

