import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  Loader2,
  Search,
  Upload,
  Shield,
} from 'lucide-react';
import WaiverBlock, { waiverFormComplete, type WaiverFormData } from '../components/booking/WaiverBlock';
import {
  findPublicBooking,
  signBookingWaiver,
  type PublicBookingMatch,
} from '../lib/publicBooking';
import { getInsuranceConfigForBooking } from '../config/buoyInsurance';
import { uploadDocumentToDocumentsBucket } from '../lib/storageUpload';
import { supabase } from '../lib/supabase';
import { env } from '../config/env.js';
import ManualPreTripSubmission from '../components/booking/ManualPreTripSubmission';
import { wrapSyncClick } from '../lib/clickPerf';

interface WaiversInsuranceProps {
  onNavigate: (page: string) => void;
}

const FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';

function safeFileSegment(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'document';
}

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

type ChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  note?: string;
};

function buildChecklist(booking: PublicBookingMatch, isRental: boolean): ChecklistItem[] {
  const paid =
    booking.payment_status === 'deposit_paid' ||
    booking.payment_status === 'paid' ||
    booking.status === 'pending_verification' ||
    booking.status === 'confirmed' ||
    booking.status === 'ready_for_departure';

  const items: ChecklistItem[] = [
    {
      key: 'payment',
      label: 'Payment',
      done: paid,
      note: paid ? 'Deposit or payment received' : 'Pending payment',
    },
    {
      key: 'waiver',
      label: 'Waiver',
      done: booking.waiver_signed,
      note: booking.waiver_signed ? 'Signed' : 'Required',
    },
  ];

  if (isRental) {
    items.push(
      {
        key: 'license',
        label: 'License / ID',
        done: booking.license_status === 'verified' || booking.has_license_url,
        note:
          booking.license_status === 'verified'
            ? 'Verified'
            : booking.has_license_url
              ? 'Uploaded — under review'
              : 'Required for self-drive rental',
      },
      {
        key: 'insurance',
        label: 'Buoy insurance',
        done:
          booking.insurance_status === 'verified' ||
          booking.insurance_status === 'submitted' ||
          booking.has_insurance_url,
        note:
          booking.insurance_status === 'verified'
            ? 'Verified'
            : booking.insurance_status === 'submitted' || booking.has_insurance_url
              ? 'Proof submitted — under review'
              : 'Required before departure',
      }
    );
  } else {
    items.push({
      key: 'insurance',
      label: 'Rental insurance',
      done: true,
      note: 'Captain-led charter — Buoy rental insurance not required unless we contact you.',
    });
  }

  items.push(
    {
      key: 'review',
      label: 'Admin review',
      done: booking.status === 'confirmed' || booking.status === 'ready_for_departure',
      note:
        booking.status === 'confirmed' || booking.status === 'ready_for_departure'
          ? 'Approved'
          : 'Pending staff review',
    },
    {
      key: 'departure',
      label: 'Ready for departure',
      done: booking.status === 'ready_for_departure',
      note:
        booking.status === 'ready_for_departure'
          ? 'Cleared for pickup'
          : 'We will notify you when cleared',
    }
  );

  return items;
}

function allStepsSubmitted(booking: PublicBookingMatch, isRental: boolean): boolean {
  if (!booking.waiver_signed) return false;
  if (!isRental) return true;
  const insuranceOk =
    booking.insurance_status === 'verified' ||
    booking.insurance_status === 'submitted' ||
    booking.has_insurance_url;
  const licenseOk = booking.has_license_url || booking.license_status === 'verified';
  return insuranceOk && licenseOk;
}

