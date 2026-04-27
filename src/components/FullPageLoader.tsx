import Spinner from './Spinner';

interface FullPageLoaderProps {
  message?: string;
  /** Dark shell matches cinematic pages (boat rentals, etc.). Default matches admin/light screens. */
  variant?: 'light' | 'dark';
}

export default function FullPageLoader({ message = 'Loading…', variant = 'light' }: FullPageLoaderProps) {
  const shell =
    variant === 'dark'
      ? 'min-h-screen flex items-center justify-center bg-[#020617]'
      : 'min-h-screen flex items-center justify-center bg-slate-50';
  const text = variant === 'dark' ? 'text-slate-300' : 'text-slate-600';
  return (
    <div className={shell}>
      <div className="text-center px-4">
        <Spinner size="lg" className="mx-auto mb-4" />
        <p className={text}>{message}</p>
      </div>
    </div>
  );
}
