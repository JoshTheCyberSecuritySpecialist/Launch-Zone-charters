import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Calendar, ClipboardCheck, ExternalLink, Loader2, Search, Upload, Shield } from 'lucide-react';
import WaiverBlock, { waiverFormComplete, type WaiverFormData } from '../components/booking/WaiverBlock';
import PreTripStatusPanel from '../components/booking/PreTripStatusPanel';
import ManualPreTripSubmission from '../components/booking/ManualPreTripSubmission';
import BoatSafetyPassengerForm, {
  capacityAllowsWaiver,
  type CapacityFormPayload,
} from '../components/booking/BoatSafetyPassengerForm';
import WaiversHelpCard from '../components/booking/WaiversHelpCard';
import {
  confirmWaiversAccess,
  fetchPreTripStatus,
  fetchWaiversBookingById,
  findPublicBooking,
  markInsuranceProof,
  signBookingWaiver,
  submitPublicCapacityCheck,
  type PublicBookingMatch,
  type PublicCapacityCheckResult,
  type PreTripStatusPayload,
} from '../lib/publicBooking';
import {
  bookingAllCustomerStepsDone,
  buildBookingChecklist,
  buildSubmissionChecklist,
  deriveBookingOverallStatus,
  deriveSubmissionOverallStatus,
} from '../lib/preTripStatus';
import {
  loadCompletedPreTripRef,
  loadManualPreTripDraft,
  saveCompletedPreTripRef,
} from '../lib/preTripDraftStorage';
import {
  WI_BODY,
  WI_FIELD,
  WI_HINT,
  WI_LABEL,
  WI_PRIMARY_BTN,
  WI_SECONDARY_BTN,
  WI_SECTION,
  WI_UPLOAD_ZONE,
  docStatusClass,
  type DocStatusText,
} from '../lib/waiversSeniorUi';
import { getInsuranceConfigForBooking } from '../config/buoyInsurance';
import { uploadBookingDocument } from '../lib/storageUpload';
import { env } from '../config/env.js';
import { wrapSyncClick } from '../lib/clickPerf';

function DocStatusBadge({ status }: { status: DocStatusText }) {
  return (
    <span
      className={`inline-flex min-h-10 items-center rounded-lg border px-3 py-1.5 text-base font-semibold ${docStatusClass(status)}`}
    >
      {status}
    </span>
  );
}

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

function capacityResultFromBooking(booking: PublicBookingMatch): PublicCapacityCheckResult | null {
  if (!booking.capacity_completed || !booking.capacity_status) return null;
  const status = booking.capacity_status;
  return {
    status,
    threshold_band: null,
    message:
      status === 'within_operating_range'
        ? 'Passenger information is on file for this booking.'
        : status === 'captain_review_required'
          ? 'Passenger information saved. The captain must review this group before departure.'
          : 'Please contact Launch Zone Charters for assistance with passenger planning.',
    canProceed: status !== 'capacity_exceeded' && status !== 'capacity_unverified',
    requiresStaffReview:
      status === 'captain_review_required' || status === 'capacity_unverified',
    passenger_count: booking.guest_count ?? 0,
    total_persons_aboard: 0,
    capacity_verified: booking.boat_capacity_verified ?? false,
    has_mobility_concerns: false,
    has_life_jacket_concerns: false,
  };
}