export default function WaiversInsurance({ onNavigate }: WaiversInsuranceProps) {
  const [findEmail, setFindEmail] = useState('');
  const [findPhone, setFindPhone] = useState('');
  const [findCode, setFindCode] = useState('');
  const [findLoading, setFindLoading] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);

  const [booking, setBooking] = useState<PublicBookingMatch | null>(null);
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  const [waiverData, setWaiverData] = useState<WaiverFormData>({ agreed: false, signature: '' });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [damageFeeAcknowledged, setDamageFeeAcknowledged] = useState(false);
  const [waiverBusy, setWaiverBusy] = useState(false);
  const [waiverMessage, setWaiverMessage] = useState<string | null>(null);

  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseMessage, setLicenseMessage] = useState<string | null>(null);
  const [proofBusy, setProofBusy] = useState(false);
  const [proofMessage, setProofMessage] = useState<string | null>(null);

  const [submitted, setSubmitted] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualSubmissionId, setManualSubmissionId] = useState<string | null>(null);

  const fieldClass =
    'lz-input-on-dark w-full rounded-xl border border-white/15 bg-slate-950/85 px-4 py-3 text-sm shadow-inner focus:border-[var(--lz-cta)]/55 focus:outline-none focus:ring-2 focus:ring-[var(--lz-cta)]/20';

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

  const checklist = booking ? buildChecklist(booking, isRental) : [];

  const handleFindBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setFindLoading(true);
    setFindError(null);
    setSubmitted(false);

    const result = await findPublicBooking({
      email: findEmail,
      phone: findPhone,
      code: findCode || undefined,
    });

    setFindLoading(false);
    if (!result.ok) {
      setBooking(null);
      setFindError(result.message);
      setManualMode(false);
      return;
    }

    setManualMode(false);
    setManualSubmissionId(null);
    setBooking(result.booking);
    setContactEmail(findEmail.trim().toLowerCase());
    setContactPhone(findPhone.trim());
    setWaiverMessage(null);
    setLicenseMessage(null);
    setProofMessage(null);
  };

  const refreshBooking = async () => {
    if (!contactEmail || !contactPhone) return;
    const result = await findPublicBooking({
      email: contactEmail,
      phone: contactPhone,
      code: booking?.id || findCode || undefined,
    });
    if (result.ok) setBooking(result.booking);
  };

  const handleSignWaiver = async () => {
    if (!booking) return;
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
    if (!file || !booking) return;

    setLicenseBusy(true);
    setLicenseMessage(null);
    const { url, error } = await uploadDocumentToDocumentsBucket(file, 'licenses', booking.id);
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
      body: JSON.stringify({ bookingId: booking.id, email: contactEmail, licenseUrl: url }),
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
    if (!file || !booking) return;

    setProofBusy(true);
    setProofMessage(null);

    const path = `${booking.id}/buoy-${Date.now()}-${safeFileSegment(file.name)}`;
    const { error: upErr } = await supabase.storage.from('licenses').upload(path, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type || 'application/octet-stream',
    });

    if (upErr) {
      setProofMessage(upErr.message || 'Upload failed.');
      setProofBusy(false);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from('licenses').getPublicUrl(path);

    const stamp = new Date().toISOString();
    const { error: rowErr } = await supabase.from('user_verifications').upsert(
      {
        booking_id: booking.id,
        buoy_status: 'pending',
        buoy_proof_url: publicUrl,
        updated_at: stamp,
      },
      { onConflict: 'booking_id' }
    );

    if (rowErr) {
      setProofMessage(rowErr.message || 'Could not save proof.');
      setProofBusy(false);
      return;
    }

    if (env.apiUrlConfigured && env.apiUrl) {
      await fetch(`${env.apiUrl}/api/booking-mark-insurance-submitted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, email: contactEmail }),
      }).catch(() => {});
    }

    setProofBusy(false);
    setProofMessage('Insurance proof uploaded.');
    const refreshed = await findPublicBooking({
      email: contactEmail,
      phone: contactPhone,
      code: booking.id,
    });
    if (refreshed.ok) {
      setBooking(refreshed.booking);
      if (allStepsSubmitted(refreshed.booking, isRental)) setSubmitted(true);
    }
  };

  const showConfirmation =
    submitted ||
    (booking != null && booking.waiver_signed && allStepsSubmitted(booking, isRental));

  return (
    <div className="relative min-h-screen px-4 py-12 md:py-16">
      <div className="relative z-[1] mx-auto max-w-2xl">
        <header className="mb-8 text-center">
          <h1 className="font-display text-3xl font-bold uppercase tracking-[0.08em] text-white md:text-4xl">
            Waivers &amp; Insurance
          </h1>
          <p className="mt-3 text-sm text-slate-300 md:text-base">
            Complete your required pre-trip steps before departure.
          </p>
          <p className="mt-4 rounded-[var(--lz-radius)] border border-cyan-400/25 bg-cyan-950/30 px-4 py-3 text-sm text-cyan-50">
            Booked through Groupon, over the phone, or outside our website? Use this page to find your
            booking and complete your required documents.
          </p>
        </header>

        {!booking && !manualMode && !manualSubmissionId ? (
          <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
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
                <div className="rounded-lg border border-amber-400/30 bg-amber-950/40 px-4 py-3">
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
                      setManualMode(true);
                      setFindError(null);
                    })}
                    className="lz-btn-primary mt-4 w-full justify-center text-sm !normal-case !tracking-wide"
                  >
                    Continue Without Booking
                  </button>
                </div>
              ) : null}
              <button
                type="submit"
                disabled={findLoading}
                className="lz-btn-primary flex w-full items-center justify-center gap-2 text-sm !normal-case !tracking-wide"
              >
                {findLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
                Find My Booking
              </button>
            </form>
          </section>
        ) : null}

        {manualMode && !manualSubmissionId ? (
          <ManualPreTripSubmission
            initialEmail={findEmail}
            initialPhone={findPhone}
            initialGrouponCode={findCode}
            onNavigateTerms={() => onNavigate('terms')}
            onSubmitted={(id) => {
              setManualSubmissionId(id);
              setManualMode(false);
            }}
            onBack={() => {
              setManualMode(false);
            }}
          />
        ) : null}

        {manualSubmissionId ? (
          <section className="lz-card-glass rounded-[var(--lz-radius-card)] border border-emerald-400/30 p-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-300" aria-hidden />
            <h2 className="mt-4 font-display text-xl font-bold uppercase tracking-wide text-white">
              Submitted for review
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              Our team will review your documents and match them to your reservation. You are not cleared
              to operate the boat until Launch Zone Charters marks your booking{' '}
              <strong className="text-emerald-200">Ready for Departure</strong>.
            </p>
            <p className="mt-4 font-mono text-xs text-slate-500">Reference: {manualSubmissionId}</p>
          </section>
        ) : null}

        {booking ? (
          <div className="space-y-8">
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
                <button
                  type="button"
                  onClick={wrapSyncClick('waivers_insurance_change_booking', () => {
                    setBooking(null);
                    setSubmitted(false);
                  })}
                  className="text-sm font-semibold text-cyan-300 underline decoration-cyan-500/30"
                >
                  Find a different booking
                </button>
              </div>

              <ul className="mt-6 space-y-2">
                {checklist.map((item) => (
                  <li
                    key={item.key}
                    className="flex items-start gap-3 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2.5 text-sm"
                  >
                    {item.done ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
                    ) : (
                      <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden />
                    )}
                    <div>
                      <p className="font-semibold text-white">{item.label}</p>
                      {item.note ? <p className="text-xs text-slate-400">{item.note}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {showConfirmation ? (
              <section className="lz-card-glass rounded-[var(--lz-radius-card)] border border-emerald-400/30 p-6 text-center md:p-8">
                <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-300" aria-hidden />
                <h2 className="mt-4 font-display text-xl font-bold uppercase tracking-wide text-white">
                  Submitted for review
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-300">
                  Our team will review your documents before departure. You are not cleared to operate the
                  boat until Launch Zone Charters marks your booking{' '}
                  <strong className="text-emerald-200">Ready for Departure</strong>.
                </p>
              </section>
            ) : (
              <>
                {!booking.waiver_signed ? (
                  <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
                    <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">
                      Step 2 — Sign waiver
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
                      disabled={waiverBusy}
                      onClick={() => void handleSignWaiver()}
                      className="lz-btn-primary mt-6 w-full justify-center text-sm !normal-case !tracking-wide"
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
                        Step 3 — License / ID
                      </h2>
                      <p className="mt-2 text-sm text-slate-400">
                        Upload your boating license or government ID (JPEG, PNG, WebP, GIF, or PDF — max 10 MB).
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
                      {licenseMessage ? (
                        <p className="mt-3 text-sm text-slate-300" role="status">
                          {licenseMessage}
                        </p>
                      ) : null}
                    </section>

                    {insuranceConfig ? (
                      <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
                        <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">
                          Step 4 — Buoy rental insurance
                        </h2>
                        <p className="mt-2 text-sm font-semibold text-cyan-100/95">{insuranceConfig.label}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          QR and button go to the same Buoy insurance checkout.
                        </p>
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
                          className="lz-btn-primary mt-5 inline-flex w-full items-center justify-center gap-2 text-sm !normal-case !tracking-wide"
                        >
                          Get Buoy Insurance
                          <ExternalLink className="h-4 w-4" aria-hidden />
                        </a>
                      </section>
                    ) : null}

                    <section className="lz-card-glass rounded-[var(--lz-radius-card)] p-6 md:p-8">
                      <h2 className="text-sm font-bold uppercase tracking-widest text-cyan-200/90">
                        Step 5 — Upload insurance proof
                      </h2>
                      <p className="mt-2 text-sm text-slate-400">
                        After purchasing Buoy coverage, upload a screenshot or PDF of your policy (max 5 MB).
                      </p>
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
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
