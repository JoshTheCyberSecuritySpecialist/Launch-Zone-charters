import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import BioluminescencePackageCards from '../components/booking/BioluminescencePackageCards';
import { env } from '../config/env.js';
import {
  BIO_GIFT_MAX_TICKETS,
  BIO_GIFT_MIN_TICKETS,
  BIO_GIFT_NO_DATE_MESSAGE,
  bioGiftSeasonLabel,
  buildBioGiftTicketRecipients,
  clampBioGiftTicketQuantity,
  emptyBioGiftTicketRecipient,
  formatBioGiftTotalLabel,
  isBioGiftPackageId,
  validateBioGiftRecipientsClient,
  type BioGiftRecipientMode,
  type BioGiftTicketRecipient,
} from '../lib/bioGiftBooking';
import {
  formatBioPackagePriceUsd,
  getBioPackageDisplay,
  type BioPackageId,
} from '../lib/bioluminescencePackages';
import { bioSeasonAdvanceSaleCopy, getActiveBioBookingSeason } from '../lib/bioluminescenceSeason';
import { beginAsyncInteraction } from '../lib/clickPerf';
import { directExperienceChooserPath } from '../lib/directBookingFlow.js';

type GiftStep = 'package' | 'quantity' | 'recipient' | 'purchaser' | 'review';

const STEPS: GiftStep[] = ['package', 'quantity', 'recipient', 'purchaser', 'review'];

function stepLabel(step: GiftStep): string {
  switch (step) {
    case 'package':
      return 'Experience';
    case 'quantity':
      return 'Tickets';
    case 'recipient':
      return 'Recipient';
    case 'purchaser':
      return 'Purchaser';
    case 'review':
      return 'Review';
    default:
      return step;
  }
}

function RecipientFields({
  idPrefix,
  value,
  onChange,
  heading,
}: {
  idPrefix: string;
  value: BioGiftTicketRecipient;
  onChange: (next: BioGiftTicketRecipient) => void;
  heading?: string;
}) {
  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-slate-950/35 p-4 sm:p-5">
      {heading ? <h3 className="font-display text-base font-bold text-white">{heading}</h3> : null}
      <div>
        <label className="block text-sm font-medium text-slate-300" htmlFor={`${idPrefix}-name`}>
          Recipient name
        </label>
        <input
          id={`${idPrefix}-name`}
          value={value.recipientName}
          onChange={(e) => onChange({ ...value, recipientName: e.target.value })}
          className="mt-1.5 w-full rounded-xl border border-white/15 bg-slate-950/60 px-4 py-3 text-white"
          autoComplete="name"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-300" htmlFor={`${idPrefix}-email`}>
          Recipient email <span className="text-slate-500">(optional)</span>
        </label>
        <input
          id={`${idPrefix}-email`}
          type="email"
          value={value.recipientEmail}
          onChange={(e) => onChange({ ...value, recipientEmail: e.target.value })}
          className="mt-1.5 w-full rounded-xl border border-white/15 bg-slate-950/60 px-4 py-3 text-white"
          autoComplete="email"
        />
        <p className="mt-1 text-xs text-slate-500">
          Optional — skip if you will print or hand-deliver the ticket.
        </p>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-300" htmlFor={`${idPrefix}-from`}>
          From
        </label>
        <input
          id={`${idPrefix}-from`}
          value={value.fromName}
          onChange={(e) => onChange({ ...value, fromName: e.target.value })}
          className="mt-1.5 w-full rounded-xl border border-white/15 bg-slate-950/60 px-4 py-3 text-white"
          placeholder="Name shown on the ticket"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-300" htmlFor={`${idPrefix}-message`}>
          Personal message <span className="text-slate-500">(optional)</span>
        </label>
        <textarea
          id={`${idPrefix}-message`}
          value={value.giftMessage}
          onChange={(e) => onChange({ ...value, giftMessage: e.target.value.slice(0, 400) })}
          rows={3}
          className="mt-1.5 w-full rounded-xl border border-white/15 bg-slate-950/60 px-4 py-3 text-white"
          placeholder="A short note for the ticket"
        />
        <p className="mt-1 text-xs text-slate-500">{value.giftMessage.length}/400</p>
      </div>
    </div>
  );
}

interface BioGiftBookingProps {
  onNavigate: (page: string) => void;
}

