import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';

type Props = {
  open: boolean;
  onClose: () => void;
  titleId: string;
  title: string;
  subtitle?: string | null;
  headerActions?: ReactNode;
  closeOnBackdrop?: boolean;
  enableSwipeToClose?: boolean;
  children: ReactNode;
};

const SWIPE_CLOSE_THRESHOLD_PX = 72;

export default function AdminModalShell({
  open,
  onClose,
  titleId,
  title,
  subtitle,
  headerActions,
  closeOnBackdrop = true,
  enableSwipeToClose = true,
  children,
}: Props) {
  useLockBodyScroll(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number | null>(null);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleClose, open]);

  useEffect(() => {
    if (!open) {
      touchStartY.current = null;
    }
  }, [open]);

  const onTouchStart = (event: React.TouchEvent) => {
    if (!enableSwipeToClose) return;
    touchStartY.current = event.touches[0]?.clientY ?? null;
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    if (!enableSwipeToClose || touchStartY.current == null) return;
    const endY = event.changedTouches[0]?.clientY;
    if (endY == null) return;
    if (endY - touchStartY.current >= SWIPE_CLOSE_THRESHOLD_PX) {
      handleClose();
    }
    touchStartY.current = null;
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-end justify-center sm:items-center sm:p-4"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Close dialog"
        onClick={() => {
          if (closeOnBackdrop) handleClose();
        }}
      />

      <div
        ref={panelRef}
        className="relative flex w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        style={{ maxHeight: 'min(92dvh, calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom)))' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <header className="sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 pr-2">
              <h2 id={titleId} className="text-lg font-black text-slate-900">
                {title}
              </h2>
              {subtitle ? <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p> : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {headerActions}
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
                aria-label="Close"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto overscroll-contain bg-slate-100 touch-pan-y">{children}</div>
      </div>
    </div>,
    document.body
  );
}
