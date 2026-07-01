import { useCallback, useEffect, useState } from 'react';
import BookingFlowStepIndicator from '../components/BookingFlowStepIndicator';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink, Shield, Upload, Loader2 } from 'lucide-react';
import { beginAsyncInteraction, wrapNavigateClick } from '../lib/clickPerf';
import { env } from '../config/env.js';
import {
  PONTOON_INSURANCE,
  getInsuranceConfigForBooking,
  type BuoyInsuranceConfig,
} from '../config/buoyInsurance';
import {
  fetchVerifyBookingShell,
  markInsuranceProof,
  verifyBookingGate,
} from '../lib/publicBooking';
import { uploadBookingDocument } from '../lib/storageUpload';

interface VerifyBookingProps {
  onNavigate: (page: string) => void;
}
const FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

export default function VerifyBooking({ onNavigate }: VerifyBookingProps) {
  const [searchParams] = useSearchParams();
  const bookingId = (searchParams.get('bookingId') || '').trim();

  const [emailInput, setEmailInput] = useState('');
  const [emailGatePassed, setEmailGatePassed] = useState(false);
  const [customerEmailNorm, setCustomerEmailNorm] = useState<string | null>(null);
  const [bookingStatus, setBookingStatus] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [licenseUploading, setLicenseUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [licenseMessage, setLicenseMessage] = useState<string | null>(null);
  const [hasLicenseUrl, setHasLicenseUrl] = useState(false);
  const [uvStatus, setUvStatus] = useState<{ buoy_status: string; has_proof: boolean }>({
    buoy_status: 'pending',
    has_proof: false,
  });
  const [insuranceConfig, setInsuranceConfig] = useState<BuoyInsuranceConfig>(PONTOON_INSURANCE);

  const reloadShell = useCallback(async (bid: string) => {
    const result = await fetchVerifyBookingShell(bid);
    if (!result.ok) return result;
    setUvStatus(result.booking.insurance_verification);
    setHasLicenseUrl(result.booking.has_license_url);
    setBookingStatus(result.booking.status);
    setInsuranceConfig(
      getInsuranceConfigForBooking({
        boat_id: result.booking.boat_id,
        boats: { id: result.booking.boat_id, name: result.booking.boat_name, type: result.booking.boat_type },
      })
    );
    return result;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      setEmailGatePassed(false);
      setCustomerEmailNorm(null);

      if (!bookingId) {
        setLoadError('This link is missing a booking reference. Use the link from your email or SMS.');
        setLoading(false);
        return;
      }

      const result = await fetchVerifyBookingShell(bookingId);
      if (cancelled) return;

      if (!result.ok) {
        setLoadError(result.error);
        if (result.status) setBookingStatus(result.status);
        setLoading(false);
        return;
      }

      setBookingStatus(result.booking.status);
      setHasLicenseUrl(result.booking.has_license_url);
      setUvStatus(result.booking.insurance_verification);
      setInsuranceConfig(
        getInsuranceConfigForBooking({
          boat_id: result.booking.boat_id,
          boats: { id: result.booking.boat_id, name: result.booking.boat_name, type: result.booking.boat_type },
        })
      );
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  const handleConfirmEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadMessage(null);
    const emailNorm = emailInput.trim().toLowerCase();
    if (!bookingId || !emailNorm) return;

    const gate = await verifyBookingGate(bookingId, emailNorm);
    if (!gate.ok) {
      window.alert(gate.error || 'That email does not match this booking.');
      return;
    }
    setCustomerEmailNorm(emailNorm);
    setEmailGatePassed(true);
  };

  const handleLicenseFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !bookingId || !emailGatePassed || !customerEmailNorm) return;

    setLicenseUploading(true);
    setLicenseMessage(null);

    const { url, error } = await uploadBookingDocument({
      file,
      folder: 'licenses',
      bookingId,
      email: customerEmailNorm,
    });
    if (error || !url) {
      setLicenseMessage(error?.message || 'Could not upload license file.');
      setLicenseUploading(false);
      return;
    }

    if (env.apiUrlConfigured && env.apiUrl) {
      const res = await fetch(`${env.apiUrl}/api/booking-mark-license-submitted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, email: customerEmailNorm, licenseUrl: url }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setLicenseMessage(payload.error || 'Upload saved but booking could not be updated.');
        setLicenseUploading(false);
        return;
      }
    } else {
      setLicenseMessage('API not configured — contact support with your license file.');
      setLicenseUploading(false);
      return;
    }

    setHasLicenseUrl(true);
    setLicenseMessage('License uploaded. Our team will review it shortly.');
    setLicenseUploading(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !bookingId || !emailGatePassed || !customerEmailNorm) return;

    const isPdfByName = file.name.toLowerCase().endsWith('.pdf');
    const mimeOk =
      ALLOWED_MIME.includes(file.type) ||
      (isPdfByName && (!file.type || file.type === 'application/octet-stream'));
    if (!mimeOk) {
      setUploadMessage('Please upload an image (JPEG, PNG, WebP, GIF) or a PDF.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadMessage('File must be 5 MB or smaller.');
      return;
    }

    const perf = beginAsyncInteraction('verify_booking_license_upload');
    let outcome = 'completed';

    setUploading(true);
    setUploadMessage(null);

    try {
      perf.markNetworkStart();
      const { url, error: upErr } = await uploadBookingDocument({
        file,
        folder: 'insurance',
        bookingId,
        email: customerEmailNorm,
      });

      if (upErr || !url) {
        setUploadMessage(upErr?.message || 'Upload failed. Try again or contact us.');
        outcome = 'upload_error';
        return;
      }

      const out = await markInsuranceProof({
        bookingId,
        email: customerEmailNorm,
        proofUrl: url,
      });

      if (!out.ok) {
        setUploadMessage(out.error || 'Could not save proof. Try again.');
        outcome = 'row_error';
        return;
      }

      await reloadShell(bookingId);
      setUploadMessage('Proof uploaded. Our team will review it shortly.');
      outcome = 'success';
    } catch (err) {
      console.error('[VerifyBooking.upload]', err);
      setUploadMessage('Something went wrong. Try again.');
      outcome = 'error';
    } finally {
      setUploading(false);
      perf.end(outcome);
    }
  };

  return (
    <div className="min-h-[70vh] px-4 py-12">
      <div className="mx-auto max-w-xl">
        <BookingFlowStepIndicator currentStep={4} className="mb-6" />
        <button
          type="button"
          onClick={wrapNavigateClick('verify_booking', 'home', onNavigate)}
          className="mb-6 text-sm font-semibold text-cyan-400/90 underline decoration-cyan-500/30 hover:text-cyan-300"
        >
          ← Back to home
        </button>

        <div className="lz-card-glass rounded-[var(--lz-radius-card)] p-8 text-slate-200 shadow-[0_0_30px_rgba(0,207,255,0.08)]">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-500/10 text-cyan-200">
              <Shield className="h-6 w-6" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Complete your verification</h1>
              {bookingId && (
                <p className="text-sm text-slate-400">
                  Booking ID: <span className="font-mono text-slate-200">{bookingId}</span>
                </p>
              )}
            </div>
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              Loading…
            </div>
          )}

          {!loading && loadError && (
            <div className="rounded-lg border border-amber-400/35 bg-amber-950/40 px-4 py-3 text-amber-100">
              <p className="font-medium">{loadError}</p>
              {bookingStatus && (
                <p className="mt-2 text-sm text-amber-200/90">Current status: {bookingStatus}</p>
              )}
            </div>
          )}

          {!loading && !loadError && (
            <>
              {!emailGatePassed ? (
                <form onSubmit={(e) => void handleConfirmEmail(e)} className="space-y-4">
                  <p className="text-slate-400">
                    Enter the email address you used when booking so we can verify it&apos;s you.
                  </p>
                  <div>
                    <label htmlFor="verify-email" className="mb-1 block text-sm font-semibold text-slate-300">
                      Email
                    </label>
                    <input
                      id="verify-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      className="w-full rounded-lg border border-white/15 bg-white px-3 py-2 text-slate-900 shadow-inner focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/25"
                    />
                  </div>
                  <button
                    type="submit"
                    className="lz-btn-primary w-full justify-center text-sm !normal-case !tracking-wide"
                  >
                    Continue
                  </button>
                </form>
              ) : (
                <div className="space-y-8">
                  <section>
                    <h2 className="text-lg font-bold text-white">License / ID</h2>
                    <p className="mt-1 text-sm text-slate-400">
                      Upload a photo of your boating license or government ID. Images or PDF, max 10 MB.
                    </p>
                    {hasLicenseUrl ? (
                      <p className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-950/40 px-4 py-3 font-medium text-emerald-100">
                        License on file — upload again to replace.
                      </p>
                    ) : null}
                    <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/20 bg-slate-950/30 px-4 py-8 transition hover:border-cyan-400/40 hover:bg-cyan-500/5">
                      <Upload className="mb-2 h-8 w-8 text-slate-500" aria-hidden />
                      <span className="text-sm font-semibold text-slate-200">
                        {licenseUploading ? 'Uploading…' : 'Choose license file'}
                      </span>
                      <span className="mt-1 text-xs text-slate-500">JPEG, PNG, WebP, GIF, or PDF</span>
                      <input
                        type="file"
                        accept={FILE_ACCEPT}
                        className="sr-only"
                        disabled={licenseUploading}
                        onChange={(e) => void handleLicenseFileChange(e)}
                      />
                    </label>
                    {licenseMessage ? (
                      <p className="mt-3 text-sm text-slate-300" role="status">
                        {licenseMessage}
                      </p>
                    ) : null}
                  </section>

                  <section className="rounded-xl border border-white/10 bg-slate-950/40 p-5">
                    <h2 className="text-lg font-bold text-white">Insurance Requirement</h2>
                    <p className="mt-2 text-sm text-slate-400">
                      Launch Zone Charters requires rental liability coverage. Buoy is a common way
                      to obtain coverage for short-term boat rentals.
                    </p>
                    <p className="mt-2 text-xs font-semibold text-cyan-100/95">{insuranceConfig.label}</p>
                    <a
                      href={insuranceConfig.checkoutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                    >
                      Get Insurance
                      <ExternalLink className="h-4 w-4" aria-hidden />
                    </a>
                  </section>

                  <section>
                    <h2 className="text-lg font-bold text-white">Upload proof</h2>
                    <p className="mt-1 text-sm text-slate-400">
                      Upload a screenshot or PDF of your Buoy policy or certificate. Max 5 MB.
                    </p>

                    {uvStatus.has_proof && uvStatus.buoy_status === 'pending' && (
                      <p className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-950/40 px-4 py-3 font-medium text-emerald-100">
                        Insurance submitted for review
                      </p>
                    )}
                    {uvStatus.has_proof && uvStatus.buoy_status === 'verified' && (
                      <p className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-950/40 px-4 py-3 font-medium text-emerald-100">
                        Buoy insurance approved. Thank you.
                      </p>
                    )}
                    {uvStatus.buoy_status === 'rejected' && (
                      <p className="mt-4 rounded-lg border border-amber-400/35 bg-amber-950/40 px-4 py-3 text-amber-100">
                        Your previous proof could not be approved. Please upload a new document.
                      </p>
                    )}

                    {(!uvStatus.has_proof || uvStatus.buoy_status === 'rejected') && (
                      <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/20 bg-slate-950/30 px-4 py-8 transition hover:border-cyan-400/40 hover:bg-cyan-500/5">
                        <Upload className="mb-2 h-8 w-8 text-slate-500" aria-hidden />
                        <span className="text-sm font-semibold text-slate-200">
                          {uploading ? 'Uploading…' : 'Choose file'}
                        </span>
                        <input
                          type="file"
                          accept={FILE_ACCEPT}
                          className="sr-only"
                          disabled={uploading}
                          onChange={(e) => void handleFileChange(e)}
                        />
                      </label>
                    )}

                    {uploadMessage && (
                      <p className="mt-3 text-sm text-slate-300" role="status">
                        {uploadMessage}
                      </p>
                    )}
                  </section>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
