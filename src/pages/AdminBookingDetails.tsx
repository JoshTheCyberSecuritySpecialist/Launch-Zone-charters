import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, Printer, Save } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import Logo from '../components/ui/Logo';
import { env } from '../config/env.js';

type BoatRow = { id: string; name: string; type?: string | null };
type TimelineEvent = { id: string; event_type: string; message: string | null; created_at: string };
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

const statusOptions = ['hold', 'pending', 'pending_verification', 'confirmed', 'ready_for_departure', 'completed', 'cancelled'];
const sourceOptions = ['website', 'admin', 'phone', 'groupon', 'boatsetter', 'airbnb', 'walk-in', 'repeat customer'];
const paymentMethods = ['', 'stripe', 'cash', 'venmo', 'zelle', 'paypal', 'groupon', 'comp', 'other'];
const paymentStatuses = ['pending', 'deposit_paid', 'paid'];
const communicationButtons = [
  ['booking_confirmation', 'Send Confirmation'],
  ['missing_waiver', 'Send Waiver Reminder'],
  ['missing_insurance', 'Send Insurance Reminder'],
  ['missing_documents', 'Send Document Reminder'],
  ['day_before_reminder', 'Send Day-Before Reminder'],
  ['cancelled_booking', 'Send Cancellation Notice'],
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

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const money = (v: unknown) => (Number(v || 0)).toFixed(2);

function docBadge(done: boolean) {
  return done ? 'bg-green-100 text-green-800 border-green-200' : 'bg-red-100 text-red-800 border-red-200';
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

export default function AdminBookingDetails() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { isAdmin, loading: authLoading } = useAuth();
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [boats, setBoats] = useState<BoatRow[]>([]);
  const [form, setForm] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
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

  const booking = detail?.booking;

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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
      });
    },
    [getAdminToken]
  );

  const load = useCallback(async () => {
    if (!isAdmin || !id) return;
    setLoading(true);
    try {
      const [bookingRes, boatsRes, emailConfigRes] = await Promise.all([
        authedFetch(`/api/admin/bookings/${id}`),
        fetch(`${env.apiUrl}/api/boats`),
        authedFetch('/api/admin/email/config-check'),
      ]);
      const bookingPayload = (await bookingRes.json().catch(() => ({}))) as DetailPayload & { error?: string };
      if (!bookingRes.ok) throw new Error(bookingPayload.error || 'Could not load booking.');
      const boatsPayload = (await boatsRes.json().catch(() => ({}))) as { boats?: BoatRow[] };
      const emailConfigPayload = (await emailConfigRes.json().catch(() => ({}))) as EmailConfig;
      setDetail(bookingPayload);
      setBoats(Array.isArray(boatsPayload.boats) ? boatsPayload.boats : []);
      if (emailConfigRes.ok) setEmailConfig(emailConfigPayload);
      const b = bookingPayload.booking;
      const start = new Date(String(b.start_time || ''));
      const end = new Date(String(b.end_time || ''));
      const duration = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
        ? Math.max(0, Math.round(((end.getTime() - start.getTime()) / 36e5) * 100) / 100)
        : Number(b.duration_hours || 0);
      setForm({
        customerName: b.customers?.full_name || b.name || '',
        phone: b.customers?.phone || b.phone || '',
        email: b.customers?.email || b.email || '',
        customerNotes: b.admin_notes || '',
        boatId: b.boat_id || '',
        location: b.rental_location || '',
        bookingType: b.booking_type === 'charter' ? 'captain_charter' : 'rental',
        date: Number.isFinite(start.getTime()) ? ymd(start) : '',
        startTime: Number.isFinite(start.getTime()) ? hhmm(start) : '',
        endTime: Number.isFinite(end.getTime()) ? hhmm(end) : '',
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

  useEffect(() => {
    void load();
  }, [load]);

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
    const start = new Date(`${form.date}T${form.startTime}`);
    const end = new Date(`${form.date}T${form.endTime}`);
    return (
      form.boatId !== booking.boat_id ||
      (Number.isFinite(start.getTime()) && start.toISOString() !== booking.start_time) ||
      (Number.isFinite(end.getTime()) && end.toISOString() !== booking.end_time)
    );
  }, [booking, form.boatId, form.date, form.endTime, form.startTime]);

  useEffect(() => {
    if (!scheduleChanged || !form.boatId || !form.date || !form.startTime || !form.endTime) {
      setAvailability('idle');
      return;
    }
    const timer = window.setTimeout(async () => {
      setAvailability('checking');
      try {
        const res = await authedFetch('/api/admin/staff-bookings/check', {
          method: 'POST',
          body: JSON.stringify({
            boat_id: form.boatId,
            start_time: new Date(`${form.date}T${form.startTime}`).toISOString(),
            end_time: new Date(`${form.date}T${form.endTime}`).toISOString(),
            rental_location: form.location,
            excludeBookingId: id,
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as { available?: boolean };
        setAvailability(res.ok && payload.available ? 'available' : 'conflict');
      } catch {
        setAvailability('error');
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [authedFetch, form.boatId, form.date, form.endTime, form.location, form.startTime, scheduleChanged]);

  const setField = (key: string, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'duration' && prev.date && prev.startTime && Number(value) > 0) {
        const start = new Date(`${prev.date}T${prev.startTime}`);
        const end = new Date(start.getTime() + Number(value) * 60 * 60 * 1000);
        next.endTime = hhmm(end);
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
    if (availability === 'conflict') {
      setNotice({ variant: 'error', text: 'Conflict detected. Choose another boat or time before saving.' });
      return;
    }
    setSaving(true);
    try {
      const res = await authedFetch(`/api/admin/bookings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          customer: { full_name: form.customerName, phone: form.phone, email: form.email },
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
            staff_notes: form.internalNotes,
            internal_notes: form.customerNotes,
            status: form.status,
          },
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as DetailPayload & { error?: string };
      if (!res.ok) throw new Error(payload.error || 'Could not save booking.');
      setDetail(payload);
      setDirty(false);
      setNotice({ variant: 'success', text: 'Booking saved.' });
      await load();
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not save booking.' });
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (action: string) => {
    try {
      const res = await authedFetch(`/api/admin/bookings/${id}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error || 'Action failed.');
      setNotice({ variant: 'success', text: 'Action completed.' });
      await load();
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Action failed.' });
    }
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

  if (authLoading || loading) return <FullPageLoader message="Loading booking details..." />;
  if (!isAdmin) return <FullPageLoader message="Admin access required." />;
  if (!booking) return <div className="p-8">Booking not found.</div>;

  const waiverDone = Boolean(booking.waiver_signed || (Array.isArray(booking.waivers) && booking.waivers.length > 0));
  const insuranceDone = ['submitted', 'verified'].includes(String(booking.insurance_status || ''));
  const licenseDone = ['verified'].includes(String(booking.license_status || '')) || Boolean(booking.license_url);
  const checklistDone = ['ready_for_departure', 'completed'].includes(String(booking.status || ''));
  const bookingLink = `${window.location.origin}/waivers-insurance?bookingId=${booking.id}`;

  const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900';
  const labelClass = 'block text-sm font-bold text-slate-700';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="border-b bg-slate-900 py-6 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Logo variant="admin" />
            <div>
              <h1 className="text-3xl font-bold">Booking Details</h1>
              <p className="text-sm text-slate-400">{booking.id}</p>
            </div>
          </div>
          <Link to="/admin/calendar" className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-3 font-semibold hover:bg-slate-700">
            <ArrowLeft className="h-4 w-4" />
            Calendar
          </Link>
        </div>
      </div>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="space-y-6">
          {notice ? (
            <div className={`rounded-lg px-4 py-3 font-semibold ${notice.variant === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {notice.text}
            </div>
          ) : null}

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
                <label className={labelClass}>Date<input className={inputClass} type="date" value={form.date || ''} onChange={(e) => setField('date', e.target.value)} /></label>
                <label className={labelClass}>Start Time<input className={inputClass} type="time" value={form.startTime || ''} onChange={(e) => setField('startTime', e.target.value)} /></label>
                <label className={labelClass}>End Time<input className={inputClass} type="time" value={form.endTime || ''} onChange={(e) => setField('endTime', e.target.value)} /></label>
                <label className={labelClass}>Duration<input className={inputClass} type="number" step="0.5" value={form.duration || ''} onChange={(e) => setField('duration', e.target.value)} /></label>
                <label className={labelClass}>Passengers<input className={inputClass} type="number" min="1" value={form.passengers || ''} onChange={(e) => setField('passengers', e.target.value)} /></label>
                <label className={`${labelClass} sm:col-span-2`}>Booking Source<select className={inputClass} value={form.source || ''} onChange={(e) => setField('source', e.target.value)}>{sourceOptions.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              </div>
              <div className="mt-4 text-sm font-bold">
                {!form.boatId ? <span className="text-slate-600">Select a boat first.</span> : null}
                {availability === 'available' ? <span className="text-green-700">Available</span> : null}
                {availability === 'conflict' ? <span className="text-red-700">Conflict Detected</span> : null}
                {availability === 'checking' ? <span className="text-slate-600">Checking availability...</span> : null}
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
                        {status.replace(/_/g, ' ')}
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
              <label className={labelClass}>Payment Status<select className={inputClass} value={form.paymentStatus || 'pending'} onChange={(e) => setField('paymentStatus', e.target.value)}>{paymentStatuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></label>
              <label className={`${labelClass} sm:col-span-2 lg:col-span-4`}>Discount Reason<input className={inputClass} value={form.discountReason || ''} onChange={(e) => setField('discountReason', e.target.value)} /></label>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow">
            <h2 className="text-xl font-black">Internal Notes</h2>
            <textarea className={`${inputClass} mt-4 min-h-[160px]`} value={form.internalNotes || ''} onChange={(e) => setField('internalNotes', e.target.value)} />
          </div>

          <div className="rounded-2xl bg-white p-5 shadow">
            <h2 className="text-xl font-black">Timeline</h2>
            <div className="mt-4 space-y-3">
              {detail.timeline.map((event) => (
                <div key={event.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="font-bold">{formatEventName(event.event_type)}</div>
                  <div className="text-sm text-slate-600">{event.message || '-'}</div>
                  <div className="text-xs text-slate-400">{new Date(event.created_at).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="space-y-5">
          <div className="rounded-2xl bg-white p-5 shadow">
            <h2 className="text-xl font-black">Payment</h2>
            <p className="mt-3 text-3xl font-black">${money(form.finalPrice)}</p>
            <p className="text-sm capitalize text-slate-600">{String(form.paymentStatus || 'pending').replace(/_/g, ' ')}</p>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow">
            <h2 className="text-xl font-black">Documents</h2>
            <div className="mt-4 space-y-2">
              {[
                ['Waiver', waiverDone, null],
                ['Insurance', insuranceDone, booking.insurance_url],
                ['License', licenseDone, booking.license_url],
                ['Trip Checklist', checklistDone, null],
              ].map(([label, done, href]) => (
                <div key={String(label)} className={`rounded-lg border px-3 py-2 font-bold ${docBadge(Boolean(done))}`}>
                  {String(label)}: {done ? 'Complete' : 'Missing'}
                  {href ? <a href={String(href)} target="_blank" rel="noreferrer" className="ml-2 underline">Open</a> : null}
                </div>
              ))}
            </div>
          </div>

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

          <div className="rounded-2xl bg-white p-5 shadow">
            <h2 className="text-xl font-black">Actions</h2>
            <div className="mt-4 grid gap-2">
              <button type="button" onClick={() => void save()} disabled={saving || availability === 'conflict'} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3 font-bold text-white disabled:opacity-50"><Save className="h-4 w-4" />Save Changes</button>
              {booking.status === 'hold' ? <button type="button" onClick={() => void runAction('confirm_hold')} className="rounded-lg bg-green-700 px-4 py-3 font-bold text-white">Convert Hold to Confirmed</button> : null}
              <button type="button" onClick={() => void runAction('cancel')} className="rounded-lg bg-red-700 px-4 py-3 font-bold text-white">Cancel Booking</button>
              <button type="button" onClick={() => void runAction('ready')} className="rounded-lg bg-cyan-700 px-4 py-3 font-bold text-white">Mark Ready for Departure</button>
              <button type="button" onClick={() => void runAction('complete')} className="rounded-lg bg-slate-700 px-4 py-3 font-bold text-white">Mark Completed</button>
              <button type="button" onClick={() => navigate(`/admin/staff-booking?boatId=${booking.boat_id || ''}&date=${form.date || ''}&startTime=${form.startTime || ''}&durationHours=${form.duration || '4'}&location=${encodeURIComponent(form.location || '')}`)} className="rounded-lg bg-purple-700 px-4 py-3 font-bold text-white">Duplicate Booking</button>
              <button type="button" onClick={() => void runAction('send_confirmation')} className="rounded-lg bg-amber-600 px-4 py-3 font-bold text-white">Send Confirmation</button>
              <button type="button" onClick={() => void navigator.clipboard.writeText(bookingLink)} className="inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-3 font-bold"><Copy className="h-4 w-4" />Copy Booking Link</button>
              <button type="button" onClick={() => window.print()} className="inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-3 font-bold"><Printer className="h-4 w-4" />Print Booking</button>
            </div>
          </div>
        </aside>
      </main>

      {customEmailPreview ? (
        <div className="fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/70 p-4">
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
        <div className="fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/70 p-4">
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
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4">
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
    </div>
  );
}
