import { useMemo, useState } from 'react';
import { ExternalLink, Loader2, Upload } from 'lucide-react';
import WaiverBlock, { waiverFormComplete, type WaiverFormData } from './WaiverBlock';
import PreTripStepper from './PreTripStepper';
import {
  bookingModeForTripType,
  getInsuranceConfigForTripType,
  type PreTripTripType,
} from '../../config/buoyInsurance';
import { submitPreTripSubmission, type PreTripTripType as ApiTripType } from '../../lib/publicBooking';
import { uploadDocumentToDocumentsBucket } from '../../lib/storageUpload';
import { wrapSyncClick } from '../../lib/clickPerf';

const FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';

const TRIP_OPTIONS: { value: PreTripTripType; label: string }[] = [
  { value: 'pontoon_rental', label: 'Pontoon Rental' },
  { value: 'center_console_rental', label: 'Center Console Rental' },
  { value: 'captain_charter', label: 'Captain-Led Charter' },
];

type ManualStep =
  | 'info'
  | 'waiver'
  | 'license'
  | 'buoy'
  | 'proof'
  | 'submit';

interface ManualPreTripSubmissionProps {
  initialEmail: string;
  initialPhone: string;
  initialGrouponCode?: string;
  onNavigateTerms: () => void;
  onSubmitted: (submissionId: string) => void;
  onBack: () => void;
}

