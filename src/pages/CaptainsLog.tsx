import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { Calendar, ChevronRight, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logSupabaseError } from '../lib/supabaseErrors';
import { CaptainsLogArticleImage } from '../components/CaptainsLogArticleImage';
import SmartImage from '../components/ui/SmartImage';
import {
  CAPTAINS_LOG_HERO_IMAGE,
  captainsLogArticlePath,
  captainsLogImageAlt,
  nextGridImageSrc,
  plainTextFromMarkdown,
  type CaptainsLogArticle,
  type CaptainsLogCategory,
} from '../lib/captainsLog';

const CAPTAINS_LOG_HERO_ALT =
  'Titusville Florida boat charter near Max Brewer Bridge with rocket launch over Indian River Lagoon';

const DEFAULT_SITE_ORIGIN = 'https://launchzonecharters.com';

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

const META_DESCRIPTION =
  'Explore Titusville Florida boat charters, rocket launch viewing tips, Indian River Lagoon adventures, and local boating guides from Launch Zone Charters.';

const META_KEYWORDS =
  'titusville boat charters, rocket launch viewing boat, space coast boat tours, indian river lagoon boating, max brewer bridge boat tours, titusville fishing charters, cocoa beach boat rentals, florida rocket launch viewing';

type FilterKey = 'All' | CaptainsLogCategory;

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'All', label: 'All Stories' },
  { key: 'Launch Updates', label: 'Rocket Launch Updates' },
  { key: 'Water Adventures', label: 'Titusville Water Adventures' },
  { key: 'Boating Tips', label: 'Florida Boating Tips' },
  { key: 'Local Highlights', label: 'Space Coast Highlights' },
];

interface CaptainsLogProps {
  onNavigate: (page: string) => void;
}

