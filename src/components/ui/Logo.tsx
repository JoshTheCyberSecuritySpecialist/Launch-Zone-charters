import { Link } from 'react-router-dom';
import { SITE_LOGO_PATH } from '../../constants/branding';

export type LogoVariant = 'nav' | 'hero' | 'footer' | 'mobile' | 'admin';

/** @deprecated use `variant` */
export type LogoSize = 'sm' | 'md' | 'lg' | 'xl' | 'header';

/** Width-first scaling: avoids header `max-height: 100%` / fixed-row clipping. */
const VARIANT_CLASSES: Record<LogoVariant, string> = {
  nav: 'h-auto w-[140px] md:w-[180px] lg:w-[220px]',
  hero: 'h-auto w-[220px] md:w-[320px] lg:w-[420px]',
  footer: 'h-auto w-[140px] sm:w-[160px]',
  mobile: 'h-auto w-[120px]',
  admin: 'h-auto w-[100px] md:w-[120px]',
};

/** Legacy `size` → `variant` */
const SIZE_TO_VARIANT: Record<LogoSize, LogoVariant> = {
  sm: 'admin',
  md: 'footer',
  lg: 'mobile',
  xl: 'nav',
  header: 'nav',
};

export const LOGO_ALT =
  'Launch Zone Charters Rocket Launch Boat Rentals Titusville Florida Indian River Lagoon';

export interface LogoProps {
  variant?: LogoVariant;
  /** @deprecated prefer `variant` */
  size?: LogoSize;
  className?: string;
  imgClassName?: string;
  onClick?: () => void;
}

export default function Logo({
  variant: variantProp,
  size,
  className = '',
  imgClassName = '',
  onClick,
}: LogoProps) {
  const variant = variantProp ?? (size ? SIZE_TO_VARIANT[size] : 'footer');
  const eager = variant === 'nav' || variant === 'hero';

  return (
    <Link
      to="/"
      onClick={onClick}
      className={`logo-container lz-logo-link inline-flex max-w-full items-center ${className}`.trim()}
    >
      <img
        src={SITE_LOGO_PATH}
        alt={LOGO_ALT}
        className={`logo lz-global-logo block object-contain transition-all duration-300 ${VARIANT_CLASSES[variant]} ${imgClassName}`.trim()}
        style={{ maxWidth: '100%', height: 'auto' }}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={eager ? 'high' : undefined}
      />
    </Link>
  );
}
