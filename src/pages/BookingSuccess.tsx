import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, ExternalLink, Hash, MapPin } from 'lucide-react';
import BookingFlowStepIndicator from '../components/BookingFlowStepIndicator';
import {
  PONTOON_INSURANCE,
  getInsuranceConfigForBooking,
  type BuoyInsuranceConfig,
} from '../config/buoyInsurance';
import { env } from '../config/env.js';
import { wrapNavigateClick, wrapRouterNavigate, wrapSyncClick } from '../lib/clickPerf';
import { supabase } from '../lib/supabase';
import {
  ROCKET_LAUNCH_MIN_GUESTS,
  ROCKET_SCHEDULE_NOTICE,
  ROCKET_SHARED_CHARTER_DISCLOSURE,
} from '../lib/rocketLaunchPackages';

interface BookingSuccessProps {
  onNavigate: (page: string) => void;
}

interface ConfirmationSummary {
  bookingId: string;
  reservationNumber?: string | null;
  bookingType: string | null;
  charterType: string | null;
  charterSeating?: string | null;
  status: string | null;
  paymentStatus: string | null;
  departureConfirmationStatus?: string | null;
  rocketSharedAwaitingMinimum?: boolean;
  rocketDepartureConfirmed?: boolean;
  waiverSigned: boolean;
  confirmationEmailSent: boolean;
  customerEmail: string | null;
  dateLabel: string;
  timeRange: string;
  guests: number;
  durationLabel?: string | null;
  amountPaid?: number | null;
  experience: string;
  boatName: string | null;
  meeting: {
    name: string;
    address1: string | null;
    city: string;
    state: string;
    postalCode: string | null;
    fullAddress: string;
    instructions: string | null;
    directionsNote: string | null;
    mapsUrl: string | null;
  } | null;
}

