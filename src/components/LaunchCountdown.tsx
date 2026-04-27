import { useEffect, useState } from 'react';

type LaunchCountdownProps = {
  /** NET or window start ISO string from schedule */
  iso: string | null | undefined;
  /** Launch Library status label (e.g. "Go", "TBD"). */
  status?: string | null;
  /** Optional confidence from shared launch formatter. */
  confidence?: 'High' | 'Medium' | 'Low';
  className?: string;
};

/**
 * Live countdown to scheduled time. Conservative copy when time is missing or in the past.
 */
function normalizedStatus(status: string | null | undefined): string {
  return String(status || '')
    .trim()
    .toLowerCase();
}

function softPossibleWindow(diffSec: number): string {
  const days = Math.max(1, Math.ceil(diffSec / 86400));
  return `~${days} day${days === 1 ? '' : 's'} until possible launch`;
}

export default function LaunchCountdown({ iso, status, confidence, className = '' }: LaunchCountdownProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!iso) return null;

  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;

  const diffMs = target - now;
  const diffSec = Math.floor(diffMs / 1000);
  const within48h = diffSec >= 0 && diffSec <= 48 * 3600;
  const within24h = diffSec >= 0 && diffSec <= 24 * 3600;
  const isConfirmed = confidence === 'High' || normalizedStatus(status) === 'go';

  if (diffSec < -3600) {
    return (
      <div className={`flex flex-col gap-0.5 ${className}`.trim()}>
        <p className="text-sm text-amber-200/85">This launch window may have passed — check live updates.</p>
        <p className="text-[11px] text-slate-500">Updated in real-time — schedules may shift</p>
      </div>
    );
  }

  if (diffSec < 0) {
    return (
      <div className={`flex flex-col gap-0.5 ${className}`.trim()}>
        <p className="text-sm text-cyan-200/90">Inside or near the published window.</p>
        <p className="text-[11px] text-slate-500">Updated in real-time — schedules may shift</p>
      </div>
    );
  }

  const d = Math.floor(diffSec / 86400);
  const h = Math.floor((diffSec % 86400) / 3600);
  const m = Math.floor((diffSec % 3600) / 60);

  if (!isConfirmed) {
    return (
      <div className={`flex flex-col gap-0.5 ${className}`.trim()}>
        <p className="text-sm text-slate-300">
          {within48h ? softPossibleWindow(diffSec) : 'Estimated launch window'}
        </p>
        <p className="text-[11px] text-slate-500">Timing subject to change</p>
        <p className="text-[11px] text-slate-500">Updated in real-time — schedules may shift</p>
      </div>
    );
  }

  if (within24h) {
    return (
      <div className={`flex flex-col gap-0.5 ${className}`.trim()}>
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">Confirmed</span>
        <span className="font-mono text-base tabular-nums tracking-tight text-cyan-100/95 sm:text-lg" aria-live="polite">
          T - {h + d * 24}h {m}m
        </span>
        <p className="text-[11px] text-slate-500">Updated in real-time — schedules may shift</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-0.5 ${className}`.trim()}>
      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
        Confirmed window
      </span>
      <span
        className="font-mono text-base tabular-nums tracking-tight text-cyan-100/95 sm:text-lg"
        aria-live="polite"
      >
        T - {d}d {h}h
      </span>
      <p className="text-[11px] text-slate-500">Updated in real-time — schedules may shift</p>
    </div>
  );
}
