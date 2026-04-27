type LaunchWindowLike = {
  window_start?: string | null;
  net?: string | null;
};

function launchWindowIso(launch: LaunchWindowLike): string | null {
  return launch.window_start || launch.net || null;
}

/**
 * Customer-facing booking guidance window derived from launch timing.
 * Presentation-only helper; does not alter launch API payloads.
 */
export function getBookingWindow(launch: LaunchWindowLike): string {
  const iso = launchWindowIso(launch);
  if (!iso) return 'Flexible Launch Window';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Flexible Launch Window';

  const hour = date.getHours();

  if (hour >= 20 || hour <= 5) {
    return 'Night Launch Window (Best Viewing)';
  }
  if (hour >= 17 && hour < 20) {
    return 'Sunset Launch Window';
  }
  if (hour >= 5 && hour <= 8) {
    return 'Early Morning Launch Window';
  }
  return 'Daytime Launch Window';
}

