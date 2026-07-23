import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import CaptainBottomNav from './CaptainBottomNav';
import CaptainDocumentHead from './CaptainDocumentHead';

type CaptainShellProps = {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: ReactNode;
};

export default function CaptainShell({
  title,
  subtitle,
  onRefresh,
  refreshing = false,
  children,
}: CaptainShellProps) {
  return (
    <>
      <CaptainDocumentHead />
      <div
        className="min-h-[100dvh] bg-slate-50 pb-28 text-slate-900"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <header className="border-b border-slate-200 bg-white px-4 py-4 shadow-sm">
          <div className="mx-auto flex max-w-lg items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Captain Portal</p>
              <h1 className="mt-1 truncate text-2xl font-black text-slate-900">{title}</h1>
              {subtitle ? <p className="mt-1 text-base text-slate-600">{subtitle}</p> : null}
            </div>
            {onRefresh ? (
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white hover:bg-sky-700 disabled:bg-slate-300"
                aria-label="Refresh trips"
              >
                <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
              </button>
            ) : null}
          </div>
        </header>

        <main className="mx-auto max-w-lg px-4 py-5">{children}</main>
      </div>
      <CaptainBottomNav />
    </>
  );
}