export default function BookingSuccess({ onNavigate }: BookingSuccessProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = (searchParams.get('session_id') || '').trim();
  const bookingIdParam = (searchParams.get('bookingId') || '').trim();
  const [bookingId, setBookingId] = useState(bookingIdParam);
  const [summary, setSummary] = useState<ConfirmationSummary | null>(null);
  const [insuranceStatus, setInsuranceStatus] = useState<string | null>(null);
  const [bookingStatus, setBookingStatus] = useState<string | null>(null);
  const [insuranceConfig, setInsuranceConfig] = useState<BuoyInsuranceConfig>(PONTOON_INSURANCE);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const finalizedRef = useRef(false);

  const activeBookingId = bookingId || bookingIdParam;

  const loadConfirmationSummary = async (api: string, id: string) => {
    const res = await fetch(`${api}/api/public/booking-confirmation-summary?bookingId=${encodeURIComponent(id)}`);
    const payload = (await res.json().catch(() => ({}))) as ConfirmationSummary & { error?: string };
    if (!res.ok) return null;
    setSummary(payload);
    if (payload.status) setBookingStatus(payload.status);
    return payload;
  };

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
        const loaded = await loadConfirmationSummary(api, statusPayload.bookingId);
        setStatusMessage(
          loaded?.rocketSharedAwaitingMinimum
            ? 'Payment received. Your rocket launch seats are reserved — awaiting minimum guest count.'
            : 'Payment received. Your reservation is confirmed.'
        );
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
          await loadConfirmationSummary(api, payload.bookingId);

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
        await loadConfirmationSummary(api, bookingIdParam);
        const res = await fetch(
          `${api}/api/public/booking-insurance-status?bookingId=${encodeURIComponent(bookingIdParam)}`
        );
        const payload = (await res.json().catch(() => ({}))) as {
          insurance_status?: string;
          status?: string;
          error?: string;
        };
        if (res.ok) {
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

  const goWaiversInsurance = useMemo(
    () =>
      wrapRouterNavigate(
        'booking_success',
        'waivers_insurance',
        navigate,
        `/waivers-insurance?bookingId=${encodeURIComponent(activeBookingId)}`
      ),
    [navigate, activeBookingId]
  );

  const isCharter = summary?.bookingType === 'charter';
  const rocketAwaitingMinimum = Boolean(summary?.rocketSharedAwaitingMinimum);
  const showInsuranceNudge = !isCharter && insuranceStatus !== null && insuranceStatus !== 'verified';
  const showReadyForDeparture = bookingStatus === 'ready_for_departure';
  const meeting = summary?.meeting;
  const emailForDisplay = summary?.customerEmail || null;

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
            Your booking is approved and cleared for pickup.
          </p>
        </div>
      ) : null}

      {rocketAwaitingMinimum ? (
        <div className="mb-6 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-left text-amber-50">
          <p className="text-sm font-semibold md:text-base">Reservation received — minimum guests not reached yet</p>
          <p className="mt-2 text-sm leading-relaxed text-amber-100/95">{ROCKET_SHARED_CHARTER_DISCLOSURE}</p>
          <p className="mt-2 text-xs leading-relaxed text-amber-100/90 md:text-sm">
            This shared departure needs at least {ROCKET_LAUNCH_MIN_GUESTS} total booked guests before it is fully
            confirmed. Meeting directions will be emailed once the minimum is reached.
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
        <div
          className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border shadow-[0_0_24px_rgba(52,211,153,0.2)] ${
            rocketAwaitingMinimum
              ? 'border-amber-400/40 bg-amber-500/15'
              : 'border-emerald-400/40 bg-emerald-500/15'
          }`}
        >
          <CheckCircle
            className={`h-8 w-8 ${rocketAwaitingMinimum ? 'text-amber-300' : 'text-emerald-300'}`}
            aria-hidden
          />
        </div>
        <h1 className="font-display text-2xl font-bold uppercase tracking-[0.1em] text-white md:text-3xl">
          {rocketAwaitingMinimum
            ? 'Reservation received'
            : isCharter
              ? "You're booked!"
              : 'Deposit received'}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-300 md:text-base">
          {rocketAwaitingMinimum
            ? 'Your payment was received and your rocket launch seats are reserved. We will contact you once the shared departure reaches the minimum guest count or if we need to discuss options.'
            : isCharter
              ? 'Your charter reservation is confirmed. Save the meeting location below — you do not need to wait for email to know where to meet us.'
              : 'Your booking is submitted. Complete rental insurance below before your trip.'}
        </p>
        {summary?.confirmationEmailSent && emailForDisplay ? (
          <p className="mt-3 text-sm text-emerald-100">
            We sent your booking confirmation and trip details to{' '}
            <span className="font-semibold text-white">{emailForDisplay}</span>.
          </p>
        ) : rocketAwaitingMinimum && emailForDisplay ? (
          <p className="mt-3 text-sm text-amber-100">
            We sent a reservation confirmation to{' '}
            <span className="font-semibold text-white">{emailForDisplay}</span>. A full departure confirmation with
            meeting directions will follow once the minimum is reached.
          </p>
        ) : emailForDisplay ? (
          <p className="mt-3 text-sm text-slate-400">
            Your confirmation email to {emailForDisplay} is being processed. Trip details are shown below.
          </p>
        ) : null}
        {rocketAwaitingMinimum ? (
          <p className="mt-4 rounded-lg border border-amber-400/20 bg-amber-950/20 px-3 py-2 text-left text-xs leading-relaxed text-amber-100/90 md:text-sm">
            {ROCKET_SCHEDULE_NOTICE}
          </p>
        ) : null}
        {statusMessage ? <p className="mt-3 text-sm font-semibold text-emerald-100">{statusMessage}</p> : null}
      </div>

      {summary ? (
        <div className="mt-8 rounded-[var(--lz-radius)] border border-white/10 bg-slate-950/50 p-5 text-left">
          <p className="text-lg font-bold text-white">{summary.experience}</p>
          <p className="mt-4 text-xl font-bold uppercase tracking-wide text-white">{summary.dateLabel}</p>
          <p className="mt-2 text-2xl font-bold text-cyan-200">{summary.timeRange}</p>
          <p className="mt-4 text-base text-slate-200">
            {summary.guests} guest{summary.guests === 1 ? '' : 's'}
            {summary.durationLabel ? ` · ${summary.durationLabel}` : ''}
          </p>
          {summary.amountPaid != null ? (
            <p className="mt-2 text-base font-semibold text-white">Paid: ${summary.amountPaid.toFixed(2)}</p>
          ) : null}
          {summary.reservationNumber ? (
            <p className="mt-3 text-sm font-semibold text-slate-300">
              Reservation #{summary.reservationNumber}
            </p>
          ) : null}
        </div>
      ) : null}

      {meeting ? (
        <div className="mt-6 rounded-[var(--lz-radius)] border-2 border-cyan-300/50 bg-cyan-950/30 p-5 text-left">
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-6 w-6 shrink-0 text-cyan-200" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold uppercase tracking-wide text-cyan-100">
                Important — where to meet
              </p>
              <p className="mt-3 text-xl font-bold uppercase text-white">{meeting.name}</p>
              {meeting.address1 ? (
                <>
                  <p className="mt-2 text-base text-slate-100">{meeting.address1}</p>
                  <p className="text-base text-slate-200">
                    {meeting.city}, {meeting.state} {meeting.postalCode}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-base text-slate-200">
                  {meeting.directionsNote || 'Contact us for exact ramp details before departure.'}
                </p>
              )}
              {meeting.instructions ? (
                <p className="mt-3 text-base leading-relaxed text-slate-200">{meeting.instructions}</p>
              ) : null}
              {meeting.mapsUrl ? (
                <div className="mt-5">
                  <a
                    href={meeting.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={wrapSyncClick('booking_success_get_directions', () => {
                      /* href */
                    })}
                    className="lz-btn-primary flex min-h-12 w-full items-center justify-center gap-2 text-base !normal-case !tracking-wide"
                  >
                    <MapPin className="h-5 w-5 shrink-0" aria-hidden />
                    Get Directions
                    <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
                  </a>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {isCharter && summary && !summary.waiverSigned ? (
        <div className="mt-6 rounded-[var(--lz-radius)] border border-amber-300/40 bg-amber-950/25 p-5 text-left">
          <p className="text-sm font-bold uppercase tracking-wide text-amber-100">One last thing</p>
          <p className="mt-2 text-base text-slate-200">
            Complete your waiver before arrival. It usually takes about 2 minutes.
          </p>
          <button
            type="button"
            onClick={goWaiversInsurance}
            className="lz-btn-primary mt-5 flex min-h-12 w-full items-center justify-center text-base !normal-case !tracking-wide"
          >
            Complete Waiver
          </button>
        </div>
      ) : null}

      {summary?.reservationNumber ? (
        <div className="mt-6 rounded-[var(--lz-radius)] border border-white/10 bg-slate-950/50 p-4 text-left">
          <div className="flex items-start gap-3">
            <Hash className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400/80" aria-hidden />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reservation number</p>
              <p className="mt-1 text-base font-semibold text-white">{summary.reservationNumber}</p>
            </div>
          </div>
        </div>
      ) : null}

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

      {!isCharter ? (
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
              onClick={goWaiversInsurance}
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
          </div>
        </div>
      ) : null}

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
