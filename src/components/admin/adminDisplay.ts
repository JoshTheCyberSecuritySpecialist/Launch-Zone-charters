/** Shorten UUIDs / long IDs for display (value unchanged in DB). */
export function shortId(value: string | null | undefined, len = 8): string {
  const s = String(value || '').trim();
  if (!s) return '—';
  if (s.length <= len + 1) return s;
  return `${s.slice(0, len)}…`;
}

/** snake_case / kebab-case → Title Case words */
export function humanizeLabel(value: string | null | undefined): string {
  const s = String(value || '').trim();
  if (!s) return '—';
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
