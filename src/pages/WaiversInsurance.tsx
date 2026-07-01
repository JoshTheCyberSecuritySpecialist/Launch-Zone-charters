import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Calendar, ClipboardCheck, ExternalLink, Loader2, Search, Upload, Shield } from 'lucide-react';
import WaiverBlock, { waiverFormComplete, type WaiverFormData } from '../components/booking/WaiverBlock';
import PreTripStatusPanel from '../components/booking/PreTripStatusPanel';
import ManualPreTripSubmission from '../components/booking/ManualPreTripSubmission';
import {
  confirmWaiversAccess,
  fetchPreTripStatus,
  fetchWaiversBookingById,
  findPublicBooking,
  markInsuranceProof,
  signBookingWaiver,
  type PublicBookingMatch,
  type PreTripStatusPayload,
} from '../lib/publicBooking';
import {
  bookingAllCustomerStepsDone,
  buildBookingChecklist,
  buildSubmissionChecklist,
  deriveBookingOverallStatus,
  deriveSubmissionOverallStatus,
} from '../lib/preTripStatus';
import { getInsuranceConfigForBooking } from '../config/buoyInsurance';
import { uploadBookingDocument } from '../lib/storageUpload';
import { env } from '../config/env.js';
import { wrapSyncClick } from '../lib/clickPerf';

interface WaiversInsuranceProps {
  onNavigate: (page: string) => void;
}

const FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';

function formatTripDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function WaiversInsurance({ onNavigate }: WaiversInsuranceProps) {
  const [searchParams] = useSearchParams();
  const bookingIdFromUrl = searchParams.get('bookingId')?.trim() || '';
  const submissionIdFromUrl = searchParams.get('submissionId')?.trim() || '';

  const [findEmail, setFindEmail] = useState('');
  const [findPhone, setFindPhone] = useState('');
  const [findCode, setFindCode] = useState('');
  const [findLoading, setFindLoading] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [magicLinkLoading, setMagicLinkLoading] = useState(Boolean(bookingIdFromUrl));

  const [booking, setBooking] = useState<PublicBookingMatch | null>(null);
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [magicLinkMode, setMagicLinkMode] = useState(false);
  const [phoneConfirmNeeded, setPhoneConfirmNeeded] = useState(false);

  const [waiverData, setWaiverData] = useState<WaiverFormData>({ agreed: false, signature: '' });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [damageFeeAcknowledged, setDamageFeeAcknowledged] = useState(false);
  const [waiverBusy, setWaiverBusy] = useState(false);
  const [waiverMessage, setWaiverMessage] = useState<string | null>(null);

  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseMessage, setLicenseMessage] = useState<string | null>(null);
  const [proofBusy, setProofBusy] = useState(false);
  const [proofMessage, setProofMessage] = useState<string | null>(null);

  const [manualMode, setManualMode] = useState(false);
  const [manualSubmissionId, setManualSubmissionId] = useState<string | null>(null);
  const [entryMode, setEntryMode] = useState<'booking' | 'manual' | null>(
    bookingIdFromUrl ? 'booking' : null
  );

  const [statusEmail, setStatusEmail] = useState('');
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [submissionStatus, setSubmissionStatus] = useState<PreTripStatusPayload | null>(null);

  const fieldClass =
    'lz-input-on-dark w-full rounded-xl border border-white/15 bg-slate-950/85 px-4 py-3 text-base shadow-inner focus:border-[var(--lz-cta)]/55 focus:outline-none focus:ring-2 focus:ring-[var(--lz-cta)]/20';

  const isRental = booking ? !booking.captain_included : true;
  const bookingMode = isRental ? 'rental' : 'charter';

  const insuranceConfig = useMemo(
    () =>
      booking
        ? getInsuranceConfigForBooking({
            boat_id: booking.boat_id,
            boats: { id: booking.boat_id, name: booking.boat_name, type: booking.boat_type },
          })
        : null,
    [booking]
  );

  const bookingChecklist = booking ? buildBookingChecklist(booking, isRental) : [];
  const bookingOverallStatus = booking ? deriveBookingOverallStatus(booking, isRental) : null;
  const showBookingActionSteps =
    booking != null &&
    bookingOverallStatus !== 'ready_for_departure' &&
    !bookingAllCustomerStepsDone(booking, isRental);

  const loadSubmissionStatus = useCallback(async (submissionId: string, email: string) => {
    setStatusLoading(true);
    setStatusError(null);
    const result = await fetchPreTripStatus(submissionId, email);
    setStatusLoading(false);
    if (!result.ok) {
      setSubmissionStatus(null);
      setStatusError(result.error);
      return;
    }
    setSubmissionStatus(result.data);
    setManualSubmissionId(submissionId);
    setStatusEmail(email.trim().toLowerCase());
  }, []);

  useEffect(() => {
    if (!bookingIdFromUrl) return;
    let cancelled = false;

    (async () => {
      setMagicLinkLoading(true);
      setFindError(null);
      const result = await fetchWaiversBookingById(bookingIdFromUrl);
      if (cancelled) return;
      setMagicLinkLoading(false);

      if (!result.ok) {
        setFindError(result.message);
        return;
      }

      setBooking(result.booking);
      setFindEmail(result.booking.email_masked || result.booking.email || '');
      setContactEmail('');
      setContactPhone('');
      setEntryMode('booking');
      setMagicLinkMode(true);
      setPhoneConfirmNeeded(true);
      setManualMode(false);
      setManualSubmissionId(null);
      setSubmissionStatus(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [bookingIdFromUrl]);

  useEffect(() => {
    if (!submissionIdFromUrl || bookingIdFromUrl) return;
    if (statusEmail) {
      void loadSubmissionStatus(submissionIdFromUrl, statusEmail);
    }
  }, [submissionIdFromUrl, bookingIdFromUrl, statusEmail, loadSubmissionStatus]);

  const handleFindBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setFindLoading(true);
    setFindError(null);
    setSubmissionStatus(null);
    setManualSubmissionId(null);

    const result = await findPublicBooking({
      email: findEmail,
      phone: findPhone,
      code: findCode || bookingIdFromUrl || undefined,
    });

    setFindLoading(false);
    if (!result.ok) {
      setBooking(null);
      setFindError(result.message);
      setManualMode(false);
      return;
    }

    setManualMode(false);
    setMagicLinkMode(false);
    setPhoneConfirmNeeded(false);
    setBooking(result.booking);
    setContactEmail(findEmail.trim().toLowerCase());
    setContactPhone(findPhone.trim());
    setWaiverMessage(null);
    setLicenseMessage(null);
    setProofMessage(null);
  };

  const refreshBooking = async () => {
    if (magicLinkMode && bookingIdFromUrl) {
      const result = await fetchWaiversBookingById(bookingIdFromUrl);
      if (result.ok) setBooking(result.booking);
      return;
    }
    if (!contactEmail || !contactPhone) return;
    const result = await findPublicBooking({
      email: contactEmail,
      phone: contactPhone,
      code: booking?.id || findCode || undefined,
    });
    if (result.ok) setBooking(result.booking);
  };

  const actionsBlocked = magicLinkMode && phoneConfirmNeeded && !contactPhone.trim();

  const handleSignWaiver = async () => {
    if (!booking || actionsBlocked) {
      setWaiverMessage('Confirm the phone number on your booking to continue.');
      return;
    }
    if (!waiverFormComplete(waiverData, termsAccepted, damageFeeAcknowledged)) {
      setWaiverMessage('Complete all agreement checkboxes and your signature.');
      return;
    }
    setWaiverBusy(true);
    setWaiverMessage(null);
    const out = await signBookingWaiver({
      bookingId: booking.id,
      email: contactEmail,
      phone: contactPhone,
      signature: waiverData.signature.trim(),
      termsAccepted,
      damageFeeAcknowledged,
      waiverAgreed: waiverData.agreed,
    });
    setWaiverBusy(false);
    if (!out.ok) {
      setWaiverMessage(out.error || 'Could not save waiver.');
      return;
    }
    setWaiverMessage('Waiver saved.');
    await refreshBooking();
  };

  const handleLicenseUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !booking || actionsBlocked) return;

    setLicenseBusy(true);
    setLicenseMessage(null);
    const { url, error } = await uploadBookingDocument({
      file,
      folder: 'licenses',
      bookingId: booking.id,
      email: contactEmail,
      phone: contactPhone,
    });
    if (error || !url) {
      setLicenseMessage(error?.message || 'Upload failed.');
      setLicenseBusy(false);
      return;
    }

    if (!env.apiUrlConfigured || !env.apiUrl) {
      setLicenseMessage('API not configured — contact support.');
      setLicenseBusy(false);
      return;
    }

    const res = await fetch(`${env.apiUrl}/api/booking-mark-license-submitted`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: booking.id, email: contactEmail, phone: contactPhone, licenseUrl: url }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setLicenseBusy(false);
    if (!res.ok) {
      setLicenseMessage(payload.error || 'Could not attach license to booking.');
      return;
    }
    setLicenseMessage('License uploaded. Our team will review it.');
    await refreshBooking();
  };

  const handleProofUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !booking || actionsBlocked) return;

    setProofBusy(true);
    setProofMessage(null);

    const { url, error: upErr } = await uploadBookingDocument({
      file,
      folder: 'insurance',
      bookingId: booking.id,
      email: contactEmail,
      phone: contactPhone,
    });

    if (upErr || !url) {
      setProofMessage(upErr?.message || 'Upload failed.');
      setProofBusy(false);
      return;
    }

    const out = await markInsuranceProof({
      bookingId: booking.id,
      email: contactEmail,
      phone: contactPhone,
      proofUrl: url,
    });

    setProofBusy(false);
    if (!out.ok) {
      setProofMessage(out.error || 'Could not save proof.');
      return;
    }

    setProofMessage('Insurance proof uploaded.');
    await refreshBooking();
  };

  const handleLoadSubmissionStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!submissionIdFromUrl && !manualSubmissionId) return;
    const id = manualSubmissionId || submissionIdFromUrl;
    await loadSubmissionStatus(id, statusEmail);
  };

  const submissionView = submissionStatus?.submission ?? null;
  const submissionChecklist = submissionView
    ? buildSubmissionChecklist(submissionView, submissionStatus?.matched_booking ?? null)
    : [];
  const submissionOverallStatus = submissionView
    ? deriveSubmissionOverallStatus(submissionView, submissionStatus?.matched_booking ?? null)
    : null;

  const showEntryOptions =
    !booking &&
    !manualMode &&
    !manualSubmissionId &&
    !submissionStatus &&
    !magicLinkLoading &&
    !submissionIdFromUrl &&
    !entryMode;

  const showFindForm =
    !booking &&
    !manualMode &&
    !manualSubmissionId &&
    !submissionStatus &&
    !magicLinkLoading &&
    !submissionIdFromUrl &&
    entryMode === 'booking';

  const showStatusEmailGate = Boolean(submissionIdFromUrl) && !submissionStatus && !booking;

  return (
    <div className="relative min-h-screen px-4 py-10 md:py-14">
      <div className="relative z-[1] mx-auto max-w-4xl">
        <header className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300/80">Launch Zone Charters</p>
          <h1 className="font-display mt-2 text-3xl font-bold uppercase tracking-[0.08em] text-white md:text-4xl">
            Waivers &amp; Insurance
          </h1>
          <p className="mt-3 text-sm text-slate-300 md:text-base">
            Complete your pre-trip steps in a few minutes — we will guide you through each one.
          </p>
        </header>

        {magicLinkLoading ? (
          <div className="lz-card-glass flex items-center justify-center gap-3 rounded-[var(--lz-radius-card)] p-10">
            <Loader2 className="h-6 w-6 animate-spin text-cyan-300" aria-hidden />
            <span className="text-sm text-slate-300">Loading your booking…</span>
          </div>
        ) : null}

        {showStatusEmailGate ? (
          <section className="lz-card-glass mx-auto max-w-2xl rounded-[var(--lz-radius-card)] p-6 md:p-8">
            <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">Check your status</h2>
            <p className="mt-2 text-sm text-slate-400">
              Enter the email you used when submitting your documents.
            </p>
            <form onSubmit={(e) => void handleLoadSubmissionStatus(e)} className="mt-5 space-y-4">
              <input
                type="email"
                required
                autoComplete="email"
                value={statusEmail}
                onChange={(e) => setStatusEmail(e.target.value)}
                className={fieldClass}
                placeholder="you@email.com"
              />
              <button
                type="submit"
                disabled={statusLoading}
                className="lz-btn-primary flex w-full items-center justify-center gap-2 py-4 text-base !normal-case !tracking-wide"
              >
                {statusLoading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : null}
                View status
              </button>
              {statusError ? (
                <p className="text-sm text-amber-100" role="alert">
                  {statusError}
                </p>
              ) : null}
            </form>
          </section>
        ) : null}

        {showEntryOptions ? (
          <section className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <article className="lz-card-glass flex h-full flex-col rounded-[var(--lz-radius-card)] border border-cyan-400/20 p-6 md:p-7">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-400/10 text-cyan-200">
                  <Calendar className="h-6 w-6" aria-hidden />
                </div>
                <h2 className="mt-5 text-xl font-bold text-white">I Have a Booking</h2>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-300">
                  Find your trip and complete your waiver, license, and insurance steps.
                </p>
                <button
                  type="button"
                  onClick={wrapSyncClick('waivers_choose_booking_lookup', () => {
                    setEntryMode('booking');
                    setManualMode(false);
                    setFindError(null);
                  })}
                  className="lz-btn-primary mt-6 flex w-full items-center justify-center gap-2 py-4 text-base !normal-case !tracking-wide"
                >
                  <Search className="h-5 w-5" aria-hidden />
                  Find My Booking
                </button>
              </article>

              <article className="lz-card-glass flex h-full flex-col rounded-[var(--lz-radius-card)] border border-[var(--lz-cta)]/25 p-6 md:p-7">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--lz-cta)]/30 bg-[var(--lz-cta)]/10 text-[var(--lz-cta)]">
                  <ClipboardCheck className="h-6 w-6" aria-hidden />
                </div>
                <h2 className="mt-5 text-xl font-bold text-white">I Don&apos;t Have a Booking Yet</h2>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-300">
                  Booked through Groupon, phone, text, or need to complete requirements before we match your trip?
                </p>
                <button
                  type="button"
                  onClick={wrapSyncClick('waivers_choose_manual_submission', () => {
                    setEntryMode('manual');
                    setManualMode(true);
                    setFindError(null);
                  })}
                  className="lz-btn-primary mt-6 flex w-full items-center justify-center gap-2 py-4 text-base !normal-case !tracking-wide"
                >
                  <Shield className="h-5 w-5" aria-hidden />
                  Continue Without Booking
                </button>
              </article>
            </div>

            <p className="rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3 text-center text-sm text-slate-300">
              Not sure? Choose "I Don&apos;t Have a Booking Yet" and our team will match your documents manually.
            </p>
          </section>
        ) : null}

        {showFindForm ? (
          <section className="lz-card-glass mx-auto max-w-2xl rounded-[var(--lz-radius-card)] p-6 md:p-8">
            <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">
              Step 1 — Find your booking
            </h2>
            <form onSubmit={(e) => void handleFindBooking(e)} className="mt-5 space-y-4">
              <div>
                <label htmlFor="wi-email" className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                  Email
                </label>
                <input
                  id="wi-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={findEmail}
                  onChange={(e) => setFindEmail(e.target.value)}
                  className={fieldClass}
                />
              </div>
              <div>
                <label htmlFor="wi-phone" className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                  Phone number
                </label>
                <input
                  id="wi-phone"
                  type="tel"
                  required
                  autoComplete="tel"
                  value={findPhone}
                  onChange={(e) => setFindPhone(e.target.value)}
                  className={fieldClass}
                  placeholder="Same number used when booking"
                />
              </div>
              <div>
                <label htmlFor="wi-code" className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                  Booking ID or Groupon code <span className="text-slate-500">(optional)</span>
                </label>
                <input
                  id="wi-code"
                  type="text"
                  value={findCode}
                  onChange={(e) => setFindCode(e.target.value)}
                  className={fieldClass}
                  placeholder="Booking ID or GROUPON code"
                />
              </div>
              {findError ? (
                <div className="rounded-xl border border-amber-400/30 bg-amber-950/40 px-4 py-4">
                  <p className="text-sm text-amber-100" role="alert">
                    {findError}
                  </p>
                  <p className="mt-2 text-sm text-amber-100/90">
                    We could not find your booking. You can still complete your pre-trip requirements and
                    our team will match it manually.
                  </p>
                  <button
                    type="button"
                    onClick={wrapSyncClick('waivers_insurance_manual_start', () => {
                      setEntryMode('manual');
                      setManualMode(true);
                      setFindError(null);
                    })}
                    className="lz-btn-primary mt-4 w-full justify-center py-4 text-base !normal-case !tracking-wide"
                  >
                    Continue Without Booking
                  </button>
                </div>
              ) : null}
              <button
                type="submit"
                disabled={findLoading}
                className="lz-btn-primary flex w-full items-center justify-center gap-2 py-4 text-base !normal-case !tracking-wide"
              >
                {findLoading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Search className="h-5 w-5" aria-hidden />}
                Find My Booking
              </button>
            </form>
          </section>
        ) : null}

        {manualMode && !manualSubmissionId && !submissionStatus ? (
          <div className="mx-auto max-w-2xl">
            <ManualPreTripSubmission
              initialEmail={findEmail}
              initialPhone={findPhone}
              initialGrouponCode={findCode}
              onNavigateTerms={() => onNavigate('terms')}
              onSubmitted={(id, email) => {
                setManualSubmissionId(id);
                setManualMode(false);
                setStatusEmail(email);
                void loadSubmissionStatus(id, email);
              }}
              onBack={() => {
                setManualMode(false);
                setEntryMode(null);
              }}
            />
          </div>
        ) : null}

        {submissionView && submissionOverallStatus ? (
          <div className="mx-auto max-w-2xl space-y-6">
            <PreTripStatusPanel
              status={submissionOverallStatus}
              checklist={submissionChecklist}
              referenceId={submissionView.id}
            />
            <button
              type="button"
              onClick={wrapSyncClick('waivers_refresh_submission_status', () =>
                void loadSubmissionStatus(submissionView.id, statusEmail)
              )}
              disabled={statusLoading}
              className="lz-btn-primary w-full justify-center py-3 text-sm !normal-case !tracking-wide"
            >
              {statusLoading ? 'Refreshing…' : 'Refresh status'}
            </button>
          </div>
        ) : null}

        {booking && bookingOverallStatus ? (
          <div className="mx-auto max-w-2xl space-y-6">
            <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">Your booking</h2>
                  <p className="mt-2 text-lg font-semibold text-white">{booking.customer_name}</p>
                  <p className="text-sm text-slate-400">
                    {booking.boat_name || 'Boat'} · {formatTripDate(booking.start_time)}
                  </p>
                  <p className="mt-1 font-mono text-xs text-slate-500">ID: {booking.id}</p>
                </div>
                {!magicLinkMode ? (
                  <button
                    type="button"
                    onClick={wrapSyncClick('waivers_insurance_change_booking', () => {
                      setBooking(null);
                      setEntryMode('booking');
                      setMagicLinkMode(false);
                    })}
                    className="text-sm font-semibold text-cyan-300 underline decoration-cyan-500/30"
                  >
                    Find a different booking
                  </button>
                ) : null}
              </div>
            </section>

            <PreTripStatusPanel
              status={bookingOverallStatus}
              checklist={bookingChecklist}
              referenceId={booking.id}
            />

            {magicLinkMode && phoneConfirmNeeded ? (
              <section className="lz-card-glass rounded-[var(--lz-radius-card)] border border-cyan-400/25 p-6">
                <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">
                  Confirm your phone
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  For security, enter the phone number on your booking (ends in{' '}
                  {booking.phone_last4 || '****'}).
                </p>
                <input
                  type="tel"
                  autoComplete="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className={`${fieldClass} mt-4`}
                  placeholder="Your phone number"
                />
                <button
                  type="button"
                  onClick={wrapSyncClick('waivers_phone_confirm', () => {
                    void (async () => {
                      if (!contactPhone.trim() || !booking) return;
                      const result = await confirmWaiversAccess({
                        bookingId: booking.id,
                        phone: contactPhone.trim(),
                      });
                      if (!result.ok) {
                        setWaiverMessage(result.message);
                        return;
                      }
                      setBooking(result.booking);
                      setContactEmail(result.booking.email || '');
                      setPhoneConfirmNeeded(false);
                      setWaiverMessage(null);
                    })();
                  })}
                  className="lz-btn-primary mt-4 w-full justify-center py-4 text-base !normal-case !tracking-wide"
                >
                  Continue
                </button>
              </section>
            ) : null}

            {showBookingActionSteps ? (
              <>
                {!booking.waiver_signed ? (
                  <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
                    <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">
                      Sign waiver
                    </h2>
                    <WaiverBlock
                      bookingMode={bookingMode}
                      waiverData={waiverData}
                      onWaiverDataChange={setWaiverData}
                      termsAccepted={termsAccepted}
                      onTermsAcceptedChange={setTermsAccepted}
                      damageFeeAcknowledged={damageFeeAcknowledged}
                      onDamageFeeAcknowledgedChange={setDamageFeeAcknowledged}
                      onNavigateTerms={() => onNavigate('terms')}
                      fieldClass={fieldClass}
                      idPrefix="wi-"
                    />
                    <button
                      type="button"
                      disabled={waiverBusy || actionsBlocked}
                      onClick={() => void handleSignWaiver()}
                      className="lz-btn-primary mt-6 w-full justify-center py-4 text-base !normal-case !tracking-wide"
                    >
                      {waiverBusy ? 'Saving…' : 'Save waiver'}
                    </button>
                    {waiverMessage ? (
                      <p className="mt-3 text-sm text-slate-300" role="status">
                        {waiverMessage}
                      </p>
                    ) : null}
                  </section>
                ) : (
                  <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-4 text-sm text-emerald-100">
                    <Shield className="mb-2 h-5 w-5 text-emerald-300" aria-hidden />
                    Waiver on file for this booking.
                  </section>
                )}

                {isRental && booking.waiver_signed ? (
                  <>
                    <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
                      <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">
                        License / ID
                      </h2>
                      <p className="mt-2 text-sm text-slate-400">
                        Upload your boating license or government ID (JPEG, PNG, WebP, GIF, or PDF).
                      </p>
                      <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/20 bg-slate-950/30 px-4 py-10 hover:border-cyan-400/40">
                        <Upload className="mb-2 h-10 w-10 text-slate-500" aria-hidden />
                        <span className="text-base font-semibold text-slate-200">
                          {licenseBusy ? 'Uploading…' : 'Tap to upload license'}
                        </span>
                        <input
                          type="file"
                          accept={FILE_ACCEPT}
                          className="sr-only"
                          disabled={licenseBusy || actionsBlocked}
                          onChange={(e) => void handleLicenseUpload(e)}
                        />
                      </label>
                      {licenseMessage ? (
                        <p className="mt-3 text-sm text-slate-300" role="status">
                          {licenseMessage}
                        </p>
                      ) : null}
                    </section>

                    {insuranceConfig ? (
                      <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
                        <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">
                          Buoy rental insurance
                        </h2>
                        <p className="mt-2 text-sm font-semibold text-cyan-100/95">{insuranceConfig.label}</p>
                        <div className="mt-5 flex justify-center rounded-xl border border-white/10 bg-white p-4">
                          <img
                            src={insuranceConfig.qrImage}
                            alt={`Buoy insurance QR for ${insuranceConfig.label}`}
                            width={280}
                            height={280}
                            className="h-auto w-full max-w-[240px] object-contain"
                          />
                        </div>
                        <a
                          href={insuranceConfig.checkoutUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="lz-btn-primary mt-5 inline-flex w-full items-center justify-center gap-2 py-4 text-base !normal-case !tracking-wide"
                        >
                          Get Buoy Insurance
                          <ExternalLink className="h-5 w-5" aria-hidden />
                        </a>
                      </section>
                    ) : null}

                    <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
                      <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">
                        Upload insurance proof
                      </h2>
                      <p className="mt-2 text-sm text-slate-400">
                        After purchasing Buoy coverage, upload a screenshot or PDF of your policy.
                      </p>
                      <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/20 bg-slate-950/30 px-4 py-10 hover:border-cyan-400/40">
                        <Upload className="mb-2 h-10 w-10 text-slate-500" aria-hidden />
                        <span className="text-base font-semibold text-slate-200">
                          {proofBusy ? 'Uploading…' : 'Tap to upload proof'}
                        </span>
                        <input
                          type="file"
                          accept={FILE_ACCEPT}
                          className="sr-only"
                          disabled={proofBusy || actionsBlocked}
                          onChange={(e) => void handleProofUpload(e)}
                        />
                      </label>
                      {proofMessage ? (
                        <p className="mt-3 text-sm text-slate-300" role="status">
                          {proofMessage}
                        </p>
                      ) : null}
                    </section>
                  </>
                ) : null}

                {!isRental && booking.waiver_signed ? (
                  <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 text-sm text-slate-300">
                    Captain-led charter: rental insurance is handled by Launch Zone unless we contact you
                    with additional requirements.
                  </section>
                ) : null}
              </>
            ) : null}

            <button
              type="button"
              onClick={() => void refreshBooking()}
              className="w-full rounded-xl border border-white/15 bg-slate-950/50 py-3 text-sm font-semibold text-cyan-200 hover:bg-slate-900/60"
            >
              Refresh status
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
