import SunCalc from 'suncalc';

const VIEWER_LAT = 28.6129;
const VIEWER_LNG = -80.8076;

/** Solar + local-time classification for Space Coast listing copy (not a range classification). */
export type LaunchTimeCategory = 'night' | 'twilight' | 'day' | 'unknown';

function easternHour(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value;
  return h != null ? parseInt(h, 10) : 12;
}

/**
 * Night: dark sky or evening civil twilight (stronger flame contrast than midday).
 * Twilight: early-morning civil twilight near sunrise (softer light, dawn glow).
 * Day: sun clearly above the horizon for that instant.
 */
export function getLaunchTimeCategory(iso: string | null | undefined): LaunchTimeCategory {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  try {
    const { altitude } = SunCalc.getPosition(d, VIEWER_LAT, VIEWER_LNG);
    const deg = altitude * (180 / Math.PI);
    const hour = easternHour(d);

    if (deg > 6) {
      return 'day';
    }

    if (deg >= -6 && deg <= 6) {
      if (hour >= 4 && hour < 11) {
        return 'twilight';
      }
      return 'night';
    }

    return 'night';
  } catch {
    return 'unknown';
  }
}

export function getLaunchTimeCategoryLabel(c: LaunchTimeCategory): string {
  switch (c) {
    case 'night':
      return 'Night launch';
    case 'twilight':
      return 'Early morning (twilight)';
    case 'day':
      return 'Day launch';
    default:
      return '';
  }
}

/** Premium card highlight — dark-sky / evening viewing (not twilight dawn). */
export function isNightViewingHighlight(c: LaunchTimeCategory): boolean {
  return c === 'night';
}

type Launchish = {
  net?: string | null;
  window_start?: string | null;
};

/**
 * Picks one index for “best to book”: prefers sooner windows and night/evening viewing,
 * then twilight morning, then day. Falls back to 0.
 */
export function pickBestLaunchIndex(launches: Launchish[]): number {
  if (!launches.length) return -1;
  const now = Date.now();

  let bestI = 0;
  let bestScore = -Number.MAX_VALUE;

  launches.forEach((L, i) => {
    const iso = L.net || L.window_start;
    if (!iso) return;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return;

    const hoursOut = Math.max(0, (t - now) / 3600000);
    const cat = getLaunchTimeCategory(iso);

    let score = 0;
    score -= hoursOut * 8;
    if (cat === 'night') score += 220;
    else if (cat === 'twilight') score += 110;
    else if (cat === 'day') score += 45;

    if (score > bestScore) {
      bestScore = score;
      bestI = i;
    }
  });

  return bestI;
}
