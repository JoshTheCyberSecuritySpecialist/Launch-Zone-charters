import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardCheck, ExternalLink, Loader2, Search, Upload } from 'lucide-react';
import WaiverBlock, { waiverFormComplete, type WaiverFormData } from '../components/booking/WaiverBlock';
import PreTripStatusPanel from '../components/booking/PreTripStatusPanel';
import ManualPreTripSubmission from '../components/booking/ManualPreTripSubmission';
import PreTripStepper from '../components/booking/PreTripStepper';
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
  WI_CHOICE_CARD,
  WI_CYAN_BTN,
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

const BOOKING_PATH_STEPS = [
  { key: 'find', label: 'Find booking' },
  { key: 'documents', label: 'Documents' },
  { key: 'complete', label: 'Complete' },
] as const;

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
    canProceed: status !== 'capacity_exceeded',
    requiresStaffReview: status === 'captain_review_required',
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
  const findFormHeadingRef = useRef<HTMLHeadingElement>(null);
  const pageTopRef = useRef<HTMLElement>(null);

  const chooseBookingPath = useCallback(() => {
    setEntryMode('booking');
    setManualMode(false);
    setFindError(null);
    requestAnimationFrame(() => {
      findFormHeadingRef.current?.focus();
    });
  }, []);

  const chooseManualPath = useCallback(() => {
    setEntryMode('manual');
    setManualMode(true);
    setFindError(null);
  }, []);

  const isRental = booking
    ? booking.booking_type === 'charter'
      ? false
      : booking.booking_type === 'rental'
        ? true
        : !booking.captain_included
    : true;
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
        setFindError(
          "We couldn't find your reservation yet. If you just paid, wait a moment and try again."
        );
        setFindCode((prev) => prev || bookingIdFromUrl);
        setEntryMode('booking');
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
    setFindError(null);

    const emailEl = document.getElementById('wi-email') as HTMLInputElement | null;
    const phoneEl = document.getElementById('wi-phone') as HTMLInputElement | null;
    if (emailEl && !emailEl.value.trim()) {
      emailEl.focus();
      setFindError('Enter the email address from your booking.');
      return;
    }
    if (phoneEl && !phoneEl.value.trim()) {
      phoneEl.focus();
      setFindError('Enter the mobile phone number from your booking.');
      return;
    }

    setFindLoading(true);
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
        "We couldn't find your reservation yet. Check the email and phone from your booking, or enter your reservation number."
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
    if (!waiverFormComplete(waiverData, termsAccepted, damageFeeAcknowledged, bookingMode)) {
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
      ...(bookingMode === 'rental' ? { damageFeeAcknowledged } : {}),
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

  const bookingPathStep = !booking
    ? 'find'
    : showBookingActionSteps
      ? 'documents'
      : 'complete';

  return (
    <div className="relative min-h-screen overflow-x-hidden px-4 pb-12 pt-8 sm:px-5 sm:pt-10 md:pb-16 md:pt-12">
      <div className="relative z-[1] mx-auto w-full max-w-3xl">
        <header ref={pageTopRef} className="mb-6 scroll-mt-[calc(var(--lz-header-offset)+0.75rem)] text-center sm:mb-8">
          <h1 className="font-display text-[1.75rem] font-bold leading-tight text-white sm:text-3xl">
            Complete Your Trip Documents
          </h1>
          <p className={`mx-auto mt-3 max-w-md ${WI_BODY}`}>
            Choose an option below to complete your waiver and required insurance documents.
          </p>
          <p className="mt-3 text-sm font-medium text-slate-400 sm:text-base">
            Secure submission · Usually takes about 5 minutes
          </p>
        </header>

        {restoringSession || magicLinkLoading || (statusLoading && !submissionStatus) ? (
          <div className={`${WI_SECTION} flex items-center justify-center gap-3 p-8`} role="status">
            <Loader2 className="h-6 w-6 animate-spin text-cyan-300" aria-hidden />
            <span className="text-base text-slate-200 sm:text-lg">
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
                <p className="text-base text-amber-100 sm:text-lg" role="alert">
                  {statusError}
                </p>
              ) : null}
            </form>
          </section>
        ) : null}

        {showEntryOptions ? (
          <section className="space-y-4" aria-labelledby="wi-decision-heading">
            <h2 id="wi-decision-heading" className="text-center text-xl font-bold text-white sm:text-2xl">
              Do you already have a booking?
            </h2>

            <div className="grid gap-4 md:grid-cols-2 md:gap-5">
              <article
                className={`${WI_CHOICE_CARD} border-[var(--lz-cta)]/45 bg-[rgba(255,140,43,0.08)]`}
              >
                <button
                  type="button"
                  className="absolute inset-0 z-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lz-cta)]/60"
                  aria-label="Yes, I have a booking. Find my booking."
                  onClick={wrapSyncClick('waivers_choose_booking_lookup', chooseBookingPath)}
                />
                <div className="relative z-[1] pointer-events-none">
                  <span className="inline-flex rounded-full bg-[var(--lz-cta)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#02111f]">
                    Recommended
                  </span>
                  <h3 className="mt-3 text-xl font-bold text-white sm:text-2xl">Yes, I Have a Booking</h3>
                  <p className={`mt-2 ${WI_BODY}`}>
                    Find your reservation and attach your documents directly to your trip.
                  </p>
                  <span className={`${WI_PRIMARY_BTN} mt-5`}>
                    <Search className="h-5 w-5" aria-hidden />
                    Find My Booking
                  </span>
                </div>
              </article>

              <article className={`${WI_CHOICE_CARD} border-cyan-400/35 bg-cyan-950/20`}>
                <button
                  type="button"
                  className="absolute inset-0 z-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
                  aria-label="No, I do not have a booking yet. Continue without a booking."
                  onClick={wrapSyncClick('waivers_choose_manual_submission', chooseManualPath)}
                />
                <div className="relative z-[1] pointer-events-none">
                  <h3 className="text-xl font-bold text-white sm:text-2xl">
                    No, I Don&apos;t Have a Booking Yet
                  </h3>
                  <p className={`mt-2 ${WI_BODY}`}>
                    You can still complete your documents now. Our team will match them to your
                    reservation later.
                  </p>
                  <span className={`${WI_CYAN_BTN} mt-5`}>
                    <ClipboardCheck className="h-5 w-5 text-cyan-100" aria-hidden />
                    Continue Without Booking
                  </span>
                </div>
              </article>
            </div>

            <WaiversHelpCard className="mt-2" />
          </section>
        ) : null}

        {showFindForm ? (
          <section className={`${WI_SECTION} mx-auto`}>
            <PreTripStepper
              steps={[...BOOKING_PATH_STEPS]}
              currentKey="find"
              className="mb-6"
            />
            <h2
              ref={findFormHeadingRef}
              tabIndex={-1}
              className="text-xl font-bold text-white outline-none"
            >
              Find your booking
            </h2>
            <p className={`${WI_HINT} mt-2`}>
              Enter the email and phone number from your booking. Reservation number or Groupon
              voucher is optional.
            </p>
            <form onSubmit={(e) => void handleFindBooking(e)} className="mt-6 space-y-5" noValidate>
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
                  Reservation number or Groupon voucher{' '}
                  <span className="font-normal text-slate-400">(optional)</span>
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
                <div className="space-y-3 rounded-xl border border-amber-400/30 bg-amber-950/40 px-4 py-4">
                  <p className="text-base text-amber-50 sm:text-lg" role="alert">
                    {findError}
                  </p>
                  <p className="text-base text-amber-100/90">Let&apos;s try another way.</p>
                  {bookingIdFromUrl ? (
                    <button
                      type="button"
                      onClick={wrapSyncClick('waivers_retry_booking_lookup', () => {
                        setFindError(null);
                        setMagicLinkLoading(true);
                        void fetchWaiversBookingById(bookingIdFromUrl).then((retry) => {
                          setMagicLinkLoading(false);
                          if (!retry.ok) {
                            setFindError(
                              "We couldn't find your reservation yet. Check your email and phone, or contact us."
                            );
                            return;
                          }
                          setBooking(retry.booking);
                          setFindEmail(retry.booking.email_masked || retry.booking.email || '');
                          setMagicLinkMode(true);
                          setPhoneConfirmNeeded(true);
                          setManualMode(false);
                        });
                      })}
                      className={WI_PRIMARY_BTN}
                    >
                      Try again
                    </button>
                  ) : null}
                  <a href="tel:8035421761" className={bookingIdFromUrl ? WI_SECONDARY_BTN : WI_PRIMARY_BTN}>
                    Call or Text Us
                  </a>
                  <button
                    type="button"
                    onClick={wrapSyncClick('waivers_choose_manual_submission', chooseManualPath)}
                    className={WI_CYAN_BTN}
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
                {findLoading ? 'Searching…' : 'Find My Booking'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEntryMode(null);
                  setFindError(null);
                  requestAnimationFrame(() => {
                    pageTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  });
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
          <div className="mx-auto w-full max-w-xl">
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
                requestAnimationFrame(() => {
                  pageTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
              }}
            />
          </div>
        ) : null}

        {submissionView && submissionOverallStatus ? (
          <div className="space-y-5">
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
          <div className="space-y-5">
            <PreTripStepper
              steps={[...BOOKING_PATH_STEPS]}
              currentKey={bookingPathStep}
              className="mb-1"
            />
            <section className={WI_SECTION}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-white">Your booking</h2>
                  <p className="mt-2 text-lg font-semibold text-white sm:text-xl">{booking.customer_name}</p>
                  <p className={`mt-1 ${WI_BODY}`}>
                    {booking.boat_name || 'Boat'} · {formatTripDate(booking.start_time)}
                  </p>
                  <p className="mt-2 break-all font-mono text-sm text-slate-300 sm:text-base">
                    Confirmation: {booking.reservation_number || 'Your reservation'}
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
                    className="min-h-12 text-base font-semibold text-cyan-200 underline sm:text-lg"
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
                  <div className="mt-5">
                      <BoatSafetyPassengerForm
                        boatLabel={booking.boat_name || undefined}
                        captainIncluded={!isRental || Boolean(booking.captain_included)}
                        suggestedPassengerCount={booking.guest_count}
                        disabled={actionsBlocked}
                        completedResult={capacityResult}
                        idPrefix="wi-cap-"
                        onSubmit={async (payload: CapacityFormPayload) => {
                          const out = await submitPublicCapacityCheck({
                            bookingId: booking.id,
                            email: contactEmail,
                            phone: contactPhone,
                            captainLed: !isRental || Boolean(booking.captain_included),
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
      </div>
    </div>
  );
}
