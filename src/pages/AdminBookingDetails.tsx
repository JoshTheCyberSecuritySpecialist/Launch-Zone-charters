import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Copy, Download, FileArchive, FileText, Pencil, Printer, Save } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import { humanizeLabel, shortId } from '../components/admin/adminDisplay';
import LoadingSection from '../components/admin/LoadingSection';
import AdminId from '../components/admin/AdminId';
import AdminLegalEvidencePanel from '../components/admin/AdminLegalEvidencePanel';
import AdminBookingCapacityPanel from '../components/admin/AdminBookingCapacityPanel';
import { env } from '../config/env.js';
import {
  CHARTER_MAX_PASSENGERS,
  adminCharterCapacityLines,
  validateCharterPassengerCount,
} from '../lib/charterCapacity';
import { adminDebugLog, describeError, withTimeout } from '../lib/adminDiagnostics';
import { copyText } from '../lib/copyText';
import { siteOrigin } from '../lib/siteOrigin';
import { bookingFormTimesFromIso, formatEndDayNote, resolveBookingDateTimeRange } from '../lib/bookingDateTimeRange';
import {
  type AdminBookingFormState,
  applyDurationToForm,
  buildPatchBody,
} from '../lib/adminBookingFormState';
import AdminGrouponReviewPanel from '../components/admin/AdminGrouponReviewPanel';
import { BIO_LEGACY_PRICING_LABEL } from '../lib/bioluminescencePackages';
import { fetchActiveCaptains, type AdminCaptainListItem } from '../lib/adminCaptains';

type BoatRow = { id: string; name: string; type?: string | null };
type TimelineEvent = {
  id: string;
  event_type: string;
  actor_type?: string | null;
  message: string | null;
  created_at: string;
  kind?: 'activity' | 'communication';
  channel?: string;
};
type CommunicationRow = {
  id: string;
  channel: 'email' | 'sms';
  message_type: string;
  recipient: string;
  subject?: string | null;
  body?: string | null;
  sent_by?: string | null;
  sent_at?: string | null;
  status: string;
  error_message?: string | null;
  created_at: string;
  reviewed_at?: string | null;
};

type CommunicationPreview = {
  messageType: string;
  subject: string;
  emailBody: string;
  smsBody: string;
  recipients: { email?: string; phone?: string; rawPhone?: string };
};

type EmailConfig = {
  resendConfigured: boolean;
  senderEmail: string;
  apiKeyPresent: boolean;
};

type CustomEmailPreview = {
  from: string;
  to: string;
  subject: string;
  message: string;
};

type DetailPayload = {
  booking: Record<string, any>;
  lifetimeBookings: number;
  timeline: TimelineEvent[];
  communications?: CommunicationRow[];
};

type BookingDispute = {
  id: string;
  stripe_dispute_id: string;
  status: string;
  reason: string | null;
  amount: number;
  currency: string;
  evidence_due_by: string | null;
  outcome: string | null;
  created_at: string;
  updated_at: string;
};

type DisputeNote = {
  id: string;
  admin_id: string | null;
  note_text: string;
  created_at: string;
};

const statusOptions = ['hold', 'pending', 'pending_verification', 'confirmed', 'ready_for_departure', 'completed', 'cancelled'];
const sourceOptions = ['website', 'admin', 'phone', 'groupon', 'boatsetter', 'airbnb', 'walk-in', 'repeat customer'];
const paymentMethods = ['', 'stripe', 'cash', 'venmo', 'zelle', 'paypal', 'groupon', 'comp', 'other'];
const paymentStatuses = ['pending', 'deposit_paid', 'paid'];
const communicationButtons = [
  ['booking_confirmation', 'Send Confirmation'],
  ['booking_updated', 'Send Updated Confirmation'],
  ['missing_waiver', 'Send Waiver Reminder'],
  ['missing_insurance', 'Send Insurance Reminder'],
  ['missing_documents', 'Send Document Reminder'],
  ['day_before_reminder', 'Send Day-Before Reminder'],
  ['cancelled_booking', 'Send Cancellation Notice'],
  ['weather_delay', 'Send Weather Update'],
  ['arrival_instructions', 'Send Arrival Instructions'],
  ['passenger_weight_issue', 'Send Weight / Passenger Notice'],
  ['separate_trip_explanation', 'Send Separate Trip Notice'],
  ['groupon_support', 'Send Groupon Support Message'],
  ['groupon_request_rejected', 'Send Groupon Rejection Notice'],
  ['groupon_alternative_proposed', 'Send Alternate Time Proposal'],
] as const;

const customEmailTemplates = {
  general: {
    label: 'General Message',
    subject: 'Message from Launch Zone Charters',
    message: 'Hi,\n\nThanks for booking with Launch Zone Charters. I wanted to follow up with you about your trip.\n\nJoshua\nLaunch Zone Charters',
  },
  payment: {
    label: 'Payment Reminder',
    subject: 'Payment reminder for your Launch Zone Charters booking',
    message: 'Hi,\n\nThis is a friendly reminder about the remaining balance for your Launch Zone Charters booking. Please contact us if you have any questions.\n\nJoshua\nLaunch Zone Charters',
  },
  waiver: {
    label: 'Waiver Reminder',
    subject: 'Waiver reminder for your Launch Zone Charters booking',
    message: 'Hi,\n\nPlease complete your waiver before your trip so we can keep check-in quick and easy.\n\nJoshua\nLaunch Zone Charters',
  },
  insurance: {
    label: 'Insurance Reminder',
    subject: 'Insurance reminder for your Launch Zone Charters booking',
    message: 'Hi,\n\nPlease complete or upload your rental insurance information before your trip. Let us know if you need help.\n\nJoshua\nLaunch Zone Charters',
  },
  trip: {
    label: 'Trip Reminder',
    subject: 'Reminder for your upcoming Launch Zone Charters trip',
    message: 'Hi,\n\nThis is a quick reminder for your upcoming Launch Zone Charters trip. Please arrive a few minutes early and bring any required ID or documents.\n\nJoshua\nLaunch Zone Charters',
  },
  thanks: {
    label: 'Thank You',
    subject: 'Thank you from Launch Zone Charters',
    message: 'Hi,\n\nThank you for choosing Launch Zone Charters. We appreciate your business and hope to see you on the water again soon.\n\nJoshua\nLaunch Zone Charters',
  },
} as const;

const money = (v: unknown) => (Number(v || 0)).toFixed(2);

function evidencePackageFileName(customerName: string | null | undefined, createdAt: string | null | undefined, ext: 'zip' | 'pdf') {
  const slug = String(customerName || 'Customer')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'Customer';
  const datePart = createdAt ? String(createdAt).slice(0, 10) : new Date().toISOString().slice(0, 10);
  return `LaunchZone-Booking-${slug}-${datePart}.${ext}`;
}

