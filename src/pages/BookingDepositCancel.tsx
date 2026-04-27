import { useSearchParams } from 'react-router-dom';
import { XCircle } from 'lucide-react';
import { wrapNavigateClick } from '../lib/clickPerf';

interface BookingDepositCancelProps {
  onNavigate: (page: string) => void;
}

/** Shown when user returns from Stripe Checkout without paying (cancel_url). */
export default function BookingDepositCancel({ onNavigate }: BookingDepositCancelProps) {
  const [searchParams] = useSearchParams();
  const bookingId = (searchParams.get('bookingId') || '').trim();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-16">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-10 shadow-lg text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
          <XCircle className="h-8 w-8 text-amber-700" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Deposit not completed</h1>
        <p className="mt-3 text-slate-600">
          Your booking is saved{bookingId ? ' — you can complete payment from your confirmation email or by contacting us' : ''}.
        </p>
        {bookingId ? (
          <p className="mt-4 font-mono text-sm text-slate-800 break-all">{bookingId}</p>
        ) : null}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={wrapNavigateClick('booking_deposit_cancel', 'book', onNavigate)}
            className="rounded-lg bg-amber-600 px-5 py-2.5 font-semibold text-white hover:bg-amber-700"
          >
            Return to booking
          </button>
          <button
            type="button"
            onClick={wrapNavigateClick('booking_deposit_cancel', 'home', onNavigate)}
            className="rounded-lg border border-slate-300 px-5 py-2.5 font-semibold text-slate-800 hover:bg-slate-50"
          >
            Home
          </button>
        </div>
      </div>
    </div>
  );
}
