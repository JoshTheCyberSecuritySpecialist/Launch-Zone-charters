import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, Ticket } from 'lucide-react';
import WaiverBlock, { waiverFormComplete } from '../components/booking/WaiverBlock';
import { env } from '../config/env.js';
import {
  clearGrouponClientToken,
  fetchGrouponSession,
  readGrouponClientToken,
  submitGrouponBooking,
  verifyGrouponVoucher,
  type GrouponSessionInfo,
} from '../lib/grouponBooking';

type Step = 1 | 2 | 3 | 4;

type SlotRow = { startIso: string; label: string; available: boolean };

const fieldClass =
  'lz-input-on-dark w-full rounded-xl border border-white/15 bg-slate-950/85 px-4 py-3 text-sm shadow-inner focus:border-[var(--lz-cta)]/55 focus:outline-none focus:ring-2 focus:ring-[var(--lz-cta)]/20';

function charterTypeForUi(charterType: string | null) {
  if (charterType === 'bio') return 'night_bio';
  if (charterType === 'sunset') return 'sunset_cruise';
  return 'rocket_launch';
}

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
            className={`rounded-full px-3 py-1 ${active ? 'bg-cyan-500/20 text-cyan-100' : done ? 'bg-emerald-500/15 text-emerald-100' : 'bg-white/5'}`}
          >
            {done ? '✓ ' : ''}
            {label}
          </li>
        );
      })}
    </ol>
  );
}

