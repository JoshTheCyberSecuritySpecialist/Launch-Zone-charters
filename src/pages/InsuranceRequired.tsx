import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ExternalLink, Lock, Sparkles, Zap } from 'lucide-react';
import BookingFlowStepIndicator from '../components/BookingFlowStepIndicator';
import { env } from '../config/env.js';
import { wrapRouterNavigate, wrapSyncClick } from '../lib/clickPerf';
import {
  PONTOON_INSURANCE,
  getInsuranceConfigForBooking,
  type BuoyInsuranceConfig,
} from '../config/buoyInsurance';
import { supabase } from '../lib/supabase';

interface InsuranceRequiredProps {
  onNavigate: (page: string) => void;
}

export default function InsuranceRequired({ onNavigate }: InsuranceRequiredProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = (searchParams.get('session_id') || '').trim();
  const bookingIdParam = (searchParams.get('bookingId') || '').trim();
  const boatIdParam = (searchParams.get('boatId') || '').trim();
  const needsBoatSelection = searchParams.get('needBoatSelection') === '1';

  const [bookingId, setBookingId] = useState(bookingIdParam);
  const [customerEmail, setCustomerEmail] = useState('');
  const [error, setError] = useState('');
  const [insuranceConfig, setInsuranceConfig] = useState<BuoyInsuranceConfig>(PONTOON_INSURANCE);
  /** True only while finalizing a paid Stripe session (session_id in URL). */
  const [loading, setLoading] = useState(() => Boolean(sessionId));
  const finalizedRef = useRef(false);

  const hasBookingRef = Boolean(bookingId);

  useEffect(() => {
    if (!env.apiUrlConfigured || !env.apiUrl) {
      setError('API URL is not configured. Set VITE_API_URL to your backend origin.');
      setLoading(false);
      return;
    }

    // Standalone QR page — works without bookingId (booking flow) or with ?bookingId=
    if (!sessionId) {
      setBookingId(bookingIdParam || '');
      setLoading(false);
      return;
    }

    if (finalizedRef.current) return;
    finalizedRef.current = true;

    const api = env.apiUrl;
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
        if (payload.email) setCustomerEmail(payload.email);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not finalize booking.');
        setLoading(false);
      }
    })();
  }, [sessionId, bookingIdParam]);

  useEffect(() => {
    let cancelled = false;

    async function resolveInsuranceConfig() {
      if (bookingId) {
        const { data } = await supabase
          .from('bookings')
          .select('boat_id, boats(id, name, type)')
          .eq('id', bookingId)
          .maybeSingle();
        if (cancelled) return;
        if (data) {
          setInsuranceConfig(
            getInsuranceConfigForBooking({
              boat_id: data.boat_id,
              boats: data.boats,
            })
          );
          return;
        }
      }

      if (boatIdParam) {
        const { data } = await supabase
          .from('boats')
          .select('id, name, type')
          .eq('id', boatIdParam)
          .maybeSingle();
        if (cancelled) return;
        setInsuranceConfig(
          getInsuranceConfigForBooking({
            boat_id: boatIdParam,
            boats: data ?? null,
          })
        );
        return;
      }

      setInsuranceConfig(PONTOON_INSURANCE);
    }

    void resolveInsuranceConfig();
    return () => {
      cancelled = true;
    };
  }, [bookingId, boatIdParam]);

  const goConfirmation = wrapRouterNavigate(
    'insurance_required',
    'booking_confirmation',
    navigate,
    `/booking-success?bookingId=${encodeURIComponent(bookingId)}`
  );

  const goVerifyUpload = wrapRouterNavigate(
    'insurance_required',
    'verify_upload',
    navigate,
    `/verify?bookingId=${encodeURIComponent(bookingId)}`
  );

  const handleCompleteLater = wrapSyncClick('insurance_required_complete_later', () => {
    if (bookingId) {
      goConfirmation();
    } else {
      onNavigate('book');
    }
  });

  const shell = (inner: ReactNode) => (
    <div className="relative min-h-screen overflow-hidden px-4 py-12 md:py-16">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.45]"
        aria-hidden
        style={{
          background:
            'radial-gradient(ellipse 120% 80% at 50% -20%, rgba(251, 146, 60, 0.35), transparent 55%), radial-gradient(ellipse 90% 60% at 100% 50%, rgba(59, 130, 246, 0.12), transparent 50%), linear-gradient(180deg, #0a1628 0%, #0f172a 45%, #0c1220 100%)',
        }}
      />
      <div className="relative z-[1] mx-auto max-w-lg">
        <BookingFlowStepIndicator currentStep={4} className="mb-8" />
        {inner}
      </div>
    </div>
  );

  if (loading) {
    return shell(
      <div className="rounded-[var(--lz-radius-card)] border border-white/10 bg-[#0c1929]/90 p-8 text-center shadow-xl backdrop-blur-md">
        <p className="font-display text-lg font-bold uppercase tracking-[0.12em] text-white md:text-xl">
          Confirming your reservation…
        </p>
        <p className="mt-3 text-sm text-slate-400">
          You&apos;re booked — we&apos;re locking in your payment now.
        </p>
      </div>
    );
  }

  if (error) {
    return shell(
      <div className="rounded-[var(--lz-radius-card)] border border-white/10 bg-[#0c1929]/90 p-8 text-center shadow-xl backdrop-blur-md">
        <h1 className="font-display text-xl font-bold uppercase tracking-[0.12em] text-white md:text-2xl">
          Something went wrong
        </h1>
        <p className="mt-3 text-sm text-slate-400">{error}</p>
        <button
          type="button"
          onClick={() => onNavigate('book')}
          className="lz-btn-primary mt-8 w-full justify-center text-sm !normal-case !tracking-wide"
        >
          Book now
        </button>
      </div>
    );
  }

  return shell(
    <div className="rounded-[var(--lz-radius-card)] border border-white/10 bg-[#0c1929]/95 p-6 text-slate-200 shadow-2xl backdrop-blur-md md:p-10">
      <div className="text-center">
        {hasBookingRef ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/35 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-200">
            Booking Confirmed <span aria-hidden>✅</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/35 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-cyan-200">
            Buoy rental insurance
          </span>
        )}
        <h1 className="mt-5 font-display text-2xl font-bold leading-tight text-white md:text-[1.65rem]">
          Rental Insurance Required Before Departure
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-slate-300 md:text-base">
          {hasBookingRef ? (
            <>
              Your booking is confirmed. To finalize your trip, renter insurance must be completed. This
              protects you, your passengers, and the vessel.
            </>
          ) : (
            <>
              Scan the QR code or use the button below to get Buoy boat rental insurance. Coverage is
              required before your boat can be released.
            </>
          )}
        </p>
        <p className="mt-2 text-sm font-semibold text-cyan-100/95">{insuranceConfig.label}</p>
        <p className="mt-2 text-sm font-medium text-amber-200/95">
          Most renters complete this in under 2 minutes.
        </p>
        {!bookingId && !boatIdParam && needsBoatSelection ? (
          <p className="mt-3 text-sm font-medium text-amber-200/95">
            Select your boat first so we can show the matching insurance registration.
          </p>
        ) : null}
      </div>

      <div className="mx-auto mt-8 max-w-sm rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_12px_40px_rgba(0,0,0,0.25)] md:p-7">
        <div className="flex justify-center">
          <img
            src={insuranceConfig.qrImage}
            alt={`Scan to complete Buoy rental insurance for ${insuranceConfig.label}`}
            width={1500}
            height={1500}
            className="h-auto w-full max-w-[min(100%,280px)] min-w-[250px] object-contain"
            decoding="async"
          />
        </div>
        <p className="mt-4 text-center text-sm font-semibold text-slate-800">
          <span aria-hidden>📱</span> Scan with your phone camera
        </p>
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
        <a
          href={insuranceConfig.checkoutUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={wrapSyncClick('insurance_required_external_buoy', () => {
            /* navigate via href */
          })}
          className="lz-btn-primary inline-flex flex-1 items-center justify-center gap-2 text-center text-sm !normal-case !tracking-wide sm:flex-initial sm:min-w-[200px]"
        >
          Get Insurance Now
          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
        </a>
        <button
          type="button"
          onClick={handleCompleteLater}
          className="inline-flex flex-1 items-center justify-center rounded-[var(--lz-radius)] border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:border-amber-400/40 hover:bg-white/10 sm:flex-initial sm:min-w-[220px]"
        >
          I&apos;ll Complete This Before My Trip
        </button>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-white/10 pt-6 text-center text-xs font-medium uppercase tracking-wider text-slate-500">
        <span className="inline-flex items-center gap-1.5 text-slate-400">
          <Lock className="h-3.5 w-3.5 text-amber-400/90" aria-hidden />
          Secure
        </span>
        <span className="text-slate-600" aria-hidden>
          •
        </span>
        <span className="inline-flex items-center gap-1.5 text-slate-400">
          <Zap className="h-3.5 w-3.5 text-amber-400/90" aria-hidden />
          Fast
        </span>
        <span className="text-slate-600" aria-hidden>
          •
        </span>
        <span className="inline-flex items-center gap-1.5 text-slate-400">
          <Sparkles className="h-3.5 w-3.5 text-cyan-300/90" aria-hidden />
          Required Before Departure
        </span>
      </div>

      {hasBookingRef ? (
        <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">
          You&apos;re booked <span aria-hidden>✅</span> Finish insurance before your trip{' '}
          <span aria-hidden>🚤</span> — same confirmation email for your records.
          {customerEmail ? (
            <>
              {' '}
              Sent to <span className="text-slate-400">{customerEmail}</span>.
            </>
          ) : null}
        </p>
      ) : (
        <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">
          After you purchase, return to your booking to upload proof or paste your Buoy confirmation link.
        </p>
      )}

      {hasBookingRef ? (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={goVerifyUpload}
            className="text-sm font-semibold text-cyan-300/90 underline decoration-cyan-500/30 hover:text-cyan-200"
          >
            Upload license &amp; proof on the verification page →
          </button>
        </div>
      ) : null}
    </div>
  );
}
