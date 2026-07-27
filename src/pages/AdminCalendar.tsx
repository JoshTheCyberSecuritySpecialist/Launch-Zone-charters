import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, MoreVertical, Pencil, RefreshCw, Undo2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import StatusBadge from '../components/admin/StatusBadge';
import { humanizeLabel } from '../components/admin/adminDisplay';
import { env } from '../config/env.js';
import { adminCharterCapacityLines, isCaptainLedCharter } from '../lib/charterCapacity';
import { fetchActiveCaptains, type AdminCaptainListItem } from '../lib/adminCaptains';

type CalendarView = 'day' | 'week' | 'month';

type BoatRow = { id: string; name: string; type?: string | null };

type CalendarBooking = {
  id: string;
  customer_name: string;
  customer_phone?: string | null;
  customer_email?: string | null;
  boat_id: string | null;
  boat_name: string;
  captain_id?: string | null;
  captain_name?: string | null;
  start_time: string;
  end_time: string;
  duration_hours: number | string | null;
  status: string;
  payment_status: string | null;
  booking_source: string | null;
  staff_created: boolean | null;
  rental_location: string | null;
  booking_type: string | null;
  charter_type: string | null;
  guest_count?: number | null;
  total_price?: number | string | null;
  staff_notes?: string | null;
};

type BlockedDate = {
  id: string;
  boat_id: string | null;
  start_time: string;
  end_time: string;
  title?: string | null;
  reason?: string | null;
  location?: string | null;
  all_day?: boolean;
  notes?: string | null;
};

type CalendarItem = {
  id: string;
  item_type: 'blocked_time' | 'admin_duty';
  title: string;
  reason?: string | null;
  duty_type?: string | null;
  assigned_to?: string | null;
  boat_id?: string | null;
  location?: string | null;
  start_time: string;
  end_time: string;
  all_day: boolean;
  blocks_availability: boolean;
  block_scope?: string | null;
  block_source?: string | null;
  priority: 'low' | 'normal' | 'high';
  notes?: string | null;
  completed: boolean;
};

type ChoiceSlot = { date: string; hour: number; boatId?: string | null } | null;

type CalendarItemForm = {
  id?: string;
  itemType: 'blocked_time' | 'admin_duty';
  step: number;
  title: string;
  reason: string;
  dutyType: string;
  assignedTo: string;
  boatId: string;
  location: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  blocksAvailability: boolean;
  priority: 'low' | 'normal' | 'high';
  notes: string;
  completed: boolean;
  saveAnyway?: boolean;
};

type DragMode = 'move' | 'resize-start' | 'resize-end';

type DragDraft = {
  booking: CalendarBooking;
  mode: DragMode;
};

type MovePreview = {
  booking: CalendarBooking;
  mode: DragMode;
  boatId: string;
  date: string;
  hour: number;
  oldStart: string;
  oldEnd: string;
  newStart: string;
  newEnd: string;
  available: boolean;
  reason?: string;
};

type QuickMenuState = {
  booking: CalendarBooking;
  x: number;
  y: number;
};

type ItemMenuState = {
  item: CalendarItem;
  x: number;
  y: number;
};

type CharterCaptainConflict = {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  charter_type?: string | null;
  customer_name: string;
};

type CharterCaptainForm = {
  step: number;
  startDate: string;
  endDate: string;
  saving: boolean;
  conflictCount: number;
  conflicts: CharterCaptainConflict[];
};

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfWeek = (d: Date) => addDays(startOfDay(d), -startOfDay(d).getDay());
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const hours = Array.from({ length: 24 }, (_, i) => i);
const blockingStatuses = new Set(['hold', 'pending', 'pending_verification', 'confirmed', 'ready_for_departure', 'completed']);
const blankItemForm = (itemType: 'blocked_time' | 'admin_duty', date = todayYmd(), hour = 9, boatId = ''): CalendarItemForm => ({
  itemType,
  step: 1,
  title: itemType === 'blocked_time' ? 'Blocked Time' : 'Admin Duty',
  reason: '',
  dutyType: '',
  assignedTo: '',
  boatId: boatId || '',
  location: '',
  date,
  endDate: date,
  startTime: `${pad(hour)}:00`,
  endTime: `${pad(Math.min(hour + 1, 23))}:00`,
  allDay: false,
  blocksAvailability: itemType === 'blocked_time',
  priority: 'normal',
  notes: '',
  completed: false,
});

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function nextWeekCharterRange() {
  const d = new Date();
  const day = d.getDay();
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  const monday = addDays(startOfDay(d), daysUntilMonday);
  const sunday = addDays(monday, 6);
  return { startDate: ymd(monday), endDate: ymd(sunday) };
}

function nextMonthCharterRange() {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 2, 0);
  return { startDate: ymd(first), endDate: ymd(last) };
}

function viewRange(view: CalendarView, anchor: Date) {
  if (view === 'day') {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 1), days: [from] };
  }
  if (view === 'month') {
    const first = startOfMonth(anchor);
    const from = startOfWeek(first);
    const to = addDays(startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)), 7);
    const days = [];
    for (let d = from; d < to; d = addDays(d, 1)) days.push(d);
    return { from, to, days };
  }
  const from = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return { from, to: addDays(from, 7), days };
}

function dateTimeLocal(date: string, hour: number) {
  return `${date}T${pad(hour)}:00`;
}

function isoAtLocalHour(date: string, hour: number) {
  return new Date(dateTimeLocal(date, hour)).toISOString();
}

function hhmmFromIso(iso: string) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}

function timeLabel(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  if (!Number.isFinite(s.getTime())) return '-';
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return `${s.toLocaleTimeString([], opts)} - ${e.toLocaleTimeString([], opts)}`;
}

function durationHours(start: string, end: string) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  return Math.round(((e - s) / 36e5) * 100) / 100;
}

function cardClass(booking: CalendarBooking) {
  if (booking.status === 'cancelled') return 'border-red-200 bg-red-100 text-red-950';
  if (booking.status === 'completed') return 'border-slate-200 bg-slate-200 text-slate-800';
  if (booking.status === 'hold') return 'border-orange-200 bg-orange-100 text-orange-950';
  if (
    booking.booking_source === 'groupon' &&
    (booking.status === 'pending_verification' || booking.status === 'pending')
  ) {
    return 'border-fuchsia-300 bg-fuchsia-100 text-fuchsia-950 ring-1 ring-fuchsia-300';
  }
  if (
    isCaptainLedCharter(booking) &&
    !booking.captain_id &&
    ['confirmed', 'ready_for_departure'].includes(booking.status)
  ) {
    return 'border-amber-400 bg-amber-100 text-amber-950 ring-1 ring-amber-300';
  }
  if (booking.booking_type === 'charter') return 'border-purple-200 bg-purple-100 text-purple-950';
  if (booking.staff_created || booking.booking_source === 'admin') return 'border-green-200 bg-green-100 text-green-950';
  return 'border-blue-200 bg-blue-100 text-blue-950';
}

function calendarEventTitle(booking: CalendarBooking, compact = false) {
  const guests = booking.guest_count || 1;
  if (
    booking.booking_source === 'groupon' &&
    (booking.status === 'pending_verification' || booking.status === 'pending')
  ) {
    if (compact) return `${hhmmFromIso(booking.start_time)} PENDING GROUPON`;
    return `PENDING GROUPON — ${booking.customer_name} — ${guests} guest${guests === 1 ? '' : 's'}`;
  }
  if (compact) return `${hhmmFromIso(booking.start_time)} ${booking.customer_name}`;
  return booking.customer_name;
}

function captainAssignmentLine(booking: CalendarBooking) {
  if (!isCaptainLedCharter(booking)) return null;
  if (booking.captain_name) return `Captain: ${booking.captain_name}`;
  return 'Captain: Unassigned';
}

function sourceLabel(booking: CalendarBooking) {
  if (booking.staff_created || booking.booking_source === 'admin') return 'Staff';
  return booking.booking_source || 'Website';
}

function charterCapacityBlock(booking: CalendarBooking, compact = false) {
  if (!isCaptainLedCharter(booking)) return null;
  const lines = adminCharterCapacityLines(booking.guest_count || 1);
  return (
    <div className={compact ? 'mt-0.5 space-y-0 text-[10px] leading-tight opacity-90' : 'mt-1 space-y-0.5 text-[11px] leading-snug'}>
      <div>{lines.passengerLine}</div>
      <div>{lines.captainLine}</div>
      <div>{lines.totalLine}</div>
    </div>
  );
}

function intervalsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  const aS = new Date(aStart).getTime();
  const aE = new Date(aEnd).getTime();
  const bS = new Date(bStart).getTime();
  const bE = new Date(bEnd).getTime();
  return Number.isFinite(aS + aE + bS + bE) && aS < bE && aE > bS;
}

function nextRangeForDrop(draft: DragDraft, date: string, hour: number, boatId: string) {
  const durationMs = new Date(draft.booking.end_time).getTime() - new Date(draft.booking.start_time).getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;

  if (draft.mode === 'move') {
    const start = new Date(isoAtLocalHour(date, hour));
    const end = new Date(start.getTime() + durationMs);
    return { startIso: start.toISOString(), endIso: end.toISOString(), boatId };
  }
  if (draft.mode === 'resize-start') {
    const startIso = isoAtLocalHour(date, hour);
    if (new Date(startIso).getTime() >= new Date(draft.booking.end_time).getTime()) return null;
    return { startIso, endIso: draft.booking.end_time, boatId };
  }

  const endIso = isoAtLocalHour(date, hour + 1);
  if (new Date(endIso).getTime() <= new Date(draft.booking.start_time).getTime()) return null;
  return { startIso: draft.booking.start_time, endIso, boatId };
}

