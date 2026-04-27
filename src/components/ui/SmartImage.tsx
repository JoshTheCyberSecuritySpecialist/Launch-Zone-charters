import { forwardRef } from 'react';
import type { CSSProperties } from 'react';

export type SmartImageProps = {
  src: string;
  alt: string;
  className?: string;
  /** Sets `object-position` when you need a single focal point (not for responsive focal; use CSS classes instead). */
  position?: string;
  priority?: boolean;
  sizes?: string;
  width?: number;
  height?: number;
  style?: CSSProperties;
};

/**
 * Consistent image rendering: `object-fit: cover` by default, optional focal via `position` or CSS classes.
 * Never stretches; pair with a sized parent for heroes (`absolute inset-0 h-full w-full`).
 */
const SmartImage = forwardRef<HTMLImageElement, SmartImageProps>(function SmartImage(
  { src, alt, className = '', position, priority = false, sizes, width, height, style },
  ref
) {
  const merged: CSSProperties = { ...style };
  if (position) merged.objectPosition = position;

  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : undefined}
      sizes={sizes}
      className={`max-w-full object-cover ${className}`.trim()}
      style={Object.keys(merged).length ? merged : undefined}
    />
  );
});

export default SmartImage;
