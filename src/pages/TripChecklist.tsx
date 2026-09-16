import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  Loader2,
  Upload,
  XCircle,
} from 'lucide-react';
import BookingFlowStepIndicator from '../components/BookingFlowStepIndicator';
import { env } from '../config/env.js';
import {
  PONTOON_INSURANCE,
  getInsuranceConfigForBooking,
  type BuoyInsuranceConfig,
} from '../config/buoyInsurance';
import { supabase } from '../lib/supabase';

interface TripChecklistProps {
  onNavigate: (page: string) => void;
}

type DocItem = {
  status: string;
  verified: boolean;
  uploaded: boolean;
  rejectionNote: string | null;
};

type Checklist = {
  bookingId: string;
  bookingStatus: string;
  boatId: string | null;
  customerName: string | null;
  deposit: {
    paid: boolean;
    amountPaid: number;
    balanceDue: number;
    totalPrice: number;
    paymentStatus: string;
  };
  waiver: { signed: boolean };
  insurance: DocItem;
  idDocument: DocItem;
  boaterCard: DocItem & { required: boolean };
  readyForDeparture: boolean;
};

type UploadType = 'buoy_insurance_proof' | 'government_id' | 'boater_safety_card';

const FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

function StatusChip({ state }: { state: 'done' | 'pending' | 'submitted' | 'rejected' }) {
  if (state === 'done') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/35 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-200">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Done
      </span>
    );
  }
  if (state === 'submitted') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/35 bg-cyan-500/10 px-2.5 py-0.5 text-xs font-semibold text-cyan-200">
        <Clock className="h-3.5 w-3.5" aria-hidden /> In review
      </span>
    );
  }
  if (state === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-400/35 bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-200">
        <XCircle className="h-3.5 w-3.5" aria-hidden /> Action needed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-xs font-semibold text-slate-300">
      <Circle className="h-3.5 w-3.5" aria-hidden /> To do
    </span>
  );
}

function ChecklistCard({
  title,
  state,
  children,
}: {
  title: string;
  state: 'done' | 'pending' | 'submitted' | 'rejected';
  children?: ReactNode;
}) {
  return (
    <section className="rounded-[var(--lz-radius)] border border-white/10 bg-slate-950/40 p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-bold text-white">{title}</h2>
        <StatusChip state={state} />
      </div>
      {children ? <div className="mt-3 text-sm text-slate-300">{children}</div> : null}
    </section>
  );
}

