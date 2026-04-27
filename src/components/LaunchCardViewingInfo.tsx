import { Anchor, Eye, Shield } from 'lucide-react';
import type { LaunchTimeCategory } from '../lib/launchTimeCategory';
import { getLaunchTimeCategoryLabel } from '../lib/launchTimeCategory';
import {
  getBestViewingBullets,
  getRocketViewingHint,
  getWhatYouSeeBullets,
  type LaunchCardLaunch,
} from '../lib/launchViewingContext';

type LaunchCardViewingInfoProps = {
  launch: LaunchCardLaunch;
  timeCategory: LaunchTimeCategory;
  className?: string;
};

/**
 * Charter context — copy varies by solar time-of-day category (computed upstream).
 */
export default function LaunchCardViewingInfo({
  launch,
  timeCategory,
  className = '',
}: LaunchCardViewingInfoProps) {
  const rocketHint = getRocketViewingHint(launch);
  const bestLines = getBestViewingBullets(timeCategory);
  const seeLines = getWhatYouSeeBullets(timeCategory, rocketHint);
  const label = getLaunchTimeCategoryLabel(timeCategory);

  return (
    <div
      className={`launch-card-viewing mt-6 border-t border-white/10 pt-6 ${className}`.trim()}
      role="region"
      aria-label="Viewing from the water with Launch Zone Charters"
    >
      <div className="rounded-xl border border-cyan-500/15 bg-black/25 p-4 sm:p-5">
        <p className="mb-3 border-b border-white/[0.06] pb-3 text-xs leading-relaxed text-slate-400">
          Typical charter perspective for the Indian River Lagoon — not a mission guarantee. What you see depends
          on trajectory, weather, haze, range closures, and where safety officials allow us to operate.
        </p>
        <p className="mb-4 text-sm leading-relaxed text-slate-400">
          Visibility depends on weather, haze, trajectory, and range rules; schedules slip or scrub. When conditions
          allow, missions listed here are generally aligned with lagoon viewing toward the Cape — not a promise for
          any specific attempt.
        </p>
        <div className="flex items-start gap-3">
          <Anchor
            className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400/75"
            strokeWidth={2}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/85">
              Best viewing from water
            </h4>
            {label ? (
              <p className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                {label}
              </p>
            ) : null}
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-300/95">
              {bestLines.map((line, i) => (
                <li
                  key={`best-${i}`}
                  className={i === bestLines.length - 1 ? 'text-slate-200/95' : undefined}
                >
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-6 flex items-start gap-3 border-t border-white/[0.07] pt-6">
          <Eye className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400/75" strokeWidth={2} aria-hidden />
          <div className="min-w-0 flex-1">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/85">
              What you&apos;ll see
            </h4>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-300/95">
              {seeLines.map((line, i) => (
                <li key={`see-${i}`}>{line}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-6 flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-950/20 p-4">
          <Shield className="mt-0.5 h-5 w-5 shrink-0 text-amber-200/80" strokeWidth={2} aria-hidden />
          <div className="min-w-0 flex-1">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100/90">
              Safety note
            </h4>
            <ul className="mt-2 space-y-2 text-xs leading-relaxed text-slate-400 sm:text-[13px]">
              <li>We stay outside posted restricted zones on the water.</li>
              <li>
                Final enforcement is by U.S. Space Force range safety and the U.S. Coast Guard — boundaries
                can change with the mission.
              </li>
              <li className="text-slate-300/90">
                Your captain chooses the safest viewing position for conditions that day — not the closest
                possible angle to the pad.
              </li>
              <li>Visibility and photo results are not guaranteed; scrubs and slips are common.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
