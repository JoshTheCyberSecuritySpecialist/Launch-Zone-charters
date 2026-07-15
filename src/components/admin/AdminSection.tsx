import type { ReactNode } from 'react';

type AdminSectionProps = {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
};

/** Shared white card section used across admin pages. */
export default function AdminSection({
  title,
  description,
  actions,
  children,
  className = '',
  bodyClassName = '',
  id,
}: AdminSectionProps) {
  const hasHeader = Boolean(title || description || actions);

  return (
    <section
      id={id}
      className={`overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`.trim()}
    >
      {hasHeader ? (
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            {title ? <h2 className="text-lg font-bold text-slate-900 sm:text-xl">{title}</h2> : null}
            {description ? <div className="mt-0.5 text-sm text-slate-500">{description}</div> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={bodyClassName || 'p-4 sm:p-5'}>{children}</div>
    </section>
  );
}
