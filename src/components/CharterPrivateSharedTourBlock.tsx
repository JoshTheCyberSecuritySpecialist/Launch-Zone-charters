import type { Dispatch, SetStateAction } from 'react';

type CharterVariant = 'private' | 'shared';

type BookingDataSlice = {
  charterVariant: CharterVariant;
  passengerCount: number;
};

type CharterPrivateSharedTourBlockProps<T extends BookingDataSlice> = {
  sectionTitle: string;
  perPerson: number;
  maxSharedGuests: number;
  sharedOpenWindow: boolean;
  bookingData: T;
  setBookingData: Dispatch<SetStateAction<T>>;
  hasSelectedBoat: boolean;
  pricingTotal: number;
  fieldClass: string;
  bookingChoiceActive: string;
  bookingChoiceIdle: string;
};

export default function CharterPrivateSharedTourBlock<T extends BookingDataSlice>({
  sectionTitle,
  perPerson,
  maxSharedGuests,
  sharedOpenWindow,
  bookingData,
  setBookingData,
  hasSelectedBoat,
  pricingTotal,
  fieldClass,
  bookingChoiceActive,
  bookingChoiceIdle,
}: CharterPrivateSharedTourBlockProps<T>) {
  const isShared = bookingData.charterVariant === 'shared';

  return (
    <div className="rounded-[var(--lz-radius)] border border-cyan-400/25 bg-cyan-950/20 p-4">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-cyan-200">{sectionTitle}</p>
      <p className="mb-2 text-xs text-cyan-200/90">⏳ Shared seats open 48 hours before departure</p>
      <p className="mb-3 text-xs text-slate-400">
        Private = one total for your group. Shared = ${perPerson} per person (total updates with guests).
      </p>
      {!sharedOpenWindow && (
        <p className="mb-3 text-xs text-amber-300">
          Shared charter seats are only available within 48 hours of departure.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() =>
            setBookingData((prev) => ({
              ...prev,
              charterVariant: 'private',
              passengerCount: Math.min(6, Math.max(1, prev.passengerCount || 4)),
            }))
          }
          className={`rounded-xl border px-4 py-3 text-left transition md:px-5 md:py-3.5 ${
            bookingData.charterVariant === 'private' ? bookingChoiceActive : bookingChoiceIdle
          }`}
        >
          <p className="font-semibold text-white">Private</p>
          <p className="mt-1 text-xs text-slate-300">
            {hasSelectedBoat
              ? `Full charter total $${pricingTotal.toFixed(2)} · your boat only · up to 6 guests`
              : 'Starting rates available · select a boat to see your final total'}
          </p>
        </button>
        <button
          type="button"
          onClick={() =>
            sharedOpenWindow &&
            setBookingData((prev) => ({
              ...prev,
              charterVariant: 'shared',
              passengerCount: Math.min(maxSharedGuests, Math.max(1, prev.passengerCount || 1)),
            }))
          }
          disabled={!sharedOpenWindow}
          className={`rounded-xl border px-4 py-3 text-left transition md:px-5 md:py-3.5 ${
            bookingData.charterVariant === 'shared'
              ? bookingChoiceActive
              : sharedOpenWindow
                ? bookingChoiceIdle
                : 'cursor-not-allowed border-white/10 bg-slate-950/25 opacity-60'
          }`}
        >
          <p className="font-semibold text-white">Shared</p>
          <p className="mt-1 text-xs text-slate-300">
            ${perPerson} per person · shared seating limited to {maxSharedGuests} guests per booking
          </p>
          {!sharedOpenWindow && (
            <p className="mt-1 text-xs text-cyan-200/90">
              Planning ahead? Book a private charter for guaranteed availability.
            </p>
          )}
        </button>
      </div>

      <div className="mt-4">
        <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
          Guests
        </label>
        <input
          type="number"
          min={1}
          max={isShared ? maxSharedGuests : 6}
          value={bookingData.passengerCount}
          onChange={(e) =>
            setBookingData((prev) => ({
              ...prev,
              passengerCount: Math.min(
                isShared ? maxSharedGuests : 6,
                Math.max(1, parseInt(e.target.value, 10) || 1)
              ),
            }))
          }
          className={fieldClass}
        />
        {isShared && (
          <p className="mt-2 text-xs text-amber-300">
            Shared bookings are limited to {maxSharedGuests} guests per reservation.
          </p>
        )}
      </div>
    </div>
  );
}
