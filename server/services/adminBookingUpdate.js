const { DateTime } = require('luxon');
const availabilityService = require('./availabilityService');

const CUSTOMER_FACING_KEYS = new Set([
  'start_time',
  'end_time',
  'rental_location',
  'guest_count',
  'total_price',
  'final_total',
  'balance_due',
  'boat_id',
  'booking_type',
]);

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso));
  if (!Number.isFinite(d.getTime())) return String(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDateOnly(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso));
  if (!Number.isFinite(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTimeOnly(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso));
  if (!Number.isFinite(d.getTime())) return String(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '—');
  return `$${n.toFixed(2)}`;
}

function humanizeStatus(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const FIELD_LABELS = {
  start_time: 'Start time',
  end_time: 'End time',
  boat_id: 'Vessel',
  rental_location: 'Location',
  guest_count: 'Passenger count',
  booking_type: 'Booking type',
  status: 'Status',
  payment_status: 'Payment status',
  payment_method: 'Payment method',
  promo_code: 'Promo code',
  total_price: 'Final price',
  final_total: 'Final price',
  balance_due: 'Remaining balance',
  deposit_paid: 'Deposit paid',
  amount_collected: 'Amount collected',
  discount_amount: 'Discount',
  base_price: 'Original price',
  staff_notes: 'Internal admin notes',
  admin_notes: 'Customer-visible notes',
  license_status: 'License verification',
  insurance_status: 'Insurance status',
  waiver_signed: 'Waiver signed',
  booking_source: 'Booking source',
};

function formatValue(key, value, context = {}) {
  if (value == null || value === '') return '—';
  if (key === 'start_time') return formatDateTime(value);
  if (key === 'end_time') return formatDateTime(value);
  if (key === 'boat_id' && context.boatNames?.[value]) return context.boatNames[value];
  if (['total_price', 'final_total', 'balance_due', 'deposit_paid', 'amount_collected', 'discount_amount', 'base_price'].includes(key)) {
    return formatMoney(value);
  }
  if (key === 'waiver_signed') return value ? 'Yes' : 'No';
  if (key === 'booking_type') return value === 'charter' ? 'Captain charter' : 'Rental';
  if (key === 'guest_count') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (['status', 'payment_status', 'license_status', 'insurance_status'].includes(key)) {
    return humanizeStatus(value);
  }
  return String(value);
}

function customerFieldChanges(beforeCustomer, afterCustomer) {
  const changes = [];
  const pairs = [
    ['full_name', 'Customer name'],
    ['email', 'Customer email'],
    ['phone', 'Customer phone'],
  ];
  for (const [key, label] of pairs) {
    const prev = beforeCustomer?.[key] ?? null;
    const next = afterCustomer?.[key] ?? null;
    if (String(prev || '') !== String(next || '')) {
      changes.push({
        field: `customer.${key}`,
        label,
        previous: prev,
        next,
        message: `${label} changed from ${formatValue(key, prev)} to ${formatValue(key, next)}`,
        customerFacing: false,
      });
    }
  }
  return changes;
}

function bookingFieldChanges(beforeBooking, update, context = {}) {
  const changes = [];
  for (const [key, nextVal] of Object.entries(update)) {
    const prevVal = beforeBooking?.[key];
    const prevNorm = prevVal instanceof Date ? prevVal.toISOString() : prevVal;
    let nextNorm = nextVal;
    if (key === 'start_time' || key === 'end_time') {
      if (String(prevNorm || '') === String(nextNorm || '')) continue;
    } else if (String(prevNorm ?? '') === String(nextNorm ?? '')) {
      continue;
    }

    let message = '';
    const label = FIELD_LABELS[key] || key.replace(/_/g, ' ');
    if (key === 'start_time') {
      message = `Start time changed from ${formatTimeOnly(prevVal)} to ${formatTimeOnly(nextNorm)}`;
      if (beforeBooking?.start_time && nextNorm) {
        const prevDate = formatDateOnly(beforeBooking.start_time);
        const nextDate = formatDateOnly(nextNorm);
        if (prevDate !== nextDate) {
          message = `Date changed from ${prevDate} to ${nextDate}`;
        }
      }
    } else if (key === 'end_time') {
      message = `End time changed from ${formatTimeOnly(prevVal)} to ${formatTimeOnly(nextNorm)}`;
    } else if (key === 'guest_count') {
      message = `Passenger count changed from ${prevVal ?? '—'} to ${nextNorm}`;
    } else if (key === 'status') {
      message = `Status changed from ${humanizeStatus(prevVal)} to ${humanizeStatus(nextNorm)}`;
    } else {
      message = `${label} changed from ${formatValue(key, prevVal, context)} to ${formatValue(key, nextNorm, context)}`;
    }

    changes.push({
      field: key,
      label,
      previous: prevVal,
      next: nextNorm,
      message,
      customerFacing: CUSTOMER_FACING_KEYS.has(key),
    });
  }
  return changes;
}

function hasCustomerFacingChanges(changes) {
  return changes.some((c) => c.customerFacing);
}

async function logBookingChanges(supabase, bookingReliability, { bookingId, adminUserId, changes }) {
  if (!changes.length) return;
  for (const change of changes) {
    await bookingReliability.insertActivity(supabase, {
      booking_id: bookingId,
      event_type: 'booking_field_changed',
      actor_type: 'admin',
      actor_id: adminUserId,
      message: change.message,
      payload: {
        field: change.field,
        previous: change.previous,
        next: change.next,
        customerFacing: Boolean(change.customerFacing),
      },
    });
  }
  await bookingReliability.insertActivity(supabase, {
    booking_id: bookingId,
    event_type: 'booking_modified',
    actor_type: 'admin',
    actor_id: adminUserId,
    message: `Booking updated (${changes.length} change${changes.length === 1 ? '' : 's'}).`,
    payload: {
      fields: changes.map((c) => c.field),
      summaries: changes.map((c) => c.message),
    },
  });
}

module.exports = {
  CUSTOMER_FACING_KEYS,
  bookingFieldChanges,
  customerFieldChanges,
  formatValue,
  hasCustomerFacingChanges,
  logBookingChanges,
  SLOT_OVERLAP_MESSAGE:
    'This time overlaps another booking for this vessel. Please select a different time.',
};