export default function AdminCalendar() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<CalendarView>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'day' : 'week'
  );
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  );
  const [anchor, setAnchor] = useState(() => new Date());
  const [boats, setBoats] = useState<BoatRow[]>([]);
  const [captains, setCaptains] = useState<AdminCaptainListItem[]>([]);
  const [bookings, setBookings] = useState<CalendarBooking[]>([]);
  const [blockedDates, setBlockedDates] = useState<BlockedDate[]>([]);
  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragDraft, setDragDraft] = useState<DragDraft | null>(null);
  const [hoverPreview, setHoverPreview] = useState<MovePreview | null>(null);
  const [pendingMove, setPendingMove] = useState<MovePreview | null>(null);
  const [quickMenu, setQuickMenu] = useState<QuickMenuState | null>(null);
  const [itemMenu, setItemMenu] = useState<ItemMenuState | null>(null);
  const [choiceSlot, setChoiceSlot] = useState<ChoiceSlot>(null);
  const [itemForm, setItemForm] = useState<CalendarItemForm | null>(null);
  const [itemConflicts, setItemConflicts] = useState<any | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const [captainForm, setCaptainForm] = useState<CharterCaptainForm | null>(null);
  const [undoMove, setUndoMove] = useState<{ booking: CalendarBooking; expiresAt: number } | null>(null);
  const undoTimer = useRef<number | null>(null);
  const [filters, setFilters] = useState({
    location: '',
    boatId: '',
    bookingType: '',
    status: '',
    source: '',
    search: '',
    captainId: '',
    unassignedCaptain: false,
    showBookings: true,
    showHolds: true,
    showBlocks: true,
    showDuties: true,
    showCompletedDuties: false,
  });

  const range = useMemo(() => viewRange(view, anchor), [anchor, view]);

  const getAdminToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }, []);

  const authedFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      if (!env.apiUrlConfigured || !env.apiUrl) throw new Error('API URL is not configured.');
      const token = await getAdminToken();
      if (!token) throw new Error('Admin session expired.');
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

  useEffect(() => {
    if (!isAdmin) return;
    fetch(`${env.apiUrl}/api/boats`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Could not load boats.'))))
      .then((payload: { boats?: BoatRow[] }) => setBoats(Array.isArray(payload.boats) ? payload.boats : []))
      .catch((err) => setNotice(err instanceof Error ? err.message : 'Could not load boats.'));
    void fetchActiveCaptains()
      .then(setCaptains)
      .catch(() => setCaptains([]));
  }, [isAdmin]);

  const loadBookings = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setNotice(null);
    try {
      const params = new URLSearchParams({
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      });
      if (filters.location) params.set('location', filters.location);
      if (filters.boatId) params.set('boatId', filters.boatId);
      if (filters.bookingType) params.set('bookingType', filters.bookingType);
      if (filters.status) params.set('status', filters.status);
      if (filters.source) params.set('source', filters.source);
      if (filters.search.trim()) params.set('search', filters.search.trim());
      if (filters.captainId) params.set('captainId', filters.captainId);
      if (filters.unassignedCaptain) params.set('unassigned', '1');
      const itemParams = new URLSearchParams({
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        includeCompleted: String(filters.showCompletedDuties),
      });
      if (filters.boatId) itemParams.set('boatId', filters.boatId);
      const [res, itemRes] = await Promise.all([
        authedFetch(`/api/admin/calendar-bookings?${params.toString()}`),
        authedFetch(`/api/admin/calendar-items?${itemParams.toString()}`),
      ]);
      const payload = (await res.json().catch(() => ({}))) as {
        bookings?: CalendarBooking[];
        blockedDates?: BlockedDate[];
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error || 'Could not load calendar.');
      const itemPayload = (await itemRes.json().catch(() => ({}))) as { items?: CalendarItem[]; error?: string };
      if (!itemRes.ok) throw new Error(itemPayload.error || 'Could not load duties and blocked times.');
      setBookings(Array.isArray(payload.bookings) ? payload.bookings : []);
      setBlockedDates(Array.isArray(payload.blockedDates) ? payload.blockedDates : []);
      setCalendarItems(Array.isArray(itemPayload.items) ? itemPayload.items : []);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not load calendar.');
    } finally {
      setLoading(false);
    }
  }, [authedFetch, filters, isAdmin, range.from, range.to]);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const apply = () => {
      const narrow = mq.matches;
      setIsNarrow(narrow);
      if (narrow) {
        setView((prev) => (prev === 'week' || prev === 'month' ? 'day' : prev));
      }
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const openBooking = (booking: CalendarBooking) => {
    navigate(`/admin/bookings/${booking.id}`);
  };

  const openStaffBooking = (date: string, hour: number, boatId?: string) => {
    const params = new URLSearchParams({
      date,
      startTime: `${pad(hour)}:00`,
      durationHours: '4',
    });
    if (boatId || filters.boatId) params.set('boatId', boatId || filters.boatId);
    if (filters.location) params.set('location', filters.location);
    navigate(`/admin/staff-booking?${params.toString()}`);
  };

  const slotBlocked = useCallback(
    (date: string, hour: number, boatId?: string | null) => {
      const start = isoAtLocalHour(date, hour);
      const end = isoAtLocalHour(date, hour + 1);
      return blockedDates.some((blocked) => {
        const appliesToBoat = !blocked.boat_id || !boatId || blocked.boat_id === boatId;
        return appliesToBoat && intervalsOverlap(start, end, blocked.start_time, blocked.end_time);
      });
    },
    [blockedDates]
  );

  const rangeAvailable = useCallback(
    (bookingId: string, boatId: string, startIso: string, endIso: string) => {
      const blocked = blockedDates.some((row) => {
        const appliesToBoat = !row.boat_id || row.boat_id === boatId;
        return appliesToBoat && intervalsOverlap(startIso, endIso, row.start_time, row.end_time);
      });
      if (blocked) return { available: false, reason: 'Blocked time' };

      const conflict = bookings.find((row) => {
        if (row.id === bookingId || row.boat_id !== boatId || !blockingStatuses.has(String(row.status || ''))) return false;
        return intervalsOverlap(startIso, endIso, row.start_time, row.end_time);
      });
      return conflict
        ? { available: false, reason: `Conflict with ${conflict.customer_name}` }
        : { available: true, reason: undefined };
    },
    [blockedDates, bookings]
  );

  const buildPreview = useCallback(
    (draft: DragDraft, date: string, hour: number, targetBoatId?: string | null): MovePreview | null => {
      const boatId = targetBoatId || filters.boatId || draft.booking.boat_id || '';
      const next = nextRangeForDrop(draft, date, hour, boatId);
      if (!next || !boatId) return null;
      const check = rangeAvailable(draft.booking.id, boatId, next.startIso, next.endIso);
      return {
        booking: draft.booking,
        mode: draft.mode,
        boatId,
        date,
        hour,
        oldStart: draft.booking.start_time,
        oldEnd: draft.booking.end_time,
        newStart: next.startIso,
        newEnd: next.endIso,
        available: check.available,
        reason: check.reason,
      };
    },
    [filters.boatId, rangeAvailable]
  );

  const onSlotDragOver = (event: DragEvent, date: string, hour: number, boatId?: string | null) => {
    if (!dragDraft) return;
    event.preventDefault();
    const preview = buildPreview(dragDraft, date, hour, boatId);
    if (!preview) return;
    setHoverPreview((prev) => {
      const same =
        prev?.booking.id === preview.booking.id &&
        prev.mode === preview.mode &&
        prev.boatId === preview.boatId &&
        prev.newStart === preview.newStart &&
        prev.newEnd === preview.newEnd &&
        prev.available === preview.available;
      return same ? prev : preview;
    });
  };

  const onSlotDrop = (event: DragEvent, date: string, hour: number, boatId?: string | null) => {
    event.preventDefault();
    if (!dragDraft) return;
    const preview = buildPreview(dragDraft, date, hour, boatId);
    setDragDraft(null);
    setHoverPreview(null);
    if (!preview) return;
    if (!preview.available) {
      setNotice(preview.reason || 'Conflict detected.');
      return;
    }
    setPendingMove(preview);
  };

  const patchCalendarBooking = async (id: string, body: Record<string, unknown>) => {
    const res = await authedFetch(`/api/admin/calendar-bookings/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => ({}))) as { booking?: CalendarBooking; error?: string };
    if (!res.ok || !payload.booking) throw new Error(payload.error || 'Could not update booking.');
    setBookings((prev) => prev.map((booking) => (booking.id === id ? payload.booking! : booking)));
    return payload.booking;
  };

  const confirmMove = async () => {
    if (!pendingMove) return;
    const previous = pendingMove.booking;
    try {
      const updated = await patchCalendarBooking(previous.id, {
        boat_id: pendingMove.boatId,
        start_time: pendingMove.newStart,
        end_time: pendingMove.newEnd,
        rental_location: previous.rental_location,
      });
      setPendingMove(null);
      setNotice(null);
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      setUndoMove({ booking: previous, expiresAt: Date.now() + 30000 });
      undoTimer.current = window.setTimeout(() => setUndoMove(null), 30000);
      setBookings((prev) => prev.map((booking) => (booking.id === updated.id ? updated : booking)));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not move booking.');
    }
  };

  const undoLastMove = async () => {
    if (!undoMove) return;
    try {
      const original = undoMove.booking;
      await patchCalendarBooking(original.id, {
        boat_id: original.boat_id,
        start_time: original.start_time,
        end_time: original.end_time,
        rental_location: original.rental_location,
      });
      setUndoMove(null);
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not undo move.');
    }
  };

  const runQuickAction = async (booking: CalendarBooking, action: string) => {
    setQuickMenu(null);
    if (action === 'open') return openBooking(booking);
    if (action === 'edit') {
      navigate(`/admin/bookings/${booking.id}/edit`);
      return;
    }
    if (action === 'duplicate') {
      const start = new Date(booking.start_time);
      const params = new URLSearchParams({
        boatId: booking.boat_id || '',
        date: ymd(start),
        startTime: hhmmFromIso(booking.start_time),
        durationHours: String(durationHours(booking.start_time, booking.end_time) || 4),
      });
      if (booking.rental_location) params.set('location', booking.rental_location);
      navigate(`/admin/staff-booking?${params.toString()}`);
      return;
    }

    try {
      const res = await authedFetch(`/api/admin/bookings/${booking.id}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      const payload = (await res.json().catch(() => ({}))) as { deleted?: boolean; status?: string; error?: string };
      if (!res.ok) throw new Error(payload.error || 'Action failed.');
      if (payload.deleted) {
        setBookings((prev) => prev.filter((row) => row.id !== booking.id));
      } else if (payload.status) {
        setBookings((prev) => prev.map((row) => (row.id === booking.id ? { ...row, status: payload.status! } : row)));
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  const changeQuickMenuBoat = async (booking: CalendarBooking, boatId: string) => {
    try {
      await patchCalendarBooking(booking.id, {
        boat_id: boatId,
        start_time: booking.start_time,
        end_time: booking.end_time,
        rental_location: booking.rental_location,
      });
      setQuickMenu(null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not reassign boat.');
    }
  };

  const openAddChoice = (date = todayYmd(), hour = 9, boatId?: string | null) => {
    setChoiceSlot({ date, hour, boatId: boatId || filters.boatId || '' });
  };

  const openItemForm = (itemType: 'blocked_time' | 'admin_duty', date?: string, hour?: number, boatId?: string | null) => {
    setChoiceSlot(null);
    setItemConflicts(null);
    setItemForm(blankItemForm(itemType, date || todayYmd(), hour ?? 9, boatId || filters.boatId || ''));
  };

  const editItem = (item: CalendarItem) => {
    const start = new Date(item.start_time);
    const end = new Date(item.end_time);
    const endInclusive = item.all_day ? addDays(startOfDay(end), -1) : startOfDay(start);
    setItemMenu(null);
    setItemConflicts(null);
    setItemForm({
      id: item.id,
      itemType: item.item_type,
      step: 5,
      title: item.title || '',
      reason: item.reason || '',
      dutyType: item.duty_type || '',
      assignedTo: item.assigned_to || '',
      boatId: item.boat_id || '',
      location: item.location || '',
      date: ymd(start),
      endDate: ymd(endInclusive),
      startTime: hhmmFromIso(item.start_time),
      endTime: hhmmFromIso(item.end_time),
      allDay: item.all_day,
      blocksAvailability: item.blocks_availability,
      priority: item.priority || 'normal',
      notes: item.notes || '',
      completed: item.completed,
    });
  };

  const saveCalendarItem = async (addAnother = false, saveAnyway = false) => {
    if (!itemForm) return;
    setSavingItem(true);
    setItemConflicts(null);
    try {
      const body = {
        item_type: itemForm.itemType,
        title: itemForm.title,
        reason: itemForm.reason,
        duty_type: itemForm.dutyType,
        assigned_to: itemForm.assignedTo,
        boat_id: itemForm.boatId || null,
        location: itemForm.location || null,
        date: itemForm.date,
        end_date: itemForm.endDate || itemForm.date,
        start_time_local: itemForm.startTime,
        end_time_local: itemForm.endTime,
        all_day: itemForm.allDay,
        blocks_availability: itemForm.itemType === 'blocked_time' ? true : itemForm.blocksAvailability,
        priority: itemForm.priority,
        notes: itemForm.notes,
        completed: itemForm.completed,
        saveAnyway,
      };
      const res = await authedFetch(`/api/admin/calendar-items${itemForm.id ? `/${itemForm.id}` : ''}`, {
        method: itemForm.id ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as { item?: CalendarItem; conflicts?: any; error?: string };
      if (res.status === 409) {
        setItemConflicts(payload.conflicts || {});
        throw new Error(payload.error || 'This item conflicts with existing bookings.');
      }
      if (!res.ok || !payload.item) throw new Error(payload.error || 'Could not save calendar item.');
      setCalendarItems((prev) => {
        const exists = prev.some((row) => row.id === payload.item!.id);
        return exists ? prev.map((row) => (row.id === payload.item!.id ? payload.item! : row)) : [...prev, payload.item!];
      });
      setNotice(`Saved: ${payload.item.title} on ${new Date(payload.item.start_time).toLocaleDateString()} from ${timeLabel(payload.item.start_time, payload.item.end_time)}.`);
      if (addAnother) setItemForm(blankItemForm(itemForm.itemType, itemForm.date, Number(itemForm.startTime.slice(0, 2)) || 9, itemForm.boatId));
      else setItemForm(null);
      await loadBookings();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not save calendar item.');
    } finally {
      setSavingItem(false);
    }
  };

  const openCaptainAvailabilityForm = (startDate = todayYmd(), endDate = todayYmd()) => {
    setCaptainForm({
      step: 1,
      startDate,
      endDate,
      saving: false,
      conflictCount: 0,
      conflicts: [],
    });
  };

  const previewCaptainAvailability = async () => {
    if (!captainForm) return;
    setCaptainForm((prev) => prev && { ...prev, saving: true });
    try {
      const res = await authedFetch('/api/admin/charter-captain-availability/preview', {
        method: 'POST',
        body: JSON.stringify({
          startDate: captainForm.startDate,
          endDate: captainForm.endDate,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        conflictCount?: number;
        conflicts?: CharterCaptainConflict[];
        blockCount?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error || 'Could not preview charter availability.');
      setCaptainForm((prev) =>
        prev
          ? {
              ...prev,
              step: 3,
              saving: false,
              conflictCount: Number(payload.conflictCount || 0),
              conflicts: Array.isArray(payload.conflicts) ? payload.conflicts : [],
            }
          : prev
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not preview charter availability.');
      setCaptainForm((prev) => prev && { ...prev, saving: false });
    }
  };

  const applyCaptainAvailability = async (saveAnyway = false) => {
    if (!captainForm) return;
    setCaptainForm((prev) => prev && { ...prev, saving: true });
    try {
      const res = await authedFetch('/api/admin/charter-captain-availability/apply', {
        method: 'POST',
        body: JSON.stringify({
          startDate: captainForm.startDate,
          endDate: captainForm.endDate,
          saveAnyway,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        inserted?: number;
        conflictCount?: number;
        conflicts?: CharterCaptainConflict[];
        error?: string;
      };
      if (res.status === 409) {
        setCaptainForm((prev) =>
          prev
            ? {
                ...prev,
                saving: false,
                step: 3,
                conflictCount: Number(payload.conflictCount || 0),
                conflicts: Array.isArray(payload.conflicts) ? payload.conflicts : [],
              }
            : prev
        );
        throw new Error(payload.error || 'Charter bookings conflict with this schedule.');
      }
      if (!res.ok) throw new Error(payload.error || 'Could not apply charter availability.');
      setCaptainForm(null);
      setNotice(`Applied charter captain availability (${payload.inserted ?? 0} blocks created). Rentals are unaffected.`);
      await loadBookings();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not apply charter availability.');
      setCaptainForm((prev) => prev && { ...prev, saving: false });
    }
  };

  const clearGeneratedCharterBlocks = async () => {
    if (!window.confirm('Remove all auto-generated charter captain blocks? Manual blocks will stay.')) return;
    try {
      const res = await authedFetch('/api/admin/charter-captain-availability/clear', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const payload = (await res.json().catch(() => ({}))) as { deleted?: number; error?: string };
      if (!res.ok) throw new Error(payload.error || 'Could not clear generated charter blocks.');
      setNotice(`Removed ${payload.deleted ?? 0} generated charter block${payload.deleted === 1 ? '' : 's'}.`);
      await loadBookings();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not clear generated charter blocks.');
    }
  };

  const deleteCalendarItem = async (item: CalendarItem) => {
    const label = item.item_type === 'blocked_time' ? 'remove this blocked time' : 'delete this admin duty';
    if (!window.confirm(`Are you sure you want to ${label}?`)) return;
    try {
      const res = await authedFetch(`/api/admin/calendar-items/${item.id}?item_type=${item.item_type}`, { method: 'DELETE' });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error || 'Could not delete calendar item.');
      setCalendarItems((prev) => prev.filter((row) => row.id !== item.id));
      setItemForm(null);
      setItemMenu(null);
      setNotice(item.item_type === 'blocked_time' ? 'Blocked time removed.' : 'Admin duty deleted.');
      await loadBookings();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not delete calendar item.');
    }
  };

  const markItemComplete = async (item: CalendarItem) => {
    try {
      const res = await authedFetch(`/api/admin/calendar-items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...item, item_type: item.item_type, completed: true }),
      });
      const payload = (await res.json().catch(() => ({}))) as { item?: CalendarItem; error?: string };
      if (!res.ok || !payload.item) throw new Error(payload.error || 'Could not mark complete.');
      setCalendarItems((prev) => prev.map((row) => (row.id === item.id ? payload.item! : row)));
      setItemMenu(null);
      setNotice('Admin duty marked complete.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not mark complete.');
    }
  };

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarBooking[]>();
    for (const booking of bookings) {
      const key = ymd(new Date(booking.start_time));
      map.set(key, [...(map.get(key) || []), booking]);
    }
    return map;
  }, [bookings]);

  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    const visible = calendarItems.filter((item) => {
      if (item.item_type === 'blocked_time' && !filters.showBlocks) return false;
      if (item.item_type === 'admin_duty' && !filters.showDuties) return false;
      if (item.item_type === 'admin_duty' && item.completed && !filters.showCompletedDuties) return false;
      return true;
    });
    for (const item of visible) {
      const key = ymd(new Date(item.start_time));
      map.set(key, [...(map.get(key) || []), item]);
    }
    return map;
  }, [calendarItems, filters.showBlocks, filters.showCompletedDuties, filters.showDuties]);

  const sidebar = {
    today: bookings.filter((b) => ymd(new Date(b.start_time)) === ymd(new Date())),
    upcoming: bookings.filter((b) => new Date(b.start_time).getTime() > Date.now() && b.status !== 'cancelled').slice(0, 8),
    holds: bookings.filter((b) => b.status === 'hold'),
    pending: bookings.filter((b) => b.status === 'pending_verification'),
  };

  const selectedDayKey = ymd(anchor);
  const weekStrip = useMemo(() => {
    const from = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(from, i));
  }, [anchor]);

  const dayAgenda = useMemo(() => {
    const dayBookings = (byDate.get(selectedDayKey) || []).filter((booking) =>
      booking.status === 'hold' ? filters.showHolds : filters.showBookings
    );
    const dayItems = itemsByDate.get(selectedDayKey) || [];
    const entries: Array<
      | { kind: 'booking'; start: string; booking: CalendarBooking }
      | { kind: 'item'; start: string; item: CalendarItem }
    > = [
      ...dayItems.map((item) => ({ kind: 'item' as const, start: item.start_time, item })),
      ...dayBookings.map((booking) => ({ kind: 'booking' as const, start: booking.start_time, booking })),
    ];
    entries.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    return entries;
  }, [byDate, filters.showBookings, filters.showHolds, itemsByDate, selectedDayKey]);

  if (authLoading) return <FullPageLoader message="Checking admin access..." />;
  if (!isAdmin) {
    return <AdminAccessDenied signedIn={Boolean(user)} />;
  }

  const title =
    isNarrow || view === 'day'
      ? anchor.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : view === 'month'
        ? anchor.toLocaleDateString([], { month: 'long', year: 'numeric' })
        : `${range.from.toLocaleDateString()} - ${addDays(range.to, -1).toLocaleDateString()}`;

  const renderBookingCard = (booking: CalendarBooking, compact = false) => (
    <div
      key={booking.id}
      role="button"
      tabIndex={0}
      draggable={booking.status !== 'cancelled'}
      onClick={(event) => {
        event.stopPropagation();
        openBooking(booking);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') openBooking(booking);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        setQuickMenu({ booking, x: event.clientX, y: event.clientY });
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        setDragDraft({ booking, mode: 'move' });
        setQuickMenu(null);
      }}
      onDragEnd={() => {
        setDragDraft(null);
        setHoverPreview(null);
      }}
      className={`group relative cursor-grab rounded-lg border p-2 text-xs font-semibold shadow-sm transition active:cursor-grabbing ${cardClass(booking)} ${
        compact ? '' : 'hover:-translate-y-0.5 hover:shadow-md'
      }`}
      title="Drag to move. Use top or bottom handle to resize."
    >
      <div
        draggable
        onClick={(event) => event.stopPropagation()}
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.effectAllowed = 'move';
          setDragDraft({ booking, mode: 'resize-start' });
        }}
        className="absolute left-1 right-8 top-0 h-2 cursor-n-resize rounded-t opacity-0 transition group-hover:bg-slate-900/30 group-hover:opacity-100"
        title="Resize start time"
      />
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          setQuickMenu({ booking, x: rect.left, y: rect.bottom + 6 });
        }}
        className="absolute right-1 top-1 rounded bg-white/70 p-1 opacity-0 shadow transition hover:bg-white group-hover:opacity-100"
        aria-label="Open quick menu"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
      <div className={compact ? 'font-black' : 'text-sm font-black'}>{calendarEventTitle(booking, compact)}</div>
      {!compact ? (
        <>
          <div>{booking.boat_name}</div>
          <div>{captainAssignmentLine(booking)}</div>
          <div>{booking.rental_location || '-'}</div>
          <div>{timeLabel(booking.start_time, booking.end_time)}</div>
          <div>{durationHours(booking.start_time, booking.end_time)} hr · {booking.status.replace(/_/g, ' ')}</div>
          <div>{String(booking.payment_status || 'pending').replace(/_/g, ' ')} · {sourceLabel(booking)}</div>
          {charterCapacityBlock(booking)}
        </>
      ) : (
        charterCapacityBlock(booking, true)
      )}
      <div
        draggable
        onClick={(event) => event.stopPropagation()}
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.effectAllowed = 'move';
          setDragDraft({ booking, mode: 'resize-end' });
        }}
        className="absolute bottom-0 left-1 right-8 h-2 cursor-s-resize rounded-b opacity-0 transition group-hover:bg-slate-900/30 group-hover:opacity-100"
        title="Resize end time"
      />
    </div>
  );

  const itemClass = (item: CalendarItem) => {
    if (item.block_source === 'charter_captain_availability') {
      return 'border-purple-300 bg-purple-100 text-purple-950';
    }
    if (item.item_type === 'blocked_time') return 'border-slate-300 bg-slate-200 text-slate-900';
    if (item.completed) return 'border-green-200 bg-green-100 text-green-900';
    if (item.priority === 'high') return 'border-red-200 bg-red-100 text-red-900';
    return 'border-yellow-200 bg-yellow-100 text-yellow-950';
  };

  const renderCalendarItemCard = (item: CalendarItem, compact = false) => (
    <button
      key={`${item.item_type}-${item.id}`}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        editItem(item);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setItemMenu({ item, x: event.clientX, y: event.clientY });
      }}
      className={`w-full rounded-lg border p-2 text-left text-xs font-bold shadow-sm transition hover:-translate-y-0.5 ${itemClass(item)}`}
      aria-label={`Edit ${item.title}`}
    >
      <div className="text-sm font-black">{compact ? `${hhmmFromIso(item.start_time)} ${item.title}` : item.title}</div>
      {!compact ? (
        <>
          <div>{item.item_type === 'blocked_time' ? (item.block_source === 'charter_captain_availability' ? 'Charter Captain Closed' : 'Blocked Time') : item.duty_type || 'Admin Duty'}</div>
          <div>{timeLabel(item.start_time, item.end_time)}</div>
          <div>{item.location || 'All locations'} · {item.boat_id ? boats.find((boat) => boat.id === item.boat_id)?.name || 'Selected boat' : 'All boats'}</div>
        </>
      ) : null}
    </button>
  );

  return (
    <AdminShell
      title="Admin Calendar"
      subtitle="Visual schedule for bookings, holds, and departures"
      actions={
        <>
          <button type="button" onClick={() => openAddChoice()} className="min-h-11 rounded-lg bg-green-700 px-4 py-3 text-sm font-black text-white hover:bg-green-600">
            + New Booking
          </button>
          <button type="button" onClick={() => openItemForm('blocked_time')} className="min-h-11 rounded-lg bg-slate-700 px-4 py-3 text-sm font-black text-white hover:bg-slate-600">
            + Block Time
          </button>
          <button type="button" onClick={() => openCaptainAvailabilityForm()} className="min-h-11 rounded-lg bg-purple-700 px-4 py-3 text-sm font-black text-white hover:bg-purple-600">
            Captain Availability
          </button>
          <button type="button" onClick={() => openItemForm('admin_duty')} className="min-h-11 rounded-lg bg-yellow-500 px-4 py-3 text-sm font-black text-slate-950 hover:bg-yellow-400">
            + Admin Duty
          </button>
        </>
      }
      belowHeader={
              <div className="border-b border-purple-200 bg-purple-50">
                <div className="mx-auto flex max-w-7xl flex-wrap gap-2 px-3 py-3 sm:px-6 lg:px-8">
                  <span className="self-center text-sm font-black uppercase tracking-wide text-purple-900">Charter captain</span>
                  <button
                    type="button"
                    onClick={() => {
                      const range = nextWeekCharterRange();
                      openCaptainAvailabilityForm(range.startDate, range.endDate);
                    }}
                    className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-purple-900 shadow-sm ring-1 ring-purple-200 hover:bg-purple-100"
                  >
                    Block Next Week (Charters)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const range = nextMonthCharterRange();
                      openCaptainAvailabilityForm(range.startDate, range.endDate);
                    }}
                    className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-purple-900 shadow-sm ring-1 ring-purple-200 hover:bg-purple-100"
                  >
                    Block Next Month (Charters)
                  </button>
                  <button
                    type="button"
                    onClick={() => void clearGeneratedCharterBlocks()}
                    className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-purple-900 shadow-sm ring-1 ring-purple-200 hover:bg-purple-100"
                  >
                    Clear Generated Charter Blocks
                  </button>
                </div>
              </div>
      }
    >
        {notice ? <div className="mb-4 rounded-lg bg-red-100 px-4 py-3 font-semibold text-red-800">{notice}</div> : null}
        {undoMove ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-green-100 px-4 py-3 font-semibold text-green-900">
            <span>Booking moved.</span>
            <button type="button" onClick={() => void undoLastMove()} className="inline-flex items-center gap-2 rounded bg-white px-3 py-2 text-green-900 shadow">
              <Undo2 className="h-4 w-4" />
              Undo
            </button>
          </div>
        ) : null}

        <div className="mb-4 rounded-2xl bg-white p-4 shadow">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CalendarDays className="h-6 w-6 text-amber-600" />
                <h2 className="text-2xl font-bold">{title}</h2>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(isNarrow ? (['day'] as CalendarView[]) : (['week', 'day', 'month'] as CalendarView[])).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    className={`min-h-11 rounded-lg px-4 py-2 font-semibold capitalize ${view === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800'}`}
                  >
                    {isNarrow && v === 'day' ? 'Agenda' : v}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setAnchor(
                      isNarrow || view === 'day'
                        ? addDays(anchor, -1)
                        : view === 'month'
                          ? new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1)
                          : addDays(anchor, -7)
                    )
                  }
                  className="min-h-11 rounded-lg bg-slate-100 px-3 py-2"
                  aria-label="Previous"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => setAnchor(new Date())} className="min-h-11 rounded-lg bg-slate-900 px-5 py-3 text-base font-black text-white sm:text-lg">
                  Today
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setAnchor(
                      isNarrow || view === 'day'
                        ? addDays(anchor, 1)
                        : view === 'month'
                          ? new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1)
                          : addDays(anchor, 7)
                    )
                  }
                  className="min-h-11 rounded-lg bg-slate-100 px-3 py-2"
                  aria-label="Next"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => void loadBookings()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-600 px-5 py-3 text-base font-black text-white sm:text-lg">
                  <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
              {isNarrow ? (
                <div className="mt-3 space-y-3">
                  <label className="block text-sm font-bold text-slate-700">
                    Date
                    <input
                      type="date"
                      value={selectedDayKey}
                      onChange={(e) => {
                        if (!e.target.value) return;
                        const [y, m, d] = e.target.value.split('-').map(Number);
                        setAnchor(new Date(y, m - 1, d, 12));
                        setView('day');
                      }}
                      className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
                    />
                  </label>
                  <div className="grid grid-cols-7 gap-1">
                    {weekStrip.map((day) => {
                      const key = ymd(day);
                      const active = key === selectedDayKey;
                      const count =
                        ((byDate.get(key) || []).filter((b) =>
                          b.status === 'hold' ? filters.showHolds : filters.showBookings
                        ).length || 0) + ((itemsByDate.get(key) || []).length || 0);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            setAnchor(day);
                            setView('day');
                          }}
                          className={`min-h-14 rounded-lg px-1 py-2 text-center text-xs font-bold ${
                            active ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-800'
                          }`}
                        >
                          <div>{day.toLocaleDateString([], { weekday: 'narrow' })}</div>
                          <div className="text-sm">{day.getDate()}</div>
                          {count > 0 ? <div className="mt-0.5 text-[10px] opacity-80">{count}</div> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
              <select value={filters.location} onChange={(e) => setFilters((f) => ({ ...f, location: e.target.value }))} className="min-h-11 rounded-lg border px-3 py-2">
                <option value="">All locations</option>
                <option>Port Orange</option>
                <option>Titusville</option>
              </select>
              <select value={filters.boatId} onChange={(e) => setFilters((f) => ({ ...f, boatId: e.target.value }))} className="rounded-lg border px-3 py-2">
                <option value="">All boats</option>
                {boats.map((boat) => <option key={boat.id} value={boat.id}>{boat.name}</option>)}
              </select>
              <select value={filters.bookingType} onChange={(e) => setFilters((f) => ({ ...f, bookingType: e.target.value }))} className="rounded-lg border px-3 py-2">
                <option value="">All types</option>
                <option value="rental">Rental</option>
                <option value="captain_charter">Captain Charter</option>
              </select>
              <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="rounded-lg border px-3 py-2">
                <option value="">All statuses</option>
                {['hold', 'pending', 'pending_verification', 'confirmed', 'ready_for_departure', 'completed', 'cancelled'].map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <select value={filters.source} onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))} className="rounded-lg border px-3 py-2">
                <option value="">All sources</option>
                <option value="website">Website</option>
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
              <select value={filters.captainId} onChange={(e) => setFilters((f) => ({ ...f, captainId: e.target.value, unassignedCaptain: false }))} className="rounded-lg border px-3 py-2">
                <option value="">All captains</option>
                {captains.map((captain) => (
                  <option key={captain.id} value={captain.id}>{captain.full_name}</option>
                ))}
              </select>
              <input value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} placeholder="Search customer, phone, email, ID" className="rounded-lg border px-3 py-2 md:col-span-2" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-200 pt-4">
            {[
              ['showBookings', 'Bookings'],
              ['showHolds', 'Holds'],
              ['showBlocks', 'Blocks'],
              ['showDuties', 'Duties'],
              ['showCompletedDuties', 'Completed duties'],
              ['unassignedCaptain', 'Unassigned captain charters'],
            ].map(([key, label]) => (
              <label key={key} className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-3 text-base font-bold text-slate-900">
                <input
                  type="checkbox"
                  checked={Boolean(filters[key as keyof typeof filters])}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      [key]: event.target.checked,
                      ...(key === 'unassignedCaptain' && event.target.checked ? { captainId: '' } : {}),
                    }))
                  }
                  className="h-5 w-5"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="overflow-hidden rounded-2xl bg-white shadow">
            {isNarrow ? (
              <div className="p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-black text-slate-900">Day agenda</h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openAddChoice(selectedDayKey, 9, filters.boatId || null)}
                      className="min-h-11 rounded-lg bg-green-700 px-4 py-2 text-sm font-bold text-white"
                    >
                      + Booking
                    </button>
                    <button
                      type="button"
                      onClick={() => openItemForm('blocked_time', selectedDayKey, 9)}
                      className="min-h-11 rounded-lg bg-slate-700 px-4 py-2 text-sm font-bold text-white"
                    >
                      + Block
                    </button>
                  </div>
                </div>
                {dayAgenda.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
                    <p className="font-semibold text-slate-700">No bookings or blocks this day.</p>
                    <button
                      type="button"
                      onClick={() => openAddChoice(selectedDayKey, 9, filters.boatId || null)}
                      className="mt-4 min-h-11 rounded-lg bg-amber-600 px-5 py-2 font-bold text-white"
                    >
                      Create booking
                    </button>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {dayAgenda.map((entry) =>
                      entry.kind === 'booking' ? (
                        <li key={`b-${entry.booking.id}`}>
                          <button
                            type="button"
                            onClick={() => openBooking(entry.booking)}
                            className={`w-full rounded-xl border p-4 text-left shadow-sm ${cardClass(entry.booking)}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-black">{timeLabel(entry.booking.start_time, entry.booking.end_time)}</div>
                                <div className="mt-1 text-base font-bold">{entry.booking.customer_name}</div>
                                <div className="text-sm text-slate-700">{entry.booking.boat_name}</div>
                                <div className="text-xs text-slate-600">{entry.booking.rental_location || 'No location'}</div>
                                {charterCapacityBlock(entry.booking, true)}
                              </div>
                              <StatusBadge
                                tone={
                                  entry.booking.status === 'cancelled'
                                    ? 'danger'
                                    : entry.booking.status === 'hold'
                                      ? 'warning'
                                      : 'success'
                                }
                              >
                                {humanizeLabel(entry.booking.status)}
                              </StatusBadge>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-3 text-sm font-bold">
                              <span className="text-amber-800 underline">Open booking</span>
                              <Link
                                to={`/admin/bookings/${entry.booking.id}/edit`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-slate-900 underline"
                              >
                                <Pencil className="h-4 w-4" aria-hidden />
                                Edit booking
                              </Link>
                            </div>
                          </button>
                        </li>
                      ) : (
                        <li key={`i-${entry.item.id}`}>
                          <button
                            type="button"
                            onClick={() => editItem(entry.item)}
                            className="w-full rounded-xl border border-slate-300 bg-slate-50 p-4 text-left shadow-sm"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-black">
                                  {entry.item.all_day ? 'All day' : timeLabel(entry.item.start_time, entry.item.end_time)}
                                </div>
                                <div className="mt-1 text-base font-bold">{entry.item.title}</div>
                                <div className="text-xs text-slate-600">{humanizeLabel(entry.item.item_type)}</div>
                              </div>
                              <StatusBadge tone={entry.item.item_type === 'blocked_time' ? 'neutral' : 'info'}>
                                {entry.item.item_type === 'blocked_time' ? 'Block' : 'Duty'}
                              </StatusBadge>
                            </div>
                          </button>
                        </li>
                      )
                    )}
                  </ul>
                )}
              </div>
            ) : view === 'month' ? (
              <div className="grid grid-cols-7 border-l border-t border-slate-200">
                {range.days.map((day) => {
                  const key = ymd(day);
                  const rows = (byDate.get(key) || []).filter((booking) =>
                    booking.status === 'hold' ? filters.showHolds : filters.showBookings
                  );
                  const itemRows = itemsByDate.get(key) || [];
                  const inMonth = day.getMonth() === anchor.getMonth();
                  return (
                    <div
                      key={key}
                      role="button"
                      tabIndex={0}
                      onClick={() => openAddChoice(key, 9)}
                      onDoubleClick={() => openAddChoice(key, 9)}
                      onDragOver={(event) => onSlotDragOver(event, key, 9, filters.boatId || null)}
                      onDrop={(event) => onSlotDrop(event, key, 9, filters.boatId || null)}
                      className={`min-h-[135px] border-b border-r border-slate-200 p-2 text-left align-top transition ${
                        slotBlocked(key, 9, filters.boatId || null)
                          ? 'bg-slate-200'
                          : hoverPreview?.date === key && hoverPreview.hour === 9
                            ? hoverPreview.available
                              ? 'bg-green-100'
                              : 'bg-red-100'
                            : inMonth
                              ? 'bg-white'
                              : 'bg-slate-50 text-slate-400'
                      }`}
                    >
                      <div className="font-bold">{day.getDate()}</div>
                      {slotBlocked(key, 9, filters.boatId || null) ? <div className="mt-1 text-xs font-bold text-slate-600">Blocked</div> : null}
                      <div className="mt-2 space-y-1">
                        {itemRows.slice(0, 3).map((item) => renderCalendarItemCard(item, true))}
                        {rows.slice(0, 4).map((booking) => renderBookingCard(booking, true))}
                        {rows.length + itemRows.length > 7 ? <div className="text-xs font-semibold text-slate-500">+{rows.length + itemRows.length - 7} more</div> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div
                  className={`grid ${
                    view === 'day'
                      ? 'min-w-0 grid-cols-[72px_1fr] md:grid-cols-[90px_1fr]'
                      : 'min-w-[900px] grid-cols-[90px_repeat(7,minmax(120px,1fr))]'
                  }`}
                >
                  <div className="border-b border-r border-slate-200 bg-slate-50 p-3 text-xs font-bold uppercase text-slate-500">Time</div>
                  {range.days.map((day) => (
                    <div key={ymd(day)} className="border-b border-r border-slate-200 bg-slate-50 p-3 text-center font-bold">
                      {day.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                  ))}
                  {hours.map((hour) => (
                    <Fragment key={hour}>
                      <div key={`time-${hour}`} className="border-b border-r border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-600">
                        {hour % 12 || 12}:00 {hour >= 12 ? 'PM' : 'AM'}
                      </div>
                      {range.days.map((day) => {
                        const key = ymd(day);
                        const rows = (byDate.get(key) || []).filter(
                          (booking) =>
                            new Date(booking.start_time).getHours() === hour &&
                            (booking.status === 'hold' ? filters.showHolds : filters.showBookings)
                        );
                        const itemRows = (itemsByDate.get(key) || []).filter((item) => new Date(item.start_time).getHours() === hour);
                        const targetBoatId = filters.boatId || null;
                        const blocked = slotBlocked(key, hour, targetBoatId);
                        const previewHere = hoverPreview?.date === key && hoverPreview.hour === hour;
                        return (
                          <div
                            key={`${key}-${hour}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => openAddChoice(key, hour, targetBoatId)}
                            onDoubleClick={() => openAddChoice(key, hour, targetBoatId)}
                            onDragOver={(event) => onSlotDragOver(event, key, hour, targetBoatId)}
                            onDrop={(event) => onSlotDrop(event, key, hour, targetBoatId)}
                            className={`min-h-[96px] border-b border-r border-slate-200 p-2 text-left transition ${
                              blocked
                                ? 'bg-slate-200'
                                : previewHere
                                  ? hoverPreview.available
                                    ? 'bg-green-100'
                                    : 'bg-red-100'
                                  : 'hover:bg-amber-50'
                            }`}
                          >
                            {blocked ? <div className="mb-1 rounded bg-slate-300 px-2 py-1 text-xs font-bold text-slate-700">Blocked</div> : null}
                            {previewHere ? (
                              <div className={`mb-1 rounded px-2 py-1 text-xs font-black ${hoverPreview.available ? 'bg-green-700 text-white' : 'bg-red-700 text-white'}`}>
                                {hoverPreview.available ? 'Available' : 'Conflict'}
                              </div>
                            ) : null}
                            <div className="space-y-1">
                              {itemRows.map((item) => renderCalendarItemCard(item))}
                              {rows.map((booking) => renderBookingCard(booking))}
                            </div>
                          </div>
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
          </section>

          <aside className="space-y-4">
            {[
              ['Today’s departures', sidebar.today],
              ['Upcoming departures', sidebar.upcoming],
              ['Holds', sidebar.holds],
              ['Pending verification', sidebar.pending],
            ].map(([title, rows]) => (
              <section key={String(title)} className="rounded-2xl bg-white p-4 shadow">
                <h3 className="font-bold text-slate-900">{String(title)}</h3>
                <div className="mt-3 space-y-2">
                  {(rows as CalendarBooking[]).length === 0 ? (
                    <p className="text-sm text-slate-500">None</p>
                  ) : (
                    (rows as CalendarBooking[]).slice(0, 6).map((booking) => (
                      <button key={booking.id} type="button" onClick={() => openBooking(booking)} className={`w-full rounded-lg border p-2 text-left text-sm ${cardClass(booking)}`}>
                        <div className="font-black">{timeLabel(booking.start_time, booking.end_time)}</div>
                        <div>{booking.customer_name}</div>
                        <div>{booking.boat_name}</div>
                        {(() => {
                          const captainLine = captainAssignmentLine(booking);
                          return captainLine ? <div>{captainLine}</div> : null;
                        })()}
                        {charterCapacityBlock(booking, true)}
                      </button>
                    ))
                  )}
                </div>
              </section>
            ))}
          </aside>
        </div>

      {pendingMove ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-2xl font-black">Move Booking?</h2>
            <p className="mt-1 text-sm text-slate-600">
              {pendingMove.mode === 'move'
                ? 'Confirm the new schedule.'
                : pendingMove.mode === 'resize-start'
                  ? 'Confirm the new start time.'
                  : 'Confirm the new end time.'}
            </p>
            <div className="mt-5 rounded-xl bg-slate-100 p-4">
              <div className="text-sm font-bold text-slate-500">Old Time</div>
              <div className="font-black">{timeLabel(pendingMove.oldStart, pendingMove.oldEnd)}</div>
              <div className="my-3 text-center text-2xl font-black text-slate-400">↓</div>
              <div className="text-sm font-bold text-slate-500">New Time</div>
              <div className="font-black">{timeLabel(pendingMove.newStart, pendingMove.newEnd)}</div>
              <div className="mt-3 text-sm font-semibold text-slate-700">
                Boat: {boats.find((boat) => boat.id === pendingMove.boatId)?.name || pendingMove.booking.boat_name}
              </div>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setPendingMove(null)} className="rounded-lg border border-slate-300 px-5 py-3 font-bold text-slate-800 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" onClick={() => void confirmMove()} className="rounded-lg bg-green-700 px-5 py-3 font-bold text-white hover:bg-green-800">
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {choiceSlot ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-3xl font-black">What do you want to add?</h2>
            <p className="mt-2 text-lg text-slate-600">
              {choiceSlot.date} at {pad(choiceSlot.hour)}:00
            </p>
            <div className="mt-6 grid gap-3">
              <button type="button" onClick={() => openStaffBooking(choiceSlot.date, choiceSlot.hour, choiceSlot.boatId || undefined)} className="rounded-xl bg-green-700 px-6 py-5 text-xl font-black text-white">
                New Booking
              </button>
              <button type="button" onClick={() => openItemForm('blocked_time', choiceSlot.date, choiceSlot.hour, choiceSlot.boatId)} className="rounded-xl bg-slate-700 px-6 py-5 text-xl font-black text-white">
                Block Time
              </button>
              <button type="button" onClick={() => openItemForm('admin_duty', choiceSlot.date, choiceSlot.hour, choiceSlot.boatId)} className="rounded-xl bg-yellow-500 px-6 py-5 text-xl font-black text-slate-950">
                Admin Duty
              </button>
              <button type="button" onClick={() => setChoiceSlot(null)} className="rounded-xl border border-slate-300 px-6 py-5 text-xl font-black text-slate-900">
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {itemForm ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-3xl font-black">{itemForm.id ? 'Edit Calendar Item' : 'Add to Calendar'}</h2>
                <p className="mt-1 text-lg text-slate-600">Step {itemForm.step} of 5</p>
              </div>
              <button type="button" onClick={() => setItemForm(null)} className="rounded-xl border border-slate-300 px-5 py-3 text-lg font-black text-slate-900">
                Cancel
              </button>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((step) => (
                <button
                  key={step}
                  type="button"
                  onClick={() => setItemForm((prev) => (prev ? { ...prev, step } : prev))}
                  className={`rounded-full px-4 py-2 font-bold ${itemForm.step === step ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800'}`}
                >
                  Step {step}
                </button>
              ))}
            </div>

            {itemConflicts ? (
              <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-red-950">
                <h3 className="text-xl font-black">This block conflicts with existing bookings:</h3>
                <div className="mt-2 space-y-2">
                  {(itemConflicts.bookings || []).map((booking: any) => (
                    <div key={booking.id} className="rounded-lg bg-white p-3">
                      <div className="font-bold">{booking.customer_name}</div>
                      <div>{booking.boat_name} · {timeLabel(booking.start_time, booking.end_time)}</div>
                      <Link to={`/admin/bookings/${booking.id}`} className="font-bold text-red-700 underline">Open Booking</Link>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button type="button" onClick={() => setItemConflicts(null)} className="rounded-xl border border-red-300 px-5 py-3 text-lg font-black">Cancel</button>
                  <button type="button" onClick={() => void saveCalendarItem(false, true)} className="rounded-xl bg-red-700 px-5 py-3 text-lg font-black text-white">Save Anyway</button>
                </div>
              </div>
            ) : null}

            <div className="mt-6 rounded-2xl border border-slate-200 p-5">
              {itemForm.step === 1 ? (
                <div>
                  <h3 className="text-2xl font-black">Step 1: What are you adding?</h3>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <button type="button" onClick={() => setItemForm((p) => p && { ...p, itemType: 'admin_duty', title: p.title === 'Blocked Time' ? 'Admin Duty' : p.title, blocksAvailability: false })} className={`rounded-xl px-5 py-5 text-xl font-black ${itemForm.itemType === 'admin_duty' ? 'bg-yellow-500 text-slate-950' : 'bg-slate-100'}`}>Admin Duty</button>
                    <button type="button" onClick={() => setItemForm((p) => p && { ...p, itemType: 'blocked_time', title: p.title === 'Admin Duty' ? 'Blocked Time' : p.title, blocksAvailability: true })} className={`rounded-xl px-5 py-5 text-xl font-black ${itemForm.itemType === 'blocked_time' ? 'bg-slate-700 text-white' : 'bg-slate-100'}`}>Blocked Time</button>
                    <button type="button" onClick={() => openStaffBooking(itemForm.date, Number(itemForm.startTime.slice(0, 2)) || 9, itemForm.boatId || undefined)} className="rounded-xl bg-green-700 px-5 py-5 text-xl font-black text-white">Booking</button>
                  </div>
                </div>
              ) : null}

              {itemForm.step === 2 ? (
                <div>
                  <h3 className="text-2xl font-black">Step 2: When?</h3>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="text-lg font-bold">Start Date<input type="date" value={itemForm.date} onChange={(e) => setItemForm((p) => p && { ...p, date: e.target.value, endDate: p.endDate < e.target.value ? e.target.value : p.endDate })} className="mt-2 min-h-[54px] w-full rounded-xl border px-4 text-lg" /></label>
                    {itemForm.allDay ? (
                      <label className="text-lg font-bold">End Date (inclusive)<input type="date" min={itemForm.date} value={itemForm.endDate} onChange={(e) => setItemForm((p) => p && { ...p, endDate: e.target.value })} className="mt-2 min-h-[54px] w-full rounded-xl border px-4 text-lg" /></label>
                    ) : (
                      <label className="text-lg font-bold">End Date<input type="date" disabled value={itemForm.date} className="mt-2 min-h-[54px] w-full rounded-xl border px-4 text-lg disabled:opacity-50" /></label>
                    )}
                    <label className="flex items-center gap-3 text-lg font-bold sm:col-span-2"><input type="checkbox" checked={itemForm.allDay} onChange={(e) => setItemForm((p) => p && { ...p, allDay: e.target.checked, endDate: p.endDate || p.date })} className="h-6 w-6" /> All day / multi-day block</label>
                    {itemForm.itemType === 'blocked_time' && itemForm.allDay ? (
                      <div className="flex flex-wrap gap-2 sm:col-span-2">
                        <button type="button" onClick={() => setItemForm((p) => p && { ...p, endDate: ymd(addDays(new Date(`${p.date}T12:00:00`), 6)) })} className="rounded-lg bg-slate-200 px-4 py-3 text-sm font-bold text-slate-900">Block 1 week</button>
                        <button type="button" onClick={() => setItemForm((p) => p && { ...p, endDate: ymd(addDays(new Date(`${p.date}T12:00:00`), 13)) })} className="rounded-lg bg-slate-200 px-4 py-3 text-sm font-bold text-slate-900">Block 2 weeks</button>
                      </div>
                    ) : null}
                    <label className="text-lg font-bold">Start Time<input type="time" disabled={itemForm.allDay} value={itemForm.startTime} onChange={(e) => setItemForm((p) => p && { ...p, startTime: e.target.value })} className="mt-2 min-h-[54px] w-full rounded-xl border px-4 text-lg disabled:opacity-50" /></label>
                    <label className="text-lg font-bold">End Time<input type="time" disabled={itemForm.allDay} value={itemForm.endTime} onChange={(e) => setItemForm((p) => p && { ...p, endTime: e.target.value })} className="mt-2 min-h-[54px] w-full rounded-xl border px-4 text-lg disabled:opacity-50" /></label>
                  </div>
                </div>
              ) : null}

              {itemForm.step === 3 ? (
                <div>
                  <h3 className="text-2xl font-black">Step 3: What boat/location?</h3>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="text-lg font-bold">Boat<select value={itemForm.boatId} onChange={(e) => setItemForm((p) => p && { ...p, boatId: e.target.value })} className="mt-2 min-h-[54px] w-full rounded-xl border px-4 text-lg"><option value="">All boats</option>{boats.map((boat) => <option key={boat.id} value={boat.id}>{boat.name}</option>)}</select></label>
                    <label className="text-lg font-bold">Location<select value={itemForm.location} onChange={(e) => setItemForm((p) => p && { ...p, location: e.target.value })} className="mt-2 min-h-[54px] w-full rounded-xl border px-4 text-lg"><option value="">All locations</option><option>Port Orange</option><option>Titusville</option></select></label>
                  </div>
                </div>
              ) : null}

              {itemForm.step === 4 ? (
                <div>
                  <h3 className="text-2xl font-black">Step 4: Details</h3>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="text-lg font-bold">Title<input value={itemForm.title} onChange={(e) => setItemForm((p) => p && { ...p, title: e.target.value })} className="mt-2 min-h-[54px] w-full rounded-xl border px-4 text-lg" /></label>
                    <label className="text-lg font-bold">Reason<input value={itemForm.reason} onChange={(e) => setItemForm((p) => p && { ...p, reason: e.target.value })} placeholder="Maintenance, weather, call customer..." className="mt-2 min-h-[54px] w-full rounded-xl border px-4 text-lg" /></label>
                    {itemForm.itemType === 'admin_duty' ? (
                      <>
                        <label className="text-lg font-bold">Duty Type<input value={itemForm.dutyType} onChange={(e) => setItemForm((p) => p && { ...p, dutyType: e.target.value })} className="mt-2 min-h-[54px] w-full rounded-xl border px-4 text-lg" /></label>
                        <label className="text-lg font-bold">Assigned To<input value={itemForm.assignedTo} onChange={(e) => setItemForm((p) => p && { ...p, assignedTo: e.target.value })} className="mt-2 min-h-[54px] w-full rounded-xl border px-4 text-lg" /></label>
                        <label className="text-lg font-bold">Priority<select value={itemForm.priority} onChange={(e) => setItemForm((p) => p && { ...p, priority: e.target.value as CalendarItemForm['priority'] })} className="mt-2 min-h-[54px] w-full rounded-xl border px-4 text-lg"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
                        <label className="flex items-center gap-3 text-lg font-bold"><input type="checkbox" checked={itemForm.blocksAvailability} onChange={(e) => setItemForm((p) => p && { ...p, blocksAvailability: e.target.checked })} className="h-6 w-6" /> Blocks availability</label>
                        <label className="flex items-center gap-3 text-lg font-bold"><input type="checkbox" checked={itemForm.completed} onChange={(e) => setItemForm((p) => p && { ...p, completed: e.target.checked })} className="h-6 w-6" /> Completed</label>
                      </>
                    ) : null}
                    <label className="text-lg font-bold sm:col-span-2">Notes<textarea value={itemForm.notes} onChange={(e) => setItemForm((p) => p && { ...p, notes: e.target.value })} className="mt-2 min-h-[120px] w-full rounded-xl border p-4 text-lg" /></label>
                  </div>
                </div>
              ) : null}

              {itemForm.step === 5 ? (
                <div>
                  <h3 className="text-2xl font-black">Step 5: Review & Save</h3>
                  <div className="mt-4 rounded-xl bg-slate-100 p-4 text-lg">
                    <p><strong>Type:</strong> {itemForm.itemType === 'blocked_time' ? 'Blocked Time' : 'Admin Duty'}</p>
                    <p><strong>Title:</strong> {itemForm.title}</p>
                    <p><strong>When:</strong> {itemForm.allDay ? `${itemForm.date} – ${itemForm.endDate} (all day)` : `${itemForm.date} ${itemForm.startTime} - ${itemForm.endTime}`}</p>
                    <p><strong>Boat:</strong> {itemForm.boatId ? boats.find((boat) => boat.id === itemForm.boatId)?.name : 'All boats'}</p>
                    <p><strong>Location:</strong> {itemForm.location || 'All locations'}</p>
                    <p><strong>Blocks availability:</strong> {itemForm.itemType === 'blocked_time' || itemForm.blocksAvailability ? 'Yes' : 'No'}</p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-6 flex flex-wrap justify-between gap-3">
              <div className="flex flex-wrap gap-3">
                {itemForm.id ? (
                  <button type="button" onClick={() => void deleteCalendarItem({ id: itemForm.id!, item_type: itemForm.itemType } as CalendarItem)} className="rounded-xl bg-red-700 px-6 py-4 text-lg font-black text-white">
                    {itemForm.itemType === 'blocked_time' ? 'Remove Block' : 'Delete'}
                  </button>
                ) : null}
                {itemForm.itemType === 'admin_duty' && itemForm.id ? (
                  <button type="button" onClick={() => setItemForm((p) => p && { ...p, completed: true, step: 5 })} className="rounded-xl bg-green-700 px-6 py-4 text-lg font-black text-white">
                    Mark Complete
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => setItemForm(null)} className="rounded-xl border border-slate-300 px-6 py-4 text-lg font-black text-slate-900">Cancel</button>
                {itemForm.step > 1 ? <button type="button" onClick={() => setItemForm((p) => p && { ...p, step: p.step - 1 })} className="rounded-xl bg-slate-200 px-6 py-4 text-lg font-black text-slate-900">Back</button> : null}
                {itemForm.step < 5 ? (
                  <button type="button" onClick={() => setItemForm((p) => p && { ...p, step: p.step + 1 })} className="rounded-xl bg-slate-900 px-6 py-4 text-lg font-black text-white">Next</button>
                ) : (
                  <>
                    <button type="button" disabled={savingItem} onClick={() => void saveCalendarItem(false)} className="rounded-xl bg-slate-900 px-6 py-4 text-lg font-black text-white disabled:opacity-50">
                      {itemForm.id ? 'Save Changes' : 'Save'}
                    </button>
                    {!itemForm.id ? <button type="button" disabled={savingItem} onClick={() => void saveCalendarItem(true)} className="rounded-xl bg-amber-600 px-6 py-4 text-lg font-black text-white disabled:opacity-50">Save & Add Another</button> : null}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {itemMenu ? (
        <>
          <button type="button" className="fixed inset-0 z-[110] cursor-default bg-transparent" aria-label="Close item menu" onClick={() => setItemMenu(null)} />
          <div className="fixed z-[111] w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-2xl" style={{ left: Math.min(itemMenu.x, window.innerWidth - 300), top: Math.min(itemMenu.y, window.innerHeight - 240) }}>
            <div className="border-b border-slate-100 pb-2">
              <div className="font-black">{itemMenu.item.title}</div>
              <div className="text-xs text-slate-500">{timeLabel(itemMenu.item.start_time, itemMenu.item.end_time)}</div>
            </div>
            <div className="mt-3 grid gap-2">
              <button type="button" onClick={() => editItem(itemMenu.item)} className="rounded-lg bg-slate-100 px-4 py-3 text-left font-bold">Edit</button>
              {itemMenu.item.item_type === 'admin_duty' ? <button type="button" onClick={() => void markItemComplete(itemMenu.item)} className="rounded-lg bg-green-700 px-4 py-3 text-left font-bold text-white">Mark Complete</button> : null}
              <button type="button" onClick={() => void deleteCalendarItem(itemMenu.item)} className="rounded-lg bg-red-700 px-4 py-3 text-left font-bold text-white">{itemMenu.item.item_type === 'blocked_time' ? 'Remove Block' : 'Delete'}</button>
            </div>
          </div>
        </>
      ) : null}

      {quickMenu ? (
        <>
          <button type="button" className="fixed inset-0 z-[110] cursor-default bg-transparent" aria-label="Close quick menu" onClick={() => setQuickMenu(null)} />
          <div
            className="fixed z-[111] w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-2xl"
            style={{ left: Math.min(quickMenu.x, window.innerWidth - 300), top: Math.min(quickMenu.y, window.innerHeight - 390) }}
          >
            <div className="border-b border-slate-100 pb-2">
              <div className="font-black">{quickMenu.booking.customer_name}</div>
              <div className="text-xs text-slate-500">{timeLabel(quickMenu.booking.start_time, quickMenu.booking.end_time)}</div>
              {charterCapacityBlock(quickMenu.booking) ? (
                <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-700">{charterCapacityBlock(quickMenu.booking)}</div>
              ) : null}
            </div>
            <label className="mt-3 block text-xs font-black uppercase tracking-wide text-slate-500">
              Reassign Boat
              <select
                value={quickMenu.booking.boat_id || ''}
                onChange={(event) => void changeQuickMenuBoat(quickMenu.booking, event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold normal-case text-slate-900"
              >
                {boats.map((boat) => (
                  <option key={boat.id} value={boat.id}>
                    {boat.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-3 grid gap-1">
              <button type="button" onClick={() => void runQuickAction(quickMenu.booking, 'open')} className="rounded-lg px-3 py-2 text-left font-semibold hover:bg-slate-100">Open Details</button>
              <button type="button" onClick={() => void runQuickAction(quickMenu.booking, 'edit')} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-left font-semibold hover:bg-slate-100">
                <Pencil className="h-4 w-4" aria-hidden />
                Edit Booking
              </button>
              <button type="button" onClick={() => void runQuickAction(quickMenu.booking, 'duplicate')} className="rounded-lg px-3 py-2 text-left font-semibold hover:bg-slate-100">Duplicate Booking</button>
              <button type="button" onClick={() => void runQuickAction(quickMenu.booking, 'cancel')} className="rounded-lg px-3 py-2 text-left font-semibold text-red-700 hover:bg-red-50">Cancel</button>
              <button type="button" onClick={() => void runQuickAction(quickMenu.booking, 'complete')} className="rounded-lg px-3 py-2 text-left font-semibold hover:bg-slate-100">Complete</button>
              <button type="button" onClick={() => void runQuickAction(quickMenu.booking, 'ready')} className="rounded-lg px-3 py-2 text-left font-semibold hover:bg-slate-100">Ready for Departure</button>
              <button type="button" onClick={() => void runQuickAction(quickMenu.booking, 'send_confirmation')} className="rounded-lg px-3 py-2 text-left font-semibold hover:bg-slate-100">Send Confirmation</button>
              {quickMenu.booking.status === 'hold' ? (
                <button type="button" onClick={() => void runQuickAction(quickMenu.booking, 'delete_hold')} className="rounded-lg px-3 py-2 text-left font-semibold text-red-800 hover:bg-red-50">Delete Hold</button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {captainForm ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black text-purple-950">Apply Charter Captain Availability</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Generates charter-only closed periods. Seven nights a week 5:00 PM – 4:00 AM stay open. Boat rentals are not affected.
                </p>
              </div>
              <button type="button" onClick={() => setCaptainForm(null)} className="rounded-lg bg-slate-100 px-4 py-2 font-bold">
                Close
              </button>
            </div>

            {captainForm.step === 1 ? (
              <div className="mt-6">
                <h3 className="text-xl font-black">Step 1: Start Date</h3>
                <label className="mt-4 block text-lg font-bold">
                  Start Date
                  <input
                    type="date"
                    value={captainForm.startDate}
                    onChange={(e) =>
                      setCaptainForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              startDate: e.target.value,
                              endDate: prev.endDate < e.target.value ? e.target.value : prev.endDate,
                            }
                          : prev
                      )
                    }
                    className="mt-2 min-h-[54px] w-full rounded-xl border px-4 text-lg"
                  />
                </label>
              </div>
            ) : null}

            {captainForm.step === 2 ? (
              <div className="mt-6">
                <h3 className="text-xl font-black">Step 2: End Date</h3>
                <label className="mt-4 block text-lg font-bold">
                  End Date (inclusive)
                  <input
                    type="date"
                    min={captainForm.startDate}
                    value={captainForm.endDate}
                    onChange={(e) => setCaptainForm((prev) => prev && { ...prev, endDate: e.target.value })}
                    className="mt-2 min-h-[54px] w-full rounded-xl border px-4 text-lg"
                  />
                </label>
              </div>
            ) : null}

            {captainForm.step === 3 ? (
              <div className="mt-6">
                <h3 className="text-xl font-black">Step 3: Review</h3>
                <div className="mt-4 rounded-xl bg-purple-50 p-4 text-lg">
                  <p><strong>Range:</strong> {captainForm.startDate} – {captainForm.endDate}</p>
                  <p><strong>Open for charters:</strong> 7 nights/week 5:00 PM – 4:00 AM</p>
                  <p><strong>Rentals:</strong> unchanged</p>
                </div>
                {captainForm.conflictCount > 0 ? (
                  <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
                    <h4 className="text-lg font-black text-amber-950">
                      There {captainForm.conflictCount === 1 ? 'is' : 'are'} {captainForm.conflictCount} charter booking
                      {captainForm.conflictCount === 1 ? '' : 's'} during this period.
                    </h4>
                    <div className="mt-3 space-y-2">
                      {captainForm.conflicts.map((booking) => (
                        <div key={booking.id} className="rounded-lg bg-white p-3">
                          <div className="font-bold">{booking.customer_name}</div>
                          <div>{timeLabel(booking.start_time, booking.end_time)}</div>
                          <Link to={`/admin/bookings/${booking.id}`} className="font-bold text-amber-800 underline">
                            View booking
                          </Link>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm font-semibold text-green-700">No conflicting charter bookings found.</p>
                )}
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-between gap-3">
              <button type="button" onClick={() => setCaptainForm(null)} className="rounded-xl border border-slate-300 px-6 py-4 text-lg font-black">
                Cancel
              </button>
              <div className="flex flex-wrap gap-3">
                {captainForm.step > 1 ? (
                  <button
                    type="button"
                    onClick={() => setCaptainForm((prev) => prev && { ...prev, step: prev.step - 1 })}
                    className="rounded-xl bg-slate-200 px-6 py-4 text-lg font-black"
                  >
                    Back
                  </button>
                ) : null}
                {captainForm.step < 3 ? (
                  <button
                    type="button"
                    disabled={captainForm.saving}
                    onClick={() => {
                      if (captainForm.step === 2) void previewCaptainAvailability();
                      else setCaptainForm((prev) => prev && { ...prev, step: prev.step + 1 });
                    }}
                    className="rounded-xl bg-purple-700 px-6 py-4 text-lg font-black text-white disabled:opacity-50"
                  >
                    {captainForm.step === 2 ? (captainForm.saving ? 'Checking…' : 'Review') : 'Next'}
                  </button>
                ) : (
                  <>
                    {captainForm.conflictCount > 0 ? (
                      <button
                        type="button"
                        disabled={captainForm.saving}
                        onClick={() => void applyCaptainAvailability(true)}
                        className="rounded-xl bg-amber-600 px-6 py-4 text-lg font-black text-white disabled:opacity-50"
                      >
                        Continue anyway
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={captainForm.saving}
                      onClick={() => void applyCaptainAvailability(false)}
                      className="rounded-xl bg-purple-700 px-6 py-4 text-lg font-black text-white disabled:opacity-50"
                    >
                      {captainForm.saving ? 'Applying…' : 'Generate blocks'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
