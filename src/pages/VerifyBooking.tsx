import { useCallback, useEffect, useState } from 'react';
import BookingFlowStepIndicator from '../components/BookingFlowStepIndicator';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink, Shield, Upload, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logSupabaseError } from '../lib/supabaseErrors';
import { beginAsyncInteraction, wrapNavigateClick, wrapSyncClick } from '../lib/clickPerf';
import type { UserVerificationsRow } from '../lib/supabase';

interface VerifyBookingProps {
  onNavigate: (page: string) => void;
}

const BUOY_URL = 'https://www.buoy.rent/';
const FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

function safeFileSegment(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'document';
}

export default function VerifyBooking({ onNavigate }: VerifyBookingProps) {
  const [searchParams] = useSearchParams();
  const bookingId = (searchParams.get('bookingId') || '').trim();

  const [emailInput, setEmailInput] = useState('');
  const [emailGatePassed, setEmailGatePassed] = useState(false);
  const [bookingStatus, setBookingStatus] = useState<string | null>(null);
  const [customerEmailNorm, setCustomerEmailNorm] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uv, setUv] = useState<UserVerificationsRow | null>(null);

  const refreshVerification = useCallback(async (bid: string) => {
    const { data, error } = await supabase
      .from('user_verifications')
      .select('*')
      .eq('booking_id', bid)
      .maybeSingle();
    logSupabaseError('VerifyBooking.loadUserVerifications', error);
    if (data) setUv(data as UserVerificationsRow);
    else setUv(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      setEmailGatePassed(false);
      setCustomerEmailNorm(null);
      setBookingStatus(null);
      setUv(null);

      if (!bookingId) {
        setLoadError('This link is missing a booking reference. Use the link from your email or SMS.');
        setLoading(false);
        return;
      }

      const { data: booking, error: bErr } = await supabase
        .from('bookings')
        .select('id, status, customer_id')
        .eq('id', bookingId)
        .maybeSingle();

      if (cancelled) return;

      if (bErr || !booking) {
        logSupabaseError('VerifyBooking.loadBooking', bErr);
        setLoadError('We could not find that booking, or it is no longer available for verification.');
        setLoading(false);
        return;
      }

      if (!['pending', 'pending_verification'].includes(booking.status)) {
        setLoadError('This booking is not awaiting verification.');
        setBookingStatus(booking.status);
        setLoading(false);
        return;
      }

      setBookingStatus(booking.status);

      const { data: customer, error: cErr } = await supabase
        .from('customers')
        .select('email')
        .eq('id', booking.customer_id)
        .maybeSingle();

      if (cancelled) return;

      if (cErr || !customer?.email) {
        logSupabaseError('VerifyBooking.loadCustomer', cErr);
        setLoadError('Could not load customer details for this booking.');
        setLoading(false);
        return;
      }

      setCustomerEmailNorm(customer.email.trim().toLowerCase());
      await refreshVerification(bookingId);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [bookingId, refreshVerification]);

  const handleConfirmEmail = (e: React.FormEvent) => {
    e.preventDefault();
    wrapSyncClick('verify_booking_email_gate', () => {
      setUploadMessage(null);
      if (!customerEmailNorm) return;
      if (emailInput.trim().toLowerCase() !== customerEmailNorm) {
        window.alert('That email does not match this booking. Use the same email you used when booking.');
        return;
      }
      setEmailGatePassed(true);
    })();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !bookingId || !emailGatePassed) return;

    const isPdfByName = file.name.toLowerCase().endsWith('.pdf');
    const mimeOk =
      ALLOWED_MIME.includes(file.type) ||
      (isPdfByName && (!file.type || file.type === 'application/octet-stream'));
    if (!mimeOk) {
      setUploadMessage('Please upload an image (JPEG, PNG, WebP, GIF) or a PDF.');
      return;
    }
    const contentType = ALLOWED_MIME.includes(file.type)
      ? file.type
      : isPdfByName
        ? 'application/pdf'
        : file.type || 'application/octet-stream';
    if (file.size > 5 * 1024 * 1024) {
      setUploadMessage('File must be 5 MB or smaller.');
      return;
    }

    const perf = beginAsyncInteraction('verify_booking_license_upload');
    let outcome = 'completed';

    setUploading(true);
    setUploadMessage(null);

    const path = `${bookingId}/buoy-${Date.now()}-${safeFileSegment(file.name)}`;

    try {
      perf.markNetworkStart();
      const { error: upErr } = await supabase.storage.from('licenses').upload(path, file, {
        cacheControl: '3600',
        upsert: true,
        contentType,
      });

      if (upErr) {
        console.error('[VerifyBooking.storageUpload]', upErr.message);
        setUploadMessage(upErr.message || 'Upload failed. Try again or contact us.');
        outcome = 'upload_error';
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from('licenses').getPublicUrl(path);

      const stamp = new Date().toISOString();
      const { error: rowErr } = await supabase.from('user_verifications').upsert(
        {
          booking_id: bookingId,
          buoy_status: 'pending',
          buoy_proof_url: publicUrl,
          updated_at: stamp,
        },
        { onConflict: 'booking_id' }
      );

      if (rowErr) {
        logSupabaseError('VerifyBooking.upsertUserVerification', rowErr);
        setUploadMessage(rowErr.message || 'Could not save proof. Try again.');
        outcome = 'row_error';
        return;
      }

      await refreshVerification(bookingId);
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

          {!loading && !loadError && customerEmailNorm && (
            <>
              {!emailGatePassed ? (
                <form onSubmit={handleConfirmEmail} className="space-y-4">
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
                  <section className="rounded-xl border border-white/10 bg-slate-950/40 p-5">
                    <h2 className="text-lg font-bold text-white">Insurance Requirement</h2>
                    <p className="mt-2 text-sm text-slate-400">
                      Launch Zone Charters requires rental liability coverage. Buoy is a common way
                      to obtain coverage for short-term boat rentals.
                    </p>
                    <a
                      href={BUOY_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={wrapSyncClick('verify_booking_external_buoy', () => {
                        /* open via href */
                      })}
                      className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                    >
                      Get Insurance
                      <ExternalLink className="h-4 w-4" aria-hidden />
                    </a>
                    <p className="mt-3 text-xs text-slate-500">
                      Opens buoy.rent in a new tab. We do not collect Buoy credentials here, only your
                      proof of coverage.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-lg font-bold text-white">Upload proof</h2>
                    <p className="mt-1 text-sm text-slate-400">
                      Upload a screenshot or PDF of your Buoy policy or certificate. Images or PDF,
                      max 5 MB.
                    </p>

                    {uv?.buoy_proof_url && uv.buoy_status === 'pending' && (
                      <p className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-950/40 px-4 py-3 font-medium text-emerald-100">
                        Insurance submitted for review
                      </p>
                    )}
                    {uv?.buoy_proof_url && uv.buoy_status === 'verified' && (
                      <p className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-950/40 px-4 py-3 font-medium text-emerald-100">
                        Buoy insurance approved. Thank you.
                      </p>
                    )}
                    {uv?.buoy_status === 'rejected' && (
                      <p className="mt-4 rounded-lg border border-red-400/35 bg-red-950/40 px-4 py-3 text-red-100">
                        Your previous proof could not be approved. Please upload a new document.
                      </p>
                    )}

                    {(!uv?.buoy_proof_url || uv.buoy_status === 'rejected') && (
                      <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/20 bg-slate-950/30 px-4 py-8 transition hover:border-cyan-400/40 hover:bg-cyan-500/5">
                        <Upload className="mb-2 h-8 w-8 text-slate-500" aria-hidden />
                        <span className="text-sm font-semibold text-slate-200">
                          {uploading ? 'Uploading…' : 'Choose file'}
                        </span>
                        <span className="mt-1 text-xs text-slate-500">JPEG, PNG, WebP, GIF, or PDF</span>
                        <input
                          type="file"
                          accept={FILE_ACCEPT}
                          className="sr-only"
                          disabled={uploading}
                          onChange={handleFileChange}
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
