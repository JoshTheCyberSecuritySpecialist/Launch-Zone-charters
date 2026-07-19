/** Post-login redirect target: admin paths only (open redirect safe). */
export function safeAdminRedirectPath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/admin')) return '/admin';
  if (raw.startsWith('//') || raw.includes('://')) return '/admin';
  return raw;
}
