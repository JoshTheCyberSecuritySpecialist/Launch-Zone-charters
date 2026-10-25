import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, Gift, Loader2 } from 'lucide-react';
import WaiverBlock, { waiverFormComplete } from '../components/booking/WaiverBlock';
import { env } from '../config/env.js';
import {
  fetchGiftCertificate,
  redeemGiftCertificate,
  type GiftCertificatePublic,
} from '../lib/giftCertificateRedeem';

type Step = 1 | 2 | 3;
type SlotRow = { startIso: string; label: string; available: boolean };

const fieldClass =
  'lz-input-on-dark w-full rounded-xl border border-white/15 bg-slate-950/85 px-4 py-3 text-sm shadow-inner focus:border-[var(--lz-cta)]/55 focus:outline-none focus:ring-2 focus:ring-[var(--lz-cta)]/20';

function StepIndicator({ step, labels }: { step: Step; labels: string[] }) {
  return (
    <ol className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
      {labels.map((label, index) => {
        const n = (index + 1) as Step;
        const active = step === n;
        const done = step > n;
        return (
          <li
            key={label}
            className={`rounded-full px-3 py-1 ${
              active ? 'bg-cyan-500/20 text-cyan-100' : done ? 'bg-emerald-500/15 text-emerald-100' : 'bg-white/5'
            }`}
          >
            {done ? '✓ ' : ''}
            {label}
          </li>
        );
      })}
    </ol>
  );
}