export default function BioGiftBooking({ onNavigate }: BioGiftBookingProps) {
  void onNavigate;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const packageParam = searchParams.get('package');
  const initialPackage = isBioGiftPackageId(packageParam) ? packageParam : null;

  const [packageId, setPackageId] = useState<BioPackageId | null>(initialPackage);
  const [step, setStep] = useState<GiftStep>(initialPackage ? 'quantity' : 'package');
  const [ticketQuantity, setTicketQuantity] = useState(1);
  const [recipientMode, setRecipientMode] = useState<BioGiftRecipientMode>('same');
  const [sharedRecipient, setSharedRecipient] = useState<BioGiftTicketRecipient>(
    emptyBioGiftTicketRecipient()
  );
  const [ticketRecipients, setTicketRecipients] = useState<BioGiftTicketRecipient[]>([
    emptyBioGiftTicketRecipient(),
  ]);
  const [purchaserName, setPurchaserName] = useState('');
  const [purchaserEmail, setPurchaserEmail] = useState('');
  const [purchaserPhone, setPurchaserPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const seasonSale = useMemo(() => bioSeasonAdvanceSaleCopy(getActiveBioBookingSeason()), []);
  const selectedPkg = packageId ? getBioPackageDisplay(packageId) : null;
  const totalLabel =
    packageId != null ? formatBioGiftTotalLabel(packageId, ticketQuantity) : '';
  const stepIndex = STEPS.indexOf(step);
  const showRecipientModeChoice = ticketQuantity > 1;

  const resolvedTickets = useMemo((): BioGiftTicketRecipient[] => {
    const qty = clampBioGiftTicketQuantity(ticketQuantity);
    if (recipientMode === 'same' || qty === 1) {
      return Array.from({ length: qty }, () => ({ ...sharedRecipient }));
    }
    return buildBioGiftTicketRecipients(qty, ticketRecipients);
  }, [ticketQuantity, recipientMode, sharedRecipient, ticketRecipients]);

  const selectPackage = (id: BioPackageId) => {
    setPackageId(id);
    setSearchParams({ package: id }, { replace: true });
    setStep('quantity');
    setError('');
  };

  const goNextFromQuantity = () => {
    const qty = clampBioGiftTicketQuantity(ticketQuantity);
    setTicketQuantity(qty);
    setTicketRecipients((prev) => buildBioGiftTicketRecipients(qty, prev));
    if (qty === 1) setRecipientMode('same');
    setStep('recipient');
    setError('');
  };

  const goNextFromRecipient = () => {
    const mode: BioGiftRecipientMode =
      clampBioGiftTicketQuantity(ticketQuantity) === 1 ? 'same' : recipientMode;
    const tickets =
      mode === 'same'
        ? Array.from({ length: clampBioGiftTicketQuantity(ticketQuantity) }, () => ({
            ...sharedRecipient,
          }))
        : buildBioGiftTicketRecipients(ticketQuantity, ticketRecipients);
    const recipientError = validateBioGiftRecipientsClient(mode, tickets);
    if (recipientError) {
      setError(recipientError);
      return;
    }
    setError('');
    setStep('purchaser');
  };

  const goNextFromPurchaser = () => {
    const name = purchaserName.trim();
    const email = purchaserEmail.trim();
    const phone = purchaserPhone.trim();
    if (!name) {
      setError('Enter your full name.');
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email for your receipt.');
      return;
    }
    if (!phone || phone.replace(/\D/g, '').length < 10) {
      setError('Enter a valid phone number.');
      return;
    }
    setError('');
    setStep('review');
  };

  const submitGiftCheckout = async () => {
    if (!packageId || !selectedPkg) {
      setError('Choose a bioluminescence package first.');
      setStep('package');
      return;
    }
    if (!env.apiUrlConfigured || !env.apiUrl) {
      setError('Checkout is temporarily unavailable. Please try again shortly.');
      return;
    }
    const qty = clampBioGiftTicketQuantity(ticketQuantity);
    const mode: BioGiftRecipientMode = qty === 1 ? 'same' : recipientMode;
    const tickets = resolvedTickets;
    const recipientError = validateBioGiftRecipientsClient(mode, tickets);
    if (recipientError) {
      setError(recipientError);
      setStep('recipient');
      return;
    }

    setSubmitting(true);
    setError('');
    const interaction = beginAsyncInteraction('bio_gift_checkout_submit');
    try {
      interaction.markNetworkStart();
      const res = await fetch(`${env.apiUrl}/api/create-bio-gift-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId,
          ticketQuantity: qty,
          recipientMode: mode,
          tickets: tickets.map((t) => ({
            recipientName: t.recipientName.trim(),
            recipientEmail: t.recipientEmail.trim() || null,
            giftMessage: t.giftMessage.trim() || null,
            fromName: t.fromName.trim(),
          })),
          // Backward-compatible summary fields (same-recipient / Stripe metadata)
          recipientName: tickets[0]?.recipientName.trim(),
          recipientEmail: tickets[0]?.recipientEmail.trim() || null,
          giftMessage: tickets[0]?.giftMessage.trim() || null,
          fromName: tickets[0]?.fromName.trim(),
          purchaser: {
            fullName: purchaserName.trim(),
            email: purchaserEmail.trim(),
            phone: purchaserPhone.trim(),
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Could not start gift checkout.');
      }
      interaction.end('stripe_redirect');
      window.location.assign(data.url);
    } catch (err) {
      interaction.end('error');
      setError(err instanceof Error ? err.message : 'Could not start gift checkout.');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-lz-bg text-slate-100">
      <Helmet prioritizeSeoTags>
        <title>Give a Bioluminescence Gift | Launch Zone Charters</title>
        <meta
          name="description"
          content="Give a 2027 bioluminescence night tour as a gift. No date required — your recipient chooses their adventure later."
        />
        <meta name="robots" content="noindex" />
      </Helmet>

      <section className="lz-page-hero border-b border-[var(--lz-cta)]/25 py-10 md:py-14">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--lz-cta)]">
            {seasonSale.giftEyebrow} · Gift mode
          </p>
          <h1 className="lz-page-hero-heading mt-3 font-display text-white">Give the glow</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-300 md:text-lg">
            {BIO_GIFT_NO_DATE_MESSAGE}
          </p>
          <p className="mx-auto mt-2 text-sm text-slate-400">{bioGiftSeasonLabel()}</p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <nav aria-label="Gift checkout steps" className="mb-8">
          <ol className="flex flex-wrap items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 sm:gap-3">
            {STEPS.map((s, i) => (
              <li
                key={s}
                className={
                  i === stepIndex
                    ? 'text-[var(--lz-cta)]'
                    : i < stepIndex
                      ? 'text-cyan-200/80'
                      : undefined
                }
              >
                {i > 0 ? (
                  <span className="mr-2 text-slate-600" aria-hidden>
                    ·
                  </span>
                ) : null}
                {stepLabel(s)}
              </li>
            ))}
          </ol>
        </nav>

        {error ? (
          <p
            className="mb-6 rounded-xl border border-amber-500/35 bg-amber-950/30 px-4 py-3 text-sm text-amber-100"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {step === 'package' ? (
          <div>
            <h2 className="font-display text-xl font-bold text-white">Choose the experience</h2>
            <p className="mt-2 text-sm text-slate-400">
              Each gift ticket is individual. Recipients pick a June–October night later.
            </p>
            <div className="mt-6">
              <BioluminescencePackageCards
                variant="all"
                selectedPackageId={packageId}
                onSelect={selectPackage}
              />
            </div>
            <p className="mt-8 text-center text-sm text-slate-500">
              Prefer to book a date yourself?{' '}
              <Link
                to={directExperienceChooserPath('bio')}
                className="font-semibold text-cyan-300 underline underline-offset-2"
              >
                Book a 2027 tour
              </Link>
            </p>
          </div>
        ) : null}

        {step === 'quantity' && selectedPkg ? (
          <div>
            <h2 className="font-display text-xl font-bold text-white">How many gift tickets?</h2>
            <p className="mt-2 text-sm text-slate-400">
              {selectedPkg.cardTitle} · {formatBioPackagePriceUsd(selectedPkg.directPriceUsd)} each
            </p>
            <label className="mt-6 block text-sm font-medium text-slate-300" htmlFor="gift-ticket-qty">
              Number of tickets
            </label>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-white/15 text-xl text-white hover:bg-white/5"
                aria-label="Decrease ticket quantity"
                onClick={() => setTicketQuantity((q) => clampBioGiftTicketQuantity(q - 1))}
              >
                −
              </button>
              <input
                id="gift-ticket-qty"
                type="number"
                min={BIO_GIFT_MIN_TICKETS}
                max={BIO_GIFT_MAX_TICKETS}
                value={ticketQuantity}
                onChange={(e) => setTicketQuantity(clampBioGiftTicketQuantity(e.target.value))}
                className="h-12 w-20 rounded-xl border border-white/15 bg-slate-950/60 text-center text-lg font-semibold text-white"
              />
              <button
                type="button"
                className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-white/15 text-xl text-white hover:bg-white/5"
                aria-label="Increase ticket quantity"
                onClick={() => setTicketQuantity((q) => clampBioGiftTicketQuantity(q + 1))}
              >
                +
              </button>
            </div>
            <p className="mt-4 text-sm text-slate-400">
              Total due today: <span className="font-semibold text-white">{totalLabel}</span>
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Each ticket gets its own code. You can gift them to the same person or different people.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                className="lz-btn-secondary min-h-[48px] sm:min-w-[140px]"
                onClick={() => setStep('package')}
              >
                Back
              </button>
              <button
                type="button"
                className="lz-btn-primary min-h-[48px] flex-1"
                onClick={goNextFromQuantity}
              >
                Continue
              </button>
            </div>
          </div>
        ) : null}

        {step === 'recipient' ? (
          <div>
            <h2 className="font-display text-xl font-bold text-white">Who is this gift for?</h2>
            <p className="mt-2 text-sm text-slate-400">
              {showRecipientModeChoice
                ? 'Choose one recipient for every ticket, or enter different people for each ticket.'
                : 'Recipient email is optional if you plan to print or hand-deliver the ticket.'}
            </p>

            {showRecipientModeChoice ? (
              <fieldset className="mt-6">
                <legend className="sr-only">Recipient mode</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label
                    className={`flex cursor-pointer flex-col rounded-2xl border p-4 transition ${
                      recipientMode === 'same'
                        ? 'border-[var(--lz-cta)] bg-[rgba(255,140,43,0.12)]'
                        : 'border-white/12 bg-slate-950/40 hover:border-cyan-400/35'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="recipient-mode"
                        checked={recipientMode === 'same'}
                        onChange={() => setRecipientMode('same')}
                        className="h-4 w-4 accent-[var(--lz-cta)]"
                      />
                      <span className="text-sm font-bold text-white">Same recipient / group</span>
                    </span>
                    <span className="mt-2 text-xs leading-relaxed text-slate-400">
                      One set of details applies to all {ticketQuantity} individual tickets.
                    </span>
                  </label>
                  <label
                    className={`flex cursor-pointer flex-col rounded-2xl border p-4 transition ${
                      recipientMode === 'different'
                        ? 'border-[var(--lz-cta)] bg-[rgba(255,140,43,0.12)]'
                        : 'border-white/12 bg-slate-950/40 hover:border-cyan-400/35'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="recipient-mode"
                        checked={recipientMode === 'different'}
                        onChange={() => setRecipientMode('different')}
                        className="h-4 w-4 accent-[var(--lz-cta)]"
                      />
                      <span className="text-sm font-bold text-white">Different recipients</span>
                    </span>
                    <span className="mt-2 text-xs leading-relaxed text-slate-400">
                      Enter a name (and optional email/message) for each ticket.
                    </span>
                  </label>
                </div>
              </fieldset>
            ) : null}

            <div className="mt-6 space-y-4">
              {recipientMode === 'same' || !showRecipientModeChoice ? (
                <RecipientFields
                  idPrefix="gift-shared"
                  value={sharedRecipient}
                  onChange={setSharedRecipient}
                  heading={
                    showRecipientModeChoice
                      ? `Details for all ${ticketQuantity} tickets`
                      : undefined
                  }
                />
              ) : (
                ticketRecipients.map((ticket, index) => (
                  <RecipientFields
                    key={`ticket-${index}`}
                    idPrefix={`gift-ticket-${index}`}
                    heading={`Ticket ${index + 1}`}
                    value={ticket}
                    onChange={(next) => {
                      setTicketRecipients((prev) => {
                        const copy = [...prev];
                        copy[index] = next;
                        return copy;
                      });
                    }}
                  />
                ))
              )}
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                className="lz-btn-secondary min-h-[48px] sm:min-w-[140px]"
                onClick={() => setStep('quantity')}
              >
                Back
              </button>
              <button
                type="button"
                className="lz-btn-primary min-h-[48px] flex-1"
                onClick={goNextFromRecipient}
              >
                Continue
              </button>
            </div>
          </div>
        ) : null}

        {step === 'purchaser' ? (
          <div>
            <h2 className="font-display text-xl font-bold text-white">Your contact details</h2>
            <p className="mt-2 text-sm text-slate-400">
              We send the receipt and gift tickets to you after payment.
            </p>
            <div className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300" htmlFor="gift-purchaser-name">
                  Full name
                </label>
                <input
                  id="gift-purchaser-name"
                  value={purchaserName}
                  onChange={(e) => setPurchaserName(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-white/15 bg-slate-950/60 px-4 py-3 text-white"
                  autoComplete="name"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300" htmlFor="gift-purchaser-email">
                  Email
                </label>
                <input
                  id="gift-purchaser-email"
                  type="email"
                  value={purchaserEmail}
                  onChange={(e) => setPurchaserEmail(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-white/15 bg-slate-950/60 px-4 py-3 text-white"
                  autoComplete="email"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300" htmlFor="gift-purchaser-phone">
                  Phone
                </label>
                <input
                  id="gift-purchaser-phone"
                  type="tel"
                  value={purchaserPhone}
                  onChange={(e) => setPurchaserPhone(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-white/15 bg-slate-950/60 px-4 py-3 text-white"
                  autoComplete="tel"
                  required
                />
              </div>
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                className="lz-btn-secondary min-h-[48px] sm:min-w-[140px]"
                onClick={() => setStep('recipient')}
              >
                Back
              </button>
              <button
                type="button"
                className="lz-btn-primary min-h-[48px] flex-1"
                onClick={goNextFromPurchaser}
              >
                Review gift
              </button>
            </div>
          </div>
        ) : null}

        {step === 'review' && selectedPkg ? (
          <div>
            <h2 className="font-display text-xl font-bold text-white">Review your gift</h2>
            <p className="mt-2 rounded-xl border border-cyan-400/25 bg-cyan-950/20 px-4 py-3 text-sm text-cyan-50">
              {BIO_GIFT_NO_DATE_MESSAGE} Each ticket receives its own code.
            </p>
            <dl className="mt-6 space-y-3 rounded-2xl border border-white/10 bg-slate-950/40 p-5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Experience</dt>
                <dd className="text-right font-medium text-white">{selectedPkg.cardTitle}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Gift tickets</dt>
                <dd className="text-right font-medium text-white">{ticketQuantity}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Recipient mode</dt>
                <dd className="text-right font-medium text-white">
                  {ticketQuantity === 1 || recipientMode === 'same'
                    ? 'Same recipient / group'
                    : 'Different recipients'}
                </dd>
              </div>
            </dl>

            <ul className="mt-4 space-y-3">
              {resolvedTickets.map((ticket, index) => (
                <li
                  key={`review-ticket-${index}`}
                  className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200/80">
                    Ticket {index + 1}
                  </p>
                  <p className="mt-2 font-medium text-white">
                    To: {ticket.recipientName.trim()}
                    {ticket.recipientEmail.trim() ? (
                      <span className="text-slate-400"> · {ticket.recipientEmail.trim()}</span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-slate-300">From: {ticket.fromName.trim()}</p>
                  {ticket.giftMessage.trim() ? (
                    <p className="mt-2 whitespace-pre-wrap text-slate-400">
                      “{ticket.giftMessage.trim()}”
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>

            <dl className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-slate-950/40 p-5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Purchaser</dt>
                <dd className="text-right font-medium text-white">
                  {purchaserName.trim()}
                  <br />
                  <span className="text-slate-400">{purchaserEmail.trim()}</span>
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-white/10 pt-3">
                <dt className="text-base font-semibold text-white">Total due today</dt>
                <dd className="text-right text-lg font-bold text-[var(--lz-cta)]">{totalLabel}</dd>
              </div>
            </dl>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                className="lz-btn-secondary min-h-[48px] sm:min-w-[140px]"
                disabled={submitting}
                onClick={() => setStep('purchaser')}
              >
                Back
              </button>
              <button
                type="button"
                className="lz-btn-primary min-h-[56px] flex-1 uppercase tracking-[0.08em]"
                disabled={submitting}
                onClick={() => void submitGiftCheckout()}
              >
                {submitting ? 'Starting checkout…' : 'Pay with Stripe'}
              </button>
            </div>
            <button
              type="button"
              className="mt-4 text-sm text-cyan-300 underline underline-offset-2"
              onClick={() => navigate(directExperienceChooserPath('bio', { intent: 'gift' }))}
            >
              Change package
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
