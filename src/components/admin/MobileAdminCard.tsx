import type { KeyboardEvent, ReactNode } from 'react';

export type MobileAdminField = {
  label: string;
  value: ReactNode;
  /** Hide empty / dash values */
  hideIfEmpty?: boolean;
};

type MobileAdminCardProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  fields?: MobileAdminField[];
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  onClick?: () => void;
};

function isEmptyValue(value: ReactNode): boolean {
  if (value == null || value === false) return true;
  if (typeof value === 'string' && (value.trim() === '' || value === '—')) return true;
  return false;
}

/** Mobile row card with labeled fields and bottom actions. */
export default function MobileAdminCard({
  title,
  subtitle,
  badge,
  fields = [],
  actions,
  children,
  className = '',
  onClick,
}: MobileAdminCardProps) {
  const visibleFields = fields.filter((f) => !(f.hideIfEmpty && isEmptyValue(f.value)));

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!onClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <article
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={`w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm ${
        onClick ? 'cursor-pointer hover:border-amber-300 hover:bg-amber-50/40' : ''
      } ${className}`.trim()}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="break-words text-base font-bold text-slate-900">{title}</div>
          {subtitle ? (
            <div className="mt-0.5 break-words text-sm text-slate-600">{subtitle}</div>
          ) : null}
        </div>
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </div>

      {visibleFields.length > 0 ? (
        <dl className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          {visibleFields.map((field) => (
            <div key={field.label} className="grid grid-cols-[minmax(5.5rem,35%)_1fr] gap-2 text-sm">
              <dt className="font-semibold text-slate-500">{field.label}</dt>
              <dd className="min-w-0 break-words text-slate-900">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {children}

      {actions ? <div className="mt-3 border-t border-slate-100 pt-3">{actions}</div> : null}
    </article>
  );
}