export default function BioGiftRedeem() {
  const { code: codeParam } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const giftCode = String(codeParam || '')
    .trim()
    .toUpperCase();

  const [cert, setCert] = useState<GiftCertificatePublic | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState('');
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [selectedSlotIso, setSelectedSlotIso] = useState('');
  const [slotsLoading, setSlotsLoading] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');
  const [waiverData, setWaiverData] = useState({ agreed: false, signature: '' });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [damageFeeAcknowledged, setDamageFeeAcknowledged] = useState(false);

  const stepLabels = useMemo(() => ['Choose time', 'Your details', 'Confirm'], []);

  useEffect(() => {
    if (!giftCode) {
      setLoadError('Missing gift code.');
      setLoading(false);
      return;
    }
    if (!env.apiUrlConfigured || !env.apiUrl) {
      setLoadError('Booking service is not configured.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchGiftCertificate(giftCode);
        if (cancelled) return;
        setCert(data);
        if (data.recipientName) setFullName(data.recipientName);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Could not load gift ticket.');
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [giftCode]);

  const loadSlots = useCallback(async () => {
    if (!selectedDate || !env.apiUrlConfigured || !env.apiUrl) return;
    setSlotsLoading(true);
    setError(null);
    setSelectedSlotIso('');
    try {
      const q = new URLSearchParams({
        date: selectedDate,
        charterType: 'bio',
      });
      if (cert?.packageId) q.set('pricingPackageId', cert.packageId);
      if (cert?.guestCount) q.set('passengerCount', String(cert.guestCount));
      const res = await fetch(`${env.apiUrl}/api/availability/charter/times?${q.toString()}`);
      const payload = (await res.json()) as {
        slots?: { startIso?: string; start?: string; label?: string; available?: boolean }[];
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error || 'Could not load available times.');
      setSlots(
        (payload.slots || []).map((slot) => ({
          startIso: String(slot.startIso || slot.start || ''),
          label: String(slot.label || slot.startIso || slot.start || ''),
          available: slot.available !== false,
        }))
      );
    } catch (err) {
      setSlots([]);
      setError(err instanceof Error ? err.message : 'Could not load available times.');
    } finally {
      setSlotsLoading(false);
    }
  }, [selectedDate, cert?.packageId]);

  useEffect(() => {
    if (step !== 1 || !selectedDate) return;
    void loadSlots();
  }, [loadSlots, selectedDate, step]);

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    if (!cert || !selectedSlotIso) return;
    if (!waiverFormComplete(waiverData, termsAccepted, damageFeeAcknowledged, 'charter')) {
      setError('Accept the terms and waiver, and provide your signature to continue.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await redeemGiftCertificate({
        code: cert.giftCode,
        startTime: selectedSlotIso,
        customer: {
          full_name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
        },
        waiver: { accepted: waiverData.agreed, signature: waiverData.signature.trim() },
        termsAccepted,
        specialRequests: specialRequests.trim() || undefined,
      });
      navigate(`/booking-success?bookingId=${encodeURIComponent(result.bookingId)}&source=gift`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not redeem this gift ticket.');
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-300" aria-hidden />
        <span className="sr-only">Loading gift ticket…</span>
      </div>
    );
  }

  if (loadError || !cert) {
    return (
      <div className="min-h-screen bg-slate-950 px-4 py-16 text-slate-100">
        <div className="mx-auto max-w-lg text-center">
          <Gift className="mx-auto h-10 w-10 text-cyan-300" aria-hidden />
          <h1 className="mt-4 text-2xl font-bold text-white">Gift ticket not found</h1>
          <p className="mt-2 text-sm text-slate-300">{loadError || 'Check the code on your ticket and try again.'}</p>
          <Link to="/booking/gift" className="mt-6 inline-block text-sm font-semibold text-cyan-300 underline">
            Buy a bioluminescence gift ticket
          </Link>
        </div>
      </div>
    );
  }

  if (!cert.redeemable) {
    return (
      <div className="min-h-screen bg-slate-950 px-4 py-16 text-slate-100">
        <div className="mx-auto max-w-lg text-center">
          <Gift className="mx-auto h-10 w-10 text-cyan-300" aria-hidden />
          <h1 className="mt-4 text-2xl font-bold text-white">
            {cert.status === 'redeemed' ? 'Already redeemed' : 'Ticket not available'}
          </h1>
          <p className="mt-2 text-sm text-slate-300">
            {cert.status === 'redeemed'
              ? `Gift code ${cert.giftCode} was already used${cert.redeemedAt ? ` on ${new Date(cert.redeemedAt).toLocaleDateString()}` : ''}.`
              : `Gift code ${cert.giftCode} is ${cert.status} and cannot be booked online.`}
          </p>
          <p className="mt-4 text-sm text-slate-400">Questions? Call 803-542-1761.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-4 py-10 md:py-14">
        <div className="mb-8 flex items-center gap-3">
          <Gift className="h-8 w-8 text-cyan-300" aria-hidden />
          <div>
            <h1 className="text-3xl font-bold text-white">Redeem your gift ticket</h1>
            <p className="mt-1 text-sm text-slate-300">
              {cert.packageName || 'Bioluminescence tour'}
              {cert.guestCount > 1 ? ` · ${cert.guestCount} guests` : ' · 1 guest'}
              {' · '}
              Valid {cert.validFrom} – {cert.validUntil}
            </p>
            <p className="mt-1 font-mono text-xs text-cyan-200/90">{cert.giftCode}</p>
          </div>
        </div>

        {(cert.recipientName || cert.fromName) && (
          <p className="mb-6 text-sm text-slate-300">
            {cert.recipientName ? (
              <>
                For <span className="font-semibold text-white">{cert.recipientName}</span>
              </>
            ) : null}
            {cert.fromName ? (
              <>
                {cert.recipientName ? ' · ' : null}
                From <span className="font-semibold text-white">{cert.fromName}</span>
              </>
            ) : null}
          </p>
        )}

        <StepIndicator step={step} labels={stepLabels} />

        {error ? (
          <div
            className="mt-6 rounded-xl border border-red-400/40 bg-red-950/40 px-4 py-3 text-sm text-red-100"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-slate-900/50 p-6">
            <label className="block text-sm font-semibold text-slate-200">
              Tour date
              <input
                type="date"
                className={`${fieldClass} mt-2`}
                min={cert.validFrom}
                max={cert.validUntil}
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                required
              />
            </label>

            {selectedDate ? (
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-200">Available departures</p>
                {slotsLoading ? (
                  <p className="flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading times…
                  </p>
                ) : slots.length === 0 ? (
                  <p className="text-sm text-slate-400">No departures available this night. Try another date.</p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {slots.map((slot) => (
                      <li key={slot.startIso}>
                        <button
                          type="button"
                          disabled={!slot.available}
                          onClick={() => setSelectedSlotIso(slot.startIso)}
                          className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition ${
                            selectedSlotIso === slot.startIso
                              ? 'border-cyan-400/60 bg-cyan-500/15 text-white'
                              : slot.available
                                ? 'border-white/10 bg-slate-950/60 text-slate-200 hover:border-white/25'
                                : 'cursor-not-allowed border-white/5 bg-slate-950/40 text-slate-500'
                          }`}
                        >
                          {slot.label}
                          {!slot.available ? ' · Full' : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            <button
              type="button"
              disabled={!selectedSlotIso}
              onClick={() => setStep(2)}
              className="rounded-xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-40"
            >
              Continue
            </button>
          </div>
        ) : null}

        {step === 2 ? (
          <form
            className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-slate-900/50 p-6"
            onSubmit={(e) => {
              e.preventDefault();
              setStep(3);
            }}
          >
            <label className="block text-sm font-semibold text-slate-200">
              Guest full name
              <input
                className={`${fieldClass} mt-2`}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoComplete="name"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-200">
              Email
              <input
                type="email"
                className={`${fieldClass} mt-2`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-200">
              Phone
              <input
                type="tel"
                className={`${fieldClass} mt-2`}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoComplete="tel"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-200">
              Special requests (optional)
              <textarea
                className={`${fieldClass} mt-2 min-h-[80px]`}
                value={specialRequests}
                onChange={(e) => setSpecialRequests(e.target.value)}
                maxLength={1000}
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-slate-200"
              >
                Back
              </button>
              <button
                type="submit"
                className="rounded-xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950"
              >
                Continue
              </button>
            </div>
          </form>
        ) : null}

        {step === 3 ? (
          <form
            className="mt-8 space-y-6 rounded-2xl border border-white/10 bg-slate-900/50 p-6"
            onSubmit={(e) => void handleRedeem(e)}
          >
            <div className="rounded-xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
              <p className="font-semibold text-white">Confirm redemption</p>
              <p className="mt-1">{cert.packageName}</p>
              <p>
                {fullName} · {email} · {phone}
              </p>
              <p className="mt-1 text-cyan-200">
                {selectedSlotIso
                  ? new Date(selectedSlotIso).toLocaleString(undefined, {
                      weekday: 'long',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })
                  : '—'}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Redeeming books your tour now and uses this gift ticket. No additional payment is charged.
              </p>
            </div>

            <WaiverBlock
              bookingMode="charter"
              waiverData={waiverData}
              onWaiverDataChange={setWaiverData}
              termsAccepted={termsAccepted}
              onTermsAcceptedChange={setTermsAccepted}
              damageFeeAcknowledged={damageFeeAcknowledged}
              onDamageFeeAcknowledgedChange={setDamageFeeAcknowledged}
              onNavigateTerms={() => navigate('/terms')}
              fieldClass={fieldClass}
              idPrefix="gift-redeem"
            />

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={busy}
                className="rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-slate-200 disabled:opacity-40"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                Confirm booking
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