function formatEventName(value: string) {
  return String(value || 'event').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function communicationStatusClass(status: string) {
  const s = status.toLowerCase();
  if (['sent', 'delivered', 'opened', 'clicked'].includes(s)) return 'bg-green-100 text-green-800';
  if (s === 'failed') return 'bg-red-100 text-red-800';
  return 'bg-amber-100 text-amber-900';
}

function disputeStatusClass(status: string) {
  const s = status.toLowerCase();
  if (s === 'won') return 'bg-green-100 text-green-800';
  if (['lost', 'charge_refunded'].includes(s)) return 'bg-red-100 text-red-800';
  if (['needs_response', 'warning_needs_response'].includes(s)) return 'bg-amber-100 text-amber-900';
  return 'bg-slate-100 text-slate-700';
}

function disputeDeadlineLabel(dueBy: string | null | undefined) {
  if (!dueBy) return 'No deadline';
  const due = new Date(dueBy).getTime();
  if (!Number.isFinite(due)) return 'No deadline';
  const diffMs = due - Date.now();
  if (diffMs <= 0) return 'Past due';
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h left`;
  if (hours > 0) return `${hours}h left`;
  return `${Math.floor(diffMs / (1000 * 60))}m left`;
}

export default function AdminBookingDetails() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [boats, setBoats] = useState<BoatRow[]>([]);
  const [captains, setCaptains] = useState<AdminCaptainListItem[]>([]);
  const [form, setForm] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [availability, setAvailability] = useState<'idle' | 'checking' | 'available' | 'conflict' | 'error'>('idle');
  const [communicationModal, setCommunicationModal] = useState<{
    preview: CommunicationPreview;
    smsAvailable: boolean;
    duplicates?: { email?: CommunicationRow | null; sms?: CommunicationRow | null };
    confirmDuplicate?: boolean;
  } | null>(null);
  const [viewCommunication, setViewCommunication] = useState<CommunicationRow | null>(null);
  const [communicationActionId, setCommunicationActionId] = useState<string | null>(null);
  const [communicationLoading, setCommunicationLoading] = useState<string | null>(null);
  const [emailConfig, setEmailConfig] = useState<EmailConfig | null>(null);
  const [emailRecipientEditable, setEmailRecipientEditable] = useState(false);
  const [customEmail, setCustomEmail] = useState({ to: '', subject: '', message: '' });
  const [customEmailPreview, setCustomEmailPreview] = useState<CustomEmailPreview | null>(null);
  const [customEmailLoading, setCustomEmailLoading] = useState<'config' | 'preview' | 'send' | null>(null);
  const [bookingDispute, setBookingDispute] = useState<BookingDispute | null>(null);
  const [disputeNotes, setDisputeNotes] = useState<DisputeNote[]>([]);
  const [disputeNoteText, setDisputeNoteText] = useState('');
  const [disputeLoading, setDisputeLoading] = useState(false);
  const [evidenceSummary, setEvidenceSummary] = useState('');
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState<'pdf' | 'zip' | 'stripe' | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [linkFallback, setLinkFallback] = useState<string | null>(null);
  const [updatedConfirmationPrompt, setUpdatedConfirmationPrompt] = useState(false);
  const availabilityCheckSeq = useRef(0);

  const booking = detail?.booking;
  const needsCaptainAssignment =
    form.bookingType === 'captain_charter' &&
    !form.captainId &&
    ['confirmed', 'ready_for_departure'].includes(String(form.status || ''));

  const getAdminToken = useCallback(async () => {
    const { data } = await withTimeout('Admin session lookup', supabase.auth.getSession(), 12000);
    return data.session?.access_token || null;
  }, []);

  const authedFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      if (!env.apiUrlConfigured || !env.apiUrl) throw new Error('API URL is not configured.');
      const token = await getAdminToken();
      if (!token) throw new Error('Admin session expired.');
      return withTimeout(
        `Admin booking ${path}`,
        fetch(`${env.apiUrl}${path}`, {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(init.headers || {}),
          },
        }),
        20000
      );
    },
    [getAdminToken]
  );

  const load = useCallback(async () => {
    if (!isAdmin || !id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [bookingRes, boatsRes, emailConfigRes, disputeRes] = await withTimeout(
        'Booking details bundle',
        Promise.all([
          authedFetch(`/api/admin/bookings/${id}`),
          withTimeout('Boats list', fetch(`${env.apiUrl}/api/boats`), 15000),
          authedFetch('/api/admin/email/config-check'),
          authedFetch(`/api/admin/bookings/${id}/dispute`),
        ]),
        30000
      );
      const bookingPayload = (await bookingRes.json().catch(() => ({}))) as DetailPayload & { error?: string };
      if (!bookingRes.ok) throw new Error(bookingPayload.error || 'Could not load booking.');
      const boatsPayload = (await boatsRes.json().catch(() => ({}))) as { boats?: BoatRow[] };
      const emailConfigPayload = (await emailConfigRes.json().catch(() => ({}))) as EmailConfig;
      const disputePayload = (await disputeRes.json().catch(() => ({}))) as {
        dispute?: BookingDispute | null;
        notes?: DisputeNote[];
      };
      setDetail(bookingPayload);
      setBoats(Array.isArray(boatsPayload.boats) ? boatsPayload.boats : []);
      try {
        const captainRows = await fetchActiveCaptains();
        const assigned = bookingPayload.booking?.captains as { id?: string; full_name?: string } | null | undefined;
        if (assigned?.id && !captainRows.some((row) => row.id === assigned.id)) {
          setCaptains([
            ...captainRows,
            {
              id: assigned.id,
              full_name: assigned.full_name || 'Assigned captain',
              phone: null,
              email: null,
              active: false,
              default_boat_id: null,
              auth_user_id: null,
              photo_url: null,
              notes: null,
            },
          ]);
        } else {
          setCaptains(captainRows);
        }
      } catch {
        setCaptains([]);
      }
      if (emailConfigRes.ok) setEmailConfig(emailConfigPayload);
      setBookingDispute(disputePayload.dispute || null);
      setDisputeNotes(Array.isArray(disputePayload.notes) ? disputePayload.notes : []);
      setDisputeNoteText('');
      const b = bookingPayload.booking;
      const times = bookingFormTimesFromIso(String(b.start_time || ''), String(b.end_time || ''));
      const resolved = times.date
        ? resolveBookingDateTimeRange({
            date: times.date,
            startTime: times.startTime,
            endTime: times.endTime,
          })
        : null;
      const duration =
        resolved && resolved.ok
          ? resolved.durationHours
          : Number(b.duration_hours || 0);
      setForm({
        customerName: b.customers?.full_name || b.name || '',
        phone: b.customers?.phone || b.phone || '',
        email: b.customers?.email || b.email || '',
        customerNotes: b.admin_notes || '',
        boatId: b.boat_id || '',
        location: b.rental_location || '',
        bookingType: b.booking_type === 'charter' ? 'captain_charter' : 'rental',
        date: times.date,
        startTime: times.startTime,
        endTime: times.endTime,
        duration: String(duration || ''),
        passengers: String(b.guest_count || 1),
        source: b.booking_source || (b.staff_created ? 'admin' : 'website'),
        originalPrice: money(b.original_total ?? b.base_price),
        discount: money(b.discount_amount),
        discountReason: b.manual_discount_reason || '',
        finalPrice: money(b.final_total ?? b.total_price),
        depositPaid: money(b.deposit_paid),
        amountCollected: money(b.amount_collected),
        remainingBalance: money(b.balance_due),
        paymentMethod: b.payment_method || '',
        paymentStatus: b.payment_status || 'pending',
        internalNotes: b.staff_notes || b.admin_notes || '',
        captainId: b.captain_id || '',
        emergencyContactNotes: b.emergency_contact_notes || '',
        status: b.status || 'pending',
      });
      const customerEmail = String(b.customers?.email || b.email || '').trim().toLowerCase();
      setCustomEmail((prev) => ({ ...prev, to: customerEmail || prev.to }));
      setDirty(false);
      setAvailability('idle');
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not load booking.' });
    } finally {
      setLoading(false);
    }
  }, [authedFetch, id, isAdmin]);

  const addDisputeNote = async () => {
    if (!bookingDispute?.id || !disputeNoteText.trim()) return;
    setDisputeLoading(true);
    try {
      const res = await authedFetch(`/api/admin/disputes/${encodeURIComponent(bookingDispute.id)}/notes`, {
        method: 'POST',
        body: JSON.stringify({ note_text: disputeNoteText.trim() }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error || 'Could not add note.');
      setNotice({ variant: 'success', text: 'Dispute note added.' });
      await load();
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not add note.' });
    } finally {
      setDisputeLoading(false);
    }
  };

  const generateEvidence = async () => {
    if (!id) return;
    setEvidenceLoading(true);
    try {
      const res = await authedFetch(`/api/admin/bookings/${encodeURIComponent(id)}/evidence-summary`);
      const payload = (await res.json().catch(() => ({}))) as { summary?: string; error?: string };
      if (!res.ok) throw new Error(payload.error || 'Could not generate evidence summary.');
      setEvidenceSummary(typeof payload.summary === 'string' ? payload.summary : '');
      setEvidenceModalOpen(true);
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not generate evidence summary.' });
    } finally {
      setEvidenceLoading(false);
    }
  };

  const copyEvidence = async () => {
    if (!evidenceSummary) return;
    try {
      await navigator.clipboard.writeText(evidenceSummary);
      setNotice({ variant: 'success', text: 'Evidence summary copied to clipboard.' });
    } catch {
      setNotice({ variant: 'error', text: 'Could not copy to clipboard.' });
    }
  };

  const downloadExport = async (path: string, filename: string, kind: 'pdf' | 'zip') => {
    setExportLoading(kind);
    try {
      const res = await authedFetch(path);
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || 'Download failed.');
      }
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/i);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = match?.[1] || filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice({ variant: 'success', text: `${kind.toUpperCase()} downloaded.` });
      await load();
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Download failed.' });
    } finally {
      setExportLoading(null);
    }
  };

  const submitStripeEvidence = async () => {
    if (!bookingDispute?.id) return;
    if (
      !window.confirm(
        'Submit the generated evidence summary text to Stripe for this dispute? Review the summary first.'
      )
    ) {
      return;
    }
    setExportLoading('stripe');
    try {
      const res = await authedFetch(`/api/admin/disputes/${encodeURIComponent(bookingDispute.id)}/submit-stripe-evidence`, {
        method: 'POST',
        body: '{}',
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error || 'Could not submit to Stripe.');
      setNotice({ variant: 'success', text: 'Evidence submitted to Stripe.' });
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not submit to Stripe.' });
    } finally {
      setExportLoading(null);
    }
  };

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    void load();
  }, [authLoading, isAdmin, load]);

  useEffect(() => {
    const state = location.state as { bookingUpdated?: boolean; customerFacingChanges?: boolean } | null;
    if (!state?.bookingUpdated) return;
    setNotice({ variant: 'success', text: 'Booking updated successfully.' });
    if (state.customerFacingChanges) {
      setUpdatedConfirmationPrompt(true);
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  const scheduleChanged = useMemo(() => {
    if (!booking) return false;
    if (form.boatId !== booking.boat_id) return true;
    const resolved = resolveBookingDateTimeRange({
      date: String(form.date || ''),
      startTime: String(form.startTime || ''),
      endTime: String(form.endTime || ''),
    });
    if (!resolved.ok) return true;
    const storedStartMs = booking.start_time ? new Date(String(booking.start_time)).getTime() : null;
    const storedEndMs = booking.end_time ? new Date(String(booking.end_time)).getTime() : null;
    const minuteMs = 60 * 1000;
    const nextStartMs = new Date(resolved.startIso).getTime();
    const nextEndMs = new Date(resolved.endIso).getTime();
    if (storedStartMs != null && Math.abs(nextStartMs - storedStartMs) > minuteMs) return true;
    if (storedEndMs != null && Math.abs(nextEndMs - storedEndMs) > minuteMs) return true;
    return false;
  }, [booking, form.boatId, form.date, form.endTime, form.startTime]);

  const overnightEndNote = useMemo(
    () => formatEndDayNote(String(form.date || ''), String(form.startTime || ''), String(form.endTime || '')),
    [form.date, form.endTime, form.startTime]
  );

  const bookingHistory = useMemo(() => {
    return (detail?.timeline || []).filter((row) => String(row.event_type || '') === 'booking_field_changed');
  }, [detail?.timeline]);

  const auditTimeline = useMemo(() => {
    const activityRows: TimelineEvent[] = (detail?.timeline || []).map((row) => ({
      ...row,
      kind: 'activity' as const,
    }));
    const commRows: TimelineEvent[] = (detail?.communications || []).map((row) => ({
      id: row.id,
      event_type: row.message_type,
      actor_type: row.sent_by ? 'admin' : 'system',
      message: row.subject
        ? `${row.channel.toUpperCase()}: ${row.subject}`
        : `${row.channel.toUpperCase()} to ${row.recipient}`,
      created_at: row.sent_at || row.created_at,
      kind: 'communication' as const,
      channel: row.channel,
    }));
    return [...activityRows, ...commRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [detail?.communications, detail?.timeline]);

  useEffect(() => {
    const seq = ++availabilityCheckSeq.current;

    if (!scheduleChanged || !form.boatId || !form.date || !form.startTime || !form.endTime) {
      setAvailability('idle');
      return;
    }

    const resolved = resolveBookingDateTimeRange({
      date: String(form.date),
      startTime: String(form.startTime),
      endTime: String(form.endTime),
    });
    if (!resolved.ok) {
      setAvailability('error');
      return;
    }

    setAvailability('checking');
    const timer = window.setTimeout(async () => {
      if (seq !== availabilityCheckSeq.current) return;

      try {
        const res = await authedFetch('/api/admin/staff-bookings/check', {
          method: 'POST',
          body: JSON.stringify({
            boat_id: form.boatId,
            date: form.date,
            startTime: form.startTime,
            endTime: form.endTime,
            rental_location: form.location,
            excludeBookingId: id,
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as { available?: boolean; error?: string };
        if (seq !== availabilityCheckSeq.current) return;
        if (!res.ok) {
          setAvailability('error');
          return;
        }
        setAvailability(payload.available ? 'available' : 'conflict');
      } catch {
        if (seq !== availabilityCheckSeq.current) return;
        setAvailability('error');
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [authedFetch, form.boatId, form.date, form.endTime, form.location, form.startTime, id, scheduleChanged]);

  const setField = (key: string, value: string) => {
    setForm((prev) => {
      let next = { ...prev, [key]: value };
      if (key === 'bookingType' && value === 'rental') {
        next.captainId = '';
      }
      if (key === 'duration' && prev.date && prev.startTime && Number(value) > 0) {
        next = applyDurationToForm(prev as AdminBookingFormState, Number(value));
        next = { ...next, duration: value };
      }
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    if (!form.boatId) {
      setNotice({ variant: 'error', text: 'Select a boat first.' });
      return;
    }
    if (scheduleChanged && availability === 'conflict') {
      setNotice({ variant: 'error', text: 'Conflict detected. Choose another boat or time before saving.' });
      return;
    }
    if (scheduleChanged && availability === 'checking') {
      setNotice({ variant: 'error', text: 'Availability check in progress. Wait a moment, then try again.' });
      return;
    }
    if (form.bookingType === 'captain_charter') {
      const validation = validateCharterPassengerCount(form.passengers);
      if (!validation.valid) {
        setNotice({ variant: 'error', text: validation.error });
        return;
      }
    }
    setSaving(true);
    adminDebugLog('booking-details:save:start', { bookingId: id });
    try {
      let body;
      try {
        body = buildPatchBody(form as AdminBookingFormState);
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : 'Could not prepare booking times.');
      }
      body.booking.passengerCount = form.passengers;
      body.booking.booking_source = form.source;
      body.booking.originalPrice = form.originalPrice;
      body.booking.discount = form.discount;
      body.booking.manual_discount_reason = form.discountReason;
      body.booking.finalPrice = form.finalPrice;
      body.booking.depositPaid = form.depositPaid;
      body.booking.amountCollected = form.amountCollected;
      body.booking.remainingBalance = form.remainingBalance;
      body.booking.payment_method = form.paymentMethod;
      body.booking.payment_status = form.paymentStatus;
      body.booking.staff_notes = form.internalNotes;
      body.booking.internal_notes = form.customerNotes;
      body.booking.status = form.status;
      const res = await authedFetch(`/api/admin/bookings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as DetailPayload & { error?: string };
      adminDebugLog('booking-details:save:response', { bookingId: id, status: res.status, ok: res.ok });
      if (!res.ok) throw new Error(payload.error || 'Could not save booking.');
      availabilityCheckSeq.current += 1;
      setDetail(payload);
      setDirty(false);
      setAvailability('idle');
      setNotice({ variant: 'success', text: 'Booking saved.' });
      await load();
    } catch (err) {
      console.error('Save booking failed:', err);
      setNotice({ variant: 'error', text: describeError(err, 'Could not save booking.') });
    } finally {
      setSaving(false);
    }
  };

  const actionSuccessMessage: Record<string, string> = {
    confirm_hold: 'Hold converted to confirmed booking.',
    cancel: 'Booking cancelled.',
    ready: 'Booking marked ready for departure.',
    complete: 'Booking marked completed.',
    send_confirmation: 'Confirmation email sent.',
    no_show: 'No-show recorded.',
    mark_arrived: 'Customer marked arrived.',
    release_groupon_reservation: 'Groupon reservation released.',
  };

  const runAction = async (action: string) => {
    if (activeAction) return;

    if (action === 'cancel') {
      if (
        !window.confirm(
          'Cancel this booking? The reservation will be marked cancelled but the record will remain for audit history.'
        )
      ) {
        return;
      }
    }

    if (action === 'complete') {
      if (!window.confirm('Mark this booking as completed? This updates the booking status.')) {
        return;
      }
    }

    if (action === 'ready') {
      const blockers: string[] = [];
      if (!Boolean(booking?.waiver_signed || (Array.isArray(booking?.waivers) && booking.waivers.length > 0))) {
        blockers.push('waiver not signed');
      }
      if (!['submitted', 'verified'].includes(String(booking?.insurance_status || ''))) {
        blockers.push('insurance not submitted');
      }
      if (blockers.length > 0) {
        const proceed = window.confirm(
          `Requirements incomplete (${blockers.join(', ')}). Mark ready for departure anyway?`
        );
        if (!proceed) return;
      }
    }

    setActiveAction(action);
    adminDebugLog('booking-details:action:start', {
      bookingId: id,
      action,
      endpoint: `/api/admin/bookings/${id}/actions`,
      method: 'POST',
    });
    try {
      const res = await authedFetch(`/api/admin/bookings/${id}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string; status?: string; alreadySent?: boolean };
      adminDebugLog('booking-details:action:response', {
        bookingId: id,
        action,
        status: res.status,
        ok: res.ok,
        body: payload,
      });
      if (!res.ok) throw new Error(payload.error || 'Action failed.');
      const successText =
        action === 'send_confirmation' && payload.alreadySent
          ? 'Confirmation was already sent to this customer.'
          : actionSuccessMessage[action] || 'Action completed.';
      setNotice({ variant: 'success', text: successText });
      await load();
    } catch (err) {
      console.error(`Booking action "${action}" failed:`, err);
      setNotice({ variant: 'error', text: describeError(err, 'Action failed.') });
    } finally {
      setActiveAction(null);
    }
  };

  const copyBookingLink = async () => {
    const url = `${siteOrigin()}/waivers-insurance?bookingId=${encodeURIComponent(booking?.id || id)}`;
    adminDebugLog('booking-details:copy-link:start', { bookingId: id, url });
    try {
      const result = await copyText(url);
      if (result === 'clipboard') {
        setLinkFallback(null);
        setNotice({ variant: 'success', text: 'Booking link copied.' });
      } else {
        setLinkFallback(url);
        setNotice({ variant: 'error', text: 'Could not copy automatically. Select the link below and copy it manually.' });
      }
    } catch (err) {
      console.error('Copy booking link failed:', err);
      setLinkFallback(url);
      setNotice({ variant: 'error', text: 'Could not copy to clipboard. Select the link below.' });
    }
  };

  const duplicateBooking = () => {
    const params = new URLSearchParams();
    // Omit boat so staff can book another vessel at the same time (per-boat availability).
    if (form.date) params.set('date', form.date);
    if (form.startTime) params.set('startTime', form.startTime);
    if (form.duration) params.set('durationHours', String(form.duration));
    if (form.location) params.set('location', form.location);
    if (form.customerName) params.set('customerName', form.customerName);
    if (form.phone) params.set('phone', form.phone);
    if (form.email) params.set('email', form.email);
    if (form.bookingType) params.set('bookingType', form.bookingType);
    if (form.passengers) params.set('passengerCount', String(form.passengers));
    if (form.source) params.set('bookingSource', form.source);
    navigate(`/admin/staff-booking?${params.toString()}`);
  };

  const printBooking = () => {
    adminDebugLog('booking-details:print', { bookingId: id });
    window.print();
  };

  const openCommunicationPreview = async (messageType: string) => {
    setCommunicationLoading(messageType);
    try {
      const res = await authedFetch(`/api/admin/bookings/${id}/communications/preview`, {
        method: 'POST',
        body: JSON.stringify({ messageType }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        preview?: CommunicationPreview;
        smsAvailable?: boolean;
        duplicates?: { email?: CommunicationRow | null; sms?: CommunicationRow | null };
        error?: string;
      };
      if (!res.ok || !payload.preview) throw new Error(payload.error || 'Could not preview message.');
      setCommunicationModal({
        preview: payload.preview,
        smsAvailable: Boolean(payload.smsAvailable),
        duplicates: payload.duplicates,
      });
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not preview message.' });
    } finally {
      setCommunicationLoading(null);
    }
  };

  const sendCommunication = async (channels: Array<'email' | 'sms'>, confirmDuplicate = false) => {
    if (!communicationModal) return;
    setCommunicationLoading(channels.join('+'));
    try {
      const res = await authedFetch(`/api/admin/bookings/${id}/communications/send`, {
        method: 'POST',
        body: JSON.stringify({
          messageType: communicationModal.preview.messageType,
          channels,
          confirmDuplicate,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        duplicates?: unknown[];
        error?: string;
      };
      if (res.status === 409) {
        setCommunicationModal((prev) => (prev ? { ...prev, confirmDuplicate: true } : prev));
        throw new Error(payload.error || 'This message was already sent.');
      }
      if (!res.ok) throw new Error(payload.error || 'Could not send message.');
      setCommunicationModal(null);
      setUpdatedConfirmationPrompt(false);
      setNotice({ variant: 'success', text: 'Communication sent.' });
      await load();
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not send message.' });
    } finally {
      setCommunicationLoading(null);
    }
  };

  const loadCommunicationDetail = async (row: CommunicationRow) => {
    setCommunicationActionId(row.id);
    try {
      const res = await authedFetch(`/api/admin/outbox/${row.id}`);
      const payload = (await res.json().catch(() => ({}))) as { item?: CommunicationRow; error?: string };
      if (!res.ok || !payload.item) throw new Error(payload.error || 'Could not load message.');
      setViewCommunication(payload.item);
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not load message.' });
    } finally {
      setCommunicationActionId(null);
    }
  };

  const resendSavedCommunication = async (row: CommunicationRow) => {
    if (!window.confirm(`Send this message again to ${row.recipient}?`)) return;
    setCommunicationActionId(row.id);
    try {
      const res = await authedFetch(`/api/admin/outbox/${row.id}/resend`, {
        method: 'POST',
        body: '{}',
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error || 'Could not resend message.');
      setNotice({ variant: 'success', text: 'Message resent.' });
      await load();
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not resend message.' });
    } finally {
      setCommunicationActionId(null);
    }
  };

  const applyCustomEmailTemplate = (templateKey: keyof typeof customEmailTemplates) => {
    const template = customEmailTemplates[templateKey];
    setCustomEmail((prev) => ({
      ...prev,
      subject: template.subject,
      message: template.message,
    }));
  };

  const clearCustomEmail = () => {
    const customerEmail = String(booking?.customers?.email || booking?.email || '').trim().toLowerCase();
    setCustomEmail({ to: customerEmail, subject: '', message: '' });
    setEmailRecipientEditable(false);
    setCustomEmailPreview(null);
  };

  const validateCustomEmailForm = () => {
    if (!customEmail.to.trim()) return 'Customer email is missing.';
    if (!customEmail.subject.trim()) return 'Subject is required.';
    if (!customEmail.message.trim()) return 'Message is required.';
    if (!emailConfig?.resendConfigured) return 'Email service is not configured.';
    return '';
  };

  const previewCustomEmail = async () => {
    const validationError = validateCustomEmailForm();
    if (validationError) {
      setNotice({ variant: 'error', text: validationError });
      return;
    }
    setCustomEmailLoading('preview');
    try {
      const res = await authedFetch(`/api/admin/bookings/${id}/email-customer/preview`, {
        method: 'POST',
        body: JSON.stringify(customEmail),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        preview?: CustomEmailPreview;
        error?: string;
      };
      if (!res.ok || !payload.preview) throw new Error(payload.error || 'Could not preview email.');
      setCustomEmailPreview(payload.preview);
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not preview email.' });
    } finally {
      setCustomEmailLoading(null);
    }
  };

  const sendCustomEmail = async () => {
    if (!customEmailPreview) return;
    setCustomEmailLoading('send');
    try {
      const res = await authedFetch(`/api/admin/bookings/${id}/email-customer/send`, {
        method: 'POST',
        body: JSON.stringify({
          to: customEmailPreview.to,
          subject: customEmailPreview.subject,
          message: customEmailPreview.message,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error || 'Could not send email.');
      setCustomEmailPreview(null);
      setNotice({ variant: 'success', text: 'Email sent.' });
      setCustomEmail((prev) => ({ ...prev, subject: '', message: '' }));
      await load();
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not send email.' });
      await load();
    } finally {
      setCustomEmailLoading(null);
    }
  };

  if (authLoading) return <FullPageLoader message="Checking admin access…" />;
  if (!isAdmin) {
    return <AdminAccessDenied signedIn={Boolean(user)} />;
  }
  if (loading && !detail) {
    return (
      <AdminShell title="Booking Details" subtitle="Loading reservation…">
        <LoadingSection message="Loading booking details…" />
      </AdminShell>
    );
  }
  if (!booking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-lg rounded-xl bg-white p-8 text-center shadow">
          <h1 className="text-2xl font-bold">Booking not found</h1>
          <p className="mt-2 text-slate-600">
            {notice?.text || 'This booking could not be loaded. It may have been removed, or the request timed out.'}
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg bg-amber-600 px-6 py-3 font-bold text-white"
            >
              Retry
            </button>
            <Link to="/admin/bookings/list" className="rounded-lg bg-slate-200 px-6 py-3 font-bold text-slate-900">
              Back to Bookings
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const waiverDone = Boolean(booking.waiver_signed || (Array.isArray(booking.waivers) && booking.waivers.length > 0));
  const insuranceDone = ['submitted', 'verified'].includes(String(booking.insurance_status || ''));
  const licenseDone = ['verified'].includes(String(booking.license_status || '')) || Boolean(booking.license_url);
  const checklistDone = ['ready_for_departure', 'completed'].includes(String(booking.status || ''));
  const bookingCustomer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers;
  const hasLicenseDoc = Boolean(booking.license_url || bookingCustomer?.id_document_url);
  const hasInsuranceDoc = Boolean(booking.insurance_url || bookingCustomer?.insurance_proof_url);
  const verification = Array.isArray(booking.user_verifications)
    ? booking.user_verifications[0]
    : booking.user_verifications;
  const hasBuoyDoc = Boolean(verification?.buoy_proof_url);
  const evidenceFileBase = evidencePackageFileName(bookingCustomer?.full_name, booking.created_at, 'zip').replace(
    /\.zip$/,
    ''
  );

  const inputClass =
    'mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200';
  const labelClass = 'block text-sm font-bold text-slate-700';
  const actionBtnClass =
    'inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-lg px-4 py-3 font-bold disabled:cursor-not-allowed disabled:opacity-50';

  const noticeBanner = notice ? (
    <div
      className={`rounded-lg px-4 py-3 font-semibold ${
        notice.variant === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}
      role="status"
      aria-live="polite"
    >
      {notice.text}
    </div>
  ) : null;

  const saveDisabled =
    saving || !env.apiUrlConfigured || (scheduleChanged && (availability === 'conflict' || availability === 'checking'));
  const saveDisabledReason = saving
    ? 'Saving…'
    : !env.apiUrlConfigured
      ? 'API URL is not configured.'
      : scheduleChanged && availability === 'checking'
        ? 'Checking availability…'
        : scheduleChanged && availability === 'conflict'
          ? 'Schedule conflict — choose another boat or time.'
          : '';

  return (
    <AdminShell
      title="Booking Details"
      subtitle={<span title={booking.id}>Ref {shortId(booking.id, 8)}</span>}
      actions={
        <>
          <Link
            to={`/admin/bookings/${id}/edit`}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-600 px-4 py-3 text-sm font-semibold text-white hover:bg-amber-500"
          >
            <Pencil className="h-4 w-4" aria-hidden />
            Edit Booking
          </Link>
          <Link
            to="/admin/bookings/list"
            className="inline-flex min-h-11 items-center rounded-lg bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
          >
            All Bookings
          </Link>
          <Link
            to="/admin/bookings"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-600 bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Hub
          </Link>
          <Link
            to="/admin/calendar"
            className="inline-flex min-h-11 items-center rounded-lg bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Calendar
          </Link>
        </>
      }
    >
      <AdminGrouponReviewPanel
        bookingId={id}
        bookingStatus={String(form.status || booking.status || '')}
        bookingSource={String(form.source || booking.booking_source || '')}
        authedFetch={authedFetch}
        onActionComplete={load}
        boats={boats}
        captains={captains}
        currentBoatId={form.boatId || booking.boat_id}
        currentCaptainId={form.captainId || booking.captain_id}
        tripDate={form.date}
        startTimeLocal={form.startTime}
        endTimeLocal={form.endTime}
      />
      {booking.charter_type === 'bio' ? (
        <div className="rounded-xl border border-cyan-500/25 bg-slate-900/80 p-4 text-sm text-slate-200">
          <p className="font-semibold text-cyan-100">Bioluminescence pricing</p>
          {booking.pricing_package_id ? (
            <ul className="mt-2 space-y-1 text-slate-300">
              <li>Package ID: {String(booking.pricing_package_id)}</li>
              <li>Name: {String(booking.pricing_package_name || '—')}</li>
              <li>Guests: {String(booking.package_guest_count ?? booking.guest_count ?? '—')}</li>
              <li>
                Standard value:{' '}
                {booking.standard_value_cents != null
                  ? `$${(Number(booking.standard_value_cents) / 100).toFixed(2)}`
                  : '—'}
              </li>
              <li>
                Package price:{' '}
                {booking.package_price_cents != null
                  ? `$${(Number(booking.package_price_cents) / 100).toFixed(2)}`
                  : '—'}
              </li>
              <li>
                Savings:{' '}
                {booking.discount_amount_cents != null
                  ? `$${(Number(booking.discount_amount_cents) / 100).toFixed(2)}`
                  : '—'}
              </li>
              <li>Final amount: {form.finalPrice}</li>
              <li>Source: {form.source || 'website'}</li>
              <li>Payment: {form.paymentStatus}</li>
            </ul>
          ) : (
            <p className="mt-2 text-slate-400">{BIO_LEGACY_PRICING_LABEL}</p>
          )}
        </div>
      ) : null}
      <div className="admin-booking-details-page grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="order-2 space-y-6 lg:order-1">
          <div className="hidden print:block">
            <h2 className="text-2xl font-black">Launch Zone Charters — Booking Summary</h2>
            <p className="mt-1 text-sm text-slate-600">
              Ref {shortId(booking.id, 8)} · Printed {new Date().toLocaleString()}
            </p>
            <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <span className="font-bold">Customer:</span> {form.customerName || '-'}
              </div>
              <div>
                <span className="font-bold">Status:</span> {humanizeLabel(String(form.status || ''))}
              </div>
              <div>
                <span className="font-bold">Trip:</span> {form.date} {form.startTime}–{form.endTime} · {form.location}
              </div>
              <div>
                <span className="font-bold">Payment:</span> ${money(form.finalPrice)} ({humanizeLabel(String(form.paymentStatus || ''))})
              </div>
              <div>
                <span className="font-bold">Waiver:</span> {waiverDone ? 'Signed' : 'Missing'}
              </div>
              <div>
                <span className="font-bold">Insurance:</span> {insuranceDone ? 'Submitted' : 'Missing'}
              </div>
            </div>
          </div>

          {!env.apiUrlConfigured ? (
            <div className="admin-booking-no-print rounded-lg bg-red-100 px-4 py-3 font-semibold text-red-800">
              API URL is not configured (set VITE_API_URL). Save and booking actions will not work until this is fixed.
            </div>
          ) : null}

          {updatedConfirmationPrompt ? (
            <div className="admin-booking-no-print rounded-xl border-2 border-amber-300 bg-amber-50 p-5">
              <p className="text-lg font-bold text-amber-950">
                Important trip details changed. Would you like to send the customer an updated confirmation?
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void openCommunicationPreview('booking_updated')}
                  className="min-h-12 rounded-xl bg-amber-700 px-5 py-3 text-lg font-black text-white"
                >
                  Send Updated Confirmation
                </button>
                <button
                  type="button"
                  onClick={() => setUpdatedConfirmationPrompt(false)}
                  className="min-h-12 rounded-xl border-2 border-amber-400 bg-white px-5 py-3 text-lg font-bold text-amber-950"
                >
                  Not now
                </button>
              </div>
            </div>
          ) : null}

          {needsCaptainAssignment ? (
            <div className="admin-booking-no-print rounded-xl border-2 border-orange-300 bg-orange-50 p-5">
              <p className="text-lg font-bold text-orange-950">
                This confirmed captain charter has no assigned captain. Assign one below so it appears in the captain portal.
              </p>
            </div>
          ) : null}

          <div className="lg:hidden">{noticeBanner}</div>

          <div className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-2xl bg-white p-5 shadow">
              <h2 className="text-xl font-black">Customer</h2>
              <div className="mt-4 grid gap-4">
                <label className={labelClass}>Customer Name<input className={inputClass} value={form.customerName || ''} onChange={(e) => setField('customerName', e.target.value)} /></label>
                <label className={labelClass}>Phone<input className={inputClass} value={form.phone || ''} onChange={(e) => setField('phone', e.target.value)} /></label>
                <label className={labelClass}>Email<input className={inputClass} value={form.email || ''} onChange={(e) => setField('email', e.target.value)} /></label>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-cyan-100 px-3 py-1 text-sm font-bold text-cyan-900">
                    {detail.lifetimeBookings > 1 ? 'Returning Customer' : 'New Customer'}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-700">
                    {detail.lifetimeBookings} lifetime booking{detail.lifetimeBookings === 1 ? '' : 's'}
                  </span>
                </div>
                <label className={labelClass}>Internal customer notes<textarea className={`${inputClass} min-h-[110px]`} value={form.customerNotes || ''} onChange={(e) => setField('customerNotes', e.target.value)} /></label>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow">
              <h2 className="text-xl font-black">Trip Information</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>Boat<select className={inputClass} value={form.boatId || ''} onChange={(e) => setField('boatId', e.target.value)}><option value="">Select boat</option>{boats.map((boat) => <option key={boat.id} value={boat.id}>{boat.name}</option>)}</select></label>
                <label className={labelClass}>Location<input className={inputClass} value={form.location || ''} onChange={(e) => setField('location', e.target.value)} /></label>
                <label className={labelClass}>Booking Type<select className={inputClass} value={form.bookingType || 'rental'} onChange={(e) => setField('bookingType', e.target.value)}><option value="rental">Rental</option><option value="captain_charter">Captain Charter</option></select></label>
                {form.bookingType === 'captain_charter' ? (
                  <>
                    <label className={labelClass}>
                      Assigned captain
                      <select className={inputClass} value={form.captainId || ''} onChange={(e) => setField('captainId', e.target.value)}>
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
                        value={form.emergencyContactNotes || ''}
                        onChange={(e) => setField('emergencyContactNotes', e.target.value)}
                      />
                    </label>
                  </>
                ) : null}
                <label className={labelClass}>Date<input className={inputClass} type="date" value={form.date || ''} onChange={(e) => setField('date', e.target.value)} /></label>
                <label className={labelClass}>Start Time<input className={inputClass} type="time" value={form.startTime || ''} onChange={(e) => setField('startTime', e.target.value)} /></label>
                <label className={labelClass}>End Time<input className={inputClass} type="time" value={form.endTime || ''} onChange={(e) => setField('endTime', e.target.value)} /></label>
                {overnightEndNote ? <p className="sm:col-span-2 text-sm font-semibold text-cyan-900">{overnightEndNote}</p> : null}
                <label className={labelClass}>Duration<input className={inputClass} type="number" step="0.5" value={form.duration || ''} onChange={(e) => setField('duration', e.target.value)} /></label>
                <label className={labelClass}>
                  Passengers
                  <input
                    className={inputClass}
                    type="number"
                    min="1"
                    max={form.bookingType === 'captain_charter' ? CHARTER_MAX_PASSENGERS : undefined}
                    value={form.passengers || ''}
                    onChange={(e) => setField('passengers', e.target.value)}
                  />
                </label>
                {form.bookingType === 'captain_charter' ? (
                  <div className="rounded-lg bg-purple-50 p-3 text-sm font-semibold text-purple-950 sm:col-span-2">
                    {(() => {
                      const lines = adminCharterCapacityLines(form.passengers || 1);
                      return (
                        <>
                          <div>{lines.passengerLine}</div>
                          <div>{lines.captainLine}</div>
                          <div>{lines.totalLine}</div>
                        </>
                      );
                    })()}
                  </div>
                ) : null}
                <label className={`${labelClass} sm:col-span-2`}>
                  Booking Source
                  <select className={inputClass} value={form.source || ''} onChange={(e) => setField('source', e.target.value)}>
                    {sourceOptions.map((s) => (
                      <option key={s} value={s}>
                        {humanizeLabel(s)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-4 text-sm font-bold">
                {!form.boatId ? <span className="text-slate-600">Select a boat first.</span> : null}
                {availability === 'available' ? <span className="text-green-700">Available</span> : null}
                {availability === 'conflict' ? <span className="text-red-700">Conflict Detected</span> : null}
                {availability === 'checking' ? <span className="text-slate-600">Checking availability...</span> : null}
                {availability === 'error' ? (
                  <span className="text-amber-800">Could not verify availability. You can still save — the server will validate.</span>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow xl:col-span-2">
              <h2 className="text-xl font-black">Booking</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <label className={labelClass}>
                  Status
                  <select className={inputClass} value={form.status || 'pending'} onChange={(e) => setField('status', e.target.value)}>
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {humanizeLabel(status)}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <div className="text-sm font-bold text-slate-700">Created</div>
                  <div className="mt-1 rounded-lg bg-slate-100 px-3 py-2 text-slate-800">
                    {booking.created_at ? new Date(booking.created_at).toLocaleString() : '-'}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-700">Source</div>
                  <div className="mt-1 rounded-lg bg-slate-100 px-3 py-2 text-slate-800">
                    {form.source || (booking.staff_created ? 'admin' : 'website')}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow">
            <h2 className="text-xl font-black">Pricing</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className={labelClass}>Original Price<input className={inputClass} type="number" value={form.originalPrice || ''} onChange={(e) => setField('originalPrice', e.target.value)} /></label>
              <label className={labelClass}>Discount<input className={inputClass} type="number" value={form.discount || ''} onChange={(e) => setField('discount', e.target.value)} /></label>
              <label className={labelClass}>Final Price<input className={inputClass} type="number" value={form.finalPrice || ''} onChange={(e) => setField('finalPrice', e.target.value)} /></label>
              <label className={labelClass}>Deposit Paid<input className={inputClass} type="number" value={form.depositPaid || ''} onChange={(e) => setField('depositPaid', e.target.value)} /></label>
              <label className={labelClass}>Amount Collected<input className={inputClass} type="number" value={form.amountCollected || ''} onChange={(e) => setField('amountCollected', e.target.value)} /></label>
              <label className={labelClass}>Remaining Balance<input className={inputClass} type="number" value={form.remainingBalance || ''} onChange={(e) => setField('remainingBalance', e.target.value)} /></label>
              <label className={labelClass}>Payment Method<select className={inputClass} value={form.paymentMethod || ''} onChange={(e) => setField('paymentMethod', e.target.value)}>{paymentMethods.map((m) => <option key={m} value={m}>{m || 'None'}</option>)}</select></label>
              <label className={labelClass}>
                Payment Status
                <select className={inputClass} value={form.paymentStatus || 'pending'} onChange={(e) => setField('paymentStatus', e.target.value)}>
                  {paymentStatuses.map((s) => (
                    <option key={s} value={s}>
                      {humanizeLabel(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`${labelClass} sm:col-span-2 lg:col-span-4`}>Discount Reason<input className={inputClass} value={form.discountReason || ''} onChange={(e) => setField('discountReason', e.target.value)} /></label>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow">
            <h2 className="text-xl font-black">Internal Notes</h2>
            <textarea className={`${inputClass} mt-4 min-h-[160px]`} value={form.internalNotes || ''} onChange={(e) => setField('internalNotes', e.target.value)} />
          </div>

          <div className="rounded-2xl bg-white p-5 shadow">
            <h2 className="text-xl font-black">Booking History</h2>
            <p className="mt-1 text-sm text-slate-500">Recent admin edits to this reservation.</p>
            <div className="mt-4 space-y-3">
              {bookingHistory.length === 0 ? (
                <p className="text-base text-slate-600">No edit history yet.</p>
              ) : (
                bookingHistory.map((event) => (
                  <div key={event.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="font-semibold text-slate-900">{event.message || formatEventName(event.event_type)}</div>
                    <div className="text-xs text-slate-400">{new Date(event.created_at).toLocaleString()}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow">
            <h2 className="text-xl font-black">Audit Timeline</h2>
            <p className="mt-1 text-sm text-slate-500">Append-only activity, communications, and system events.</p>
            <div className="mt-4 space-y-3">
              {auditTimeline.map((event) => (
                <div key={`${event.kind}-${event.id}`} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-bold">{formatEventName(event.event_type)}</div>
                    {event.actor_type ? (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                        {event.actor_type}
                      </span>
                    ) : null}
                    {event.kind === 'communication' ? (
                      <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-800">
                        {event.channel}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-sm text-slate-600">{event.message || '-'}</div>
                  <div className="text-xs text-slate-400">{new Date(event.created_at).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Aside first on mobile so payment/actions stay reachable without long scroll */}
        <aside className="order-1 space-y-5 lg:order-2">
          <div className="rounded-2xl bg-white p-5 shadow lg:sticky lg:top-20">
            <h2 className="text-xl font-black">Actions</h2>
            <Link
              to={`/admin/bookings/${id}/edit`}
              className="mt-4 inline-flex min-h-14 w-full touch-manipulation items-center justify-center gap-3 rounded-xl bg-amber-600 px-5 py-4 text-xl font-black text-white hover:bg-amber-500"
            >
              <Pencil className="h-6 w-6" aria-hidden />
              Edit Booking
            </Link>
            <div className="mt-3 space-y-3">
              {noticeBanner}
              {saveDisabledReason ? (
                <p className="text-sm font-semibold text-slate-600">{saveDisabledReason}</p>
              ) : null}
            </div>
            <div className="admin-booking-actions-panel mt-4 grid gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saveDisabled}
                className={`${actionBtnClass} bg-slate-900 text-white`}
              >
                <Save className="h-4 w-4" />
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              {booking.status === 'hold' ? (
                <button
                  type="button"
                  onClick={() => void runAction('confirm_hold')}
                  disabled={Boolean(activeAction) || !env.apiUrlConfigured}
                  className={`${actionBtnClass} bg-green-700 text-white`}
                >
                  {activeAction === 'confirm_hold' ? 'Working…' : 'Convert Hold to Confirmed'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void runAction('cancel')}
                disabled={Boolean(activeAction) || !env.apiUrlConfigured}
                className={`${actionBtnClass} bg-red-700 text-white`}
              >
                {activeAction === 'cancel' ? 'Cancelling…' : 'Cancel Booking'}
              </button>
              <button
                type="button"
                onClick={() => void runAction('ready')}
                disabled={Boolean(activeAction) || !env.apiUrlConfigured}
                className={`${actionBtnClass} bg-cyan-700 text-white`}
              >
                {activeAction === 'ready' ? 'Updating…' : 'Mark Ready for Departure'}
              </button>
              <button
                type="button"
                onClick={() => void runAction('complete')}
                disabled={Boolean(activeAction) || !env.apiUrlConfigured}
                className={`${actionBtnClass} bg-slate-700 text-white`}
              >
                {activeAction === 'complete' ? 'Updating…' : 'Mark Completed'}
              </button>
              <button
                type="button"
                onClick={duplicateBooking}
                disabled={Boolean(activeAction)}
                className={`${actionBtnClass} bg-purple-700 text-white`}
              >
                Duplicate Booking
              </button>
              <button
                type="button"
                onClick={() => void runAction('send_confirmation')}
                disabled={Boolean(activeAction) || !env.apiUrlConfigured}
                className={`${actionBtnClass} bg-amber-600 text-white`}
              >
                {activeAction === 'send_confirmation' ? 'Sending…' : 'Send Confirmation'}
              </button>
              <button
                type="button"
                onClick={() => void copyBookingLink()}
                disabled={Boolean(activeAction)}
                className={`${actionBtnClass} border border-slate-300 bg-white text-slate-900`}
              >
                <Copy className="h-4 w-4" />
                Copy Booking Link
              </button>
              <button
                type="button"
                onClick={printBooking}
                disabled={Boolean(activeAction)}
                className={`${actionBtnClass} border border-slate-300 bg-white text-slate-900`}
              >
                <Printer className="h-4 w-4" />
                Print Booking
              </button>
            </div>
            {linkFallback ? (
              <div className="admin-booking-no-print mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="text-sm font-bold text-amber-950">Booking link</div>
                <input
                  className="mt-2 min-h-11 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900"
                  value={linkFallback}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                />
              </div>
            ) : null}
          </div>
          <div className="rounded-2xl bg-white p-5 shadow">
            <h2 className="text-xl font-black">Payment</h2>
            <p className="mt-3 text-3xl font-black">${money(form.finalPrice)}</p>
            <p className="text-sm capitalize text-slate-600">{humanizeLabel(String(form.paymentStatus || 'pending'))}</p>
            <div className="mt-4 space-y-1 text-xs text-slate-600">
              <div>
                <span className="font-bold">Payment Intent:</span>{' '}
                <AdminId value={booking.payment_intent_id} len={14} />
              </div>
              <div>
                <span className="font-bold">Checkout Session:</span>{' '}
                <AdminId value={booking.checkout_session_id || booking.stripe_payment_id} len={14} />
              </div>
              <div>
                <span className="font-bold">Charge:</span>{' '}
                <AdminId value={booking.stripe_charge_id} len={14} />
              </div>
            </div>
          </div>

          <div className="admin-booking-no-print rounded-2xl bg-white p-5 shadow">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-black">Dispute</h2>
              <Link to="/admin/disputes" className="text-sm font-bold text-amber-700 hover:underline">
                All Disputes
              </Link>
            </div>
            {!bookingDispute ? (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-slate-500">No Stripe dispute linked to this booking.</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={evidenceLoading}
                    onClick={() => void generateEvidence()}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    <FileText className="h-4 w-4" />
                    {evidenceLoading ? 'Generating...' : 'Generate Evidence Summary'}
                  </button>
                  <button
                    type="button"
                    disabled={exportLoading != null}
                    onClick={() =>
                      void downloadExport(
                        `/api/admin/bookings/${encodeURIComponent(id)}/evidence-pdf`,
                        `booking-evidence-${id.slice(0, 8)}.pdf`,
                        'pdf'
                      )
                    }
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" />
                    {exportLoading === 'pdf' ? 'Downloading...' : 'Download PDF'}
                  </button>
                  <button
                    type="button"
                    disabled={exportLoading != null}
                    onClick={() =>
                      void downloadExport(
                        `/api/admin/bookings/${encodeURIComponent(id)}/evidence-zip`,
                        `booking-evidence-${id.slice(0, 8)}.zip`,
                        'zip'
                      )
                    }
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
                  >
                    <FileArchive className="h-4 w-4" />
                    {exportLoading === 'zip' ? 'Downloading...' : 'Download ZIP'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${disputeStatusClass(bookingDispute.status)}`}>
                    {bookingDispute.status.replace(/_/g, ' ')}
                  </span>
                  {bookingDispute.evidence_due_by ? (
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">
                      {disputeDeadlineLabel(bookingDispute.evidence_due_by)}
                    </span>
                  ) : null}
                </div>
                <div className="space-y-1 text-sm text-slate-700">
                  <div><span className="font-bold">Amount:</span> ${money(bookingDispute.amount)} {bookingDispute.currency?.toUpperCase()}</div>
                  <div><span className="font-bold">Reason:</span> {bookingDispute.reason?.replace(/_/g, ' ') || '-'}</div>
                  <div>
                    <span className="font-bold">Stripe Dispute:</span>{' '}
                    <AdminId value={bookingDispute.stripe_dispute_id} len={14} />
                  </div>
                  <div><span className="font-bold">Evidence due:</span> {bookingDispute.evidence_due_by ? new Date(bookingDispute.evidence_due_by).toLocaleString() : '-'}</div>
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">Dispute Notes</h3>
                  <div className="mt-2 space-y-2 md:max-h-40 md:overflow-y-auto">
                    {disputeNotes.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-500">No dispute notes yet.</p>
                    ) : (
                      disputeNotes.map((note) => (
                        <div key={note.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                          <div className="whitespace-pre-wrap">{note.note_text}</div>
                          <div className="mt-1 text-xs text-slate-400">{new Date(note.created_at).toLocaleString()}</div>
                        </div>
                      ))
                    )}
                  </div>
                  <textarea
                    className={`${inputClass} mt-3 min-h-[90px]`}
                    placeholder="Add a dispute note..."
                    value={disputeNoteText}
                    onChange={(e) => setDisputeNoteText(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={disputeLoading || !disputeNoteText.trim()}
                    onClick={() => void addDisputeNote()}
                    className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {disputeLoading ? 'Saving...' : 'Add Dispute Note'}
                  </button>
                </div>
                <button
                  type="button"
                  disabled={evidenceLoading}
                  onClick={() => void generateEvidence()}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-3 font-bold text-white disabled:opacity-50"
                >
                  <FileText className="h-4 w-4" />
                  {evidenceLoading ? 'Generating...' : 'Generate Evidence Summary'}
                </button>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={exportLoading != null}
                    onClick={() =>
                      void downloadExport(
                        `/api/admin/bookings/${encodeURIComponent(id)}/evidence-pdf`,
                        `booking-evidence-${id.slice(0, 8)}.pdf`,
                        'pdf'
                      )
                    }
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" />
                    {exportLoading === 'pdf' ? 'Downloading...' : 'Download PDF'}
                  </button>
                  <button
                    type="button"
                    disabled={exportLoading != null}
                    onClick={() =>
                      void downloadExport(
                        `/api/admin/bookings/${encodeURIComponent(id)}/evidence-zip`,
                        `booking-evidence-${id.slice(0, 8)}.zip`,
                        'zip'
                      )
                    }
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
                  >
                    <FileArchive className="h-4 w-4" />
                    {exportLoading === 'zip' ? 'Downloading...' : 'Download ZIP'}
                  </button>
                  {bookingDispute?.id ? (
                    <button
                      type="button"
                      disabled={exportLoading != null}
                      onClick={() => void submitStripeEvidence()}
                      className="inline-flex items-center gap-2 rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold text-white hover:bg-rose-600 disabled:opacity-50"
                    >
                      {exportLoading === 'stripe' ? 'Submitting...' : 'Submit to Stripe'}
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className="admin-booking-no-print">
          <AdminBookingCapacityPanel
            bookingId={id || booking.id}
            authedFetch={authedFetch}
            boatId={form.boatId || booking.boat_id || null}
          />

          <AdminLegalEvidencePanel
            bookingId={id || booking.id}
            booking={booking}
            waiverDone={waiverDone}
            insuranceDone={insuranceDone}
            licenseDone={licenseDone}
            hasLicenseDoc={hasLicenseDoc}
            hasInsuranceDoc={hasInsuranceDoc}
            hasBuoyDoc={hasBuoyDoc}
            checklistDone={checklistDone}
            evidenceLoading={evidenceLoading}
            exportLoading={exportLoading === 'pdf' || exportLoading === 'zip' ? exportLoading : null}
            onGenerateSummary={() => void generateEvidence()}
            onDownloadPdf={() =>
              void downloadExport(
                `/api/admin/bookings/${encodeURIComponent(id || booking.id)}/evidence-pdf`,
                `${evidenceFileBase}.pdf`,
                'pdf'
              )
            }
            onDownloadZip={() =>
              void downloadExport(
                `/api/admin/bookings/${encodeURIComponent(id || booking.id)}/evidence-zip`,
                `${evidenceFileBase}.zip`,
                'zip'
              )
            }
          />

          <div className="rounded-2xl bg-white p-5 shadow">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-black">Email Customer</h2>
                <p className="mt-1 text-sm text-slate-600">Send a custom email from the admin site.</p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-sm font-black ${
                  emailConfig?.resendConfigured ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}
              >
                Email sending: {emailConfig?.resendConfigured ? 'Ready' : 'Not configured'}
              </span>
            </div>
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs font-semibold text-slate-600">
              From: {emailConfig?.senderEmail || 'Joshua at Launch Zone Charters <joshua@launchzonecharters.com>'}
            </div>

            <div className="mt-4 space-y-4">
              <label className={labelClass}>
                To
                <div className="mt-1 flex gap-2">
                  <input
                    className={inputClass}
                    type="email"
                    value={customEmail.to}
                    disabled={!emailRecipientEditable}
                    onChange={(e) => setCustomEmail((prev) => ({ ...prev, to: e.target.value }))}
                    placeholder="customer@example.com"
                  />
                  <button
                    type="button"
                    onClick={() => setEmailRecipientEditable((prev) => !prev)}
                    className="rounded-lg border border-slate-300 px-4 py-2 font-bold text-slate-800 hover:bg-slate-50"
                  >
                    {emailRecipientEditable ? 'Lock' : 'Edit recipient'}
                  </button>
                </div>
              </label>

              <div>
                <div className="text-sm font-bold text-slate-700">Quick Templates</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {Object.entries(customEmailTemplates).map(([key, template]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => applyCustomEmailTemplate(key as keyof typeof customEmailTemplates)}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-left font-bold text-slate-900 hover:bg-slate-50"
                    >
                      {template.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className={labelClass}>
                Subject *
                <input
                  className={inputClass}
                  value={customEmail.subject}
                  onChange={(e) => setCustomEmail((prev) => ({ ...prev, subject: e.target.value }))}
                  placeholder="Subject"
                />
              </label>

              <label className={labelClass}>
                Message *
                <textarea
                  className={`${inputClass} min-h-[220px]`}
                  value={customEmail.message}
                  onChange={(e) => setCustomEmail((prev) => ({ ...prev, message: e.target.value }))}
                  placeholder="Type your message to the customer..."
                />
              </label>

              <div className="grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => void previewCustomEmail()}
                  disabled={customEmailLoading != null}
                  className="rounded-xl bg-slate-900 px-5 py-4 text-lg font-black text-white disabled:opacity-50"
                >
                  {customEmailLoading === 'preview' ? 'Previewing...' : 'Preview Email'}
                </button>
                <button
                  type="button"
                  onClick={() => void previewCustomEmail()}
                  disabled={customEmailLoading != null}
                  className="rounded-xl bg-green-700 px-5 py-4 text-lg font-black text-white disabled:opacity-50"
                >
                  Send Email
                </button>
                <button
                  type="button"
                  onClick={clearCustomEmail}
                  disabled={customEmailLoading != null}
                  className="rounded-xl border border-slate-300 bg-white px-5 py-4 text-lg font-black text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
              <p className="text-xs font-semibold text-slate-500">Send Email opens the preview first. Nothing sends until you confirm.</p>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow">
            <h2 className="text-xl font-black">Communications</h2>
            <div className="mt-4 grid gap-2">
              {communicationButtons.map(([messageType, label]) => (
                <button
                  key={messageType}
                  type="button"
                  onClick={() => void openCommunicationPreview(messageType)}
                  disabled={communicationLoading != null}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-left font-bold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                >
                  {communicationLoading === messageType ? 'Preparing...' : label}
                </button>
              ))}
            </div>
            <div className="mt-5 border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">History</h3>
                <Link to="/admin/outbox" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50">
                  Full Outbox
                </Link>
              </div>
              <div className="mt-3 space-y-2">
                {(detail.communications || []).length === 0 ? (
                  <p className="text-sm text-slate-500">No communications logged yet.</p>
                ) : (
                  (detail.communications || []).slice(0, 12).map((row) => (
                    <div key={row.id} className="rounded-xl border border-slate-200 p-4 text-sm">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="font-black capitalize">{row.message_type.replace(/_/g, ' ')}</div>
                          <div className="text-slate-600">{row.channel.toUpperCase()} · {row.recipient || 'No recipient'}</div>
                          {row.subject ? <div className="mt-1 text-slate-700">{row.subject}</div> : null}
                          <div className="text-xs text-slate-500">{new Date(row.sent_at || row.created_at).toLocaleString()}</div>
                        </div>
                        <span className={`w-fit rounded-full px-3 py-1 text-xs font-black capitalize ${communicationStatusClass(row.status)}`}>
                          {row.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">Sent by: {row.sent_by || 'system/admin'}</div>
                      {row.error_message ? <div className="mt-1 text-xs font-semibold text-red-700">{row.error_message}</div> : null}
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => void loadCommunicationDetail(row)}
                          disabled={communicationActionId === row.id}
                          className="rounded-lg border border-slate-300 px-3 py-2 font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => void resendSavedCommunication(row)}
                          disabled={communicationActionId === row.id}
                          className="rounded-lg bg-green-700 px-3 py-2 font-bold text-white disabled:opacity-50"
                        >
                          Resend
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          </div>

        </aside>
      </div>

      {customEmailPreview ? (
        <div className="admin-booking-no-print fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">Preview Email</h2>
                <p className="mt-1 text-sm text-slate-600">Review this message before sending.</p>
              </div>
              <button
                type="button"
                onClick={() => setCustomEmailPreview(null)}
                className="rounded-lg bg-slate-100 px-3 py-2 font-bold text-slate-800"
              >
                Cancel
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-sm font-black text-slate-500">From</div>
                <div className="mt-1 font-semibold text-slate-900">{customEmailPreview.from}</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-sm font-black text-slate-500">To</div>
                <div className="mt-1 font-semibold text-slate-900">{customEmailPreview.to}</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-sm font-black text-slate-500">Subject</div>
                <div className="mt-1 font-semibold text-slate-900">{customEmailPreview.subject}</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-sm font-black text-slate-500">Message</div>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-4 text-sm text-slate-900">
                  {customEmailPreview.message}
                </pre>
              </div>
            </div>

            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setCustomEmailPreview(null)}
                disabled={customEmailLoading === 'send'}
                className="rounded-xl border border-slate-300 px-5 py-4 text-lg font-black text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void sendCustomEmail()}
                disabled={customEmailLoading === 'send'}
                className="rounded-xl bg-green-700 px-5 py-4 text-lg font-black text-white disabled:opacity-50"
              >
                {customEmailLoading === 'send' ? 'Sending...' : 'Send Email'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {viewCommunication ? (
        <div className="admin-booking-no-print fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">Communication</h2>
                <p className="mt-1 text-sm capitalize text-slate-600">{viewCommunication.message_type.replace(/_/g, ' ')}</p>
              </div>
              <button type="button" onClick={() => setViewCommunication(null)} className="rounded-lg bg-slate-100 px-3 py-2 font-bold text-slate-800">
                Close
              </button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border p-4"><div className="text-xs font-black uppercase text-slate-500">To</div><div className="mt-1 break-all">{viewCommunication.recipient}</div></div>
              <div className="rounded-xl border p-4"><div className="text-xs font-black uppercase text-slate-500">Channel</div><div className="mt-1 uppercase">{viewCommunication.channel}</div></div>
              <div className="rounded-xl border p-4"><div className="text-xs font-black uppercase text-slate-500">Subject</div><div className="mt-1">{viewCommunication.subject || '-'}</div></div>
              <div className="rounded-xl border p-4"><div className="text-xs font-black uppercase text-slate-500">Status</div><div className="mt-1 capitalize">{viewCommunication.status}</div></div>
              <div className="rounded-xl border p-4"><div className="text-xs font-black uppercase text-slate-500">Sent At</div><div className="mt-1">{new Date(viewCommunication.sent_at || viewCommunication.created_at).toLocaleString()}</div></div>
              <div className="rounded-xl border p-4"><div className="text-xs font-black uppercase text-slate-500">Sent By</div><div className="mt-1 break-all">{viewCommunication.sent_by || 'system/admin'}</div></div>
            </div>
            {viewCommunication.error_message ? <div className="mt-4 rounded-xl bg-red-100 p-4 font-semibold text-red-800">{viewCommunication.error_message}</div> : null}
            <div className="mt-4 rounded-xl border p-4">
              <div className="text-xs font-black uppercase text-slate-500">Body</div>
              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-4 text-sm">{viewCommunication.body || '-'}</pre>
            </div>
            <div className="mt-6 grid gap-2 sm:grid-cols-3">
              <button type="button" onClick={() => setViewCommunication(null)} className="rounded-xl border px-5 py-4 text-lg font-black">Close</button>
              <button type="button" onClick={() => void resendSavedCommunication(viewCommunication)} disabled={communicationActionId === viewCommunication.id} className="rounded-xl bg-green-700 px-5 py-4 text-lg font-black text-white disabled:opacity-50">Resend</button>
              <Link to="/admin/outbox" className="rounded-xl bg-amber-600 px-5 py-4 text-center text-lg font-black text-white">Open Outbox</Link>
            </div>
          </div>
        </div>
      ) : null}

      {communicationModal ? (
        <div className="admin-booking-no-print fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">Preview Message</h2>
                <p className="mt-1 text-sm text-slate-600">{communicationModal.preview.messageType.replace(/_/g, ' ')}</p>
              </div>
              <button type="button" onClick={() => setCommunicationModal(null)} className="rounded-lg bg-slate-100 px-3 py-2 font-bold text-slate-800">
                Cancel
              </button>
            </div>

            {communicationModal.confirmDuplicate || communicationModal.duplicates?.email || communicationModal.duplicates?.sms ? (
              <div className="mt-4 rounded-lg bg-amber-100 px-4 py-3 text-sm font-semibold text-amber-900">
                This message type was already sent for at least one selected channel. Sending again requires confirmation.
              </div>
            ) : null}

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <section className="rounded-xl border border-slate-200 p-4">
                <h3 className="font-black">Email</h3>
                <div className="mt-2 text-sm text-slate-600">To: {communicationModal.preview.recipients.email || 'Missing email'}</div>
                <div className="mt-3 text-sm font-bold text-slate-700">Subject</div>
                <div className="rounded-lg bg-slate-100 p-3 text-sm">{communicationModal.preview.subject}</div>
                <div className="mt-3 text-sm font-bold text-slate-700">Body</div>
                <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-3 text-sm text-slate-800">
                  {communicationModal.preview.emailBody}
                </pre>
              </section>

              <section className="rounded-xl border border-slate-200 p-4">
                <h3 className="font-black">SMS</h3>
                <div className="mt-2 text-sm text-slate-600">
                  To: {communicationModal.preview.recipients.phone || communicationModal.preview.recipients.rawPhone || 'Missing phone'}
                </div>
                {!communicationModal.smsAvailable ? (
                  <div className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">
                    SMS is not configured. SMS send buttons are disabled.
                  </div>
                ) : null}
                <div className="mt-3 text-sm font-bold text-slate-700">Body</div>
                <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-3 text-sm text-slate-800">
                  {communicationModal.preview.smsBody}
                </pre>
              </section>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setCommunicationModal(null)} className="rounded-lg border border-slate-300 px-5 py-3 font-bold text-slate-800 hover:bg-slate-50">
                Cancel
              </button>
              <button
                type="button"
                disabled={!communicationModal.preview.recipients.email || communicationLoading != null}
                onClick={() => void sendCommunication(['email'], communicationModal.confirmDuplicate)}
                className="rounded-lg bg-slate-900 px-5 py-3 font-bold text-white disabled:opacity-50"
              >
                Send Email
              </button>
              <button
                type="button"
                disabled={!communicationModal.smsAvailable || !communicationModal.preview.recipients.phone || communicationLoading != null}
                onClick={() => void sendCommunication(['sms'], communicationModal.confirmDuplicate)}
                className="rounded-lg bg-cyan-700 px-5 py-3 font-bold text-white disabled:opacity-50"
              >
                Send SMS
              </button>
              <button
                type="button"
                disabled={
                  !communicationModal.preview.recipients.email ||
                  !communicationModal.smsAvailable ||
                  !communicationModal.preview.recipients.phone ||
                  communicationLoading != null
                }
                onClick={() => void sendCommunication(['email', 'sms'], communicationModal.confirmDuplicate)}
                className="rounded-lg bg-green-700 px-5 py-3 font-bold text-white disabled:opacity-50"
              >
                Send Both
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {evidenceModalOpen ? (
        <div className="admin-booking-no-print fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">Evidence Summary</h2>
                <p className="mt-1 text-sm text-slate-600">Copy this into Stripe Dashboard dispute evidence or your response workflow.</p>
              </div>
              <button type="button" onClick={() => setEvidenceModalOpen(false)} className="rounded-lg bg-slate-100 px-3 py-2 font-bold text-slate-800">
                Close
              </button>
            </div>
            <textarea
              readOnly
              value={evidenceSummary}
              className="mt-5 min-h-[420px] w-full rounded-xl border border-slate-300 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => void copyEvidence()} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-3 font-bold text-white">
                <Copy className="h-4 w-4" />
                Copy to Clipboard
              </button>
              <button type="button" onClick={() => setEvidenceModalOpen(false)} className="rounded-lg border border-slate-300 px-4 py-3 font-bold text-slate-800">
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
