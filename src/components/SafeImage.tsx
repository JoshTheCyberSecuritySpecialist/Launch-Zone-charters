import { useCallback, useEffect, useState, type ImgHTMLAttributes } from 'react';

export type SafeImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'alt'> & {
  fallbackSrc: string;
  /** Required for accessibility and SEO. */
  alt: string;
};

/**
 * Reports failed image loads and swaps to a fallback (global image error handling at use-site).
 */
export default function SafeImage({ src, fallbackSrc, onError, alt, ...rest }: SafeImageProps) {
  const [activeSrc, setActiveSrc] = useState(src);

  useEffect(() => {
    setActiveSrc(src);
  }, [src]);

  const handleError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
      const failed = e.currentTarget.currentSrc || e.currentTarget.src;
      console.warn('[Image] Failed to load:', failed);
      setActiveSrc(fallbackSrc);
      onError?.(e);
    },
    [fallbackSrc, onError]
  );

  return <img src={activeSrc || fallbackSrc} alt={alt} onError={handleError} {...rest} />;
}