export default function WaiversInsurance({ onNavigate }: WaiversInsuranceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const bookingIdFromUrl = searchParams.get('bookingId')?.trim() || '';
  const submissionIdFromUrl = searchParams.get('submissionId')?.trim() || '';

  const completedRef = useMemo(() => loadCompletedPreTripRef(), []);
  const hasRestorableDraft = useMemo(() => Boolean(loadManualPreTripDraft()), []);

  const [findEmail, setFindEmail] = useState('');
  const [findPhone, setFindPhone] = useState('');
  const [findCode, setFindCode] = useState('');
  const [findLoading, setFindLoading] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [magicLinkLoading, setMagicLinkLoading] = useState(Boolean(bookingIdFromUrl));
  const [restoringSession, setRestoringSession] = useState(false);

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
  const [capacityResult, setCapacityResult] = useState<PublicCapacityCheckResult | null>(null);

  const [manualMode, setManualMode] = useState(
    () =>
      hasRestorableDraft &&
      !bookingIdFromUrl &&
      !submissionIdFromUrl &&
      !completedRef
  );
  const [manualSubmissionId, setManualSubmissionId] = useState<string | null>(null);
  const [entryMode, setEntryMode] = useState<'booking' | 'manual' | null>(() => {
    if (bookingIdFromUrl) return 'booking';
    if (submissionIdFromUrl || completedRef) return null;
    if (hasRestorableDraft) return 'manual';
    return null;
  });

  const [statusEmail, setStatusEmail] = useState(() => completedRef?.email || '');
  const [statusPhone, setStatusPhone] = useState(() => completedRef?.phone || '');
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [submissionStatus, setSubmissionStatus] = useState<PreTripStatusPayload | null>(null);

  const fieldClass = WI_FIELD;

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

  useEffect(() => {
    if (booking) {
      setCapacityResult(capacityResultFromBooking(booking));
    } else {
      setCapacityResult(null);
    }
  }, [booking]);

  const loadSubmissionStatus = useCallback(
    async (submissionId: string, email: string, phone: string) => {
      setStatusLoading(true);
      setStatusError(null);
      const result = await fetchPreTripStatus(submissionId, email, phone);
      setStatusLoading(false);
      setRestoringSession(false);
      if (!result.ok) {
        setSubmissionStatus(null);
        setStatusError(
          'We could not load your saved submission with that email and phone. Check them and try again, or call 803-542-1761.'
        );
        return;
      }
      setSubmissionStatus(result.data);
      setManualSubmissionId(submissionId);
      setManualMode(false);
      setStatusEmail(email.trim().toLowerCase());
      setStatusPhone(phone.trim());
      saveCompletedPreTripRef(submissionId, email, phone);
    },
    []
  );

  useEffect(() => {
    if (!bookingIdFromUrl) return;
    let cancelled = false;

    (async () => {
      setMagicLinkLoading(true);
      setFindError(null);
      setRestoringSession(false);
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

  // Put submissionId in the URL for refresh, but never auto-fetch status without
  // an explicit email+phone confirmation (shared-browser / IDOR hardening).
  useEffect(() => {
    if (bookingIdFromUrl) return;
    if (!completedRef?.submissionId || submissionIdFromUrl) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('submissionId', completedRef.submissionId);
        next.delete('bookingId');
        return next;
      },
      { replace: true }
    );
  }, [bookingIdFromUrl, submissionIdFromUrl, completedRef, setSearchParams]);

  const handleFindBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setFindLoading(true);
    setFindError(null);
    // Do not clear an already-submitted confirmation when lookup fails.
    // Only clear booking match state for a fresh lookup attempt.

    const result = await findPublicBooking({
      email: findEmail,
      phone: findPhone,
      code: findCode || bookingIdFromUrl || undefined,
    });

    setFindLoading(false);
    if (!result.ok) {
      setBooking(null);
      setFindError(
        'We could not find your trip automatically. That is okay. Enter the information below and our team will match it for you.'
      );
      setManualMode(false);
      return;
    }

    setSubmissionStatus(null);
    setManualSubmissionId(null);
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
    if (!capacityAllowsWaiver(capacityResult)) {
      setWaiverMessage('Complete passenger and safety information in the section above first.');
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
      setLicenseMessage(
        'We could not upload this file. Your other information is still saved. Try again or choose another file.'
      );
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
      setProofMessage(
        'We could not upload this file. Your other information is still saved. Try again or choose another file.'
      );
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
    if (!statusEmail.trim() || !statusPhone.trim()) {
      setStatusError('Enter the email and phone number used on your submission.');
      return;
    }
    const id = manualSubmissionId || submissionIdFromUrl;
    await loadSubmissionStatus(id, statusEmail, statusPhone);
  };

  const submissionView = submissionStatus?.submission ?? null;
  const submissionChecklist = submissionView
    ? buildSubmissionChecklist(submissionView, submissionStatus?.matched_booking ?? null)
    : [];
  const submissionOverallStatus = submissionView
    ? deriveSubmissionOverallStatus(submissionView, submissionStatus?.matched_booking ?? null)
    : null;

  const showEntryOptions =
    !restoringSession &&
    !booking &&
    !manualMode &&
    !manualSubmissionId &&
    !submissionStatus &&
    !magicLinkLoading &&
    !submissionIdFromUrl &&
    !entryMode;

  const showFindForm =
    !restoringSession &&
    !booking &&
    !manualMode &&
    !manualSubmissionId &&
    !submissionStatus &&
    !magicLinkLoading &&
    !submissionIdFromUrl &&
    entryMode === 'booking';

  const showStatusEmailGate =
    !restoringSession &&
    !statusLoading &&
    Boolean(submissionIdFromUrl || manualSubmissionId) &&
    !submissionStatus &&
    !booking;

  const waiverDocStatus: DocStatusText = booking?.waiver_signed
    ? 'Completed'
    : waiverBusy
      ? 'Uploading'
      : !capacityAllowsWaiver(capacityResult)
        ? 'Needs attention'
        : 'Not started';
  const capacityDocStatus: DocStatusText = capacityResult?.canProceed
    ? 'Completed'
    : booking?.boat_capacity_verified === false
      ? 'Needs attention'
      : capacityResult
        ? 'Needs attention'
        : 'Not started';
  const licenseDocStatus: DocStatusText = licenseBusy
    ? 'Uploading'
    : booking?.has_license_url || booking?.license_status === 'verified'
      ? 'Completed'
      : 'Needs attention';
  const insuranceDocStatus: DocStatusText = proofBusy
    ? 'Uploading'
    : booking?.has_insurance_url ||
        booking?.insurance_status === 'submitted' ||
        booking?.insurance_status === 'verified'
      ? 'Completed'
      : 'Not started';

  return (
    <div className="relative min-h-screen px-4 py-10 md:py-14">
      <div className="relative z-[1] mx-auto max-w-2xl">
        <header className="mb-8 text-center">
          <p className="text-base font-bold tracking-wide text-cyan-200">Launch Zone Charters</p>
          <h1 className="font-display mt-2 text-3xl font-bold text-white md:text-4xl">
            Complete Your Trip Documents
          </h1>
          <p className={`mx-auto mt-4 max-w-xl ${WI_BODY}`}>
            Complete each section below. Your progress is saved automatically, so you will not need to
            start over.
          </p>
        </header>

        <WaiversHelpCard className="mb-6" />

        {restoringSession || magicLinkLoading || (statusLoading && !submissionStatus) ? (
          <div className={`${WI_SECTION} flex items-center justify-center gap-3 p-10`}>
            <Loader2 className="h-7 w-7 animate-spin text-cyan-300" aria-hidden />
            <span className="text-lg text-slate-200">
              {magicLinkLoading
                ? 'Loading your booking…'
                : statusLoading
                  ? 'Loading your submission…'
                  : 'Finding your saved progress…'}
            </span>
          </div>
        ) : null}

        {showStatusEmailGate ? (
          <section className={`${WI_SECTION} mx-auto`}>
            <h2 className="text-xl font-bold text-white">Check your status</h2>
            <p className={`${WI_HINT} mt-2`}>
              For your privacy, confirm the email and phone number used when you submitted your
              documents.
            </p>
            <form onSubmit={(e) => void handleLoadSubmissionStatus(e)} className="mt-5 space-y-5">
              <div>
                <label htmlFor="wi-status-email" className={WI_LABEL}>
                  Email address
                </label>
                <input
                  id="wi-status-email"
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  value={statusEmail}
                  onChange={(e) => setStatusEmail(e.target.value)}
                  className={fieldClass}
                />
              </div>
              <div>
                <label htmlFor="wi-status-phone" className={WI_LABEL}>
                  Mobile phone number
                </label>
                <input
                  id="wi-status-phone"
                  type="tel"
                  required
                  autoComplete="tel"
                  inputMode="tel"
                  value={statusPhone}
                  onChange={(e) => setStatusPhone(e.target.value)}
                  className={fieldClass}
                />
              </div>
              <button type="submit" disabled={statusLoading} className={WI_PRIMARY_BTN}>
                {statusLoading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : null}
                View My Submission Status
              </button>
              {statusError ? (
                <p className="text-lg text-amber-100" role="alert">
                  {statusError}
                </p>
              ) : null}
            </form>
          </section>
        ) : null}

        {showEntryOptions ? (
          <section className="space-y-5">
            <article className={`${WI_SECTION} border-cyan-400/20`}>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-400/10 text-cyan-200">
                <Calendar className="h-6 w-6" aria-hidden />
              </div>
              <h2 className="mt-5 text-2xl font-bold text-white">I Have a Booking</h2>
              <p className={`mt-2 ${WI_BODY}`}>
                Find your trip with your booking email and phone number, then complete your waiver,
                license, and insurance steps.
              </p>
              <button
                type="button"
                onClick={wrapSyncClick('waivers_choose_booking_lookup', () => {
                  setEntryMode('booking');
                  setManualMode(false);
                  setFindError(null);
                })}
                className={`${WI_PRIMARY_BTN} mt-6`}
              >
                <Search className="h-5 w-5" aria-hidden />
                Find My Booking
              </button>
            </article>

            <article className={`${WI_SECTION} border-[var(--lz-cta)]/25`}>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--lz-cta)]/30 bg-[var(--lz-cta)]/10 text-[var(--lz-cta)]">
                <ClipboardCheck className="h-6 w-6" aria-hidden />
              </div>
              <h2 className="mt-5 text-2xl font-bold text-white">I Don&apos;t Have a Booking Yet</h2>
              <p className={`mt-2 ${WI_BODY}`}>
                Booked through Groupon, phone, text, or you are not sure? Continue here and our team
                will match your documents.
              </p>
              <button
                type="button"
                onClick={wrapSyncClick('waivers_choose_manual_submission', () => {
                  setEntryMode('manual');
                  setManualMode(true);
                  setFindError(null);
                })}
                className={`${WI_PRIMARY_BTN} mt-6`}
              >
                <Shield className="h-5 w-5" aria-hidden />
                Continue Without Booking
              </button>
            </article>

            <p className={`${WI_SECTION} text-center ${WI_BODY}`}>
              Not sure? Choose &quot;I Don&apos;t Have a Booking Yet&quot; — you will not need to start
              over later.
            </p>
          </section>
        ) : null}

        {showFindForm ? (
          <section className={`${WI_SECTION} mx-auto`}>
            <h2 className="text-xl font-bold text-white">Trip Details</h2>
            <p className={`${WI_HINT} mt-2`}>
              Enter the email and phone number from your booking. Booking ID or Groupon code is
              optional.
            </p>
            <form onSubmit={(e) => void handleFindBooking(e)} className="mt-6 space-y-5">
              <div>
                <label htmlFor="wi-email" className={WI_LABEL}>
                  Email address
                </label>
                <input
                  id="wi-email"
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  value={findEmail}
                  onChange={(e) => setFindEmail(e.target.value)}
                  className={fieldClass}
                />
              </div>
              <div>
                <label htmlFor="wi-phone" className={WI_LABEL}>
                  Mobile phone number
                </label>
                <input
                  id="wi-phone"
                  type="tel"
                  required
                  autoComplete="tel"
                  inputMode="tel"
                  value={findPhone}
                  onChange={(e) => setFindPhone(e.target.value)}
                  className={fieldClass}
                  aria-describedby="wi-phone-hint"
                />
                <p id="wi-phone-hint" className={WI_HINT}>
                  Use the same number from your booking.
                </p>
              </div>
              <div>
                <label htmlFor="wi-code" className={WI_LABEL}>
                  Booking number or Groupon voucher{' '}
                  <span className="font-normal text-slate-300">(optional)</span>
                </label>
                <input
                  id="wi-code"
                  type="text"
                  value={findCode}
                  onChange={(e) => setFindCode(e.target.value)}
                  className={fieldClass}
                  autoComplete="off"
                />
              </div>
              {findError ? (
                <div className="rounded-xl border border-amber-400/30 bg-amber-950/40 px-4 py-4">
                  <p className="text-lg text-amber-50" role="alert">
                    {findError}
                  </p>
                  <button
                    type="button"
                    onClick={wrapSyncClick('waivers_insurance_manual_start', () => {
                      setEntryMode('manual');
                      setManualMode(true);
                      setFindError(null);
                    })}
                    className={`${WI_PRIMARY_BTN} mt-4`}
                  >
                    Continue Without Booking
                  </button>
                </div>
              ) : null}
              <button type="submit" disabled={findLoading} className={WI_PRIMARY_BTN}>
                {findLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <Search className="h-5 w-5" aria-hidden />
                )}
                Find My Booking
              </button>
              <button
                type="button"
                onClick={() => {
                  setEntryMode(null);
                  setFindError(null);
                }}
                className={WI_SECONDARY_BTN}
              >
                Choose a Different Option
              </button>
            </form>
          </section>
        ) : null}

        {manualMode &&
        !manualSubmissionId &&
        !submissionStatus &&
        !submissionIdFromUrl &&
        !restoringSession ? (
          <div className="mx-auto max-w-2xl">
            <ManualPreTripSubmission
              initialEmail={findEmail}
              initialPhone={findPhone}
              initialGrouponCode={findCode}
              onNavigateTerms={() => onNavigate('terms')}
              onSubmitted={(id, email, phone) => {
                saveCompletedPreTripRef(id, email, phone);
                setManualMode(false);
                setStatusEmail(email);
                setStatusPhone(phone);
                setSearchParams(
                  (prev) => {
                    const next = new URLSearchParams(prev);
                    next.set('submissionId', id);
                    next.delete('bookingId');
                    return next;
                  },
                  { replace: true }
                );
                void loadSubmissionStatus(id, email, phone);
              }}
              onBack={() => {
                setManualMode(false);
                setEntryMode(null);
              }}
            />
          </div>
        ) : null}

        {submissionView && submissionOverallStatus ? (
          <div className="space-y-6">
            <PreTripStatusPanel
              status={submissionOverallStatus}
              checklist={submissionChecklist}
              referenceId={submissionView.id}
              customerName={submissionView.customer_name}
              showSuccessHeadline
            />
            <button
              type="button"
              onClick={wrapSyncClick('waivers_refresh_submission_status', () =>
                void loadSubmissionStatus(submissionView.id, statusEmail, statusPhone)
              )}
              disabled={statusLoading}
              className={WI_PRIMARY_BTN}
            >
              {statusLoading ? 'Refreshing…' : 'Refresh My Status'}
            </button>
            <button
              type="button"
              onClick={wrapSyncClick('waivers_return_home', () => onNavigate('home'))}
              className={WI_SECONDARY_BTN}
            >
              Return to Launch Zone Charters
            </button>
            <WaiversHelpCard />
          </div>
        ) : null}

        {booking && bookingOverallStatus ? (
          <div className="space-y-6">
            <section className={WI_SECTION}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-white">Your booking</h2>
                  <p className="mt-2 text-xl font-semibold text-white">{booking.customer_name}</p>
                  <p className={`mt-1 ${WI_BODY}`}>
                    {booking.boat_name || 'Boat'} · {formatTripDate(booking.start_time)}
                  </p>
                  <p className="mt-2 break-all font-mono text-base text-slate-300">
                    Confirmation: {booking.id}
                  </p>
                </div>
                {!magicLinkMode ? (
                  <button
                    type="button"
                    onClick={wrapSyncClick('waivers_insurance_change_booking', () => {
                      setBooking(null);
                      setEntryMode('booking');
                      setMagicLinkMode(false);
                    })}
                    className="min-h-12 text-lg font-semibold text-cyan-200 underline"
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
              customerName={booking.customer_name}
              tripDateLabel={formatTripDate(booking.start_time)}
              showSuccessHeadline={!showBookingActionSteps}
            />

            {magicLinkMode && phoneConfirmNeeded ? (
              <section className={`${WI_SECTION} border-cyan-400/25`}>
                <h2 className="text-xl font-bold text-white">Confirm your phone</h2>
                <p className={`${WI_HINT} mt-2`}>
                  For security, enter the phone number on your booking (ends in{' '}
                  {booking.phone_last4 || '****'}).
                </p>
                <label htmlFor="wi-confirm-phone" className={`${WI_LABEL} mt-5`}>
                  Mobile phone number
                </label>
                <input
                  id="wi-confirm-phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className={fieldClass}
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
                  className={`${WI_PRIMARY_BTN} mt-5`}
                >
                  Continue to Documents
                </button>
                {waiverMessage ? (
                  <p className="mt-3 text-lg text-amber-100" role="alert">
                    {waiverMessage}
                  </p>
                ) : null}
              </section>
            ) : null}

            {showBookingActionSteps ? (
              <>
                <section className={WI_SECTION}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-white">Boat Safety and Passenger Information</h2>
                      <p className={`${WI_HINT} mt-1`}>Required before waiver and documents.</p>
                    </div>
                    <DocStatusBadge status={capacityDocStatus} />
                  </div>
                  {!booking.boat_id ? (
                    <p className={`${WI_BODY} mt-4`} role="status">
                      Boat assignment pending. Please contact Launch Zone Charters at 803-542-1761 so
                      we can confirm your vessel before you enter passenger information.
                    </p>
                  ) : (
                    <div className="mt-5">
                      <BoatSafetyPassengerForm
                        boatLabel={booking.boat_name || 'Assigned boat'}
                        captainIncluded={!isRental || booking.captain_included}
                        suggestedPassengerCount={booking.guest_count}
                        disabled={actionsBlocked}
                        completedResult={capacityResult}
                        idPrefix="wi-cap-"
                        onSubmit={async (payload: CapacityFormPayload) => {
                          const out = await submitPublicCapacityCheck({
                            bookingId: booking.id,
                            email: contactEmail,
                            phone: contactPhone,
                            ...payload,
                          });
                          if (!out.ok) {
                            throw new Error(out.error);
                          }
                          setCapacityResult(out.result);
                          await refreshBooking();
                          return out.result;
                        }}
                      />
                    </div>
                  )}
                </section>

                <section className={WI_SECTION}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-white">Waiver</h2>
                      <p className={`${WI_HINT} mt-1`}>Read and sign before your trip.</p>
                    </div>
                    <DocStatusBadge status={waiverDocStatus} />
                  </div>
                  {!capacityAllowsWaiver(capacityResult) && !booking.waiver_signed ? (
                    <p className={`${WI_BODY} mt-4 text-amber-100`}>
                      Complete passenger and safety information above before signing the waiver.
                    </p>
                  ) : null}
                  {!booking.waiver_signed ? (
                    <>
                      <div className="mt-5">
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
                      </div>
                      <button
                        type="button"
                        disabled={waiverBusy || actionsBlocked || !capacityAllowsWaiver(capacityResult)}
                        onClick={() => void handleSignWaiver()}
                        className={`${WI_PRIMARY_BTN} mt-6`}
                      >
                        {waiverBusy ? 'Saving…' : 'Save My Waiver'}
                      </button>
                      {waiverMessage ? (
                        <p className="mt-3 text-lg text-slate-200" role="status">
                          {waiverMessage}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-4 text-lg text-emerald-100">Waiver on file for this booking.</p>
                  )}
                </section>

                {isRental && booking.waiver_signed ? (
                  <>
                    <section className={WI_SECTION}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h2 className="text-xl font-bold text-white">Driver&apos;s license / ID</h2>
                          <p className={`${WI_HINT} mt-1`}>
                            Upload a clear photo. Accepted: JPEG, PNG, WebP, GIF, or PDF.
                          </p>
                        </div>
                        <DocStatusBadge status={licenseDocStatus} />
                      </div>
                      <label className={WI_UPLOAD_ZONE}>
                        <Upload className="mb-2 h-10 w-10 text-slate-400" aria-hidden />
                        <span className="text-lg font-semibold text-white">
                          {licenseBusy ? 'Uploading…' : 'Take Photo or Choose File'}
                        </span>
                        <input
                          type="file"
                          accept={FILE_ACCEPT}
                          capture="environment"
                          className="sr-only"
                          disabled={licenseBusy || actionsBlocked}
                          onChange={(e) => void handleLicenseUpload(e)}
                        />
                      </label>
                      {licenseMessage ? (
                        <p className="mt-3 text-lg text-slate-200" role="status">
                          {licenseMessage}
                        </p>
                      ) : null}
                    </section>

                    {insuranceConfig ? (
                      <section className={WI_SECTION}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h2 className="text-xl font-bold text-white">Insurance</h2>
                            <p className={`${WI_HINT} mt-1`}>{insuranceConfig.label}</p>
                          </div>
                          <DocStatusBadge status={insuranceDocStatus} />
                        </div>
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
                          className={`${WI_PRIMARY_BTN} mt-5`}
                        >
                          Get Buoy Insurance
                          <ExternalLink className="h-5 w-5" aria-hidden />
                        </a>
                        <p className={`${WI_HINT} mt-5`}>
                          After purchasing coverage, upload a screenshot or PDF of your policy.
                        </p>
                        <label className={WI_UPLOAD_ZONE}>
                          <Upload className="mb-2 h-10 w-10 text-slate-400" aria-hidden />
                          <span className="text-lg font-semibold text-white">
                            {proofBusy ? 'Uploading…' : 'Take Photo or Choose File'}
                          </span>
                          <input
                            type="file"
                            accept={FILE_ACCEPT}
                            capture="environment"
                            className="sr-only"
                            disabled={proofBusy || actionsBlocked}
                            onChange={(e) => void handleProofUpload(e)}
                          />
                        </label>
                        {proofMessage ? (
                          <p className="mt-3 text-lg text-slate-200" role="status">
                            {proofMessage}
                          </p>
                        ) : null}
                      </section>
                    ) : null}
                  </>
                ) : null}

                {!isRental && booking.waiver_signed ? (
                  <section className={`${WI_SECTION} ${WI_BODY}`}>
                    Captain-led charter: rental insurance is handled by Launch Zone unless we contact
                    you with additional requirements.
                  </section>
                ) : null}
              </>
            ) : null}

            <button type="button" onClick={() => void refreshBooking()} className={WI_SECONDARY_BTN}>
              Refresh My Status
            </button>
            <WaiversHelpCard />
          </div>
        ) : null}

        {!restoringSession && !magicLinkLoading && !submissionView && !booking ? (
          <WaiversHelpCard className="mt-8" />
        ) : null}
      </div>
    </div>
  );
}
