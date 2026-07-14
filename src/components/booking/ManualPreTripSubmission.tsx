import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Loader2, Upload } from 'lucide-react';
import WaiverBlock, { waiverFormComplete, type WaiverFormData } from './WaiverBlock';
import PreTripStepper from './PreTripStepper';
import WaiversHelpCard from './WaiversHelpCard';
import {
  bookingModeForTripType,
  getInsuranceConfigForTripType,
  type PreTripTripType,
} from '../../config/buoyInsurance';
import { submitPreTripSubmission, type PreTripTripType as ApiTripType } from '../../lib/publicBooking';
import {
  clearManualPreTripDraft,
  loadManualPreTripDraft,
  saveManualPreTripDraft,
  type ManualPreTripStep,
} from '../../lib/preTripDraftStorage';
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
} from '../../lib/waiversSeniorUi';
import { uploadDocumentToDocumentsBucket } from '../../lib/storageUpload';
import { wrapSyncClick } from '../../lib/clickPerf';

const FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';

const TRIP_OPTIONS: { value: PreTripTripType; label: string }[] = [
  { value: 'pontoon_rental', label: 'Pontoon Rental' },
  { value: 'center_console_rental', label: 'Center Console Rental' },
  { value: 'captain_charter', label: 'Captain-Led Charter' },
];

const FLOW_STEPS = [
  { key: 'info', label: 'Your Information' },
  { key: 'trip', label: 'Trip Details' },
  { key: 'documents', label: 'Documents' },
  { key: 'review', label: 'Review & Submit' },
] as const;

interface ManualPreTripSubmissionProps {
  initialEmail: string;
  initialPhone: string;
  initialGrouponCode?: string;
  onNavigateTerms: () => void;
  onSubmitted: (submissionId: string, email: string, phone: string) => void;
  onBack: () => void;
}

function createDraftId(): string {
  return crypto.randomUUID();
}

function StatusBadge({ status }: { status: DocStatusText }) {
  return (
    <span
      className={`inline-flex min-h-10 items-center rounded-lg border px-3 py-1.5 text-base font-semibold ${docStatusClass(status)}`}
    >
      {status}
    </span>
  );
}

