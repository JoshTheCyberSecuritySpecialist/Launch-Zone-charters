interface SpinnerProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  /** For use on dark / amber buttons */
  tone?: 'default' | 'onDark';
}

const sizeClasses = {
  sm: 'h-5 w-5 border-2',
  md: 'h-10 w-10 border-2',
  lg: 'h-16 w-16 border-b-2',
} as const;

const toneClasses = {
  default: 'border-amber-600 border-t-transparent',
  onDark: 'border-white/30 border-t-white',
} as const;

export default function Spinner({ className = '', size = 'md', tone = 'default' }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`animate-spin rounded-full ${toneClasses[tone]} ${sizeClasses[size]} ${className}`}
    />
  );
}
