import type { ReactNode } from 'react';

type AdminFieldProps = {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
};

const controlClass =
  'mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:bg-slate-100';

/** Label-above field wrapper for admin forms. */
export default function AdminField({
  label,
  htmlFor,
  hint,
  error,
  className = '',
  children,
}: AdminFieldProps) {
  return (
    <label htmlFor={htmlFor} className={`block text-sm font-bold text-slate-700 ${className}`.trim()}>
      {label}
      {children}
      {hint ? <div className="mt-1 text-xs font-normal text-slate-500">{hint}</div> : null}
      {error ? <div className="mt-1 text-xs font-semibold text-red-700">{error}</div> : null}
    </label>
  );
}

export { controlClass as adminControlClass };