export default function ManualPreTripSubmission({
  initialEmail,
  initialPhone,
  initialGrouponCode = '',
  onNavigateTerms,
  onSubmitted,
  onBack,
}: ManualPreTripSubmissionProps) {
  const restored = useMemo(() => loadManualPreTripDraft(), []);
  const [draftId] = useState(() => restored?.draftId || createDraftId());
  const [step, setStep] = useState<ManualPreTripStep>(() => restored?.step || 'info');
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement | null>(null);

  const [customerName, setCustomerName] = useState(restored?.customerName || '');
  const [email, setEmail] = useState(restored?.email || initialEmail);
  const [phone, setPhone] = useState(restored?.phone || initialPhone);
  const [tripType, setTripType] = useState<PreTripTripType>(
    () => restored?.tripType || 'pontoon_rental'
  );
  const [grouponCode, setGrouponCode] = useState(restored?.grouponCode || initialGrouponCode);
  const [requestedTripDate, setRequestedTripDate] = useState(restored?.requestedTripDate || '');

  const [waiverData, setWaiverData] = useState<WaiverFormData>({
    agreed: restored?.waiverAgreed || false,
    signature: '',
  });
  const [termsAccepted, setTermsAccepted] = useState(restored?.termsAccepted || false);
  const [damageFeeAcknowledged, setDamageFeeAcknowledged] = useState(
    restored?.damageFeeAcknowledged || false
  );

  const [licenseUrl, setLicenseUrl] = useState<string | null>(restored?.licenseUrl || null);
  const [insuranceUrl, setInsuranceUrl] = useState<string | null>(restored?.insuranceUrl || null);
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [proofBusy, setProofBusy] = useState(false);
  const [licenseMessage, setLicenseMessage] = useState<string | null>(
    restored?.licenseUrl ? 'Document uploaded successfully.' : null
  );
  const [proofMessage, setProofMessage] = useState<string | null>(
    restored?.insuranceUrl ? 'Document uploaded successfully.' : null
  );

  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submitLockRef = useRef(false);

  const isRental = tripType !== 'captain_charter';
  const bookingMode = bookingModeForTripType(tripType);
  const insuranceConfig = useMemo(() => getInsuranceConfigForTripType(tripType), [tripType]);
  const uploadKey = `pre-trip/${draftId}`;

  const waiverComplete = waiverFormComplete(waiverData, termsAccepted, damageFeeAcknowledged);
  const waiverStatus: DocStatusText = waiverComplete
    ? 'Completed'
    : waiverData.agreed || termsAccepted || damageFeeAcknowledged || waiverData.signature
      ? 'Needs attention'
      : 'Not started';
  const licenseStatus: DocStatusText = licenseBusy
    ? 'Uploading'
    : licenseUrl
      ? 'Completed'
      : isRental
        ? 'Needs attention'
        : 'Not started';
  const insuranceStatus: DocStatusText = proofBusy
    ? 'Uploading'
    : insuranceUrl
      ? 'Completed'
      : isRental
        ? 'Not started'
        : 'Not started';

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveManualPreTripDraft({
        draftId,
        step,
        customerName,
        email,
        phone,
        tripType,
        grouponCode,
        requestedTripDate,
        termsAccepted,
        damageFeeAcknowledged,
        waiverAgreed: waiverData.agreed,
        licenseUrl,
        insuranceUrl,
        updatedAt: new Date().toISOString(),
      });
      setSaveHint('Progress saved');
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    draftId,
    step,
    customerName,
    email,
    phone,
    tripType,
    grouponCode,
    requestedTripDate,
    termsAccepted,
    damageFeeAcknowledged,
    waiverData.agreed,
    licenseUrl,
    insuranceUrl,
  ]);

  useEffect(() => {
    if (!saveHint) return;
    const t = window.setTimeout(() => setSaveHint(null), 2000);
    return () => window.clearTimeout(t);
  }, [saveHint]);

  const focusErrors = () => {
    window.requestAnimationFrame(() => {
      errorSummaryRef.current?.focus();
    });
  };

  const continueFromInfo = () => {
    const errors: string[] = [];
    if (!customerName.trim()) errors.push('Enter your full name.');
    if (!email.trim() || !email.includes('@')) {
      errors.push('Enter an email address such as name@example.com.');
    }
    if (!phone.trim()) errors.push('Enter a mobile phone number where we can reach you.');
    if (errors.length) {
      setInfoError(errors.join(' '));
      focusErrors();
      return;
    }
    setInfoError(null);
    setStep('trip');
  };

  const handleLicenseUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLicenseBusy(true);
    setLicenseMessage(null);
    const { url, error } = await uploadDocumentToDocumentsBucket(file, 'licenses', uploadKey);
    setLicenseBusy(false);
    if (error || !url) {
      setLicenseMessage(
        'We could not upload this file. Your other information is still saved. Try again or choose another file.'
      );
      return;
    }
    setLicenseUrl(url);
    setLicenseMessage('Document uploaded successfully.');
  };

  const handleProofUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProofBusy(true);
    setProofMessage(null);
    const { url, error } = await uploadDocumentToDocumentsBucket(file, 'insurance', uploadKey);
    setProofBusy(false);
    if (error || !url) {
      setProofMessage(
        'We could not upload this file. Your other information is still saved. Try again or choose another file.'
      );
      return;
    }
    setInsuranceUrl(url);
    setProofMessage('Document uploaded successfully.');
  };

  const continueFromDocuments = () => {
    if (!waiverComplete) {
      setSubmitError('Please accept the waiver before continuing.');
      focusErrors();
      return;
    }
    if (isRental && !licenseUrl) {
      setSubmitError('Upload a clear photo of your license or ID.');
      focusErrors();
      return;
    }
    setSubmitError(null);
    setStep('review');
  };

  const handleSubmit = async () => {
    if (submitLockRef.current || submitBusy) return;
    setSubmitError(null);
    if (!customerName.trim()) {
      setSubmitError('Enter your full name.');
      setStep('info');
      focusErrors();
      return;
    }
    if (!waiverComplete) {
      setSubmitError('Please accept the waiver before continuing.');
      setStep('documents');
      focusErrors();
      return;
    }
    if (isRental && !licenseUrl) {
      setSubmitError('Upload a clear photo of your license or ID.');
      setStep('documents');
      focusErrors();
      return;
    }

    submitLockRef.current = true;
    setSubmitBusy(true);
    const result = await submitPreTripSubmission({
      customerName: customerName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      tripType: tripType as ApiTripType,
      grouponCode: grouponCode.trim() || undefined,
      requestedTripDate: requestedTripDate || undefined,
      waiverSignature: waiverData.signature.trim(),
      waiverAgreed: waiverData.agreed,
      termsAccepted,
      damageFeeAcknowledged,
      licenseUrl,
      insuranceUrl,
      clientDraftId: draftId,
    });
    setSubmitBusy(false);

    if (!result.ok) {
      submitLockRef.current = false;
      setSubmitError(
        'We could not finish sending your information. Your progress has been saved. Please try again, or call 803-542-1761 for help.'
      );
      focusErrors();
      return;
    }

    clearManualPreTripDraft();
    onSubmitted(result.submissionId, email.trim().toLowerCase(), phone.trim());
  };

  const tripLabel = TRIP_OPTIONS.find((t) => t.value === tripType)?.label || tripType;

  return (
    <div className="space-y-6">
      <section className={WI_SECTION}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-white">Continue without a booking</h2>
          <button
            type="button"
            onClick={wrapSyncClick('manual_pre_trip_back', onBack)}
            className="min-h-12 rounded-xl px-3 text-lg font-semibold text-cyan-200 underline decoration-cyan-500/40"
          >
            Choose a different option
          </button>
        </div>
        <p className={WI_BODY}>
          Complete each section below. Your progress is saved automatically, so you will not need to
          start over.
        </p>
        {saveHint ? (
          <p className="mt-2 text-base text-emerald-200" role="status" aria-live="polite">
            {saveHint}
          </p>
        ) : null}
        {restored ? (
          <p className="mt-2 text-base text-cyan-100" role="status">
            We restored your saved progress for this browser session.
          </p>
        ) : null}
        <PreTripStepper steps={[...FLOW_STEPS]} currentKey={step} className="mt-6" />
      </section>

      <WaiversHelpCard />

      {(infoError || submitError) && (step === 'info' || step === 'documents' || step === 'review') ? (
        <div
          ref={errorSummaryRef}
          tabIndex={-1}
          role="alert"
          className="rounded-xl border border-amber-400/40 bg-amber-950/40 px-5 py-4 text-lg text-amber-50 outline-none focus:ring-2 focus:ring-amber-300/50"
        >
          {infoError || submitError}
        </div>
      ) : null}

      {step === 'info' ? (
        <section className={WI_SECTION}>
          <h3 className="text-xl font-bold text-white">Your Information</h3>
          <p className={`${WI_HINT} mt-2`}>We use this to match your documents and contact you.</p>
          <div className="mt-6 space-y-5">
            <div>
              <label htmlFor="mpt-name" className={WI_LABEL}>
                Full name
              </label>
              <input
                id="mpt-name"
                type="text"
                required
                autoComplete="name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className={WI_FIELD}
                aria-invalid={Boolean(infoError && !customerName.trim())}
              />
            </div>
            <div>
              <label htmlFor="mpt-email" className={WI_LABEL}>
                Email address
              </label>
              <input
                id="mpt-email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={WI_FIELD}
                aria-describedby="mpt-email-hint"
              />
              <p id="mpt-email-hint" className={WI_HINT}>
                Example: name@example.com
              </p>
            </div>
            <div>
              <label htmlFor="mpt-phone" className={WI_LABEL}>
                Mobile phone number
              </label>
              <input
                id="mpt-phone"
                type="tel"
                required
                autoComplete="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={WI_FIELD}
              />
            </div>
          </div>
          <button type="button" onClick={continueFromInfo} className={`${WI_PRIMARY_BTN} mt-8`}>
            Continue to Trip Details
          </button>
        </section>
      ) : null}

      {step === 'trip' ? (
        <section className={WI_SECTION}>
          <h3 className="text-xl font-bold text-white">Trip Details</h3>
          <p className={`${WI_HINT} mt-2`}>
            We could not find your trip automatically. That is okay. Enter the information below and
            our team will match it for you.
          </p>
          <div className="mt-6 space-y-5">
            <div>
              <label htmlFor="mpt-trip" className={WI_LABEL}>
                Tour or rental type
              </label>
              <select
                id="mpt-trip"
                value={tripType}
                onChange={(e) => setTripType(e.target.value as PreTripTripType)}
                className={WI_FIELD}
              >
                {TRIP_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="mpt-groupon" className={WI_LABEL}>
                Groupon voucher or booking number{' '}
                <span className="font-normal text-slate-300">(optional)</span>
              </label>
              <input
                id="mpt-groupon"
                type="text"
                value={grouponCode}
                onChange={(e) => setGrouponCode(e.target.value)}
                className={WI_FIELD}
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor="mpt-date" className={WI_LABEL}>
                Requested trip date <span className="font-normal text-slate-300">(optional)</span>
              </label>
              <input
                id="mpt-date"
                type="datetime-local"
                value={requestedTripDate}
                onChange={(e) => setRequestedTripDate(e.target.value)}
                className={WI_FIELD}
              />
            </div>
          </div>
          <div className="mt-8 flex flex-col gap-3">
            <button type="button" onClick={() => setStep('documents')} className={WI_PRIMARY_BTN}>
              Continue to Documents
            </button>
            <button type="button" onClick={() => setStep('info')} className={WI_SECONDARY_BTN}>
              Edit Your Information
            </button>
          </div>
        </section>
      ) : null}

      {step === 'documents' ? (
        <div className="space-y-5">
          <section className={WI_SECTION}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-white">Waiver</h3>
                <p className={`${WI_HINT} mt-1`}>Read and sign before your trip.</p>
              </div>
              <StatusBadge status={waiverStatus} />
            </div>
            <div className="mt-5">
              <WaiverBlock
                bookingMode={bookingMode}
                waiverData={waiverData}
                onWaiverDataChange={setWaiverData}
                termsAccepted={termsAccepted}
                onTermsAcceptedChange={setTermsAccepted}
                damageFeeAcknowledged={damageFeeAcknowledged}
                onDamageFeeAcknowledgedChange={setDamageFeeAcknowledged}
                onNavigateTerms={onNavigateTerms}
                fieldClass={WI_FIELD}
                idPrefix="mpt-"
              />
            </div>
          </section>

          <section className={WI_SECTION}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-white">Driver&apos;s license / ID</h3>
                <p className={`${WI_HINT} mt-1`}>
                  {isRental
                    ? 'Required for self-drive rentals. JPEG, PNG, WebP, GIF, or PDF.'
                    : 'Optional for captain-led charters unless we ask for it.'}
                </p>
              </div>
              <StatusBadge status={licenseStatus} />
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
                disabled={licenseBusy}
                onChange={(e) => void handleLicenseUpload(e)}
              />
            </label>
            {licenseUrl ? (
              <p className="mt-3 text-base text-slate-300">File on file. You can replace it anytime.</p>
            ) : null}
            {licenseMessage ? (
              <p className="mt-3 text-base text-slate-200" role="status">
                {licenseMessage}
              </p>
            ) : null}
          </section>

          {isRental && insuranceConfig ? (
            <section className={WI_SECTION}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold text-white">Insurance</h3>
                  <p className={`${WI_HINT} mt-1`}>{insuranceConfig.label}</p>
                </div>
                <StatusBadge status={insuranceStatus} />
              </div>
              <div className="mt-5 flex justify-center rounded-xl border border-white/10 bg-white p-4">
                <img
                  src={insuranceConfig.qrImage}
                  alt={`Buoy insurance QR for ${insuranceConfig.label}`}
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
                After purchasing coverage, upload a screenshot or PDF of your policy. Accepted:
                JPEG, PNG, WebP, GIF, or PDF.
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
                  disabled={proofBusy}
                  onChange={(e) => void handleProofUpload(e)}
                />
              </label>
              {insuranceUrl ? (
                <p className="mt-3 text-base text-slate-300">File on file. You can replace it anytime.</p>
              ) : null}
              {proofMessage ? (
                <p className="mt-3 text-base text-slate-200" role="status">
                  {proofMessage}
                </p>
              ) : null}
            </section>
          ) : null}

          <div className="flex flex-col gap-3">
            <button type="button" onClick={continueFromDocuments} className={WI_PRIMARY_BTN}>
              Continue to Review &amp; Submit
            </button>
            <button type="button" onClick={() => setStep('trip')} className={WI_SECONDARY_BTN}>
              Edit Trip Details
            </button>
          </div>
        </div>
      ) : null}

      {step === 'review' ? (
        <section className={WI_SECTION}>
          <h3 className="text-xl font-bold text-white">Review &amp; Submit</h3>
          <p className={`${WI_HINT} mt-2`}>
            Check your information, then press the submit button once.
          </p>

          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-lg font-bold text-white">Customer information</h4>
                <button
                  type="button"
                  onClick={() => setStep('info')}
                  className="min-h-12 text-base font-semibold text-cyan-200 underline"
                >
                  Edit
                </button>
              </div>
              <p className="mt-2 text-lg text-slate-200">{customerName}</p>
              <p className="text-lg text-slate-200">{email}</p>
              <p className="text-lg text-slate-200">{phone}</p>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-lg font-bold text-white">Trip information</h4>
                <button
                  type="button"
                  onClick={() => setStep('trip')}
                  className="min-h-12 text-base font-semibold text-cyan-200 underline"
                >
                  Edit
                </button>
              </div>
              <p className="mt-2 text-lg text-slate-200">{tripLabel}</p>
              {grouponCode ? <p className="text-lg text-slate-200">Code: {grouponCode}</p> : null}
              {requestedTripDate ? (
                <p className="text-lg text-slate-200">Requested: {requestedTripDate}</p>
              ) : null}
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-lg font-bold text-white">Documents</h4>
                <button
                  type="button"
                  onClick={() => setStep('documents')}
                  className="min-h-12 text-base font-semibold text-cyan-200 underline"
                >
                  Edit
                </button>
              </div>
              <ul className="mt-2 space-y-2 text-lg text-slate-200">
                <li>Waiver: {waiverStatus}</li>
                <li>License / ID: {licenseStatus}</li>
                {isRental ? <li>Insurance: {insuranceStatus}</li> : null}
              </ul>
            </div>
          </div>

          {submitError ? (
            <p className="mt-4 text-lg text-amber-100" role="alert">
              {submitError}
            </p>
          ) : null}

          <button
            type="button"
            disabled={submitBusy}
            onClick={() => void handleSubmit()}
            className={`${WI_PRIMARY_BTN} mt-8`}
          >
            {submitBusy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : null}
            {submitBusy ? 'Submitting your information…' : 'Submit My Trip Documents'}
          </button>
          <p className="mt-3 text-base leading-relaxed text-slate-300">
            You only need to press this button once. Please remain on this page while your
            information is sent.
          </p>
          <button
            type="button"
            onClick={() => setStep('documents')}
            className={`${WI_SECONDARY_BTN} mt-4`}
            disabled={submitBusy}
          >
            Back to Documents
          </button>
        </section>
      ) : null}

      <WaiversHelpCard />
    </div>
  );
}
