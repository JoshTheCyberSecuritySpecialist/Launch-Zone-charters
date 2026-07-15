import type { ReactNode } from 'react';

type AdminResponsiveListProps = {
  /** Desktop table (md and up) */
  desktop: ReactNode;
  /** Mobile card list (below md) */
  mobile: ReactNode;
  className?: string;
};

/**
 * Desktop tables at md+, mobile cards below md.
 * Prefer this over overflow-x-only for primary admin lists.
 */
export default function AdminResponsiveList({
  desktop,
  mobile,
  className = '',
}: AdminResponsiveListProps) {
  return (
    <div className={className}>
      <div className="hidden md:block">{desktop}</div>
      <div className="md:hidden">{mobile}</div>
    </div>
  );
}
