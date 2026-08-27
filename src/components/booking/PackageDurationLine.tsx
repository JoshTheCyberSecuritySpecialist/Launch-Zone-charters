import { Clock } from 'lucide-react';
import { formatCharterDurationTourLabel } from '../../lib/charterDuration';

type Props = {
  durationMinutes?: number;
};

export default function PackageDurationLine({ durationMinutes }: Props) {
  return (
    <p className="mt-2 flex items-center gap-1.5 text-sm text-cyan-100/90">
      <Clock className="h-4 w-4 shrink-0" aria-hidden />
      <span>{formatCharterDurationTourLabel(durationMinutes)}</span>
    </p>
  );
}
