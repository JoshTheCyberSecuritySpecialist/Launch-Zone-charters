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

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfWeek = (d: Date) => addDays(startOfDay(d), -startOfDay(d).getDay());
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const hours = Array.from({ length: 14 }, (_, i) => 7 + i);
const blockingStatuses = new Set(['hold', 'pending', 'pending_verification', 'confirmed', 'ready_for_departure', 'completed']);

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
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragDraft, setDragDraft] = useState<DragDraft | null>(null);
  const [hoverPreview, setHoverPreview] = useState<MovePreview | null>(null);
  const [pendingMove, setPendingMove] = useState<MovePreview | null>(null);
  const [quickMenu, setQuickMenu] = useState<QuickMenuState | null>(null);
  const [undoMove, setUndoMove] = useState<{ booking: CalendarBooking; expiresAt: number } | null>(null);
  const undoTimer = useRef<number | null>(null);
  const [filters, setFilters] = useState({
    location: '',
    boatId: '',
    bookingType: '',
    status: '',
    source: '',
    search: '',
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
      const res = await authedFetch(`/api/admin/calendar-bookings?${params.toString()}`);
      const payload = (await res.json().catch(() => ({}))) as {
        bookings?: CalendarBooking[];
        blockedDates?: BlockedDate[];
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error || 'Could not load calendar.');
      setBookings(Array.isArray(payload.bookings) ? payload.bookings : []);
      setBlockedDates(Array.isArray(payload.blockedDates) ? payload.blockedDates : []);
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

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarBooking[]>();
    for (const booking of bookings) {
      const key = ymd(new Date(booking.start_time));
      map.set(key, [...(map.get(key) || []), booking]);
    }
    return map;
  }, [bookings]);

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
      onClick={() => openBooking(booking)}
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
            <Link to="/admin/staff-booking" className="rounded-lg bg-green-700 px-4 py-3 font-semibold text-white hover:bg-green-600">
              Staff Booking
            </Link>
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
                <button type="button" onClick={() => setAnchor(new Date())} className="rounded-lg bg-slate-100 px-4 py-2 font-semibold">
                  Today
                </button>
                <button type="button" onClick={() => setAnchor(view === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1) : addDays(anchor, view === 'day' ? 1 : 7))} className="rounded-lg bg-slate-100 px-3 py-2">
                  <ChevronRight className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => void loadBookings()} className="rounded-lg bg-slate-100 px-3 py-2">
                  <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
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
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="overflow-hidden rounded-2xl bg-white shadow">
            {view === 'month' ? (
              <div className="grid grid-cols-7 border-l border-t border-slate-200">
                {range.days.map((day) => {
                  const key = ymd(day);
                  const rows = byDate.get(key) || [];
                  const inMonth = day.getMonth() === anchor.getMonth();
                  return (
                    <div
                      key={key}
                      role="button"
                      tabIndex={0}
                      onDoubleClick={() => openStaffBooking(key, 9)}
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
                        {rows.slice(0, 4).map((booking) => renderBookingCard(booking, true))}
                        {rows.length > 4 ? <div className="text-xs font-semibold text-slate-500">+{rows.length - 4} more</div> : null}
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
                        const rows = (byDate.get(key) || []).filter((booking) => new Date(booking.start_time).getHours() === hour);
                        const targetBoatId = filters.boatId || null;
                        const blocked = slotBlocked(key, hour, targetBoatId);
                        const previewHere = hoverPreview?.date === key && hoverPreview.hour === hour;
                        return (
                          <div
                            key={`${key}-${hour}`}
                            role="button"
                            tabIndex={0}
                            onDoubleClick={() => openStaffBooking(key, hour, targetBoatId || undefined)}
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
