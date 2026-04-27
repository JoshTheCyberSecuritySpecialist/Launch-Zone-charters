import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * On navigation: scroll to `#id` when the URL has a hash; otherwise scroll to top.
 */
export default function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = prefersReduced ? 'auto' : 'smooth';

    const id = hash?.replace(/^#/, '');
    if (id) {
      const el = document.getElementById(id);
      if (el) {
        requestAnimationFrame(() => {
          el.scrollIntoView({ behavior, block: 'start' });
        });
        return;
      }
    }

    window.scrollTo({
      top: 0,
      left: 0,
      behavior,
    });
  }, [pathname, hash]);

  return null;
}
