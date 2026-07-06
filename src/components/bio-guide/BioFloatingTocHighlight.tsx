import { useEffect, useState } from 'react';

type BioFloatingTocHighlightProps = {
  activeTitle: string | null;
};

/** Mobile-friendly floating label for the active TOC section. */
export default function BioFloatingTocHighlight({ activeTitle }: BioFloatingTocHighlightProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 480);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible || !activeTitle) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-20 left-4 z-40 max-w-[min(70vw,16rem)] rounded-full border border-cyan-500/25 bg-slate-950/90 px-3 py-1.5 text-[11px] font-medium text-cyan-100 shadow-lg backdrop-blur-sm lg:hidden print:hidden motion-reduce:transition-none"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="text-slate-500">Reading: </span>
      {activeTitle}
    </div>
  );
}
