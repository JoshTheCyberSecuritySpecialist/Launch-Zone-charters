import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
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
import CharterPrivateSharedTourBlock from '../components/CharterPrivateSharedTourBlock';
import { supabase } from '../lib/supabase';
import type { PostgrestError } from '@supabase/supabase-js';
import { logSupabaseError, userFacingSupabaseMessage } from '../lib/supabaseErrors';
import { uploadDocumentToDocumentsBucket } from '../lib/storageUpload';
import { PRICING, captainFeeForHours } from '../config/pricing';
import {
  SECURITY_DEPOSIT_AUTHORIZATION_CLAUSE,
  SECURITY_DEPOSIT_CARD_INTRO,
  SECURITY_DEPOSIT_MARKETING_BULLETS,
  SECURITY_DEPOSIT_SECTION_HEADING,
  SECURITY_DEPOSIT_SHORT_SUMMARY,
  SECURITY_DEPOSIT_TERMS_PARAGRAPH,
} from '../content/securityDeposit';
import {
  CANCELLATION_REFUND_POLICY_SUBSECTIONS,
  CANCELLATION_REFUND_POLICY_TITLE,
  CANCELLATION_REFUND_POLICY_WAIVER_ACKNOWLEDGMENT,
} from '../content/cancellationRefundPolicy';
import Spinner from '../components/Spinner';
import SafeImage from '../components/SafeImage';
import { getBoatPlaceholderImage } from '../lib/boatPlaceholders';
import { env } from '../config/env.js';
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

interface BookNowProps {
  onNavigate: (page: string) => void;
}

interface ApiTimeSlot {
  start: string;
  end: string;
  label: string;
  startHHMM?: string;
}

