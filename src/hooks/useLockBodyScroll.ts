import { useEffect } from 'react';

/**
 * Lock document scrolling while a modal is open.
 * Uses position:fixed on body — required for reliable iOS Safari behavior.
 */
export function useLockBodyScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;

    const scrollY = window.scrollY;
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    const prevTop = document.body.style.top;
    const prevWidth = document.body.style.width;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    if (scrollbar > 0) {
      document.body.style.paddingRight = `${scrollbar}px`;
    }

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.top = prevTop;
      document.body.style.width = prevWidth;
      document.body.style.paddingRight = prevPaddingRight;
      window.scrollTo(0, scrollY);
    };
  }, [active]);
}
