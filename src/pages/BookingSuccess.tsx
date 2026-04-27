import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, ExternalLink, Hash } from 'lucide-react';
import BookingFlowStepIndicator from '../components/BookingFlowStepIndicator';
import { env } from '../config/env.js';
import { wrapNavigateClick, wrapRouterNavigate, wrapSyncClick } from '../lib/clickPerf';

const BUOY_URL = 'https://www.buoy.rent/';

interface BookingSuccessProps {
  onNavigate: (page: string) => void;
}

export default function BookingSuccess({ onNavigate }: BookingSuccessProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = (searchParams.get('session_id') || '').trim();
  const [bookingId, setBookingId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const finalizedRef = useRef(false);
  const emailSentRef = useRef(false);

  useEffect(() => {
    if (!env.apiUrlConfigured || !env.apiUrl) {
      setError('API URL is not configured. Set VITE_API_URL to your backend origin.');
      setLoading(false);
      return;
    }
    const api = env.apiUrl;
    if (!sessionId) {
      setError('Missing checkout session reference.');
      setLoading(false);
      return;
    }
    if (finalizedRef.current) return;
    finalizedRef.current = true;

    void (async () => {
      try {
        const res = await fetch(`${api}/api/finalize-checkout-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          bookingId?: string;
          email?: string;
          error?: string;
        };
        if (!res.ok || !payload.bookingId) {
          setError(payload.error || 'Could not finalize booking after payment.');
          setLoading(false);
          return;
        }
        setBookingId(payload.bookingId);
        setLoading(false);

        if (!emailSentRef.current) {
          emailSentRef.current = true;
          void fetch(`${api}/api/send-booking-confirmation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId: payload.bookingId, email: payload.email || '' }),
          }).catch((err) => {
            if (import.meta.env.DEV) {
              console.warn('[send-booking-confirmation]', err);
            }
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not finalize booking.');
        setLoading(false);
      }
    })();
  }, [sessionId]);

  const goVerifyUpload = useMemo(
    () =>
      wrapRouterNavigate(
        'booking_success',
        'verify_upload',
        navigate,
        `/verify?bookingId=${encodeURIComponent(bookingId)}`
      ),
    [navigate, bookingId]
  );

  const shell = (inner: ReactNode) => (
    <div className="relative min-h-screen px-4 py-16">
      <div className="relative z-[1] mx-auto max-w-lg">
        <BookingFlowStepIndicator currentStep={4} className="mb-8" />
        {inner}
      </div>
    </div>
  );

  if (loading) {
    return shell(
      <div className="lz-card-glass rounded-[var(--lz-radius-card)] p-8 text-center text-slate-200">
        <h1 className="font-display text-xl font-bold uppercase tracking-[0.12em] text-white md:text-2xl">
          Finalizing your booking…
        </h1>
        <p className="mt-3 text-sm text-slate-400">
          We are confirming your payment and saving your reservation.
        </p>
      </div>
    );
  }

  if (error || !bookingId) {
    return shell(
      <div className="lz-card-glass rounded-[var(--lz-radius-card)] p-8 text-center">
        <h1 className="font-display text-xl font-bold uppercase tracking-[0.12em] text-white md:text-2xl">
          Could not finalize booking
        </h1>
        <p className="mt-3 text-sm text-slate-400">
          {error || 'Please contact support with your payment receipt so we can complete this manually.'}
        </p>
        <button
          type="button"
          onClick={wrapNavigateClick('booking_success', 'book', onNavigate)}
          className="lz-btn-primary mt-8 w-full justify-center text-sm !normal-case !tracking-wide"
        >
          Book now
        </button>
      </div>
    );
  }

  return shell(
    <div className="lz-card-glass rounded-[var(--lz-radius-card)] p-8 text-slate-200 md:p-10">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/15 shadow-[0_0_24px_rgba(52,211,153,0.2)]">
          <CheckCircle className="h-8 w-8 text-emerald-300" aria-hidden />
        </div>
        <h1 className="font-display text-2xl font-bold uppercase tracking-[0.1em] text-white md:text-3xl">
          Deposit received
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-300 md:text-base">
          Your booking is submitted and pending approval. We&apos;ll review your reservation and documents
          shortly.
        </p>
      </div>
      <div className="mt-8 rounded-[var(--lz-radius)] border border-white/10 bg-slate-950/50 p-4 text-left">
        <div className="flex items-start gap-3">
          <Hash className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400/80" aria-hidden />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Booking ID</p>
            <p className="mt-1 break-all font-mono text-sm font-semibold text-white">{bookingId}</p>
          </div>
        </div>
      </div>

      <div className="mt-8 border-t border-white/10 pt-8 text-left">
        <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">
          Step 4 — Complete your booking
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          You must obtain short-term rental insurance before your trip. This is required for approval.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <a
            href={BUOY_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={wrapSyncClick('booking_success_external_buoy', () => {
              /* navigation via href */
            })}
            className="inline-flex items-center justify-center gap-2 rounded-[var(--lz-radius)] border border-white/15 bg-slate-950/60 px-4 py-2.5 text-sm font-semibold text-white transition hover:border-cyan-400/30 hover:bg-slate-900/80"
          >
            Get Insurance
            <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
          </a>
          <button
            type="button"
            onClick={goVerifyUpload}
            className="lz-btn-primary inline-flex justify-center text-center text-sm !normal-case !tracking-wide"
          >
            Upload insurance proof
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          You&apos;ll confirm your booking email, then upload a screenshot or PDF of your policy — same flow as
          your confirmation email.
        </p>
      </div>

      <div className="mt-8 flex justify-center">
        <button
          type="button"
          onClick={wrapNavigateClick('booking_success', 'home', onNavigate)}
          className="lz-btn-secondary w-full max-w-xs justify-center text-sm !normal-case !tracking-wide sm:w-auto"
        >
          Home
        </button>
      </div>
    </div>
  );
}
