import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, Home, Loader2, Sparkles } from 'lucide-react';
import { OBSERVATION_BOTTLE, OBSERVATION_BOTTLE_SHIPPING_NOTICE } from '../content/observationBottle';
import { finalizeShopCheckoutSession, fetchShopOrderStatus } from '../lib/shopApi';
import { wrapSyncClick } from '../lib/clickPerf';

interface ShopOrderSuccessProps {
  onNavigate: (page: string) => void;
}

export default function ShopOrderSuccess({ onNavigate }: ShopOrderSuccessProps) {
  void onNavigate;
  const [searchParams] = useSearchParams();
  const sessionId = (searchParams.get('session_id') || '').trim();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
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
      try {
        const out = await finalizeShopCheckoutSession(sessionId);
        setOrderNumber(out.orderNumber || '');
        setLoading(false);
      } catch (err) {
        try {
          const status = await fetchShopOrderStatus(sessionId);
          if (status.status === 'confirmed' && status.orderNumber) {
            setOrderNumber(status.orderNumber);
            setLoading(false);
            return;
          }
        } catch {
          /* fall through */
        }
        setError(err instanceof Error ? err.message : 'Could not confirm your order.');
        setLoading(false);
      }
    })();
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200">
      <Helmet>
        <title>Order Confirmed | {OBSERVATION_BOTTLE.brand}</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-20">
        {loading ? (
          <div className="flex flex-col items-center text-center" role="status">
            <Loader2 className="h-10 w-10 animate-spin text-cyan-400 motion-reduce:animate-none" aria-hidden />
            <p className="mt-4 text-slate-300">Confirming your order…</p>
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
          <div className="text-center">
            <CheckCircle className="mx-auto h-14 w-14 text-emerald-400" aria-hidden />
            <h1 className="mt-6 text-3xl font-bold text-white sm:text-4xl">Thank you for your order!</h1>
            <p className="mt-4 text-lg text-slate-300">
              Your {OBSERVATION_BOTTLE.name} purchase has been received.
            </p>
            {orderNumber ? (
              <p className="mt-2 text-sm text-cyan-200/90">
                Order number: <span className="font-mono font-semibold">{orderNumber}</span>
              </p>
            ) : null}
            <div className="mx-auto mt-8 max-w-lg rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-6 text-left">
              <p className="text-sm font-semibold uppercase tracking-wide text-cyan-300">
                Estimated processing &amp; delivery
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                12–16 business days within the United States.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">
                You will receive an email confirmation and tracking information once your order ships.
              </p>
              <p className="mt-3 text-xs text-slate-500">{OBSERVATION_BOTTLE_SHIPPING_NOTICE}</p>
            </div>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
              <Link
                to="/bioluminescence"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Continue Reading About Bioluminescence
              </Link>
              <Link
                to="/bioluminescent-tours"
                className="inline-flex items-center justify-center rounded-xl bg-[var(--lz-cta)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-slate-950 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
              >
                Book a Bioluminescence Tour
              </Link>
              <Link
                to="/"
                onClick={wrapSyncClick('shop_order_success_home', () => undefined)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
              >
                <Home className="h-4 w-4" aria-hidden />
                Return Home
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
