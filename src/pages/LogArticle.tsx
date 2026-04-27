import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Calendar, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logSupabaseError } from '../lib/supabaseErrors';
import CaptainsLogMarkdown from '../components/CaptainsLogMarkdown';
import { CaptainsLogArticleImage } from '../components/CaptainsLogArticleImage';
import {
  captainsLogArticlePath,
  captainsLogImageAlt,
  plainTextFromMarkdown,
  type CaptainsLogArticle,
} from '../lib/captainsLog';
import { SITE_LOGO_PATH } from '../constants/branding';

const DEFAULT_SITE_ORIGIN = 'https://launchzonecharters.com';

/** Slug segment after `/log/` — pathname is the source of truth (avoids param edge cases). */
function slugFromLogPathname(pathname: string): string | undefined {
  const prefix = '/log/';
  if (!pathname.startsWith(prefix)) return undefined;
  const raw = pathname.slice(prefix.length);
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function siteOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  const env = import.meta.env.VITE_SITE_URL as string | undefined;
  if (env && typeof env === 'string') {
    return env.replace(/\/$/, '');
  }
  return DEFAULT_SITE_ORIGIN;
}

function toAbsoluteUrl(raw: string | null | undefined, origin: string): string {
  const fb = `${origin}/og-image.png`;
  if (raw == null || typeof raw !== 'string') return fb;
  const t = raw.trim();
  if (!t) return fb;
  if (t.startsWith('http://') || t.startsWith('https://')) return t;
  const path = t.startsWith('/') ? t : `/${t}`;
  return `${origin}${path}`;
}

function buildMetaDescription(article: CaptainsLogArticle): string {
  const summary = article.summary?.trim();
  if (summary) {
    return summary.length > 320 ? `${summary.slice(0, 317)}…` : summary;
  }
  const plain = plainTextFromMarkdown(article.content);
  if (plain.length <= 165) return plain;
  return `${plain.slice(0, 162)}…`;
}

function articleJsonLd(article: CaptainsLogArticle, canonicalUrl: string, description: string, imageUrl: string) {
  const origin = siteOrigin();
  const published = article.publish_date?.trim() || article.created_at;
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.title,
    description,
    image: imageUrl,
    datePublished: published,
    dateModified: article.created_at,
    author: {
      '@type': 'Organization',
      name: 'Launch Zone Charters',
    },
    publisher: {
      '@type': 'Organization',
      name: 'Launch Zone Charters',
      logo: {
        '@type': 'ImageObject',
        url: `${origin}${SITE_LOGO_PATH}`,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': canonicalUrl,
    },
  };
}

interface LogArticleProps {
  onNavigate: (page: string) => void;
}

