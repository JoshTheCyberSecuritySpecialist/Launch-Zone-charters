import { shortId } from './adminDisplay';

type AdminIdProps = {
  value?: string | null;
  len?: number;
  className?: string;
  empty?: string;
};

/** Shortened ID for UI; full value available via title tooltip. */
export default function AdminId({
  value,
  len = 12,
  className = '',
  empty = '—',
}: AdminIdProps) {
  const s = String(value || '').trim();
  if (!s) return <span className={className}>{empty}</span>;
  return (
    <span className={`font-mono text-xs ${className}`.trim()} title={s}>
      {shortId(s, len)}
    </span>
  );
}
