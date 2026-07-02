import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, ExternalLink, Hash } from 'lucide-react';
import BookingFlowStepIndicator from '../components/BookingFlowStepIndicator';
import {
  PONTOON_INSURANCE,
  getInsuranceConfigForBooking,
  type BuoyInsuranceConfig,
} from '../config/buoyInsurance';
import { env } from '../config/env.js';
import { wrapNavigateClick, wrapRouterNavigate, wrapSyncClick } from '../lib/clickPerf';
import { supabase } from '../lib/supabase';

interface BookingSuccessProps {
  onNavigate: (page: string) => void;
}

export default function BookingSuccess({ onNavigate }: BookingSuccessProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = (searchParams.get('session_id') || '').trim();
  const bookingIdParam = (searchParams.get('bookingId') || '').trim();
  const [bookingId, setBookingId] = useState(bookingIdParam);
  const [insuranceStatus, setInsuranceStatus] = useState<string | null>(null);
  const [bookingStatus, setBookingStatus] = useState<string | null>(null);
  const [insuranceConfig, setInsuranceConfig] = useState<BuoyInsuranceConfig>(PONTOON_INSURANCE);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const finalizedRef = useRef(false);

  const activeBookingId = bookingId || bookingIdParam;

  useEffect(() => {
    if (!env.apiUrlConfigured || !env.apiUrl) {
      setError('API URL is not configured. Set VITE_API_URL to your backend origin.');
      setLoading(false);
      return;
    }
    const api = env.apiUrl;

    const loadCheckoutStatus = async () => {
      const statusRes = await fetch(`${api}/api/checkout-status?sessionId=${encodeURIComponent(sessionId)}`);
      const statusPayload = (await statusRes.json().catch(() => ({}))) as {
        status?: string;
        bookingId?: string;
        error?: string;
      };
      if (!statusRes.ok) return false;
      if (statusPayload.bookingId) {
        setBookingId(statusPayload.bookingId);
        setStatusMessage('Payment received. Your reservation is confirmed.');
        return true;
      }
      if (statusPayload.status === 'pending') {
        setStatusMessage('Payment received. We are still confirming your reservation.');
        setError('');
        return true;
      }
      if (statusPayload.status === 'needs_staff') {
        setStatusMessage('Payment received. Our team has been alerted to finish your reservation.');
        setError('');
        return true;
      }
      return false;
    };

    if (sessionId) {
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
            if (await loadCheckoutStatus()) {
              setLoading(false);
              return;
            }
            setError(payload.error || 'Could not finalize booking after payment.');
            setLoading(false);
            return;
          }

          setBookingId(payload.bookingId);
          setStatusMessage('Payment confirmed. Your confirmation email is being sent by our booking system.');

          try {
            const insRes = await fetch(
              `${api}/api/public/booking-insurance-status?bookingId=${encodeURIComponent(payload.bookingId)}`
            );
            const insPayload = (await insRes.json().catch(() => ({}))) as {
              insurance_status?: string;
              status?: string;
            };
            if (insRes.ok) {
              if (insPayload.insurance_status) setInsuranceStatus(insPayload.insurance_status);
              if (insPayload.status) setBookingStatus(insPayload.status);
            }
          } catch {
            setInsuranceStatus(null);
          }

          setLoading(false);
        } catch (err) {
          try {
            if (await loadCheckoutStatus()) {
              setLoading(false);
              return;
            }
          } catch {
            // Show the finalize error below.
          }
          setError(err instanceof Error ? err.message : 'Could not finalize booking.');
          setLoading(false);
        }
      })();
      return;
    }

    if (!bookingIdParam) {
      setError('Missing booking reference.');
      setLoading(false);
      return;
    }

    setBookingId(bookingIdParam);

    void (async () => {
      try {
        const res = await fetch(
          `${api}/api/public/booking-insurance-status?bookingId=${encodeURIComponent(bookingIdParam)}`
        );
        const payload = (await res.json().catch(() => ({}))) as {
          insurance_status?: string;
          status?: string;
          error?: string;
        };
        if (!res.ok) {
          setInsuranceStatus(null);
        } else {
          if (payload.insurance_status) setInsuranceStatus(payload.insurance_status);
          if (payload.status) setBookingStatus(payload.status);
        }
      } catch {
        setInsuranceStatus(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId, bookingIdParam]);

  useEffect(() => {
    let cancelled = false;
    if (!activeBookingId) return;

    async function resolveInsuranceConfig() {
      const { data } = await supabase
        .from('bookings')
        .select('boat_id, boats(id, name, type)')
        .eq('id', activeBookingId)
        .maybeSingle();

      if (cancelled) return;
      if (!data) {
        setInsuranceConfig(PONTOON_INSURANCE);
        return;
      }

      setInsuranceConfig(
        getInsuranceConfigForBooking({
          boat_id: data.boat_id,
          boats: data.boats,
        })
      );
    }

    void resolveInsuranceConfig();
    return () => {
      cancelled = true;
    };
  }, [activeBookingId]);

  const goInsuranceRequired = useMemo(
    () =>
      wrapRouterNavigate(
        'booking_success',
        'insurance_required',
        navigate,
        `/insurance-required?bookingId=${encodeURIComponent(activeBookingId)}`
      ),
    [navigate, activeBookingId]
  );

  const goVerifyUpload = useMemo(
    () =>
      wrapRouterNavigate(
        'booking_success',
        'verify_upload',
        navigate,
        `/verify?bookingId=${encodeURIComponent(activeBookingId)}`
      ),
    [navigate, activeBookingId]
  );

  const showInsuranceNudge = insuranceStatus !== null && insuranceStatus !== 'verified';
  const showReadyForDeparture = bookingStatus === 'ready_for_departure';

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
          {sessionId ? 'Confirming your payment…' : 'Loading your confirmation…'}
        </h1>
        <p className="mt-3 text-sm text-slate-400">
          {sessionId ? 'Payment confirmed — saving your reservation.' : 'Almost there.'}
        </p>
      </div>
    );
  }

  if (error || !activeBookingId) {
    return shell(
      <div className="lz-card-glass rounded-[var(--lz-radius-card)] p-8 text-center">
        <h1 className="font-display text-xl font-bold uppercase tracking-[0.12em] text-white md:text-2xl">
          Could not load confirmation
        </h1>
        <p className="mt-3 text-sm text-slate-400">
          {error || 'Please contact support with your payment receipt so we can complete this manually.'}
        </p>
        {statusMessage ? (
          <p className="mt-4 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-50">
            {statusMessage}
          </p>
        ) : null}
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
      {showReadyForDeparture ? (
        <div className="mb-6 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-center text-emerald-50">
          <p className="text-sm font-semibold md:text-base">
            <span aria-hidden>🚤</span> Ready for departure
          </p>
          <p className="mt-1 text-xs text-emerald-100/90 md:text-sm">
            Your booking is approved and cleared for pickup. See your confirmation email for ramp details.
          </p>
        </div>
      ) : null}

      {showInsuranceNudge ? (
        <div className="mb-6 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-center text-amber-50">
          <p className="text-sm font-semibold md:text-base">
            <span aria-hidden>⚠️</span> Insurance Required Before Departure
          </p>
          <p className="mt-1 text-xs text-amber-100/90 md:text-sm">
            You&apos;re booked — finish Buoy coverage before your trip. Scan the QR or open the link below.
          </p>
          <p className="mt-1 text-xs font-semibold text-amber-50/95 md:text-sm">
            {insuranceConfig.label}
          </p>
        </div>
      ) : null}

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
        {statusMessage ? <p className="mt-3 text-sm font-semibold text-emerald-100">{statusMessage}</p> : null}
      </div>
      <div className="mt-8 rounded-[var(--lz-radius)] border border-white/10 bg-slate-950/50 p-4 text-left">
        <div className="flex items-start gap-3">
          <Hash className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400/80" aria-hidden />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Booking ID</p>
            <p className="mt-1 break-all font-mono text-sm font-semibold text-white">{activeBookingId}</p>
          </div>
        </div>
      </div>

      {showInsuranceNudge ? (
        <div className="mt-8 rounded-[var(--lz-radius)] border border-white/15 bg-white p-4 md:p-5">
          <div className="flex justify-center">
            <img
              src={insuranceConfig.qrImage}
              alt={`Scan to complete Buoy rental insurance for ${insuranceConfig.label}`}
              width={1500}
              height={1500}
              className="h-auto w-full max-w-[min(100%,240px)] min-w-[250px] object-contain"
              decoding="async"
            />
          </div>
          <p className="mt-3 text-center text-xs font-medium text-slate-700">
            <span aria-hidden>📱</span> Scan with your phone camera
          </p>
          <div className="mt-4 flex justify-center">
            <a
              href={insuranceConfig.checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={wrapSyncClick('booking_success_external_buoy_banner', () => {
                /* href */
              })}
              className="lz-btn-primary inline-flex items-center justify-center gap-2 text-sm !normal-case !tracking-wide"
            >
              Complete Insurance
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
            </a>
          </div>
        </div>
      ) : null}

      <div className="mt-8 border-t border-white/10 pt-8 text-left">
        <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">
          Step 4 — Complete your booking
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          You must obtain short-term rental insurance before your trip. This is required for approval.
        </p>
        <p className="mt-2 text-xs font-semibold text-cyan-100/90">{insuranceConfig.label}</p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <button
            type="button"
            onClick={goInsuranceRequired}
            className="lz-btn-primary inline-flex justify-center text-center text-sm !normal-case !tracking-wide"
          >
            Waivers &amp; insurance
          </button>
          <a
            href={insuranceConfig.checkoutUrl}
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
