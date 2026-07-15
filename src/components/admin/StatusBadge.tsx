import type { ReactNode } from 'react';

export type StatusBadgeTone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'amber';

const TONE_CLASS: Record<StatusBadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-800',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-900',
  danger: 'bg-red-100 text-red-800',
  info: 'bg-sky-100 text-sky-900',
  amber: 'bg-amber-100 text-amber-900',
};

type StatusBadgeProps = {
  children: ReactNode;
  tone?: StatusBadgeTone;
  className?: string;
};

export default function StatusBadge({
  children,
  tone = 'neutral',
  className = '',
}: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex w-fit max-w-full items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${TONE_CLASS[tone]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
