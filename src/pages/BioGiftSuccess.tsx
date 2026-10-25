import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, Download, Image as ImageIcon, Loader2, Mail, Printer } from 'lucide-react';
import BioGiftTicket from '../components/gift/BioGiftTicket';
import { BIO_GIFT_NO_DATE_MESSAGE } from '../lib/bioGiftBooking';
import {
  downloadBioGiftTicketsPdf,
  downloadBioGiftTicketsPng,
  emailBioGiftTickets,
  saveBioGiftTicketTheme,
} from '../lib/bioGiftTicketApi';
import { buildBioGiftTicketViewModel } from '../lib/bioGiftTicket';
import {
  BIO_GIFT_TICKET_THEME_IDS,
  BIO_GIFT_TICKET_THEMES,
  normalizeBioGiftTicketTheme,
  readStoredBioGiftTheme,
  writeStoredBioGiftTheme,
  type BioGiftTicketThemeId,
} from '../lib/bioGiftTicketThemes';
import { env } from '../config/env.js';

interface BioGiftSuccessProps {
  onNavigate: (page: string) => void;
}

type GiftTicketResult = {
  index?: number;
  code?: string | null;
  recipientName?: string | null;
  fromName?: string | null;
  giftMessage?: string | null;
};

type GiftFinalizeResult = {
  status: string;
  packageName?: string;
  packageId?: string | null;
  guestCount?: number | null;
  ticketQuantity?: number;
  recipientMode?: string;
  ticketCodes?: string[];
  tickets?: GiftTicketResult[];
  recipientName?: string;
  fromName?: string;
  seasonYear?: number;
  seasonStart?: string | null;
  seasonEnd?: string | null;
  purchaserEmail?: string | null;
  ticketEmailSentAt?: string | null;
  ticketEmailSentTo?: string | null;
  ticketTheme?: string | null;
  alreadyFinalized?: boolean;
  error?: string;
};

