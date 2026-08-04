import { trackDirectBookingEvent } from '../../lib/directBookingMarketing';
import { env } from '../../config/env.js';

const PHONE_DISPLAY = env.contactPhone || '803-542-1761';
const PHONE_TEL = `tel:${PHONE_DISPLAY.replace(/\D/g, '')}`;

const FAQ_ITEMS = [
  {
    q: 'Can I book directly instead of using Groupon?',
    a: 'Yes. You can reserve eligible tours directly through the Launch Zone Charters website. Direct reservations are booked and managed through our system. Customers who already purchased a Groupon voucher should use the dedicated Groupon redemption page and follow the voucher terms.',
  },
  {
    q: 'Why should I book directly?',
    a: 'Booking directly keeps your reservation, confirmations, required forms and trip communication connected through Launch Zone Charters. Third-party promotional prices may vary.',
  },
  {
    q: 'Is the direct price the same as the Groupon deal?',
    a: 'Our standard direct bioluminescence package prices match the regular package prices offered through our Groupon deal. Groupon may occasionally apply its own temporary promotions.',
  },
  {
    q: 'Am I charged when I submit my preferred date?',
    a: 'For direct online charter bookings, you complete secure payment through Stripe during checkout after selecting your date and time. Groupon voucher requests are submitted separately on the Groupon booking page with $0 due at request time until your trip is reviewed and confirmed.',
  },
  {
    q: 'Do I receive confirmation?',
    a: 'Direct online bookings receive confirmation details by email after checkout. Groupon requests are confirmed by our booking team after availability is reviewed. If weather or operations require a change, we will contact you.',
  },
  {
    q: 'Can I contact someone directly?',
    a: (
      <>
        Yes. Call or text the local booking team at{' '}
        <a href={PHONE_TEL} className="font-semibold text-cyan-300 underline underline-offset-2">
          {PHONE_DISPLAY}
        </a>
        .
      </>
    ),
  },
  {
    q: 'Is payment secure?',
    a: 'Yes. Direct online payments are processed securely through Stripe.',
  },
] as const;

export default function DirectBookingFAQ() {
  return (
    <div className="mt-12">
      <h3 className="text-center font-display text-xl font-bold uppercase tracking-[0.12em] text-white md:text-2xl">
        Direct Booking FAQ
      </h3>
      <div className="mx-auto mt-8 max-w-3xl space-y-3">
        {FAQ_ITEMS.map((item) => (
          <details
            key={item.q}
            className="group lz-card-glass border border-white/10 p-4 md:p-5"
            onToggle={(e) => {
              if ((e.target as HTMLDetailsElement).open) {
                trackDirectBookingEvent('direct_booking_faq_opened', { question: item.q });
              }
            }}
          >
            <summary className="cursor-pointer list-none text-sm font-semibold text-white marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="flex items-center justify-between gap-3">
                {item.q}
                <span
                  className="text-cyan-300/90 transition group-open:rotate-45 motion-reduce:transition-none"
                  aria-hidden
                >
                  +
                </span>
              </span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">{item.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
