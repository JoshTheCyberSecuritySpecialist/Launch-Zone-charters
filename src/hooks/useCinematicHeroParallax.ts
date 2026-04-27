import { type RefObject, useEffect } from 'react';

/**
 * Scroll-based parallax on a hero `<img>` using `--lz-parallax-y` (paired with `.lz-hero-bg` in CSS).
 * Disabled at max-width 768px and when `prefers-reduced-motion: reduce`.
 */
export function useCinematicHeroParallax(imgRef: RefObject<HTMLImageElement | null>) {
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    const mqMobile = window.matchMedia('(max-width: 768px)');
    const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');

    const setParallax = () => {
      if (mqMobile.matches || mqReduce.matches) {
        img.style.setProperty('--lz-parallax-y', '0px');
        return;
      }
      const y = window.scrollY * 0.15;
      img.style.setProperty('--lz-parallax-y', `${y}px`);
    };

    setParallax();
    window.addEventListener('scroll', setParallax, { passive: true });
    mqMobile.addEventListener('change', setParallax);
    mqReduce.addEventListener('change', setParallax);

    return () => {
      window.removeEventListener('scroll', setParallax);
      mqMobile.removeEventListener('change', setParallax);
      mqReduce.removeEventListener('change', setParallax);
    };
  }, [imgRef]);
}
