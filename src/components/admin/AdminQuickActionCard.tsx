import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

type AdminQuickActionCardProps = {
  to: string;
  title: string;
  description: string;
  icon: ReactNode;
  badge?: string | null;
  highlight?: boolean;
};

/** Compact touch-friendly action tile for 2-column mobile grids. */
export default function AdminQuickActionCard({
  to,
  title,
  description,
  icon,
  badge,
  highlight = false,
}: AdminQuickActionCardProps) {
  return (
    <Link
      to={to}
      className={`flex min-h-[6.5rem] flex-col rounded-2xl border p-4 shadow-sm transition active:scale-[0.99] ${
        highlight
          ? 'border-amber-300 bg-amber-50 hover:border-amber-400'
          : 'border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50/40'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
            highlight ? 'bg-amber-200 text-amber-950' : 'bg-slate-100 text-slate-800'
          }`}
          aria-hidden
        >
          {icon}
        </span>
        {badge ? (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-bold ${
              highlight ? 'bg-amber-600 text-white' : 'bg-slate-200 text-slate-800'
            }`}
          >
            {badge}
          </span>
        ) : (
          <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
        )}
      </div>
      <h3 className="mt-3 text-lg font-black leading-tight text-slate-900">{title}</h3>
      <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-slate-600">{description}</p>
    </Link>
  );
}