export default function GrouponBook() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [voucherNumber, setVoucherNumber] = useState('');
  const [lastName, setLastName] = useState('');
  const [clientToken, setClientToken] = useState(() => readGrouponClientToken());
  const [session, setSession] = useState<GrouponSessionInfo | null>(null);

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

  const bookingMode = session?.bookingType === 'rental' ? 'rental' : 'charter';

  useEffect(() => {
    if (!clientToken) return;
    void fetchGrouponSession(clientToken).then((data) => {
      if (data) {
        setSession(data);
        if (step === 1) setStep(2);
      } else {
        clearGrouponClientToken();
        setClientToken('');
      }
    });
  }, [clientToken, step]);

  const stepLabels = useMemo(
    () => ['Verify voucher', 'Choose time', 'Your details', 'Confirm'],
    []
  );

  const loadSlots = useCallback(async () => {
    if (!session || !selectedDate || !env.apiUrlConfigured || !env.apiUrl) return;
    setSlotsLoading(true);
    setError(null);
    try {
      if (session.bookingType === 'charter') {
        const q = new URLSearchParams({
          date: selectedDate,
          charterType: session.charterType || 'bio',
        });
        const res = await fetch(`${env.apiUrl}/api/availability/charter/times?${q.toString()}`);
        const payload = (await res.json()) as {
          slots?: { startIso?: string; start?: string; label?: string; available?: boolean }[];
        };
        setSlots(
          (payload.slots || []).map((slot) => ({
            startIso: String(slot.startIso || slot.start || ''),
            label: String(slot.label || slot.startIso || slot.start || ''),
            available: slot.available !== false,
          }))
        );
      } else {
        const duration = session.rentalType === 'full_day' ? 8 : 4;
        const q = new URLSearchParams({
          date: selectedDate,
          durationHours: String(duration),
        });
        if (session.rentalBoatId) q.set('boatId', session.rentalBoatId);
        else if (session.rentalLocation) q.set('location', session.rentalLocation);
        const res = await fetch(`${env.apiUrl}/api/availability/times?${q.toString()}`);
        const payload = (await res.json()) as {
          slots?: { startIso?: string; start?: string; label?: string; available?: boolean }[];
          error?: string;
        };
        if (!res.ok) throw new Error(payload.error || 'Could not load rental availability.');
        setSlots(
          (payload.slots || []).map((slot) => ({
            startIso: String(slot.startIso || slot.start || ''),
            label: String(slot.label || slot.startIso || slot.start || ''),
            available: slot.available !== false,
          }))
        );
      }
    } catch (err) {
      setSlots([]);
      setError(err instanceof Error ? err.message : 'Could not load available times.');
    } finally {
      setSlotsLoading(false);
    }
  }, [selectedDate, session]);

  useEffect(() => {
    if (step !== 2 || !selectedDate) return;
    void loadSlots();
  }, [loadSlots, selectedDate, step]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await verifyGrouponVoucher({ voucherNumber, lastName });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setClientToken(result.clientToken);
    setSession({
      reservationExpiresAt: result.reservationExpiresAt,
      voucherMasked: result.voucherMasked,
      serviceLabel: result.serviceLabel,
      coveredGuestCount: result.coveredGuestCount,
      bookingType: result.bookingType,
      charterType: result.charterType,
      rentalType: result.rentalType,
      rentalLocation: result.rentalLocation,
      rentalBoatId: result.rentalBoatId || null,
      dealName: result.dealName,
      optionName: result.optionName,
      expiresAt: result.expiresAt,
    });
    setStep(2);
  }

  async function handleSubmitBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!clientToken || !session || !selectedSlotIso) return;
    if (!waiverFormComplete(waiverData, termsAccepted, damageFeeAcknowledged)) {
      setError('Accept the terms, waiver, and financial responsibility acknowledgment to continue.');
      return;
    }
    setBusy(true);
    setError(null);
    const durationHours = session.bookingType === 'charter' ? 1 : session.rentalType === 'full_day' ? 8 : 4;
    const start = new Date(selectedSlotIso);
    const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
    const result = await submitGrouponBooking({
      clientToken,
      customer: {
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        sms_opt_in: false,
      },
      booking: {
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        special_requests: specialRequests.trim() || undefined,
      },
      waiver: { accepted: waiverData.agreed, signature: waiverData.signature.trim() },
      legal: {
        termsAccepted,
        damageFeeAcknowledged,
        signaturePresent: waiverData.signature.trim().length > 0,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    navigate(`/booking-success?bookingId=${encodeURIComponent(result.bookingId)}&groupon=1`);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-4 py-10 md:py-14">
        <div className="mb-8 flex items-center gap-3">
          <Ticket className="h-8 w-8 text-cyan-300" aria-hidden />
          <div>
            <h1 className="text-3xl font-bold text-white">Book with your Groupon voucher</h1>
            <p className="mt-1 text-sm text-slate-300">
              Verify your voucher, choose a time, and confirm — no deposit required when your voucher fully covers the trip.
              {session?.bookingType === 'rental'
                ? ' Pontoon rentals require rental insurance before departure.'
                : null}
            </p>
          </div>
        </div>

        <StepIndicator step={step} labels={stepLabels} />

        {error ? (
          <div className="mt-6 rounded-xl border border-red-400/40 bg-red-950/40 px-4 py-3 text-sm text-red-100" role="alert">
            {error}
          </div>
        ) : null}

        {step === 1 ? (
          <form className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-slate-900/50 p-6" onSubmit={(e) => void handleVerify(e)}>
            <label className="block text-sm font-semibold text-slate-200">
              Groupon voucher number
              <input
                className={`${fieldClass} mt-2`}
                value={voucherNumber}
                onChange={(e) => setVoucherNumber(e.target.value.toUpperCase())}
                autoComplete="off"
                required
              />
            </label>
            <label className="block text-sm font-semibold text-slate-200">
              Last name on voucher
              <input
                className={`${fieldClass} mt-2`}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                required
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--lz-cta)] px-6 py-3 text-base font-bold text-slate-950 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Verify voucher'}
            </button>
          </form>
        ) : null}

        {step >= 2 && session ? (
          <div className="mt-6 rounded-2xl border border-cyan-400/20 bg-cyan-950/20 p-5 text-sm text-cyan-50">
            <p className="font-semibold">{session.serviceLabel || session.optionName}</p>
            <p className="mt-1">Voucher {session.voucherMasked}</p>
            <p className="mt-1">Covers {session.coveredGuestCount} guest{session.coveredGuestCount === 1 ? '' : 's'}</p>
            {session.bookingType === 'rental' ? (
              <p className="mt-1 text-amber-100/90">
                Rental insurance is required before departure. You will receive upload instructions after booking.
              </p>
            ) : null}
            <p className="mt-1 text-cyan-100/80">Amount due today: $0.00 (Groupon voucher)</p>
          </div>
        ) : null}

        {step === 2 && session ? (
          <div className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-slate-900/50 p-6">
            <label className="block text-sm font-semibold text-slate-200">
              Date
              <input
                type="date"
                className={`${fieldClass} mt-2`}
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  setSelectedSlotIso('');
                }}
                required
              />
            </label>
            {selectedDate ? (
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-200">Available departure times</p>
                {slotsLoading ? (
                  <p className="text-sm text-slate-400">Loading times…</p>
                ) : slots.length === 0 ? (
                  <p className="text-sm text-slate-400">No times available for this date.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {slots.map((slot) => (
                      <button
                        key={slot.startIso}
                        type="button"
                        disabled={!slot.available}
                        onClick={() => setSelectedSlotIso(slot.startIso)}
                        className={`min-h-12 rounded-xl border px-4 py-3 text-left text-sm font-semibold ${
                          selectedSlotIso === slot.startIso
                            ? 'border-cyan-300 bg-cyan-900/40 text-white'
                            : slot.available
                              ? 'border-white/15 bg-slate-950/70 text-slate-100 hover:border-cyan-300/40'
                              : 'border-white/5 bg-slate-950/30 text-slate-500'
                        }`}
                      >
                        {slot.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
            <button
              type="button"
              disabled={!selectedSlotIso}
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--lz-cta)] px-6 py-3 text-base font-bold text-slate-950 disabled:opacity-60"
              onClick={() => setStep(3)}
            >
              Continue
            </button>
          </div>
        ) : null}

        {step === 3 && session ? (
          <form
            className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-slate-900/50 p-6"
            onSubmit={(e) => {
              e.preventDefault();
              setStep(4);
            }}
          >
            <label className="block text-sm font-semibold text-slate-200">
              Full name
              <input className={`${fieldClass} mt-2`} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </label>
            <label className="block text-sm font-semibold text-slate-200">
              Email
              <input
                type="email"
                className={`${fieldClass} mt-2`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
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
              />
            </label>
            <label className="block text-sm font-semibold text-slate-200">
              Special requests (optional)
              <textarea
                className={`${fieldClass} mt-2 min-h-24`}
                value={specialRequests}
                onChange={(e) => setSpecialRequests(e.target.value)}
              />
            </label>
            <WaiverBlock
              bookingMode={bookingMode}
              waiverData={waiverData}
              onWaiverDataChange={setWaiverData}
              termsAccepted={termsAccepted}
              onTermsAcceptedChange={setTermsAccepted}
              damageFeeAcknowledged={damageFeeAcknowledged}
              onDamageFeeAcknowledgedChange={setDamageFeeAcknowledged}
              onNavigateTerms={() => navigate('/terms')}
              fieldClass={fieldClass}
              idPrefix="groupon"
            />
            <button
              type="submit"
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--lz-cta)] px-6 py-3 text-base font-bold text-slate-950"
            >
              Review booking
            </button>
          </form>
        ) : null}

        {step === 4 && session ? (
          <form className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-slate-900/50 p-6" onSubmit={(e) => void handleSubmitBooking(e)}>
            <div className="space-y-2 text-sm text-slate-200">
              <p>
                <span className="font-semibold text-white">Service:</span> {session.serviceLabel}
              </p>
              <p>
                <span className="font-semibold text-white">Guests:</span> {session.coveredGuestCount}
              </p>
              <p>
                <span className="font-semibold text-white">Departure:</span>{' '}
                {selectedSlotIso ? new Date(selectedSlotIso).toLocaleString() : '—'}
              </p>
              <p>
                <span className="font-semibold text-white">Contact:</span> {fullName} · {email} · {phone}
              </p>
              <p className="rounded-xl border border-emerald-400/30 bg-emerald-950/30 px-4 py-3 text-emerald-100">
                <Check className="mr-2 inline h-4 w-4" />
                Amount due today: <strong>$0.00</strong> — covered by Groupon voucher {session.voucherMasked}
              </p>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[var(--lz-cta)] px-6 py-3 text-base font-bold text-slate-950 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Confirm Groupon booking'}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
