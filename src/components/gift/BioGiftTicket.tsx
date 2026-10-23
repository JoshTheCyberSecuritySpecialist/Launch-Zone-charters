import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { SITE_LOGO_PATH } from '../../constants/branding';
import {
  BIO_GIFT_TICKET_COORDINATES,
  BIO_GIFT_TICKET_QR_HINT,
  BIO_GIFT_TICKET_TAGLINE,
  type BioGiftTicketViewModel,
} from '../../lib/bioGiftTicket';

type BioGiftTicketProps = {
  ticket: BioGiftTicketViewModel;
  className?: string;
};

function TicketField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-cyan-200/70">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-snug text-white sm:text-[0.95rem]">{value}</p>
    </div>
  );
}

export default function BioGiftTicket({ ticket, className = '' }: BioGiftTicketProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(ticket.redeemUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 168,
      color: {
        dark: '#0B1220',
        light: '#E8F7FF',
      },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [ticket.redeemUrl]);

  const multi =
    ticket.ticketCount != null &&
    ticket.ticketCount > 1 &&
    ticket.ticketIndex != null
      ? `Ticket ${ticket.ticketIndex} of ${ticket.ticketCount}`
      : null;

  return (
    <article
      className={`bio-gift-ticket relative overflow-hidden rounded-2xl border border-cyan-300/25 bg-[#071018] text-left shadow-[0_18px_50px_rgba(0,0,0,0.55)] print:break-inside-avoid print:shadow-none ${className}`.trim()}
      aria-label={`Gift ticket ${ticket.giftCode}`}
      data-gift-code={ticket.giftCode}
    >
      {/* Night lagoon atmosphere — CSS only, no clip art */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            'radial-gradient(120% 70% at 50% 115%, rgba(34,211,238,0.18) 0%, transparent 55%), radial-gradient(80% 50% at 80% 0%, rgba(14,116,144,0.16) 0%, transparent 50%), linear-gradient(180deg, #050a12 0%, #071821 48%, #041018 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        aria-hidden
        style={{
          backgroundImage:
            'radial-gradient(1px 1px at 12% 18%, rgba(255,255,255,0.55) 0, transparent 100%), radial-gradient(1px 1px at 28% 42%, rgba(255,255,255,0.35) 0, transparent 100%), radial-gradient(1px 1px at 47% 14%, rgba(255,255,255,0.45) 0, transparent 100%), radial-gradient(1px 1px at 63% 36%, rgba(255,255,255,0.3) 0, transparent 100%), radial-gradient(1px 1px at 78% 22%, rgba(255,255,255,0.5) 0, transparent 100%), radial-gradient(1px 1px at 88% 48%, rgba(255,255,255,0.28) 0, transparent 100%), radial-gradient(1px 1px at 18% 68%, rgba(255,255,255,0.25) 0, transparent 100%), radial-gradient(1px 1px at 55% 72%, rgba(255,255,255,0.2) 0, transparent 100%)',
        }}
      />
      {/* Soft glowing wake line */}
      <div
        className="pointer-events-none absolute bottom-[18%] left-[-5%] right-[-5%] h-px opacity-70"
        aria-hidden
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(34,211,238,0.15) 20%, rgba(125,211,252,0.55) 50%, rgba(34,211,238,0.15) 80%, transparent 100%)',
          boxShadow: '0 0 18px 2px rgba(34,211,238,0.25)',
        }}
      />

      <div className="relative grid md:grid-cols-[1fr_168px]">
        <div className="p-5 sm:p-6 md:pr-5">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
            <div>
              <img
                src={SITE_LOGO_PATH}
                alt="Launch Zone Charters"
                className="h-auto w-[132px] object-contain sm:w-[148px]"
                loading="lazy"
                decoding="async"
              />
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-100/85">
                Launch Zone Charters
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
                {BIO_GIFT_TICKET_COORDINATES}
              </p>
              {multi ? (
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--lz-cta)]">
                  {multi}
                </p>
              ) : null}
            </div>
          </div>

          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/90">
            {ticket.seasonYear} Bioluminescence Adventure
          </p>
          <h2 className="mt-2 font-display text-xl font-bold leading-tight tracking-wide text-white sm:text-2xl">
            {BIO_GIFT_TICKET_TAGLINE}
          </h2>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <TicketField label="Gifted to" value={ticket.recipientName} />
            <TicketField label="From" value={ticket.fromName} />
            <TicketField label="Experience" value={ticket.packageName} />
            <TicketField label="Guests" value={ticket.guestLabel} />
            <TicketField label="Valid season" value={ticket.validSeasonLabel} />
            <TicketField label="Gift ticket" value={ticket.giftCode} />
          </div>

          {ticket.giftMessage ? (
            <blockquote className="mt-5 border-l-2 border-cyan-400/40 pl-3 text-sm italic leading-relaxed text-slate-200">
              “{ticket.giftMessage}”
            </blockquote>
          ) : null}

          <p className="mt-6 text-[11px] leading-relaxed text-slate-400">
            Titusville · Florida Space Coast
            <br />
            Dates subject to availability and weather conditions.
            <br />
            <span className="text-cyan-200/80">launchzonecharters.com</span>
          </p>
        </div>

        {/* Perforation stub with QR */}
        <div className="relative border-t border-dashed border-cyan-200/25 bg-[#050d16]/80 p-5 md:border-l md:border-t-0 md:px-4 md:py-6">
          <div
            className="pointer-events-none absolute left-0 top-0 hidden h-full w-px md:block"
            aria-hidden
            style={{
              backgroundImage:
                'repeating-linear-gradient(180deg, transparent 0 7px, rgba(125,211,252,0.35) 7px 10px)',
            }}
          />
          <div className="flex h-full flex-col items-center justify-between gap-4 text-center">
            <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-cyan-100/80">
              Boarding stub
            </p>
            <div className="rounded-lg border border-white/15 bg-[#E8F7FF] p-2 shadow-[0_0_24px_rgba(34,211,238,0.18)]">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`QR code for gift ticket ${ticket.giftCode}`}
                  className="h-[132px] w-[132px]"
                  width={132}
                  height={132}
                />
              ) : (
                <div
                  className="flex h-[132px] w-[132px] items-center justify-center bg-slate-200 text-[10px] text-slate-600"
                  role="status"
                >
                  Preparing QR…
                </div>
              )}
            </div>
            <div>
              <p className="font-mono text-[11px] font-semibold tracking-wide text-white">
                {ticket.giftCode}
              </p>
              <p className="mt-2 max-w-[9.5rem] text-[10px] leading-snug text-slate-400">
                {BIO_GIFT_TICKET_QR_HINT}
              </p>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
