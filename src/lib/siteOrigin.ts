const DEFAULT_SITE_ORIGIN = 'https://launchzonecharters.com';

/** Canonical origin for SEO URLs (Helmet, JSON-LD). */
export function siteOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  const envUrl = import.meta.env.VITE_SITE_URL as string | undefined;
  if (envUrl && typeof envUrl === 'string') {
    return envUrl.replace(/\/$/, '');
  }
  return DEFAULT_SITE_ORIGIN;
}
