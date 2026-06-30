import type { PublicBookingMatch } from './publicBooking';

export type PreTripOverallStatus =
  | 'ready_for_departure'
  | 'submitted_for_review'
  | 'missing_items'
  | 'rejected';

export type ChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  note?: string;
};

export type PreTripSubmissionStatus = {
  id: string;
  customer_name: string | null;
  trip_type: string;
  groupon_code: string | null;
  waiver_signed: boolean;
  license_status: string;
  insurance_status: string;
  has_license_url: boolean;
  has_insurance_url: boolean;
  admin_status: string;
  matched_booking_id: string | null;
  created_at: string;
};

export type MatchedBookingSummary = {
  id: string;
  status: string;
  start_time: string;
} | null;

export function buildBookingChecklist(booking: PublicBookingMatch, isRental: boolean): ChecklistItem[] {
  const paid =
    booking.payment_status === 'deposit_paid' ||
    booking.payment_status === 'paid' ||
    booking.status === 'pending_verification' ||
    booking.status === 'confirmed' ||
    booking.status === 'ready_for_departure';

  const items: ChecklistItem[] = [
    {
      key: 'found',
      label: 'Booking found',
      done: true,
      note: 'We located your reservation',
    },
    {
      key: 'waiver',
      label: 'Waiver signed',
      done: booking.waiver_signed,
      note: booking.waiver_signed ? 'On file' : 'Still needed',
    },
  ];

  if (isRental) {
    items.push(
      {
        key: 'license',
        label: 'License / ID uploaded',
        done: booking.license_status === 'verified' || booking.has_license_url,
        note:
          booking.license_status === 'verified'
            ? 'Verified'
            : booking.has_license_url
              ? 'Uploaded — under review'
              : 'Required for self-drive rental',
      },
      {
        key: 'insurance',
        label: 'Buoy insurance completed',
        done:
          booking.insurance_status === 'verified' ||
          booking.insurance_status === 'submitted' ||
          booking.has_insurance_url,
        note:
          booking.insurance_status === 'verified'
            ? 'Verified'
            : booking.insurance_status === 'submitted' || booking.has_insurance_url
              ? 'Proof submitted — under review'
              : 'Purchase Buoy coverage and upload proof',
      }
    );
  } else {
    items.push({
      key: 'insurance',
      label: 'Buoy insurance',
      done: true,
      note: 'Captain-led charter — not required unless we contact you',
    });
  }

  items.push(
    {
      key: 'review',
      label: 'Admin review',
      done: booking.status === 'confirmed' || booking.status === 'ready_for_departure',
      note:
        booking.status === 'confirmed' || booking.status === 'ready_for_departure'
          ? 'Approved by staff'
          : 'Pending staff review',
    },
    {
      key: 'departure',
      label: 'Ready for departure',
      done: booking.status === 'ready_for_departure',
      note:
        booking.status === 'ready_for_departure'
          ? 'Cleared for pickup — see you on the water!'
          : 'We will notify you when cleared',
    }
  );

  if (!paid) {
    items.unshift({
      key: 'payment',
      label: 'Payment',
      done: false,
      note: 'Deposit or payment may still be pending',
    });
  }

  return items;
}

export function buildSubmissionChecklist(
  submission: PreTripSubmissionStatus,
  matchedBooking: MatchedBookingSummary
): ChecklistItem[] {
  const isRental = submission.trip_type !== 'captain_charter';
  const insuranceDone =
    !isRental ||
    submission.insurance_status === 'verified' ||
    submission.insurance_status === 'submitted' ||
    submission.has_insurance_url;

  const items: ChecklistItem[] = [
    {
      key: 'found',
      label: 'Manual submission received',
      done: true,
      note: 'Our team will match this to your reservation',
    },
    {
      key: 'waiver',
      label: 'Waiver signed',
      done: submission.waiver_signed,
      note: submission.waiver_signed ? 'On file' : 'Still needed',
    },
    {
      key: 'license',
      label: 'License / ID uploaded',
      done:
        submission.license_status === 'verified' ||
        submission.has_license_url ||
        (!isRental && !submission.has_license_url),
      note: submission.has_license_url
        ? submission.license_status === 'verified'
          ? 'Verified'
          : 'Uploaded — under review'
        : isRental
          ? 'Required for rentals'
          : 'Optional unless requested',
    },
    {
      key: 'insurance',
      label: 'Buoy insurance completed',
      done: insuranceDone,
      note: isRental
        ? insuranceDone
          ? 'Proof on file or under review'
          : 'Purchase Buoy coverage and upload proof'
        : 'Not required for captain-led charters',
    },
    {
      key: 'review',
      label: 'Admin review',
      done: ['matched', 'approved'].includes(submission.admin_status),
      note:
        submission.admin_status === 'pending'
          ? 'Waiting for staff to match your booking'
          : submission.admin_status === 'rejected'
            ? 'Please contact us'
            : 'Matched or approved by staff',
    },
    {
      key: 'departure',
      label: 'Ready for departure',
      done: matchedBooking?.status === 'ready_for_departure',
      note:
        matchedBooking?.status === 'ready_for_departure'
          ? 'Cleared for pickup!'
          : submission.matched_booking_id
            ? 'Waiting for final clearance'
            : 'Available after your booking is matched and approved',
    },
  ];

  return items;
}

export function deriveBookingOverallStatus(
  booking: PublicBookingMatch,
  isRental: boolean
): PreTripOverallStatus {
  if (booking.status === 'ready_for_departure') return 'ready_for_departure';
  const checklist = buildBookingChecklist(booking, isRental);
  const customerItems = checklist.filter((i) =>
    ['waiver', 'license', 'insurance'].includes(i.key)
  );
  if (customerItems.some((i) => !i.done)) return 'missing_items';
  return 'submitted_for_review';
}

export function deriveSubmissionOverallStatus(
  submission: PreTripSubmissionStatus,
  matchedBooking: MatchedBookingSummary
): PreTripOverallStatus {
  if (submission.admin_status === 'rejected') return 'rejected';
  if (matchedBooking?.status === 'ready_for_departure') return 'ready_for_departure';
  const checklist = buildSubmissionChecklist(submission, matchedBooking);
  const customerItems = checklist.filter((i) =>
    ['waiver', 'license', 'insurance'].includes(i.key)
  );
  if (customerItems.some((i) => !i.done)) return 'missing_items';
  return 'submitted_for_review';
}

export function bookingAllCustomerStepsDone(booking: PublicBookingMatch, isRental: boolean): boolean {
  if (!booking.waiver_signed) return false;
  if (!isRental) return true;
  const insuranceOk =
    booking.insurance_status === 'verified' ||
    booking.insurance_status === 'submitted' ||
    booking.has_insurance_url;
  const licenseOk = booking.has_license_url || booking.license_status === 'verified';
  return insuranceOk && licenseOk;
}

export const STATUS_COPY: Record<
  PreTripOverallStatus,
  { title: string; description: string }
> = {
  ready_for_departure: {
    title: 'Ready for Departure',
    description: 'You are cleared for pickup. Bring your ID and arrive on time.',
  },
  submitted_for_review: {
    title: 'Submitted for Review',
    description:
      'We have your documents. Our team is reviewing them — you are not cleared until we mark you Ready for Departure.',
  },
  missing_items: {
    title: 'Missing Items',
    description: 'Complete the steps below so we can review your trip.',
  },
  rejected: {
    title: 'Needs Attention',
    description: 'There was an issue with your submission. Please call us at 803-542-1761.',
  },
};