const FORECAST_LAT = 28.6122;
const FORECAST_LON = -80.8076;
const CALENDAR_INTEL_CACHE_MS = 15 * 60 * 1000;
const BUSINESS_TIMEZONE = 'America/New_York';
const SAME_DAY_MIN_NOTICE_HOURS = 2;

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
  const [searchParams] = useSearchParams();
  const bookingIdFromUrl = (searchParams.get('bookingId') || '').trim();
  const buoyInsurancePagePath =
    bookingIdFromUrl.length > 0
      ? `/insurance-required?bookingId=${encodeURIComponent(bookingIdFromUrl)}`
      : '/insurance-required';
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
    passengerCount: 4,
    charterRequestOnly: false,
    fullName: '',
    email: '',
    phone: '',
    specialRequests: '',
    /** When set, start_time at checkout uses this ISO instant (server availability slot). */
    slotStartIso: '',
  });
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
  const [rentalDurationPreset, setRentalDurationPreset] = useState<RentalDurationPreset | null>(null);
  const calendarIntelCacheRef = useRef<{ expiresAt: number; data: Map<string, DayInsight> } | null>(null);

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
        next.time = '19:00';
        next.charterType = 'night_bio';
        next.hours = 3;
      }
      if (charterType === 'rocket' || charterType === 'rocket_launch') {
        setBookingMode('charter');
        setStep(1);
        next.charterType = 'rocket_launch';
        next.hours = 4;
      }
      if (charterType === 'bio' || charterType === 'night_bio') {
        setBookingMode('charter');
        setStep(1);
        next.charterType = 'night_bio';
        next.time = '19:00';
        next.hours = 3;
      }
      if (charterType === 'sunset' || charterType === 'sunset_cruise') {
        setBookingMode('charter');
        setStep(1);
        next.charterType = 'sunset_cruise';
        next.time = '18:30';
        next.hours = 2;
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
      if (loc === 'daytona') setPrefillNotice('Booking from Daytona rentals.');
      else if (loc === 'titusville') setPrefillNotice('Booking from Titusville rentals.');
      else setPrefillNotice(null);
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

  const BIO_SHARED_PER_PERSON = 75;
  const ROCKET_SHARED_PER_PERSON = 85;
  const SUNSET_SHARED_PER_PERSON = 75;
  const BIO_SHARED_MAX_GUESTS = 2;
  const SUNSET_EXPERIENCE_SURCHARGE = 75;

  const isBioCharter = bookingMode === 'charter' && bookingData.charterType === 'night_bio';
  const isRocketCharter = bookingMode === 'charter' && bookingData.charterType === 'rocket_launch';
  const isSunsetCharter = bookingMode === 'charter' && bookingData.charterType === 'sunset_cruise';
  /** Charters that use the same confirm-details step for private vs shared (not rentals). */
  const charterUsesPrivateSharedStep = isBioCharter || isRocketCharter || isSunsetCharter;
  const isSharedTour =
    bookingMode === 'charter' &&
    bookingData.charterVariant === 'shared' &&
    (bookingData.charterType === 'night_bio' ||
      bookingData.charterType === 'rocket_launch' ||
      bookingData.charterType === 'sunset_cruise');
  const sharedTourPerPerson = (() => {
    if (!isSharedTour) return BIO_SHARED_PER_PERSON;
    if (bookingData.charterType === 'night_bio') return BIO_SHARED_PER_PERSON;
    if (bookingData.charterType === 'rocket_launch') return ROCKET_SHARED_PER_PERSON;
    return SUNSET_SHARED_PER_PERSON;
  })();
  const sharedTourOverLimit =
    isSharedTour && bookingData.passengerCount > BIO_SHARED_MAX_GUESTS;
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
    if (!env.apiUrlConfigured || !env.apiUrl || !selectedBoat?.id) {
      setAvailabilityByDate(new Map());
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
  }, [selectedBoat?.id, durationHoursForAvailability, env.apiUrl, env.apiUrlConfigured]);

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
        const slots = data.slots || [];
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
    selectedBoat?.id,
    bookingData.date,
    durationHoursForAvailability,
    env.apiUrl,
    env.apiUrlConfigured,
    bookingMode,
    rentalDurationPreset,
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
    Boolean(selectedBoat);
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
    noSlotsForDay;

  const CHARTER_EXPERIENCE_LABEL: Record<CharterType, string> = {
    rocket_launch: 'Rocket launch charter',
    night_bio: 'Bioluminescence night charter',
    sunset_cruise: 'Sunset cruise',
  };

  const CHARTER_INCLUSIONS_LINE = 'Captain & fuel included · No security deposit';

  const charterSelectedDescription = (): string => {
    const t = bookingData.charterType;
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
          ? 'Sunset Cruise'
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

  function calculateCharterPrice({
    basePrice,
    date,
    experience,
  }: {
    basePrice: number;
    date: string;
    experience: string;
  }) {
    const d = new Date(date).getDay();
    const month = new Date(date).getMonth() + 1;
    const isWeekend = d === 5 || d === 6 || d === 0;

    const exp = experience.toLowerCase();
    const isRocketLaunch = exp.includes('rocket');
    const isNight = exp.includes('night');
    const isBioTour = exp.includes('bio');
    const isSunset = exp.includes('sunset');
    const isPeakBioSeason = isBioTour && month >= 6 && month <= 9;

    const weekendSurcharge = isWeekend ? 75 : 0;
    const rocketLaunchSurcharge = isRocketLaunch ? (isNight ? 200 : 150) : 0;
    const bioTourSurcharge = isBioTour ? 100 : 0;
    const sunsetExperienceSurcharge = isSunset ? SUNSET_EXPERIENCE_SURCHARGE : 0;
    const nightExperienceSurcharge = isNight ? 50 : 0;
    const peakSeasonSurcharge = isPeakBioSeason ? 50 : 0;

    const total =
      basePrice +
      weekendSurcharge +
      rocketLaunchSurcharge +
      bioTourSurcharge +
      sunsetExperienceSurcharge +
      nightExperienceSurcharge +
      peakSeasonSurcharge;

    return {
      weekendSurcharge,
      rocketLaunchSurcharge,
      bioTourSurcharge,
      sunsetExperienceSurcharge,
      nightExperienceSurcharge,
      peakSeasonSurcharge,
      total,
    };
  }

  function charterBasePriceForBoat(boat: Boat | null, hours: number): number {
    if (!boat) return 0;
    const hourly = Number(boat.hourly_rate);
    const duration = Math.max(0, Number(hours) || 0);
    return Number((hourly * duration).toFixed(2));
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
    const guests = Math.min(BIO_SHARED_MAX_GUESTS, Math.max(1, Number(bookingData.passengerCount) || 1));

    if (bookingData.charterType === 'night_bio' && bookingData.charterVariant === 'shared') {
      const sharedTotal = guests * BIO_SHARED_PER_PERSON;
      return {
        basePrice: Number(sharedTotal),
        captainFee: 0,
        deposit: 0,
        weekendSurcharge: 0,
        rocketLaunchSurcharge: 0,
        bioTourSurcharge: 0,
        sunsetExperienceSurcharge: 0,
        nightExperienceSurcharge: 0,
        peakSeasonSurcharge: 0,
        total: Number(sharedTotal),
      };
    }

    if (bookingData.charterType === 'rocket_launch' && bookingData.charterVariant === 'shared') {
      const sharedTotal = guests * ROCKET_SHARED_PER_PERSON;
      return {
        basePrice: Number(sharedTotal),
        captainFee: 0,
        deposit: 0,
        weekendSurcharge: 0,
        rocketLaunchSurcharge: 0,
        bioTourSurcharge: 0,
        sunsetExperienceSurcharge: 0,
        nightExperienceSurcharge: 0,
        peakSeasonSurcharge: 0,
        total: Number(sharedTotal),
      };
    }

    if (bookingData.charterType === 'sunset_cruise' && bookingData.charterVariant === 'shared') {
      const sharedTotal = guests * SUNSET_SHARED_PER_PERSON;
      return {
        basePrice: Number(sharedTotal),
        captainFee: 0,
        deposit: 0,
        weekendSurcharge: 0,
        rocketLaunchSurcharge: 0,
        bioTourSurcharge: 0,
        sunsetExperienceSurcharge: 0,
        nightExperienceSurcharge: 0,
        peakSeasonSurcharge: 0,
        total: Number(sharedTotal),
      };
    }

    const basePrice = charterBasePriceForBoat(selectedBoat, bookingData.hours);

    const experience = charterSelectedDescription();
    const priceCalc = calculateCharterPrice({
      basePrice: Number(basePrice),
      date: bookingData.date,
      experience,
    });

    return {
      basePrice: Number(basePrice),
      captainFee: 0,
      deposit: 0,
      weekendSurcharge: Number(priceCalc.weekendSurcharge),
      rocketLaunchSurcharge: Number(priceCalc.rocketLaunchSurcharge),
      bioTourSurcharge: Number(priceCalc.bioTourSurcharge),
      sunsetExperienceSurcharge: Number(priceCalc.sunsetExperienceSurcharge),
      nightExperienceSurcharge: Number(priceCalc.nightExperienceSurcharge),
      peakSeasonSurcharge: Number(priceCalc.peakSeasonSurcharge),
      total: Number(priceCalc.total),
    };
  };

  const pricing = bookingMode === 'rental' ? calculateRentalPricing() : calculateCharterPricing();
  const amountDueToday = bookingMode === 'rental' ? Number((pricing.total * 0.5).toFixed(2)) : pricing.total;
  const balanceBeforePickup = Number((pricing.total - amountDueToday).toFixed(2));
  const waiverComplete = waiverData.agreed && waiverData.signature.trim().length > 0;
  const checkoutRequirementsMet =
    termsAccepted && waiverComplete && damageFeeAcknowledged;
  const licensePreviewUrl = verificationData.licenseProofUrl.trim();
  const insurancePreviewUrl = verificationData.insuranceProofUrl.trim();
  const rentalInsuranceMissing = bookingMode === 'rental' && !insurancePreviewUrl;
  const charterNeedsBoatSelection =
    bookingMode === 'charter' && !isSharedTour && !selectedBoat;
  const charterPd =
    isSharedTour
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
          primary: `Full charter total: $${pricing.total.toFixed(2)}`,
          sub: 'Per boat',
        };

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const checkoutPerf = beginAsyncInteraction('checkout_submit');

    if (!selectedBoat) {
      alert('Please select a boat.');
      checkoutPerf.end('aborted_no_boat');
      return;
    }
    if (!bookingData.date || !bookingData.fullName || !bookingData.email || !bookingData.phone) {
      alert(
        bookingMode === 'charter'
          ? 'Please complete your contact information and trip date.'
          : 'Please complete your contact information and rental date.'
      );
      checkoutPerf.end('aborted_form_incomplete');
      return;
    }

    if (bookingMode === 'charter' && sharedTourOverLimit) {
      setCheckoutError(
        `Shared bookings are limited to ${BIO_SHARED_MAX_GUESTS} guests per reservation.`
      );
      checkoutPerf.end('aborted_shared_limit');
      return;
    }

    const licenseUrl = bookingMode === 'rental' ? verificationData.licenseProofUrl.trim() : '';
    const insuranceUrl = bookingMode === 'rental' ? verificationData.insuranceProofUrl.trim() : '';
    setCheckoutError(null);

    if (!checkoutRequirementsMet) {
      setCheckoutError(
        'Please accept Terms, accept the waiver, acknowledge financial responsibility, and provide your signature before payment.'
      );
      checkoutPerf.end('aborted_missing_required_ack');
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
      const startDateTime = bookingData.slotStartIso.trim()
        ? new Date(bookingData.slotStartIso.trim())
        : new Date(`${bookingData.date}T${bookingData.time}`);
      const endDateTime = new Date(
        startDateTime.getTime() + bookingData.hours * 60 * 60 * 1000
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
              boat_id: selectedBoat.id,
              start_time: startDateTime.toISOString(),
              end_time: endDateTime.toISOString(),
              duration_hours: bookingData.hours,
              rental_type: bookingData.rentalType,
              captain_included: bookingMode === 'charter' ? true : bookingData.captainIncluded,
              captain_fee: bookingMode === 'charter' ? 0 : pricing.captainFee,
              base_price: pricing.basePrice,
              peak_surcharge: 0,
              security_deposit: bookingMode === 'charter' ? 0 : pricing.deposit,
              total_price: pricing.total,
              deposit_amount: depositAmount,
              balance_due: pricing.total - depositAmount,
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
              charterVariant: bookingMode === 'charter' ? bookingData.charterVariant : null,
              passengerCount:
                bookingMode === 'charter'
                  ? bookingData.charterVariant === 'shared'
                    ? Math.min(BIO_SHARED_MAX_GUESTS, Math.max(1, Number(bookingData.passengerCount) || 1))
                    : Math.min(6, Math.max(1, Number(bookingData.passengerCount) || 1))
                  : 1,
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
              accepted: waiverComplete,
            },
            legal: {
              termsAccepted,
              damageFeeAcknowledged,
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
      let sessionPayload: { url?: string; error?: string; message?: string } = {};
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

      if (apiMessage) {
        if (import.meta.env.DEV) {
          console.warn('[create-checkout-session] API error:', apiMessage);
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
              {insight.score.toFixed(1)}/10
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
          <h1 className="lz-page-hero-heading font-display text-white">Book your adventure</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-300 md:text-lg">
            {showNeutralChooser
              ? 'Choose a captain-led charter or a self-drive rental, then pick your boat and schedule. Charters and rentals use different pricing and requirements — your selections below set the right path.'
              : bookingMode === 'charter'
                ? 'Choose your charter experience and boat, see your all-in price, then check out. Captain & fuel included; no security deposit.'
                : 'Pick your boat and schedule, add options, then check out with Stripe: today you pay 50% of your reservation total (which includes the refundable $300 security deposit). After checkout we verify compliance details and approvals.'}
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-xs leading-snug text-slate-500 md:text-sm">
            <Sparkles className="mr-1 inline-block h-3.5 w-3.5 text-cyan-400/80" aria-hidden />
            Rocket-launch and weekend dates are popular — book early when you can.
          </p>
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
                    onClick={() => {
                      setBookingMode('charter');
                      setBookingData((prev) => ({
                        ...prev,
                        captainIncluded: true,
                        charterType: 'rocket_launch',
                        charterVariant: 'private',
                        passengerCount: 6,
                        rentalType: 'half_day',
                        hours: 4,
                      }));
                      setStep(1);
                    }}
                    className={`min-h-[120px] rounded-2xl border p-5 text-left transition active:scale-[0.99] md:p-6 ${bookingChoiceIdle}`}
                  >
                    <span className="text-2xl" aria-hidden>
                      🚀
                    </span>
                    <p className="mt-3 text-lg font-bold text-white">Rocket Launch Charter</p>
                    <p className="mt-2 text-sm text-slate-400">On-water launch viewing · typical 4-hour window</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBookingMode('charter');
                      setBookingData((prev) => ({
                        ...prev,
                        captainIncluded: true,
                        charterType: 'night_bio',
                        charterVariant: 'private',
                        passengerCount: 6,
                        rentalType: 'half_day',
                        hours: 3,
                        time: '19:00',
                      }));
                      setStep(1);
                    }}
                    className={`min-h-[120px] rounded-2xl border p-5 text-left transition active:scale-[0.99] md:p-6 ${bookingChoiceIdle}`}
                  >
                    <span className="text-2xl" aria-hidden>
                      ✨
                    </span>
                    <p className="mt-3 text-lg font-bold text-white">Bioluminescence Tour</p>
                    <p className="mt-2 text-sm text-slate-400">Night glow on the lagoon · ~3 hours</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBookingMode('charter');
                      setBookingData((prev) => ({
                        ...prev,
                        captainIncluded: true,
                        charterType: 'sunset_cruise',
                        charterVariant: 'private',
                        passengerCount: 6,
                        rentalType: 'half_day',
                        hours: 2,
                        time: '18:30',
                      }));
                      setStep(1);
                    }}
                    className={`min-h-[120px] rounded-2xl border p-5 text-left transition active:scale-[0.99] md:p-6 ${bookingChoiceIdle}`}
                  >
                    <span className="text-2xl" aria-hidden>
                      🌅
                    </span>
                    <p className="mt-3 text-lg font-bold text-white">Sunset Cruise</p>
                    <p className="mt-2 text-sm text-slate-400">Golden hour on the water · ~2 hours</p>
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
                    ? 'Pick your boat, then choose date and start time together.'
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
                      onClick={() => setStep(0)}
                      className="shrink-0 text-sm font-semibold text-cyan-400 underline decoration-cyan-500/30 hover:text-cyan-300"
                    >
                      Change
                    </button>
                  </div>
                )}

                <h3 className={`${bookingSectionTitle} mb-0`}>
                  {bookingMode === 'charter' ? 'Choose your boat' : 'Choose your boat'}
                </h3>
                {bookingMode === 'charter' ? (
                  <p className="mt-1 text-sm text-slate-400">
                    Tap an option. Pricing updates after both boat and date are set.
                  </p>
                ) : null}
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
                      const showDateUnavailable =
                        bookingMode === 'charter' &&
                        Boolean(bookingData.date) &&
                        isSelected &&
                        dateMarkedUnavailable;
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
                            {showDateUnavailable && (
                              <span className="absolute bottom-3 left-3 right-3 rounded-lg border border-amber-400/40 bg-black/70 px-3 py-2 text-center text-xs font-semibold text-amber-100 backdrop-blur-sm">
                                Unavailable for selected date
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
                                {conditionsByDate.get(bestDayToBook.iso)?.score.toFixed(1) ?? '—'}/10
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
                              return (
                                <button
                                  key={s.start}
                                  type="button"
                                  onClick={() => {
                                    const t0 = performance.now();
                                    setBookingData({
                                      ...bookingData,
                                      slotStartIso: s.start,
                                      time: s.startHHMM ?? bookingData.time,
                                    });
                                    measurePaintAfterSync('booknow_charter_time_slot', t0, performance.now());
                                  }}
                                  className={`min-h-[48px] min-w-[5.5rem] rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                                    active
                                      ? bookingSlotChipActive
                                      : recommended
                                        ? `${bookingSlotChipRecommended} border`
                                        : `border ${bookingChoiceIdle}`
                                  }`}
                                >
                                  {s.label}
                                  {recommended && !active && (
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
                                {conditionsByDate.get(bestDayToBook.iso)?.score.toFixed(1) ?? '—'}/10
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
                    if (selectedBoat && bookingData.date && !scheduleContinueBlocked) {
                      setStep(bookingMode === 'charter' && !charterUsesPrivateSharedStep ? 3 : 2);
                    }
                  })}
                  disabled={!selectedBoat || !bookingData.date || scheduleContinueBlocked}
                  className={`${bookingPrimaryCta} mt-8 md:mt-10`}
                >
                  Continue
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
                      ? 'Your total and inclusions are set. Choose private (one total) or shared ($75 per person) below.'
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
                      maxSharedGuests={BIO_SHARED_MAX_GUESTS}
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
                  {isRocketCharter && (
                    <CharterPrivateSharedTourBlock
                      sectionTitle="ROCKET LAUNCH: PRIVATE OR SHARED"
                      perPerson={ROCKET_SHARED_PER_PERSON}
                      maxSharedGuests={BIO_SHARED_MAX_GUESTS}
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
                  {isSunsetCharter && (
                    <CharterPrivateSharedTourBlock
                      sectionTitle="Sunset cruise: private or shared"
                      perPerson={SUNSET_SHARED_PER_PERSON}
                      maxSharedGuests={BIO_SHARED_MAX_GUESTS}
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

                <h3 className="mt-10 text-sm font-bold uppercase tracking-widest text-cyan-200/90">Waiver</h3>
                <div className="mt-4 max-h-80 overflow-y-auto rounded-[var(--lz-radius)] border border-white/10 bg-slate-950/60 p-5">
                  <h4 className="text-base font-bold text-white">Florida Boating Liability Waiver</h4>
                  <div className="prose prose-sm prose-invert mt-4 max-w-none space-y-4 text-slate-300">
                    <p>
                      By signing this waiver, I acknowledge and agree to the following terms and conditions:
                    </p>
                    <h4 className="!mt-0 font-semibold text-slate-100">Assumption of Risk</h4>
                    <p>
                      I understand that boating activities involve inherent risks including but not limited to:
                      injury, death, property damage, weather hazards, marine hazards, and equipment failure. I
                      voluntarily assume all such risks.
                    </p>
                    <h4 className="font-semibold text-slate-100">Release of Liability</h4>
                    <p>
                      I hereby release, waive, discharge, and covenant not to sue Launch Zone Charters, its
                      owners, employees, and agents from any and all liability for injury, death, or property
                      damage arising from my participation in boating activities.
                    </p>
                    <h4 className="font-semibold text-slate-100">Indemnification</h4>
                    <p>
                      I agree to indemnify and hold harmless Launch Zone Charters from any claims, damages,
                      or expenses arising from my use of the rental vessel.
                    </p>
                    <h4 className="font-semibold text-slate-100">Acknowledgments</h4>
                    <ul className="list-disc list-inside space-y-1">
                      {bookingMode === 'rental' ? (
                        <>
                          <li>I am at least 25 years of age</li>
                          <li>I possess a valid boating license (if operating the vessel)</li>
                          <li>I am physically capable of operating the vessel safely</li>
                          <li>I will follow all maritime laws and regulations</li>
                          <li>I am responsible for all passengers and their safety</li>
                          <li>I am responsible for any damage to the vessel beyond normal wear and tear</li>
                          <li>I understand late return fees apply</li>
                        </>
                      ) : (
                        <>
                          <li>I will follow captain safety instructions at all times.</li>
                          <li>I understand charter timing can shift for weather and launch delays.</li>
                          <li>I acknowledge reschedule rules for launch and marine conditions.</li>
                        </>
                      )}
                    </ul>
                    <h4 className="!mt-6 font-semibold text-slate-100">{CANCELLATION_REFUND_POLICY_TITLE}</h4>
                    <div className="space-y-3">
                      {CANCELLATION_REFUND_POLICY_SUBSECTIONS.map(({ heading, body }) => (
                        <p key={heading} className="text-sm leading-relaxed">
                          <strong className="text-slate-200">{heading}:</strong> {body}
                        </p>
                      ))}
                      <p className="mt-4 border-t border-white/10 pt-4 text-sm leading-relaxed text-slate-300">
                        {CANCELLATION_REFUND_POLICY_WAIVER_ACKNOWLEDGMENT}
                      </p>
                    </div>
                    {bookingMode === 'rental' && (
                      <>
                        <h4 className="!mt-6 font-semibold text-slate-100">Security deposit</h4>
                        <p>{SECURITY_DEPOSIT_TERMS_PARAGRAPH}</p>
                        <p className="text-sm">
                          <strong className="text-slate-200">Authorization.</strong>{' '}
                          {SECURITY_DEPOSIT_AUTHORIZATION_CLAUSE}
                        </p>
                      </>
                    )}
                    <p className="text-sm italic">
                      For full terms and conditions, see our{' '}
                      <button
                        type="button"
                        onClick={() => onNavigate('terms')}
                        className="font-semibold text-cyan-400 underline decoration-cyan-500/40 hover:text-cyan-300"
                      >
                        Terms & Conditions page
                      </button>
                      .
                    </p>
                  </div>
                </div>

                <h3 className="mt-10 text-sm font-bold uppercase tracking-widest text-cyan-200/90">
                  {bookingMode === 'rental' ? 'Agreement & documents' : 'Agreement'}
                </h3>
                <div className="mt-4 space-y-6">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id="agreeTerms"
                      checked={termsAccepted}
                      onChange={(e) => setTermsAccepted(e.target.checked)}
                      className="mt-1 h-5 w-5 shrink-0 rounded border-white/20 text-[var(--lz-cta)] focus:ring-cyan-500/40"
                    />
                    <label htmlFor="agreeTerms" className="text-sm font-semibold text-slate-100">
                      I have read and agree to the Terms &amp; Conditions.
                    </label>
                  </div>
                  <p className="-mt-3 pl-8 text-xs text-slate-400">
                    Review full terms here:{' '}
                    <button
                      type="button"
                      onClick={() => onNavigate('terms')}
                      className="font-semibold text-cyan-400 underline decoration-cyan-500/40 hover:text-cyan-300"
                    >
                      Terms &amp; Conditions
                    </button>
                    .
                  </p>

                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id="agree"
                      checked={waiverData.agreed}
                      onChange={(e) => setWaiverData({ ...waiverData, agreed: e.target.checked })}
                      className="mt-1 h-5 w-5 shrink-0 rounded border-white/20 text-[var(--lz-cta)] focus:ring-cyan-500/40"
                    />
                    <label htmlFor="agree" className="text-sm font-semibold text-slate-100">
                      I have read and agree to the waiver terms above.
                    </label>
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Electronic signature
                    </label>
                    <input
                      type="text"
                      value={waiverData.signature}
                      onChange={(e) => setWaiverData({ ...waiverData, signature: e.target.value })}
                      className={fieldClass}
                      placeholder="Type your full legal name"
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Electronic signature is required before payment. By typing your name, you agree this
                      constitutes a legal electronic signature when the waiver checkbox is checked.
                    </p>
                  </div>

                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id="damageAck"
                      checked={damageFeeAcknowledged}
                      onChange={(e) => setDamageFeeAcknowledged(e.target.checked)}
                      className="mt-1 h-5 w-5 shrink-0 rounded border-white/20 text-[var(--lz-cta)] focus:ring-cyan-500/40"
                    />
                    <label htmlFor="damageAck" className="text-sm font-semibold text-slate-100">
                      I understand I am financially responsible for damage, prop strikes, grounding, towing,
                      excessive cleaning, and missing equipment.
                    </label>
                  </div>

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
                        After purchasing, upload a screenshot or paste your Buoy confirmation link below.
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
                </div>

                <div className="mb-6 rounded-[var(--lz-radius)] border border-cyan-400/20 bg-slate-950/80 p-6 text-slate-100 shadow-[0_0_28px_rgba(0,207,255,0.08)]">
                  <h3 className="mb-4 text-lg font-bold uppercase tracking-wide text-white">Booking summary</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span>Boat:</span>
                      <span className="font-semibold">{selectedBoat?.name}</span>
                    </div>
                    {bookingMode === 'charter' && (
                      <div className="flex justify-between text-slate-300">
                        <span>Experience:</span>
                        <span className="font-semibold text-right">{charterSelectedDescription()}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Date & Time:</span>
                      <span className="font-semibold text-right">
                        {bookingData.date}
                        {' · '}
                        {bookingData.slotStartIso
                          ? timeSlots.find((s) => s.start === bookingData.slotStartIso)?.label ??
                            new Date(bookingData.slotStartIso).toLocaleTimeString(undefined, {
                              hour: 'numeric',
                              minute: '2-digit',
                            })
                          : bookingData.time}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>
                        {bookingMode === 'charter' ? 'Charter duration (included):' : 'Duration:'}
                      </span>
                      <span className="font-semibold">{bookingData.hours} hours</span>
                    </div>
                    <div className="my-3 border-t border-white/10"></div>
                    {isSharedTour ? (
                      <div className="flex justify-between text-slate-300">
                        <span>
                          Shared rate: ${sharedTourPerPerson} × {bookingData.passengerCount} guests
                        </span>
                        <span>${pricing.total.toFixed(2)}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between">
                          <span>{bookingMode === 'charter' ? 'Charter base:' : 'Base rental:'}</span>
                          <span>${pricing.basePrice.toFixed(2)}</span>
                        </div>
                        {bookingMode === 'charter' && pricing.weekendSurcharge > 0 && (
                          <div className="flex justify-between text-slate-300">
                            <span>Weekend:</span>
                            <span>+${pricing.weekendSurcharge.toFixed(2)}</span>
                          </div>
                        )}
                        {bookingMode === 'charter' && pricing.rocketLaunchSurcharge > 0 && (
                          <div className="flex justify-between text-slate-300">
                            <span>Rocket Launch:</span>
                            <span>+${pricing.rocketLaunchSurcharge.toFixed(2)}</span>
                          </div>
                        )}
                        {bookingMode === 'charter' && pricing.bioTourSurcharge > 0 && (
                          <div>
                            <div className="flex justify-between text-slate-300">
                              <span>Bioluminescence:</span>
                              <span>+${pricing.bioTourSurcharge.toFixed(2)}</span>
                            </div>
                            {pricing.peakSeasonSurcharge > 0 && (
                              <p className="mt-1 text-xs text-cyan-200/90">
                                ✨ Peak glow season — best viewing conditions
                              </p>
                            )}
                          </div>
                        )}
                        {bookingMode === 'charter' && pricing.sunsetExperienceSurcharge > 0 && (
                          <div className="flex justify-between text-slate-300">
                            <span>Sunset experience:</span>
                            <span>+${pricing.sunsetExperienceSurcharge.toFixed(2)}</span>
                          </div>
                        )}
                        {bookingMode === 'charter' && pricing.nightExperienceSurcharge > 0 && (
                          <div className="flex justify-between text-slate-300">
                            <span>Night Experience:</span>
                            <span>+${pricing.nightExperienceSurcharge.toFixed(2)}</span>
                          </div>
                        )}
                        {bookingMode === 'charter' && pricing.peakSeasonSurcharge > 0 && (
                          <div className="flex justify-between text-slate-300">
                            <span>Peak Season:</span>
                            <span>+${pricing.peakSeasonSurcharge.toFixed(2)}</span>
                          </div>
                        )}
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
                      <span className="text-[var(--lz-cta)]">${pricing.total.toFixed(2)}</span>
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
                        Cancellation terms are in our FAQ &amp; Terms; contact us if your plans change.
                      </p>
                    </div>
                  </div>
                </div>

                {checkoutError && (
                  <div
                    className="mb-4 rounded-[var(--lz-radius)] border border-red-400/40 bg-red-950/50 px-4 py-3 text-sm text-red-100"
                    role="alert"
                  >
                    {checkoutError}
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
                        <span>Book now</span>
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
                  Up to 6 guests
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
