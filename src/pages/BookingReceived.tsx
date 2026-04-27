import { CheckCircle, Mail, Hash, ListChecks } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { wrapNavigateClick } from '../lib/clickPerf';

interface BookingReceivedProps {
  onNavigate: (page: string) => void;
}

type ConfirmationState = {
  bookingId?: string;
  email?: string;
};

export default function BookingReceived({ onNavigate }: BookingReceivedProps) {
  const location = useLocation();
  const state = (location.state ?? null) as ConfirmationState | null;
  const bookingId = state?.bookingId;
  const email = state?.email;

  if (!state?.bookingId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-primary to-secondary px-4 py-16">
        <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#071429]/90 p-10 text-center shadow-xl backdrop-blur-md">
          <h1 className="text-2xl font-bold uppercase tracking-wide text-white">Booking not found</h1>
          <p className="mt-4 text-sm text-white/70">
            This page is shown after a completed booking. If you arrived here directly, start a new reservation or contact us.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={wrapNavigateClick('booking_received', 'book', onNavigate)}
              className="rounded-lg bg-accent px-6 py-3 font-bold text-white transition-colors hover:bg-accent-hover"
            >
              Book now
            </button>
            <button
              type="button"
              onClick={wrapNavigateClick('booking_received', 'home', onNavigate)}
              className="rounded-lg border border-white/20 px-6 py-3 font-bold text-white transition-colors hover:bg-white/10"
            >
              Home
            </button>
          </div>
          <p className="mt-8 text-xs text-white/50">
            <a href="tel:803-542-1761" className="text-accent hover:underline">
              803-542-1761
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-primary to-secondary px-4 py-16">
      <div className="w-full max-w-lg rounded-xl border border-white/10 bg-[#071429]/90 p-10 shadow-2xl backdrop-blur-md">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border-2 border-accent/40 bg-accent/10">
            <CheckCircle className="h-9 w-9 text-accent" aria-hidden />
          </div>
          <h1 className="text-3xl font-bold uppercase tracking-wide text-white">Booking Confirmed</h1>
          <p className="mt-2 text-sm text-white/70">Your reservation is saved. Keep this reference handy.</p>
        </div>

        <div className="mt-8 space-y-4 rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
          <div className="flex items-start gap-3">
            <Hash className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
            <div className="text-left">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/50">Booking ID</p>
              <p className="mt-1 font-mono text-lg font-bold text-white break-all">{bookingId}</p>
            </div>
          </div>
          {email ? (
            <div className="flex items-start gap-3 border-t border-white/10 pt-4">
              <Mail className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
              <div className="text-left">
                <p className="text-xs font-semibold uppercase tracking-wider text-white/50">Email</p>
                <p className="mt-1 text-white/90 break-all">{email}</p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-8 rounded-xl border border-accent/30 bg-accent/5 p-6">
          <div className="mb-4 flex items-center gap-2 text-accent">
            <ListChecks className="h-5 w-5" aria-hidden />
            <h2 className="text-lg font-bold uppercase tracking-wide text-white">What Happens Next</h2>
          </div>
          <ul className="space-y-3 text-left text-sm text-white/80">
            <li className="flex gap-2">
              <span className="text-accent">•</span>
              <span>Arrive 15 minutes early</span>
            </li>
            <li className="flex gap-2">
              <span className="text-accent">•</span>
              <span>Bring ID</span>
            </li>
            <li className="flex gap-2">
              <span className="text-accent">•</span>
              <span>Weather dependent</span>
            </li>
          </ul>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={wrapNavigateClick('booking_received', 'fleet', onNavigate)}
            className="rounded-lg bg-accent px-6 py-3 font-bold text-white transition-colors hover:bg-accent-hover"
          >
            View boat rentals
          </button>
          <button
            type="button"
            onClick={wrapNavigateClick('booking_received', 'home', onNavigate)}
            className="rounded-lg border border-white/20 px-6 py-3 font-bold text-white transition-colors hover:bg-white/10"
          >
            Back to home
          </button>
        </div>

        <p className="mt-8 text-center text-xs text-white/50">
          Questions?{' '}
          <a href="tel:803-542-1761" className="font-semibold text-accent hover:underline">
            803-542-1761
          </a>
        </p>
      </div>
    </div>
  );
}
