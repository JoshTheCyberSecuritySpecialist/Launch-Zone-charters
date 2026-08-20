import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarPlus, Pencil, RotateCcw, Save } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import AdminResponsiveList from '../components/admin/AdminResponsiveList';
import MobileAdminCard from '../components/admin/MobileAdminCard';
import StatusBadge from '../components/admin/StatusBadge';
import { humanizeLabel } from '../components/admin/adminDisplay';
import { env } from '../config/env.js';
import { PRICING } from '../config/pricing';
import { CHARTER_MAX_PASSENGERS, validateCharterPassengerCount } from '../lib/charterCapacity';
import {
  type StaffDurationPreset,
  applyStaffDurationPresetChange,
  computeStaffBookingOriginalPrice,
  durationFieldsForNewBookingType,
  durationHoursFromStaffForm,
  staffDurationFieldsFromHours,
} from '../lib/staffBookingDuration';
import {
  CAPTAIN_NIGHT_SCHEDULE_NOTE,
  previewCaptainCharterWindow,
} from '../lib/captainNightWindow';
import { fetchActiveCaptains, type AdminCaptainListItem } from '../lib/adminCaptains';
import {
  BIO_STAFF_PACKAGE_OPTIONS,
  type BioPackageId,
  getBioPackageDisplay,
  isDirectBioPackagePricingEnabled,
} from '../lib/bioluminescencePackages';
import {
  ROCKET_STAFF_PACKAGE_OPTIONS,
  ROCKET_LAUNCH_MIN_GUESTS,
  type RocketPackageId,
  getRocketPackageDisplay,
  isDirectRocketPackagePricingEnabled,
} from '../lib/rocketLaunchPackages';

type BookingType = 'rental' | 'captain_charter';
type CharterProduct = 'general' | 'bio_night' | 'rocket_launch';
type LocationValue = 'Port Orange' | 'Titusville';
type PaymentStatus = 'pending' | 'deposit_paid' | 'paid';
type PaymentMethod = '' | 'stripe' | 'cash' | 'venmo' | 'zelle' | 'paypal' | 'groupon' | 'comp' | 'other';

type BoatRow = {
  id: string;
  name: string;
  type: string | null;
  hourly_rate: number | string | null;
  half_day_rate: number | string | null;
  full_day_rate: number | string | null;
};

type AvailabilityConflict = {
  customer_name: string;
  boat_name: string;
  start_time: string;
  end_time: string;
  status: string;
} | null;

type CharterCapacityInfo = {
  max: number;
  used: number;
  remaining: number;
  requested: number;
};

type AvailabilityState =
  | { status: 'idle'; message: string; conflict?: null; capacity?: null }
  | { status: 'checking'; message: string; conflict?: null; capacity?: null }
  | { status: 'available'; message: string; conflict?: null; capacity?: CharterCapacityInfo | null }
  | { status: 'unavailable'; message: string; conflict: AvailabilityConflict; capacity?: CharterCapacityInfo | null }
  | { status: 'error'; message: string; conflict?: null; capacity?: null };

function charterCapacityLabel(capacity: CharterCapacityInfo | null | undefined, available: boolean): string {
  if (!capacity) {
    return available ? 'Available' : 'Unavailable';
  }
  const remaining = Math.max(0, Math.floor(Number(capacity.remaining) || 0));
  if (!available) {
    if (remaining <= 0) return 'Full — 0 spots remaining';
    return `Only ${remaining} spot${remaining === 1 ? '' : 's'} remaining for this time`;
  }
  if (remaining === 0) return 'Available — this fills the charter';
  if (remaining === 1) return 'Only 1 spot remaining';
  return `Available — ${remaining} spot${remaining === 1 ? '' : 's'} remaining`;
}

type StaffBookingRow = {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  payment_status: string | null;
  booking_source: string | null;
  rental_location: string | null;
  customers?: { full_name?: string | null; phone?: string | null; email?: string | null } | null;
  boats?: { name?: string | null } | null;
};

/** Default captain-led charter vessel — SunCatcher pontoon (FL0278PU). */
function staffCharterApiFields(form: ReturnType<typeof blankForm>) {
  if (form.bookingType !== 'captain_charter') return {};
  if (form.charterProduct === 'bio_night' && form.bioPackageId) {
    return { charter_type: 'bio' as const, pricing_package_id: form.bioPackageId };
  }
  if (form.charterProduct === 'rocket_launch' && form.rocketPackageId) {
    return { charter_type: 'rocket' as const, pricing_package_id: form.rocketPackageId };
  }
  return {};
}

function pickDefaultCharterBoatId(boats: BoatRow[]): string {
  const name = (boat: BoatRow) => String(boat.name || '').toLowerCase();
  const suncatcher = boats.find(
    (boat) => name(boat).includes('suncatcher') || name(boat).includes('sun catcher')
  );
  if (suncatcher?.id) return suncatcher.id;
  const pontoon = boats.find((boat) => boat.type === 'standard');
  if (pontoon?.id) return pontoon.id;
  return boats[0]?.id || '';
}

const todayYmd = () => new Date().toISOString().slice(0, 10);

const blankForm = () => {
  const duration = durationFieldsForNewBookingType('rental');
  return {
    customerName: '',
    phone: '',
    email: '',
    bookingType: 'rental' as BookingType,
    charterProduct: 'general' as CharterProduct,
    bioPackageId: '' as '' | BioPackageId,
    rocketPackageId: '' as '' | RocketPackageId,
    launchId: '',
    location: 'Port Orange' as LocationValue,
    boatId: '',
    date: todayYmd(),
    startTime: '',
    durationPreset: duration.durationPreset,
    customDuration: duration.customDuration,
    passengerCount: '1',
    originalPrice: '0.00',
    discount: '0.00',
    finalPrice: '0.00',
    paymentStatus: 'pending' as PaymentStatus,
    paymentMethod: '' as PaymentMethod,
    bookingSource: 'admin',
    staffNotes: '',
    compReason: '',
    captainId: '',
    emergencyContactNotes: '',
  };
};

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function money(value: number): string {
  return (Number.isFinite(value) ? value : 0).toFixed(2);
}