export default function TripChecklist({ onNavigate }: TripChecklistProps) {
  const [searchParams] = useSearchParams();
  const bookingIdParam = (searchParams.get('bookingId') || '').trim();
  const emailParam = (searchParams.get('email') || '').trim();

  const [bookingId, setBookingId] = useState(bookingIdParam);
  const [bookingIdInput, setBookingIdInput] = useState(bookingIdParam);
  const [emailInput, setEmailInput] = useState(emailParam);
  const [email, setEmail] = useState('');
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [insuranceConfig, setInsuranceConfig] = useState<BuoyInsuranceConfig>(PONTOON_INSURANCE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadingType, setUploadingType] = useState<UploadType | null>(null);
  const [message, setMessage] = useState('');
  const [waiverName, setWaiverName] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeSafety, setAgreeSafety] = useState(false);
  const [signingWaiver, setSigningWaiver] = useState(false);

  const apiReady = env.apiUrlConfigured && Boolean(env.apiUrl);

  const fetchChecklist = useCallback(
    async (bid: string, mail: string) => {
      if (!apiReady) {
        setError('API URL is not configured. Set VITE_API_URL to your backend origin.');
        return;
      }
      setLoading(true);
      setError('');
      try {
        const res = await fetch(
          `${env.apiUrl}/api/public/trip-checklist?bookingId=${encodeURIComponent(
            bid
          )}&email=${encodeURIComponent(mail)}`
        );
        const payload = (await res.json().catch(() => ({}))) as Checklist & { error?: string };
        if (!res.ok) {
          setError(payload.error || 'Could not load your trip checklist.');
          setChecklist(null);
          return;
        }
        setChecklist(payload);
        setBookingId(bid);
        setEmail(mail);
      } catch {
        setError('Could not reach the server. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [apiReady]
  );

  // Auto-load when a deep link carries both the booking id and the matching email
  // (e.g. the link in the confirmation email or from the success/insurance pages).
  const autoFetchedRef = useRef(false);
  useEffect(() => {
    if (autoFetchedRef.current) return;
    if (bookingIdParam && emailParam) {
      autoFetchedRef.current = true;
      void fetchChecklist(bookingIdParam, emailParam.toLowerCase());
    }
  }, [bookingIdParam, emailParam, fetchChecklist]);

  // Resolve the matching Buoy insurance registration from the booking's boat.
  useEffect(() => {
    let cancelled = false;
    const boatId = checklist?.boatId;
    if (!boatId) {
      setInsuranceConfig(PONTOON_INSURANCE);
      return;
    }
    void (async () => {
      const { data } = await supabase.from('boats').select('id, name, type').eq('id', boatId).maybeSingle();
      if (cancelled) return;
      setInsuranceConfig(getInsuranceConfigForBooking({ boat_id: boatId, boats: data ?? null }));
    })();
    return () => {
      cancelled = true;
    };
  }, [checklist?.boatId]);

  const handleSubmitGate = (e: React.FormEvent) => {
    e.preventDefault();
    const bid = bookingIdInput.trim();
    const mail = emailInput.trim().toLowerCase();
    if (!bid || !mail) {
      setError('Enter your booking ID and the email you booked with.');
      return;
    }
    void fetchChecklist(bid, mail);
  };

  const handleSignWaiver = async () => {
    if (!bookingId || !email) return;
    setMessage('');
    if (waiverName.trim().length < 2) {
      setMessage('Please type your full legal name to sign.');
      return;
    }
    if (!agreeTerms || !agreeSafety) {
      setMessage('Please check both boxes to agree before signing.');
      return;
    }
    setSigningWaiver(true);
    try {
      const res = await fetch(`${env.apiUrl}/api/trip-checklist/sign-waiver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId,
          email,
          typedName: waiverName.trim(),
          agreedTerms: agreeTerms,
          agreedSafety: agreeSafety,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMessage(payload.error || 'Could not save your waiver.');
        return;
      }
      setMessage('Waiver signed. Thank you.');
      await fetchChecklist(bookingId, email);
    } catch {
      setMessage('Something went wrong. Please try again.');
    } finally {
      setSigningWaiver(false);
    }
  };

  const handleUpload = async (type: UploadType, file: File | undefined) => {
    if (!file || !bookingId || !email) return;
    setMessage('');

    // Client-side pre-check for fast feedback; the server re-validates authoritatively.
    const isPdfByName = file.name.toLowerCase().endsWith('.pdf');
    const mimeOk =
      ALLOWED_MIME.includes(file.type) ||
      (isPdfByName && (!file.type || file.type === 'application/octet-stream'));
    if (!mimeOk) {
      setMessage('Please upload an image (JPEG, PNG, WebP, GIF) or a PDF.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage('File must be 5 MB or smaller.');
      return;
    }

    setUploadingType(type);
    try {
      const form = new FormData();
      form.append('bookingId', bookingId);
      form.append('email', email);
      form.append('documentType', type);
      form.append('file', file);
      const res = await fetch(`${env.apiUrl}/api/trip-checklist/upload-document`, {
        method: 'POST',
        body: form,
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMessage(payload.error || 'Could not upload your document.');
        return;
      }
      setMessage('Uploaded. Our team will review it shortly.');
      await fetchChecklist(bookingId, email);
    } catch {
      setMessage('Something went wrong. Please try again.');
    } finally {
      setUploadingType(null);
    }
  };

  const docState = (item: DocItem): 'done' | 'pending' | 'submitted' | 'rejected' => {
    if (item.verified || item.status === 'approved') return 'done';
    if (item.status === 'rejected') return 'rejected';
    if (item.status === 'uploaded') return 'submitted';
    return 'pending';
  };

  const docHint = (item: DocItem, prompt: string) => {
    if (item.verified) return 'Approved. Thank you.';
    if (item.status === 'rejected') {
      return item.rejectionNote
        ? `Rejected: ${item.rejectionNote}. Please upload a new document.`
        : 'Your previous upload was rejected. Please upload a new document.';
    }
    if (item.uploaded) return 'Uploaded — our team will review it shortly.';
    return prompt;
  };

  const uploadBox = (type: UploadType, label: string) => (
    <label className="mt-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/20 bg-slate-950/30 px-4 py-6 transition hover:border-cyan-400/40 hover:bg-cyan-500/5">
      <Upload className="mb-2 h-6 w-6 text-slate-500" aria-hidden />
      <span className="text-sm font-semibold text-slate-200">
        {uploadingType === type ? 'Uploading…' : label}
      </span>
      <span className="mt-1 text-xs text-slate-500">JPEG, PNG, WebP, GIF, or PDF · max 5 MB</span>
      <input
        type="file"
        accept={FILE_ACCEPT}
        className="sr-only"
        disabled={uploadingType !== null}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          void handleUpload(type, f);
        }}
      />
    </label>
  );

  const shell = (inner: ReactNode) => (
    <div className="relative min-h-screen px-4 py-12 md:py-16">
      <div className="relative z-[1] mx-auto max-w-lg">
        <BookingFlowStepIndicator currentStep={4} className="mb-8" />
        {inner}
      </div>
    </div>
  );

  // Email + booking ID gate (also used as the "find your booking" entry point).
  if (!checklist) {
    return shell(
      <div className="lz-card-glass rounded-[var(--lz-radius-card)] p-8 text-slate-200 md:p-10">
        <h1 className="font-display text-2xl font-bold uppercase tracking-[0.1em] text-white md:text-3xl">
          Trip Checklist
        </h1>
        <p className="mt-3 text-sm text-slate-400">
          Enter your booking ID and the email you booked with to see everything you need to complete
          before departure.
        </p>
        <form onSubmit={handleSubmitGate} className="mt-6 space-y-4">
          <div>
            <label htmlFor="tc-booking" className="mb-1 block text-sm font-semibold text-slate-300">
              Booking ID
            </label>
            <input
              id="tc-booking"
              type="text"
              value={bookingIdInput}
              onChange={(e) => setBookingIdInput(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-inner focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/25"
              placeholder="From your confirmation email"
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="tc-email" className="mb-1 block text-sm font-semibold text-slate-300">
              Email
            </label>
            <input
              id="tc-email"
              type="email"
              required
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-white px-3 py-2 text-slate-900 shadow-inner focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/25"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
          {error ? <p className="text-sm font-semibold text-red-300">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="lz-btn-primary w-full justify-center text-sm !normal-case !tracking-wide disabled:opacity-60"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
              </span>
            ) : (
              'View my checklist'
            )}
          </button>
        </form>
      </div>
    );
  }

  return shell(
    <div className="space-y-5">
      <div
        className={`rounded-[var(--lz-radius-card)] border p-6 text-center ${
          checklist.readyForDeparture
            ? 'border-emerald-400/40 bg-emerald-500/10'
            : 'border-amber-400/40 bg-amber-500/10'
        }`}
      >
        <h1 className="font-display text-xl font-bold uppercase tracking-[0.1em] text-white md:text-2xl">
          {checklist.readyForDeparture ? 'Ready for Departure ✅' : 'Almost there'}
        </h1>
        <p className="mt-2 text-sm text-slate-200/90">
          {checklist.readyForDeparture
            ? 'All pre-trip requirements are complete. See you on the water!'
            : 'Finish the items marked below before your trip. Our team reviews uploads shortly after you submit them.'}
        </p>
        <p className="mt-2 break-all font-mono text-xs text-slate-400">Booking {checklist.bookingId}</p>
      </div>

      {message ? (
        <p className="rounded-lg border border-white/10 bg-slate-950/50 px-4 py-2 text-sm text-slate-200" role="status">
          {message}
        </p>
      ) : null}

      <ChecklistCard title="Deposit payment" state={checklist.deposit.paid ? 'done' : 'pending'}>
        {checklist.deposit.paid ? (
          <>
            Deposit received{checklist.deposit.amountPaid > 0 ? ` — $${checklist.deposit.amountPaid.toFixed(2)}` : ''}.
            {checklist.deposit.balanceDue > 0 ? (
              <> Balance of ${checklist.deposit.balanceDue.toFixed(2)} is due at the dock.</>
            ) : null}
          </>
        ) : (
          'No deposit on file yet. Complete your booking to secure your reservation.'
        )}
      </ChecklistCard>

      <ChecklistCard title="Digital waiver" state={checklist.waiver.signed ? 'done' : 'pending'}>
        {checklist.waiver.signed ? (
          'Your liability waiver is signed. Thank you.'
        ) : (
          <div className="space-y-3">
            <p>Sign your liability waiver by typing your full legal name and agreeing below.</p>
            <input
              type="text"
              value={waiverName}
              onChange={(e) => setWaiverName(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-white px-3 py-2 text-slate-900 shadow-inner focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/25"
              placeholder="Full legal name"
              autoComplete="name"
            />
            <label className="flex items-start gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={agreeTerms}
                onChange={(e) => setAgreeTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span>
                I have read and agree to the liability waiver and{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">
                  terms
                </a>
                .
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={agreeSafety}
                onChange={(e) => setAgreeSafety(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span>I acknowledge the safety briefing and rules for this trip.</span>
            </label>
            <button
              type="button"
              onClick={() => void handleSignWaiver()}
              disabled={signingWaiver || !waiverName.trim() || !agreeTerms || !agreeSafety}
              className="lz-btn-primary w-full justify-center text-sm !normal-case !tracking-wide disabled:opacity-50"
            >
              {signingWaiver ? 'Signing…' : 'Sign waiver'}
            </button>
          </div>
        )}
      </ChecklistCard>

      <ChecklistCard title="Buoy rental insurance" state={checklist.insurance.verified ? 'done' : 'pending'}>
        {checklist.insurance.verified ? (
          'Insurance approved. Thank you.'
        ) : (
          <>
            <p>{insuranceConfig.label} — purchase short-term coverage, then upload your proof below.</p>
            <div className="mt-3 flex flex-col items-center gap-3">
              <img
                src={insuranceConfig.qrImage}
                alt={`Scan to complete Buoy insurance for ${insuranceConfig.label}`}
                width={200}
                height={200}
                className="h-auto w-40 rounded-lg border border-white/15 bg-white p-2"
                decoding="async"
              />
              <a
                href={insuranceConfig.checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-[var(--lz-radius)] border border-white/15 bg-slate-950/60 px-4 py-2 text-sm font-semibold text-white transition hover:border-cyan-400/30"
              >
                Get Insurance <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            </div>
          </>
        )}
      </ChecklistCard>

      <ChecklistCard title="Buoy insurance proof" state={docState(checklist.insurance)}>
        <p>{docHint(checklist.insurance, 'Upload a screenshot or PDF of your Buoy policy.')}</p>
        {!checklist.insurance.verified
          ? uploadBox('buoy_insurance_proof', checklist.insurance.uploaded ? 'Replace insurance proof' : 'Upload insurance proof')
          : null}
      </ChecklistCard>

      <ChecklistCard title="Government ID" state={docState(checklist.idDocument)}>
        <p>{docHint(checklist.idDocument, 'Upload a clear photo of your government-issued photo ID.')}</p>
        {!checklist.idDocument.verified
          ? uploadBox('government_id', checklist.idDocument.uploaded ? 'Replace government ID' : 'Upload government ID')
          : null}
      </ChecklistCard>

      {checklist.boaterCard.required ? (
        <ChecklistCard title="Boater safety card" state={docState(checklist.boaterCard)}>
          <p>
            {docHint(
              checklist.boaterCard,
              'Self-drive rentals require a boater safety education card. Upload yours below.'
            )}
          </p>
          {!checklist.boaterCard.verified
            ? uploadBox('boater_safety_card', checklist.boaterCard.uploaded ? 'Replace boater safety card' : 'Upload boater safety card')
            : null}
        </ChecklistCard>
      ) : null}

      <div className="flex justify-center pt-2">
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="lz-btn-secondary w-full max-w-xs justify-center text-sm !normal-case !tracking-wide sm:w-auto"
        >
          Home
        </button>
      </div>
    </div>
  );
}
