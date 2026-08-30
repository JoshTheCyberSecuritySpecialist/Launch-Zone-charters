import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Calendar,
  Users,
  DollarSign,
  Shield,
  AlertCircle,
  Lock,
  BadgeCheck,
  Sparkles,
  Check,
} from 'lucide-react';
import BookingFlowStepIndicator from '../components/BookingFlowStepIndicator';
import BioBookingHelp from '../components/booking/BioBookingHelp';
import CharterPrivateSharedTourBlock from '../components/CharterPrivateSharedTourBlock';
import { BIO_DEPARTURE_AREA_LABEL } from '../lib/meetingLocations';
import { supabase } from '../lib/supabase';
import type { PostgrestError } from '@supabase/supabase-js';
import { logSupabaseError, userFacingSupabaseMessage } from '../lib/supabaseErrors';
import { uploadDocumentToDocumentsBucket } from '../lib/storageUpload';
import { PRICING, captainFeeForHours } from '../config/pricing';
import {
  SECURITY_DEPOSIT_CARD_INTRO,
  SECURITY_DEPOSIT_MARKETING_BULLETS,
  SECURITY_DEPOSIT_SECTION_HEADING,
  SECURITY_DEPOSIT_SHORT_SUMMARY,
} from '../content/securityDeposit';
import { CANCELLATION_REFUND_POLICY_CHECKOUT_NOTE } from '../content/cancellationRefundPolicy';
import Spinner from '../components/Spinner';
import SafeImage from '../components/SafeImage';
import { getBoatPlaceholderImage } from '../lib/boatPlaceholders';
import { env } from '../config/env.js';
import {
  bookingPageTitleFromSearchParams,
  hasProductBookingContext,
} from '../lib/experienceCatalog';
import {
  CHARTER_MAX_PASSENGERS,
  CHARTER_MIN_PASSENGERS,
  validateCharterPassengerCount,
} from '../lib/charterCapacity';
import { beginAsyncInteraction, measurePaintAfterSync, wrapSyncClick } from '../lib/clickPerf';
import {
  buildTileLines,
  fetchLaunchDaysSpaceCoast,
  mergeCalendarInsights,
  nextSevenDayKeys,
  pickBestLaunchDayIso,
  pickTopPickIso,
  isDayMarkedUnavailable,
  type CalendarDayAvailability,
  type DayInsight,
} from '../lib/calendarInsights';
import type { RentalLocation } from '../lib/grouponPromo';
import WaiverBlock, { waiverFormComplete } from '../components/booking/WaiverBlock';
import BioluminescencePackageCards from '../components/booking/BioluminescencePackageCards';
import RocketLaunchPackageCards from '../components/booking/RocketLaunchPackageCards';
import SunsetPackageCards from '../components/booking/SunsetPackageCards';
import {
  BIO_PACKAGE_PRICING_DISCLAIMER,
  BIO_FIFTH_PASSENGER_ADDON_USD,
  BIO_FIFTH_PASSENGER_NO_CAPACITY_MESSAGE,
  bioFourFifthPassengerFitsRemaining,
  bioFourSidebarPassengerLine,
  bioPackageAllowsFifthPassengerAddon,
  formatBioPackagePriceUsd,
  getBioPackageDisplay,
  isDirectBioPackagePricingEnabled,
  resolveBioFourCheckoutDisplay,
  type BioPackageId,
} from '../lib/bioluminescencePackages';
import {
  formatCharterDurationLabel,
  resolvePackageDurationMinutes,
} from '../lib/charterDuration';
import {
  getRocketPackageDisplay,
  isDirectRocketPackagePricingEnabled,
  isSharedRocketPackage,
  ROCKET_LAUNCH_MIN_GUESTS,
  ROCKET_SCHEDULE_NOTICE,
  ROCKET_SHARED_ACK_LABEL,
  ROCKET_SHARED_CHARTER_DISCLOSURE,
  type RocketPackageId,
} from '../lib/rocketLaunchPackages';
import {
  getSunsetPackageDisplay,
  isDirectSunsetPackagePricingEnabled,
  SUNSET_SOLO_NO_DEPARTURE_MESSAGE,
  SUNSET_SOLO_JOIN_DISCLOSURE,
  SUNSET_TWO_OPENER_DISCLOSURE,
  SUNSET_PRIVATE_CHARTER_DESCRIPTION,
  SUNSET_WILDLIFE_DISCLAIMER,
  type SunsetPackageId,
} from '../lib/sunsetPackages';
import {
  DIRECT_DEALS_PATH,
  directExperienceChooserPath,
} from '../lib/directBookingFlow.js';

interface BookNowProps {
  onNavigate: (page: string) => void;
}

interface ApiTimeSlot {
  start: string;
  end: string;
  label: string;
  startHHMM?: string;
  rocketDepartureLabel?: string | null;
  launchId?: string;
  launchName?: string;
  launchNetIso?: string;
  launchTimeLabel?: string;
  launchDateLabel?: string;
  launchStatus?: string | null;
  externalReference?: string;
  capacity?: {
    used?: number;
    remaining?: number;
    max?: number;
    rocketDeparture?: {
      guestsBooked?: number;
      guestsMax?: number;
      minimumGuests?: number;
      guestsNeededForMinimum?: number;
      minimumReached?: boolean;
      seatsRemaining?: number;
    };
  } | null;
}

/** API rows use `startIso`; BookNow historically used `start`. */
function normalizeApiTimeSlots(
  raw: Array<
    Partial<ApiTimeSlot> & {
      startIso?: string;
      endIso?: string;
      rocketDepartureLabel?: string | null;
    }
  > | undefined
): ApiTimeSlot[] {
  return (raw || [])
    .map((slot) => ({
      start: String(slot.start || slot.startIso || '').trim(),
      end: String(slot.end || slot.endIso || '').trim(),
      label: String(slot.label || '').trim(),
      startHHMM: slot.startHHMM,
      rocketDepartureLabel: slot.rocketDepartureLabel || null,
      launchId: slot.launchId,
      launchName: slot.launchName,
      launchNetIso: slot.launchNetIso,
      launchTimeLabel: slot.launchTimeLabel,
      launchDateLabel: slot.launchDateLabel,
      launchStatus: slot.launchStatus,
      externalReference: slot.externalReference,
      capacity: slot.capacity || null,
    }))
    .filter((slot) => Boolean(slot.start));
}

type PromoValidationResult = {
  promoCode: string;
  originalSubtotal: number;
  finalSubtotal: number;
  securityDeposit: number;
  originalTotal: number;
  discountAmount: number;
  finalTotal: number;
  description?: string | null;
  reasonCode?: string;
};

const FORECAST_LAT = 28.6122;
const FORECAST_LON = -80.8076;
const CALENDAR_INTEL_CACHE_MS = 15 * 60 * 1000;
const BUSINESS_TIMEZONE = 'America/New_York';
const SAME_DAY_MIN_NOTICE_HOURS = 2;
const BIO_NIGHT_CHARTER_TIMES = ['20:00', '21:00', '22:00', '23:00', '00:00', '01:00', '02:00', '03:00', '04:00'];
const DEFAULT_CHARTER_TIMES = ['17:00', '18:00', '19:00', '20:00', '21:00'];

/** Rental step-1 preset: Morning/Afternoon = half_day 4hr; Full day = full_day 8hr. */
type RentalDurationPreset = 'morning' | 'afternoon' | 'fullday';

function hourFromSlotIso(iso: string): number {
  return new Date(iso).getHours();
}

function pickRentalSlotByPreset(slots: ApiTimeSlot[], preset: RentalDurationPreset): ApiTimeSlot {
  if (slots.length === 0) {
    throw new Error('pickRentalSlotByPreset requires at least one slot');
  }
  if (preset === 'fullday') {
    return slots[0];
  }
  if (preset === 'morning') {
    const morning = slots.find((s) => hourFromSlotIso(s.start) < 12);
    return morning ?? slots[0];
  }
  const afternoon = slots.find((s) => hourFromSlotIso(s.start) >= 12);
  return afternoon ?? slots[slots.length - 1];
}