export default function LogArticle({ onNavigate }: LogArticleProps) {
  const { slug: slugParam } = useParams<{ slug: string }>();
  const location = useLocation();
  /** Prefer full path segment so long slugs match DB; fall back to :slug param. */
  const slug =
    slugFromLogPathname(location.pathname)?.trim() || slugParam?.trim() || undefined;
  const [article, setArticle] = useState<CaptainsLogArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadArticle = useCallback(async (isLive: () => boolean) => {
    setFetchError(null);
    if (!slug) {
      if (isLive()) {
        setNotFound(true);
        setLoading(false);
      }
      return;
    }

    if (import.meta.env.DEV) {
      console.log('URL slug:', slug);
    }

    const exactCandidates = [slug];
    if (slug.length > 100) exactCandidates.push(slug.slice(0, 100));
    if (slug.length > 120) exactCandidates.push(slug.slice(0, 120));
    const uniqueExact = [...new Set(exactCandidates)];

    let resolved: CaptainsLogArticle | null = null;
    let loadError: { message: string; code?: string } | null = null;

    for (const s of uniqueExact) {
      // `*` avoids PostgREST errors when prod DB is missing newer columns (was showing as false "not found").
      const { data, error } = await supabase.from('captains_log').select('*').eq('slug', s).maybeSingle();

      logSupabaseError('LogArticle.loadArticle', error);
      if (error) {
        loadError = error;
        break;
      }
      if (data) {
        resolved = data as CaptainsLogArticle;
        break;
      }
    }

    if (!resolved && !loadError && slug.length >= 24) {
      const { data: rpcData, error: rpcError } = await supabase.rpc('resolve_captains_log_slug', {
        p: slug,
      });
      logSupabaseError('LogArticle.resolve_captains_log_slug', rpcError);
      if (rpcError) {
        if (import.meta.env.DEV) {
          console.warn('resolve_captains_log_slug (optional):', rpcError.message);
        }
      } else if (rpcData != null) {
        const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
        if (row && typeof row === 'object' && 'slug' in row) {
          resolved = row as CaptainsLogArticle;
        }
      }
    }

    if (!isLive()) return;

    if (import.meta.env.DEV) {
      console.log('Fetched article:', resolved);
    }

    if (loadError) {
      setFetchError(loadError.message);
      setNotFound(false);
      setArticle(null);
    } else if (!resolved) {
      if (import.meta.env.DEV) {
        console.warn('No article found for slug:', slug);
      }
      setNotFound(true);
      setArticle(null);
    } else {
      setNotFound(false);
      setArticle(resolved);
    }
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    let live = true;
    const isLive = () => live;
    void loadArticle(isLive);
    return () => {
      live = false;
    };
  }, [loadArticle]);

  const heroAlt = article
    ? (
        article.image_alt?.trim() ||
        `${captainsLogImageAlt(article.category, 0)}: ${article.title}`
      ).trim() || "Captain's Log article — Launch Zone Charters Space Coast Florida"
    : '';

  const origin = siteOrigin();
  const canonicalPath = slug ? captainsLogArticlePath(slug) : '/captains-log';
  const canonicalUrl = `${origin}${canonicalPath.startsWith('/') ? canonicalPath : `/${canonicalPath}`}`;

  const seo = useMemo(() => {
    if (!article) return null;
    const description = buildMetaDescription(article);
    const ogImage = toAbsoluteUrl(article.image_url, origin);
    const pageTitle = `${article.title} | Captain's Log, Launch Zone`;
    const jsonLd = articleJsonLd(article, canonicalUrl, description, ogImage);
    return { description, ogImage, pageTitle, jsonLd };
  }, [article, canonicalUrl, origin]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary via-primary to-secondary text-white/90">
      {loading && (
        <Helmet>
          <title>Captain&apos;s Log | Launch Zone Charters</title>
          <meta name="description" content="Stories from the Space Coast: launches, boating, and local adventures." />
        </Helmet>
      )}
      {!loading && fetchError && (
        <Helmet>
          <title>Error loading story | Captain&apos;s Log, Launch Zone</title>
          <meta name="robots" content="noindex, follow" />
        </Helmet>
      )}
      {!loading && !fetchError && notFound && (
        <Helmet>
          <title>Story not found | Captain&apos;s Log, Launch Zone</title>
          <meta name="description" content="This Captain&apos;s Log entry is unavailable." />
          <meta name="robots" content="noindex, follow" />
          <link rel="canonical" href={`${origin}/captains-log`} />
        </Helmet>
      )}
      {!loading && article && seo && (
        <Helmet prioritizeSeoTags>
          <title>{seo.pageTitle}</title>
          <meta name="description" content={seo.description} />
          <link rel="canonical" href={canonicalUrl} />
          <meta property="og:title" content={article.title} />
          <meta property="og:description" content={seo.description} />
          <meta property="og:type" content="article" />
          <meta property="og:url" content={canonicalUrl} />
          <meta property="og:image" content={seo.ogImage} />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={article.title} />
          <meta name="twitter:description" content={seo.description} />
          <meta name="twitter:image" content={seo.ogImage} />
          {Array.isArray(article.seo_keywords) && article.seo_keywords.length > 0 ? (
            <meta name="keywords" content={article.seo_keywords.join(', ')} />
          ) : null}
          <script type="application/ld+json">{JSON.stringify(seo.jsonLd)}</script>
        </Helmet>
      )}
      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:max-w-4xl lg:px-8">
        <button
          type="button"
          onClick={() => onNavigate('captains-log')}
          className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-slate-300 transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Captain&apos;s Log
        </button>

        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-10 w-10 animate-spin text-accent" aria-label="Loading article" />
          </div>
        ) : fetchError ? (
          <div className="lz-glass-card border border-red-500/30 p-12 text-center">
            <BookOpen className="mx-auto h-12 w-12 text-red-300/80" />
            <h1 className="mt-4 text-2xl font-bold text-white">Couldn&apos;t load this story</h1>
            <p className="mt-2 text-slate-400">
              The database didn&apos;t return this article. Check the browser console for details.
            </p>
            {import.meta.env.DEV ? (
              <p className="mt-4 rounded-md bg-black/40 p-3 text-left font-mono text-xs text-amber-200/90">
                {fetchError}
              </p>
            ) : null}
            <Link
              to="/captains-log"
              className="lz-btn-accent mt-8 inline-block px-6 py-3 text-sm font-bold uppercase tracking-wide"
            >
              View all stories
            </Link>
          </div>
        ) : notFound || !article ? (
          <div className="lz-glass-card border border-white/10 p-12 text-center">
            <BookOpen className="mx-auto h-12 w-12 text-accent/60" />
            <h1 className="mt-4 text-2xl font-bold text-white">Story not found</h1>
            <p className="mt-2 text-slate-400">This entry may have moved or isn&apos;t published yet.</p>
            <Link
              to="/captains-log"
              className="lz-btn-accent mt-8 inline-block px-6 py-3 text-sm font-bold uppercase tracking-wide"
            >
              View all stories
            </Link>
          </div>
        ) : (
          <>
            <header className="mb-8">
              <p className="text-xs font-bold uppercase tracking-widest text-accent">{article.category}</p>
              <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">{article.title}</h1>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-4 w-4 text-accent" />
                  {new Date(article.created_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              </div>
            </header>

            <div className="relative mb-10 overflow-hidden rounded-2xl border border-white/10 shadow-2xl">
              <CaptainsLogArticleImage
                key={article.image_url ?? `${article.id}-hero`}
                imageUrl={article.image_url}
                alt={heroAlt}
                className="max-h-[480px] w-full object-cover transition-transform duration-700 hover:scale-[1.02]"
                width={1200}
                height={630}
                decoding="async"
                fetchPriority="high"
              />
            </div>

            <div className="lz-glass-card border border-white/10 p-8 sm:p-10">
              <CaptainsLogMarkdown content={article.content} />
              {article.source_url &&
                /^https?:\/\//i.test(article.source_url.trim()) && (
                  <div className="mt-10 flex justify-center border-t border-white/10 pt-8">
                    <a
                      href={article.source_url.trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="lz-btn-accent inline-flex items-center gap-2 px-8 py-3 text-sm font-bold uppercase tracking-wide transition-opacity hover:opacity-95"
                    >
                      Read Full Article
                      <span aria-hidden="true">→</span>
                    </a>
                  </div>
                )}
            </div>

            <div className="mt-12 border-t border-white/10 pt-8 text-center">
              <p className="text-slate-400">Ready to get on the water?</p>
              <button
                type="button"
                onClick={() => onNavigate('book')}
                className="lz-btn-accent mt-4 px-8 py-3 text-sm font-bold uppercase tracking-wide"
              >
                Reserve your boat
              </button>
            </div>
          </>
        )}
      </article>
    </div>
  );
}
