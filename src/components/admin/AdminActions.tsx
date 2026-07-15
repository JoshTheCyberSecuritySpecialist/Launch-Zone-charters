import type { ReactNode } from 'react';

type AdminActionsProps = {
  children: ReactNode;
  className?: string;
  /** Use denser 2-col grid on very small screens when many actions */
  columns?: 1 | 2;
};

/** Action button cluster — full-width / grid on mobile, wrap on larger screens. */
export default function AdminActions({
  children,
  className = '',
  columns = 2,
}: AdminActionsProps) {
  return (
    <div
      className={`grid gap-2 ${columns === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'} [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:justify-center [&_button]:min-h-11 ${className}`.trim()}
    >
      {children}
    </div>
  );
}
