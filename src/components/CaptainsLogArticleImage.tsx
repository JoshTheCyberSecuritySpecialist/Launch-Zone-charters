import type { ImgHTMLAttributes } from 'react';
import {
  CAPTAINS_LOG_FALLBACK_IMAGE,
  resolveCaptainsLogImageSrc,
} from '../lib/captainsLog';

type CaptainsLogArticleImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'onError'
> & {
  imageUrl: string | null | undefined;
};

/**
 * Captain's Log article image: missing/broken URLs use the Unsplash stock fallback from `captainsLog.ts`.
 */
export function CaptainsLogArticleImage({
  imageUrl,
  alt,
  className,
  ...rest
}: CaptainsLogArticleImageProps) {
  const src = resolveCaptainsLogImageSrc(imageUrl);

  const safeAlt = (alt || '').trim() || "Captain's Log — Launch Zone Charters, Space Coast Florida";

  return (
    <img
      alt={safeAlt}
      className={className}
      src={src}
      onError={(e) => {
        const t = e.currentTarget;
        if (t.src.includes(CAPTAINS_LOG_FALLBACK_IMAGE)) return;
        t.src = CAPTAINS_LOG_FALLBACK_IMAGE;
      }}
      {...rest}
    />
  );
}