function staffHHMMFromIso(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

function timeLabel(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  if (!Number.isFinite(s.getTime())) return '-';
  const startLabel = s.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const endLabel = Number.isFinite(e.getTime())
    ? e.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';
  return endLabel ? `${startLabel} - ${endLabel}` : startLabel;
}

type ScheduleSnapshot = {
  date: string;
  startTime: string;
  durationPreset: StaffDurationPreset;
  customDuration: string;
  location: LocationValue;
  bookingType: BookingType;
};

export default function AdminStaffBooking() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [form, setForm] = useState(blankForm);
  const [boats, setBoats] = useState<BoatRow[]>([]);
  const [boatsLoading, setBoatsLoading] = useState(true);
  const [captains, setCaptains] = useState<AdminCaptainListItem[]>([]);
  const [availability, setAvailability] = useState<AvailabilityState>({
    status: 'idle',
    message: 'Select a boat, date, time, and duration.',
  });
  const [saving, setSaving] = useState<'hold' | 'booking' | null>(null);
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [todayRows, setTodayRows] = useState<StaffBookingRow[]>([]);
  const [todayLoading, setTodayLoading] = useState(false);
  const [createSuccess, setCreateSuccess] = useState<{ id: string; kind: 'hold' | 'booking' } | null>(null);
  const [postCreateBusy, setPostCreateBusy] = useState<string | null>(null);
  const [rocketLaunchOptions, setRocketLaunchOptions] = useState<
    Array<{
      id: string;
      name: string;
      calendarDate: string | null;
      launchTimeLabel: string | null;
      departureTimeLabel: string | null;
      departureStartIso: string | null;
      launchDateLabel?: string | null;
    }>
  >([]);
  const [rocketLaunchesLoading, setRocketLaunchesLoading] = useState(false);
  const availabilityCheckSeq = useRef(0);
  const lastSavedScheduleRef = useRef<ScheduleSnapshot | null>(null);
  const idempotencyKeyByActionRef = useRef<Partial<Record<'hold' | 'booking', string>>>({});

  const selectedBoat = boats.find((boat) => boat.id === form.boatId) || null;
  const durationHours = useMemo(
    () => durationHoursFromStaffForm(form.durationPreset, form.customDuration),
    [form.customDuration, form.durationPreset]
  );

  const captainWindowPreview = useMemo(() => {
    if (
      form.bookingType !== 'captain_charter' ||
      (form.charterProduct === 'rocket_launch' && form.launchId) ||
      !form.date ||
      !form.startTime ||
      durationHours <= 0
    ) {
      return null;
    }
    return previewCaptainCharterWindow(form.date, form.startTime, durationHours);
  }, [durationHours, form.bookingType, form.charterProduct, form.date, form.launchId, form.startTime]);

  const staffBioPackageSummary = useMemo(() => {
    if (form.charterProduct !== 'bio_night' || !form.bioPackageId) return null;
    return getBioPackageDisplay(form.bioPackageId);
  }, [form.bioPackageId, form.charterProduct]);

  const getAdminToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }, []);

  useEffect(() => {
    const boatId = searchParams.get('boatId') || searchParams.get('boat_id') || '';
    const date = searchParams.get('date') || '';
    const startTime = searchParams.get('startTime') || searchParams.get('time') || '';
    const location = searchParams.get('location') || '';
    const duration = searchParams.get('durationHours') || '';
    const customerName = searchParams.get('customerName') || '';
    const phone = searchParams.get('phone') || '';
    const email = searchParams.get('email') || '';
    const bookingType = searchParams.get('bookingType') || '';
    const passengerCount = searchParams.get('passengerCount') || '';
    const bookingSource = searchParams.get('bookingSource') || '';
    const paymentMethod = searchParams.get('paymentMethod') || '';
    const preTripSubmissionId = searchParams.get('preTripSubmissionId') || '';
    if (
      !boatId &&
      !date &&
      !startTime &&
      !location &&
      !duration &&
      !customerName &&
      !phone &&
      !email &&
      !bookingType &&
      !passengerCount &&
      !bookingSource &&
      !paymentMethod &&
      !preTripSubmissionId
    ) {
      return;
    }
    setForm((prev) => {
      const nextBookingType =
        bookingType === 'captain_charter'
          ? 'captain_charter'
          : bookingType === 'rental'
            ? 'rental'
            : prev.bookingType;
      let durationPreset = prev.durationPreset;
      let customDuration = prev.customDuration;
      if (duration) {
        const fromUrl = staffDurationFieldsFromHours(duration);
        durationPreset = fromUrl.durationPreset;
        customDuration = fromUrl.customDuration;
      } else if (bookingType === 'captain_charter') {
        const charterDefault = durationFieldsForNewBookingType('captain_charter');
        durationPreset = charterDefault.durationPreset;
        customDuration = charterDefault.customDuration;
      }
      return {
        ...prev,
        boatId: boatId || prev.boatId,
        date: date || prev.date,
        startTime: startTime || prev.startTime,
        location: location === 'Titusville' || location === 'Port Orange' ? (location as LocationValue) : prev.location,
        durationPreset,
        customDuration,
        customerName: customerName || prev.customerName,
        phone: phone || prev.phone,
        email: email || prev.email,
        bookingType: nextBookingType,
        passengerCount: passengerCount || prev.passengerCount,
        bookingSource: bookingSource || prev.bookingSource,
        paymentMethod:
          paymentMethod === 'groupon' ||
          paymentMethod === 'cash' ||
          paymentMethod === 'venmo' ||
          paymentMethod === 'zelle' ||
          paymentMethod === 'paypal' ||
          paymentMethod === 'stripe' ||
          paymentMethod === 'comp' ||
          paymentMethod === 'other'
            ? (paymentMethod as PaymentMethod)
            : prev.paymentMethod,
        staffNotes: preTripSubmissionId
          ? `Created from pre-trip submission ${preTripSubmissionId}. Return to /admin/pre-trip/${preTripSubmissionId} after saving to approve the waiver.`
          : prev.staffNotes,
      };
    });
  }, [searchParams]);

  useEffect(() => {
    if (form.charterProduct !== 'rocket_launch' || !env.apiUrlConfigured || !env.apiUrl) {
      setRocketLaunchOptions([]);
      return;
    }
    const ac = new AbortController();
    setRocketLaunchesLoading(true);
    fetch(`${env.apiUrl}/api/availability/rocket/launches`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('rocket launches'))))
      .then((data: { launches?: typeof rocketLaunchOptions }) => {
        const rows = Array.isArray(data.launches) ? data.launches : [];
        setRocketLaunchOptions(rows.filter((row) => row.id && row.departureStartIso));
      })
      .catch(() => {
        if (!ac.signal.aborted) setRocketLaunchOptions([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setRocketLaunchesLoading(false);
      });
    return () => ac.abort();
  }, [form.charterProduct, env.apiUrl, env.apiUrlConfigured]);

  const authedFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      if (!env.apiUrlConfigured || !env.apiUrl) throw new Error('API URL is not configured.');
      const token = await getAdminToken();
      if (!token) throw new Error('Admin session expired. Sign in again.');
      return fetch(`${env.apiUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.headers || {}),
        },
      });
    },
    [getAdminToken]
  );

  const loadToday = useCallback(async () => {
    if (!isAdmin) return;
    setTodayLoading(true);
    try {
      const res = await authedFetch('/api/admin/staff-bookings/today');
      const payload = (await res.json().catch(() => ({}))) as {
        bookings?: StaffBookingRow[];
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error || 'Could not load staff bookings.');
      setTodayRows(Array.isArray(payload.bookings) ? payload.bookings : []);
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not load staff bookings.' });
    } finally {
      setTodayLoading(false);
    }
  }, [authedFetch, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    void fetchActiveCaptains()
      .then(setCaptains)
      .catch(() => setCaptains([]));
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setBoatsLoading(true);
    fetch(`${env.apiUrl}/api/boats`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Could not load boats.'))))
      .then((payload: { boats?: BoatRow[] }) => {
        if (cancelled) return;
        const rows = Array.isArray(payload.boats) ? payload.boats : [];
        setBoats(rows);
        setForm((prev) => {
          if (prev.boatId || prev.bookingType !== 'captain_charter') return prev;
          const defaultBoatId = pickDefaultCharterBoatId(rows);
          return defaultBoatId ? { ...prev, boatId: defaultBoatId } : prev;
        });
      })
      .catch((err) => {
        if (!cancelled) setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not load boats.' });
      })
      .finally(() => {
        if (!cancelled) setBoatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  const selectedRocketPackage = useMemo(() => {
    if (form.charterProduct !== 'rocket_launch' || !form.rocketPackageId) return null;
    return getRocketPackageDisplay(form.rocketPackageId);
  }, [form.charterProduct, form.rocketPackageId]);

  useEffect(() => {
    if (
      form.bookingType === 'captain_charter' &&
      form.charterProduct === 'bio_night' &&
      form.bioPackageId &&
      isDirectBioPackagePricingEnabled()
    ) {
      const pkg = getBioPackageDisplay(form.bioPackageId);
      if (!pkg) return;
      setForm((prev) => ({
        ...prev,
        passengerCount: String(pkg.guestCount),
        originalPrice: money(pkg.standardValueUsd),
        discount: money(pkg.savingsUsd),
        finalPrice: money(pkg.directPriceUsd),
      }));
      return;
    }
    if (
      form.bookingType === 'captain_charter' &&
      form.charterProduct === 'rocket_launch' &&
      form.rocketPackageId &&
      isDirectRocketPackagePricingEnabled()
    ) {
      const pkg = getRocketPackageDisplay(form.rocketPackageId);
      if (!pkg) return;
      setForm((prev) => ({
        ...prev,
        passengerCount:
          pkg.id === 'rocket_private' ? prev.passengerCount : String(pkg.guestCount),
        originalPrice: money(pkg.directPriceUsd),
        discount: '0.00',
        finalPrice: money(pkg.directPriceUsd),
      }));
      return;
    }
    if (!selectedBoat || durationHours <= 0) return;
    const base = computeStaffBookingOriginalPrice(selectedBoat, durationHours, form.bookingType);
    const discount = Number(form.discount) || 0;
    setForm((prev) => ({
      ...prev,
      originalPrice: money(base),
      finalPrice: money(Math.max(0, base - discount)),
    }));
  }, [
    durationHours,
    form.bookingType,
    form.bioPackageId,
    form.rocketPackageId,
    form.charterProduct,
    form.discount,
    selectedBoat,
  ]);

  useEffect(() => {
    const seq = ++availabilityCheckSeq.current;

    if (!form.boatId) {
      setAvailability({ status: 'idle', message: 'Select a boat first.' });
      return;
    }
    if (!form.date || !form.startTime || durationHours <= 0) {
      setAvailability({ status: 'idle', message: 'Select a date, time, and duration.' });
      return;
    }

    setAvailability({ status: 'checking', message: 'Checking availability...' });

    const timer = window.setTimeout(async () => {
      if (seq !== availabilityCheckSeq.current) return;

      try {
        const res = await authedFetch('/api/admin/staff-bookings/check', {
          method: 'POST',
          body: JSON.stringify({
            boat_id: form.boatId,
            booking_type: form.bookingType,
            date: form.date,
            startTime: form.startTime,
            durationHours,
            rental_location: form.location,
            passenger_count:
              form.bookingType === 'captain_charter' ? Math.floor(Number(form.passengerCount) || 1) : 1,
            ...staffCharterApiFields(form),
            launchId: form.charterProduct === 'rocket_launch' ? form.launchId || null : null,
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          available?: boolean;
          conflict?: AvailabilityConflict;
          message?: string | null;
          reason?: string | null;
          capacity?: CharterCapacityInfo | null;
          error?: string;
        };
        if (seq !== availabilityCheckSeq.current) return;
        if (!res.ok) throw new Error(payload.error || payload.message || 'Could not check availability.');
        if (!payload.available) {
          const charterMsg =
            payload.message ||
            (payload.reason === 'captain_window' ? payload.error : null) ||
            charterCapacityLabel(payload.capacity, false);
          if (payload.reason === 'captain_window') {
            setAvailability({ status: 'error', message: charterMsg || 'Invalid charter time.' });
            return;
          }
          setAvailability({
            status: 'unavailable',
            message: charterMsg,
            conflict: payload.conflict || null,
            capacity: payload.capacity || null,
          });
          return;
        }
        setAvailability({
          status: 'available',
          message: charterCapacityLabel(payload.capacity, true),
          capacity: payload.capacity || null,
        });
      } catch (err) {
        if (seq !== availabilityCheckSeq.current) return;
        setAvailability({
          status: 'error',
          message: err instanceof Error ? err.message : 'Could not check availability.',
        });
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [
    authedFetch,
    durationHours,
    form.boatId,
    form.bookingType,
    form.date,
    form.location,
    form.passengerCount,
    form.startTime,
    form.charterProduct,
    form.bioPackageId,
    form.rocketPackageId,
  ]);

  const submitGate = useMemo(() => {
    const blockers: string[] = [];

    if (saving) {
      blockers.push(
        saving === 'hold'
          ? 'Save Hold is disabled while the previous hold request is still in progress.'
          : 'Create Booking is disabled while the previous booking request is still in progress.'
      );
    }
    if (!form.customerName.trim()) blockers.push('Customer name is required.');
    if (!form.phone.trim()) blockers.push('Phone is required.');
    if (!form.boatId) blockers.push('Select a boat.');
    if (!form.date) blockers.push('Select a date.');
    if (!form.startTime) blockers.push('Select a start time.');
    if (durationHours <= 0) blockers.push('Enter a valid duration.');
    if (form.bookingType === 'captain_charter') {
      const validation = validateCharterPassengerCount(form.passengerCount);
      if (!validation.valid) blockers.push(validation.error);
      if (
        form.charterProduct === 'bio_night' &&
        isDirectBioPackagePricingEnabled() &&
        !form.bioPackageId
      ) {
        blockers.push('Select a bioluminescence package.');
      }
      if (
        form.charterProduct === 'rocket_launch' &&
        isDirectRocketPackagePricingEnabled() &&
        !form.rocketPackageId
      ) {
        blockers.push('Select a rocket launch package.');
      }
      if (form.charterProduct === 'rocket_launch' && !form.launchId.trim()) {
        blockers.push('Select a scheduled rocket launch.');
      }
      if (
        form.charterProduct === 'bio_night' &&
        form.paymentMethod === 'groupon'
      ) {
        blockers.push('Groupon vouchers must be redeemed through the Groupon booking workflow, not direct bio packages.');
      }
      if (
        form.charterProduct === 'rocket_launch' &&
        form.paymentMethod === 'groupon'
      ) {
        blockers.push('Groupon vouchers must be redeemed through the Groupon booking workflow, not direct rocket packages.');
      }
      if (form.paymentMethod === 'comp' && !form.compReason.trim()) {
        blockers.push('Comp reason is required for complimentary bookings.');
      }
      if (captainWindowPreview && !captainWindowPreview.valid) {
        blockers.push(captainWindowPreview.message || CAPTAIN_NIGHT_SCHEDULE_NOTE);
      }
    }
    if (availability.status === 'checking') {
      blockers.push('Waiting for availability check to finish.');
    } else if (availability.status === 'idle' && form.boatId && form.date && form.startTime && durationHours > 0) {
      blockers.push('Availability has not been checked yet for this slot.');
    } else if (availability.status === 'unavailable') {
      blockers.push(
        availability.message ||
          (form.bookingType === 'captain_charter'
            ? 'This charter is full or unavailable for the selected passengers and time.'
            : 'This boat is already booked for that time.')
      );
    } else if (availability.status === 'error') {
      blockers.push(availability.message || 'Availability check failed. Change the schedule or try again.');
    } else if (availability.status !== 'available') {
      blockers.push('Confirm boat, date, time, and duration to check availability.');
    }

    return {
      canSubmit: blockers.length === 0,
      primaryReason: blockers[0] || null,
      blockers,
    };
  }, [
    availability.message,
    availability.status,
    durationHours,
    form.boatId,
    form.bookingType,
    form.bioPackageId,
    form.rocketPackageId,
    form.charterProduct,
    form.customerName,
    form.date,
    form.passengerCount,
    form.compReason,
    form.paymentMethod,
    form.phone,
    form.startTime,
    captainWindowPreview,
    saving,
  ]);

  const clearStaffBookingUrl = useCallback(() => {
    navigate('/admin/staff-booking', { replace: true });
  }, [navigate]);

  const resetAvailability = useCallback(() => {
    availabilityCheckSeq.current += 1;
    setAvailability({ status: 'idle', message: 'Select a boat first.' });
  }, []);

  const startSameTimeDifferentBoat = useCallback(() => {
    const snap = lastSavedScheduleRef.current;
    setCreateSuccess(null);
    setNotice(null);
    clearStaffBookingUrl();
    availabilityCheckSeq.current += 1;
    idempotencyKeyByActionRef.current = {};
    setForm({
      ...blankForm(),
      date: snap?.date || todayYmd(),
      startTime: snap?.startTime || '',
      durationPreset: snap?.durationPreset || durationFieldsForNewBookingType('rental').durationPreset,
      customDuration: snap?.customDuration || '',
      location: snap?.location || 'Port Orange',
      bookingType: snap?.bookingType || 'rental',
      boatId: '',
    });
    setAvailability({
      status: 'idle',
      message: 'Select a different boat — multiple boats can run at the same time.',
    });
  }, [clearStaffBookingUrl]);

  const reset = (clearNotice = true) => {
    availabilityCheckSeq.current += 1;
    idempotencyKeyByActionRef.current = {};
    setForm(blankForm());
    setAvailability({ status: 'idle', message: 'Select a boat first.' });
    setSaving(null);
    if (clearNotice) setNotice(null);
  };

  const save = async (action: 'hold' | 'booking') => {
    setNotice(null);
    if (!submitGate.canSubmit) {
      setNotice({
        variant: 'error',
        text: submitGate.primaryReason || 'Complete the required fields before saving.',
      });
      return;
    }

    setSaving(action);
    try {
      if (!idempotencyKeyByActionRef.current[action]) {
        idempotencyKeyByActionRef.current[action] = crypto.randomUUID();
      }
      const idempotencyKey = idempotencyKeyByActionRef.current[action];
      const res = await authedFetch('/api/admin/staff-bookings', {
        method: 'POST',
        body: JSON.stringify({
          action,
          idempotency_key: idempotencyKey,
          customer_name: form.customerName,
          phone: form.phone,
          email: form.email,
          booking_type: form.bookingType,
          rental_location: form.location,
          boat_id: form.boatId,
          date: form.date,
          startTime: form.startTime,
          durationHours,
          passenger_count: form.bookingType === 'captain_charter' ? form.passengerCount : 1,
          ...staffCharterApiFields(form),
          launchId: form.charterProduct === 'rocket_launch' ? form.launchId || null : null,
          original_price: form.originalPrice,
          discount: form.discount,
          final_price: form.finalPrice,
          payment_status: form.paymentStatus,
          payment_method: form.paymentMethod || null,
          booking_source: form.bookingSource,
          comp_reason: form.paymentMethod === 'comp' ? form.compReason.trim() : undefined,
          staff_notes: form.staffNotes,
          captain_id: form.bookingType === 'captain_charter' && form.captainId ? form.captainId : null,
          emergency_contact_notes:
            form.bookingType === 'captain_charter' ? form.emergencyContactNotes : null,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        booking?: { id?: string };
        duplicate?: boolean;
        error?: string;
        availability?: { conflict?: AvailabilityConflict };
      };
      if (!res.ok) {
        if (res.status === 409 && payload.availability?.conflict) {
          setAvailability({
            status: 'unavailable',
            message: 'Already Booked',
            conflict: payload.availability.conflict,
          });
        }
        throw new Error(payload.error || 'Could not save booking.');
      }
      delete idempotencyKeyByActionRef.current[action];
      lastSavedScheduleRef.current = {
        date: form.date,
        startTime: form.startTime,
        durationPreset: form.durationPreset,
        customDuration: form.customDuration,
        location: form.location,
        bookingType: form.bookingType,
      };
      setNotice({
        variant: 'success',
        text:
          payload.duplicate
            ? action === 'hold'
              ? 'Hold already saved (duplicate request ignored).'
              : 'Staff booking already created (duplicate request ignored).'
            : action === 'hold'
              ? 'Hold saved and availability blocked.'
              : 'Staff booking created.',
      });
      clearStaffBookingUrl();
      resetAvailability();
      setForm(blankForm());
      setSaving(null);
      await loadToday();
      if (payload.booking?.id) {
        setCreateSuccess({ id: payload.booking.id, kind: action });
      }
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not save booking.' });
    } finally {
      setSaving(null);
    }
  };

  const sendCreatedConfirmation = async () => {
    if (!createSuccess?.id) return;
    setPostCreateBusy('confirmation');
    try {
      const res = await authedFetch(`/api/admin/bookings/${createSuccess.id}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action: 'send_confirmation' }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || 'Could not send confirmation.');
      setNotice({ variant: 'success', text: 'Confirmation email sent.' });
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not send confirmation.' });
    } finally {
      setPostCreateBusy(null);
    }
  };

  if (authLoading) return <FullPageLoader message="Checking admin access..." />;

  if (!isAdmin) {
    return (
      <AdminAccessDenied
        signedIn={Boolean(user)}
        message={
          user
            ? 'This account is not authorized to create staff bookings.'
            : 'Sign in with an admin account.'
        }
      />
    );
  }

  const inputClass =
    'mt-1 min-h-[52px] w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200';
  const labelClass = 'block text-sm font-bold text-slate-700';

  return (
    <AdminShell title="Staff Booking" subtitle="Fast internal phone bookings and holds">
        {createSuccess ? (
          <div className="mb-6 rounded-2xl border-2 border-green-300 bg-green-50 p-6 shadow-sm">
            <h2 className="text-2xl font-black text-green-950">
              {createSuccess.kind === 'hold' ? 'Hold Created Successfully' : 'Booking Created Successfully'}
            </h2>
            <p className="mt-2 text-lg text-green-900">What would you like to do next?</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Link
                to={`/admin/bookings/${createSuccess.id}`}
                className="inline-flex min-h-14 items-center justify-center rounded-xl bg-slate-900 px-5 text-lg font-black text-white"
              >
                View Booking
              </Link>
              <Link
                to={`/admin/bookings/${createSuccess.id}/edit`}
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-amber-600 px-5 text-lg font-black text-white"
              >
                <Pencil className="h-5 w-5" aria-hidden />
                Edit Booking
              </Link>
              <button
                type="button"
                disabled={postCreateBusy != null}
                onClick={() => void sendCreatedConfirmation()}
                className="inline-flex min-h-14 items-center justify-center rounded-xl bg-cyan-700 px-5 text-lg font-black text-white disabled:opacity-50"
              >
                {postCreateBusy === 'confirmation' ? 'Sending…' : 'Send Confirmation'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreateSuccess(null);
                  setNotice(null);
                  clearStaffBookingUrl();
                  setForm(blankForm());
                  resetAvailability();
                }}
                className="inline-flex min-h-14 items-center justify-center rounded-xl border-2 border-green-700 bg-white px-5 text-lg font-black text-green-950"
              >
                Create Another Booking
              </button>
              <button
                type="button"
                onClick={startSameTimeDifferentBoat}
                className="sm:col-span-2 inline-flex min-h-14 items-center justify-center rounded-xl bg-green-800 px-5 text-lg font-black text-white"
              >
                Same time · different boat
              </button>
            </div>
            <p className="mt-4 text-base text-green-900">
              Each boat is booked separately. To run two trips at once, pick another boat — not the same one twice.
            </p>
          </div>
        ) : null}

        {notice && !createSuccess ? (
          <div
            className={`mb-6 rounded-xl px-4 py-3 text-sm font-semibold ${
              notice.variant === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}
            role="status"
          >
            {notice.text}
          </div>
        ) : null}

        {notice && createSuccess ? (
          <div
            className={`mb-6 rounded-xl px-4 py-3 text-sm font-semibold ${
              notice.variant === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}
            role="status"
          >
            {notice.text}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.9fr)]">
          <section className="order-2 rounded-2xl bg-white p-5 shadow lg:order-1">
            <div className="mb-5 flex items-center gap-2">
              <CalendarPlus className="h-6 w-6 text-amber-600" />
              <h2 className="text-2xl font-bold">New Booking</h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className={labelClass}>
                Customer Name *
                <input className={inputClass} value={form.customerName} onChange={(e) => setForm((p) => ({ ...p, customerName: e.target.value }))} autoFocus />
              </label>
              <label className={labelClass}>
                Phone *
                <input className={inputClass} inputMode="tel" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: formatPhone(e.target.value) }))} />
              </label>
              <label className={labelClass}>
                Email
                <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
              </label>
              <label className={labelClass}>
                Booking Type
                <select
                  className={inputClass}
                  value={form.bookingType}
                  onChange={(e) => {
                    const nextType = e.target.value as BookingType;
                    setForm((p) => ({
                      ...p,
                      bookingType: nextType,
                      boatId:
                        nextType === 'captain_charter'
                          ? pickDefaultCharterBoatId(boats) || p.boatId
                          : p.boatId,
                      charterProduct: nextType === 'rental' ? 'general' : p.charterProduct,
                      bioPackageId: nextType === 'rental' ? '' : p.bioPackageId,
                      rocketPackageId: nextType === 'rental' ? '' : p.rocketPackageId,
                      captainId: nextType === 'rental' ? '' : p.captainId,
                      ...durationFieldsForNewBookingType(nextType),
                    }));
                  }}
                >
                  <option value="rental">Rental</option>
                  <option value="captain_charter">Captain Charter</option>
                </select>
                {form.bookingType === 'captain_charter' ? (
                  <span className="mt-2 block text-sm font-normal leading-relaxed text-slate-600">
                    {CAPTAIN_NIGHT_SCHEDULE_NOTE}
                  </span>
                ) : null}
              </label>
              {form.bookingType === 'captain_charter' ? (
                <label className={labelClass}>
                  Charter experience
                  <select
                    className={inputClass}
                    value={form.charterProduct}
                    onChange={(e) => {
                      const next = e.target.value as CharterProduct;
                      setForm((p) => ({
                        ...p,
                        charterProduct: next,
                        bioPackageId: next === 'bio_night' ? p.bioPackageId : '',
                        rocketPackageId: next === 'rocket_launch' ? p.rocketPackageId : '',
                        passengerCount:
                          next === 'bio_night' || next === 'rocket_launch' ? p.passengerCount : '1',
                        location: next === 'rocket_launch' ? 'Titusville' : p.location,
                      }));
                    }}
                  >
                    <option value="general">General captain charter</option>
                    {isDirectBioPackagePricingEnabled() ? (
                      <option value="bio_night">Bioluminescence night tour</option>
                    ) : null}
                    {isDirectRocketPackagePricingEnabled() ? (
                      <option value="rocket_launch">Rocket launch viewing</option>
                    ) : null}
                  </select>
                </label>
              ) : null}
              {form.bookingType === 'captain_charter' &&
              form.charterProduct === 'rocket_launch' &&
              isDirectRocketPackagePricingEnabled() ? (
                <label className={labelClass}>
                  Rocket launch package *
                  <select
                    className={inputClass}
                    value={form.rocketPackageId}
                    onChange={(e) => {
                      const id = e.target.value as RocketPackageId | '';
                      setForm((p) => ({ ...p, rocketPackageId: id }));
                    }}
                  >
                    <option value="">Select package</option>
                    {ROCKET_STAFF_PACKAGE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Solo $100 · Duo $190 · Private $450 — shared packages lock guest count.
                  </span>
                  {selectedRocketPackage?.seating === 'shared' ? (
                    <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950">
                      Shared rocket departures need at least {ROCKET_LAUNCH_MIN_GUESTS} total booked guests before
                      the trip is fully confirmed. Customers receive a reservation email until the minimum is reached.
                    </p>
                  ) : null}
                </label>
              ) : null}
              {form.bookingType === 'captain_charter' && form.charterProduct === 'rocket_launch' ? (
                <label className={labelClass}>
                  Scheduled launch *
                  <select
                    className={inputClass}
                    value={form.launchId}
                    onChange={(e) => {
                      const id = e.target.value;
                      const launch = rocketLaunchOptions.find((row) => row.id === id);
                      setForm((p) => ({
                        ...p,
                        launchId: id,
                        date: launch?.calendarDate || p.date,
                        startTime: launch?.departureStartIso
                          ? staffHHMMFromIso(launch.departureStartIso)
                          : p.startTime,
                        durationPreset: 'custom',
                        customDuration: '1',
                      }));
                    }}
                  >
                    <option value="">
                      {rocketLaunchesLoading ? 'Loading launches…' : 'Select launch'}
                    </option>
                    {rocketLaunchOptions.map((launch) => (
                      <option key={launch.id} value={launch.id}>
                        {launch.name} · {launch.launchDateLabel || launch.calendarDate || 'TBD'} · launch{' '}
                        {launch.launchTimeLabel || 'TBD'} · depart {launch.departureTimeLabel || 'TBD'}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Staff rocket bookings use the launch schedule — not the bio 8 PM–4 AM window.
                  </span>
                </label>
              ) : null}
              {form.bookingType === 'captain_charter' &&
              form.charterProduct === 'bio_night' &&
              isDirectBioPackagePricingEnabled() ? (
                <label className={labelClass}>
                  Bioluminescence package *
                  <select
                    className={inputClass}
                    value={form.bioPackageId}
                    onChange={(e) => {
                      const id = e.target.value as BioPackageId | '';
                      setForm((p) => ({ ...p, bioPackageId: id }));
                    }}
                  >
                    <option value="">Select package</option>
                    {BIO_STAFF_PACKAGE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Solo $58.50 · Two $120 · Four $240 — guest count is set by the package.
                  </span>
                  <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950">
                    Direct packages cover 1, 2, or 4 guests only. For five guests, use a general captain charter with
                    manual pricing or contact ops — do not combine package prices.
                  </p>
                </label>
              ) : null}
              {form.bookingType === 'captain_charter' &&
              captainWindowPreview &&
              !captainWindowPreview.valid &&
              form.date &&
              form.startTime &&
              durationHours > 0 ? (
                <p className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-base font-semibold text-amber-950">
                  {captainWindowPreview.message}
                </p>
              ) : null}
              <label className={labelClass}>
                Location
                <select className={inputClass} value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value as LocationValue }))}>
                  <option value="Port Orange">Port Orange</option>
                  <option value="Titusville">Titusville</option>
                </select>
              </label>
              <label className={labelClass}>
                Boat
                <select
                  className={inputClass}
                  value={form.boatId}
                  onChange={(e) => {
                    availabilityCheckSeq.current += 1;
                    const nextBoatId = e.target.value;
                    setForm((p) => ({ ...p, boatId: nextBoatId }));
                    if (nextBoatId && form.date && form.startTime && durationHours > 0) {
                      setAvailability({ status: 'checking', message: 'Checking availability...' });
                    } else if (!nextBoatId) {
                      setAvailability({ status: 'idle', message: 'Select a boat first.' });
                    }
                  }}
                  disabled={boatsLoading}
                >
                  <option value="">{boatsLoading ? 'Loading boats...' : 'Select boat'}</option>
                  {boats.map((boat) => (
                    <option key={boat.id} value={boat.id}>
                      {boat.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Date
                <input className={inputClass} type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} />
              </label>
              <label className={labelClass}>
                Start Time
                <input className={inputClass} type="time" value={form.startTime} onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))} />
              </label>
              <label className={labelClass}>
                Duration
                <select
                  className={inputClass}
                  value={form.durationPreset}
                  onChange={(e) => {
                    const nextPreset = e.target.value as StaffDurationPreset;
                    setForm((p) => ({
                      ...p,
                      ...applyStaffDurationPresetChange(nextPreset, p.customDuration),
                    }));
                  }}
                >
                  <option value="1">1 hr</option>
                  <option value="2">2 hr</option>
                  <option value="4">4 hr</option>
                  <option value="6">6 hr</option>
                  <option value="8">8 hr</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {form.durationPreset === 'custom' ? (
                <label className={labelClass}>
                  Custom Hours
                  <input className={inputClass} type="number" min="0.5" step="0.5" value={form.customDuration} onChange={(e) => setForm((p) => ({ ...p, customDuration: e.target.value }))} />
                </label>
              ) : null}
              {form.bookingType === 'captain_charter' ? (
                form.charterProduct === 'bio_night' && isDirectBioPackagePricingEnabled() ? (
                  <label className={labelClass}>
                    Passengers
                    <input
                      className={`${inputClass} bg-slate-100`}
                      type="number"
                      readOnly
                      value={form.passengerCount}
                      aria-readonly
                    />
                    <span className="mt-1 block text-xs font-normal text-slate-500">
                      Locked to the selected bioluminescence package.
                    </span>
                  </label>
                ) : form.charterProduct === 'rocket_launch' &&
                  isDirectRocketPackagePricingEnabled() &&
                  selectedRocketPackage &&
                  selectedRocketPackage.id !== 'rocket_private' ? (
                  <label className={labelClass}>
                    Passengers
                    <input
                      className={`${inputClass} bg-slate-100`}
                      type="number"
                      readOnly
                      value={form.passengerCount}
                      aria-readonly
                    />
                    <span className="mt-1 block text-xs font-normal text-slate-500">
                      Locked to the selected rocket launch package.
                    </span>
                  </label>
                ) : (
                <label className={labelClass}>
                  Passengers
                  <input
                    className={inputClass}
                    type="number"
                    min="1"
                    max={CHARTER_MAX_PASSENGERS}
                    step="1"
                    value={form.passengerCount}
                    onChange={(e) => setForm((p) => ({ ...p, passengerCount: e.target.value }))}
                  />
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    {form.charterProduct === 'rocket_launch' &&
                    selectedRocketPackage?.id === 'rocket_private'
                      ? `1–${CHARTER_MAX_PASSENGERS} guests on private rocket charter (flat package price).`
                      : `1–${CHARTER_MAX_PASSENGERS} passengers (plus captain).`}
                  </span>
                </label>
                )
              ) : null}
              {form.bookingType === 'captain_charter' ? (
                <>
                  <label className={labelClass}>
                    Assigned captain
                    <select
                      className={inputClass}
                      value={form.captainId}
                      onChange={(e) => setForm((p) => ({ ...p, captainId: e.target.value }))}
                    >
                      <option value="">Unassigned</option>
                      {captains.map((captain) => (
                        <option key={captain.id} value={captain.id}>
                          {captain.full_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={`${labelClass} sm:col-span-2`}>
                    Emergency contact notes
                    <textarea
                      className={`${inputClass} min-h-[90px]`}
                      placeholder="Dedicated emergency contact — not the customer phone"
                      value={form.emergencyContactNotes}
                      onChange={(e) => setForm((p) => ({ ...p, emergencyContactNotes: e.target.value }))}
                    />
                  </label>
                </>
              ) : null}
              <label className={labelClass}>
                Original Price
                <input className={inputClass} type="number" min="0" step="0.01" value={form.originalPrice} onChange={(e) => setForm((p) => ({ ...p, originalPrice: e.target.value, finalPrice: money(Math.max(0, Number(e.target.value || 0) - Number(p.discount || 0))) }))} />
              </label>
              <label className={labelClass}>
                Discount
                <input className={inputClass} type="number" min="0" step="0.01" value={form.discount} onChange={(e) => setForm((p) => ({ ...p, discount: e.target.value, finalPrice: money(Math.max(0, Number(p.originalPrice || 0) - Number(e.target.value || 0))) }))} />
              </label>
              <label className={labelClass}>
                Final Price
                <input className={inputClass} type="number" min="0" step="0.01" value={form.finalPrice} onChange={(e) => setForm((p) => ({ ...p, finalPrice: e.target.value }))} />
              </label>
              <label className={labelClass}>
                Payment Status
                <select className={inputClass} value={form.paymentStatus} onChange={(e) => setForm((p) => ({ ...p, paymentStatus: e.target.value as PaymentStatus }))}>
                  <option value="pending">Pending</option>
                  <option value="deposit_paid">Deposit paid</option>
                  <option value="paid">Paid</option>
                </select>
              </label>
              <label className={labelClass}>
                Payment Method
                <select className={inputClass} value={form.paymentMethod} onChange={(e) => setForm((p) => ({ ...p, paymentMethod: e.target.value as PaymentMethod }))}>
                  <option value="">Select method</option>
                  <option value="cash">Cash</option>
                  <option value="venmo">Venmo</option>
                  <option value="zelle">Zelle</option>
                  <option value="paypal">PayPal</option>
                  <option value="groupon">Groupon</option>
                  <option value="comp">Comp</option>
                  <option value="other">Other</option>
                </select>
              </label>
              {form.paymentMethod === 'comp' ? (
                <label className={`${labelClass} sm:col-span-2`}>
                  Comp reason *
                  <textarea
                    className={`${inputClass} min-h-[80px]`}
                    value={form.compReason}
                    onChange={(e) => setForm((p) => ({ ...p, compReason: e.target.value }))}
                    placeholder="Internal reason for complimentary booking (required)"
                  />
                </label>
              ) : null}
              <label className={labelClass}>
                Booking Source
                <input className={inputClass} value={form.bookingSource} onChange={(e) => setForm((p) => ({ ...p, bookingSource: e.target.value }))} />
              </label>
              <label className={`${labelClass} sm:col-span-2`}>
                Staff Notes
                <textarea className={`${inputClass} min-h-[120px]`} value={form.staffNotes} onChange={(e) => setForm((p) => ({ ...p, staffNotes: e.target.value }))} />
              </label>
            </div>

            {submitGate.primaryReason ? (
              <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="status">
                {submitGate.primaryReason}
              </p>
            ) : (
              <p className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-900" role="status">
                Ready to save — this slot is available.
              </p>
            )}

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => void save('hold')}
                disabled={!submitGate.canSubmit}
                className="inline-flex min-h-[54px] flex-1 items-center justify-center gap-2 rounded-xl bg-amber-600 px-5 py-3 text-lg font-bold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                <Save className="h-5 w-5" />
                {saving === 'hold' ? 'Saving...' : 'Save Hold'}
              </button>
              <button
                type="button"
                onClick={() => void save('booking')}
                disabled={!submitGate.canSubmit}
                className="inline-flex min-h-[54px] flex-1 items-center justify-center gap-2 rounded-xl bg-green-700 px-5 py-3 text-lg font-bold text-white hover:bg-green-800 disabled:opacity-50"
              >
                <CalendarPlus className="h-5 w-5" />
                {saving === 'booking' ? 'Creating...' : 'Create Booking'}
              </button>
              <button type="button" onClick={() => reset()} className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-lg font-bold text-slate-800 hover:bg-slate-50">
                <RotateCcw className="h-5 w-5" />
                Reset
              </button>
            </div>
          </section>

          <aside className="order-1 rounded-2xl bg-white p-5 shadow lg:order-2 lg:sticky lg:top-20 lg:self-start">
            <h2 className="text-2xl font-bold text-slate-900">Live Availability</h2>
            <div
              className={`mt-4 rounded-2xl border p-5 ${
                availability.status === 'available'
                  ? 'border-green-200 bg-green-50'
                  : availability.status === 'unavailable'
                    ? 'border-red-200 bg-red-50'
                    : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="text-2xl font-black">
                {availability.status === 'available'
                  ? `✅ ${availability.message}`
                  : availability.status === 'unavailable'
                    ? `❌ ${availability.message}`
                    : availability.message}
              </div>
              {form.bookingType === 'captain_charter' && availability.capacity ? (
                <p className="mt-3 text-base font-semibold text-slate-800">
                  {availability.capacity.used} of {availability.capacity.max} passenger
                  {availability.capacity.max === 1 ? '' : 's'} already booked for this overlapping time.
                </p>
              ) : null}
              {availability.status === 'unavailable' && availability.conflict ? (
                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="font-bold text-slate-600">Customer</dt>
                    <dd className="text-lg font-semibold text-slate-900">{availability.conflict.customer_name}</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-slate-600">Boat</dt>
                    <dd className="text-lg font-semibold text-slate-900">{availability.conflict.boat_name}</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-slate-600">Time</dt>
                    <dd className="text-lg font-semibold text-slate-900">{timeLabel(availability.conflict.start_time, availability.conflict.end_time)}</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-slate-600">Status</dt>
                    <dd className="text-lg font-semibold capitalize text-slate-900">{availability.conflict.status.replace(/_/g, ' ')}</dd>
                  </div>
                  <p className="pt-2 text-base font-semibold text-red-900">
                    {form.bookingType === 'captain_charter'
                      ? 'Reduce passengers or pick another time. Other groups may already share this charter.'
                      : 'Pick another time or boat.'}
                  </p>
                </dl>
              ) : availability.status === 'error' ? (
                <p className="mt-3 text-sm font-semibold text-red-800">{availability.message}</p>
              ) : null}
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="font-bold text-slate-900">Staff review</h3>
              {staffBioPackageSummary ? (
                <>
                  <p className="mt-2 text-sm font-semibold text-slate-800">{staffBioPackageSummary.cardTitle}</p>
                  <p className="text-xs text-slate-600">
                    Package ID: {staffBioPackageSummary.id} · {staffBioPackageSummary.guestCount} guest
                    {staffBioPackageSummary.guestCount === 1 ? '' : 's'}
                  </p>
                  <p className="mt-2 text-3xl font-black text-slate-900">
                    ${staffBioPackageSummary.directPriceUsd.toFixed(2)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Standard ${staffBioPackageSummary.standardValueUsd} · Save ${staffBioPackageSummary.savingsUsd}
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-2 text-sm text-slate-600">
                    {selectedBoat?.name || 'No boat selected'} · {form.location} · {durationHours || '-'} hr
                  </p>
                  <p className="mt-2 text-3xl font-black text-slate-900">${Number(form.finalPrice || 0).toFixed(2)}</p>
                  {form.bookingType === 'captain_charter' ? (
                    <p className="mt-1 text-xs text-slate-500">Includes captain fee at ${PRICING.captainHourly}/hr.</p>
                  ) : null}
                </>
              )}
            </div>
          </aside>
        </div>

        <section className="mt-8 rounded-2xl bg-white shadow">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-2xl font-bold">Today&apos;s Staff Bookings</h2>
              <p className="text-sm text-slate-500">Holds and bookings created by staff today.</p>
            </div>
            <button type="button" onClick={() => void loadToday()} className="rounded-lg border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-50">
              {todayLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          {todayRows.length === 0 ? (
            <p className="px-5 py-8 text-center text-slate-500">No staff bookings yet today.</p>
          ) : (
            <AdminResponsiveList
              desktop={
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                      <tr>
                        <th className="px-5 py-3">Time</th>
                        <th className="px-5 py-3">Customer</th>
                        <th className="px-5 py-3">Boat</th>
                        <th className="px-5 py-3">Location</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3">Payment Status</th>
                        <th className="px-5 py-3">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {todayRows.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50">
                          <td className="px-5 py-4 font-semibold">
                            <Link to={`/admin/bookings/${row.id}`} className="text-amber-700 hover:text-amber-800 hover:underline">
                              {timeLabel(row.start_time, row.end_time)}
                            </Link>
                          </td>
                          <td className="px-5 py-4">{row.customers?.full_name || row.customers?.phone || '-'}</td>
                          <td className="px-5 py-4">{row.boats?.name || '-'}</td>
                          <td className="px-5 py-4">{row.rental_location || '-'}</td>
                          <td className="px-5 py-4 capitalize">{row.status.replace(/_/g, ' ')}</td>
                          <td className="px-5 py-4 capitalize">{String(row.payment_status || 'pending').replace(/_/g, ' ')}</td>
                          <td className="px-5 py-4">{row.booking_source || 'admin'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
              mobile={
                <div className="space-y-3 p-3">
                  {todayRows.map((row) => (
                    <MobileAdminCard
                      key={row.id}
                      title={row.customers?.full_name || row.customers?.phone || 'Customer'}
                      subtitle={timeLabel(row.start_time, row.end_time)}
                      badge={<StatusBadge tone="info">{humanizeLabel(row.status)}</StatusBadge>}
                      fields={[
                        { label: 'Boat', value: row.boats?.name || '—' },
                        { label: 'Location', value: row.rental_location || '—' },
                        { label: 'Payment', value: humanizeLabel(String(row.payment_status || 'pending')) },
                        { label: 'Source', value: humanizeLabel(row.booking_source || 'admin') },
                      ]}
                      actions={
                        <Link
                          to={`/admin/bookings/${row.id}`}
                          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
                        >
                          Open details
                        </Link>
                      }
                    />
                  ))}
                </div>
              }
            />
          )}
        </section>
    </AdminShell>
  );
}
