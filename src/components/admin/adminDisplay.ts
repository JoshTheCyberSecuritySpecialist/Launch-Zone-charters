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

/** Fixed toast/snackbar — sits above mobile bottom nav, normal position on desktop. */
export const ADMIN_MOBILE_TOAST_CLASS =
  'fixed bottom-24 left-1/2 z-[100] max-w-[calc(100vw-1.5rem)] -translate-x-1/2 rounded-lg px-4 py-3 text-center text-sm font-semibold shadow-lg md:bottom-6 md:max-w-md';

/** Sticky inline alert below admin header on phones. */
export const ADMIN_MOBILE_STICKY_NOTICE_CLASS =
  'sticky top-14 z-30 mb-5 rounded-xl px-4 py-3 font-semibold md:static';