export default function BioGiftSuccess({ onNavigate }: BioGiftSuccessProps) {
  void onNavigate;
  const [searchParams] = useSearchParams();
  const sessionId = (searchParams.get('session_id') || '').trim();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState<GiftFinalizeResult | null>(null);
  const [theme, setTheme] = useState<BioGiftTicketThemeId>('glow');
  const [actionBusy, setActionBusy] = useState<'pdf' | 'png' | 'email' | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const finalizedRef = useRef(false);
  const ticketNodeRefs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    if (!sessionId) {
      setError('Missing checkout session. If you completed payment, check your email for confirmation.');
      setLoading(false);
      return;
    }
    if (finalizedRef.current) return;
    finalizedRef.current = true;

    void (async () => {
      if (!env.apiUrlConfigured || !env.apiUrl) {
        setError('Could not confirm your gift. Please contact us with your receipt.');
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`${env.apiUrl}/api/finalize-bio-gift-checkout-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        const data = (await res.json().catch(() => ({}))) as GiftFinalizeResult;
        if (!res.ok) {
          throw new Error(data.error || 'Could not confirm your gift purchase.');
        }
        setResult(data);
        const stored = readStoredBioGiftTheme(sessionId);
        const nextTheme = normalizeBioGiftTicketTheme(data.ticketTheme || stored || 'glow');
        setTheme(nextTheme);
        writeStoredBioGiftTheme(sessionId, nextTheme);
        if (data.ticketEmailSentTo || data.ticketEmailSentAt) {
          setActionMessage(
            data.ticketEmailSentTo
              ? `Gift ticket PDF sent to ${data.ticketEmailSentTo}.`
              : 'Gift ticket PDF emailed to the purchaser.'
          );
        }
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not confirm your gift purchase.');
        setLoading(false);
      }
    })();
  }, [sessionId]);

  const ticketRows: GiftTicketResult[] = useMemo(() => {
    if (Array.isArray(result?.tickets) && result.tickets.length > 0) return result.tickets;
    if (Array.isArray(result?.ticketCodes)) {
      return result.ticketCodes.map((code, index) => ({
        index: index + 1,
        code,
        recipientName: result?.recipientName || null,
        fromName: result?.fromName || null,
      }));
    }
    return [];
  }, [result]);

  const ticketViews = useMemo(
    () =>
      ticketRows
        .map((ticket, index) =>
          buildBioGiftTicketViewModel({
            giftCode: ticket.code || '',
            recipientName: ticket.recipientName,
            fromName: ticket.fromName,
            giftMessage: ticket.giftMessage,
            packageName: result?.packageName,
            packageId: result?.packageId,
            seasonYear: result?.seasonYear,
            seasonStart: result?.seasonStart,
            seasonEnd: result?.seasonEnd,
            ticketIndex: ticket.index || index + 1,
            ticketCount: ticketRows.length,
          })
        )
        .filter(Boolean),
    [ticketRows, result]
  );

  const handleThemeChange = useCallback(
    (next: BioGiftTicketThemeId) => {
      setTheme(next);
      if (sessionId) writeStoredBioGiftTheme(sessionId, next);
      if (!sessionId || !env.apiUrlConfigured) return;
      void saveBioGiftTicketTheme(sessionId, next)
        .then(() => {
          setResult((prev) => (prev ? { ...prev, ticketTheme: next } : prev));
        })
        .catch(() => {
          /* local selection still applies for on-screen / PNG */
        });
    },
    [sessionId]
  );

  const handleDownloadPdf = async () => {
    if (!sessionId) return;
    setActionBusy('pdf');
    setActionError('');
    try {
      const year = result?.seasonYear || 2027;
      await downloadBioGiftTicketsPdf(sessionId, {
        theme,
        filenameHint: `LZC-${year}-bioluminescence-gift-tickets.pdf`,
      });
      setActionMessage('PDF download started.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not download PDF.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleDownloadPng = async () => {
    setActionBusy('png');
    setActionError('');
    try {
      const year = result?.seasonYear || 2027;
      const count = await downloadBioGiftTicketsPng(ticketNodeRefs.current, {
        filenamePrefix: `LZC-${year}-gift`,
      });
      setActionMessage(count === 1 ? 'PNG download started.' : `${count} PNG downloads started.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not export PNG.');
    } finally {
      setActionBusy(null);
    }
  };

  const handlePrint = () => {
    setActionError('');
    window.print();
  };

  const handleEmail = async () => {
    if (!sessionId) return;
    setActionBusy('email');
    setActionError('');
    try {
      // Persist theme first so emailed PDF matches the on-screen design.
      await saveBioGiftTicketTheme(sessionId, theme).catch(() => null);
      const out = await emailBioGiftTickets(sessionId);
      setActionMessage(
        out.to
          ? `Gift ticket PDF sent to ${out.to}.`
          : 'Gift ticket PDF emailed to the purchaser.'
      );
      setResult((prev) =>
        prev
          ? {
              ...prev,
              ticketTheme: theme,
              ticketEmailSentAt: new Date().toISOString(),
              ticketEmailSentTo: out.to || prev.ticketEmailSentTo,
            }
          : prev
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not email gift tickets.');
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div className="bio-gift-success min-h-screen bg-[#020617] text-slate-200">
      <Helmet>
        <title>Gift Confirmed | Launch Zone Charters</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        {loading ? (
          <div className="flex flex-col items-center text-center print:hidden" role="status">
            <Loader2 className="h-10 w-10 animate-spin text-cyan-400 motion-reduce:animate-none" aria-hidden />
            <p className="mt-4 text-slate-300">Confirming your gift purchase…</p>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-8 text-center print:hidden">
            <p className="text-lg font-semibold text-amber-100">We received your payment</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">{error}</p>
            <p className="mt-4 text-sm text-slate-400">
              If you were charged, our team will follow up by email. You can also{' '}
              <Link to="/contact" className="text-cyan-300 underline-offset-2 hover:underline">
                contact us
              </Link>
              .
            </p>
          </div>
        ) : (
          <div>
            <div className="text-center print:hidden">
              <CheckCircle className="mx-auto h-14 w-14 text-emerald-400" aria-hidden />
              <h1 className="mt-6 font-display text-3xl font-bold text-white">Gift purchase confirmed</h1>
              <p className="mx-auto mt-3 max-w-md text-slate-300">{BIO_GIFT_NO_DATE_MESSAGE}</p>
              <p className="mx-auto mt-2 max-w-lg text-sm text-slate-400">
                Pick a ticket look, then download PDF or PNG, print, or email.
              </p>
            </div>

            <div className="mt-8 print:hidden" role="group" aria-label="Ticket theme">
              <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Ticket design
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                {BIO_GIFT_TICKET_THEME_IDS.map((id) => {
                  const meta = BIO_GIFT_TICKET_THEMES[id];
                  const selected = theme === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleThemeChange(id)}
                      className={`rounded-xl border px-4 py-3 text-left transition ${meta.chipClass} ${
                        selected ? 'ring-2 ring-white/70' : 'opacity-80 hover:opacity-100'
                      }`}
                      aria-pressed={selected}
                    >
                      <span className="block text-sm font-bold">{meta.shortLabel}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug opacity-90">
                        {meta.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bio-gift-success-actions mt-8 flex flex-col gap-3 print:hidden sm:flex-row sm:flex-wrap sm:justify-center">
              <button
                type="button"
                className="lz-btn-primary inline-flex min-h-[48px] items-center justify-center gap-2 px-5"
                disabled={actionBusy !== null || !sessionId}
                onClick={() => void handleDownloadPdf()}
              >
                <Download className="h-4 w-4" aria-hidden />
                {actionBusy === 'pdf' ? 'Preparing PDF…' : 'Download PDF'}
              </button>
              <button
                type="button"
                className="lz-btn-secondary inline-flex min-h-[48px] items-center justify-center gap-2 px-5"
                disabled={actionBusy !== null || ticketViews.length === 0}
                onClick={() => void handleDownloadPng()}
              >
                <ImageIcon className="h-4 w-4" aria-hidden />
                {actionBusy === 'png' ? 'Preparing PNG…' : 'Download PNG'}
              </button>
              <button
                type="button"
                className="lz-btn-secondary inline-flex min-h-[48px] items-center justify-center gap-2 px-5"
                disabled={actionBusy !== null}
                onClick={handlePrint}
              >
                <Printer className="h-4 w-4" aria-hidden />
                Print ticket
              </button>
              <button
                type="button"
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border-2 border-[var(--lz-cta)] bg-[rgba(255,140,43,0.12)] px-5 text-sm font-bold uppercase tracking-[0.08em] text-[var(--lz-cta)] transition hover:bg-[rgba(255,140,43,0.2)] disabled:opacity-60"
                disabled={actionBusy !== null || !sessionId}
                onClick={() => void handleEmail()}
              >
                <Mail className="h-4 w-4" aria-hidden />
                {actionBusy === 'email' ? 'Sending…' : 'Email ticket'}
              </button>
            </div>

            {actionMessage ? (
              <p className="mt-4 text-center text-sm text-emerald-300/90 print:hidden" role="status">
                {actionMessage}
              </p>
            ) : null}
            {actionError ? (
              <p className="mt-4 text-center text-sm text-amber-200 print:hidden" role="alert">
                {actionError}
              </p>
            ) : null}

            <div className="bio-gift-ticket-print-stack mt-10 space-y-8">
              {ticketViews.map((ticket, index) =>
                ticket ? (
                  <BioGiftTicket
                    key={ticket.giftCode}
                    ref={(el) => {
                      ticketNodeRefs.current[index] = el;
                    }}
                    ticket={ticket}
                    theme={theme}
                  />
                ) : null
              )}
            </div>

            <div className="mt-10 flex flex-col items-center gap-3 print:hidden sm:flex-row sm:justify-center">
              <Link to="/" className="lz-btn-primary min-h-[48px] px-6">
                Back to home
              </Link>
              <Link
                to="/bioluminescent-tours"
                className="inline-flex min-h-[48px] items-center text-sm font-semibold text-cyan-300 underline underline-offset-2"
              >
                Bioluminescence tours
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
