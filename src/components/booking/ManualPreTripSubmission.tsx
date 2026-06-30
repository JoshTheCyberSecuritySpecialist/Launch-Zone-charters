import { useMemo, useState } from 'react';
import { ExternalLink, Loader2, Upload } from 'lucide-react';
import WaiverBlock, { waiverFormComplete, type WaiverFormData } from './WaiverBlock';
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
    'lz-input-on-dark w-full rounded-xl border border-white/15 bg-slate-950/85 px-4 py-3 text-sm shadow-inner focus:border-[var(--lz-cta)]/55 focus:outline-none focus:ring-2 focus:ring-[var(--lz-cta)]/20';

  const isRental = tripType !== 'captain_charter';
  const bookingMode = bookingModeForTripType(tripType);
  const insuranceConfig = useMemo(() => getInsuranceConfigForTripType(tripType), [tripType]);
  const uploadKey = `pre-trip/${draftId}`;

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
      return;
    }
    if (!waiverFormComplete(waiverData, termsAccepted, damageFeeAcknowledged)) {
      setSubmitError('Complete the waiver and agreement section.');
      return;
    }
    if (isRental && !licenseUrl) {
      setSubmitError('Upload your license or ID before submitting.');
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

  return (
    <div className="space-y-8">
      <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">
            Continue without a booking
          </h2>
          <button
            type="button"
            onClick={wrapSyncClick('manual_pre_trip_back', onBack)}
            className="text-sm font-semibold text-cyan-300 underline decoration-cyan-500/30"
          >
            ← Back to find booking
          </button>
        </div>
        <p className="text-sm text-slate-400">
          Our team will match your documents to your reservation manually.
        </p>

        <div className="mt-6 space-y-4">
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
      </section>

      <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
        <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">Sign waiver</h2>
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
      </section>

      <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
        <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">License / ID</h2>
        <p className="mt-2 text-sm text-slate-400">
          {isRental
            ? 'Required for self-drive rentals.'
            : 'Optional for charters unless we request it.'}
        </p>
        <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/20 bg-slate-950/30 px-4 py-8 hover:border-cyan-400/40">
          <Upload className="mb-2 h-8 w-8 text-slate-500" aria-hidden />
          <span className="text-sm font-semibold text-slate-200">
            {licenseBusy ? 'Uploading…' : 'Choose license file'}
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
      </section>

      {isRental && insuranceConfig ? (
        <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
          <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">Buoy rental insurance</h2>
          <p className="mt-2 text-sm font-semibold text-cyan-100/95">{insuranceConfig.label}</p>
          <p className="mt-1 text-xs text-slate-400">QR and button go to the same insurance checkout.</p>
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
            className="lz-btn-primary mt-5 inline-flex w-full items-center justify-center gap-2 text-sm !normal-case !tracking-wide"
          >
            Get Buoy Insurance
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </section>
      ) : (
        <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 text-sm text-slate-300">
          Captain-led charter: Buoy rental insurance is not required unless Launch Zone Charters instructs
          you otherwise.
        </section>
      )}

      {isRental ? (
        <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
          <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">
            Upload insurance proof
          </h2>
          <p className="mt-2 text-sm text-slate-400">After purchasing Buoy coverage, upload your proof here.</p>
          <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/20 bg-slate-950/30 px-4 py-8 hover:border-cyan-400/40">
            <Upload className="mb-2 h-8 w-8 text-slate-500" aria-hidden />
            <span className="text-sm font-semibold text-slate-200">
              {proofBusy ? 'Uploading…' : 'Choose proof file'}
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
        </section>
      ) : null}

      <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
        {submitError ? (
          <p className="mb-4 text-sm text-amber-200" role="alert">
            {submitError}
          </p>
        ) : null}
        <button
          type="button"
          disabled={submitBusy}
          onClick={() => void handleSubmit()}
          className="lz-btn-primary flex w-full items-center justify-center gap-2 text-sm !normal-case !tracking-wide"
        >
          {submitBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Submit for review
        </button>
      </section>
    </div>
  );
}
