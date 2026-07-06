import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BookOpen, Calendar, MapPin, Phone, Sparkles, Waves } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logSupabaseError } from '../../lib/supabaseErrors';
import {
  captainsLogArticlePath,
  plainTextFromMarkdown,
  type CaptainsLogArticle,
} from '../../lib/captainsLog';
import { env } from '../../config/env.js';

type StaticLink = {
  title: string;
  description: string;
  href: string;
  icon: 'tours' | 'conditions' | 'launches' | 'rental' | 'contact';
};

const STATIC_LINKS: StaticLink[] = [
  {
    title: 'Bioluminescent Tours',
    description: 'Book a captain-led night charter from Titusville on the Indian River Lagoon.',
    href: '/bioluminescent-tours',
    icon: 'tours',
  },
  {
    title: 'Marine Conditions',
    description: 'Wind, tides, and lagoon forecasts before you leave the dock.',
    href: '/conditions',
    icon: 'conditions',
  },
  {
    title: 'Rocket Launch Schedule',
    description: 'Pair a launch night with lagoon time when dates align.',
    href: '/launches',
    icon: 'launches',
  },
  {
    title: 'Titusville Boat Rentals',
    description: 'Self-drive daytime rentals — plan travel to bio hotspots separately.',
    href: '/boat-rentals/titusville',
    icon: 'rental',
  },
  {
    title: 'Contact',
    description: 'Questions about timing, group size, or custom trips.',
    href: '/contact',
    icon: 'contact',
  },
];

function isBioArticle(article: CaptainsLogArticle): boolean {
  const blob = `${article.title} ${article.summary ?? ''} ${(article.seo_keywords ?? []).join(' ')} ${plainTextFromMarkdown(article.content).slice(0, 400)}`.toLowerCase();
  return (
    article.category === 'Water Adventures' ||
    blob.includes('bioluminescence') ||
    blob.includes('bioluminescent') ||
    blob.includes('dinoflagellate')
  );
}

function LinkIcon({ kind }: { kind: StaticLink['icon'] }) {
  const cls = 'h-5 w-5 text-cyan-400';
  if (kind === 'tours') return <Sparkles className={cls} aria-hidden />;
  if (kind === 'conditions') return <Waves className={cls} aria-hidden />;
  if (kind === 'launches') return <Calendar className={cls} aria-hidden />;
  if (kind === 'rental') return <MapPin className={cls} aria-hidden />;
  return <Phone className={cls} aria-hidden />;
}

export default function InternalLinkGrid() {
  const [logLinks, setLogLinks] = useState<{ title: string; href: string }[]>([]);

  const loadArticles = useCallback(async () => {
    const { data, error } = await supabase
      .from('captains_log')
      .select('title, slug, category, summary, content, seo_keywords')
      .order('created_at', { ascending: false })
      .limit(40);

    logSupabaseError('InternalLinkGrid.loadArticles', error);

    let rows = (data ?? []) as CaptainsLogArticle[];

    if (error || rows.length === 0) {
      try {
        if (env.apiUrlConfigured && env.apiUrl) {
          const r = await fetch(`${env.apiUrl}/api/captains-log`);
          const j = (await r.json().catch(() => null)) as { articles?: CaptainsLogArticle[] } | null;
          if (Array.isArray(j?.articles)) rows = j.articles;
        }
      } catch {
        /* omit log links */
      }
    }

    const bio = rows.filter(isBioArticle).slice(0, 6).map((a) => ({
      title: a.title,
      href: captainsLogArticlePath(a.slug),
    }));
    setLogLinks(bio);
  }, []);

  useEffect(() => {
    void loadArticles();
  }, [loadArticles]);

  const cards = useMemo(() => STATIC_LINKS, []);

  return (
    <section
      id="related-resources"
      className="scroll-mt-28 border-t border-white/10 pt-10"
      aria-labelledby="heading-related-resources"
    >
      <h2 id="heading-related-resources" className="text-2xl font-bold text-white sm:text-3xl">
        Plan Your Trip
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-slate-400">
        When you are ready to go beyond reading, these Launch Zone pages help with bookings, forecasts, and local context.
      </p>

      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {cards.map((link) => (
          <li key={link.href}>
            <Link
              to={link.href}
              className="group flex h-full flex-col rounded-xl border border-white/10 bg-slate-950/50 p-4 transition hover:border-cyan-500/30 hover:bg-slate-900/60"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-white">
                <LinkIcon kind={link.icon} />
                {link.title}
                <ArrowUpRight
                  className="ml-auto h-4 w-4 text-slate-500 transition group-hover:text-cyan-400"
                  aria-hidden
                />
              </span>
              <span className="mt-2 text-sm leading-relaxed text-slate-400">{link.description}</span>
            </Link>
          </li>
        ))}
      </ul>

      {logLinks.length > 0 ? (
        <div className="mt-8">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            <BookOpen className="h-5 w-5 text-cyan-400" aria-hidden />
            From the Captain&apos;s Log
          </h3>
          <ul className="mt-3 space-y-2">
            {logLinks.map((item) => (
              <li key={item.href}>
                <Link
                  to={item.href}
                  className="text-sm text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline"
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