function excerptFromContent(content: string, maxLen = 160): string {
  const t = plainTextFromMarkdown(content);
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen).trim()}…`;
}

export default function CaptainsLog({ onNavigate }: CaptainsLogProps) {
  const [articles, setArticles] = useState<CaptainsLogArticle[]>([]);
  const [loading, setLoading] = useState(true);
  /** When set, the hub query failed (same empty UI was shown before — now differentiated). */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('All');

  const canonicalUrl = useMemo(() => `${siteOrigin()}/captains-log`, []);
  const ogImageUrl = useMemo(() => `${siteOrigin()}${CAPTAINS_LOG_HERO_IMAGE}`, []);

  const blogJsonLd = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: 'Stories From the Water',
      description:
        'Titusville Florida boat charters, rocket launch viewing, and Space Coast boating guides.',
      url: canonicalUrl,
      publisher: {
        '@type': 'Organization',
        name: 'Launch Zone Charters',
      },
    }),
    [canonicalUrl]
  );

  const loadArticles = useCallback(async (isLive: () => boolean) => {
    const { data, error } = await supabase
      .from('captains_log')
      .select('id, title, slug, content, image_url, image_alt, category, created_at')
      .order('created_at', { ascending: false });

    logSupabaseError('CaptainsLog.loadArticles', error);

    if (!isLive()) return;
    if (!error && data) {
      setArticles(data as CaptainsLogArticle[]);
      setLoadError(null);
    } else if (error) {
      setArticles([]);
      setLoadError(error.message || 'Could not load Captain’s Log articles.');
    }
    if (!isLive()) return;
    setLoading(false);
  }, []);

  useEffect(() => {
    let live = true;
    const isLive = () => live;
    void loadArticles(isLive);
    return () => {
      live = false;
    };
  }, [loadArticles]);

  const filtered = useMemo(() => {
    if (filter === 'All') return articles;
    return articles.filter((a) => a.category === filter);
  }, [articles, filter]);

  const { featured, gridRows } = useMemo(() => {
    const f = filtered[0];
    const rest = filtered.slice(1);
    let recent: string[] = [];
    const rows = rest.map((article) => {
      const { src, recent: r } = nextGridImageSrc(article.image_url, recent);
      recent = r;
      return { article, displaySrc: src };
    });
    return { featured: f, gridRows: rows };
  }, [filtered]);

  const filterDisplayLabel =
    FILTER_TABS.find((t) => t.key === filter)?.label ?? filter;

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary via-primary to-secondary text-white/90">
      <Helmet prioritizeSeoTags>
        <title>Stories From the Water | Titusville Boat Charters & Rocket Launch Viewing</title>
        <meta name="description" content={META_DESCRIPTION} />
        <meta name="keywords" content={META_KEYWORDS} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content="Stories From the Water | Titusville Boat Charters & Rocket Launch Viewing" />
        <meta property="og:description" content={META_DESCRIPTION} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={ogImageUrl} />
        <link rel="preload" as="image" href={CAPTAINS_LOG_HERO_IMAGE} />
        <meta name="twitter:card" content="summary_large_image" />
        <script type="application/ld+json">{JSON.stringify(blogJsonLd)}</script>
      </Helmet>

      {/* Hero: SmartImage + responsive focal (headline lives in artwork; no duplicate H1) */}
      <section
        className="lz-hero-container captains-log-hero lz-hero-viewport border-b border-white/10"
        aria-label="Stories from the Water - Titusville Florida Boat Charters"
      >
        <div className="absolute inset-0 z-0 overflow-visible" aria-hidden>
          <SmartImage
            src={CAPTAINS_LOG_HERO_IMAGE}
            alt={CAPTAINS_LOG_HERO_ALT}
            priority
            sizes="100vw"
            className="lz-hero-bg hero-img-captains absolute inset-0 h-full w-full"
          />
        </div>
        <div className="lz-hero-overlay lz-hero-overlay--captains" aria-hidden />
        <div className="captains-log-hero__glow" aria-hidden />
        <div className="lz-hero-content captains-log-hero__inner">
          <h1 className="sr-only">Stories From the Water</h1>
          <div className="captains-log-hero__content">
            <p className="captains-log-hero__lead seo-subtext lz-hero-fade lz-hero-fade--delay-1">
              Titusville Florida boat charter experiences, rocket launch viewing tips, Indian River Lagoon
              adventures, and local boating insights from Launch Zone Charters.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('book')}
              className="lz-btn-accent captains-log-hero__cta lz-hero-fade lz-hero-fade--delay-2 inline-flex items-center gap-2 px-6 py-3 text-sm uppercase tracking-wide"
            >
              Book your charter
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </section>

      <section className="seo-content border-b border-white/[0.06] bg-[#020617]/80 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Boat Charters in Titusville Florida & Rocket Launch Viewing Guides
          </h2>
          <div className="mt-6 max-w-4xl space-y-4 text-sm leading-relaxed text-slate-300 sm:text-base">
            <p>
              Discover the best boat charter experiences in Titusville, Florida, located along the Indian River
              Lagoon near the Max Brewer Bridge. Launch Zone Charters provides local knowledge on rocket launch
              viewing, inshore fishing, wildlife encounters, and scenic cruises along Florida&apos;s Space Coast.
            </p>
            <p>
              Whether you&apos;re planning to watch a SpaceX Falcon 9 launch from the water, explore hidden
              fishing spots, or enjoy a relaxing sunset cruise, our captain&apos;s log shares real experiences,
              expert boating tips, and insider knowledge you won&apos;t find anywhere else.
            </p>
            <p>
              Serving Titusville, Cocoa Beach, and the surrounding Space Coast, our blog covers boating safety,
              marine conditions, launch schedules, and unforgettable moments on the water.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-10 w-10 animate-spin text-accent" aria-label="Loading articles" />
          </div>
        ) : articles.length === 0 ? (
          <div className="lz-glass-card border border-white/10 p-12 text-center text-slate-300">
            {loadError ? (
              <>
                <p className="text-lg text-amber-100/95">Stories couldn&apos;t load from the database.</p>
                <p className="mt-3 max-w-xl mx-auto text-sm text-slate-400">{loadError}</p>
              </>
            ) : (
              <p className="text-lg">Fresh stories are sailing in soon. Check back shortly.</p>
            )}
            <button
              type="button"
              onClick={() => onNavigate('contact')}
              className="lz-btn-accent mt-6 px-6 py-3 text-sm"
            >
              Contact us
            </button>
          </div>
        ) : (
          <>
            <div className="mb-10 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              {FILTER_TABS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                    filter === key
                      ? 'scale-105 bg-accent text-white shadow-lg shadow-accent/25'
                      : 'border border-white/15 bg-white/5 text-slate-300 hover:scale-105 hover:border-accent/50 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {featured && (
              <Link
                to={captainsLogArticlePath(featured.slug)}
                className="group mb-12 block overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-xl backdrop-blur-md transition-all duration-300 hover:border-accent/40 hover:shadow-2xl hover:shadow-accent/10"
              >
                <div className="grid gap-0 md:grid-cols-2">
                  <div className="relative aspect-[4/3] min-h-[220px] overflow-hidden md:aspect-auto md:min-h-[320px]">
                    <CaptainsLogArticleImage
                      imageUrl={featured.image_url}
                      alt={`${captainsLogImageAlt(featured.category, 0)}: ${featured.title}`}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      width={960}
                      height={720}
                      decoding="async"
                      fetchPriority="high"
                    />
                    <div className="absolute left-4 top-4 rounded-md bg-accent/90 px-2 py-1 text-xs font-bold uppercase tracking-wide text-white">
                      Featured
                    </div>
                  </div>
                  <div className="flex flex-col justify-center p-8 md:p-10">
                    <span className="text-xs font-bold uppercase tracking-widest text-accent">
                      {featured.category}
                    </span>
                    <h2 className="mt-2 text-2xl font-bold text-white transition-colors group-hover:text-accent md:text-3xl">
                      {featured.title}
                    </h2>
                    <p className="mt-4 line-clamp-3 text-slate-300">
                      {excerptFromContent(featured.content)}
                    </p>
                    <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-slate-400">
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar className="h-4 w-4 text-accent" />
                        {new Date(featured.created_at).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                      <span className="inline-flex items-center gap-1 font-semibold text-accent">
                        Read story
                        <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            )}

            {gridRows.length > 0 && (
              <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
                {gridRows.map(({ article, displaySrc }, index) => {
                  const alt = captainsLogImageAlt(article.category, index + 1);
                  return (
                    <Link
                      key={article.id}
                      to={captainsLogArticlePath(article.slug)}
                      className="group flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/5 shadow-lg backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-accent/35 hover:shadow-xl hover:shadow-accent/5"
                    >
                      <div className="relative aspect-[16/10] overflow-hidden">
                        <CaptainsLogArticleImage
                          imageUrl={displaySrc}
                          alt={`${alt}: ${article.title}`}
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                          width={640}
                          height={400}
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                      <div className="flex flex-1 flex-col p-5">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-accent">
                          {article.category}
                        </span>
                        <h3 className="mt-2 flex-1 text-lg font-bold text-white transition-colors group-hover:text-accent">
                          {article.title}
                        </h3>
                        <p className="mt-2 line-clamp-2 text-sm text-slate-400">
                          {excerptFromContent(article.content, 120)}
                        </p>
                        <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent">
                          Read more
                          <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {filtered.length === 1 && (
              <p className="mt-8 text-center text-sm text-slate-400">More articles in this category soon.</p>
            )}

            {filtered.length === 0 && filter !== 'All' && (
              <div className="lz-glass-card border border-white/10 p-10 text-center text-slate-300">
                <p>
                  No stories in &ldquo;{filterDisplayLabel}&rdquo; yet. Try another category or view all.
                </p>
                <button
                  type="button"
                  onClick={() => setFilter('All')}
                  className="lz-btn-accent mt-6 px-6 py-2 text-sm"
                >
                  View all
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
