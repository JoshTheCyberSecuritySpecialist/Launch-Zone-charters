import type { LaunchTimeCategory } from './launchTimeCategory';

export type LaunchCardLaunch = {
  name?: string;
  net?: string | null;
  window_start?: string | null;
  rocket?: {
    configuration?: {
      full_name?: string | null;
      name?: string | null;
      family?: { name?: string | null } | null;
    } | null;
  } | null;
};

export type RocketViewingHint = {
  label: string | null;
  showBoosterReturn: boolean;
  boosterLine: string | null;
};

function normalizeHay(launch: LaunchCardLaunch): string {
  const parts = [
    launch.rocket?.configuration?.full_name,
    launch.rocket?.configuration?.name,
    launch.rocket?.configuration?.family?.name,
    launch.name,
  ].filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  return parts.join(' ').toLowerCase();
}

/**
 * Infer reusable-vehicle notes from schedule fields — conservative, not a mission guarantee.
 */
export function getRocketViewingHint(launch: LaunchCardLaunch): RocketViewingHint {
  const hay = normalizeHay(launch);

  const label =
    (typeof launch.rocket?.configuration?.full_name === 'string' &&
      launch.rocket.configuration.full_name.trim()) ||
    (typeof launch.rocket?.configuration?.name === 'string' &&
      launch.rocket.configuration.name.trim()) ||
    null;

  const isFalconHeavy = /\bfalcon\s*heavy\b|\bfh\b/.test(hay);
  const isFalcon9 =
    /\bfalcon\s*9\b|\bf-9\b|\bf9\b|\bfalcon-9\b/.test(hay) ||
    (/\bfalcon\b/.test(hay) && !isFalconHeavy && !/\bfalcon\s*1\b/.test(hay));
  const isStarship = /\bstarship\b|\bsuper\s*heavy\b/.test(hay);
  const isElectron = /\belectron\b/.test(hay);

  if (isFalcon9 || isFalconHeavy) {
    const rocketName = isFalconHeavy ? 'Falcon Heavy' : 'Falcon 9';
    return {
      label: label || rocketName,
      showBoosterReturn: true,
      boosterLine: `Some ${rocketName} missions include booster recovery; trajectory, lighting, and range rules determine whether anything is visible from the lagoon — not guaranteed.`,
    };
  }

  if (isStarship) {
    return {
      label: label || 'Starship',
      showBoosterReturn: true,
      boosterLine:
        'Recovery and staging visibility depends on mission rules and trajectory; treat any description as general, not a promise for a specific date.',
    };
  }

  if (isElectron) {
    return {
      label: label || 'Electron',
      showBoosterReturn: true,
      boosterLine:
        'Recovery attempts (when present) may not be visible from this viewing area; depends on mission profile.',
    };
  }

  return {
    label,
    showBoosterReturn: false,
    boosterLine: null,
  };
}

function bestViewingLagoonLine(category: LaunchTimeCategory): string {
  if (category === 'night') {
    return 'Darker skies often help flame and exhaust stand out; reflections on the water are possible when the lagoon is calm and clouds cooperate.';
  }
  if (category === 'twilight') {
    return 'Early light and a softer sky can make the ascent easier to track than harsh midday sun — still depends on haze and trajectory.';
  }
  if (category === 'day') {
    return 'Daytime flights can show plume and climb; contrast depends on sun angle, clouds, and how high the trajectory climbs in view.';
  }
  return 'Line of sight is toward the Cape — what you see still depends on trajectory, weather, and range activity.';
}

export function getBestViewingBullets(category: LaunchTimeCategory): string[] {
  return [
    'Indian River Lagoon — Titusville waterfront area (typical charter operating area)',
    'Near Max Brewer Bridge / open lagoon with a clear horizon toward the east',
    'Roughly 10–15 miles across the water to the launch complexes — distance varies by route and conditions',
    bestViewingLagoonLine(category),
  ];
}

export function getWhatYouSeeBullets(category: LaunchTimeCategory, rocket: RocketViewingHint): string[] {
  const lines: string[] = [];

  lines.push(
    'Nothing is guaranteed: launches slip, scrub, or change trajectory; visibility from the boat depends on weather, haze, and angle.'
  );

  if (category === 'night') {
    lines.push(
      'Night and evening windows often offer stronger glow and contrast against the sky when the weather is clear.'
    );
    lines.push('Light on the water can add drama; rain and low cloud can hide most of the show.');
    lines.push('A wide horizon over the lagoon helps — you are not at the pad fence line.');
  } else if (category === 'twilight') {
    lines.push(
      'Early-morning twilight can blend a visible ascent with softer sky color — trajectory and cloud layers still matter.'
    );
    lines.push('Horizon contrast is often good; sun glare is usually less harsh than midday.');
    lines.push('Reflections tend to be softer than on a fully dark night — conditions vary.');
  } else if (category === 'day') {
    lines.push('In clear daylight you may see a plume at liftoff and track part of the climb; high clouds or sun angle can limit contrast.');
    lines.push('A long arc across the sky is possible when trajectory and visibility line up — not every mission looks the same.');
    lines.push('Open water viewing avoids shore crowds but does not change physics: range safety and weather still rule.');
  } else {
    lines.push('Liftoff and climb may be visible when timing, trajectory, and weather align.');
    lines.push('Your captain works within Coast Guard and Space Force restrictions — not every attempt is ideal for viewing.');
  }

  if (rocket.showBoosterReturn && rocket.boosterLine) {
    lines.push(rocket.boosterLine);
  }

  return lines;
}