function ymdInTimezone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function parseYmd(value: string) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function timeLabelFromHHMM(time: string): string {
  const [hh, mm] = String(time || '').split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return time;
  return new Date(2000, 0, 1, hh, mm).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function isNextMorningNightCharterStart(charterType: CharterType, time: string) {
  if (charterType !== 'night_bio') return false;
  const hour = Number(String(time || '').split(':')[0]);
  return Number.isFinite(hour) && hour >= 0 && hour <= 4;
}

function isNextMorningBioStart(charterType: CharterType, time: string) {
  return isNextMorningNightCharterStart(charterType, time);
}

function buildSelectedStartDateTime({
  slotStartIso,
  date,
  time,
  bookingMode,
  charterType,
}: {
  slotStartIso: string;
  date: string;
  time: string;
  bookingMode: BookingMode;
  charterType: CharterType;
}) {
  const slotIso = String(slotStartIso ?? '').trim();
  if (slotIso) return new Date(slotIso);
  const parsedDate = parseYmd(date);
  const [hour, minute] = String(time || '').split(':').map(Number);
  if (!parsedDate || !Number.isFinite(hour) || !Number.isFinite(minute)) return new Date(NaN);
  const rollToNextMorning = bookingMode === 'charter' && isNextMorningBioStart(charterType, time);
  return new Date(parsedDate.year, parsedDate.month - 1, parsedDate.day + (rollToNextMorning ? 1 : 0), hour, minute);
}

function charterTypeForApi(charterType: CharterType): string {
  if (charterType === 'night_bio') return 'bio';
  if (charterType === 'sunset_cruise') return 'sunset';
  return 'rocket';
}

function addDaysToYmd(ymd: string, days: number): string {
  const parsed = parseYmd(ymd);
  if (!parsed) return ymd;
  const d = new Date(parsed.year, parsed.month - 1, parsed.day + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Boat {
  id: string;
  name: string;
  type: 'standard' | 'premium';
  capacity: number;
  description: string | null;
  image_url: string | null;
  hourly_rate: number;
  half_day_rate: number;
  full_day_rate: number;
}

type BookingMode = 'rental' | 'charter';
type CharterType = 'rocket_launch' | 'night_bio' | 'sunset_cruise';
type CharterVariant = 'private' | 'shared';

export default function BookNow({ onNavigate }: BookNowProps) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const bookingIdFromUrl = (searchParams.get('bookingId') || '').trim();
  const resumeTokenFromUrl = (searchParams.get('resume') || '').trim();
  const [bookingMode, setBookingMode] = useState<BookingMode>('rental');
  const [step, setStep] = useState(0);
  const [boats, setBoats] = useState<Boat[]>([]);
  /** False after first Supabase/API attempt finishes (success or failure). */
  const [boatsLoading, setBoatsLoading] = useState(true);
  const [boatsError, setBoatsError] = useState<string | null>(null);
  const [selectedBoat, setSelectedBoat] = useState<Boat | null>(null);
  const [bookingData, setBookingData] = useState({
    rentalType: 'half_day' as 'hourly' | 'half_day' | 'full_day',
    hours: 4,
    date: '',
    time: '09:00',
    captainIncluded: false,
    charterType: 'rocket_launch' as CharterType,
    charterVariant: 'private' as CharterVariant,
    passengerCount: 1,
    charterRequestOnly: false,
    fullName: '',
    email: '',
    phone: '',
    specialRequests: '',
    /** When set, start_time at checkout uses this ISO instant (server availability slot). */
    slotStartIso: '',
    /** Launch Library 2 launch id for rocket charter bookings. */
    launchId: '',
  });
  const [bioPackageId, setBioPackageId] = useState<BioPackageId | null>(null);
  const [bioFifthPassengerAddon, setBioFifthPassengerAddon] = useState(false);
  const [rocketPackageId, setRocketPackageId] = useState<RocketPackageId | null>(null);
  const [sunsetPackageId, setSunsetPackageId] = useState<SunsetPackageId | null>(null);
  const [rocketSharedMinimumAcknowledged, setRocketSharedMinimumAcknowledged] = useState(false);
  /** From GET /api/public/booking-config — enables package UI when Vite flag was not baked into the build. */
  const [serverDirectBioPackagesEnabled, setServerDirectBioPackagesEnabled] = useState<boolean | null>(
    null
  );
  const [serverDirectRocketPackagesEnabled, setServerDirectRocketPackagesEnabled] = useState<boolean | null>(
    null
  );
  const [serverDirectSunsetPackagesEnabled, setServerDirectSunsetPackagesEnabled] = useState<boolean | null>(
    null
  );
  const [waiverData, setWaiverData] = useState({
    agreed: false,
    signature: '',
  });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [damageFeeAcknowledged, setDamageFeeAcknowledged] = useState(false);
  /** Proof URLs used for renter document verification. */
  const [verificationData, setVerificationData] = useState({
    licenseProofUrl: '',
    insuranceProofUrl: '',
  });
  const [docUploadError, setDocUploadError] = useState<string | null>(null);
  const [docUploadBusy, setDocUploadBusy] = useState<'license' | 'insurance' | null>(null);
  const [buoyInsuranceAcknowledged, setBuoyInsuranceAcknowledged] = useState(false);
  const uploadSessionRef = useRef(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const [processing, setProcessing] = useState(false);
  /** Inline message when checkout session fails (replaces alert-only feedback). */
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [slotAlternatives, setSlotAlternatives] = useState<ApiTimeSlot[]>([]);
  const [prefillNotice, setPrefillNotice] = useState<string | null>(null);
  const [availabilityByDate, setAvailabilityByDate] = useState<
    Map<string, CalendarDayAvailability>
  >(new Map());
  const [availCalendarLoading, setAvailCalendarLoading] = useState(false);
  const [conditionsByDate, setConditionsByDate] = useState<Map<string, DayInsight>>(new Map());
  const [conditionsLoading, setConditionsLoading] = useState(false);
  const [timeSlots, setTimeSlots] = useState<ApiTimeSlot[]>([]);
  const [availTimesLoading, setAvailTimesLoading] = useState(false);
  const [timesManualFallback, setTimesManualFallback] = useState(false);
  const [sameDayMinLeadHours, setSameDayMinLeadHours] = useState(SAME_DAY_MIN_NOTICE_HOURS);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const checkoutFormRef = useRef<HTMLFormElement | null>(null);
  const bookingFormRef = useRef<HTMLDivElement | null>(null);
  const availabilityCalendarRef = useRef<HTMLDivElement | null>(null);
  const resumeLoadedRef = useRef(false);
  const [rentalDurationPreset, setRentalDurationPreset] = useState<RentalDurationPreset | null>(null);
  const [rentalLocation, setRentalLocation] = useState<RentalLocation>(null);
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promoValidation, setPromoValidation] = useState<PromoValidationResult | null>(null);
  const [promoMessage, setPromoMessage] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [promoApplying, setPromoApplying] = useState(false);
  const calendarIntelCacheRef = useRef<{ expiresAt: number; data: Map<string, DayInsight> } | null>(null);

  const buoyInsurancePagePath = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedBoat?.id) {
      params.set('boatId', selectedBoat.id);
      if (bookingIdFromUrl.length > 0) params.set('bookingId', bookingIdFromUrl);
    } else {
      params.set('needBoatSelection', '1');
      if (bookingIdFromUrl.length > 0) params.set('bookingId', bookingIdFromUrl);
    }
    return `/insurance-required?${params.toString()}`;
  }, [selectedBoat?.id, bookingIdFromUrl]);

  const normalizeToken = (value: string): string =>
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

  const resolveBoatFromParam = (boatParam: string, boatsList: Boat[]): Boat | null => {
    if (!boatParam || boatsList.length === 0) return null;
    const token = normalizeToken(boatParam);
    const byId = boatsList.find((b) => String(b.id).toLowerCase() === boatParam.toLowerCase());
    if (byId) return byId;

    if (token === 'standard_pontoon') {
      const standardByName = boatsList.find((b) => normalizeToken(b.name).includes('pontoon'));
      if (standardByName) return standardByName;
      return boatsList.find((b) => b.type === 'standard') || null;
    }
    if (token === 'key_largo_18') {
      const keyLargo = boatsList.find((b) => normalizeToken(b.name).includes('key_largo'));
      if (keyLargo) return keyLargo;
      return boatsList.find((b) => b.type === 'premium') || null;
    }

    const genericMatch = boatsList.find((b) => {
      const nameToken = normalizeToken(b.name);
      return nameToken.includes(token) || token.includes(nameToken);
    });
    return genericMatch || null;
  };

  useEffect(() => {
    if (!resumeTokenFromUrl || resumeLoadedRef.current) return;
    if (!env.apiUrlConfigured || !env.apiUrl) return;
    resumeLoadedRef.current = true;

    void (async () => {
      try {
        const res = await fetch(`${env.apiUrl}/api/booking-drafts/resume/${encodeURIComponent(resumeTokenFromUrl)}`);
        const payload = (await res.json().catch(() => ({}))) as {
          draft?: {
            booking_payload?: {
              customer?: Record<string, unknown>;
              booking?: Record<string, unknown>;
              waiver?: Record<string, unknown>;
            };
          };
          error?: string;
        };
        if (!res.ok || !payload.draft?.booking_payload) {
          setPrefillNotice(payload.error || 'Could not resume that booking draft.');
          return;
        }
        const draft = payload.draft.booking_payload;
        const customer = draft.customer || {};
        const booking = draft.booking || {};
        const waiver = draft.waiver || {};
        const mode = String(booking.bookingMode || 'rental') === 'charter' ? 'charter' : 'rental';
        setBookingMode(mode);
        setStep(mode === 'charter' ? 3 : 1);
        const boatId = String(booking.boat_id || '').trim();
        if (boatId && boats.length > 0) {
          const boat = boats.find((b) => b.id === boatId) || null;
          if (boat) setSelectedBoat(boat);
        }
        setBookingData((prev) => ({
          ...prev,
          rentalType:
            booking.rental_type === 'hourly' || booking.rental_type === 'full_day'
              ? (booking.rental_type as 'hourly' | 'full_day')
              : 'half_day',
          hours: Number(booking.duration_hours || prev.hours),
          date: String(booking.start_time || '').slice(0, 10) || prev.date,
          time: String(booking.start_time || '').slice(11, 16) || prev.time,
          captainIncluded: Boolean(booking.captain_included),
          charterType:
            booking.charterType === 'night_bio' || booking.charterType === 'sunset_cruise'
              ? (booking.charterType as CharterType)
              : booking.charterType === 'bio'
                ? 'night_bio'
                : booking.charterType === 'sunset'
                  ? 'sunset_cruise'
                  : 'rocket_launch',
          charterVariant: booking.charterType === 'bio' || booking.charterType === 'night_bio'
            ? 'shared'
            : booking.charterVariant === 'shared'
              ? 'shared'
              : 'private',
          passengerCount: Number(booking.passengerCount || prev.passengerCount),
          fullName: String(customer.full_name || prev.fullName),
          email: String(customer.email || prev.email),
          phone: String(customer.phone || prev.phone),
          specialRequests: String(booking.special_requests || prev.specialRequests),
          slotStartIso: String(booking.start_time || prev.slotStartIso),
        }));
        setBioFifthPassengerAddon(Boolean(booking.fifthPassengerAddon || booking.fifth_passenger_addon));
        setWaiverData((prev) => ({
          ...prev,
          agreed: Boolean(waiver.accepted || prev.agreed),
          signature: String(waiver.signature || prev.signature),
        }));
        setTermsAccepted(true);
        setDamageFeeAcknowledged(true);
        setPrefillNotice('Your saved booking progress has been restored.');
      } catch (err) {
        if (import.meta.env.DEV) console.warn('[booking-resume]', err);
        setPrefillNotice('Could not resume that booking draft.');
      }
    })();
  }, [boats, resumeTokenFromUrl]);

  const handleLicenseUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocUploadError(null);
    setDocUploadBusy('license');
    try {
      const { url, error } = await uploadDocumentToDocumentsBucket(
        file,
        'licenses',
        uploadSessionRef.current
      );
      if (error || !url) {
        setDocUploadError(error?.message || 'Could not upload license file.');
        return;
      }
      setVerificationData((prev) => ({ ...prev, licenseProofUrl: url }));
    } finally {
      setDocUploadBusy(null);
      e.target.value = '';
    }
  };

  const handleInsuranceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocUploadError(null);
    setDocUploadBusy('insurance');
    try {
      const { url, error } = await uploadDocumentToDocumentsBucket(
        file,
        'insurance',
        uploadSessionRef.current
      );
      if (error || !url) {
        setDocUploadError(error?.message || 'Could not upload insurance file.');
        return;
      }
      setVerificationData((prev) => ({ ...prev, insuranceProofUrl: url }));
    } finally {
      setDocUploadBusy(null);
      e.target.value = '';
    }
  };

  useEffect(() => {
    setCheckoutError(null);
  }, [step]);

  /** After each step change, bring the booking card into view — avoids staying scrolled to the footer from a long step 1. */
  useEffect(() => {
    if (step < 1) return;
    const id = window.requestAnimationFrame(() => {
      bookingFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [step]);

  useEffect(() => {
    if (!bookingData.date || !/^\d{4}-\d{2}-\d{2}$/.test(bookingData.date)) return;
    const [y, m] = bookingData.date.split('-').map(Number);
    if (y && m) setCalendarMonth(new Date(y, m - 1, 1));
  }, [bookingData.date]);

  useEffect(() => {
    const d = searchParams.get('date');
    const intent = searchParams.get('intent');
    const mode = searchParams.get('bookingMode');
    const charterType = searchParams.get('charterType');
    const boatParam = searchParams.get('boat');
    setBookingData((prev) => {
      const next = { ...prev };
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
        next.date = d;
      }
      if (mode === 'charter') {
        setBookingMode('charter');
        setSelectedBoat(null);
        setStep(1);
        next.captainIncluded = true;
      }
      if (mode === 'rental') {
        setBookingMode('rental');
        setStep(1);
      }
      if (intent === 'night') {
        setBookingMode('charter');
        setStep(1);
        next.time = '20:00';
        next.charterType = 'night_bio';
        next.hours = 1;
        next.charterVariant = 'shared';
      }
      if (charterType === 'rocket' || charterType === 'rocket_launch') {
        setBookingMode('charter');
        setStep(1);
        next.charterType = 'rocket_launch';
        next.hours = 1;
        const packageParam = searchParams.get('package');
        const pkgFromUrl = packageParam ? getRocketPackageDisplay(packageParam) : null;
        if (pkgFromUrl) {
          setRocketPackageId(pkgFromUrl.id);
          next.passengerCount = pkgFromUrl.id === 'rocket_private' ? 1 : pkgFromUrl.guestCount;
          next.charterVariant = pkgFromUrl.seating === 'private' ? 'private' : 'shared';
        }
      }
      if (charterType === 'bio' || charterType === 'night_bio') {
        setBookingMode('charter');
        setSelectedBoat(null);
        setStep(1);
        next.charterType = 'night_bio';
        next.time = '20:00';
        next.hours = 1;
        const packageParam = searchParams.get('package');
        const pkgFromUrl = packageParam ? getBioPackageDisplay(packageParam) : null;
        if (pkgFromUrl) {
          setBioPackageId(pkgFromUrl.id);
          next.passengerCount = pkgFromUrl.guestCount;
          next.charterVariant = 'shared';
        } else {
          next.charterVariant = 'shared';
        }
      }
      const packageOnly = getBioPackageDisplay(searchParams.get('package'));
      if (!charterType && packageOnly && mode !== 'rental') {
        setBookingMode('charter');
        setSelectedBoat(null);
        setStep(1);
        next.captainIncluded = true;
        next.charterType = 'night_bio';
        next.time = '20:00';
        next.hours = 1;
        setBioPackageId(packageOnly.id);
        next.passengerCount = packageOnly.guestCount;
        next.charterVariant = 'shared';
      }
      const rocketPackageOnly = getRocketPackageDisplay(searchParams.get('package'));
      if (!charterType && rocketPackageOnly && mode !== 'rental' && !packageOnly) {
        setBookingMode('charter');
        setSelectedBoat(null);
        setStep(1);
        next.captainIncluded = true;
        next.charterType = 'rocket_launch';
        next.hours = 1;
        setRocketPackageId(rocketPackageOnly.id);
        next.passengerCount =
          rocketPackageOnly.id === 'rocket_private' ? 1 : rocketPackageOnly.guestCount;
        next.charterVariant = rocketPackageOnly.seating === 'private' ? 'private' : 'shared';
      }
      if (charterType === 'sunset' || charterType === 'sunset_cruise') {
        setBookingMode('charter');
        setStep(1);
        next.charterType = 'sunset_cruise';
        next.time = '18:30';
        next.hours = 1;
        const packageParam = searchParams.get('package');
        const pkgFromUrl = packageParam ? getSunsetPackageDisplay(packageParam) : null;
        if (pkgFromUrl) {
          setSunsetPackageId(pkgFromUrl.id);
          next.passengerCount =
            pkgFromUrl.seating === 'private' ? Math.max(1, next.passengerCount || 1) : pkgFromUrl.guestCount;
          next.charterVariant = pkgFromUrl.seating === 'private' ? 'private' : 'shared';
        }
      }
      const sunsetPackageOnly = getSunsetPackageDisplay(searchParams.get('package'));
      if (
        !charterType &&
        sunsetPackageOnly &&
        mode !== 'rental' &&
        !packageOnly &&
        !rocketPackageOnly
      ) {
        setBookingMode('charter');
        setSelectedBoat(null);
        setStep(1);
        next.captainIncluded = true;
        next.charterType = 'sunset_cruise';
        next.time = '18:30';
        next.hours = 1;
        setSunsetPackageId(sunsetPackageOnly.id);
        next.passengerCount =
          sunsetPackageOnly.seating === 'private' ? 1 : sunsetPackageOnly.guestCount;
        next.charterVariant = sunsetPackageOnly.seating === 'private' ? 'private' : 'shared';
      }
      return next;
    });

    const charterDeepLinked =
      mode === 'charter' ||
      intent === 'night' ||
      charterType === 'rocket' ||
      charterType === 'rocket_launch' ||
      charterType === 'bio' ||
      charterType === 'night_bio' ||
      charterType === 'sunset' ||
      charterType === 'sunset_cruise';
    if (charterDeepLinked) setPrefillNotice(null);

    if (mode === 'rental' && !boatParam) {
      const loc = searchParams.get('location');
      if (loc === 'daytona') {
        setRentalLocation('daytona');
        setPrefillNotice('Booking from Daytona rentals.');
      } else if (loc === 'titusville') {
        setRentalLocation('titusville');
        setPrefillNotice('Booking from Titusville rentals.');
      } else {
        setPrefillNotice(null);
      }
    }
    if (mode === 'rental') {
      const loc = searchParams.get('location');
      if (loc === 'daytona') setRentalLocation('daytona');
      else if (loc === 'titusville') setRentalLocation('titusville');
    }
  }, [searchParams]);

  useEffect(() => {
    const mode = searchParams.get('bookingMode');
    const boatParam = searchParams.get('boat');
    if (mode !== 'rental' || !boatParam || boats.length === 0) return;
    const matchedBoat = resolveBoatFromParam(boatParam, boats);
    if (!matchedBoat) return;
    setBookingMode('rental');
    setSelectedBoat(matchedBoat);
    setStep(1);
    setPrefillNotice(`Preselected from pricing: ${matchedBoat.name}`);
    window.requestAnimationFrame(() => {
      bookingFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [boats, searchParams]);

  useEffect(() => {
    if (location.hash !== '#availability-calendar') return;
    if (bookingMode !== 'charter' || step !== 1) return;
    window.requestAnimationFrame(() => {
      availabilityCalendarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [bookingMode, location.hash, step]);

  useEffect(() => {
    if (bookingMode !== 'rental') setRentalDurationPreset(null);
  }, [bookingMode]);

  useEffect(() => {
    if (bookingMode === 'charter') setSelectedBoat(null);
  }, [bookingMode]);

  const loadBoats = useCallback(async () => {
    setBoatsLoading(true);
    setBoatsError(null);
    try {
      const { data, error } = await supabase
        .from('boats')
        .select('*')
        .eq('is_active', true)
        .order('type', { ascending: false });

      const rows = Array.isArray(data) ? data : [];
      logSupabaseError('BookNow.loadBoats', error);

      if (!error && rows.length > 0) {
        setBoats(rows as Boat[]);
        return;
      }

      const tryApi =
        env.apiUrlConfigured && Boolean(env.apiUrl) && (Boolean(error) || rows.length === 0);

      if (tryApi) {
        try {
          const r = await fetch(`${env.apiUrl}/api/boats`);
          const j = (await r.json().catch(() => null)) as { boats?: Boat[]; error?: string } | null;
          if (r.ok && Array.isArray(j?.boats) && j.boats.length > 0) {
            setBoats(j.boats as Boat[]);
            return;
          }
          if (!r.ok) {
            setBoatsError(j?.error || `Could not load boats (${r.status}).`);
            setBoats([]);
            return;
          }
          setBoats([]);
          return;
        } catch (fetchErr) {
          const msg = fetchErr instanceof Error ? fetchErr.message : 'Network error loading boats.';
          setBoatsError(error ? `${userFacingSupabaseMessage(error)} · API fallback: ${msg}` : msg);
          setBoats([]);
          return;
        }
      }

      if (error) {
        setBoatsError(userFacingSupabaseMessage(error));
        setBoats([]);
        return;
      }

      setBoats([]);
    } finally {
      setBoatsLoading(false);
    }
  }, [env.apiUrl, env.apiUrlConfigured]);

  useEffect(() => {
    void loadBoats();
  }, [loadBoats]);

  useEffect(() => {
    if (!env.apiUrlConfigured || !env.apiUrl) return;
    const ac = new AbortController();
    fetch(`${env.apiUrl}/api/public/booking-config`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('booking-config'))))
      .then((data: {
        directBioPackagePricingEnabled?: boolean;
        directRocketPackagePricingEnabled?: boolean;
        directSunsetPackagePricingEnabled?: boolean;
      }) => {
        setServerDirectBioPackagesEnabled(Boolean(data.directBioPackagePricingEnabled));
        setServerDirectRocketPackagesEnabled(Boolean(data.directRocketPackagePricingEnabled));
        setServerDirectSunsetPackagesEnabled(Boolean(data.directSunsetPackagePricingEnabled));
      })
      .catch(() => {
        setServerDirectBioPackagesEnabled(null);
        setServerDirectRocketPackagesEnabled(null);
        setServerDirectSunsetPackagesEnabled(null);
      });
    return () => ac.abort();
  }, [env.apiUrl, env.apiUrlConfigured]);

  const BIO_SHARED_PER_PERSON = 150;
  const ROCKET_SHARED_PER_PERSON = 85;
  const SUNSET_SHARED_PER_PERSON = 75;

  const isBioCharter = bookingMode === 'charter' && bookingData.charterType === 'night_bio';
  const bioPackageFromUrl = getBioPackageDisplay(searchParams.get('package'));
  const serverBioPackagesOn = serverDirectBioPackagesEnabled === true;
  /** Deep links, selected package, Vite flag, or live server flag (Render env). */
  const isBioPackageFlow =
    isBioCharter &&
    (isDirectBioPackagePricingEnabled() ||
      serverBioPackagesOn ||
      Boolean(bioPackageFromUrl) ||
      Boolean(bioPackageId));
  const selectedBioPackage = isBioPackageFlow
    ? getBioPackageDisplay(bioPackageId) ?? bioPackageFromUrl
    : null;
  const bioFourAddonEligible = Boolean(
    selectedBioPackage && bioPackageAllowsFifthPassengerAddon(selectedBioPackage.id)
  );
  const selectedCharterSlot =
    timeSlots.find((slot) => slot.start === bookingData.slotStartIso) || null;
  const bioFourFifthPassengerFits =
    timesManualFallback || bioFourFifthPassengerFitsRemaining(selectedCharterSlot?.capacity?.remaining);
  const bioFourCheckoutDisplay =
    selectedBioPackage && bioPackageAllowsFifthPassengerAddon(selectedBioPackage.id)
      ? resolveBioFourCheckoutDisplay({
          basePriceUsd: selectedBioPackage.directPriceUsd,
          addonSelected: bioFifthPassengerAddon,
        })
      : null;
  const isRocketCharter = bookingMode === 'charter' && bookingData.charterType === 'rocket_launch';
  const rocketPackageFromUrl = getRocketPackageDisplay(searchParams.get('package'));
  const serverRocketPackagesOn = serverDirectRocketPackagesEnabled === true;
  const isRocketPackageFlow =
    isRocketCharter &&
    (isDirectRocketPackagePricingEnabled() ||
      serverRocketPackagesOn ||
      Boolean(rocketPackageFromUrl) ||
      Boolean(rocketPackageId));
  const selectedRocketPackage = isRocketPackageFlow
    ? getRocketPackageDisplay(rocketPackageId) ?? rocketPackageFromUrl
    : null;
  const requiresRocketSharedAck = isSharedRocketPackage(selectedRocketPackage);
  const isSunsetCharter = bookingMode === 'charter' && bookingData.charterType === 'sunset_cruise';
  const sunsetPackageFromUrl = getSunsetPackageDisplay(searchParams.get('package'));
  const serverSunsetPackagesOn = serverDirectSunsetPackagesEnabled === true;
  const isSunsetPackageFlow =
    isSunsetCharter &&
    (isDirectSunsetPackagePricingEnabled() ||
      serverSunsetPackagesOn ||
      Boolean(sunsetPackageFromUrl) ||
      Boolean(sunsetPackageId));
  const selectedSunsetPackage = isSunsetPackageFlow
    ? getSunsetPackageDisplay(sunsetPackageId) ?? sunsetPackageFromUrl
    : null;
  const requiredDirectExperience = isBioPackageFlow
    ? 'bio'
    : isRocketPackageFlow
      ? 'rocket'
      : isSunsetPackageFlow
        ? 'sunset'
        : null;
  const selectedDirectPackage = selectedBioPackage || selectedRocketPackage || selectedSunsetPackage;
  const missingRequiredDirectPackage = Boolean(requiredDirectExperience) && !selectedDirectPackage;
  const charterDurationLabel = formatCharterDurationLabel(
    resolvePackageDurationMinutes(selectedDirectPackage)
  );
  const charterAvailabilityQueryParams = (() => {
    if (isRocketPackageFlow && selectedRocketPackage) {
      const q = new URLSearchParams();
      q.set('package', selectedRocketPackage.id);
      q.set('charterVariant', selectedRocketPackage.seating === 'private' ? 'private' : 'shared');
      q.set(
        'passengerCount',
        String(
          selectedRocketPackage.id === 'rocket_private'
            ? bookingData.passengerCount
            : selectedRocketPackage.guestCount
        )
      );
      return q.toString();
    }
    if (isSunsetPackageFlow && selectedSunsetPackage) {
      const q = new URLSearchParams();
      q.set('package', selectedSunsetPackage.id);
      q.set('charterVariant', selectedSunsetPackage.seating === 'private' ? 'private' : 'shared');
      q.set(
        'passengerCount',
        String(
          selectedSunsetPackage.seating === 'private'
            ? bookingData.passengerCount
            : selectedSunsetPackage.guestCount
        )
      );
      return q.toString();
    }
    if (isBioPackageFlow && selectedBioPackage) {
      const q = new URLSearchParams();
      q.set('package', selectedBioPackage.id);
      q.set('charterVariant', 'shared');
      q.set('passengerCount', String(selectedBioPackage.guestCount));
      return q.toString();
    }
    return '';
  })();
  /** Charters use a ticket-style checkout and skip rental add-ons. */
  const charterUsesPrivateSharedStep = false;
  const isSharedTour = false;
  const sharedTourPerPerson = (() => {
    if (bookingData.charterType === 'night_bio') {
      return selectedBioPackage ? selectedBioPackage.perGuestUsd : BIO_SHARED_PER_PERSON;
    }
    if (bookingData.charterType === 'rocket_launch') {
      return selectedRocketPackage ? selectedRocketPackage.perGuestUsd : ROCKET_SHARED_PER_PERSON;
    }
    if (selectedSunsetPackage) return selectedSunsetPackage.perGuestUsd;
    return SUNSET_SHARED_PER_PERSON;
  })();

  useEffect(() => {
    if (!bioFourAddonEligible) {
      if (bioFifthPassengerAddon) setBioFifthPassengerAddon(false);
      return;
    }
    if (bioFifthPassengerAddon && !bioFourFifthPassengerFits) {
      setBioFifthPassengerAddon(false);
      setBookingData((prev) => ({ ...prev, passengerCount: 4 }));
    }
  }, [
    bioFourAddonEligible,
    bioFifthPassengerAddon,
    bioFourFifthPassengerFits,
    bookingData.date,
    bookingData.slotStartIso,
    bookingData.time,
  ]);

  const handleSelectBioPackage = useCallback(
    (id: BioPackageId) => {
      const pkg = getBioPackageDisplay(id);
      if (!pkg) return;
      setBioPackageId(id);
      setBioFifthPassengerAddon(false);
      setRocketPackageId(null);
      setSunsetPackageId(null);
      setRocketSharedMinimumAcknowledged(false);
      setBookingData((prev) => ({ ...prev, passengerCount: pkg.guestCount, charterVariant: 'shared' }));
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('bookingMode', 'charter');
          next.set('charterType', 'bio');
          next.set('package', id);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const handleSelectRocketPackage = useCallback(
    (id: RocketPackageId) => {
      const pkg = getRocketPackageDisplay(id);
      if (!pkg) return;
      setRocketPackageId(id);
      setBioPackageId(null);
      setBioFifthPassengerAddon(false);
      setSunsetPackageId(null);
      setRocketSharedMinimumAcknowledged(false);
      setBookingData((prev) => ({
        ...prev,
        passengerCount: pkg.id === 'rocket_private' ? Math.max(1, prev.passengerCount || 1) : pkg.guestCount,
        charterVariant: pkg.seating === 'private' ? 'private' : 'shared',
      }));
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('bookingMode', 'charter');
          next.set('charterType', 'rocket');
          next.set('package', id);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const handleSelectSunsetPackage = useCallback(
    (id: SunsetPackageId) => {
      const pkg = getSunsetPackageDisplay(id);
      if (!pkg) return;
      setSunsetPackageId(id);
      setBioPackageId(null);
      setBioFifthPassengerAddon(false);
      setRocketPackageId(null);
      setRocketSharedMinimumAcknowledged(false);
      setBookingData((prev) => ({
        ...prev,
        passengerCount:
          pkg.seating === 'private' ? Math.max(1, prev.passengerCount || 1) : pkg.guestCount,
        charterVariant: pkg.seating === 'private' ? 'private' : 'shared',
      }));
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('bookingMode', 'charter');
          next.set('charterType', 'sunset');
          next.set('package', id);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const syncCharterExperienceUrl = useCallback(
    (charterType: CharterType, packageId: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('bookingMode', 'charter');
          if (charterType === 'night_bio') {
            next.set('charterType', 'bio');
            if (packageId && getBioPackageDisplay(packageId)) next.set('package', packageId);
            else next.delete('package');
          } else if (charterType === 'sunset_cruise') {
            next.set('charterType', 'sunset');
            if (packageId && getSunsetPackageDisplay(packageId)) next.set('package', packageId);
            else next.delete('package');
          } else {
            next.set('charterType', 'rocket');
            if (packageId && getRocketPackageDisplay(packageId)) next.set('package', packageId);
            else next.delete('package');
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const charterTypeMatchesUrl = useCallback(
    (charterType: CharterType, params: URLSearchParams) => {
      const expected = charterTypeForApi(charterType);
      const urlType = (params.get('charterType') || '').trim().toLowerCase();
      if (expected === 'bio') return urlType === 'bio' || urlType === 'night_bio';
      if (expected === 'sunset') return urlType === 'sunset' || urlType === 'sunset_cruise';
      return urlType === 'rocket' || urlType === 'rocket_launch';
    },
    []
  );

  useEffect(() => {
    if (bookingMode !== 'charter') return;
    const urlTypeOk = charterTypeMatchesUrl(bookingData.charterType, searchParams);
    const urlPackage = searchParams.get('package') || '';
    const wantPackage =
      charterTypeForApi(bookingData.charterType) === 'bio'
        ? bioPackageId || ''
        : charterTypeForApi(bookingData.charterType) === 'rocket'
          ? rocketPackageId || ''
          : charterTypeForApi(bookingData.charterType) === 'sunset'
            ? sunsetPackageId || ''
            : '';
    const packageOk =
      charterTypeForApi(bookingData.charterType) === 'bio' ||
      charterTypeForApi(bookingData.charterType) === 'rocket' ||
      charterTypeForApi(bookingData.charterType) === 'sunset'
        ? urlPackage === wantPackage
        : true;
    if (urlTypeOk && packageOk) return;
    syncCharterExperienceUrl(
      bookingData.charterType,
      charterTypeForApi(bookingData.charterType) === 'bio'
        ? bioPackageId
        : charterTypeForApi(bookingData.charterType) === 'rocket'
          ? rocketPackageId
          : charterTypeForApi(bookingData.charterType) === 'sunset'
            ? sunsetPackageId
            : null
    );
  }, [
    bookingMode,
    bookingData.charterType,
    bioPackageId,
    rocketPackageId,
    sunsetPackageId,
    searchParams,
    syncCharterExperienceUrl,
    charterTypeMatchesUrl,
  ]);

  const handleSelectCharterExperience = useCallback(
    (charterType: CharterType) => {
      setBookingMode('charter');
      setSelectedBoat(null);
      if (charterType === 'night_bio') {
        const pkg = getBioPackageDisplay(bioPackageId);
        setRocketPackageId(null);
        setSunsetPackageId(null);
        setBioFifthPassengerAddon(false);
        setRocketSharedMinimumAcknowledged(false);
        setBookingData((prev) => ({
          ...prev,
          captainIncluded: true,
          charterType: 'night_bio',
          charterVariant: 'shared',
          passengerCount: pkg?.guestCount ?? prev.passengerCount ?? 1,
          rentalType: 'half_day',
          hours: 1,
          time: '20:00',
          slotStartIso: '',
        }));
        syncCharterExperienceUrl('night_bio', bioPackageId);
      } else {
        if (charterType === 'rocket_launch') {
          setBioPackageId(null);
          setSunsetPackageId(null);
        } else if (charterType === 'sunset_cruise') {
          setBioPackageId(null);
          setRocketPackageId(null);
          setRocketSharedMinimumAcknowledged(false);
        } else {
          setBioPackageId(null);
          setRocketPackageId(null);
          setSunsetPackageId(null);
          setRocketSharedMinimumAcknowledged(false);
        }
        setBookingData((prev) => ({
          ...prev,
          captainIncluded: true,
          charterType,
          charterVariant: 'private',
          passengerCount: 1,
          rentalType: 'half_day',
          hours: 1,
          time: charterType === 'sunset_cruise' ? '18:30' : prev.time,
          slotStartIso: '',
        }));
        syncCharterExperienceUrl(
          charterType,
          charterType === 'rocket_launch'
            ? rocketPackageId
            : charterType === 'sunset_cruise'
              ? sunsetPackageId
              : null
        );
      }
      setStep(1);
    },
    [bioPackageId, rocketPackageId, sunsetPackageId, syncCharterExperienceUrl]
  );

  const sharedTourOverLimit =
    bookingMode === 'charter' &&
    (bookingData.passengerCount < CHARTER_MIN_PASSENGERS || bookingData.passengerCount > CHARTER_MAX_PASSENGERS);
  const sharedHoursUntilTrip = (() => {
    if (!bookingData.date) return Number.POSITIVE_INFINITY;
    const [y, m, d] = bookingData.date.split('-').map(Number);
    if (!y || !m || !d) return Number.POSITIVE_INFINITY;
    const tripDate = new Date(y, m - 1, d);
    const now = new Date();
    return (tripDate.getTime() - now.getTime()) / (1000 * 60 * 60);
  })();
  const sharedOpenWindow = Number.isFinite(sharedHoursUntilTrip) && sharedHoursUntilTrip <= 48;

  useEffect(() => {
    if (isSharedTour && !sharedOpenWindow) {
      setBookingData((prev) => ({ ...prev, charterVariant: 'private' }));
    }
  }, [isSharedTour, sharedOpenWindow]);

  const durationHoursForAvailability = bookingData.hours;

  useEffect(() => {
    if (bookingMode !== 'rental' || !env.apiUrlConfigured || !env.apiUrl || !selectedBoat?.id) {
      if (bookingMode === 'rental') setAvailabilityByDate(new Map());
      return;
    }
    const ac = new AbortController();
    setAvailCalendarLoading(true);
    const q = new URLSearchParams({
      boatId: selectedBoat.id,
      durationHours: String(durationHoursForAvailability),
    });
    fetch(`${env.apiUrl}/api/availability?${q.toString()}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('calendar'))))
      .then(
        (data: {
          dates?: {
            date: string;
            available: boolean;
            boatsRemaining?: number;
            totalBoats?: number;
          }[];
        }) => {
          const m = new Map<string, CalendarDayAvailability>();
          for (const row of data.dates || []) {
            m.set(row.date, {
              available: row.available,
              boatsRemaining: row.boatsRemaining,
              totalBoats: row.totalBoats,
            });
          }
          setAvailabilityByDate(m);
        }
      )
      .catch(() => {
        if (!ac.signal.aborted) setAvailabilityByDate(new Map());
      })
      .finally(() => {
        if (!ac.signal.aborted) setAvailCalendarLoading(false);
      });
    return () => ac.abort();
  }, [bookingMode, selectedBoat?.id, durationHoursForAvailability, env.apiUrl, env.apiUrlConfigured]);

  useEffect(() => {
    if (bookingMode !== 'charter' || !env.apiUrlConfigured || !env.apiUrl) {
      return;
    }
    const ac = new AbortController();
    setAvailCalendarLoading(true);
    const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const monthEnd = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0);
    const from = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}-${String(monthStart.getDate()).padStart(2, '0')}`;
    const to = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`;
    const q = new URLSearchParams({
      from,
      to,
      charterType: charterTypeForApi(bookingData.charterType),
    });
    if (charterAvailabilityQueryParams) {
      new URLSearchParams(charterAvailabilityQueryParams).forEach((value, key) => {
        q.set(key, value);
      });
    }
    fetch(`${env.apiUrl}/api/availability/charter?${q.toString()}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('charter calendar'))))
      .then((data: { dates?: { date: string; available: boolean; slotsRemaining?: number }[] }) => {
        const m = new Map<string, CalendarDayAvailability>();
        for (const row of data.dates || []) {
          m.set(row.date, {
            available: row.available,
            boatsRemaining: row.slotsRemaining,
            totalBoats: row.slotsRemaining,
          });
        }
        setAvailabilityByDate(m);
      })
      .catch(() => {
        if (!ac.signal.aborted) setAvailabilityByDate(new Map());
      })
      .finally(() => {
        if (!ac.signal.aborted) setAvailCalendarLoading(false);
      });
    return () => ac.abort();
  }, [
    bookingMode,
    bookingData.charterType,
    calendarMonth,
    charterAvailabilityQueryParams,
    env.apiUrl,
    env.apiUrlConfigured,
  ]);

  useEffect(() => {
    const cached = calendarIntelCacheRef.current;
    if (cached && cached.expiresAt > Date.now()) {
      setConditionsByDate(new Map(cached.data));
      return;
    }

    const ac = new AbortController();
    setConditionsLoading(true);

    const todayYmdForWindow = (() => {
      const t = new Date();
      return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    })();
    const windowKeys = nextSevenDayKeys(todayYmdForWindow);
    const q = new URLSearchParams({
      latitude: String(FORECAST_LAT),
      longitude: String(FORECAST_LON),
      daily: 'wind_speed_10m_max,precipitation_probability_max,cloud_cover_mean',
      forecast_days: '7',
      timezone: 'America/New_York',
    });

    const weatherFetch = fetch(`https://api.open-meteo.com/v1/forecast?${q.toString()}`, {
      signal: ac.signal,
    }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('forecast')))) as Promise<{
      daily?: {
        time?: string[];
        wind_speed_10m_max?: number[];
        precipitation_probability_max?: number[];
        cloud_cover_mean?: number[];
      };
    }>;

    Promise.all([weatherFetch, fetchLaunchDaysSpaceCoast(windowKeys, ac.signal)])
      .then(([data, { byDate: launchByDate }]) => {
        const dates = data.daily?.time || [];
        const wind = data.daily?.wind_speed_10m_max || [];
        const rain = data.daily?.precipitation_probability_max || [];
        const clouds = data.daily?.cloud_cover_mean || [];
        const weatherMap = new Map<
          string,
          { windSpeed: number; rainProbability: number; cloudCover: number }
        >();
        dates.forEach((iso, i) => {
          if (!iso) return;
          weatherMap.set(iso, {
            windSpeed: Number(wind[i] ?? 0),
            rainProbability: Number(rain[i] ?? 0),
            cloudCover: Number(clouds[i] ?? 0),
          });
        });
        const merged = mergeCalendarInsights(weatherMap, launchByDate, windowKeys);
        calendarIntelCacheRef.current = {
          expiresAt: Date.now() + CALENDAR_INTEL_CACHE_MS,
          data: new Map(merged),
        };
        setConditionsByDate(merged);
      })
      .catch(() => {
        if (!ac.signal.aborted) setConditionsByDate(new Map());
      })
      .finally(() => {
        if (!ac.signal.aborted) setConditionsLoading(false);
      });

    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (bookingMode !== 'rental') {
      return;
    }
    if (!env.apiUrlConfigured || !env.apiUrl || !selectedBoat?.id || !bookingData.date) {
      setTimeSlots([]);
      setTimesManualFallback(false);
      return;
    }
    const ac = new AbortController();
    setAvailTimesLoading(true);
    setTimesManualFallback(false);
    const q = new URLSearchParams({
      boatId: selectedBoat.id,
      date: bookingData.date,
      durationHours: String(durationHoursForAvailability),
    });
    fetch(`${env.apiUrl}/api/availability/times?${q.toString()}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('times'))))
      .then((data: { slots?: ApiTimeSlot[]; minLeadHours?: number }) => {
        const slots = normalizeApiTimeSlots(data.slots);
        const minLeadHours = Number(data.minLeadHours);
        if (Number.isFinite(minLeadHours) && minLeadHours >= 0) {
          setSameDayMinLeadHours(minLeadHours);
        }
        setTimeSlots(slots);
        if (slots.length > 0) {
          setBookingData((prev) => {
            if (bookingMode === 'rental') {
              if (!rentalDurationPreset) {
                return { ...prev, slotStartIso: '' };
              }
              const still =
                Boolean(prev.slotStartIso) && slots.some((s) => s.start === prev.slotStartIso);
              const suggested = pickRentalSlotByPreset(slots, rentalDurationPreset);
              const chosen =
                still && prev.slotStartIso
                  ? slots.find((s) => s.start === prev.slotStartIso) ?? suggested
                  : suggested;
              return {
                ...prev,
                slotStartIso: chosen.start,
                time: chosen.startHHMM || prev.time,
              };
            }
            const still =
              Boolean(prev.slotStartIso) && slots.some((s) => s.start === prev.slotStartIso);
            const pick = still && prev.slotStartIso ? prev.slotStartIso : slots[0].start;
            const slot = slots.find((s) => s.start === pick) || slots[0];
            return {
              ...prev,
              slotStartIso: pick,
              time: slot.startHHMM || prev.time,
            };
          });
        } else {
          setBookingData((prev) => ({ ...prev, slotStartIso: '' }));
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) {
          setTimeSlots([]);
          setTimesManualFallback(true);
          setBookingData((prev) => ({ ...prev, slotStartIso: '' }));
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setAvailTimesLoading(false);
      });
    return () => ac.abort();
  }, [
    bookingMode,
    selectedBoat?.id,
    bookingData.date,
    durationHoursForAvailability,
    env.apiUrl,
    env.apiUrlConfigured,
    bookingMode,
    rentalDurationPreset,
  ]);

  useEffect(() => {
    if (bookingMode !== 'charter' || !env.apiUrlConfigured || !env.apiUrl || !bookingData.date) {
      if (bookingMode === 'charter') {
        setTimeSlots([]);
        setTimesManualFallback(false);
      }
      return;
    }
    const ac = new AbortController();
    setAvailTimesLoading(true);
    setTimesManualFallback(false);
    const charterType = charterTypeForApi(bookingData.charterType);
    const fetchDay = (date: string) => {
      const q = new URLSearchParams({ date, charterType });
      if (charterAvailabilityQueryParams) {
        new URLSearchParams(charterAvailabilityQueryParams).forEach((value, key) => {
          q.set(key, value);
        });
      }
      return fetch(`${env.apiUrl}/api/availability/charter/times?${q.toString()}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('charter times'))))
        .then((data: { slots?: ApiTimeSlot[] }) => normalizeApiTimeSlots(data.slots));
    };
    const nextDate = addDaysToYmd(bookingData.date, 1);
    const load =
      bookingData.charterType === 'night_bio'
        ? Promise.all([fetchDay(bookingData.date), fetchDay(nextDate)])
        : fetchDay(bookingData.date).then((slots) => [slots, [] as ApiTimeSlot[]]);

    load
      .then(([todaySlots, tomorrowSlots]) => {
        const merged = [...todaySlots];
        for (const slot of tomorrowSlots) {
          const hour = Number(String(slot.startHHMM || '').slice(0, 2));
          if (Number.isFinite(hour) && hour >= 0 && hour <= 4) merged.push(slot);
        }
        setTimeSlots(merged);
        if (merged.length > 0) {
          setBookingData((prev) => {
            const still =
              Boolean(prev.slotStartIso) && merged.some((s) => s.start === prev.slotStartIso);
            const stillTime =
              Boolean(prev.time) &&
              merged.some((s) => s.startHHMM === prev.time || s.start === prev.slotStartIso);
            const pick = still && prev.slotStartIso ? prev.slotStartIso : stillTime ? prev.slotStartIso : merged[0].start;
            const slot = merged.find((s) => s.start === pick) || merged.find((s) => s.startHHMM === prev.time) || merged[0];
            return {
              ...prev,
              slotStartIso: slot.start,
              time: slot.startHHMM || prev.time,
              launchId: slot.launchId || prev.launchId || '',
            };
          });
        } else {
          setBookingData((prev) => ({ ...prev, slotStartIso: '', time: '', launchId: '' }));
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) {
          setTimeSlots([]);
          setTimesManualFallback(true);
          setBookingData((prev) => ({ ...prev, slotStartIso: '' }));
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setAvailTimesLoading(false);
      });
    return () => ac.abort();
  }, [
    bookingMode,
    bookingData.date,
    bookingData.charterType,
    charterAvailabilityQueryParams,
    env.apiUrl,
    env.apiUrlConfigured,
  ]);

  const todayYmdLocal = ymdInTimezone(BUSINESS_TIMEZONE);
  const apiAvailEnabled = env.apiUrlConfigured && Boolean(env.apiUrl);
  const dateMarkedUnavailable =
    availabilityByDate.size > 0 &&
    Boolean(bookingData.date) &&
    isDayMarkedUnavailable(availabilityByDate, bookingData.date);
  const noSlotsForDay =
    apiAvailEnabled &&
    !availTimesLoading &&
    !timesManualFallback &&
    timeSlots.length === 0 &&
    Boolean(bookingData.date) &&
    (bookingMode === 'rental' ? Boolean(selectedBoat) : bookingMode === 'charter');
  const isBookingToday = Boolean(bookingData.date) && bookingData.date === todayYmdLocal;
  const rentalContinueNeedsPreset = bookingMode === 'rental' && rentalDurationPreset === null;
  const rentalContinueWaitingTimes =
    bookingMode === 'rental' &&
    rentalDurationPreset !== null &&
    Boolean(bookingData.date) &&
    apiAvailEnabled &&
    availTimesLoading;
  const rentalContinueNeedsSlot =
    bookingMode === 'rental' &&
    rentalDurationPreset !== null &&
    Boolean(bookingData.date) &&
    apiAvailEnabled &&
    !timesManualFallback &&
    !availTimesLoading &&
    timeSlots.length > 0 &&
    !bookingData.slotStartIso;
  const scheduleContinueBlocked =
    rentalContinueNeedsPreset ||
    rentalContinueWaitingTimes ||
    rentalContinueNeedsSlot ||
    dateMarkedUnavailable ||
    noSlotsForDay ||
    (bookingMode === 'charter' &&
      apiAvailEnabled &&
      !timesManualFallback &&
      Boolean(bookingData.date) &&
      !bookingData.time &&
      !bookingData.slotStartIso) ||
    (bookingMode === 'charter' &&
      isRocketCharter &&
      apiAvailEnabled &&
      Boolean(bookingData.date) &&
      !bookingData.launchId &&
      !timesManualFallback &&
      !availTimesLoading);

  const CHARTER_EXPERIENCE_LABEL: Record<CharterType, string> = {
    rocket_launch: 'Rocket launch charter',
    night_bio: 'Bioluminescence night charter',
    sunset_cruise: 'Sunset and Wildlife Cruise',
  };

  const CHARTER_INCLUSIONS_LINE = 'Captain & fuel included · No security deposit';

  const charterSelectedDescription = (): string => {
    const t = bookingData.charterType;
    if (isRocketPackageFlow && selectedRocketPackage) {
      return `${selectedRocketPackage.cardTitle} · ${
        selectedRocketPackage.seating === 'shared' ? 'Shared charter' : 'Private charter'
      }`;
    }
    if (isSunsetPackageFlow && selectedSunsetPackage) {
      return `${selectedSunsetPackage.cardTitle} · ${
        selectedSunsetPackage.seating === 'shared' ? 'Shared charter' : 'Private charter'
      }`;
    }
    const base = CHARTER_EXPERIENCE_LABEL[t];
    if (t === 'night_bio' || t === 'rocket_launch' || t === 'sunset_cruise') {
      return `${base} · ${bookingData.charterVariant === 'shared' ? 'Shared tour' : 'Private charter'}`;
    }
    return `${base} · Private charter`;
  };

  const charterHeroTitle =
    bookingData.charterType === 'rocket_launch'
      ? 'Rocket Launch Charter'
      : bookingData.charterType === 'night_bio'
        ? 'Bioluminescence Tour'
        : bookingData.charterType === 'sunset_cruise'
          ? 'Sunset and Wildlife Cruise'
          : 'Charter';

  function calendarCellsFor(monthStart: Date) {
    const y = monthStart.getFullYear();
    const m = monthStart.getMonth();
    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells: { label: number | null; iso?: string }[] = [];
    for (let i = 0; i < firstDow; i++) cells.push({ label: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ label: d, iso });
    }
    return cells;
  }

  const calculateRentalPricing = () => {
    if (!selectedBoat) {
      return {
        basePrice: 0,
        captainFee: 0,
        deposit: PRICING.securityDeposit,
        weekendSurcharge: 0,
        rocketLaunchSurcharge: 0,
        bioTourSurcharge: 0,
        sunsetExperienceSurcharge: 0,
        nightExperienceSurcharge: 0,
        peakSeasonSurcharge: 0,
        total: 0,
      };
    }
    const hr = Number(selectedBoat.hourly_rate);
    const half = Number(selectedBoat.half_day_rate);
    const full = Number(selectedBoat.full_day_rate);
    const hours = Number(bookingData.hours) || 0;

    let basePrice = 0;
    const captainFee = bookingData.captainIncluded ? captainFeeForHours(hours) : 0;
    const deposit = PRICING.securityDeposit;

    switch (bookingData.rentalType) {
      case 'hourly':
        basePrice = hr * hours;
        break;
      case 'half_day':
        basePrice = half;
        break;
      case 'full_day':
        basePrice = full;
        break;
    }

    const total = Number(basePrice) + Number(captainFee) + Number(deposit);

    return {
      basePrice: Number(basePrice),
      captainFee: Number(captainFee),
      deposit: Number(deposit),
      weekendSurcharge: 0,
      rocketLaunchSurcharge: 0,
      bioTourSurcharge: 0,
      sunsetExperienceSurcharge: 0,
      nightExperienceSurcharge: 0,
      peakSeasonSurcharge: 0,
      total: Number(total),
    };
  };

  const calculateCharterPricing = () => {
    if (isBioPackageFlow) {
      if (!selectedBioPackage) {
        return {
          basePrice: 0,
          captainFee: 0,
          deposit: 0,
          weekendSurcharge: 0,
          rocketLaunchSurcharge: 0,
          bioTourSurcharge: 0,
          sunsetExperienceSurcharge: 0,
          nightExperienceSurcharge: 0,
          peakSeasonSurcharge: 0,
          total: 0,
        };
      }
      const total = bioFourCheckoutDisplay ? bioFourCheckoutDisplay.totalUsd : selectedBioPackage.directPriceUsd;
      return {
        basePrice: total,
        captainFee: 0,
        deposit: 0,
        weekendSurcharge: 0,
        rocketLaunchSurcharge: 0,
        bioTourSurcharge: 0,
        sunsetExperienceSurcharge: 0,
        nightExperienceSurcharge: 0,
        peakSeasonSurcharge: 0,
        total,
      };
    }
    if (isRocketPackageFlow) {
      if (!selectedRocketPackage) {
        return {
          basePrice: 0,
          captainFee: 0,
          deposit: 0,
          weekendSurcharge: 0,
          rocketLaunchSurcharge: 0,
          bioTourSurcharge: 0,
          sunsetExperienceSurcharge: 0,
          nightExperienceSurcharge: 0,
          peakSeasonSurcharge: 0,
          total: 0,
        };
      }
      const total = selectedRocketPackage.directPriceUsd;
      return {
        basePrice: total,
        captainFee: 0,
        deposit: 0,
        weekendSurcharge: 0,
        rocketLaunchSurcharge: 0,
        bioTourSurcharge: 0,
        sunsetExperienceSurcharge: 0,
        nightExperienceSurcharge: 0,
        peakSeasonSurcharge: 0,
        total,
      };
    }
    if (isSunsetPackageFlow) {
      if (!selectedSunsetPackage) {
        return {
          basePrice: 0,
          captainFee: 0,
          deposit: 0,
          weekendSurcharge: 0,
          rocketLaunchSurcharge: 0,
          bioTourSurcharge: 0,
          sunsetExperienceSurcharge: 0,
          nightExperienceSurcharge: 0,
          peakSeasonSurcharge: 0,
          total: 0,
        };
      }
      const total = selectedSunsetPackage.directPriceUsd;
      return {
        basePrice: total,
        captainFee: 0,
        deposit: 0,
        weekendSurcharge: 0,
        rocketLaunchSurcharge: 0,
        bioTourSurcharge: 0,
        sunsetExperienceSurcharge: 0,
        nightExperienceSurcharge: 0,
        peakSeasonSurcharge: 0,
        total,
      };
    }
    const guests = Math.min(CHARTER_MAX_PASSENGERS, Math.max(CHARTER_MIN_PASSENGERS, Number(bookingData.passengerCount) || 1));
    const ticketPrice = sharedTourPerPerson;
    const total = Number((guests * ticketPrice).toFixed(2));
    return {
      basePrice: total,
      captainFee: 0,
      deposit: 0,
      weekendSurcharge: 0,
      rocketLaunchSurcharge: 0,
      bioTourSurcharge: 0,
      sunsetExperienceSurcharge: 0,
      nightExperienceSurcharge: 0,
      peakSeasonSurcharge: 0,
      total,
    };
  };

  const pricing = bookingMode === 'rental' ? calculateRentalPricing() : calculateCharterPricing();
  const normalizedPromoInput = promoCodeInput.trim().toUpperCase();
  const appliedPromo =
    promoValidation && promoValidation.promoCode === normalizedPromoInput ? promoValidation : null;
  const securityDepositAmount = bookingMode === 'rental' ? Number(pricing.deposit || 0) : 0;
  const discountableSubtotal = Number((pricing.total - securityDepositAmount).toFixed(2));
  const originalTotal = pricing.total;
  const reservationTotal = appliedPromo ? appliedPromo.finalTotal : pricing.total;
  const promoDiscountAmount = appliedPromo ? appliedPromo.discountAmount : 0;
  const amountDueToday =
    bookingMode === 'rental'
      ? Number((reservationTotal * 0.5).toFixed(2))
      : reservationTotal;
  const balanceBeforePickup = Number((reservationTotal - amountDueToday).toFixed(2));
  const checkoutRequirementsMet = waiverFormComplete(
    waiverData,
    termsAccepted,
    damageFeeAcknowledged,
    bookingMode
  );
  const licensePreviewUrl = verificationData.licenseProofUrl.trim();
  const insurancePreviewUrl = verificationData.insuranceProofUrl.trim();
  const rentalInsuranceMissing = bookingMode === 'rental' && !insurancePreviewUrl;
  const charterNeedsBoatSelection = false;
  const charterPd =
    isBioPackageFlow && selectedBioPackage
      ? {
          primary: `${selectedBioPackage.cardTitle} — $${(bioFourCheckoutDisplay?.totalUsd ?? selectedBioPackage.directPriceUsd).toFixed(2)}`,
          sub: `${bioFourCheckoutDisplay ? bioFourCheckoutDisplay.guestCount : selectedBioPackage.guestCount} guest${
            (bioFourCheckoutDisplay ? bioFourCheckoutDisplay.guestCount : selectedBioPackage.guestCount) === 1 ? '' : 's'
          } · ${formatCharterDurationLabel(selectedBioPackage.durationMinutes)} · $${
            bioFourCheckoutDisplay ? bioFourCheckoutDisplay.perGuestUsdLabel : selectedBioPackage.perGuestUsd.toFixed(2)
          } per guest`,
        }
      : isRocketPackageFlow && selectedRocketPackage
        ? {
            primary: `${selectedRocketPackage.cardTitle} — $${selectedRocketPackage.directPriceUsd.toFixed(2)}`,
            sub:
              selectedRocketPackage.id === 'rocket_private'
                ? `Up to ${selectedRocketPackage.maxGuests ?? 5} guests · private charter · ${formatCharterDurationLabel(selectedRocketPackage.durationMinutes)}`
                : `${selectedRocketPackage.guestCount} guest${selectedRocketPackage.guestCount === 1 ? '' : 's'} · shared charter · ${formatCharterDurationLabel(selectedRocketPackage.durationMinutes)}`,
          }
      : isSunsetPackageFlow && selectedSunsetPackage
        ? {
            primary: `${selectedSunsetPackage.cardTitle} — $${selectedSunsetPackage.directPriceUsd.toFixed(2)}`,
            sub:
              selectedSunsetPackage.seating === 'private'
                ? `Up to ${selectedSunsetPackage.maxGuests ?? 5} guests · private charter · ${formatCharterDurationLabel(selectedSunsetPackage.durationMinutes)}`
                : `${selectedSunsetPackage.guestCount} guest${selectedSunsetPackage.guestCount === 1 ? '' : 's'} · shared charter · ${formatCharterDurationLabel(selectedSunsetPackage.durationMinutes)}`,
          }
        : isSharedTour
        ? {
            primary: `$${sharedTourPerPerson} per person`,
            sub: `Full charter total: $${pricing.total.toFixed(2)}`,
          }
        : charterNeedsBoatSelection
          ? {
              primary: 'Starting rates available',
              sub: 'Select a boat to see final total before checkout',
            }
          : {
              primary: `$${sharedTourPerPerson} per person`,
              sub: `Estimated total for selected guests: $${pricing.total.toFixed(2)}`,
            };
  const charterTimeOptions = isBioCharter
    ? BIO_NIGHT_CHARTER_TIMES
    : isSunsetPackageFlow
      ? Array.from(
          new Set(
            [
              ...DEFAULT_CHARTER_TIMES,
              '18:30',
              ...timeSlots.map((slot) => slot.startHHMM).filter(Boolean),
            ].filter(Boolean) as string[]
          )
        ).sort()
      : DEFAULT_CHARTER_TIMES;
  const selectedStartDateTime = buildSelectedStartDateTime({
    slotStartIso: bookingData.slotStartIso,
    date: bookingData.date,
    time: bookingData.time,
    bookingMode,
    charterType: bookingData.charterType,
  });
  const selectedDateTimeLabel =
    bookingData.slotStartIso && Number.isFinite(selectedStartDateTime.getTime())
      ? selectedStartDateTime.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : isBioCharter && isNextMorningNightCharterStart(bookingData.charterType, bookingData.time)
        ? `${bookingData.date} night · ${timeLabelFromHHMM(bookingData.time)} next morning`
        : `${bookingData.date || '-'} · ${timeLabelFromHHMM(bookingData.time)}`;

  /** Dark-theme fields — `.lz-input-on-dark` in index.css sets value/placeholder/autofill/time contrast */
  const fieldClass =
    'lz-input-on-dark w-full rounded-xl border border-white/15 bg-slate-950/85 px-4 py-3 text-sm shadow-inner focus:border-[var(--lz-cta)]/55 focus:outline-none focus:ring-2 focus:ring-[var(--lz-cta)]/20';

  /** Unified spacing + surfaces (styling only) */
  const bookingSectionTitle = 'mt-8 text-sm font-bold uppercase tracking-[0.18em] text-cyan-200/90 md:mt-10';
  const bookingCard =
    'rounded-xl border border-white/10 bg-slate-950/50 p-4 shadow-[0_0_28px_rgba(0,0,0,0.2)] md:p-5';
  const bookingChoiceActive =
    'border-[var(--lz-cta)] bg-[rgba(255,140,43,0.14)] text-white shadow-[0_0_18px_rgba(255,140,43,0.22)]';
  const bookingChoiceIdle =
    'border-white/15 bg-slate-950/55 text-slate-100 hover:border-[var(--lz-cta)]/35 hover:bg-slate-900/55';
  const bookingSlotChipActive =
    'border-[var(--lz-cta)] bg-[rgba(255,140,43,0.14)] text-white shadow-[0_0_16px_rgba(255,140,43,0.2)]';
  const bookingSlotChipRecommended =
    'border-cyan-400/35 bg-cyan-950/45 text-cyan-50 hover:border-cyan-300/55';
  const bookingPrimaryCta =
    'lz-btn-primary min-h-[48px] w-full justify-center px-5 py-3.5 text-base font-semibold uppercase tracking-[0.12em] shadow-lg shadow-black/25 transition-transform duration-200 hover:brightness-105 disabled:pointer-events-none disabled:opacity-40';
  const bookingSecondaryCta =
    'lz-btn-secondary min-h-[48px] w-full justify-center px-5 py-3.5 text-sm font-semibold uppercase tracking-[0.1em]';

  useEffect(() => {
    setPromoValidation(null);
    setPromoMessage(null);
  }, [
    bookingMode,
    bookingData.rentalType,
    bookingData.captainIncluded,
    bookingData.charterVariant,
    normalizedPromoInput,
    discountableSubtotal,
    originalTotal,
    rentalLocation,
    selectedBoat?.name,
    selectedBoat?.type,
  ]);

  const handleApplyPromo = async () => {
    const code = normalizedPromoInput;
    setPromoValidation(null);
    setPromoMessage(null);
    if (!code) {
      setPromoMessage({ variant: 'error', text: 'Enter a promo code first.' });
      return;
    }
    if (!env.apiUrlConfigured || !env.apiUrl) {
      setPromoMessage({ variant: 'error', text: 'Promo validation is not available right now.' });
      return;
    }
    setPromoApplying(true);
    try {
      const promoPayload = {
        code,
        bookingType:
          bookingMode === 'charter' && bookingData.charterVariant === 'private' ? 'private' : bookingMode,
        rentalLocation,
        boatName: selectedBoat?.name || '',
        durationHours: bookingData.hours,
        subtotal: discountableSubtotal,
        securityDeposit: securityDepositAmount,
        rentalType: bookingData.rentalType,
        boatType: selectedBoat?.type === 'premium' ? 'premium' : 'standard',
        captainIncluded: bookingMode === 'rental' ? bookingData.captainIncluded : true,
        charterVariant: bookingMode === 'charter' ? bookingData.charterVariant : null,
      };
      if (import.meta.env.DEV) {
        console.info('[promo-validate] payload', promoPayload);
      }
      const res = await fetch(`${env.apiUrl}/api/promo/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(promoPayload),
      });
      const payload = (await res.json().catch(() => ({}))) as Partial<PromoValidationResult> & {
        error?: string;
        reasonCode?: string;
      };
      if (import.meta.env.DEV) {
        console.info('[promo-validate] result', payload);
        if (!res.ok) console.info('[promo-validate] reason', payload.reasonCode || 'server_validation_failed');
      }
      if (!res.ok || !payload.promoCode) {
        setPromoMessage({ variant: 'error', text: payload.error || 'Promo code could not be applied.' });
        return;
      }
      const nextPromo: PromoValidationResult = {
        promoCode: payload.promoCode,
        originalSubtotal: Number(payload.originalSubtotal || discountableSubtotal),
        finalSubtotal: Number(payload.finalSubtotal || discountableSubtotal),
        securityDeposit: Number(payload.securityDeposit || securityDepositAmount),
        originalTotal: Number(payload.originalTotal || originalTotal),
        discountAmount: Number(payload.discountAmount || 0),
        finalTotal: Number(payload.finalTotal || originalTotal),
        description: payload.description || null,
      };
      setPromoValidation(nextPromo);
      setPromoMessage({
        variant: 'success',
        text: `Promo ${nextPromo.promoCode} applied: -$${nextPromo.discountAmount.toFixed(2)}`,
      });
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[promo-validate]', err);
      setPromoMessage({ variant: 'error', text: 'Could not validate promo code. Please try again.' });
    } finally {
      setPromoApplying(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const checkoutPerf = beginAsyncInteraction('checkout_submit');

    if (bookingMode === 'rental' && !selectedBoat) {
      alert('Please select a boat.');
      checkoutPerf.end('aborted_no_boat');
      return;
    }
    if (bookingMode === 'charter' && !bookingData.date) {
      setCheckoutError('Choose your date.');
      checkoutPerf.end('aborted_no_date');
      return;
    }
    if (bookingMode === 'charter' && !bookingData.time && !bookingData.slotStartIso) {
      setCheckoutError(isRocketCharter ? 'Choose a scheduled rocket launch.' : 'Choose your time.');
      checkoutPerf.end('aborted_no_time');
      return;
    }
    if (isRocketCharter && !bookingData.launchId) {
      setCheckoutError('Choose a scheduled rocket launch to continue.');
      checkoutPerf.end('aborted_no_launch');
      return;
    }
    if (bookingMode === 'charter') {
      const passengerValidation = validateCharterPassengerCount(bookingData.passengerCount);
      if (!passengerValidation.valid) {
        setCheckoutError(passengerValidation.error);
        checkoutPerf.end('aborted_guest_count');
        return;
      }
    }
    if (isBioPackageFlow && !bioPackageId) {
      setCheckoutError('Choose a bioluminescence package to continue.');
      checkoutPerf.end('aborted_bio_package');
      return;
    }
    if (isRocketPackageFlow && !rocketPackageId) {
      setCheckoutError('Choose a rocket launch package to continue.');
      checkoutPerf.end('aborted_rocket_package');
      return;
    }
    if (isSunsetPackageFlow && !sunsetPackageId) {
      setCheckoutError('Choose a sunset package to continue.');
      checkoutPerf.end('aborted_sunset_package');
      return;
    }
    if ((isBioPackageFlow || isRocketPackageFlow || isSunsetPackageFlow) && normalizedPromoInput) {
      setCheckoutError('Promo codes cannot be applied to direct package charter bookings.');
      checkoutPerf.end('aborted_package_promo');
      return;
    }
    if (requiresRocketSharedAck && !rocketSharedMinimumAcknowledged) {
      setCheckoutError('Please acknowledge the shared charter minimum guest policy before payment.');
      checkoutPerf.end('aborted_rocket_shared_ack');
      return;
    }
    if (!bookingData.date || !bookingData.fullName || !bookingData.email || !bookingData.phone) {
      alert('Please complete your contact information and trip date.');
      checkoutPerf.end('aborted_form_incomplete');
      return;
    }

    if (bookingMode === 'charter' && sharedTourOverLimit) {
      setCheckoutError(
        `Charter bookings are limited to ${CHARTER_MAX_PASSENGERS} passengers per reservation.`
      );
      checkoutPerf.end('aborted_shared_limit');
      return;
    }

    const licenseUrl = bookingMode === 'rental' ? verificationData.licenseProofUrl.trim() : '';
    const insuranceUrl = bookingMode === 'rental' ? verificationData.insuranceProofUrl.trim() : '';
    setCheckoutError(null);

    if (!checkoutRequirementsMet) {
      setCheckoutError(
        bookingMode === 'rental'
          ? 'Please accept Terms, accept the waiver, acknowledge financial responsibility, and provide your signature before payment.'
          : 'Please accept Terms, accept the waiver, and provide your signature before payment.'
      );
      checkoutPerf.end('aborted_missing_required_ack');
      return;
    }

    if (normalizedPromoInput && !appliedPromo) {
      setCheckoutError('Please apply your promo code or clear it before checkout.');
      checkoutPerf.end('aborted_promo_not_applied');
      return;
    }

    setProcessing(true);

    let checkoutOutcome = 'completed';

    try {
      if (!env.apiUrlConfigured || !env.apiUrl) {
        setCheckoutError(
          'Online checkout is not available right now (API URL missing). Please call us to complete your booking.'
        );
        setProcessing(false);
        checkoutOutcome = 'aborted_no_api_url';
        return;
      }
      const startDateTime = buildSelectedStartDateTime({
        slotStartIso: bookingData.slotStartIso,
        date: bookingData.date,
        time: bookingData.time,
        bookingMode,
        charterType: bookingData.charterType,
      });
      if (!Number.isFinite(startDateTime.getTime())) {
        throw new Error('Choose a valid date and start time.');
      }
      const endDateTime = new Date(
        startDateTime.getTime() + (bookingMode === 'charter' ? 1 : bookingData.hours) * 60 * 60 * 1000
      );
      const apiBase = env.apiUrl;
      const depositAmount = amountDueToday;
      const depositCents = Math.round(depositAmount * 100);
      if (!Number.isFinite(depositAmount) || depositCents < 50) {
        throw new Error(
          'Checkout amount is too small for online checkout (minimum about $0.50). Please adjust your booking or call 803-542-1761.'
        );
      }

      let sessionRes: Response;
      try {
        checkoutPerf.markNetworkStart();
        sessionRes = await fetch(`${apiBase}/api/create-checkout-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer: {
              full_name: bookingData.fullName,
              email: bookingData.email,
              phone: bookingData.phone,
              id_document_url: licenseUrl || null,
              insurance_proof_url: insuranceUrl || null,
              sms_opt_in: false,
            },
            booking: {
              boat_id: bookingMode === 'charter' ? null : selectedBoat?.id,
              boatName: bookingMode === 'charter' ? null : selectedBoat?.name,
              start_time: startDateTime.toISOString(),
              end_time: endDateTime.toISOString(),
              duration_hours: bookingMode === 'charter' ? 1 : bookingData.hours,
              rental_type: bookingData.rentalType,
              captain_included: bookingMode === 'charter' ? true : bookingData.captainIncluded,
              captain_fee: bookingMode === 'charter' ? 0 : pricing.captainFee,
              base_price: pricing.basePrice,
              peak_surcharge: 0,
              security_deposit: bookingMode === 'charter' ? 0 : pricing.deposit,
              total_price: reservationTotal,
              deposit_amount: depositAmount,
              balance_due: reservationTotal - depositAmount,
              rentalLocation,
              promoCode: appliedPromo ? appliedPromo.promoCode : null,
              discountAmount: appliedPromo ? appliedPromo.discountAmount : null,
              originalTotal: appliedPromo ? appliedPromo.originalTotal : null,
              finalTotal: appliedPromo ? appliedPromo.finalTotal : reservationTotal,
              is_night_tour:
                bookingMode === 'charter' ? bookingData.charterType === 'night_bio' : false,
              is_rocket_tour:
                bookingMode === 'charter' ? bookingData.charterType === 'rocket_launch' : false,
              bookingMode: bookingMode,
              charterType:
                bookingMode === 'charter'
                  ? bookingData.charterType === 'night_bio'
                    ? 'bio'
                    : bookingData.charterType === 'sunset_cruise'
                      ? 'sunset'
                      : 'rocket'
                  : null,
              charterVariant:
                bookingMode === 'charter'
                  ? isRocketPackageFlow && selectedRocketPackage
                    ? selectedRocketPackage.seating === 'private'
                      ? 'private'
                      : 'shared'
                    : isSunsetPackageFlow && selectedSunsetPackage
                      ? selectedSunsetPackage.seating === 'private'
                        ? 'private'
                        : 'shared'
                      : isBioPackageFlow
                        ? 'shared'
                        : bookingData.charterVariant
                  : null,
              passengerCount:
                bookingMode === 'charter'
                  ? Math.min(CHARTER_MAX_PASSENGERS, Math.max(CHARTER_MIN_PASSENGERS, Number(bookingData.passengerCount) || 1))
                  : 1,
              fifthPassengerAddon: Boolean(
                isBioPackageFlow && bioFourAddonEligible && bioFifthPassengerAddon
              ),
              guest_count:
                bookingMode === 'charter'
                  ? Math.min(CHARTER_MAX_PASSENGERS, Math.max(CHARTER_MIN_PASSENGERS, Number(bookingData.passengerCount) || 1))
                  : 1,
              pricingPackageId:
                isBioPackageFlow && bioPackageId
                  ? bioPackageId
                  : isRocketPackageFlow && rocketPackageId
                    ? rocketPackageId
                    : isSunsetPackageFlow && sunsetPackageId
                      ? sunsetPackageId
                      : null,
              sharedCharterMinimumAcknowledged: requiresRocketSharedAck
                ? rocketSharedMinimumAcknowledged
                : null,
              launchId: isRocketCharter ? bookingData.launchId || null : null,
              external_reference: isRocketCharter && bookingData.launchId
                ? `ll2:${bookingData.launchId}`
                : null,
              special_requests:
                bookingMode === 'charter'
                  ? `${bookingData.charterRequestOnly ? '[REQUEST_ONLY] ' : ''}${bookingData.specialRequests || ''}`.trim()
                  : bookingData.specialRequests,
              license_status: 'pending',
              insurance_status: 'pending',
              license_url: bookingMode === 'charter' ? null : licenseUrl || null,
              insurance_url: bookingMode === 'charter' ? null : insuranceUrl || null,
            },
            waiver: {
              agreed: waiverData.agreed,
              signature: waiverData.signature.trim(),
              accepted: checkoutRequirementsMet,
            },
            legal: {
              termsAccepted,
              ...(bookingMode === 'rental' ? { damageFeeAcknowledged } : {}),
              sharedCharterMinimumAcknowledged: requiresRocketSharedAck
                ? rocketSharedMinimumAcknowledged
                : undefined,
            },
          }),
        });
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[create-checkout-session] network', err);
        }
        const isNetwork =
          err instanceof TypeError ||
          (err instanceof Error && /fetch|network|failed to load|load failed/i.test(err.message));
        throw new Error(
          isNetwork
            ? `Could not reach the booking server at ${apiBase}. If you are on the live site, confirm VITE_API_URL points to your API and CORS allows this origin. Otherwise try again or call 803-542-1761.`
            : 'Could not start payment. Please try again or call 803-542-1761.'
        );
      }

      const rawBody = await sessionRes.text();
      let sessionPayload: {
        url?: string;
        error?: string;
        message?: string;
        code?: string;
        alternatives?: Array<Partial<ApiTimeSlot> & { startIso?: string; endIso?: string }>;
      } = {};
      try {
        sessionPayload = rawBody ? (JSON.parse(rawBody) as typeof sessionPayload) : {};
      } catch {
        sessionPayload = {};
      }

      if (sessionRes.ok && sessionPayload.url) {
        checkoutOutcome = 'redirect_stripe';
        window.location.href = sessionPayload.url;
        return;
      }

      const apiMessage =
        (typeof sessionPayload.error === 'string' && sessionPayload.error.trim()) ||
        (typeof sessionPayload.message === 'string' && sessionPayload.message.trim()) ||
        '';

      if (import.meta.env.DEV) {
        console.warn('[create-checkout-session]', sessionRes.status, sessionPayload, rawBody.slice(0, 500));
      }

      const alternatives = normalizeApiTimeSlots(sessionPayload.alternatives);
      if (alternatives.length > 0 && (sessionRes.status === 409 || sessionPayload.code === 'slot_unavailable')) {
        setSlotAlternatives(alternatives);
        setTimeSlots((prev) => {
          const seen = new Set(prev.map((slot) => slot.start));
          const merged = [...prev];
          for (const slot of alternatives) {
            if (!seen.has(slot.start)) {
              seen.add(slot.start);
              merged.push(slot);
            }
          }
          return merged;
        });
        setCheckoutError('That departure was just booked.');
        checkoutOutcome = 'slot_taken_alternatives';
        return;
      }

      if (apiMessage) {
        if (import.meta.env.DEV) {
          console.warn('[create-checkout-session] API error:', apiMessage);
        }
        if (sessionPayload.code === 'bio_package_pricing_unavailable') {
          throw new Error(
            apiMessage ||
              'Direct package booking is temporarily unavailable. Please call 803-542-1761 or remove the package from the URL and book using standard pricing.'
          );
        }
        const lower = apiMessage.toLowerCase();
        if (lower.includes('stripe not configured')) {
          throw new Error(
            'Online payment is not set up on the server yet. Please call 803-542-1761 to complete your booking.'
          );
        }
        if (lower.includes('server not configured')) {
          throw new Error(
            'The booking service is temporarily unavailable. Please call 803-542-1761 or try again later.'
          );
        }
        throw new Error(apiMessage);
      }

      throw new Error(
        `Could not start payment (${sessionRes.status}). Please try again or call 803-542-1761.`
      );
    } catch (error) {
      checkoutOutcome = 'error';
      if (import.meta.env.DEV) {
        console.error('Booking error:', error);
      }
      const msg =
        error && typeof error === 'object' && 'code' in error
          ? userFacingSupabaseMessage(error as PostgrestError)
          : error instanceof Error
            ? error.message
            : 'There was an error processing your booking. Please try again or call us at 803-542-1761.';
      setCheckoutError(msg);
    } finally {
      setProcessing(false);
      checkoutPerf.end(checkoutOutcome);
    }
  };

  const bestLaunchDayToBook = useMemo(
    () => pickBestLaunchDayIso(conditionsByDate, availabilityByDate, todayYmdLocal),
    [conditionsByDate, availabilityByDate, todayYmdLocal]
  );
  const bestConditionsDay = useMemo(
    () => pickTopPickIso(conditionsByDate, availabilityByDate, todayYmdLocal),
    [conditionsByDate, availabilityByDate, todayYmdLocal]
  );

  const bestDayToBook = bestLaunchDayToBook ?? bestConditionsDay;
  const bestDayToBookText = bestDayToBook
    ? new Date(`${bestDayToBook.iso}T12:00:00`).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : null;

  const bestLaunchInsightReason = bestDayToBook
    ? conditionsByDate.get(bestDayToBook.iso)?.insightReason ?? null
    : null;

  const calendarAvailabilityLegend = (
    <p className="mt-1 text-xs text-slate-500">
      <span className="mr-2 inline-flex items-center gap-1">
        <span className="text-[var(--lz-cta)]">🚀</span> Launch
      </span>
      <span className="mr-2 inline-flex items-center gap-1">
        <span className="text-amber-300">⚠️</span> Caution
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="text-slate-500">✖</span> Booked
      </span>
    </p>
  );

  const renderCalendarDayButton = ({
    iso,
    label,
    keyValue,
    trackEvent,
  }: {
    iso: string;
    label: number;
    keyValue: string;
    trackEvent?: string;
  }) => {
    const past = iso < todayYmdLocal;
    const calKnown = availabilityByDate.size > 0;
    const dayAvail = availabilityByDate.get(iso);
    const open = calKnown
      ? typeof dayAvail === 'boolean'
        ? dayAvail === true
        : dayAvail?.available === true
      : null;
    const full = calKnown && isDayMarkedUnavailable(availabilityByDate, iso);
    const showOneLeft =
      !past &&
      !full &&
      calKnown &&
      typeof dayAvail === 'object' &&
      dayAvail !== null &&
      dayAvail.available === true &&
      dayAvail.boatsRemaining === 1 &&
      (dayAvail.totalBoats ?? 0) > 1;
    const wd = new Date(`${iso}T12:00:00`).getDay();
    const limited = open === true && (wd === 0 || wd === 5 || wd === 6);
    const selected = bookingData.date === iso;
    const insight = conditionsByDate.get(iso);
    const isTopPick = Boolean(bestDayToBook && bestDayToBook.iso === iso && insight);
    const lines = insight
      ? buildTileLines(insight.weather, insight.launch, { isTopPick })
      : { line1: '', line2: '' };

    let ring = 'border-white/10 bg-slate-900/60 text-slate-200 hover:border-cyan-400/30';
    if (past) ring = 'cursor-not-allowed border-transparent bg-slate-950/30 text-slate-600';
    else if (full) ring = 'cursor-not-allowed border-transparent bg-slate-950/30 text-slate-600';
    else if (insight?.tier === 'best')
      ring =
        'border-[var(--lz-cta)]/45 bg-[rgba(255,140,43,0.12)] text-white hover:border-[var(--lz-cta)]/60';
    else if (insight?.tier === 'poor')
      ring = 'border-amber-400/40 bg-amber-950/25 text-amber-100 hover:border-amber-400/60';
    else if (insight?.tier === 'good')
      ring = 'border-emerald-500/35 bg-emerald-950/20 text-emerald-50 hover:border-emerald-400/50';
    else if (limited)
      ring = 'border-amber-400/40 bg-amber-950/25 text-amber-100 hover:border-amber-400/60';
    else if (open === true)
      ring = 'border-emerald-500/35 bg-emerald-950/20 text-emerald-50 hover:border-emerald-400/50';
    if (selected && !past && !full) {
      ring += ' ring-2 ring-[var(--lz-cta)] ring-offset-2 ring-offset-[#050a14]';
    }

    return (
      <button
        key={keyValue}
        type="button"
        disabled={past || Boolean(full)}
        onClick={() => {
          if (past || full) return;
          const t0 = performance.now();
          setBookingData((prev) => ({
            ...prev,
            date: iso,
            slotStartIso: '',
          }));
          if (trackEvent) {
            measurePaintAfterSync(trackEvent, t0, performance.now());
          }
        }}
        className={`flex aspect-square min-h-[2.25rem] flex-col items-center justify-center gap-0.5 rounded-lg border px-0.5 text-xs font-semibold transition ${ring}`}
      >
        <span>{label}</span>
        {!past && !full && insight && (
          <>
            <span className="max-w-full truncate text-center text-[8px] font-normal leading-tight text-slate-300">
              {lines.line1}
            </span>
            <span className="max-w-full truncate text-center text-[8px] font-normal leading-tight text-slate-400">
              {lines.line2}
            </span>
            <span className="text-[7px] font-normal leading-none text-slate-500">
              {typeof insight.score === 'number' && Number.isFinite(insight.score)
                ? insight.score.toFixed(1)
                : '—'}
              /10
            </span>
          </>
        )}
        {!past && !full && !insight && limited && (
          <span className="text-[8px] leading-none text-amber-300">⚠️</span>
        )}
        {!past && !full && showOneLeft && (
          <span className="text-[7px] font-medium leading-none text-amber-200/90">1 left</span>
        )}
        {!past && full && <span className="text-[8px] leading-none text-slate-500">Booked</span>}
      </button>
    );
  };

  const charterTimesFromApi =
    bookingMode === 'charter' && apiAvailEnabled && !availTimesLoading && !timesManualFallback;
  const availableCharterTimes = new Set(timeSlots.map((slot) => slot.startHHMM));
  const selectedRocketDepartureLabel = (() => {
    if (!isRocketPackageFlow) return null;
    const slot =
      timeSlots.find((s) => s.start && bookingData.slotStartIso && s.start === bookingData.slotStartIso) ||
      timeSlots.find((s) => s.startHHMM && s.startHHMM === bookingData.time);
    return slot?.rocketDepartureLabel || null;
  })();

  const urgencyHint =
    bookingMode === 'charter' &&
    bookingData.date &&
    apiAvailEnabled &&
    timeSlots.length > 0 &&
    timeSlots.length <= 4
      ? `Only ${timeSlots.length} start time${timeSlots.length === 1 ? '' : 's'} left this day`
      : bookingMode === 'charter' &&
          bookingData.charterType === 'night_bio' &&
          bookingData.date &&
          (() => {
            const mo = parseInt(bookingData.date.slice(5, 7), 10);
            return mo >= 6 && mo <= 9;
          })()
        ? 'Popular season for bioluminescence · book ahead'
        : null;

  const bookingModeFromUrl = searchParams.get('bookingMode');
  const showNeutralChooser = step === 0 && bookingModeFromUrl === null;
  const productBookingTitle = useMemo(
    () => bookingPageTitleFromSearchParams(searchParams),
    [searchParams]
  );
  const directProductBooking = hasProductBookingContext(searchParams);
  const pageHeroTitle =
    productBookingTitle ??
    (showNeutralChooser ? 'What would you like to book?' : 'Book your adventure');

  if (missingRequiredDirectPackage && requiredDirectExperience) {
    const chooser = new URLSearchParams();
    chooser.set('experience', requiredDirectExperience);
    const dateParam = searchParams.get('date');
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) chooser.set('date', dateParam);
    return <Navigate to={`${DIRECT_DEALS_PATH}?${chooser.toString()}`} replace />;
  }

  return (
    <div
      className={`relative min-h-screen ${bookingMode === 'charter' && step > 0 ? 'pb-36 lg:pb-24' : 'pb-20'}`}
    >
      <section className="lz-page-hero py-14 md:py-20">
        <div className="relative z-[1] mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          <Calendar className="mx-auto mb-4 h-12 w-12 text-cyan-300/90 md:h-14 md:w-14" aria-hidden />
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/90">
            {showNeutralChooser
              ? 'Charters & boat rentals'
              : bookingMode === 'charter'
                ? 'Book a captain-led charter'
                : 'Reserve your self-drive rental'}
          </p>
          <h1 className="lz-page-hero-heading font-display text-white">{pageHeroTitle}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-300 md:text-lg">
            {showNeutralChooser
              ? 'Choose a captain-led charter or a self-drive rental. Charters: pick date, time, and guest count — we assign the vessel. Rentals: pick your boat and schedule. Pricing and requirements differ by path.'
              : bookingMode === 'charter'
                ? 'Choose date, time, and guest count, then check out. We assign your vessel — captain & fuel included; no security deposit.'
                : 'Pick your boat and schedule, add options, then check out with Stripe: today you pay 50% of your reservation total (which includes the refundable $300 security deposit). After checkout we verify compliance details and approvals.'}
          </p>
          {!directProductBooking ? (
            <p className="mx-auto mt-3 max-w-2xl text-xs leading-snug text-slate-500 md:text-sm">
              <Sparkles className="mr-1 inline-block h-3.5 w-3.5 text-cyan-400/80" aria-hidden />
              Rocket-launch and weekend dates are popular — book early when you can.
            </p>
          ) : null}
        </div>
      </section>

      <div className="relative z-[1] -mt-2 px-4 sm:px-6 lg:px-8">
        <div
          className={
            bookingMode === 'charter' && !showNeutralChooser
              ? 'mx-auto grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)] lg:items-start'
              : 'mx-auto max-w-4xl'
          }
        >
          <div className="min-w-0">
          <div
            className="lz-card-glass mb-6 rounded-[var(--lz-radius-card)] border border-cyan-400/20 px-4 py-3 text-sm text-slate-200"
            role="status"
          >
            <p className="font-semibold text-cyan-100">
              {showNeutralChooser
                ? 'Before you book'
                : bookingMode === 'charter'
                  ? 'Charter checkout notice'
                  : 'Verification notice'}
            </p>
            <p className="mt-1 text-slate-300">
              {showNeutralChooser
                ? 'Captain-led charters include fuel and a licensed captain (pay in full; no security deposit). Self-drive rentals pay 50% of the trip at checkout plus a refundable $300 security deposit (included in your reservation total), with waiver and verification steps.'
                : bookingMode === 'charter'
                  ? 'Captain & fuel included · No security deposit. No license or insurance upload required.'
                  : 'Complete waiver, insurance, and license verification for approval. You can submit now. Missing items route your reservation to staff review.'}
            </p>
          </div>

          {showNeutralChooser ? (
            <div className="lz-card-glass mb-6 rounded-[var(--lz-radius-card)] border border-cyan-400/25 bg-cyan-950/30 px-4 py-3 text-sm text-cyan-50">
              <p>
                Have a Groupon voucher?{' '}
                <Link
                  to="/booking/groupon"
                  className="font-semibold text-cyan-200 underline underline-offset-2"
                >
                  Redeem Groupon voucher
                </Link>{' '}
                — separate from direct checkout below.
              </p>
            </div>
          ) : directProductBooking ? (
            <p className="mb-6 text-center text-xs text-slate-500">
              Groupon voucher?{' '}
              <Link to="/booking/groupon" className="font-semibold text-cyan-400 underline underline-offset-2">
                Redeem here
              </Link>
            </p>
          ) : null}

          {step > 0 && (
            <BookingFlowStepIndicator
              currentStep={step as 1 | 2 | 3}
              flow={bookingMode === 'charter' ? 'charter' : 'rental'}
            />
          )}
          <p className="mt-3 text-center text-[11px] leading-snug text-slate-500 md:text-xs">
            {step === 0
              ? 'Pick an experience or self-drive rental to begin.'
              : step < 2
                ? 'Add trip details next.'
                : bookingMode === 'charter'
                  ? 'Charters are paid in full today. Captain & fuel included; no security deposit.'
                  : 'You pay 50% of your trip today (reservation total includes the refundable $300 security deposit). Remaining trip balance is due before or at pickup.'}
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-y border-white/10 py-3 text-[11px] text-slate-400 md:text-xs">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 shrink-0 text-cyan-400/70" aria-hidden />
              {showNeutralChooser
                ? 'Secure checkout · pricing shown upfront'
                : bookingMode === 'charter'
                  ? 'Secure booking · pay in full'
                  : 'Secure booking · Stripe checkout'}
            </span>
            <span className="hidden sm:inline text-white/20" aria-hidden>
              |
            </span>
            <span className="inline-flex items-center gap-1.5">
              <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-cyan-400/70" aria-hidden />
              {showNeutralChooser
                ? 'Charters or rentals · requirements differ'
                : bookingMode === 'charter'
                  ? 'Clear charter pricing · all-in total'
                  : 'Rates shown — no hidden boat fees'}
            </span>
            <span className="hidden md:inline text-white/20" aria-hidden>
              |
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 shrink-0 text-cyan-400/70" aria-hidden />
              {showNeutralChooser
                ? 'USCG-licensed captains on charters'
                : bookingMode === 'charter'
                  ? 'USCG captain included · guided experience'
                  : 'Licensed operator · USCG captains when added'}
            </span>
          </div>

          <div
            id="booking-form"
            ref={bookingFormRef}
            className="lz-card-glass mt-6 rounded-[var(--lz-radius-card)] p-6 text-slate-100 md:p-8"
          >
            {prefillNotice ? (
              <div className="mb-5 rounded-lg border border-cyan-400/30 bg-cyan-950/25 px-4 py-3 text-sm text-cyan-100">
                {prefillNotice}
              </div>
            ) : null}
            {step === 0 && (
              <div>
                <h2 className="font-display text-xl font-bold uppercase tracking-[0.14em] text-white md:text-2xl">
                  Choose your experience
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  Captain-led charters include fuel and a licensed captain. Self-drive rentals use a separate path.
                </p>
                <div className="mt-8 grid gap-4 sm:grid-cols-2 md:gap-5">
                  <button
                    type="button"
                    onClick={() => handleSelectCharterExperience('rocket_launch')}
                    className={`min-h-[120px] rounded-2xl border p-5 text-left transition active:scale-[0.99] md:p-6 ${bookingChoiceIdle}`}
                  >
                    <span className="text-2xl" aria-hidden>
                      🚀
                    </span>
                    <p className="mt-3 text-lg font-bold text-white">Rocket Launch Charter</p>
                    <p className="mt-2 text-sm text-slate-400">
                      On-water launch viewing · {formatCharterDurationLabel()} charter · typical 4-hour window
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectCharterExperience('night_bio')}
                    className={`min-h-[120px] rounded-2xl border p-5 text-left transition active:scale-[0.99] md:p-6 ${bookingChoiceIdle}`}
                  >
                    <span className="text-2xl" aria-hidden>
                      ✨
                    </span>
                    <p className="mt-3 text-lg font-bold text-white">Bioluminescence Tour</p>
                    <p className="mt-2 text-sm text-slate-400">
                      Night glow on the lagoon · {formatCharterDurationLabel()}
                    </p>
                    <p className="mt-2 text-xs font-semibold text-cyan-200/90">{BIO_DEPARTURE_AREA_LABEL}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectCharterExperience('sunset_cruise')}
                    className={`min-h-[120px] rounded-2xl border p-5 text-left transition active:scale-[0.99] md:p-6 ${bookingChoiceIdle}`}
                  >
                    <span className="text-2xl" aria-hidden>
                      🌅
                    </span>
                    <p className="mt-3 text-lg font-bold text-white">Sunset Cruise</p>
                    <p className="mt-2 text-sm text-slate-400">
                      Golden hour on the water · {formatCharterDurationLabel()}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBookingMode('rental');
                      setBookingData((prev) => ({ ...prev, captainIncluded: false }));
                      setStep(1);
                    }}
                    className={`min-h-[88px] rounded-2xl border border-dashed border-white/25 bg-slate-950/30 p-5 text-left transition hover:border-[var(--lz-cta)]/35 active:scale-[0.99] sm:col-span-2 md:p-6 ${bookingChoiceIdle}`}
                  >
                    <p className="text-lg font-bold text-white">Self-drive boat rental</p>
                    <p className="mt-2 text-sm text-slate-400">
                      Operate the vessel yourself · 50% trip deposit, $300 security deposit &amp; compliance required (no captain included by default).
                    </p>
                  </button>
                </div>
              </div>
            )}

            {step === 1 && (
              <div>
                <h2 className="font-display text-xl font-bold uppercase tracking-[0.14em] text-white md:text-2xl">
                  {bookingMode === 'charter' ? 'Charter details' : 'Booking details'}
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  {bookingMode === 'charter'
                    ? 'Choose date, time, and guest count for your charter. We assign your vessel — you do not pick a boat here.'
                    : 'Select a vessel, rental length, and when you want to go.'}
                </p>

                {bookingMode === 'charter' && (
                  <div
                    className={`${bookingCard} mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}
                  >
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300/90">
                        Your experience
                      </p>
                      <p className="mt-1 font-display text-xl font-bold text-white">{charterHeroTitle}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (requiredDirectExperience) {
                          navigate(DIRECT_DEALS_PATH);
                          return;
                        }
                        setStep(0);
                      }}
                      className="shrink-0 text-sm font-semibold text-cyan-400 underline decoration-cyan-500/30 hover:text-cyan-300"
                    >
                      Change
                    </button>
                  </div>
                )}

                {bookingMode === 'rental' && (
                  <>
                    <h3 className={`${bookingSectionTitle} mb-0`}>Choose your boat</h3>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      {boatsLoading && boats.length === 0 ? (
                        <div className="col-span-full flex min-h-[12rem] flex-col items-center justify-center gap-3 rounded-2xl border border-cyan-500/20 bg-slate-950/40 px-6 py-12">
                          <Spinner size="md" tone="onDark" />
                          <p className="text-sm text-slate-400">Loading vessels…</p>
                        </div>
                      ) : boatsError ? (
                        <div className="col-span-full rounded-2xl border border-red-400/35 bg-red-950/30 px-5 py-5">
                          <p className="font-semibold text-red-100">Could not load vessels</p>
                          <p className="mt-2 text-sm text-red-100/85">{boatsError}</p>
                          <button
                            type="button"
                            onClick={() => void loadBoats()}
                            className="mt-4 rounded-lg border border-red-400/40 bg-red-950/50 px-4 py-2 text-sm font-semibold text-red-50 hover:bg-red-950/70"
                          >
                            Try again
                          </button>
                        </div>
                      ) : boats.length === 0 ? (
                        <div className="col-span-full rounded-2xl border border-amber-400/30 bg-amber-950/20 px-5 py-8 text-center">
                          <p className="text-base font-semibold text-amber-50">No vessels available to book online</p>
                          <p className="mt-2 text-sm text-slate-300">
                            Our fleet list may be updating, or bookings are paused. Call{' '}
                            {env.contactPhone ? (
                              <a
                                href={`tel:${env.contactPhone.replace(/\D/g, '')}`}
                                className="font-semibold text-cyan-300 underline decoration-cyan-500/40"
                              >
                                {env.contactPhone}
                              </a>
                            ) : (
                              <span className="font-semibold text-slate-200">803-542-1761</span>
                            )}{' '}
                            and we&apos;ll help you book.
                          </p>
                        </div>
                      ) : (
                        boats.map((boat) => {
                      const isSelected = selectedBoat?.id === boat.id;
                      return (
                        <article
                          key={boat.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedBoat(boat)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedBoat(boat);
                            }
                          }}
                          className={`group cursor-pointer overflow-hidden rounded-2xl border bg-slate-950/45 outline-none transition-[transform,box-shadow,border-color] duration-200 ease-out will-change-transform focus-visible:ring-2 focus-visible:ring-lz-accent/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050a14] ${
                            isSelected
                              ? 'scale-[1.01] border-lz-accent/60 shadow-[0_0_45px_rgba(34,211,238,0.16)]'
                              : 'border-cyan-500/15 hover:-translate-y-0.5 hover:border-cyan-400/30 hover:shadow-[0_0_36px_rgba(34,211,238,0.1)]'
                          }`}
                        >
                          <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-900">
                            <SafeImage
                              src={boat.image_url || getBoatPlaceholderImage(boat.type)}
                              fallbackSrc={getBoatPlaceholderImage(boat.type)}
                              alt={`${boat.name}, booking card image`}
                              className="h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.02]"
                            />
                            <span
                              className={`absolute right-3 top-3 rounded-full px-3 py-1 text-xs font-bold ${
                                boat.type === 'premium' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-white'
                              }`}
                            >
                              {boat.type === 'premium' ? 'Premium' : 'Standard'}
                            </span>
                            {isSelected && (
                              <span className="absolute left-3 top-3 rounded-full border border-lz-accent/50 bg-black/50 px-3 py-1 text-xs font-semibold text-cyan-200 backdrop-blur-sm">
                                Selected
                              </span>
                            )}
                          </div>
                          <div className="border-t border-white/[0.06] p-5 md:p-6">
                            <h3 className="text-2xl font-bold text-white">{boat.name}</h3>
                            <p className="mt-3 leading-relaxed text-slate-400">
                              {boat.description ??
                                `${boat.type === 'premium' ? 'Premium' : 'Standard'} vessel, ideal for groups cruising the Space Coast waterways.`}
                            </p>
                            <div className="mt-4 flex items-center gap-2 text-sm text-slate-300">
                              <Users className="h-4 w-4 shrink-0" aria-hidden />
                              <span>Up to {boat.capacity} passengers</span>
                            </div>
                            <div className="mt-4 space-y-1.5 text-sm">
                              <div className="flex justify-between text-slate-400">
                                <span>Hourly</span>
                                <span className="font-semibold text-slate-200">${boat.hourly_rate}/hr</span>
                              </div>
                              <div className="flex justify-between text-slate-400">
                                <span>Half day</span>
                                <span className="font-semibold text-slate-200">${boat.half_day_rate}</span>
                              </div>
                              <div className="flex justify-between text-slate-400">
                                <span>Full day</span>
                                <span className="font-semibold text-slate-200">${boat.full_day_rate}</span>
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                        })
                      )}
                    </div>
                  </>
                )}

                {bookingMode === 'charter' ? (
                  <>
                    <h3 className={bookingSectionTitle}>Date &amp; start time</h3>
                    {calendarAvailabilityLegend}
                    <div
                      id="availability-calendar"
                      ref={availabilityCalendarRef}
                      className="mt-4 space-y-6 scroll-mt-24 md:space-y-8"
                    >
                      <div className={bookingCard}>
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-cyan-200/90">
                          {bestLaunchDayToBook ? 'Best Launch Day:' : 'Best Conditions This Week:'}{' '}
                          <span className="text-[var(--lz-cta)]">{bestDayToBookText ?? 'Checking schedule…'}</span>
                          {bestDayToBook && (
                            <>
                              {' — '}
                              <span className="text-slate-100">
                                {typeof bestDayToBook.score === 'number' && Number.isFinite(bestDayToBook.score)
                                  ? bestDayToBook.score.toFixed(1)
                                  : '—'}
                                /10
                              </span>
                            </>
                          )}
                        </p>
                        {bestLaunchInsightReason && (
                          <p className="mb-3 text-[11px] leading-snug text-slate-400">{bestLaunchInsightReason}</p>
                        )}
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            className="min-h-[44px] min-w-[44px] rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/5"
                            onClick={() =>
                              setCalendarMonth(
                                new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1)
                              )
                            }
                          >
                            ←
                          </button>
                          <p className="text-sm font-semibold text-white">
                            {calendarMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
                          </p>
                          <button
                            type="button"
                            className="min-h-[44px] min-w-[44px] rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/5"
                            onClick={() =>
                              setCalendarMonth(
                                new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1)
                              )
                            }
                          >
                            →
                          </button>
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
                            <div key={d}>{d}</div>
                          ))}
                        </div>
                        <div className="mt-2 grid grid-cols-7 gap-1">
                          {calendarCellsFor(calendarMonth).map((cell, idx) => {
                            if (cell.label === null) {
                              return <div key={`e-${idx}`} className="aspect-square min-h-[2.25rem]" />;
                            }
                            return renderCalendarDayButton({
                              iso: cell.iso as string,
                              label: cell.label,
                              keyValue: cell.iso as string,
                              trackEvent: 'booknow_charter_calendar_date',
                            });
                          })}
                        </div>
                        {availCalendarLoading && (
                          <p className="mt-2 text-xs text-slate-500">Updating availability…</p>
                        )}
                        {conditionsLoading && (
                          <p className="mt-1 text-xs text-slate-500">Checking forecast &amp; launches…</p>
                        )}
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                          {isRocketCharter ? 'Choose your launch' : 'Choose your time'}
                        </label>
                        {isBioCharter && (
                          <p className="mb-3 rounded-lg border border-cyan-400/25 bg-cyan-950/25 px-3 py-2 text-xs font-semibold text-cyan-100">
                            Late-night bio tours are available during peak glowing conditions. Times after midnight are booked as the next morning for the selected night.
                          </p>
                        )}
                        {isBioCharter ? <BioBookingHelp /> : null}
                        {isRocketCharter && (
                          <p className="mb-3 rounded-lg border border-amber-400/25 bg-amber-950/25 px-3 py-2 text-xs font-semibold text-amber-100">
                            Charter departure is scheduled from the actual launch time — morning, afternoon, evening, and overnight launches each get an appropriate on-water window.
                          </p>
                        )}
                        {isRocketCharter ? (
                          <div className="space-y-3">
                            {availTimesLoading ? (
                              <p className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                                Looking up launches for this date…
                              </p>
                            ) : null}
                            {timeSlots.map((slot) => {
                              const active =
                                Boolean(bookingData.slotStartIso && slot.start === bookingData.slotStartIso) ||
                                Boolean(bookingData.launchId && slot.launchId === bookingData.launchId);
                              return (
                                <button
                                  key={slot.launchId || slot.start}
                                  type="button"
                                  onClick={() => {
                                    setBookingData({
                                      ...bookingData,
                                      slotStartIso: slot.start,
                                      time: slot.startHHMM || bookingData.time,
                                      launchId: slot.launchId || '',
                                    });
                                  }}
                                  className={`w-full rounded-xl border px-4 py-4 text-left transition ${
                                    active ? bookingSlotChipActive : `border ${bookingChoiceIdle}`
                                  }`}
                                >
                                  <p className="text-sm font-bold text-white">
                                    {slot.launchName || 'Rocket launch'}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-400">
                                    {slot.launchDateLabel || bookingData.date}
                                  </p>
                                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                    <div className="rounded-lg bg-slate-950/50 px-3 py-2">
                                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                        Launch time
                                      </p>
                                      <p className="mt-1 text-sm font-semibold text-cyan-100">
                                        {slot.launchTimeLabel || 'TBD'}
                                      </p>
                                    </div>
                                    <div className="rounded-lg bg-slate-950/50 px-3 py-2">
                                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                        Charter departure
                                      </p>
                                      <p className="mt-1 text-sm font-semibold text-amber-100">
                                        {slot.label || timeLabelFromHHMM(slot.startHHMM || '')}
                                      </p>
                                    </div>
                                  </div>
                                  {slot.rocketDepartureLabel ? (
                                    <p className="mt-3 text-xs text-amber-100/90">{slot.rocketDepartureLabel}</p>
                                  ) : null}
                                </button>
                              );
                            })}
                            {!availTimesLoading && bookingData.date && timeSlots.length === 0 ? (
                              <p className="rounded-xl border border-amber-400/30 bg-amber-950/25 px-4 py-3 text-sm text-amber-100">
                                {timesManualFallback
                                  ? 'Could not load launch times for this date. Try again, or pick another day.'
                                  : 'No bookable rocket launches on this date. A rocket icon means a launch is on the calendar, but it may not have a confirmed time yet. Try another launch day.'}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                        <div className="flex flex-wrap gap-3">
                          {charterTimeOptions.map((time) => {
                            const slot = timeSlots.find((row) => row.startHHMM === time);
                            const available = !charterTimesFromApi || availableCharterTimes.has(time);
                            const slotLabel =
                              isBioCharter &&
                              isNextMorningNightCharterStart(bookingData.charterType, time)
                                ? `${timeLabelFromHHMM(time)} next morning`
                                : timeLabelFromHHMM(time);
                            const active =
                              (bookingData.time === time && !bookingData.slotStartIso) ||
                              Boolean(slot && bookingData.slotStartIso === slot.start);
                            return (
                              <button
                                key={time}
                                type="button"
                                disabled={!available}
                                onClick={() => {
                                  if (!available) return;
                                  const t0 = performance.now();
                                  setBookingData({
                                    ...bookingData,
                                    time,
                                    slotStartIso: slot?.start || '',
                                    launchId: '',
                                  });
                                  measurePaintAfterSync('booknow_charter_time_slot', t0, performance.now());
                                }}
                                className={`min-h-[48px] min-w-[5.5rem] rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                                  !available
                                    ? 'cursor-not-allowed border-transparent bg-slate-950/30 text-slate-600'
                                    : active
                                      ? bookingSlotChipActive
                                      : `border ${bookingChoiceIdle}`
                                }`}
                              >
                                {slotLabel}
                              </button>
                            );
                          })}
                        </div>
                        )}
                        {charterTimesFromApi && availTimesLoading && !isRocketCharter && (
                          <p className="mt-2 text-xs text-slate-500">Checking captain availability…</p>
                        )}
                        {charterTimesFromApi &&
                          !availTimesLoading &&
                          bookingData.date &&
                          timeSlots.length === 0 &&
                          !isRocketCharter && (
                          <p className="mt-2 text-sm text-amber-200">
                            {isSunsetPackageFlow && selectedSunsetPackage?.id === 'sunset_solo'
                              ? SUNSET_SOLO_NO_DEPARTURE_MESSAGE
                              : 'No captain availability that night. Try another evening start (5:00 PM or later).'}
                          </p>
                        )}
                        {isRocketPackageFlow && selectedRocketDepartureLabel ? (
                          <p className="mt-3 rounded-lg border border-amber-400/25 bg-amber-950/20 px-3 py-2 text-sm text-amber-100/95">
                            {selectedRocketDepartureLabel}
                          </p>
                        ) : null}
                        {!isBioCharter && !isRocketPackageFlow && !isSunsetPackageFlow && (
                          <div className="mt-3 max-w-xs">
                            <label className="mb-1 block text-xs text-slate-500">Custom time</label>
                            <input
                              type="time"
                              required
                              value={bookingData.time}
                              onChange={(e) =>
                                setBookingData({ ...bookingData, time: e.target.value, slotStartIso: '' })
                              }
                              className={fieldClass}
                            />
                          </div>
                        )}
                      </div>
                      {isBioPackageFlow ? (
                        <div className="space-y-4">
                          <div>
                            <h3 className={bookingSectionTitle}>Choose your group size</h3>
                            <p className="mt-2 text-sm text-slate-300">
                              These are guest packages — not boats. Launch Zone assigns your vessel based on
                              availability.
                            </p>
                            <p className="mt-2 text-sm text-slate-400">
                              {BIO_PACKAGE_PRICING_DISCLAIMER}
                            </p>
                          </div>
                          {!selectedBioPackage ? (
                            <BioluminescencePackageCards
                              selectedPackageId={bioPackageId}
                              onSelect={handleSelectBioPackage}
                            />
                          ) : (
                            <div className={`${bookingCard} border-cyan-400/25`}>
                              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200/90">
                                Selected package
                              </p>
                              <p className="mt-2 text-lg font-bold text-white">{selectedBioPackage.cardTitle}</p>
                              <p className="mt-1 text-sm text-slate-300">
                                {bioFourCheckoutDisplay
                                  ? `${bioFourCheckoutDisplay.guestCount} guest${
                                      bioFourCheckoutDisplay.guestCount === 1 ? '' : 's'
                                    } · $${bioFourCheckoutDisplay.totalUsd.toFixed(2)} total · $${
                                      bioFourCheckoutDisplay.perGuestUsdLabel
                                    } per guest`
                                  : `${selectedBioPackage.guestCount} guest${
                                      selectedBioPackage.guestCount === 1 ? '' : 's'
                                    } · $${selectedBioPackage.directPriceUsd.toFixed(2)} total · $${selectedBioPackage.perGuestUsd.toFixed(2)} per guest`}
                              </p>
                              {bioFourAddonEligible ? (
                                <div className="mt-4 rounded-xl border border-white/15 bg-slate-950/70 p-4">
                                  <label
                                    className={`flex items-start gap-3 ${
                                      bioFourFifthPassengerFits ? 'cursor-pointer' : 'cursor-not-allowed opacity-75'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      className="mt-1 h-5 w-5 shrink-0 rounded border-white/40 bg-slate-900 text-[var(--lz-cta)] focus:ring-[var(--lz-cta)]"
                                      checked={bioFifthPassengerAddon}
                                      disabled={!bioFourFifthPassengerFits}
                                      onChange={(e) => {
                                        const on = e.target.checked && bioFourFifthPassengerFits;
                                        setBioFifthPassengerAddon(on);
                                        setBookingData((prev) => ({
                                          ...prev,
                                          passengerCount: on ? 5 : 4,
                                        }));
                                      }}
                                    />
                                    <span>
                                      <span className="block text-base font-semibold text-white">
                                        Add a 5th passenger — {formatBioPackagePriceUsd(BIO_FIFTH_PASSENGER_ADDON_USD)}
                                      </span>
                                      <span className="mt-1 block text-sm text-slate-400">
                                        Maximum capacity: 5 guests
                                      </span>
                                    </span>
                                  </label>
                                  {!bioFourFifthPassengerFits ? (
                                    <p className="mt-3 text-sm text-amber-200">
                                      {BIO_FIFTH_PASSENGER_NO_CAPACITY_MESSAGE}
                                    </p>
                                  ) : null}
                                </div>
                              ) : null}
                              <button
                                type="button"
                                className="mt-4 text-sm font-semibold text-cyan-300 underline underline-offset-2"
                                onClick={() => navigate(directExperienceChooserPath('bio'))}
                              >
                                Change package
                              </button>
                            </div>
                          )}
                        </div>
                      ) : isRocketPackageFlow ? (
                        <div className="space-y-4">
                          <div>
                            <h3 className={bookingSectionTitle}>Choose your rocket launch package</h3>
                            <p className="mt-2 text-sm text-slate-300">
                              Guest packages — not boats. Launch Zone assigns your vessel based on availability.
                            </p>
                          </div>
                          {!selectedRocketPackage ? (
                            <RocketLaunchPackageCards
                              selectedPackageId={rocketPackageId}
                              onSelect={handleSelectRocketPackage}
                            />
                          ) : (
                            <div className={`${bookingCard} border-cyan-400/25`}>
                              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200/90">
                                Selected package
                              </p>
                              <p className="mt-2 text-lg font-bold text-white">{selectedRocketPackage.cardTitle}</p>
                              <p className="mt-1 text-sm text-slate-300">
                                ${selectedRocketPackage.directPriceUsd.toFixed(2)} total
                                {selectedRocketPackage.id !== 'rocket_private'
                                  ? ` · ${selectedRocketPackage.guestCount} guest${selectedRocketPackage.guestCount === 1 ? '' : 's'}`
                                  : ' · up to 5 guests · private charter'}
                              </p>
                              {selectedRocketPackage.seating === 'shared' ? (
                                <p className="mt-3 text-sm leading-relaxed text-amber-100/90">
                                  {ROCKET_SHARED_CHARTER_DISCLOSURE}
                                </p>
                              ) : null}
                              {selectedRocketPackage.id === 'rocket_private' ? (
                                <div className="mt-4">
                                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                                    How many guests in your group?
                                  </label>
                                  <div className="flex flex-wrap gap-2">
                                    {[1, 2, 3, 4, 5].map((count) => (
                                      <button
                                        key={count}
                                        type="button"
                                        onClick={() => setBookingData({ ...bookingData, passengerCount: count })}
                                        className={`min-h-[48px] min-w-[3.5rem] rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                                          bookingData.passengerCount === count
                                            ? bookingSlotChipActive
                                            : `border ${bookingChoiceIdle}`
                                        }`}
                                      >
                                        {count}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              <button
                                type="button"
                                className="mt-4 text-sm font-semibold text-cyan-300 underline underline-offset-2"
                                onClick={() => navigate(directExperienceChooserPath('rocket'))}
                              >
                                Change package
                              </button>
                            </div>
                          )}
                          <div
                            className="rounded-xl border border-white/10 bg-slate-950/45 p-4 text-sm leading-relaxed text-slate-300"
                            role="note"
                          >
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                              Rocket launch schedule notice
                            </p>
                            <p className="mt-2">{ROCKET_SCHEDULE_NOTICE}</p>
                          </div>
                        </div>
                      ) : isSunsetPackageFlow ? (
                        <div className="space-y-4">
                          <div>
                            <h3 className={bookingSectionTitle}>Choose your sunset package</h3>
                            <p className="mt-2 text-sm text-slate-300">
                              Guest packages — not boats. Launch Zone assigns your vessel based on availability.
                            </p>
                            <p className="mt-2 text-sm text-slate-400">{SUNSET_WILDLIFE_DISCLAIMER}</p>
                          </div>
                          {!selectedSunsetPackage ? (
                            <SunsetPackageCards
                              selectedPackageId={sunsetPackageId}
                              onSelect={handleSelectSunsetPackage}
                            />
                          ) : (
                            <div className={`${bookingCard} border-cyan-400/25`}>
                              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200/90">
                                Selected package
                              </p>
                              <p className="mt-2 text-lg font-bold text-white">{selectedSunsetPackage.cardTitle}</p>
                              <p className="mt-1 text-sm text-slate-300">
                                ${selectedSunsetPackage.directPriceUsd.toFixed(2)} total
                                {selectedSunsetPackage.seating === 'private'
                                  ? ` · up to ${selectedSunsetPackage.maxGuests ?? 5} guests · private charter`
                                  : ` · ${selectedSunsetPackage.guestCount} guest${selectedSunsetPackage.guestCount === 1 ? '' : 's'}`}
                              </p>
                              {selectedSunsetPackage.id === 'sunset_solo' ? (
                                <p className="mt-3 text-sm leading-relaxed text-amber-100/90">
                                  {SUNSET_SOLO_JOIN_DISCLOSURE}
                                </p>
                              ) : null}
                              {selectedSunsetPackage.canOpenSharedDeparture ? (
                                <p className="mt-3 text-sm leading-relaxed text-amber-100/90">
                                  {SUNSET_TWO_OPENER_DISCLOSURE}
                                </p>
                              ) : null}
                              {selectedSunsetPackage.seating === 'private' ? (
                                <div className="mt-4">
                                  <p className="text-sm leading-relaxed text-slate-300">
                                    {SUNSET_PRIVATE_CHARTER_DESCRIPTION}
                                  </p>
                                  <label className="mb-2 mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                                    How many guests in your group?
                                  </label>
                                  <div className="flex flex-wrap gap-2">
                                    {Array.from(
                                      { length: selectedSunsetPackage.maxGuests ?? 5 },
                                      (_, i) => i + 1
                                    ).map((count) => (
                                      <button
                                        key={count}
                                        type="button"
                                        onClick={() => setBookingData({ ...bookingData, passengerCount: count })}
                                        className={`min-h-[48px] min-w-[3.5rem] rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                                          bookingData.passengerCount === count
                                            ? bookingSlotChipActive
                                            : `border ${bookingChoiceIdle}`
                                        }`}
                                      >
                                        {count}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              <button
                                type="button"
                                className="mt-4 text-sm font-semibold text-cyan-300 underline underline-offset-2"
                                onClick={() => navigate(directExperienceChooserPath('sunset'))}
                              >
                                Change package
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                      <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Select number of passengers
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {[1, 2, 3, 4, 5].map((count) => (
                            <button
                              key={count}
                              type="button"
                              onClick={() => setBookingData({ ...bookingData, passengerCount: count })}
                              className={`min-h-[48px] min-w-[3.5rem] rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                                bookingData.passengerCount === count ? bookingSlotChipActive : `border ${bookingChoiceIdle}`
                              }`}
                            >
                              {count}
                            </button>
                          ))}
                        </div>
                        <p className="mt-2 text-xs text-slate-400">
                          ${sharedTourPerPerson.toFixed(2)} per ticket · up to {CHARTER_MAX_PASSENGERS} passengers.
                        </p>
                      </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className={bookingSectionTitle}>Schedule</h3>
                    {calendarAvailabilityLegend}

                    <div className="mt-4 space-y-6 md:space-y-8">
                      <div>
                        <label className="mb-3 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Choose your rental duration
                        </label>
                        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
                          <button
                            type="button"
                            onClick={() => {
                              setRentalDurationPreset('morning');
                              setBookingData((prev) => ({
                                ...prev,
                                rentalType: 'half_day',
                                hours: 4,
                                slotStartIso: '',
                              }));
                            }}
                            className={`min-h-[48px] flex-1 rounded-xl border px-4 py-3 text-center text-sm font-semibold transition sm:min-w-[11rem] ${
                              rentalDurationPreset === 'morning' ? bookingChoiceActive : bookingChoiceIdle
                            }`}
                          >
                            Morning (4 hours)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRentalDurationPreset('afternoon');
                              setBookingData((prev) => ({
                                ...prev,
                                rentalType: 'half_day',
                                hours: 4,
                                slotStartIso: '',
                              }));
                            }}
                            className={`min-h-[48px] flex-1 rounded-xl border px-4 py-3 text-center text-sm font-semibold transition sm:min-w-[11rem] ${
                              rentalDurationPreset === 'afternoon' ? bookingChoiceActive : bookingChoiceIdle
                            }`}
                          >
                            Afternoon (4 hours)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRentalDurationPreset('fullday');
                              setBookingData((prev) => ({
                                ...prev,
                                rentalType: 'full_day',
                                hours: 8,
                                slotStartIso: '',
                              }));
                            }}
                            className={`min-h-[48px] flex-1 rounded-xl border px-4 py-3 text-center text-sm font-semibold transition sm:min-w-[11rem] ${
                              rentalDurationPreset === 'fullday' ? bookingChoiceActive : bookingChoiceIdle
                            }`}
                          >
                            Full Day (8 hours)
                          </button>
                        </div>
                      </div>

                      <div className={bookingCard}>
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-cyan-200/90">
                          {bestLaunchDayToBook ? 'Best Launch Day:' : 'Best Conditions This Week:'}{' '}
                          <span className="text-[var(--lz-cta)]">{bestDayToBookText ?? 'Checking schedule…'}</span>
                          {bestDayToBook && (
                            <>
                              {' — '}
                              <span className="text-slate-100">
                                {typeof bestDayToBook.score === 'number' && Number.isFinite(bestDayToBook.score)
                                  ? bestDayToBook.score.toFixed(1)
                                  : '—'}
                                /10
                              </span>
                            </>
                          )}
                        </p>
                        {bestLaunchInsightReason && (
                          <p className="mb-3 text-[11px] leading-snug text-slate-400">{bestLaunchInsightReason}</p>
                        )}
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            className="min-h-[44px] min-w-[44px] rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/5"
                            onClick={() =>
                              setCalendarMonth(
                                new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1)
                              )
                            }
                          >
                            ←
                          </button>
                          <p className="text-sm font-semibold text-white">
                            {calendarMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
                          </p>
                          <button
                            type="button"
                            className="min-h-[44px] min-w-[44px] rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/5"
                            onClick={() =>
                              setCalendarMonth(
                                new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1)
                              )
                            }
                          >
                            →
                          </button>
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
                            <div key={d}>{d}</div>
                          ))}
                        </div>
                        <div className="mt-2 grid grid-cols-7 gap-1">
                          {calendarCellsFor(calendarMonth).map((cell, idx) => {
                            if (cell.label === null) {
                              return <div key={`rent-e-${idx}`} className="aspect-square min-h-[2.25rem]" />;
                            }
                            const iso = cell.iso as string;
                            return renderCalendarDayButton({
                              iso,
                              label: cell.label,
                              keyValue: `rent-cal-${iso}`,
                            });
                          })}
                        </div>
                        {availCalendarLoading && (
                          <p className="mt-2 text-xs text-slate-500">Updating availability…</p>
                        )}
                        {conditionsLoading && (
                          <p className="mt-1 text-xs text-slate-500">Checking forecast &amp; launches…</p>
                        )}
                        {availabilityByDate.size > 0 &&
                          bookingData.date &&
                          isDayMarkedUnavailable(availabilityByDate, bookingData.date) && (
                            <p className="mt-2 text-sm text-amber-200">
                              No boats available that day for this trip length in our live calendar.
                            </p>
                          )}
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Select a start time
                        </label>
                        {!apiAvailEnabled && (
                          <input
                            type="time"
                            required
                            value={bookingData.time}
                            onChange={(e) =>
                              setBookingData({ ...bookingData, time: e.target.value, slotStartIso: '' })
                            }
                            className={fieldClass}
                          />
                        )}
                        {apiAvailEnabled && availTimesLoading && (
                          <p className="text-xs text-slate-500">Loading open times…</p>
                        )}
                        {apiAvailEnabled && !availTimesLoading && timeSlots.length > 0 && (
                          <div className="flex flex-wrap gap-3">
                            {timeSlots.map((s, i) => {
                              const recommended =
                                timeSlots.length > 2 && i === Math.floor(timeSlots.length / 2);
                              const active = bookingData.slotStartIso === s.start;
                              const slotHour = hourFromSlotIso(s.start);
                              const presetSuggested =
                                rentalDurationPreset === 'morning'
                                  ? slotHour < 12
                                  : rentalDurationPreset === 'afternoon'
                                    ? slotHour >= 12
                                    : rentalDurationPreset === 'fullday'
                                      ? i === 0
                                      : false;
                              return (
                                <button
                                  key={s.start}
                                  type="button"
                                  onClick={() =>
                                    setBookingData({
                                      ...bookingData,
                                      slotStartIso: s.start,
                                      time: s.startHHMM ?? bookingData.time,
                                    })
                                  }
                                  className={`min-h-[48px] min-w-[5.5rem] rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                                    active
                                      ? bookingSlotChipActive
                                      : presetSuggested && rentalDurationPreset
                                        ? `${bookingSlotChipRecommended} border`
                                        : recommended
                                          ? `${bookingSlotChipRecommended} border`
                                          : `border ${bookingChoiceIdle}`
                                  }`}
                                >
                                  {s.label}
                                  {recommended && !active && !presetSuggested && (
                                    <span className="ml-1 text-[10px] font-normal text-cyan-300/90">
                                      Popular
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {isBookingToday && (
                          <p className="mt-2 text-xs text-slate-400">
                            Same-day bookings require at least {sameDayMinLeadHours} hours notice.
                          </p>
                        )}
                        {apiAvailEnabled && !availTimesLoading && timesManualFallback && (
                          <>
                            <p className="mb-2 text-xs text-amber-200/90">
                              Live times unavailable — enter a start time; checkout confirms availability.
                            </p>
                            <input
                              type="time"
                              required
                              value={bookingData.time}
                              onChange={(e) =>
                                setBookingData({ ...bookingData, time: e.target.value, slotStartIso: '' })
                              }
                              className={fieldClass}
                            />
                          </>
                        )}
                        {apiAvailEnabled &&
                          !availTimesLoading &&
                          !timesManualFallback &&
                          timeSlots.length === 0 &&
                          bookingData.date && (
                            <p className="text-sm text-amber-200">
                              {isBookingToday
                                ? 'No more booking times are available today. Please choose another date.'
                                : 'No open start times that day for this duration. Try another date.'}
                            </p>
                          )}
                      </div>
                    </div>
                  </>
                )}

                <button
                  id="booking-step1-continue"
                  type="button"
                  onClick={wrapSyncClick('booknow_step1_continue', () => {
                    const canContinueCharter =
                      bookingMode === 'charter' &&
                      bookingData.date &&
                      (bookingData.time || bookingData.slotStartIso) &&
                      bookingData.passengerCount >= 1 &&
                      bookingData.passengerCount <= CHARTER_MAX_PASSENGERS &&
                      (!isBioPackageFlow || Boolean(bioPackageId)) &&
                      (!isRocketPackageFlow || Boolean(rocketPackageId)) &&
                      (!isSunsetPackageFlow || Boolean(sunsetPackageId)) &&
                      !dateMarkedUnavailable &&
                      !noSlotsForDay;
                    const canContinueRental = bookingMode === 'rental' && selectedBoat && bookingData.date && !scheduleContinueBlocked;
                    if (canContinueCharter || canContinueRental) {
                      setStep(bookingMode === 'charter' ? 3 : 2);
                    }
                  })}
                  disabled={
                    bookingMode === 'charter'
                      ? !bookingData.date ||
                        (!bookingData.time && !bookingData.slotStartIso) ||
                        bookingData.passengerCount < 1 ||
                        bookingData.passengerCount > CHARTER_MAX_PASSENGERS ||
                        (isBioPackageFlow && !bioPackageId) ||
                        (isRocketPackageFlow && !rocketPackageId) ||
                        (isSunsetPackageFlow && !sunsetPackageId) ||
                        dateMarkedUnavailable ||
                        noSlotsForDay ||
                        availTimesLoading
                      : !selectedBoat || !bookingData.date || scheduleContinueBlocked
                  }
                  className={`${bookingPrimaryCta} mt-8 md:mt-10`}
                >
                  {bookingMode === 'charter' ? 'Continue to checkout' : 'Continue'}
                </button>
              </div>
            )}

            {step === 2 && (
              <div>
                <h2 className="font-display text-xl font-bold uppercase tracking-[0.14em] text-white md:text-2xl">
                  {bookingMode === 'charter' ? 'Confirm details' : 'Add-ons'}
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  {bookingMode === 'charter'
                    ? bookingData.charterType === 'night_bio'
                      ? `Your total and inclusions are set. Per-person rate applies; choose private or shared seating below when available.`
                      : bookingData.charterType === 'rocket_launch'
                        ? `Your total and inclusions are set. Choose private (one total) or shared ($${ROCKET_SHARED_PER_PERSON} per person) below.`
                        : bookingData.charterType === 'sunset_cruise'
                          ? `Your total and inclusions are set. Choose private (one total) or shared ($${SUNSET_SHARED_PER_PERSON} per person) below.`
                          : 'Your total and inclusions are set. Add an optional timing note below if you need it.'
                    : 'Optional upgrades. Adjust pricing before you pay.'}
                </p>
                {bookingMode === 'charter' && (
                  <div
                    className="mt-4 space-y-2 rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-4 text-sm md:p-5"
                    aria-live="polite"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200/90">Your charter</p>
                    <p className="font-medium text-white">{charterSelectedDescription()}</p>
                    <p className="text-lg font-bold text-cyan-100">{charterPd.primary}</p>
                    {charterPd.sub && <p className="text-slate-300">{charterPd.sub}</p>}
                    <p className="text-xs font-medium text-cyan-100/95">{CHARTER_INCLUSIONS_LINE}</p>
                  </div>
                )}

                <div className="mt-8 space-y-4">
                  {bookingMode === 'rental' && (
                    <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/45 p-4 md:p-5">
                      <input
                        type="checkbox"
                        id="captain"
                        checked={bookingData.captainIncluded}
                        onChange={(e) =>
                          setBookingData({ ...bookingData, captainIncluded: e.target.checked })
                        }
                        className="mt-1 h-5 w-5 shrink-0 rounded border-white/20 text-[var(--lz-cta)] focus:ring-cyan-500/40"
                      />
                      <label htmlFor="captain" className="flex-1 cursor-pointer">
                        <div className="font-semibold text-slate-100">
                          Add Professional Captain — ${PRICING.captainHourly}/hour
                        </div>
                        <div className="mt-1 text-sm text-slate-400">
                          ${PRICING.captainHourly}/hr × {bookingData.hours} hr = $
                          {captainFeeForHours(bookingData.hours).toFixed(2)} when selected
                        </div>
                      </label>
                    </div>
                  )}

                  {bookingMode === 'charter' && (
                    <div className="flex items-start gap-3 rounded-[var(--lz-radius)] border border-amber-400/25 bg-amber-950/20 p-4">
                      <input
                        type="checkbox"
                        id="charter-request"
                        checked={bookingData.charterRequestOnly}
                        onChange={(e) =>
                          setBookingData({ ...bookingData, charterRequestOnly: e.target.checked })
                        }
                        className="mt-1 h-5 w-5 shrink-0 rounded border-white/20 text-amber-400 focus:ring-amber-500/40"
                      />
                      <label htmlFor="charter-request" className="flex-1 cursor-pointer">
                        <div className="font-semibold text-slate-100">Ask us to confirm timing first (optional)</div>
                        <div className="mt-1 text-sm text-slate-400">
                          Useful if the launch window is still uncertain. We follow up before final timing.
                        </div>
                      </label>
                    </div>
                  )}

                  {isBioCharter && (
                    <CharterPrivateSharedTourBlock
                      sectionTitle="Bioluminescence: private or shared"
                      perPerson={BIO_SHARED_PER_PERSON}
                      maxSharedGuests={CHARTER_MAX_PASSENGERS}
                      sharedOpenWindow={sharedOpenWindow}
                      bookingData={bookingData}
                      setBookingData={setBookingData}
                      hasSelectedBoat={Boolean(selectedBoat)}
                      pricingTotal={pricing.total}
                      fieldClass={fieldClass}
                      bookingChoiceActive={bookingChoiceActive}
                      bookingChoiceIdle={bookingChoiceIdle}
                    />
                  )}
                  {isRocketCharter && !isRocketPackageFlow && (
                    <CharterPrivateSharedTourBlock
                      sectionTitle="ROCKET LAUNCH: PRIVATE OR SHARED"
                      perPerson={ROCKET_SHARED_PER_PERSON}
                      maxSharedGuests={CHARTER_MAX_PASSENGERS}
                      sharedOpenWindow={sharedOpenWindow}
                      bookingData={bookingData}
                      setBookingData={setBookingData}
                      hasSelectedBoat={Boolean(selectedBoat)}
                      pricingTotal={pricing.total}
                      fieldClass={fieldClass}
                      bookingChoiceActive={bookingChoiceActive}
                      bookingChoiceIdle={bookingChoiceIdle}
                    />
                  )}
                  {isSunsetCharter && !isSunsetPackageFlow && (
                    <CharterPrivateSharedTourBlock
                      sectionTitle="Sunset cruise: private or shared"
                      perPerson={SUNSET_SHARED_PER_PERSON}
                      maxSharedGuests={CHARTER_MAX_PASSENGERS}
                      sharedOpenWindow={sharedOpenWindow}
                      bookingData={bookingData}
                      setBookingData={setBookingData}
                      hasSelectedBoat={Boolean(selectedBoat)}
                      pricingTotal={pricing.total}
                      fieldClass={fieldClass}
                      bookingChoiceActive={bookingChoiceActive}
                      bookingChoiceIdle={bookingChoiceIdle}
                    />
                  )}
                </div>

                <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:gap-5">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className={`${bookingSecondaryCta} order-2 sm:order-1 sm:flex-1`}
                  >
                    Back
                  </button>
                  <button
                    id="booking-step2-continue"
                    type="button"
                    onClick={() => setStep(3)}
                    disabled={bookingMode === 'charter' && sharedTourOverLimit}
                    className={`${bookingPrimaryCta} order-1 sm:order-2 sm:flex-1`}
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <form ref={checkoutFormRef} id="booking-checkout-form" onSubmit={handleSubmit}>
                <h2 className="font-display text-xl font-bold uppercase tracking-[0.14em] text-white md:text-2xl">
                  Payment &amp; confirmation
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  {bookingMode === 'charter' ? (
                    <>
                      Your details and waiver, then complete checkout in full. Captain & fuel included; no
                      security deposit.
                    </>
                  ) : (
                    <>
                      Your details, waiver, optional documents, then check out with Stripe for today&apos;s amount
                      due (50% of your reservation total, including the refundable $300 security deposit).
                      Remaining trip balance is due before or at pickup.
                    </>
                  )}
                </p>

                <h3 className="mt-10 text-sm font-bold uppercase tracking-widest text-cyan-200/90">
                  Your contact
                </h3>
                <div className="mt-4 space-y-5">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Full name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={bookingData.fullName}
                      onChange={(e) => setBookingData({ ...bookingData, fullName: e.target.value })}
                      className={fieldClass}
                      placeholder="John Doe"
                      autoComplete="name"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Email <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      value={bookingData.email}
                      onChange={(e) => setBookingData({ ...bookingData, email: e.target.value })}
                      className={fieldClass}
                      placeholder="john@example.com"
                      autoComplete="email"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Phone <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="tel"
                      required
                      value={bookingData.phone}
                      onChange={(e) => setBookingData({ ...bookingData, phone: e.target.value })}
                      className={fieldClass}
                      placeholder="(555) 123-4567"
                      autoComplete="tel"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Special requests (optional)
                    </label>
                    <textarea
                      rows={3}
                      value={bookingData.specialRequests}
                      onChange={(e) =>
                        setBookingData({ ...bookingData, specialRequests: e.target.value })
                      }
                      className={fieldClass}
                      placeholder="Any special requests or needs we should know about..."
                    />
                  </div>
                </div>

                {bookingMode === 'rental' && (
                  <div className="mt-6 rounded-[var(--lz-radius)] border border-cyan-400/25 bg-cyan-950/25 p-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" aria-hidden />
                      <p className="text-sm text-cyan-50/95">
                        <strong className="text-white">Check-in:</strong> Government-issued ID required. Renters
                        must be at least 25 years old.
                      </p>
                    </div>
                  </div>
                )}

                {bookingMode === 'rental' && (
                  <div className="mt-6 rounded-[var(--lz-radius)] border border-white/10 bg-slate-950/50 p-5 md:p-6">
                    <div className="flex flex-col gap-2 border-b border-white/10 pb-4 sm:flex-row sm:items-start sm:justify-between">
                      <h3 className="text-lg font-semibold text-white">{SECURITY_DEPOSIT_SECTION_HEADING}</h3>
                    </div>
                    <p className="mt-4 text-sm leading-relaxed text-slate-300">{SECURITY_DEPOSIT_CARD_INTRO}</p>
                    <ul className="mt-4 space-y-2 text-sm text-slate-400">
                      {SECURITY_DEPOSIT_MARKETING_BULLETS.map((line) => (
                        <li key={line} className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {isRocketPackageFlow ? (
                  <div className="mt-6 space-y-4">
                    <div
                      className="rounded-xl border border-white/10 bg-slate-950/45 p-4 text-sm text-slate-300"
                      role="note"
                    >
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                        Rocket launch schedule notice
                      </p>
                      <p className="mt-2">{ROCKET_SCHEDULE_NOTICE}</p>
                    </div>
                    {requiresRocketSharedAck ? (
                      <>
                        <div
                          className="rounded-xl border border-amber-400/30 bg-amber-950/25 p-4 text-sm leading-relaxed text-amber-50/95"
                          role="note"
                        >
                          <p className="text-xs font-bold uppercase tracking-wide text-amber-200/95">
                            Shared charter — minimum {ROCKET_LAUNCH_MIN_GUESTS} guests required
                          </p>
                          <p className="mt-2">{ROCKET_SHARED_CHARTER_DISCLOSURE}</p>
                          <p className="mt-3 text-xs text-amber-100/80">
                            Payment reserves your seats. Departure is fully confirmed once the minimum guest count is
                            reached.
                          </p>
                        </div>
                        <label className="flex items-start gap-3 rounded-[var(--lz-radius)] border border-amber-400/25 bg-amber-950/20 p-4 text-sm text-slate-100">
                          <input
                            type="checkbox"
                            checked={rocketSharedMinimumAcknowledged}
                            onChange={(e) => setRocketSharedMinimumAcknowledged(e.target.checked)}
                            className="mt-1 h-5 w-5 shrink-0 rounded border-white/20 text-amber-400 focus:ring-amber-500/40"
                          />
                          <span>{ROCKET_SHARED_ACK_LABEL}</span>
                        </label>
                      </>
                    ) : null}
                  </div>
                ) : null}

                <WaiverBlock
                  bookingMode={bookingMode}
                  waiverData={waiverData}
                  onWaiverDataChange={setWaiverData}
                  termsAccepted={termsAccepted}
                  onTermsAcceptedChange={setTermsAccepted}
                  damageFeeAcknowledged={damageFeeAcknowledged}
                  onDamageFeeAcknowledgedChange={setDamageFeeAcknowledged}
                  onNavigateTerms={() => onNavigate('terms')}
                  fieldClass={fieldClass}
                  signatureHelperText="Electronic signature is required before payment. By typing your name, you agree this constitutes a legal electronic signature when the waiver checkbox is checked."
                />

                {bookingMode === 'rental' && (
                    <div className="space-y-4 rounded-[var(--lz-radius)] border border-white/10 bg-slate-950/50 p-4">
                      <p className="text-sm font-semibold text-white">License &amp; insurance (upload or link)</p>
                      <p className="text-xs text-slate-300">
                        You must provide valid damage protection before your rental. We recommend using Buoy, a trusted
                        boat rental insurance provider.
                      </p>
                      <Link
                        to={buoyInsurancePagePath}
                        className="inline-flex items-center text-sm font-semibold text-[var(--lz-cta)] underline decoration-[var(--lz-cta)]/50 underline-offset-2 hover:text-orange-300"
                      >
                        👉 Get Boat Rental Insurance with Buoy
                      </Link>
                      <p className="text-xs text-slate-400">
                        {selectedBoat
                          ? 'After purchasing, upload a screenshot or paste your Buoy confirmation link below.'
                          : 'Select a boat first so we can open the correct Buoy insurance for your booking.'}
                      </p>
                      <p className="text-xs font-semibold text-amber-200">Required before departure.</p>
                      {docUploadError && (
                        <p className="text-sm text-red-400" role="alert">
                          {docUploadError}
                        </p>
                      )}
                      {rentalInsuranceMissing && (
                        <p className="text-sm text-amber-300" role="status" aria-live="polite">
                          ⚠️ Buoy insurance is required before your boat can be released.
                        </p>
                      )}
                      <label className="flex items-start gap-3 rounded-[var(--lz-radius)] border border-white/10 bg-slate-900/40 px-3 py-2 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          checked={buoyInsuranceAcknowledged}
                          onChange={(e) => setBuoyInsuranceAcknowledged(e.target.checked)}
                          className="mt-1 h-4 w-4 shrink-0 rounded border-white/20 text-[var(--lz-cta)] focus:ring-cyan-500/40"
                        />
                        <span>I have purchased Buoy insurance or will upload proof below</span>
                      </label>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-300">
                          License / ID — file upload
                        </label>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                          disabled={docUploadBusy !== null}
                          onChange={(e) => void handleLicenseUpload(e)}
                          className="block w-full text-sm text-slate-200 file:mr-3 file:rounded file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-cyan-100"
                        />
                        {docUploadBusy === 'license' && (
                          <p className="mt-1 text-xs text-slate-500">Uploading…</p>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-300">
                          Insurance — file upload
                        </label>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                          disabled={docUploadBusy !== null}
                          onChange={(e) => void handleInsuranceUpload(e)}
                          className="block w-full text-sm text-slate-200 file:mr-3 file:rounded file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-cyan-100"
                        />
                        {docUploadBusy === 'insurance' && (
                          <p className="mt-1 text-xs text-slate-500">Uploading…</p>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-300">
                          License / ID — or paste URL
                        </label>
                        <input
                          type="url"
                          value={verificationData.licenseProofUrl}
                          onChange={(e) =>
                            setVerificationData({ ...verificationData, licenseProofUrl: e.target.value })
                          }
                          className={fieldClass}
                          placeholder="https://…"
                        />
                        {licensePreviewUrl && (
                          <img
                            src={licensePreviewUrl}
                            alt="License preview"
                            width={100}
                            height={100}
                            className="mt-2 h-24 w-auto max-w-[100px] rounded border border-white/20 object-cover"
                          />
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-300">
                          Insurance (Buoy confirmation) — or paste URL
                        </label>
                        <input
                          type="url"
                          value={verificationData.insuranceProofUrl}
                          onChange={(e) =>
                            setVerificationData({
                              ...verificationData,
                              insuranceProofUrl: e.target.value,
                            })
                          }
                          className={fieldClass}
                          placeholder="https://…"
                        />
                        {insurancePreviewUrl && (
                          <img
                            src={insurancePreviewUrl}
                            alt="Insurance preview"
                            width={100}
                            height={100}
                            className="mt-2 h-24 w-auto max-w-[100px] rounded border border-white/20 object-cover"
                          />
                        )}
                      </div>
                    </div>
                  )}

                <div className="mb-6 rounded-[var(--lz-radius)] border border-cyan-400/20 bg-slate-950/80 p-6 text-slate-100 shadow-[0_0_28px_rgba(0,207,255,0.08)]">
                  <h3 className="mb-4 text-lg font-bold uppercase tracking-wide text-white">Booking summary</h3>
                  <div className="space-y-3">
                    {bookingMode === 'rental' && (
                      <div className="flex justify-between">
                        <span>Boat:</span>
                        <span className="font-semibold">{selectedBoat?.name}</span>
                      </div>
                    )}
                    {bookingMode === 'charter' && (
                      <div className="flex justify-between text-slate-300">
                        <span>Experience:</span>
                        <span className="font-semibold text-right">{charterSelectedDescription()}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Date & Time:</span>
                      <span className="font-semibold text-right">
                        {selectedDateTimeLabel}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>
                        {bookingMode === 'charter' ? 'Charter duration (included):' : 'Duration:'}
                      </span>
                      <span className="font-semibold">
                        {bookingMode === 'charter' ? charterDurationLabel : `${bookingData.hours} hours`}
                      </span>
                    </div>
                    <div className="my-3 border-t border-white/10"></div>
                    {bookingMode === 'charter' ? (
                      isBioPackageFlow && selectedBioPackage ? (
                        <>
                          <div className="flex justify-between text-slate-300">
                            <span>
                              {selectedBioPackage.cardTitle} (
                              {bioFourCheckoutDisplay
                                ? `${bioFourCheckoutDisplay.guestCount} guest${
                                    bioFourCheckoutDisplay.guestCount === 1 ? '' : 's'
                                  }`
                                : `${selectedBioPackage.guestCount} guest${
                                    selectedBioPackage.guestCount === 1 ? '' : 's'
                                  }`}
                              )
                            </span>
                            <span>${selectedBioPackage.directPriceUsd.toFixed(2)}</span>
                          </div>
                          {bioFourCheckoutDisplay?.addonUsd ? (
                            <div className="flex justify-between text-slate-300">
                              <span>5th passenger add-on</span>
                              <span>${bioFourCheckoutDisplay.addonUsd.toFixed(2)}</span>
                            </div>
                          ) : null}
                          <div className="flex justify-between text-slate-400 text-sm">
                            <span>Per person</span>
                            <span>
                              $
                              {bioFourCheckoutDisplay
                                ? bioFourCheckoutDisplay.perGuestUsdLabel
                                : selectedBioPackage.perGuestUsd.toFixed(2)}
                            </span>
                          </div>
                        </>
                      ) : isRocketPackageFlow && selectedRocketPackage ? (
                        <div className="flex justify-between text-slate-300">
                          <span>
                            {selectedRocketPackage.cardTitle}
                            {selectedRocketPackage.id === 'rocket_private'
                              ? ` (${bookingData.passengerCount} guest${bookingData.passengerCount === 1 ? '' : 's'})`
                              : ` (${selectedRocketPackage.guestCount} guest${selectedRocketPackage.guestCount === 1 ? '' : 's'})`}
                          </span>
                          <span>${pricing.total.toFixed(2)}</span>
                        </div>
                      ) : isSunsetPackageFlow && selectedSunsetPackage ? (
                        <div className="flex justify-between text-slate-300">
                          <span>
                            {selectedSunsetPackage.cardTitle}
                            {selectedSunsetPackage.seating === 'private'
                              ? ` (${bookingData.passengerCount} guest${bookingData.passengerCount === 1 ? '' : 's'})`
                              : ` (${selectedSunsetPackage.guestCount} guest${selectedSunsetPackage.guestCount === 1 ? '' : 's'})`}
                          </span>
                          <span>${pricing.total.toFixed(2)}</span>
                        </div>
                      ) : (
                        <div className="flex justify-between text-slate-300">
                          <span>
                            ${sharedTourPerPerson} × {bookingData.passengerCount} passengers
                          </span>
                          <span>${pricing.total.toFixed(2)}</span>
                        </div>
                      )
                    ) : (
                      <>
                        <div className="flex justify-between">
                          <span>Base rental:</span>
                          <span>${pricing.basePrice.toFixed(2)}</span>
                        </div>
                      </>
                    )}
                    {bookingMode === 'rental' && pricing.captainFee > 0 && (
                      <div className="flex justify-between">
                        <span>Captain Fee:</span>
                        <span>${pricing.captainFee.toFixed(2)}</span>
                      </div>
                    )}
                    {bookingMode === 'rental' && (
                      <div className="flex justify-between">
                        <span>Security Deposit:</span>
                        <span>${pricing.deposit.toFixed(2)}</span>
                      </div>
                    )}
                    {bookingMode === 'charter' && (
                      <div className="flex justify-between text-slate-300">
                        <span>Captain &amp; fuel:</span>
                        <span>Included</span>
                      </div>
                    )}
                    {!isBioPackageFlow && !isRocketPackageFlow && !isSunsetPackageFlow ? (
                    <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
                      <label htmlFor="promo-code" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-300">
                        Promo code
                      </label>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          id="promo-code"
                          type="text"
                          value={promoCodeInput}
                          onChange={(e) => setPromoCodeInput(e.target.value)}
                          className={fieldClass}
                          placeholder="e.g. VIP50"
                          autoComplete="off"
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          onClick={() => void handleApplyPromo()}
                          disabled={promoApplying || !promoCodeInput.trim()}
                          className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {promoApplying ? 'Applying...' : 'Apply'}
                        </button>
                      </div>
                      {promoMessage && (
                        <p
                          className={`mt-2 flex items-center gap-1.5 text-sm font-semibold ${
                            promoMessage.variant === 'success' ? 'text-emerald-300' : 'text-amber-200'
                          }`}
                        >
                          {promoMessage.variant === 'success' && <Check className="h-4 w-4 shrink-0" aria-hidden />}
                          {promoMessage.text}
                        </p>
                      )}
                    </div>
                    ) : null}
                    {appliedPromo && (
                      <>
                        <div className="my-3 border-t border-white/10"></div>
                        <div className="flex justify-between text-slate-300">
                          <span>{bookingMode === 'rental' ? 'Rental subtotal' : 'Subtotal'}</span>
                          <span>${appliedPromo.originalSubtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-emerald-300">
                          <span>Promo {appliedPromo.promoCode} applied</span>
                          <span>-${promoDiscountAmount.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-slate-300">
                          <span>{bookingMode === 'rental' ? 'Rental after promo' : 'Subtotal after promo'}</span>
                          <span>${appliedPromo.finalSubtotal.toFixed(2)}</span>
                        </div>
                      </>
                    )}
                    <div className="my-3 border-t border-white/10"></div>
                    <div className="flex justify-between text-sm text-cyan-100/90">
                      <span>{bookingMode === 'charter' ? 'Pay today (in full)' : 'Pay today (50% deposit)'}</span>
                      <span className="font-semibold">${amountDueToday.toFixed(2)}</span>
                    </div>
                    {bookingMode === 'rental' && (
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>Remaining before / at pickup</span>
                        <span>${balanceBeforePickup.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="my-3 border-t border-white/10"></div>
                    <div className="flex justify-between text-xl font-bold">
                      <span>Reservation total</span>
                      <span className="text-[var(--lz-cta)]">${reservationTotal.toFixed(2)}</span>
                    </div>
                    <p className="text-xs text-slate-400">
                      {bookingMode === 'charter'
                        ? 'Charter checkout is paid in full. No separate security deposit — captain & fuel already included in the total above.'
                        : `Deposit is 50% of this trip total. ${SECURITY_DEPOSIT_SHORT_SUMMARY}`}
                    </p>
                  </div>
                </div>

                <div className="mb-4 grid gap-2 rounded-[var(--lz-radius)] border border-white/10 bg-slate-950/50 p-4 text-left text-xs text-slate-400 md:grid-cols-3 md:gap-3">
                  <p className="flex items-start gap-2 md:border-r md:border-white/10 md:pr-3">
                    <Lock className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400/80" aria-hidden />
                    <span>
                      <strong className="text-slate-200">
                        {bookingMode === 'charter' ? 'Pay in full today' : 'Deposit only today'}
                      </strong>{' '}
                      {bookingMode === 'charter'
                        ? 'for a clean, captain-led checkout.'
                        : 'not the full trip cost upfront.'}
                    </span>
                  </p>
                  <p className="flex items-start gap-2 md:border-r md:border-white/10 md:pr-3">
                    <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400/80" aria-hidden />
                    <span>
                      <strong className="text-slate-200">
                        {bookingMode === 'charter' ? 'No surprise fees' : 'No surprise boat fees'}
                      </strong>{' '}
                      — {bookingMode === 'charter' ? 'total matches your charter selections above.' : 'pricing matches your selections above.'}
                    </span>
                  </p>
                  <p className="flex items-start gap-2">
                    <Shield className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400/80" aria-hidden />
                    <span>
                      <strong className="text-slate-200">Trusted checkout</strong> — cards processed securely
                      by Stripe.
                    </span>
                  </p>
                </div>

                <div className="mb-6 rounded-[var(--lz-radius)] border border-[var(--lz-cta)]/30 bg-[rgba(255,140,43,0.08)] p-4">
                  <div className="flex items-start gap-3">
                    <Shield className="mt-0.5 h-5 w-5 shrink-0 text-[var(--lz-cta)]" aria-hidden />
                    <div className="text-sm text-slate-200">
                      <p>
                        <strong className="text-white">
                          {bookingMode === 'charter'
                            ? 'Charters are paid in full at checkout.'
                            : 'You pay 50% of your trip today.'}
                        </strong>{' '}
                        {bookingMode === 'charter'
                          ? 'This keeps launch and night experiences simple.'
                          : 'Your reservation total includes the refundable $300 security deposit; remaining trip balance is due before or at pickup.'}
                      </p>
                      <p className="mt-2 text-xs text-slate-400">
                        Cancellation terms are in our FAQ &amp; Terms; contact us if your plans change.{' '}
                        {CANCELLATION_REFUND_POLICY_CHECKOUT_NOTE}
                      </p>
                    </div>
                  </div>
                </div>

                {checkoutError && (
                  <div
                    className={`mb-4 rounded-[var(--lz-radius)] px-4 py-3 text-sm ${
                      slotAlternatives.length > 0
                        ? 'border border-amber-400/40 bg-amber-950/40 text-amber-50'
                        : 'border border-red-400/40 bg-red-950/50 text-red-100'
                    }`}
                    role="alert"
                  >
                    <p className="font-semibold">{checkoutError}</p>
                    {slotAlternatives.length > 0 ? (
                      <div className="mt-3">
                        <p className="text-sm text-amber-100">Here are the closest available times:</p>
                        <div className="mt-3 flex flex-col gap-2">
                          {slotAlternatives.map((slot) => (
                            <button
                              key={slot.start}
                              type="button"
                              onClick={() => {
                                setBookingData((prev) => ({
                                  ...prev,
                                  slotStartIso: slot.start,
                                  time: slot.startHHMM || prev.time,
                                  launchId: slot.launchId || prev.launchId || '',
                                }));
                                setSlotAlternatives([]);
                                setCheckoutError(null);
                              }}
                              className="min-h-12 rounded-xl border border-cyan-400/40 bg-cyan-950/40 px-4 py-3 text-base font-bold text-white"
                            >
                              {slot.label || slot.startHHMM || slot.start}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}

                <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
                  <button
                    type="button"
                    onClick={() => setStep(bookingMode === 'charter' && !charterUsesPrivateSharedStep ? 1 : 2)}
                    disabled={processing}
                    className={`${bookingSecondaryCta} order-2 disabled:opacity-50 sm:order-1 sm:flex-1`}
                  >
                    Back
                  </button>
                  <button
                    id="booking-step3-submit"
                    type="submit"
                    disabled={
                      processing ||
                      (bookingMode === 'charter' && sharedTourOverLimit) ||
                      !checkoutRequirementsMet
                    }
                    className={`${bookingPrimaryCta} order-1 flex items-center justify-center gap-2 disabled:opacity-50 sm:order-2 sm:flex-1`}
                  >
                    {processing ? (
                      <>
                        <Spinner size="sm" tone="onDark" />
                        <span>Processing…</span>
                      </>
                    ) : (
                      <>
                        <DollarSign className="h-5 w-5 shrink-0" aria-hidden />
                        <span>{bookingMode === 'charter' ? 'Continue to checkout' : 'Book now'}</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="mt-10 text-center text-sm text-slate-500">
            <p>
              Questions? Call{' '}
              <a
                href="tel:803-542-1761"
                className="font-semibold text-cyan-400 underline decoration-cyan-500/30 hover:text-cyan-300"
              >
                803-542-1761
              </a>
            </p>
          </div>
          </div>

          {bookingMode === 'charter' && step > 0 && (
            <aside
              className="lz-card-glass hidden max-h-[calc(100vh-6rem)] w-full overflow-y-auto rounded-[var(--lz-radius-card)] border border-cyan-400/25 p-5 text-slate-100 shadow-[0_0_40px_rgba(6,182,212,0.08)] lg:sticky lg:top-24 lg:block lg:max-w-[320px] lg:self-start"
              aria-label="Booking summary"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300/90">Your charter</p>
              <p className="mt-1 font-display text-lg font-bold leading-snug text-white">{charterHeroTitle}</p>
              <div className="mt-4 border-t border-white/10 pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Pay today</p>
                <p className="mt-1 font-display text-3xl font-bold text-[var(--lz-cta)]">
                  ${amountDueToday.toFixed(2)}
                </p>
                <p className="mt-1 text-xs text-slate-500">One total · captain-led charter</p>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-slate-200">
                <li className="flex gap-2">
                  <span className="text-emerald-400" aria-hidden>
                    ✔
                  </span>
                  Captain included
                </li>
                <li className="flex gap-2">
                  <span className="text-emerald-400" aria-hidden>
                    ✔
                  </span>
                  Fuel included
                </li>
                <li className="flex gap-2">
                  <span className="text-emerald-400" aria-hidden>
                    ✔
                  </span>
                  {isBioPackageFlow && selectedBioPackage
                    ? bioFourAddonEligible
                      ? bioFourSidebarPassengerLine(bioFifthPassengerAddon)
                      : `${selectedBioPackage.guestCount} guest${
                          selectedBioPackage.guestCount === 1 ? '' : 's'
                        } included`
                    : `Up to ${CHARTER_MAX_PASSENGERS} passengers`}
                </li>
                <li className="flex gap-2">
                  <span className="text-emerald-400" aria-hidden>
                    ✔
                  </span>
                  No security deposit
                </li>
              </ul>
              {urgencyHint && (
                <p className="mt-4 rounded-lg border border-amber-400/25 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
                  {urgencyHint}
                </p>
              )}
              <div className="mt-4 space-y-1.5 border-t border-white/10 pt-4 text-[11px] text-slate-400">
                <p className="flex gap-2">
                  <span className="text-emerald-400">✔</span> No hidden fees
                </p>
                <p className="flex gap-2">
                  <span className="text-emerald-400">✔</span> Secure checkout (Stripe)
                </p>
                <p className="flex gap-2">
                  <span className="text-emerald-400">✔</span> Weather reschedule when conditions require it
                </p>
                <p className="flex gap-2">
                  <span className="text-emerald-400">✔</span> USCG-compliant operation
                </p>
              </div>
              <div className="mt-4 rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-[11px] text-slate-400">
                <p className="font-semibold text-slate-300">On-water safety</p>
                <p className="mt-1 flex gap-2">
                  <span className="text-cyan-400">✔</span> Safe viewing distance maintained
                </p>
                <p className="mt-1 flex gap-2">
                  <span className="text-cyan-400">✔</span> Captain selects best position
                </p>
                <p className="mt-1 flex gap-2">
                  <span className="text-cyan-400">✔</span> Conditions may vary
                </p>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
