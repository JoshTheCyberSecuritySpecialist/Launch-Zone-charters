/** Captain's Log hub: categories and SEO helpers (extend for CMS later). */

/**
 * Full-bleed marketing hero for `/captains-log` (page banner + og:image for the index).
 */
export const CAPTAINS_LOG_HERO_IMAGE =
  '/images/stories-from-the-water-titusville-florida-rocket-launch-boat-charter-indian-river-max-brewer-bridge-night-adventure.png';

/**
 * Stock hero when `image_url` is missing, invalid, or fails to load — matches Python pipeline fallbacks
 * (`SCRAPER_STOCK_IMAGE_FALLBACK` / `images.py`), not the site logo or local banner art.
 */
export const CAPTAINS_LOG_FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1200&q=80';

/** Rotating stock URLs for grid dedupe when the same hero repeats three times in a row. */
export const CAPTAINS_LOG_FALLBACK_POOL: string[] = [
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=80',
  'https://images.unsplash.com/photo-1473116763249-2faaef81ccda?w=1200&q=80',
  'https://images.unsplash.com/photo-1516849841032-87cbac4d88f7?w=1200&q=80',
  'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=1200&q=80',
  'https://images.unsplash.com/photo-1504608524841-42fe6f032b4b?w=1200&q=80',
  'https://images.unsplash.com/photo-1439066615861-d1af74d74000?w=1200&q=80',
];

/**
 * After two identical resolved URLs, swap to a different stock URL to avoid a third identical card.
 */
export function nextGridImageSrc(
  imageUrl: string | null | undefined,
  recent: string[],
): { src: string; recent: string[] } {
  const base = resolveCaptainsLogImageSrc(imageUrl);
  const last2 = recent.slice(-2);
  if (last2.length === 2 && last2[0] === base && last2[1] === base) {
    const alt =
      CAPTAINS_LOG_FALLBACK_POOL.find((u) => u !== base) ?? CAPTAINS_LOG_FALLBACK_IMAGE;
    const next = [...recent, alt].slice(-3);
    return { src: alt, recent: next };
  }
  return { src: base, recent: [...recent, base].slice(-3) };
}

/**
 * URL-safe slug for **publish-time** reservation only (Admin manual publish / pipeline).
 * Never use this for links — navigation must use `captains_log.slug` from the database.
 */
export function slugifyCaptainsLogTitle(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return s || 'article';
}

/**
 * Path to one Captain's Log article. Always pass the stored `captains_log.slug` (never slugify a title).
 */
export function captainsLogArticlePath(slug: string): string {
  const s = slug.trim();
  if (!s) return '/captains-log';
  return `/log/${encodeURIComponent(s)}`;
}

/**
 * Resolve DB `image_url` for `<img src>`. Allows http(s) and site-relative paths.
 */
export function resolveCaptainsLogImageSrc(raw: string | null | undefined): string {
  const fb = CAPTAINS_LOG_FALLBACK_IMAGE;
  if (raw == null || typeof raw !== 'string') return fb;
  const t = raw.trim();
  if (!t) return fb;
  const lower = t.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) return t;
  if (lower.startsWith('/')) return t;
  return fb;
}

export const CAPTAINS_LOG_CATEGORIES = [
  'Launch Updates',
  'Water Adventures',
  'Boating Tips',
  'Local Highlights',
] as const;

export type CaptainsLogCategory = (typeof CAPTAINS_LOG_CATEGORIES)[number];

export type CaptainsLogArticle = {
  id: string;
  title: string;
  slug: string;
  content: string;
  image_url: string | null;
  /** Stored SEO alt for hero image (optional; falls back to generated alt). */
  image_alt?: string | null;
  category: CaptainsLogCategory;
  created_at: string;
  /** Short excerpt for meta description / SEO (optional in DB). */
  summary?: string | null;
  /** Original publish time from source (optional). */
  publish_date?: string | null;
  /** Source hostname (optional). */
  source?: string | null;
  /** Original scraped article URL (optional). */
  source_url?: string | null;
  /** Pipeline: SCRAPED | UNSPLASH_SEARCH | FALLBACK | Manual */
  image_source?: string | null;
  seo_keywords?: string[] | null;
  image_seo_filename?: string | null;
};

/**
 * Alternate SEO-focused image alts required for accessibility + local SEO.
 */
export function captainsLogImageAlt(category: CaptainsLogCategory, visualIndex: number): string {
  if (category === 'Launch Updates') {
    return 'rocket launch florida';
  }
  return visualIndex % 2 === 0 ? 'boat rental daytona beach' : 'rocket launch florida';
}

/**
 * Strip common markdown syntax for card excerpts, meta descriptions, and plain previews.
 * Not a full parser — matches Captain's Log pipeline output (headings, lists, emphasis).
 */
export function plainTextFromMarkdown(md: string): string {
  let t = (md || '').replace(/\r\n/g, '\n');
  t = t.replace(/^---+\s*$/gm, ' ');
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/^\s*[-*+]\s+/gm, '');
  t = t.replace(/^\s*\d+\.\s+/gm, '');
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/\*([^*]+)\*/g, '$1');
  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}
