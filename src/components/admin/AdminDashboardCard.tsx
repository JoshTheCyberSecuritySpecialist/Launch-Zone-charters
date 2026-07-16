import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

type AdminDashboardCardProps = {
  to: string;
  title: string;
  description: string;
  icon: ReactNode;
  /** Small count/status line, e.g. "3 need review" */
  status?: string | null;
  /** Emphasize cards that need attention */
  highlight?: boolean;
};

/** Large touch-friendly command dashboard card. */
export default function AdminDashboardCard({
  to,
  title,
  description,
  icon,
  status,
  highlight = false,
}: AdminDashboardCardProps) {
  return (
    <Link
      to={to}
      className={`flex min-h-[9.5rem] flex-col rounded-2xl border p-5 shadow-sm transition active:scale-[0.99] ${
        highlight
          ? 'border-amber-300 bg-amber-50 hover:border-amber-400 hover:bg-amber-100/80'
          : 'border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50/40'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
            highlight ? 'bg-amber-200 text-amber-950' : 'bg-slate-100 text-slate-800'
          }`}
          aria-hidden
        >
          {icon}
        </span>
        {status ? (
          <span
            className={`max-w-[55%] text-right text-sm font-bold leading-snug ${
              highlight ? 'text-amber-900' : 'text-slate-700'
            }`}
          >
            {status}
          </span>
        ) : null}
      </div>
      <h2 className="mt-4 text-xl font-black text-slate-900">{title}</h2>
      <p className="mt-1 text-base leading-snug text-slate-600">{description}</p>
    </Link>
  );
}
