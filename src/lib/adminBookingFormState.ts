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
  const start = new Date(String(booking.start_time || ''));
  const end = new Date(String(booking.end_time || ''));
  const duration =
    Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
      ? Math.max(0, Math.round(((end.getTime() - start.getTime()) / 36e5) * 100) / 100)
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
    date: Number.isFinite(start.getTime()) ? ymdLocal(start) : '',
    startTime: Number.isFinite(start.getTime()) ? hhmmLocal(start) : '',
    endTime: Number.isFinite(end.getTime()) ? hhmmLocal(end) : '',
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
    status: String(booking.status || 'pending'),
    licenseStatus: String(booking.license_status || 'pending'),
    insuranceStatus: String(booking.insurance_status || 'pending'),
    waiverSigned: booking.waiver_signed ? 'yes' : 'no',
  };
}

export function buildPatchBody(form: AdminBookingFormState) {
  return {
    customer: {
      full_name: form.customerName,
      phone: form.phone,
      email: form.email,
    },
    booking: {
      boat_id: form.boatId,
      location: form.location,
      bookingType: form.bookingType,
      start_time: new Date(`${form.date}T${form.startTime}`).toISOString(),
      end_time: new Date(`${form.date}T${form.endTime}`).toISOString(),
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
      status: form.status,
      license_status: form.licenseStatus,
      insurance_status: form.insuranceStatus,
      waiver_signed: form.waiverSigned === 'yes',
    },
  };
}

export function scheduleChangedFromBooking(form: AdminBookingFormState, booking: Record<string, unknown>): boolean {
  if (form.boatId !== String(booking.boat_id || '')) return true;
  const start = form.date && form.startTime ? new Date(`${form.date}T${form.startTime}`) : null;
  const end = form.date && form.endTime ? new Date(`${form.date}T${form.endTime}`) : null;
  const startMs = start && Number.isFinite(start.getTime()) ? start.getTime() : null;
  const endMs = end && Number.isFinite(end.getTime()) ? end.getTime() : null;
  const storedStartMs = booking.start_time ? new Date(String(booking.start_time)).getTime() : null;
  const storedEndMs = booking.end_time ? new Date(String(booking.end_time)).getTime() : null;
  const minuteMs = 60 * 1000;
  if (startMs != null && storedStartMs != null && Math.abs(startMs - storedStartMs) > minuteMs) return true;
  if (endMs != null && storedEndMs != null && Math.abs(endMs - storedEndMs) > minuteMs) return true;
  if (form.bookingType === 'captain_charter' && booking.booking_type !== 'charter') return true;
  if (form.bookingType === 'rental' && booking.booking_type === 'charter') return true;
  return false;
}

export function applyDurationToForm(form: AdminBookingFormState, durationHours: number): AdminBookingFormState {
  if (!form.date || !form.startTime || durationHours <= 0) return form;
  const start = new Date(`${form.date}T${form.startTime}`);
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
  return { ...form, duration: String(durationHours), endTime: hhmmLocal(end) };
}