export default function ManualPreTripSubmission({
  initialEmail,
  initialPhone,
  initialGrouponCode = '',
  onNavigateTerms,
  onSubmitted,
  onBack,
}: ManualPreTripSubmissionProps) {
  const [draftId] = useState(() => crypto.randomUUID());
  const [step, setStep] = useState<ManualStep>('info');

  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone);
  const [tripType, setTripType] = useState<PreTripTripType>('pontoon_rental');
  const [grouponCode, setGrouponCode] = useState(initialGrouponCode);
  const [requestedTripDate, setRequestedTripDate] = useState('');

  const [waiverData, setWaiverData] = useState<WaiverFormData>({ agreed: false, signature: '' });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [damageFeeAcknowledged, setDamageFeeAcknowledged] = useState(false);

  const [licenseUrl, setLicenseUrl] = useState<string | null>(null);
  const [insuranceUrl, setInsuranceUrl] = useState<string | null>(null);
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [proofBusy, setProofBusy] = useState(false);
  const [licenseMessage, setLicenseMessage] = useState<string | null>(null);
  const [proofMessage, setProofMessage] = useState<string | null>(null);

  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fieldClass =
    'lz-input-on-dark w-full rounded-xl border border-white/15 bg-slate-950/85 px-4 py-3 text-base shadow-inner focus:border-[var(--lz-cta)]/55 focus:outline-none focus:ring-2 focus:ring-[var(--lz-cta)]/20';

  const isRental = tripType !== 'captain_charter';
  const bookingMode = bookingModeForTripType(tripType);
  const insuranceConfig = useMemo(() => getInsuranceConfigForTripType(tripType), [tripType]);
  const uploadKey = `pre-trip/${draftId}`;

  const steps = useMemo(() => {
    const base = [
      { key: 'info', label: 'Your info' },
      { key: 'waiver', label: 'Waiver' },
      { key: 'license', label: 'License' },
    ];
    if (isRental) {
      base.push({ key: 'buoy', label: 'Buoy' }, { key: 'proof', label: 'Proof' });
    }
    base.push({ key: 'submit', label: 'Submit' });
    return base;
  }, [isRental]);

  const goNext = () => {
    const idx = steps.findIndex((s) => s.key === step);
    if (idx < steps.length - 1) setStep(steps[idx + 1].key as ManualStep);
  };

  const goBack = () => {
    const idx = steps.findIndex((s) => s.key === step);
    if (idx > 0) setStep(steps[idx - 1].key as ManualStep);
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
      setLicenseMessage(error?.message || 'Upload failed.');
      return;
    }
    setLicenseUrl(url);
    setLicenseMessage('License uploaded.');
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
      setProofMessage(error?.message || 'Upload failed.');
      return;
    }
    setInsuranceUrl(url);
    setProofMessage('Insurance proof uploaded.');
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    if (!customerName.trim()) {
      setSubmitError('Enter your full name.');
      setStep('info');
      return;
    }
    if (!waiverFormComplete(waiverData, termsAccepted, damageFeeAcknowledged)) {
      setSubmitError('Complete the waiver and agreement section.');
      setStep('waiver');
      return;
    }
    if (isRental && !licenseUrl) {
      setSubmitError('Upload your license or ID before submitting.');
      setStep('license');
      return;
    }

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
    });
    setSubmitBusy(false);

    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }
    onSubmitted(result.submissionId);
  };

  const bigBtn = 'lz-btn-primary w-full justify-center py-4 text-base !normal-case !tracking-wide';
  const ghostBtn =
    'w-full rounded-xl border border-white/15 py-3 text-sm font-semibold text-cyan-200 hover:bg-slate-900/50';

  return (
    <div className="space-y-6">
      <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">
            Continue without a booking
          </h2>
          <button
            type="button"
            onClick={wrapSyncClick('manual_pre_trip_back', onBack)}
            className="text-sm font-semibold text-cyan-300 underline decoration-cyan-500/30"
          >
            ← Back
          </button>
        </div>
        <p className="text-sm text-slate-400">
          Our team will match your documents to your reservation.
        </p>
        <PreTripStepper steps={steps} currentKey={step} className="mt-6" />
      </section>

      {step === 'info' ? (
        <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
          <div className="space-y-4">
            <div>
              <label htmlFor="mpt-name" className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                Full name
              </label>
              <input
                id="mpt-name"
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="mpt-email" className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                Email
              </label>
              <input
                id="mpt-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="mpt-phone" className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                Phone
              </label>
              <input
                id="mpt-phone"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="mpt-trip" className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                Trip type
              </label>
              <select
                id="mpt-trip"
                value={tripType}
                onChange={(e) => setTripType(e.target.value as PreTripTripType)}
                className={fieldClass}
              >
                {TRIP_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="mpt-groupon" className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                Groupon code <span className="text-slate-500">(optional)</span>
              </label>
              <input
                id="mpt-groupon"
                type="text"
                value={grouponCode}
                onChange={(e) => setGrouponCode(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="mpt-date" className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                Requested trip date <span className="text-slate-500">(optional)</span>
              </label>
              <input
                id="mpt-date"
                type="datetime-local"
                value={requestedTripDate}
                onChange={(e) => setRequestedTripDate(e.target.value)}
                className={fieldClass}
              />
            </div>
          </div>
          <button type="button" onClick={goNext} className={`${bigBtn} mt-6`}>
            Continue
          </button>
        </section>
      ) : null}

      {step === 'waiver' ? (
        <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
          <WaiverBlock
            bookingMode={bookingMode}
            waiverData={waiverData}
            onWaiverDataChange={setWaiverData}
            termsAccepted={termsAccepted}
            onTermsAcceptedChange={setTermsAccepted}
            damageFeeAcknowledged={damageFeeAcknowledged}
            onDamageFeeAcknowledgedChange={setDamageFeeAcknowledged}
            onNavigateTerms={onNavigateTerms}
            fieldClass={fieldClass}
            idPrefix="mpt-"
          />
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={goBack} className={ghostBtn}>
              Back
            </button>
            <button type="button" onClick={goNext} className={bigBtn}>
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {step === 'license' ? (
        <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
          <p className="text-sm text-slate-400">
            {isRental
              ? 'Required for self-drive rentals.'
              : 'Optional for charters unless we request it.'}
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
              disabled={licenseBusy}
              onChange={(e) => void handleLicenseUpload(e)}
            />
          </label>
          {licenseMessage ? <p className="mt-3 text-sm text-slate-300">{licenseMessage}</p> : null}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={goBack} className={ghostBtn}>
              Back
            </button>
            <button type="button" onClick={goNext} className={bigBtn}>
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {step === 'buoy' && isRental && insuranceConfig ? (
        <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
          <p className="text-sm font-semibold text-cyan-100/95">{insuranceConfig.label}</p>
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
            className={`${bigBtn} mt-5 inline-flex items-center gap-2`}
          >
            Get Buoy Insurance
            <ExternalLink className="h-5 w-5" aria-hidden />
          </a>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={goBack} className={ghostBtn}>
              Back
            </button>
            <button type="button" onClick={goNext} className={bigBtn}>
              I purchased insurance — continue
            </button>
          </div>
        </section>
      ) : null}

      {step === 'proof' && isRental ? (
        <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
          <p className="text-sm text-slate-400">Upload your Buoy policy screenshot or PDF.</p>
          <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/20 bg-slate-950/30 px-4 py-10 hover:border-cyan-400/40">
            <Upload className="mb-2 h-10 w-10 text-slate-500" aria-hidden />
            <span className="text-base font-semibold text-slate-200">
              {proofBusy ? 'Uploading…' : 'Tap to upload proof'}
            </span>
            <input
              type="file"
              accept={FILE_ACCEPT}
              className="sr-only"
              disabled={proofBusy}
              onChange={(e) => void handleProofUpload(e)}
            />
          </label>
          {proofMessage ? <p className="mt-3 text-sm text-slate-300">{proofMessage}</p> : null}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={goBack} className={ghostBtn}>
              Back
            </button>
            <button type="button" onClick={goNext} className={bigBtn}>
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {step === 'submit' ? (
        <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
          <h2 className="text-lg font-semibold text-white">Ready to submit?</h2>
          <p className="mt-2 text-sm text-slate-400">
            Our team will review your documents and match them to your booking. You are not cleared
            until we mark you <strong className="text-cyan-100">Ready for Departure</strong>.
          </p>
          {submitError ? (
            <p className="mt-4 text-sm text-amber-200" role="alert">
              {submitError}
            </p>
          ) : null}
          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              disabled={submitBusy}
              onClick={() => void handleSubmit()}
              className={`${bigBtn} flex items-center gap-2`}
            >
              {submitBusy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : null}
              Submit for review
            </button>
            <button type="button" onClick={goBack} className={ghostBtn}>
              Back
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
