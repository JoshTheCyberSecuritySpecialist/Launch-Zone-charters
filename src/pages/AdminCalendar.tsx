import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, MoreVertical, RefreshCw, Undo2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import Logo from '../components/ui/Logo';
import { env } from '../config/env.js';

type CalendarView = 'day' | 'week' | 'month';

type BoatRow = { id: string; name: string; type?: string | null };

type CalendarBooking = {
  id: string;
  customer_name: string;
  customer_phone?: string | null;
  customer_email?: string | null;
  boat_id: string | null;
  boat_name: string;
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

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfWeek = (d: Date) => addDays(startOfDay(d), -startOfDay(d).getDay());
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const hours = Array.from({ length: 14 }, (_, i) => 7 + i);
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
  if (booking.booking_type === 'charter') return 'border-purple-200 bg-purple-100 text-purple-950';
  if (booking.staff_created || booking.booking_source === 'admin') return 'border-green-200 bg-green-100 text-green-950';
  return 'border-blue-200 bg-blue-100 text-blue-950';
}

function sourceLabel(booking: CalendarBooking) {
  if (booking.staff_created || booking.booking_source === 'admin') return 'Staff';
  return booking.booking_source || 'Website';
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
  const [view, setView] = useState<CalendarView>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [boats, setBoats] = useState<BoatRow[]>([]);
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
  const [undoMove, setUndoMove] = useState<{ booking: CalendarBooking; expiresAt: number } | null>(null);
  const undoTimer = useRef<number | null>(null);
  const [filters, setFilters] = useState({
    location: '',
    boatId: '',
    bookingType: '',
    status: '',
    source: '',
    search: '',
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
      const start = itemForm.allDay ? new Date(`${itemForm.date}T00:00`) : new Date(`${itemForm.date}T${itemForm.startTime}`);
      const end = itemForm.allDay ? new Date(start.getTime() + 24 * 60 * 60 * 1000) : new Date(`${itemForm.date}T${itemForm.endTime}`);
      const body = {
        item_type: itemForm.itemType,
        title: itemForm.title,
        reason: itemForm.reason,
        duty_type: itemForm.dutyType,
        assigned_to: itemForm.assignedTo,
        boat_id: itemForm.boatId || null,
        location: itemForm.location || null,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
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

  if (authLoading) return <FullPageLoader message="Checking admin access..." />;
  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="rounded-xl bg-white p-8 text-center shadow">
          <h1 className="text-2xl font-bold">Access denied</h1>
          <p className="mt-2 text-slate-600">{user ? 'This account is not authorized.' : 'Sign in as admin.'}</p>
          <Link to="/admin-login" className="mt-5 inline-flex rounded-lg bg-amber-600 px-5 py-3 font-bold text-white">
            Admin Login
          </Link>
        </div>
      </div>
    );
  }

  const title =
    view === 'month'
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
      <div className={compact ? 'font-black' : 'text-sm font-black'}>{compact ? `${hhmmFromIso(booking.start_time)} ${booking.customer_name}` : booking.customer_name}</div>
      {!compact ? (
        <>
          <div>{booking.boat_name}</div>
          <div>{booking.rental_location || '-'}</div>
          <div>{timeLabel(booking.start_time, booking.end_time)}</div>
          <div>{durationHours(booking.start_time, booking.end_time)} hr · {booking.status.replace(/_/g, ' ')}</div>
          <div>{String(booking.payment_status || 'pending').replace(/_/g, ' ')} · {sourceLabel(booking)}</div>
        </>
      ) : null}
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
          <div>{item.item_type === 'blocked_time' ? 'Blocked Time' : item.duty_type || 'Admin Duty'}</div>
          <div>{timeLabel(item.start_time, item.end_time)}</div>
          <div>{item.location || 'All locations'} · {item.boat_id ? boats.find((boat) => boat.id === item.boat_id)?.name || 'Selected boat' : 'All boats'}</div>
        </>
      ) : null}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="border-b border-slate-200 bg-slate-900 py-6 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Logo variant="admin" />
            <div>
              <h1 className="text-3xl font-bold">Admin Calendar</h1>
              <p className="text-sm text-slate-400">Visual schedule for bookings, holds, and departures</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => openAddChoice()} className="rounded-lg bg-green-700 px-5 py-4 text-lg font-black text-white hover:bg-green-600">
              + New Booking
            </button>
            <button type="button" onClick={() => openItemForm('blocked_time')} className="rounded-lg bg-slate-700 px-5 py-4 text-lg font-black text-white hover:bg-slate-600">
              + Block Time
            </button>
            <button type="button" onClick={() => openItemForm('admin_duty')} className="rounded-lg bg-yellow-500 px-5 py-4 text-lg font-black text-slate-950 hover:bg-yellow-400">
              + Add Admin Duty
            </button>
            <Link to="/admin" className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-3 font-semibold hover:bg-slate-700">
              <ArrowLeft className="h-4 w-4" />
              Dashboard
            </Link>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
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
                {(['week', 'day', 'month'] as CalendarView[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    className={`rounded-lg px-4 py-2 font-semibold capitalize ${view === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800'}`}
                  >
                    {v}
                  </button>
                ))}
                <button type="button" onClick={() => setAnchor(view === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1) : addDays(anchor, view === 'day' ? -1 : -7))} className="rounded-lg bg-slate-100 px-3 py-2">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => setAnchor(new Date())} className="rounded-lg bg-slate-900 px-5 py-3 text-lg font-black text-white">
                  Today
                </button>
                <button type="button" onClick={() => setAnchor(view === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1) : addDays(anchor, view === 'day' ? 1 : 7))} className="rounded-lg bg-slate-100 px-3 py-2">
                  <ChevronRight className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => void loadBookings()} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-5 py-3 text-lg font-black text-white">
                  <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
              <select value={filters.location} onChange={(e) => setFilters((f) => ({ ...f, location: e.target.value }))} className="rounded-lg border px-3 py-2">
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
              <input value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} placeholder="Search customer, phone, email, ID" className="rounded-lg border px-3 py-2" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-200 pt-4">
            {[
              ['showBookings', 'Bookings'],
              ['showHolds', 'Holds'],
              ['showBlocks', 'Blocks'],
              ['showDuties', 'Duties'],
              ['showCompletedDuties', 'Completed duties'],
            ].map(([key, label]) => (
              <label key={key} className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-3 text-base font-bold text-slate-900">
                <input
                  type="checkbox"
                  checked={Boolean(filters[key as keyof typeof filters])}
                  onChange={(event) => setFilters((prev) => ({ ...prev, [key]: event.target.checked }))}
                  className="h-5 w-5"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="overflow-hidden rounded-2xl bg-white shadow">
            {view === 'month' ? (
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
                <div className={`grid min-w-[900px] ${view === 'day' ? 'grid-cols-[90px_1fr]' : 'grid-cols-[90px_repeat(7,minmax(120px,1fr))]'}`}>
                  <div className="border-b border-r border-slate-200 bg-slate-50 p-3 text-xs font-bold uppercase text-slate-500">Time</div>
                  {range.days.map((day) => (
                    <div key={ymd(day)} className="border-b border-r border-slate-200 bg-slate-50 p-3 text-center font-bold">
                      {day.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                  ))}
                  {hours.map((hour) => (
                    <Fragment key={hour}>
                      <div key={`time-${hour}`} className="border-b border-r border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-600">
                        {hour > 12 ? hour - 12 : hour}:00 {hour >= 12 ? 'PM' : 'AM'}
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
                      </button>
                    ))
                  )}
                </div>
              </section>
            ))}
          </aside>
        </div>
      </main>

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
                    <label className="text-lg font-bold">Date<input type="date" value={itemForm.date} onChange={(e) => setItemForm((p) => p && { ...p, date: e.target.value })} className="mt-2 min-h-[54px] w-full rounded-xl border px-4 text-lg" /></label>
                    <label className="flex items-center gap-3 text-lg font-bold"><input type="checkbox" checked={itemForm.allDay} onChange={(e) => setItemForm((p) => p && { ...p, allDay: e.target.checked })} className="h-6 w-6" /> All day</label>
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
                    <p><strong>When:</strong> {itemForm.date} {itemForm.allDay ? 'All day' : `${itemForm.startTime} - ${itemForm.endTime}`}</p>
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
                  <button type="button" onClick={() => void deleteCalendarItem({ ...(itemForm as any), id: itemForm.id, item_type: itemForm.itemType, start_time: new Date(`${itemForm.date}T${itemForm.startTime}`).toISOString(), end_time: new Date(`${itemForm.date}T${itemForm.endTime}`).toISOString() })} className="rounded-xl bg-red-700 px-6 py-4 text-lg font-black text-white">
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
    </div>
  );
}
