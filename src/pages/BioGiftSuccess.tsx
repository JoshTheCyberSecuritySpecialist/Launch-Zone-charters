import { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, Loader2 } from 'lucide-react';
import BioGiftTicket from '../components/gift/BioGiftTicket';
import { BIO_GIFT_NO_DATE_MESSAGE } from '../lib/bioGiftBooking';
import { buildBioGiftTicketViewModel } from '../lib/bioGiftTicket';
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
  const finalizedRef = useRef(false);

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

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200">
      <Helmet>
        <title>Gift Confirmed | Launch Zone Charters</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        {loading ? (
          <div className="flex flex-col items-center text-center" role="status">
            <Loader2 className="h-10 w-10 animate-spin text-cyan-400 motion-reduce:animate-none" aria-hidden />
            <p className="mt-4 text-slate-300">Confirming your gift purchase…</p>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-8 text-center">
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
            <div className="text-center">
              <CheckCircle className="mx-auto h-14 w-14 text-emerald-400" aria-hidden />
              <h1 className="mt-6 font-display text-3xl font-bold text-white">Gift purchase confirmed</h1>
              <p className="mx-auto mt-3 max-w-md text-slate-300">{BIO_GIFT_NO_DATE_MESSAGE}</p>
              <p className="mx-auto mt-2 max-w-lg text-sm text-slate-400">
                Your adventure tickets are ready. Download, print, and email options come next.
              </p>
            </div>

            <div className="mt-10 space-y-8">
              {ticketViews.map((ticket) =>
                ticket ? (
                  <BioGiftTicket key={ticket.giftCode} ticket={ticket} />
                ) : null
              )}
            </div>

            <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
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
