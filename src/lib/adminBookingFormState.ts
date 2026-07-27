import {
  bookingFormTimesFromIso,
  resolveBookingDateTimeRange,
  resolveBookingRangeFromDuration,
} from './bookingDateTimeRange';

export type AdminBookingFormState = {
  customerName: string;
  phone: string;
  email: string;
  customerNotes: string;
  boatId: string;
  location: string;
  bookingType: 'rental' | 'captain_charter';
  date: string;
  startTime: string;
  endTime: string;
  duration: string;
  passengers: string;
  source: string;
  originalPrice: string;
  discount: string;
  discountReason: string;
  finalPrice: string;
  depositPaid: string;
  amountCollected: string;
  remainingBalance: string;
  paymentMethod: string;
  paymentStatus: string;
  promoCode: string;
  internalNotes: string;
  captainId: string;
  emergencyContactNotes: string;
  status: string;
  licenseStatus: string;
  insuranceStatus: string;
  waiverSigned: string;
};

const pad = (n: number) => String(n).padStart(2, '0');
export const ymdLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hhmmLocal = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const moneyField = (v: unknown) => Number(v || 0).toFixed(2);

export function bookingToFormState(booking: Record<string, unknown>): AdminBookingFormState {
  const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers;
  const times = bookingFormTimesFromIso(String(booking.start_time || ''), String(booking.end_time || ''));
  const duration =
    times.date && booking.start_time && booking.end_time
      ? (() => {
          const resolved = resolveBookingDateTimeRange({
            date: times.date,
            startTime: times.startTime,
            endTime: times.endTime,
          });
          return resolved.ok ? resolved.durationHours : Number(booking.duration_hours || 0);
        })()
      : Number(booking.duration_hours || 0);

  const charter =
    booking.booking_type === 'charter' ||
    booking.charter_type === 'captain_charter' ||
    booking.captain_included;

  return {
    customerName: (customer as { full_name?: string })?.full_name || String(booking.name || ''),
    phone: (customer as { phone?: string })?.phone || String(booking.phone || ''),
    email: (customer as { email?: string })?.email || String(booking.email || ''),
    customerNotes: String(booking.admin_notes || ''),
    boatId: String(booking.boat_id || ''),
    location: String(booking.rental_location || ''),
    bookingType: charter ? 'captain_charter' : 'rental',
    date: times.date,
    startTime: times.startTime,
    endTime: times.endTime,
    duration: String(duration || ''),
    passengers: String(booking.guest_count || 1),
    source: String(booking.booking_source || (booking.staff_created ? 'admin' : 'website')),
    originalPrice: moneyField(booking.original_total ?? booking.base_price),
    discount: moneyField(booking.discount_amount),
    discountReason: String(booking.manual_discount_reason || ''),
    finalPrice: moneyField(booking.final_total ?? booking.total_price),
    depositPaid: moneyField(booking.deposit_paid),
    amountCollected: moneyField(booking.amount_collected),
    remainingBalance: moneyField(booking.balance_due),
    paymentMethod: String(booking.payment_method || ''),
    paymentStatus: String(booking.payment_status || 'pending'),
    promoCode: String(booking.promo_code || ''),
    internalNotes: String(booking.staff_notes || booking.admin_notes || ''),
    captainId: String(booking.captain_id || ''),
    emergencyContactNotes: String(booking.emergency_contact_notes || ''),
    status: String(booking.status || 'pending'),
    licenseStatus: String(booking.license_status || 'pending'),
    insuranceStatus: String(booking.insurance_status || 'pending'),
    waiverSigned: booking.waiver_signed ? 'yes' : 'no',
  };
}

export function buildPatchBody(form: AdminBookingFormState) {
  const resolved = resolveBookingDateTimeRange({
    date: form.date,
    startTime: form.startTime,
    endTime: form.endTime,
  });
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }
  return {
    customer: {
      full_name: form.customerName,
      phone: form.phone,
      email: form.email,
    },
    booking: {
      date: form.date,
      start_time_local: form.startTime,
      end_time_local: form.endTime,
      boat_id: form.boatId,
      location: form.location,
      bookingType: form.bookingType,
      start_time: resolved.startIso,
      end_time: resolved.endIso,
      duration_hours: resolved.durationHours,
      passengerCount: form.passengers,
      booking_source: form.source,
      originalPrice: form.originalPrice,
      discount: form.discount,
      manual_discount_reason: form.discountReason,
      finalPrice: form.finalPrice,
      depositPaid: form.depositPaid,
      amountCollected: form.amountCollected,
      remainingBalance: form.remainingBalance,
      payment_method: form.paymentMethod,
      payment_status: form.paymentStatus,
      promo_code: form.promoCode,
      staff_notes: form.internalNotes,
      internal_notes: form.customerNotes,
      captainId: form.captainId || null,
      captain_id: form.captainId || null,
      emergency_contact_notes: form.emergencyContactNotes,
      emergencyContactNotes: form.emergencyContactNotes,
      status: form.status,
      license_status: form.licenseStatus,
      insurance_status: form.insuranceStatus,
      waiver_signed: form.waiverSigned === 'yes',
    },
  };
}

export function scheduleChangedFromBooking(form: AdminBookingFormState, booking: Record<string, unknown>): boolean {
  if (form.boatId !== String(booking.boat_id || '')) return true;
  const resolved = resolveBookingDateTimeRange({
    date: form.date,
    startTime: form.startTime,
    endTime: form.endTime,
  });
  if (!resolved.ok) return true;
  const storedStartMs = booking.start_time ? new Date(String(booking.start_time)).getTime() : null;
  const storedEndMs = booking.end_time ? new Date(String(booking.end_time)).getTime() : null;
  const minuteMs = 60 * 1000;
  const nextStartMs = new Date(resolved.startIso).getTime();
  const nextEndMs = new Date(resolved.endIso).getTime();
  if (storedStartMs != null && Math.abs(nextStartMs - storedStartMs) > minuteMs) return true;
  if (storedEndMs != null && Math.abs(nextEndMs - storedEndMs) > minuteMs) return true;
  if (form.bookingType === 'captain_charter' && booking.booking_type !== 'charter') return true;
  if (form.bookingType === 'rental' && booking.booking_type === 'charter') return true;
  if (form.captainId !== String(booking.captain_id || '')) return true;
  if (form.emergencyContactNotes !== String(booking.emergency_contact_notes || '')) return true;
  return false;
}

export function applyDurationToForm(form: AdminBookingFormState, durationHours: number): AdminBookingFormState {
  if (!form.date || !form.startTime || durationHours <= 0) return form;
  const resolved = resolveBookingRangeFromDuration({
    date: form.date,
    startTime: form.startTime,
    durationHours,
  });
  if (!resolved.ok) return form;
  const endLocal = bookingFormTimesFromIso(resolved.startIso, resolved.endIso);
  return { ...form, duration: String(durationHours), endTime: endLocal.endTime };
}
