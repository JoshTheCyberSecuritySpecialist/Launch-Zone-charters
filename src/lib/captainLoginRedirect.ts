/** Post-login redirect target: captain paths only (open redirect safe). */
export function safeCaptainRedirectPath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/captain')) return '/captain';
  if (raw.startsWith('//') || raw.includes('://')) return '/captain';
  if (raw === '/captain-login' || raw.startsWith('/captain-login/')) return '/captain';
  return raw;
}
