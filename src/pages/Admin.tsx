import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar,
  Users,
  DollarSign,
  Settings,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  ExternalLink,
  Mail,
  Plus,
  Pencil,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { UserVerificationsRow } from '../lib/supabase';
import { logSupabaseError } from '../lib/supabaseErrors';
import { adminUpdatePreTripSubmission, fetchPreTripMatchSuggestions, type PreTripMatchSuggestion } from '../lib/publicBooking';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminResponsiveList from '../components/admin/AdminResponsiveList';
import MobileAdminCard from '../components/admin/MobileAdminCard';
import AdminActions from '../components/admin/AdminActions';
import StatusBadge from '../components/admin/StatusBadge';
import { humanizeLabel, shortId } from '../components/admin/adminDisplay';
import { env } from '../config/env.js';
import { uploadCaptainsLogHeroImage } from '../lib/storageUpload';
import {
  CAPTAINS_LOG_CATEGORIES,
  captainsLogArticlePath,
  slugifyCaptainsLogTitle,
  type CaptainsLogCategory,
} from '../lib/captainsLog';
import {
  clearIncidentsByBookingIdCache,
  getAdminAlerts,
  getAdminSubscribers,
  getIncidentsByBookingId,
} from '../lib/adminApi';
import { adminDebugLog, describeError, fetchJsonWithTimeout, withTimeout } from '../lib/adminDiagnostics';

interface AdminProps {
  onNavigate: (page: string) => void;
}

const PAGE_SIZE = 10;

const LS_CAP_RUN_STATUS = 'lz_admin_captains_log_last_status';
const LS_CAP_RUN_TIME = 'lz_admin_captains_log_last_at';

let adminAlertsInitialFetchDoneDev = false;
let adminSubscribersInitialFetchDoneDev = false;

type StatusFilter = 'all' | 'pending' | 'pending_verification' | 'confirmed' | 'ready_for_departure' | 'cancelled';

type CaptainsLogRow = {
  id: string;
  title: string;
  slug: string;
  category: string;
  created_at: string;
};

type ContactInboxRow = {
  id: string;
  full_name: string;
  email: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

type ContactReplyPreview = {
  from: string;
  to: string;
  subject: string;
  message: string;
  originalMessage: string;
  customerName: string;
};

type AdminAlertRow = {
  id: string;
  type: string | null;
  message: string | null;
  score: number | null;
  created_at: string;
};

type AdminSubscriberRow = {
  email: string;
  phone: string | null;
  created_at: string;
};

type PaymentRecoveryRow = {
  id: string;
  payment_intent_id: string | null;
  checkout_session_id: string | null;
  booking_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  boat_id: string | null;
  trip_type: string | null;
  start_time: string | null;
  end_time: string | null;
  amount: number | string | null;
  currency: string;
  status: string;
  reason: string;
  error: string | null;
  retry_count: number;
  next_retry_at: string | null;
  created_at: string;
  boats?: { id?: string; name?: string } | null;
  bookings?: { id?: string; status?: string; payment_status?: string } | null;
};

type PaymentRecoveryLogs = {
  webhooks?: Array<{
    event_id: string;
    event_type: string;
    processing_status: string;
    error: string | null;
    received_at: string;
    processed_at: string | null;
  }>;
  activity?: Array<{
    id: string;
    event_type: string;
    message: string | null;
    created_at: string;
  }>;
  errors?: string[];
};

type BookingHealthPayload = {
  ok: boolean;
  checkedAt: string;
  checks: Record<string, { ok: boolean; error?: string | null; [key: string]: unknown }>;
};

type PromoAppliesTo = 'all' | 'rentals' | 'charters' | 'groupon' | 'private';
type PromoDiscountType = 'percent' | 'fixed';

type PromoCodeRow = {
  id: string;
  code: string;
  description: string | null;
  discount_type: PromoDiscountType;
  discount_value: number;
  max_uses: number | null;
  used_count: number;
  active: boolean;
  applies_to: PromoAppliesTo;
  starts_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type PromoFormState = {
  code: string;
  description: string;
  discount_type: PromoDiscountType;
  discount_value: string;
  max_uses: string;
  active: boolean;
  applies_to: PromoAppliesTo;
  starts_at: string;
  expires_at: string;
};

const PROMO_APPLIES_OPTIONS: { value: PromoAppliesTo; label: string }[] = [
  { value: 'all', label: 'All bookings' },
  { value: 'rentals', label: 'Rentals' },
  { value: 'charters', label: 'Charters' },
  { value: 'groupon', label: 'Groupon' },
  { value: 'private', label: 'Private charters' },
];

const blankPromoForm = (): PromoFormState => ({
  code: '',
  description: '',
  discount_type: 'percent',
  discount_value: '',
  max_uses: '',
  active: true,
  applies_to: 'all',
  starts_at: '',
  expires_at: '',
});

type IncidentPhotoRow = {
  id?: string;
  incident_id?: string;
  file_path: string;
  file_name?: string | null;
  content_type?: string | null;
};

type IncidentRow = {
  id: string;
  booking_id: string;
  description: string;
  status: 'pending' | 'approved' | 'charged' | 'disputed' | string;
  estimated_cost?: number | null;
  actual_cost?: number | null;
  admin_notes?: string | null;
  created_at: string;
  photos?: IncidentPhotoRow[];
};

function previewMessageBody(text: string, maxLen = 120): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}

/** Joined list row from `select('*, customers(*), boats(*)')`, asserted until DB types are codegen'd */
type DocStatus = 'pending' | 'submitted' | 'verified' | 'rejected';

/** Buoy proof workflow — does not use `submitted`. */
type BuoyDocStatus = 'pending' | 'verified' | 'rejected';

type AdminBookingRow = {
  id: string;
  status: string;
  total_price: string | number;
  start_time: string;
  /** Per-booking Storage URLs when present (fallback: customers.id_document_url / insurance_proof_url). */
  license_url?: string | null;
  insurance_url?: string | null;
  waiver_signed?: boolean | null;
  stripe_payment_id?: string | null;
  payment_status?: string | null;
  /** Present when `select` embeds waivers; used if `waiver_signed` column is missing on `bookings`. */
  waivers?: { id: string }[] | null;
  license_status?: DocStatus | string | null;
  insurance_status?: DocStatus | string | null;
  promo_code?: string | null;
  discount_amount?: number | string | null;
  original_total?: number | string | null;
  final_total?: number | string | null;
  customers?: {
    full_name?: string;
    email?: string;
    id_document_url?: string | null;
    insurance_proof_url?: string | null;
  } | null;
  boats?: { name?: string } | null;
  user_verifications?: UserVerificationsRow | UserVerificationsRow[] | null;
};

type PreTripSubmissionRow = {
  id: string;
  matched_booking_id: string | null;
  customer_name: string | null;
  email: string;
  phone: string | null;
  trip_type: string;
  selected_boat_reg_no: string | null;
  groupon_code: string | null;
  requested_trip_date: string | null;
  waiver_signed: boolean;
  license_url: string | null;
  insurance_url: string | null;
  license_status: string;
  insurance_status: string;
  admin_status: string;
  admin_notes: string | null;
  created_at: string;
};

function tripTypeLabel(tripType: string): string {
  switch (tripType) {
    case 'pontoon_rental':
      return 'Pontoon Rental';
    case 'center_console_rental':
      return 'Center Console Rental';
    case 'captain_charter':
      return 'Captain-Led Charter';
    default:
      return tripType;
  }
}

function buoyVerificationRow(
  raw: UserVerificationsRow | UserVerificationsRow[] | null | undefined
): UserVerificationsRow | null {
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] ?? null : raw;
}

/** Operator-facing line under insurance controls */
function insuranceStatusCaption(status: string | null | undefined, hasProof: boolean): string {
  const s = String(status || 'pending');
  if (s === 'verified') return 'Booking confirmed';
  if (s === 'rejected') return 'Please re-upload valid insurance';
  if (s === 'submitted') return 'Proof received — review to verify';
  if (hasProof) return 'Under review';
  return 'Insurance required';
}

function insuranceComplianceEmojiLabel(status: string | null | undefined): { emoji: string; text: string } {
  const s = String(status || 'pending');
  if (s === 'verified') return { emoji: '🟢', text: 'Verified' };
  if (s === 'rejected') return { emoji: '🔴', text: 'Rejected' };
  if (s === 'submitted') return { emoji: '🟠', text: 'Submitted' };
  return { emoji: '🟡', text: 'Pending' };
}

export default function Admin({ onNavigate }: AdminProps) {
  const { user, isAdmin, loading: authLoading, authError, retryAuth } = useAuth();

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[Admin] gate', {
        user: user ? { id: user.id, email: user.email } : null,
        isAdmin,
        loading: authLoading,
      });
    }
  }, [user, isAdmin, authLoading]);
  const [bookings, setBookings] = useState<AdminBookingRow[]>([]);
  const [stats, setStats] = useState({
    totalBookings: 0,
    pendingBookings: 0,
    revenue: 0,
    customers: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [emailSearch, setEmailSearch] = useState('');
  const [debouncedEmailSearch, setDebouncedEmailSearch] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const initialBookingsLoadRef = useRef(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [notice, setNotice] = useState<{ variant: 'success' | 'error' | 'info'; text: string } | null>(
    null
  );
  const [lastRunStatus, setLastRunStatus] = useState<string>('N/A');
  const [lastRunTime, setLastRunTime] = useState<string>('');
  const [captainsLogArticles, setCaptainsLogArticles] = useState<CaptainsLogRow[]>([]);
  const [captainsLogFormOpen, setCaptainsLogFormOpen] = useState(false);
  const [newArticleTitle, setNewArticleTitle] = useState('');
  const [newArticleSlug, setNewArticleSlug] = useState('');
  const [newArticleCategory, setNewArticleCategory] = useState<CaptainsLogCategory>('Local Highlights');
  const [newArticleContent, setNewArticleContent] = useState('');
  const [newArticleImageUrl, setNewArticleImageUrl] = useState('');
  const [newArticleImageAlt, setNewArticleImageAlt] = useState('');
  const [newArticleSummary, setNewArticleSummary] = useState('');
  const [captainsLogHeroFile, setCaptainsLogHeroFile] = useState<File | null>(null);
  const captainsLogHeroInputRef = useRef<HTMLInputElement>(null);
  const [captainsLogSaving, setCaptainsLogSaving] = useState(false);
  const [captainsLogFormError, setCaptainsLogFormError] = useState<string | null>(null);
  const [captainsLogEditingId, setCaptainsLogEditingId] = useState<string | null>(null);
  const [captainsLogEditLoadingId, setCaptainsLogEditLoadingId] = useState<string | null>(null);
  const [captainsLogDeletingId, setCaptainsLogDeletingId] = useState<string | null>(null);
  const [contactInbox, setContactInbox] = useState<ContactInboxRow[]>([]);
  const [contactInboxLoading, setContactInboxLoading] = useState(false);
  const [contactReplyRow, setContactReplyRow] = useState<ContactInboxRow | null>(null);
  const [contactReplyDraft, setContactReplyDraft] = useState({ to: '', subject: '', message: '' });
  const [contactReplyPreview, setContactReplyPreview] = useState<ContactReplyPreview | null>(null);
  const [contactReplyBusy, setContactReplyBusy] = useState<'preview' | 'send' | null>(null);
  const [alerts, setAlerts] = useState<AdminAlertRow[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [subscribers, setSubscribers] = useState<AdminSubscriberRow[]>([]);
  const [subscribersLoading, setSubscribersLoading] = useState(false);
  const [subscribersError, setSubscribersError] = useState<string | null>(null);
  const [paymentRecoveryItems, setPaymentRecoveryItems] = useState<PaymentRecoveryRow[]>([]);
  const [paymentRecoveryLoading, setPaymentRecoveryLoading] = useState(false);
  const [paymentRecoveryError, setPaymentRecoveryError] = useState<string | null>(null);
  const [paymentRecoveryBusyId, setPaymentRecoveryBusyId] = useState<string | null>(null);
  const [paymentRecoveryLogs, setPaymentRecoveryLogs] = useState<Record<string, PaymentRecoveryLogs>>({});
  const [bookingHealth, setBookingHealth] = useState<BookingHealthPayload | null>(null);
  const [bookingHealthLoading, setBookingHealthLoading] = useState(false);
  const [promoCodes, setPromoCodes] = useState<PromoCodeRow[]>([]);
  const [promoCodesLoading, setPromoCodesLoading] = useState(false);
  const [promoCodesError, setPromoCodesError] = useState<string | null>(null);
  const [promoForm, setPromoForm] = useState<PromoFormState>(() => blankPromoForm());
  const [promoEditingId, setPromoEditingId] = useState<string | null>(null);
  const [promoSaving, setPromoSaving] = useState(false);
  const [promoBusyId, setPromoBusyId] = useState<string | null>(null);
  const [runningAlerts, setRunningAlerts] = useState(false);
  const [incidentCounts, setIncidentCounts] = useState<Record<string, number>>({});
  const [selectedIncidentBookingId, setSelectedIncidentBookingId] = useState<string>('');
  const [preTripSubmissions, setPreTripSubmissions] = useState<PreTripSubmissionRow[]>([]);
  const [preTripSuggestions, setPreTripSuggestions] = useState<Record<string, PreTripMatchSuggestion[]>>({});
  const [preTripSuggestionsLoading, setPreTripSuggestionsLoading] = useState<string | null>(null);
  const [preTripLoading, setPreTripLoading] = useState(false);
  const [preTripMatchIds, setPreTripMatchIds] = useState<Record<string, string>>({});
  const [preTripNotes, setPreTripNotes] = useState<Record<string, string>>({});
  const [preTripActionBusy, setPreTripActionBusy] = useState<string | null>(null);
  const [bookingIncidents, setBookingIncidents] = useState<IncidentRow[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState(false);
  const [incidentDescription, setIncidentDescription] = useState('');
  const [incidentFile, setIncidentFile] = useState<File | null>(null);
  const [incidentSubmitting, setIncidentSubmitting] = useState(false);
  const [editingIncidentId, setEditingIncidentId] = useState<string | null>(null);
  const [incidentImageFailures, setIncidentImageFailures] = useState<Record<string, boolean>>({});
  const [expandedResolvedIncidentId, setExpandedResolvedIncidentId] = useState<string | null>(null);
  const [incidentEditDrafts, setIncidentEditDrafts] = useState<
    Record<string, { status: string; estimated_cost: string; actual_cost: string; admin_notes: string }>
  >({});

  useEffect(() => {
    if (!isAdmin) return;
    setLastRunStatus(localStorage.getItem(LS_CAP_RUN_STATUS) || 'N/A');
    setLastRunTime(localStorage.getItem(LS_CAP_RUN_TIME) || '');
  }, [isAdmin]);

  useEffect(() => {
    if (!notice || notice.variant !== 'success') return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const loadCaptainsLog = useCallback(async () => {
    if (!isAdmin) return;
    const { data, error } = await supabase
      .from('captains_log')
      .select('id, title, slug, category, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    logSupabaseError('Admin.loadCaptainsLog', error);
    if (data) {
      setCaptainsLogArticles(data as CaptainsLogRow[]);
    }
  }, [isAdmin]);

  const reserveCaptainsLogSlug = useCallback(
    async (
      title: string,
      explicitSlug: string,
      options?: { excludeArticleId?: string | null }
    ): Promise<{ slug: string } | { error: string }> => {
      const excludeArticleId = options?.excludeArticleId ?? null;
      const root = explicitSlug.trim()
        ? slugifyCaptainsLogTitle(explicitSlug)
        : slugifyCaptainsLogTitle(title);
      if (!root) {
        return { error: 'Add a title (or a custom URL slug) before saving.' };
      }
      for (let n = 0; n < 80; n++) {
        const candidate = n === 0 ? root : `${root}-${n + 1}`;
        const { data, error } = await supabase
          .from('captains_log')
          .select('id')
          .eq('slug', candidate)
          .maybeSingle();
        if (error) {
          return { error: error.message };
        }
        if (!data) {
          return { slug: candidate };
        }
        if (excludeArticleId && data.id === excludeArticleId) {
          return { slug: candidate };
        }
      }
      return { slug: `${root}-${Date.now()}` };
    },
    []
  );

  const resetCaptainsLogForm = useCallback(() => {
    setCaptainsLogEditingId(null);
    setNewArticleTitle('');
    setNewArticleSlug('');
    setNewArticleCategory('Local Highlights');
    setNewArticleContent('');
    setNewArticleImageUrl('');
    setNewArticleImageAlt('');
    setNewArticleSummary('');
    setCaptainsLogHeroFile(null);
    if (captainsLogHeroInputRef.current) {
      captainsLogHeroInputRef.current.value = '';
    }
    setCaptainsLogFormError(null);
  }, []);

  const handleEditCaptainsLogArticle = async (id: string) => {
    setCaptainsLogFormError(null);
    setCaptainsLogEditLoadingId(id);
    try {
      const { data, error } = await supabase.from('captains_log').select('*').eq('id', id).maybeSingle();
      logSupabaseError('Admin.loadCaptainsLogForEdit', error);
      if (error) {
        setCaptainsLogFormError(error.message || 'Could not load article.');
        return;
      }
      if (!data) {
        setCaptainsLogFormError('Article not found.');
        return;
      }
      setCaptainsLogEditingId(id);
      setNewArticleTitle(data.title ?? '');
      setNewArticleSlug(data.slug ?? '');
      setNewArticleCategory((data.category as CaptainsLogCategory) || 'Local Highlights');
      setNewArticleContent(data.content ?? '');
      setNewArticleImageUrl(data.image_url ?? '');
      setNewArticleImageAlt(data.image_alt ?? '');
      setNewArticleSummary(data.summary ?? '');
      setCaptainsLogHeroFile(null);
      if (captainsLogHeroInputRef.current) {
        captainsLogHeroInputRef.current.value = '';
      }
      setCaptainsLogFormOpen(true);
    } finally {
      setCaptainsLogEditLoadingId(null);
    }
  };

  const handleSaveCaptainsLogArticle = async () => {
    setCaptainsLogFormError(null);
    const title = newArticleTitle.trim();
    const content = newArticleContent.trim();
    if (!title) {
      setCaptainsLogFormError('Title is required.');
      return;
    }
    if (!content) {
      setCaptainsLogFormError('Body content is required (use Markdown).');
      return;
    }
    const slugRes = await reserveCaptainsLogSlug(title, newArticleSlug, {
      excludeArticleId: captainsLogEditingId,
    });
    if ('error' in slugRes) {
      setCaptainsLogFormError(slugRes.error);
      return;
    }
    const slug = slugRes.slug;
    const imageAlt = newArticleImageAlt.trim();
    const summary = newArticleSummary.trim();
    setCaptainsLogSaving(true);
    try {
      let imageUrl = newArticleImageUrl.trim();
      if (captainsLogHeroFile) {
        const { url, error: uploadErr } = await uploadCaptainsLogHeroImage(captainsLogHeroFile);
        if (uploadErr || !url) {
          setCaptainsLogFormError(uploadErr?.message || 'Image upload failed.');
          return;
        }
        imageUrl = url;
        setNewArticleImageUrl(url);
      }

      const payloadBase = {
        title: title.slice(0, 500),
        slug: slug.slice(0, 200),
        content,
        category: newArticleCategory,
        image_url: imageUrl || null,
        image_alt: imageAlt || null,
        summary: summary || null,
      };

      if (captainsLogEditingId) {
        const { data: updatedRow, error } = await supabase
          .from('captains_log')
          .update({
            ...payloadBase,
            ...(captainsLogHeroFile ? { image_source: 'Manual' as const } : {}),
          })
          .eq('id', captainsLogEditingId)
          .select('id, image_url')
          .maybeSingle();
        logSupabaseError('Admin.updateCaptainsLog', error);
        if (error) {
          setCaptainsLogFormError(error.message || 'Could not update article.');
          return;
        }
        if (!updatedRow) {
          setCaptainsLogFormError(
            'Update did not change any row (check that you are signed in as admin and RLS allows updates).'
          );
          return;
        }
        setNotice({ variant: 'success', text: 'Article updated.' });
      } else {
        const { data: insertedRow, error } = await supabase
          .from('captains_log')
          .insert({
            ...payloadBase,
            publish_date: null,
            source: 'Manual',
            source_url: null,
            image_source: 'Manual',
          })
          .select('id, image_url')
          .maybeSingle();
        logSupabaseError('Admin.insertCaptainsLog', error);
        if (error) {
          setCaptainsLogFormError(error.message || 'Could not save article.');
          return;
        }
        if (!insertedRow) {
          setCaptainsLogFormError('Insert did not return a row (check admin permissions).');
          return;
        }
        setNotice({ variant: 'success', text: 'Article published.' });
      }
      resetCaptainsLogForm();
      setCaptainsLogFormOpen(false);
      await loadCaptainsLog();
    } finally {
      setCaptainsLogSaving(false);
    }
  };

  const handleDeleteCaptainsLogArticle = async (id: string, title: string) => {
    if (!window.confirm(`Delete this article?\n\n"${title.slice(0, 120)}${title.length > 120 ? '…' : ''}"\n\nThis cannot be undone.`)) {
      return;
    }
    setCaptainsLogDeletingId(id);
    try {
      const { data: deletedOk, error } = await supabase.rpc('admin_delete_captains_log', {
        article_id: id,
      });
      logSupabaseError('Admin.deleteCaptainsLog', error);
      if (error) {
        window.alert(error.message || 'Could not delete article. Check that you are signed in as an admin.');
        return;
      }
      if (!deletedOk) {
        window.alert('No article matched that id. Try refreshing the list.');
        return;
      }
      setNotice({ variant: 'success', text: 'Article deleted.' });
      await loadCaptainsLog();
    } finally {
      setCaptainsLogDeletingId(null);
    }
  };

  const loadContactInbox = useCallback(async () => {
    if (!isAdmin) return;
    setContactInboxLoading(true);
    try {
      const { data, error } = await supabase
        .from('contact_messages')
        .select('id, full_name, email, message, is_read, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      logSupabaseError('Admin.loadContactInbox', error);
      if (data) {
        setContactInbox(data as ContactInboxRow[]);
      } else {
        setContactInbox([]);
      }
    } finally {
      setContactInboxLoading(false);
    }
  }, [isAdmin]);

  const getAdminToken = useCallback(async (): Promise<string | null> => {
    const {
      data: { session },
    } = await withTimeout('Admin session lookup', supabase.auth.getSession(), 12000);
    return session?.access_token || null;
  }, []);

  const loadAlerts = useCallback(async () => {
    if (!isAdmin) return;
    if (!env.apiUrlConfigured || !env.apiUrl) {
      setAlertsError('API server URL is not configured (set VITE_API_URL).');
      setAlerts([]);
      setAlertsLoading(false);
      return;
    }
    setAlertsLoading(true);
    setAlertsError(null);
    try {
      const token = await getAdminToken();
      if (!token) {
        setAlertsError('Admin session unavailable.');
        setAlerts([]);
        return;
      }

      const payload = (await getAdminAlerts(token)) as AdminAlertRow[] | { error?: string };
      setAlerts(Array.isArray(payload) ? payload : []);
    } catch (err) {
      console.error('[admin-alerts]', err);
      setAlertsError('Could not load alert activity.');
      setAlerts([]);
    } finally {
      setAlertsLoading(false);
    }
  }, [getAdminToken, isAdmin]);

  const loadSubscribers = useCallback(async () => {
    if (!isAdmin) return;
    if (!env.apiUrlConfigured || !env.apiUrl) {
      setSubscribersError('API server URL is not configured (set VITE_API_URL).');
      setSubscribers([]);
      setSubscribersLoading(false);
      return;
    }
    setSubscribersLoading(true);
    setSubscribersError(null);
    try {
      const token = await getAdminToken();
      if (!token) {
        setSubscribersError('Admin session unavailable.');
        setSubscribers([]);
        return;
      }

      const payload = (await getAdminSubscribers(token)) as AdminSubscriberRow[] | { error?: string };
      setSubscribers(Array.isArray(payload) ? payload : []);
    } catch (err) {
      console.error('[admin-subscribers]', err);
      setSubscribersError('Could not load subscribers.');
      setSubscribers([]);
    } finally {
      setSubscribersLoading(false);
    }
  }, [getAdminToken, isAdmin]);

  const handleRunAlerts = useCallback(async () => {
    if (!isAdmin || runningAlerts) return;
    if (!env.apiUrlConfigured || !env.apiUrl) {
      setNotice({ variant: 'error', text: 'API server URL is not configured (set VITE_API_URL).' });
      return;
    }
    setRunningAlerts(true);
    setNotice(null);
    try {
      const token = await getAdminToken();
      if (!token) {
        setNotice({ variant: 'error', text: 'Admin session unavailable.' });
        return;
      }

      const payload = await fetchJsonWithTimeout<{ success?: boolean; error?: string }>('admin-api:run-alerts', `${env.apiUrl}/api/admin/run-alerts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }, 15000);
      if (!payload.success) {
        setNotice({ variant: 'error', text: payload.error || 'Failed to run alerts.' });
        return;
      }

      setNotice({ variant: 'success', text: 'Alerts triggered successfully.' });
      await Promise.all([loadAlerts(), loadSubscribers()]);
    } catch (err) {
      console.error('[admin-run-alerts]', err);
      setNotice({ variant: 'error', text: 'Run alerts failed.' });
    } finally {
      setRunningAlerts(false);
    }
  }, [getAdminToken, isAdmin, runningAlerts, loadAlerts, loadSubscribers]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadCaptainsLog();
  }, [isAdmin, loadCaptainsLog]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadContactInbox();
  }, [isAdmin, loadContactInbox]);

  useEffect(() => {
    if (!isAdmin) {
      adminAlertsInitialFetchDoneDev = false;
      adminSubscribersInitialFetchDoneDev = false;
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    if (import.meta.env.DEV && adminAlertsInitialFetchDoneDev) return;
    adminAlertsInitialFetchDoneDev = true;
    void loadAlerts();
  }, [isAdmin, loadAlerts]);

  useEffect(() => {
    if (!isAdmin) return;
    if (import.meta.env.DEV && adminSubscribersInitialFetchDoneDev) return;
    adminSubscribersInitialFetchDoneDev = true;
    void loadSubscribers();
  }, [isAdmin, loadSubscribers]);

  const apiRequest = useCallback(
    async (path: string, options?: RequestInit) => {
      if (!env.apiUrlConfigured || !env.apiUrl) {
        throw new Error('API server URL is not configured (set VITE_API_URL).');
      }
      const token = await getAdminToken();
      if (!token) throw new Error('Admin session unavailable.');
      const headers: HeadersInit = {
        Authorization: `Bearer ${token}`,
        ...(options?.headers || {}),
      };
      return await fetchJsonWithTimeout<Record<string, unknown>>(
        `admin-api:${path}`,
        `${env.apiUrl}${path}`,
        { ...options, headers },
        15000
      );
    },
    [getAdminToken]
  );

  const loadPaymentRecovery = useCallback(async () => {
    if (!isAdmin) return;
    setPaymentRecoveryLoading(true);
    setPaymentRecoveryError(null);
    try {
      const payload = await apiRequest('/api/admin/payment-recovery');
      setPaymentRecoveryItems(Array.isArray(payload.items) ? (payload.items as PaymentRecoveryRow[]) : []);
    } catch (err) {
      console.error('[payment-recovery]', err);
      setPaymentRecoveryError(err instanceof Error ? err.message : 'Could not load unmatched payments.');
      setPaymentRecoveryItems([]);
    } finally {
      setPaymentRecoveryLoading(false);
    }
  }, [apiRequest, isAdmin]);

  const loadBookingHealth = useCallback(async () => {
    if (!isAdmin) return;
    setBookingHealthLoading(true);
    try {
      const payload = await apiRequest('/api/admin/booking-health');
      setBookingHealth(payload as BookingHealthPayload);
    } catch (err) {
      console.error('[booking-health]', err);
      setBookingHealth({
        ok: false,
        checkedAt: new Date().toISOString(),
        checks: {
          api: { ok: false, error: err instanceof Error ? err.message : 'Could not load health.' },
        },
      });
    } finally {
      setBookingHealthLoading(false);
    }
  }, [apiRequest, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadPaymentRecovery();
    void loadBookingHealth();
  }, [isAdmin, loadPaymentRecovery, loadBookingHealth]);

  const loadPaymentRecoveryLogs = useCallback(
    async (id: string) => {
      setPaymentRecoveryBusyId(id);
      try {
        const payload = await apiRequest(`/api/admin/payment-recovery/${encodeURIComponent(id)}/logs`);
        setPaymentRecoveryLogs((prev) => ({ ...prev, [id]: payload as PaymentRecoveryLogs }));
      } catch (err) {
        console.error('[payment-recovery-logs]', err);
        setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not load recovery logs.' });
      } finally {
        setPaymentRecoveryBusyId(null);
      }
    },
    [apiRequest]
  );

  const loadPromoCodes = useCallback(async () => {
    if (!isAdmin) return;
    setPromoCodesLoading(true);
    setPromoCodesError(null);
    try {
      const payload = await apiRequest('/api/admin/promo-codes');
      const rows = Array.isArray(payload.promoCodes) ? (payload.promoCodes as PromoCodeRow[]) : [];
      setPromoCodes(rows);
    } catch (err) {
      console.error('[admin-promo-codes]', err);
      setPromoCodesError(err instanceof Error ? err.message : 'Could not load promo codes.');
      setPromoCodes([]);
    } finally {
      setPromoCodesLoading(false);
    }
  }, [apiRequest, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadPromoCodes();
  }, [isAdmin, loadPromoCodes]);

  const resetPromoForm = useCallback(() => {
    setPromoEditingId(null);
    setPromoForm(blankPromoForm());
  }, []);

  const isoToDateTimeLocal = (value: string | null) => {
    if (!value) return '';
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const editPromoCode = useCallback((row: PromoCodeRow) => {
    setPromoEditingId(row.id);
    setPromoForm({
      code: row.code,
      description: row.description || '',
      discount_type: row.discount_type,
      discount_value: String(row.discount_value ?? ''),
      max_uses: row.max_uses == null ? '' : String(row.max_uses),
      active: Boolean(row.active),
      applies_to: row.applies_to || 'all',
      starts_at: isoToDateTimeLocal(row.starts_at),
      expires_at: isoToDateTimeLocal(row.expires_at),
    });
  }, []);

  const savePromoCode = useCallback(async () => {
    const code = promoForm.code.trim().toUpperCase();
    const discountValue = Number(promoForm.discount_value);
    if (!code) {
      setNotice({ variant: 'error', text: 'Promo code is required.' });
      return;
    }
    if (!Number.isFinite(discountValue) || discountValue < 0) {
      setNotice({ variant: 'error', text: 'Discount value must be a number.' });
      return;
    }
    setPromoSaving(true);
    try {
      const body = {
        code,
        description: promoForm.description.trim() || null,
        discount_type: promoForm.discount_type,
        discount_value: discountValue,
        max_uses: promoForm.max_uses.trim() ? Number(promoForm.max_uses) : null,
        active: promoForm.active,
        applies_to: promoForm.applies_to,
        starts_at: promoForm.starts_at || null,
        expires_at: promoForm.expires_at || null,
      };
      await apiRequest(
        promoEditingId ? `/api/admin/promo-codes/${encodeURIComponent(promoEditingId)}` : '/api/admin/promo-codes',
        {
          method: promoEditingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      setNotice({ variant: 'success', text: promoEditingId ? 'Promo code updated.' : 'Promo code created.' });
      resetPromoForm();
      await loadPromoCodes();
    } catch (err) {
      console.error('[admin-promo-save]', err);
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not save promo code.' });
    } finally {
      setPromoSaving(false);
    }
  }, [apiRequest, loadPromoCodes, promoEditingId, promoForm, resetPromoForm]);

  const setPromoActive = useCallback(
    async (row: PromoCodeRow, active: boolean) => {
      setPromoBusyId(row.id);
      try {
        await apiRequest(`/api/admin/promo-codes/${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active }),
        });
        setNotice({ variant: 'success', text: active ? 'Promo code activated.' : 'Promo code deactivated.' });
        await loadPromoCodes();
      } catch (err) {
        console.error('[admin-promo-active]', err);
        setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not update promo code.' });
      } finally {
        setPromoBusyId(null);
      }
    },
    [apiRequest, loadPromoCodes]
  );

  const deactivatePromoCode = useCallback(
    async (row: PromoCodeRow) => {
      if (!window.confirm(`Delete promo code ${row.code} if unused? If it has been used, it will be deactivated instead.`)) return;
      setPromoBusyId(row.id);
      try {
        const payload = await apiRequest(`/api/admin/promo-codes/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
        setNotice({
          variant: 'success',
          text: payload.deleted ? 'Promo code deleted.' : 'Promo code deactivated.',
        });
        await loadPromoCodes();
      } catch (err) {
        console.error('[admin-promo-delete]', err);
        setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not delete promo code.' });
      } finally {
        setPromoBusyId(null);
      }
    },
    [apiRequest, loadPromoCodes]
  );

  const fetchIncidentsForBooking = useCallback(
    async (bookingId: string, options?: { force?: boolean }): Promise<IncidentRow[]> => {
      const bid = bookingId.trim();
      if (!bid) return [];
      const token = await getAdminToken();
      if (!token) throw new Error('Admin session unavailable.');
      if (options?.force) clearIncidentsByBookingIdCache(bid);
      const payload = (await getIncidentsByBookingId(bid, token, {
        skipCache: options?.force,
      })) as { incidents?: IncidentRow[] };
      return Array.isArray(payload.incidents) ? payload.incidents : [];
    },
    [getAdminToken]
  );

  const loadIncidentsForBooking = useCallback(
    async (bookingId: string, options?: { force?: boolean }) => {
      const bid = bookingId.trim();
      if (!bid) {
        setBookingIncidents([]);
        return;
      }
      setIncidentsLoading(true);
      try {
        const list = await fetchIncidentsForBooking(bid, options);
        setBookingIncidents(list);
        setIncidentEditDrafts((prev) => {
          const next = { ...prev };
          list.forEach((item) => {
            if (!next[item.id]) {
              next[item.id] = {
                status: String(item.status || 'pending'),
                estimated_cost:
                  item.estimated_cost == null || Number.isNaN(Number(item.estimated_cost))
                    ? ''
                    : String(item.estimated_cost),
                actual_cost:
                  item.actual_cost == null || Number.isNaN(Number(item.actual_cost)) ? '' : String(item.actual_cost),
                admin_notes: String(item.admin_notes || ''),
              };
            }
          });
          return next;
        });
      } catch (err) {
        console.error('[admin-incidents-load]', err);
        setBookingIncidents([]);
      } finally {
        setIncidentsLoading(false);
      }
    },
    [fetchIncidentsForBooking]
  );

  useEffect(() => {
    const firstId = bookings[0]?.id || '';
    if (!selectedIncidentBookingId && firstId) {
      setSelectedIncidentBookingId(firstId);
      return;
    }
    if (selectedIncidentBookingId && !bookings.some((b) => b.id === selectedIncidentBookingId)) {
      setSelectedIncidentBookingId(firstId || '');
    }
  }, [bookings, selectedIncidentBookingId]);

  useEffect(() => {
    if (!selectedIncidentBookingId) return;
    void loadIncidentsForBooking(selectedIncidentBookingId);
  }, [selectedIncidentBookingId, loadIncidentsForBooking]);

  useEffect(() => {
    if (bookings.length === 0) {
      setIncidentCounts({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const nextCounts: Record<string, number> = {};
      for (const booking of bookings) {
        try {
          const list = await fetchIncidentsForBooking(booking.id);
          nextCounts[booking.id] = list.length;
        } catch {
          nextCounts[booking.id] = 0;
        }
      }
      if (!cancelled) {
        setIncidentCounts(nextCounts);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookings, fetchIncidentsForBooking]);

  const handleCreateIncident = async () => {
    const bookingId = selectedIncidentBookingId.trim();
    const description = incidentDescription.trim();
    if (!bookingId || !description) return;
    setIncidentSubmitting(true);
    try {
      const createPayload = await apiRequest('/api/incidents/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: bookingId,
          description,
          reported_by: 'admin',
        }),
      });
      const created = (createPayload.incident as IncidentRow | undefined) ?? null;
      if (!created?.id) {
        throw new Error('Could not create incident.');
      }

      if (incidentFile) {
        const safeName = incidentFile.name.replace(/[^\w.-]+/g, '-');
        const filePath = `incidents/${created.id}/${Date.now()}-${safeName}`;
        const { error: uploadErr } = await supabase.storage.from('incident-photos').upload(filePath, incidentFile, {
          upsert: false,
          contentType: incidentFile.type || 'application/octet-stream',
        });
        if (uploadErr) throw uploadErr;

        await apiRequest(`/api/incidents/${encodeURIComponent(created.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            photos: [
              {
                file_path: filePath,
                file_name: incidentFile.name,
                content_type: incidentFile.type || 'application/octet-stream',
                uploaded_by: 'admin',
              },
            ],
          }),
        });
      }

      setIncidentDescription('');
      setIncidentFile(null);
      setIncidentCounts((prev) => ({ ...prev, [bookingId]: (prev[bookingId] || 0) + 1 }));
      clearIncidentsByBookingIdCache(bookingId);
      await loadIncidentsForBooking(bookingId, { force: true });
    } catch (err) {
      console.error('[admin-incidents-create]', err);
      window.alert(err instanceof Error ? err.message : 'Could not create incident.');
    } finally {
      setIncidentSubmitting(false);
    }
  };

  const handleIncidentDraftChange = (
    incidentId: string,
    field: 'status' | 'estimated_cost' | 'actual_cost' | 'admin_notes',
    value: string
  ) => {
    setIncidentEditDrafts((prev) => ({
      ...prev,
      [incidentId]: {
        status: prev[incidentId]?.status || 'pending',
        estimated_cost: prev[incidentId]?.estimated_cost || '',
        actual_cost: prev[incidentId]?.actual_cost || '',
        admin_notes: prev[incidentId]?.admin_notes || '',
        [field]: value,
      },
    }));
  };

  const handleSaveIncident = async (incidentId: string) => {
    const draft = incidentEditDrafts[incidentId];
    if (!draft) return;
    setEditingIncidentId(incidentId);
    try {
      await apiRequest(`/api/incidents/${encodeURIComponent(incidentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: draft.status,
          estimated_cost: draft.estimated_cost.trim() === '' ? null : Number(draft.estimated_cost),
          actual_cost: draft.actual_cost.trim() === '' ? null : Number(draft.actual_cost),
          admin_notes: draft.admin_notes.trim() === '' ? null : draft.admin_notes,
        }),
      });
      clearIncidentsByBookingIdCache(selectedIncidentBookingId);
      await loadIncidentsForBooking(selectedIncidentBookingId, { force: true });
      setNotice({ variant: 'success', text: 'Incident updated successfully.' });
    } catch (err) {
      console.error('[admin-incidents-save]', err);
      window.alert(err instanceof Error ? err.message : 'Could not update incident.');
    } finally {
      setEditingIncidentId(null);
    }
  };

  const incidentStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'approved':
        return 'border border-blue-200 bg-blue-100 text-blue-800';
      case 'charged':
        return 'border border-green-200 bg-green-100 text-green-800';
      case 'disputed':
        return 'border border-red-200 bg-red-100 text-red-800';
      default:
        return 'border border-yellow-300 bg-yellow-100 text-yellow-900';
    }
  };

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedEmailSearch(emailSearch.trim()), 400);
    return () => window.clearTimeout(t);
  }, [emailSearch]);

  useEffect(() => {
    setPage(0);
  }, [statusFilter, debouncedEmailSearch]);

  const loadPreTripSubmissions = useCallback(async () => {
    if (!isAdmin) return;
    setPreTripLoading(true);
    try {
      const { data, error } = await withTimeout(
        'Admin pre-trip submissions',
        supabase
          .from('pre_trip_submissions')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100),
        15000
      );
      logSupabaseError('Admin.loadPreTripSubmissions', error);
      setPreTripSubmissions((data as PreTripSubmissionRow[]) || []);
    } catch (err) {
      console.error('[Admin.loadPreTripSubmissions]', err);
      setPreTripSubmissions([]);
      setNotice({ variant: 'error', text: describeError(err, 'Could not load pre-trip submissions.') });
    } finally {
      setPreTripLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadPreTripSubmissions();
  }, [isAdmin, loadPreTripSubmissions]);

  const loadPreTripSuggestions = async (submissionId: string) => {
    setPreTripSuggestionsLoading(submissionId);
    try {
      const token = await getAdminToken();
      if (!token) return;
      const out = await withTimeout('Admin pre-trip match suggestions', fetchPreTripMatchSuggestions(token, submissionId), 15000);
      if (out.ok) {
        setPreTripSuggestions((prev) => ({ ...prev, [submissionId]: out.suggestions }));
      }
    } catch (err) {
      setNotice({ variant: 'error', text: describeError(err, 'Could not load match suggestions.') });
    } finally {
      setPreTripSuggestionsLoading(null);
    }
  };

  const copyWaiversLink = async (bookingId: string) => {
    const url = `${window.location.origin}/waivers-insurance?bookingId=${encodeURIComponent(bookingId)}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ variant: 'success', text: 'Waivers link copied to clipboard.' });
    } catch {
      window.prompt('Copy this waivers link:', url);
    }
  };

  const runPreTripAdminAction = async (
    submissionId: string,
    action: 'match' | 'approve' | 'reject'
  ) => {
    const matched_booking_id = (preTripMatchIds[submissionId] || '').trim();
    if ((action === 'match' || action === 'approve') && !matched_booking_id) {
      window.alert('Enter a booking ID to match this submission.');
      return;
    }
    setPreTripActionBusy(submissionId);
    try {
      const token = await getAdminToken();
      if (!token) {
        window.alert('Sign in again to continue.');
        return;
      }
      const out = await withTimeout(
        'Admin pre-trip action',
        adminUpdatePreTripSubmission(token, submissionId, {
          action,
          matched_booking_id: matched_booking_id || undefined,
          admin_notes: preTripNotes[submissionId]?.trim() || undefined,
        }),
        15000
      );
      if (!out.ok) {
        window.alert(out.error || 'Action failed.');
        return;
      }
      setNotice({ variant: 'success', text: `Submission ${action}ed successfully.` });
      void loadPreTripSubmissions();
      void loadBookings();
    } catch (err) {
      setNotice({ variant: 'error', text: describeError(err, 'Pre-trip action failed.') });
    } finally {
      setPreTripActionBusy(null);
    }
  };

  const loadStats = useCallback(async () => {
    adminDebugLog('admin:stats:start');
    const [{ count: totalAll }, { count: pendingCt }, { data: priceRows }] = await withTimeout(
      'Admin stats load',
      Promise.all([
        supabase.from('bookings').select('*', { count: 'exact', head: true }),
        supabase
          .from('bookings')
          .select('*', { count: 'exact', head: true })
          .in('status', ['pending', 'pending_verification']),
        supabase.from('bookings').select('total_price').limit(5000),
      ]),
      15000
    );

    const revenue =
      priceRows?.reduce((sum, row) => sum + parseFloat(String(row.total_price)), 0) ?? 0;

    setStats({
      totalBookings: totalAll ?? 0,
      pendingBookings: pendingCt ?? 0,
      revenue,
      customers: totalAll ?? 0,
    });
    adminDebugLog('admin:stats:success', { totalBookings: totalAll, pendingBookings: pendingCt });
  }, []);

  const loadBookings = useCallback(async () => {
    if (!isAdmin) return;

    setLoadError(null);
    if (initialBookingsLoadRef.current) {
      setLoading(true);
    } else {
      setTableLoading(true);
    }

    try {
      adminDebugLog('admin:bookings:start', {
        initial: initialBookingsLoadRef.current,
        statusFilter,
        hasSearch: Boolean(debouncedEmailSearch.trim()),
        page,
      });
      let customerIds: string[] | null = null;
      if (debouncedEmailSearch.trim() !== '') {
        const { data: custs, error: custErr } = await withTimeout(
          'Admin customer search',
          supabase
            .from('customers')
            .select('id')
            .ilike('email', `%${debouncedEmailSearch.trim()}%`),
          15000
        );

        logSupabaseError('Admin.searchCustomers', custErr);

        customerIds = (custs ?? []).map((c) => c.id);
        if (customerIds.length === 0) {
          setBookings([]);
          setTotalCount(0);
          await loadStats();
          return;
        }
      }

      let countQuery = supabase.from('bookings').select('*', { count: 'exact', head: true });

      if (statusFilter !== 'all') {
        countQuery = countQuery.eq('status', statusFilter);
      }

      if (customerIds) {
        countQuery = countQuery.in('customer_id', customerIds);
      }

      const { count, error: countErr } = await withTimeout('Admin booking count', countQuery, 15000);
      logSupabaseError('Admin.countBookings', countErr);

      const total = count ?? 0;
      setTotalCount(total);

      const maxPage = total > 0 ? Math.max(0, Math.ceil(total / PAGE_SIZE) - 1) : 0;
      const safePage = Math.min(page, maxPage);

      if (safePage !== page) {
        setPage(safePage);
        return;
      }

      const from = safePage * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const buildEmbedQuery = () => {
        let q = supabase
          .from('bookings')
          .select('*, customers(*), boats(*), user_verifications(*), waivers(id)')
          .order('created_at', { ascending: false });
        if (statusFilter !== 'all') {
          q = q.eq('status', statusFilter);
        }
        if (customerIds) {
          q = q.in('customer_id', customerIds);
        }
        return q;
      };

      const buildPlainQuery = () => {
        let q = supabase.from('bookings').select('*').order('created_at', { ascending: false });
        if (statusFilter !== 'all') {
          q = q.eq('status', statusFilter);
        }
        if (customerIds) {
          q = q.in('customer_id', customerIds);
        }
        return q;
      };

      const embedRes = await withTimeout('Admin bookings embed query', buildEmbedQuery().range(from, to), 15000);
      let rows: AdminBookingRow[] = [];
      let loadError = embedRes.error;

      if (import.meta.env.DEV) {
        console.log('📦 BOOKINGS RAW:', embedRes.data);
        console.log('❌ ERROR (embed query):', embedRes.error);
      }

      if (loadError) {
        const plain = await withTimeout('Admin bookings fallback query', buildPlainQuery().range(from, to), 15000);
        if (import.meta.env.DEV) {
          console.log('📦 BOOKINGS RAW (fallback *):', plain.data);
          console.log('❌ ERROR (fallback):', plain.error);
        }
        rows = (plain.data ?? []) as unknown as AdminBookingRow[];
        loadError = plain.error;
      } else {
        rows = (embedRes.data ?? []) as unknown as AdminBookingRow[];
      }

      logSupabaseError('Admin.loadBookings', loadError);

      setBookings(rows);
      setLoadError(null);
      if (import.meta.env.DEV) {
        console.log('✅ FINAL BOOKINGS:', rows);
      }

      await loadStats();
      adminDebugLog('admin:bookings:success', { rows: rows.length });
    } catch (err) {
      const message = describeError(err, 'Could not load admin bookings.');
      console.error('[Admin.loadBookings]', message);
      setLoadError(message);
      setNotice({ variant: 'error', text: message });
      if (initialBookingsLoadRef.current) {
        setBookings([]);
        setTotalCount(0);
      }
    } finally {
      setLoading(false);
      setTableLoading(false);
      initialBookingsLoadRef.current = false;
    }
  }, [isAdmin, debouncedEmailSearch, statusFilter, page, loadStats]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadBookings();
  }, [isAdmin, loadBookings]);

  const runPaymentRecoveryAction = useCallback(
    async (id: string, action: 'retry' | 'refund' | 'resolve' | 'ignore') => {
      setPaymentRecoveryBusyId(id);
      try {
        const body =
          action === 'resolve' || action === 'ignore'
            ? JSON.stringify({ status: action === 'ignore' ? 'ignored' : 'resolved' })
            : undefined;
        await apiRequest(
          `/api/admin/payment-recovery/${encodeURIComponent(id)}/${action === 'ignore' ? 'resolve' : action}`,
          {
            method: 'POST',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body,
          }
        );
        setNotice({
          variant: 'success',
          text:
            action === 'retry'
              ? 'Payment recovery retry started.'
              : action === 'refund'
                ? 'Refund submitted.'
                : 'Recovery item updated.',
        });
        await Promise.all([loadPaymentRecovery(), loadBookings()]);
      } catch (err) {
        console.error('[payment-recovery-action]', err);
        setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Recovery action failed.' });
      } finally {
        setPaymentRecoveryBusyId(null);
      }
    },
    [apiRequest, loadBookings, loadPaymentRecovery]
  );

  const handleStatusUpdate = async (
    bookingId: string,
    status: 'pending' | 'pending_verification' | 'confirmed' | 'ready_for_departure' | 'cancelled' | 'completed'
  ) => {
    const { error } = await supabase.from('bookings').update({ status }).eq('id', bookingId);

    logSupabaseError('Admin.handleStatusUpdate', error);

    if (!error) {
      void loadBookings();
    }
    return { error };
  };

  /** DB uses `confirmed` / `cancelled` (not approved/rejected) — matches bookings_status_check. */
  const handleApprove = async (id: string) => {
    if (import.meta.env.DEV) {
      console.log('🔄 Updating booking status:', id);
    }
    const { error } = await handleStatusUpdate(id, 'confirmed');
    if (import.meta.env.DEV) {
      console.log('✅ Approved:', id, error);
    }
  };

  const handleReadyForDeparture = async (id: string) => {
    const { error } = await handleStatusUpdate(id, 'ready_for_departure');
    if (error) {
      window.alert(error.message || 'Could not mark ready for departure.');
    }
  };

  /** Marks the booking cancelled; keeps the row for records (does not refund via this action). */
  const handleCancelBooking = async (id: string) => {
    if (
      !window.confirm(
        'Cancel this booking?\n\nStatus will change to Cancelled and the booking will stay on file for your records. Refunds or credits are handled separately per your policy — this button does not refund in Stripe.'
      )
    ) {
      return;
    }
    const { error } = await handleStatusUpdate(id, 'cancelled');
    if (error) {
      window.alert(error.message || 'Could not cancel booking.');
    }
  };

  const handleDocStatusUpdate = async (
    bookingId: string,
    field: 'license_status' | 'insurance_status',
    value: DocStatus
  ) => {
    const { error } = await supabase.from('bookings').update({ [field]: value }).eq('id', bookingId);

    logSupabaseError('Admin.handleDocStatusUpdate', error);
    if (!error) void loadBookings();
  };

  const handleVerifyInsurance = async (id: string) => {
    await handleDocStatusUpdate(id, 'insurance_status', 'verified');
  };

  const handleBuoyStatusUpdate = async (bookingId: string, value: BuoyDocStatus) => {
    const stamp = new Date().toISOString();
    const { error } = await supabase
      .from('user_verifications')
      .update({ buoy_status: value, updated_at: stamp })
      .eq('booking_id', bookingId);

    logSupabaseError('Admin.handleBuoyStatusUpdate', error);
    if (!error) void loadBookings();
  };

  const handleMarkContactMessageRead = async (messageId: string, read: boolean) => {
    const { error } = await supabase.from('contact_messages').update({ is_read: read }).eq('id', messageId);
    logSupabaseError('Admin.markContactMessageRead', error);
    if (!error) {
      void loadContactInbox();
    } else {
      window.alert(error.message || 'Could not update message.');
    }
  };

  const handleDeleteContactMessage = async (messageId: string) => {
    if (!window.confirm('Delete this customer message? This cannot be undone.')) {
      return;
    }
    const { error } = await supabase.from('contact_messages').delete().eq('id', messageId);
    logSupabaseError('Admin.deleteContactMessage', error);
    if (!error) {
      void loadContactInbox();
    } else {
      window.alert(error.message || 'Could not delete message.');
    }
  };

  const openContactReply = (row: ContactInboxRow) => {
    setContactReplyRow(row);
    setContactReplyPreview(null);
    setContactReplyDraft({
      to: row.email,
      subject: `Re: Your message to Launch Zone Charters`,
      message: `Hi ${row.full_name || 'there'},\n\n\n\nJoshua\nLaunch Zone Charters`,
    });
  };

  const closeContactReply = (force = false) => {
    if (contactReplyBusy && !force) return;
    setContactReplyRow(null);
    setContactReplyPreview(null);
    setContactReplyDraft({ to: '', subject: '', message: '' });
  };

  const validateContactReplyDraft = () => {
    if (!contactReplyDraft.to.trim()) return 'Customer email is missing.';
    if (!contactReplyDraft.subject.trim()) return 'Subject is required.';
    if (!contactReplyDraft.message.trim()) return 'Message is required.';
    return '';
  };

  const previewContactReply = async () => {
    if (!contactReplyRow) return;
    const validationError = validateContactReplyDraft();
    if (validationError) {
      setNotice({ variant: 'error', text: validationError });
      return;
    }
    setContactReplyBusy('preview');
    try {
      const payload = await apiRequest(`/api/admin/contact-messages/${contactReplyRow.id}/reply/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contactReplyDraft),
      });
      const preview = payload.preview as ContactReplyPreview | undefined;
      if (!preview) throw new Error('Could not preview reply.');
      setContactReplyPreview(preview);
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not preview reply.' });
    } finally {
      setContactReplyBusy(null);
    }
  };

  const sendContactReply = async () => {
    if (!contactReplyRow || !contactReplyPreview) return;
    setContactReplyBusy('send');
    try {
      await apiRequest(`/api/admin/contact-messages/${contactReplyRow.id}/reply/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: contactReplyPreview.to,
          subject: contactReplyPreview.subject,
          message: contactReplyPreview.message,
        }),
      });
      setNotice({ variant: 'success', text: 'Reply sent.' });
      closeContactReply(true);
      await loadContactInbox();
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not send reply.' });
    } finally {
      setContactReplyBusy(null);
    }
  };

  const handleDelete = async (bookingId: string) => {
    if (
      !window.confirm(
        'Delete this booking permanently? Related waiver records will be removed. This cannot be undone.'
      )
    ) {
      return;
    }

    try {
      await apiRequest(`/api/bookings/${encodeURIComponent(bookingId)}`, { method: 'DELETE' });
      void loadBookings();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not delete booking.';
      window.alert(msg);
    }
  };

  const persistLastRun = (status: string) => {
    const iso = new Date().toISOString();
    localStorage.setItem(LS_CAP_RUN_STATUS, status);
    localStorage.setItem(LS_CAP_RUN_TIME, iso);
    setLastRunStatus(status);
    setLastRunTime(iso);
  };

  const handleGenerateCaptainsLog = () => {
    setNotice(null);
    setIsGenerating(true);

    void (async () => {
      try {
        const token = await getAdminToken();
        if (!token) {
          setNotice({ variant: 'error', text: 'You must be signed in.' });
          persistLastRun('Failed');
          return;
        }

        if (!env.apiUrlConfigured || !env.apiUrl) {
          setNotice({ variant: 'error', text: 'API server URL is not configured (set VITE_API_URL).' });
          persistLastRun('Failed');
          return;
        }

        const payload = await fetchJsonWithTimeout<{
          success?: boolean;
          status?: string;
          message?: string;
          error?: string;
          details?: string;
        }>('admin-api:generate-content', `${env.apiUrl}/api/generate-content`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }, 15000);

        const errLine =
          typeof payload.error === 'string'
            ? payload.error
            : typeof payload.message === 'string'
              ? payload.message
              : 'Something went wrong.';
        const detailSuffix =
          typeof payload.details === 'string' && payload.details.trim()
            ? ` ${payload.details.trim().slice(0, 500)}`
            : '';

        if (payload.success === false) {
          if (payload.message === 'Already generating') {
            setNotice({ variant: 'info', text: 'Already generating. Wait for the current run to finish.' });
            persistLastRun('Busy');
          } else {
            console.error('[generate-content]', payload);
            setNotice({ variant: 'error', text: `${errLine}${detailSuffix}`.trim() });
            persistLastRun('Failed');
          }
          return;
        }

        if (payload.status === 'started') {
          setNotice({
            variant: 'info',
            text:
              typeof payload.message === 'string' && payload.message.trim()
                ? `${payload.message.trim()}. Refresh Captain's Log in a few minutes to see new posts.`
                : "Content generation started in the background. Refresh Captain's Log in a few minutes to see new posts.",
          });
          persistLastRun('Started');
          await Promise.all([loadBookings(), loadCaptainsLog()]);
          return;
        }

        setNotice({ variant: 'success', text: 'Content generated successfully' });
        persistLastRun('Success');
        await Promise.all([loadBookings(), loadCaptainsLog()]);
      } catch (err) {
        console.error('[generate-content]', err);
        setNotice({ variant: 'error', text: 'Failed to generate content. Check the API and try again.' });
        persistLastRun('Failed');
      } finally {
        setIsGenerating(false);
      }
    })();
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(page + 1, totalPages);
  const selectedIncidentBooking = bookings.find((b) => b.id === selectedIncidentBookingId) || null;
  const openIncidents = bookingIncidents.filter((inc) => {
    const s = String(inc.status || '').toLowerCase();
    return s === 'pending' || s === 'approved';
  });
  const pastIncidents = bookingIncidents.filter((inc) => {
    const s = String(inc.status || '').toLowerCase();
    return s === 'charged' || s === 'disputed';
  });

  useEffect(() => {
    if (!expandedResolvedIncidentId) return;
    const stillResolved = pastIncidents.some((inc) => inc.id === expandedResolvedIncidentId);
    if (!stillResolved) {
      setExpandedResolvedIncidentId(null);
    }
  }, [pastIncidents, expandedResolvedIncidentId]);

  const statusBadgeClass = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'border border-green-200 bg-green-100 text-green-800';
      case 'ready_for_departure':
        return 'border border-cyan-300 bg-cyan-100 text-cyan-950';
      case 'pending':
        return 'border border-yellow-300 bg-yellow-100 text-yellow-900';
      case 'pending_verification':
        return 'border border-amber-300 bg-amber-100 text-amber-950';
      case 'cancelled':
        return 'border border-red-200 bg-red-100 text-red-800';
      case 'completed':
        return 'border border-emerald-200 bg-emerald-50 text-emerald-900';
      default:
        return 'border border-slate-200 bg-slate-100 text-slate-800';
    }
  };

  const docStatusBadgeClass = (s: string) => {
    switch (s) {
      case 'verified':
        return 'border border-green-200 bg-green-50 text-green-800';
      case 'rejected':
        return 'border border-red-200 bg-red-50 text-red-800';
      case 'submitted':
        return 'border border-amber-200 bg-amber-50 text-amber-900';
      default:
        return 'border border-slate-200 bg-slate-50 text-slate-700';
    }
  };

  if (authLoading) {
    return <FullPageLoader message="Checking admin access…" />;
  }

  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow-lg">
          <h2 className="mb-2 text-2xl font-bold text-slate-900">Admin session could not load</h2>
          <p className="mb-4 text-slate-600">
            The admin page stopped while restoring your mobile browser session.
          </p>
          <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-left text-sm font-semibold text-red-800">
            {authError}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={retryAuth}
              className="rounded-lg bg-amber-600 px-6 py-3 font-bold text-white transition-colors hover:bg-amber-700"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => onNavigate('admin-login')}
              className="rounded-lg bg-slate-200 px-6 py-3 font-bold text-slate-900 transition-colors hover:bg-slate-300"
            >
              Admin Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    const signedIn = Boolean(user);
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow-lg">
          <h2 className="mb-2 text-2xl font-bold text-slate-900">Access denied</h2>
          <p className="mb-6 text-slate-600">
            {signedIn
              ? 'This account is not authorized for the admin dashboard. If you need access, contact the site owner.'
              : 'Sign in with an administrator account to open the dashboard.'}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => onNavigate('admin-login')}
              className="rounded-lg bg-slate-200 px-6 py-3 font-bold text-slate-900 transition-colors hover:bg-slate-300"
            >
              {signedIn ? 'Try another account' : 'Go to Admin Login'}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className="rounded-lg bg-amber-600 px-6 py-3 font-bold text-white transition-colors hover:bg-amber-700"
            >
              Go Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading && bookings.length === 0 && !tableLoading) {
    return <FullPageLoader message="Loading dashboard…" />;
  }

  if (loadError && bookings.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-lg rounded-xl bg-white p-8 text-center shadow-lg">
          <h2 className="mb-2 text-2xl font-bold text-slate-900">Admin dashboard could not load</h2>
          <p className="mb-4 text-slate-600">
            The first admin data request failed or timed out. This can happen on mobile networks or when Safari suspends a request.
          </p>
          <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-left text-sm font-semibold text-red-800">
            {loadError}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => void loadBookings()}
              className="rounded-lg bg-amber-600 px-6 py-3 font-bold text-white transition-colors hover:bg-amber-700"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => onNavigate('admin-login')}
              className="rounded-lg bg-slate-200 px-6 py-3 font-bold text-slate-900 transition-colors hover:bg-slate-300"
            >
              Admin Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AdminShell title="Admin Bookings" subtitle={user?.email ? `Welcome back, ${user.email}` : undefined}>
        {notice && (
          <div
            className={`fixed bottom-6 left-1/2 z-[100] max-w-md -translate-x-1/2 rounded-lg px-4 py-3 text-center text-sm font-semibold shadow-lg ${
              notice.variant === 'success'
                ? 'bg-green-700 text-white'
                : notice.variant === 'info'
                  ? 'bg-slate-800 text-amber-200'
                  : 'bg-red-700 text-white'
            }`}
            role="status"
          >
            {notice.text}
          </div>
        )}

        <div className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Promo Codes</h2>
              <p className="text-xs text-slate-500">
                Create discounts for checkout. Customers validate codes through the backend before Stripe starts.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadPromoCodes()}
              disabled={promoCodesLoading}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {promoCodesLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          <div className="grid gap-0 lg:grid-cols-[minmax(280px,360px)_1fr]">
            <div className="border-b border-slate-100 p-4 lg:border-b-0 lg:border-r">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                {promoEditingId ? 'Edit code' : 'Create code'}
              </h3>
              <div className="mt-4 space-y-3">
                <label className="block text-sm">
                  <span className="font-semibold text-slate-700">Code</span>
                  <input
                    type="text"
                    value={promoForm.code}
                    onChange={(e) => setPromoForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-slate-900"
                    placeholder="VIP50"
                    autoComplete="off"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-semibold text-slate-700">Description</span>
                  <input
                    type="text"
                    value={promoForm.description}
                    onChange={(e) => setPromoForm((f) => ({ ...f, description: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                    placeholder="Summer launch promo"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm">
                    <span className="font-semibold text-slate-700">Type</span>
                    <select
                      value={promoForm.discount_type}
                      onChange={(e) =>
                        setPromoForm((f) => ({ ...f, discount_type: e.target.value as PromoDiscountType }))
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                    >
                      <option value="percent">Percent</option>
                      <option value="fixed">Fixed $</option>
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="font-semibold text-slate-700">Value</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={promoForm.discount_value}
                      onChange={(e) => setPromoForm((f) => ({ ...f, discount_value: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                      placeholder={promoForm.discount_type === 'percent' ? '50' : '25'}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm">
                    <span className="font-semibold text-slate-700">Max uses</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={promoForm.max_uses}
                      onChange={(e) => setPromoForm((f) => ({ ...f, max_uses: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                      placeholder="Optional"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-semibold text-slate-700">Applies to</span>
                    <select
                      value={promoForm.applies_to}
                      onChange={(e) => setPromoForm((f) => ({ ...f, applies_to: e.target.value as PromoAppliesTo }))}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                    >
                      {PROMO_APPLIES_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={promoForm.active}
                    onChange={(e) => setPromoForm((f) => ({ ...f, active: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Active
                </label>
                <div className="grid gap-3">
                  <label className="block text-sm">
                    <span className="font-semibold text-slate-700">Starts at</span>
                    <input
                      type="datetime-local"
                      value={promoForm.starts_at}
                      onChange={(e) => setPromoForm((f) => ({ ...f, starts_at: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-semibold text-slate-700">Expires at</span>
                    <input
                      type="datetime-local"
                      value={promoForm.expires_at}
                      onChange={(e) => setPromoForm((f) => ({ ...f, expires_at: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void savePromoCode()}
                    disabled={promoSaving}
                    className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
                  >
                    {promoSaving ? 'Saving...' : promoEditingId ? 'Save changes' : 'Create code'}
                  </button>
                  {promoEditingId && (
                    <button
                      type="button"
                      onClick={resetPromoForm}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              {promoCodesLoading ? (
                <p className="px-4 py-8 text-sm text-slate-500">Loading promo codes...</p>
              ) : promoCodesError ? (
                <p className="px-4 py-8 text-sm text-red-600">{promoCodesError}</p>
              ) : promoCodes.length === 0 ? (
                <p className="px-4 py-8 text-sm text-slate-500">No promo codes yet.</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                    <tr>
                      <th className="px-4 py-2">Code</th>
                      <th className="px-4 py-2">Discount</th>
                      <th className="px-4 py-2">Scope</th>
                      <th className="px-4 py-2">Uses</th>
                      <th className="px-4 py-2">Expires</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {promoCodes.map((row) => (
                      <tr key={row.id} className="align-top hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-mono font-bold text-slate-900">{row.code}</div>
                          {row.description && (
                            <div className="mt-1 max-w-xs text-xs text-slate-500">{row.description}</div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-800">
                          {row.discount_type === 'percent'
                            ? `${Number(row.discount_value).toFixed(2).replace(/\.00$/, '')}%`
                            : `$${Number(row.discount_value).toFixed(2)}`}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {PROMO_APPLIES_OPTIONS.find((option) => option.value === row.applies_to)?.label ||
                            row.applies_to}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {row.used_count}
                          {row.max_uses == null ? '' : ` / ${row.max_uses}`}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {row.expires_at ? new Date(row.expires_at).toLocaleDateString() : 'No expiration'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                              row.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {row.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => editPromoCode(row)}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={promoBusyId === row.id}
                            onClick={() => void setPromoActive(row, !row.active)}
                            className="ml-2 rounded-md px-2 py-1 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                          >
                            {row.active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            type="button"
                            disabled={promoBusyId === row.id}
                            onClick={() => void deactivatePromoCode(row)}
                            className="ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/90 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Captain&apos;s Log</p>
            <p className="text-xs text-slate-600">
              Generate new articles via the server pipeline (Python + Ollama). Runs up to ~60s per
              batch on the server; the admin UI stays responsive.
            </p>
            <dl className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-600 sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-slate-700">Last run status</dt>
                <dd>{lastRunStatus}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-700">Last run time</dt>
                <dd>
                  {lastRunTime
                    ? new Date(lastRunTime).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })
                    : 'N/A'}
                </dd>
              </div>
            </dl>
          </div>
          <button
            type="button"
            onClick={handleGenerateCaptainsLog}
            disabled={isGenerating}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-bold text-white shadow transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            {isGenerating ? 'Generating...' : "Generate Captain's Log Content"}
          </button>
        </div>

        <div className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Add article manually</h2>
              <p className="text-xs text-slate-500">
                Publish Markdown to Captain&apos;s Log without the generator. Slug is derived from the title unless you
                set a custom one. Use <strong>Edit</strong> on a row below to update an existing post.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setCaptainsLogFormError(null);
                setCaptainsLogFormOpen((open) => {
                  if (open) {
                    resetCaptainsLogForm();
                    return false;
                  }
                  resetCaptainsLogForm();
                  return true;
                });
              }}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {captainsLogFormOpen ? 'Hide form' : 'Show form'}
            </button>
          </div>
          {captainsLogFormOpen && (
            <div className="space-y-4 border-b border-slate-100 px-4 py-4">
              {captainsLogEditingId ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  Editing an existing article — saving updates the live page URL if you change the slug.
                </p>
              ) : null}
              {captainsLogFormError && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {captainsLogFormError}
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-semibold text-slate-700">Title</span>
                  <input
                    type="text"
                    value={newArticleTitle}
                    onChange={(e) => setNewArticleTitle(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                    placeholder="Headline shown on the site"
                    autoComplete="off"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-semibold text-slate-700">URL slug (optional)</span>
                  <input
                    type="text"
                    value={newArticleSlug}
                    onChange={(e) => setNewArticleSlug(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                    placeholder="e.g. my-launch-view-tips"
                    autoComplete="off"
                  />
                </label>
              </div>
              <label className="block text-sm">
                <span className="font-semibold text-slate-700">Category</span>
                <select
                  value={newArticleCategory}
                  onChange={(e) => setNewArticleCategory(e.target.value as CaptainsLogCategory)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 sm:max-w-md"
                >
                  {CAPTAINS_LOG_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-semibold text-slate-700">Body (Markdown)</span>
                <textarea
                  value={newArticleContent}
                  onChange={(e) => setNewArticleContent(e.target.value)}
                  rows={12}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900"
                  placeholder={'## Section\n\nParagraph…'}
                />
              </label>
              <div className="space-y-4">
                <div className="rounded-md border border-slate-200 bg-slate-50/80 px-3 py-3 sm:px-4">
                  <span className="text-sm font-semibold text-slate-700">Hero image (optional)</span>
                  <p className="mt-1 text-xs text-slate-500">
                    Upload JPEG, PNG, WebP, or GIF (max 10 MB). If you choose a file, it is saved to your site storage
                    and used instead of the URL field. Run the{' '}
                    <code className="rounded bg-white px-1 text-[11px]">captains-log</code> storage migration if upload
                    fails.
                  </p>
                  <input
                    ref={captainsLogHeroInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="sr-only"
                    aria-label="Upload hero image file"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      setCaptainsLogHeroFile(f ?? null);
                    }}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => captainsLogHeroInputRef.current?.click()}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
                    >
                      Choose image file
                    </button>
                    {captainsLogHeroFile ? (
                      <>
                        <span className="max-w-[min(100%,280px)] truncate text-sm text-slate-700" title={captainsLogHeroFile.name}>
                          {captainsLogHeroFile.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setCaptainsLogHeroFile(null);
                            if (captainsLogHeroInputRef.current) captainsLogHeroInputRef.current.value = '';
                          }}
                          className="text-sm font-semibold text-slate-600 underline hover:text-slate-900"
                        >
                          Clear file
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="font-semibold text-slate-700">Hero image URL (optional)</span>
                    <span className="mt-0.5 block text-xs font-normal text-slate-500">
                      Use when you don&apos;t upload a file above, or to override after clearing the file.
                    </span>
                    <input
                      type="url"
                      value={newArticleImageUrl}
                      onChange={(e) => setNewArticleImageUrl(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                      placeholder="https://…"
                      autoComplete="off"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-semibold text-slate-700">Image alt text (optional)</span>
                    <input
                      type="text"
                      value={newArticleImageAlt}
                      onChange={(e) => setNewArticleImageAlt(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                      placeholder="Describe the hero for accessibility"
                      autoComplete="off"
                    />
                  </label>
                </div>
              </div>
              <label className="block text-sm">
                <span className="font-semibold text-slate-700">Short summary (optional)</span>
                <textarea
                  value={newArticleSummary}
                  onChange={(e) => setNewArticleSummary(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  placeholder="Used for SEO / excerpts when set"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveCaptainsLogArticle()}
                  disabled={captainsLogSaving}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-bold text-white shadow transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {captainsLogSaving
                    ? 'Saving…'
                    : captainsLogEditingId
                      ? 'Save changes'
                      : 'Publish article'}
                </button>
              </div>
            </div>
          )}
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-lg font-bold text-slate-900">Recent Captain&apos;s Log articles</h2>
            <p className="text-xs text-slate-500">
              Newest first (up to 500 articles). Refreshes when you publish or delete here, or after a successful
              generation run. Scroll the list to see older posts.
            </p>
          </div>
          <div className="max-h-[min(70vh,36rem)] overflow-x-auto overflow-y-auto">
            {captainsLogArticles.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500">No articles yet.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-2">Title</th>
                    <th className="px-4 py-2">Category</th>
                    <th className="px-4 py-2">Created</th>
                    <th className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {captainsLogArticles.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="max-w-[200px] truncate px-4 py-2 font-medium text-slate-900" title={a.title}>
                        {a.title}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">{a.category}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                        {new Date(a.created_at).toLocaleDateString()}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        <a
                          href={captainsLogArticlePath(a.slug)}
                          className="font-semibold text-amber-700 hover:text-amber-800"
                          target="_blank"
                          rel="noreferrer"
                        >
                          View
                        </a>
                        <button
                          type="button"
                          onClick={() => void handleEditCaptainsLogArticle(a.id)}
                          disabled={
                            !!captainsLogEditLoadingId ||
                            captainsLogSaving ||
                            captainsLogDeletingId === a.id
                          }
                          className="ml-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
                          title="Edit article"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                          {captainsLogEditLoadingId === a.id ? 'Loading…' : 'Edit'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteCaptainsLogArticle(a.id, a.title)}
                          disabled={captainsLogDeletingId === a.id}
                          className="ml-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                          title="Delete article"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-lg font-bold text-slate-900">Subscribers</h2>
            <p className="text-xs text-slate-500">Latest alert subscribers (max 50).</p>
          </div>
          <div className="max-h-72 overflow-x-auto overflow-y-auto">
            {subscribersLoading ? (
              <p className="px-4 py-6 text-sm text-slate-500">Loading subscribers…</p>
            ) : subscribersError ? (
              <p className="px-4 py-6 text-sm text-red-600">{subscribersError}</p>
            ) : subscribers.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500">No subscribers yet.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-2">Email</th>
                    <th className="px-4 py-2">Phone</th>
                    <th className="px-4 py-2">Date joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {subscribers.map((user) => (
                    <tr key={`${user.email}-${user.created_at}`} className="hover:bg-slate-50">
                      <td className="max-w-[260px] break-all px-4 py-2 font-medium text-slate-900">
                        {user.email}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-700">
                        {user.phone || 'No phone'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                        {new Date(user.created_at).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Recent Alert Activity</h2>
                <p className="text-xs text-slate-500">Latest triggered alert events (max 20).</p>
              </div>
              <button
                type="button"
                onClick={() => void handleRunAlerts()}
                disabled={runningAlerts}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {runningAlerts ? 'Running...' : 'Run Alerts'}
              </button>
            </div>
          </div>
          <div className="max-h-72 overflow-x-auto overflow-y-auto">
            {alertsLoading ? (
              <p className="px-4 py-6 text-sm text-slate-500">Loading alerts…</p>
            ) : alertsError ? (
              <p className="px-4 py-6 text-sm text-red-600">{alertsError}</p>
            ) : alerts.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500">No alerts logged yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {alerts.map((alert) => (
                  <div key={alert.id} className="px-4 py-3">
                    <p className="text-sm font-semibold uppercase tracking-wide text-slate-800">
                      {alert.type || 'alert'} {alert.score != null ? `· score ${alert.score}` : ''}
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                      {alert.message || 'No message'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {new Date(alert.created_at).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div id="contact-inbox" className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Mail className="h-5 w-5 text-amber-600" aria-hidden />
              <h2 className="text-lg font-bold text-slate-900">Customer Messages</h2>
            </div>
            <p className="text-xs text-slate-500">
              Inbox from the public contact form (newest first). Mark as read when handled; deletes are
              permanent.
            </p>
          </div>
          <div className="max-h-[28rem] overflow-x-auto overflow-y-auto">
            {contactInboxLoading ? (
              <p className="px-4 py-6 text-sm text-slate-500">Loading messages…</p>
            ) : contactInbox.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500">No messages yet.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Name</th>
                    <th className="px-4 py-2">Email</th>
                    <th className="px-4 py-2">Message</th>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {contactInbox.map((row) => (
                    <tr
                      key={row.id}
                      className={`align-top hover:bg-slate-50 ${row.is_read ? '' : 'bg-amber-50/60'}`}
                    >
                      <td className="whitespace-nowrap px-4 py-2">
                        {row.is_read ? (
                          <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                            Read
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                            New
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-medium text-slate-900">{row.full_name}</td>
                      <td className="max-w-[200px] break-all px-4 py-2 text-slate-700">
                        <a href={`mailto:${row.email}`} className="font-semibold text-amber-700 hover:text-amber-800">
                          {row.email}
                        </a>
                      </td>
                      <td className="max-w-md px-4 py-2 text-slate-700" title={row.message}>
                        {previewMessageBody(row.message)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                        {new Date(row.created_at).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">
                        <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center">
                          <button
                            type="button"
                            onClick={() => openContactReply(row)}
                            className="inline-flex items-center justify-center rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100"
                          >
                            Reply
                          </button>
                          {!row.is_read ? (
                            <button
                              type="button"
                              onClick={() => void handleMarkContactMessageRead(row.id, true)}
                              className="inline-flex items-center justify-center rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50"
                            >
                              Mark read
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleMarkContactMessageRead(row.id, false)}
                              className="inline-flex items-center justify-center rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                            >
                              Mark unread
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleDeleteContactMessage(row.id)}
                            className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-800 transition-colors hover:bg-red-100"
                            title="Delete message"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {contactReplyRow ? (
          <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/70 p-4">
            <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-2xl font-black text-slate-900">Reply to Customer</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Original message from {contactReplyRow.full_name || contactReplyRow.email}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => closeContactReply()}
                  disabled={contactReplyBusy != null}
                  className="rounded-lg bg-slate-100 px-4 py-2 font-bold text-slate-800 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-black uppercase tracking-wide text-slate-500">Customer Message</div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{contactReplyRow.message}</p>
              </div>

              {!contactReplyPreview ? (
                <div className="mt-5 space-y-4">
                  <label className="block text-sm font-bold text-slate-700">
                    To
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-slate-900"
                      type="email"
                      value={contactReplyDraft.to}
                      onChange={(event) => setContactReplyDraft((prev) => ({ ...prev, to: event.target.value }))}
                    />
                  </label>
                  <label className="block text-sm font-bold text-slate-700">
                    Subject
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-slate-900"
                      value={contactReplyDraft.subject}
                      onChange={(event) => setContactReplyDraft((prev) => ({ ...prev, subject: event.target.value }))}
                    />
                  </label>
                  <label className="block text-sm font-bold text-slate-700">
                    Message
                    <textarea
                      className="mt-1 min-h-[240px] w-full rounded-lg border border-slate-300 px-3 py-3 text-slate-900"
                      value={contactReplyDraft.message}
                      onChange={(event) => setContactReplyDraft((prev) => ({ ...prev, message: event.target.value }))}
                    />
                  </label>

                  <div className="grid gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => void previewContactReply()}
                      disabled={contactReplyBusy != null}
                      className="rounded-xl bg-slate-900 px-5 py-4 text-lg font-black text-white disabled:opacity-50"
                    >
                      {contactReplyBusy === 'preview' ? 'Previewing...' : 'Preview Reply'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void previewContactReply()}
                      disabled={contactReplyBusy != null}
                      className="rounded-xl bg-green-700 px-5 py-4 text-lg font-black text-white disabled:opacity-50"
                    >
                      Send Reply
                    </button>
                    <button
                      type="button"
                      onClick={() => setContactReplyDraft({ to: contactReplyRow.email, subject: '', message: '' })}
                      disabled={contactReplyBusy != null}
                      className="rounded-xl border border-slate-300 px-5 py-4 text-lg font-black text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Clear
                    </button>
                  </div>
                  <p className="text-xs font-semibold text-slate-500">
                    Send Reply opens preview first. Nothing sends until you confirm.
                  </p>
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs font-black uppercase tracking-wide text-slate-500">From</div>
                    <p className="mt-1 font-semibold text-slate-900">{contactReplyPreview.from}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs font-black uppercase tracking-wide text-slate-500">To</div>
                    <p className="mt-1 font-semibold text-slate-900">{contactReplyPreview.to}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs font-black uppercase tracking-wide text-slate-500">Subject</div>
                    <p className="mt-1 font-semibold text-slate-900">{contactReplyPreview.subject}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs font-black uppercase tracking-wide text-slate-500">Message</div>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-4 text-sm text-slate-900">
                      {contactReplyPreview.message}
                    </pre>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => setContactReplyPreview(null)}
                      disabled={contactReplyBusy === 'send'}
                      className="rounded-xl border border-slate-300 px-5 py-4 text-lg font-black text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => closeContactReply()}
                      disabled={contactReplyBusy === 'send'}
                      className="rounded-xl border border-slate-300 px-5 py-4 text-lg font-black text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendContactReply()}
                      disabled={contactReplyBusy === 'send'}
                      className="rounded-xl bg-green-700 px-5 py-4 text-lg font-black text-white disabled:opacity-50"
                    >
                      {contactReplyBusy === 'send' ? 'Sending...' : 'Send Reply'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="mb-8 grid gap-6 md:grid-cols-4">
          <div className="rounded-xl bg-white p-6 shadow">
            <div className="mb-4 flex items-center justify-between">
              <Calendar className="h-8 w-8 text-blue-600" />
              <span className="text-3xl font-bold text-slate-900">{stats.totalBookings}</span>
            </div>
            <div className="text-sm font-semibold text-slate-600">Total Bookings</div>
          </div>

          <div className="rounded-xl bg-white p-6 shadow">
            <div className="mb-4 flex items-center justify-between">
              <Settings className="h-8 w-8 text-amber-600" />
              <span className="text-3xl font-bold text-slate-900">{stats.pendingBookings}</span>
            </div>
            <div className="text-sm font-semibold text-slate-600">Pending Approval</div>
          </div>

          <div className="rounded-xl bg-white p-6 shadow">
            <div className="mb-4 flex items-center justify-between">
              <DollarSign className="h-8 w-8 text-green-600" />
              <span className="text-3xl font-bold text-slate-900">
                ${stats.revenue.toLocaleString()}
              </span>
            </div>
            <div className="text-sm font-semibold text-slate-600">Total Revenue (est.)</div>
          </div>

          <div className="rounded-xl bg-white p-6 shadow">
            <div className="mb-4 flex items-center justify-between">
              <Users className="h-8 w-8 text-purple-600" />
              <span className="text-3xl font-bold text-slate-900">{stats.customers}</span>
            </div>
            <div className="text-sm font-semibold text-slate-600">Customers</div>
          </div>
        </div>

        <div className="relative mb-8 rounded-xl bg-white shadow">
          {preTripLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/60">
              <div className="text-sm font-semibold text-slate-600">Loading submissions…</div>
            </div>
          )}
          <div className="border-b border-slate-200 p-6">
            <h2 className="text-2xl font-bold text-slate-900">Pre-Trip Submissions</h2>
            <p className="mt-1 text-sm text-slate-500">
              Off-platform waiver and insurance uploads. Match to an existing booking, then approve or reject.
            </p>
          </div>
          <AdminResponsiveList
            desktop={
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Trip</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Docs</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Match booking</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {preTripSubmissions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      No pre-trip submissions yet.
                    </td>
                  </tr>
                ) : (
                  preTripSubmissions.map((row) => (
                    <tr key={row.id} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{row.customer_name || '—'}</div>
                        <div className="text-slate-600">{row.email}</div>
                        <div className="text-xs text-slate-500">{row.phone || '—'}</div>
                        {row.groupon_code ? (
                          <div className="mt-1 text-xs font-medium text-emerald-700">Groupon: {row.groupon_code}</div>
                        ) : null}
                        <div className="mt-1 font-mono text-[10px] text-slate-400" title={row.id}>{shortId(row.id)}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-800">
                        <div>{tripTypeLabel(row.trip_type)}</div>
                        {row.requested_trip_date ? (
                          <div className="text-xs text-slate-500">
                            {new Date(row.requested_trip_date).toLocaleString()}
                          </div>
                        ) : null}
                        {row.selected_boat_reg_no ? (
                          <div className="text-xs text-slate-500">Buoy {row.selected_boat_reg_no}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1 text-xs">
                          <span>Waiver: {row.waiver_signed ? '✅' : '❌'}</span>
                          <span>License: {row.license_status}</span>
                          <span>Insurance: {row.insurance_status}</span>
                          {row.license_url ? (
                            <a
                              href={row.license_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold text-blue-700 hover:underline"
                            >
                              View license
                            </a>
                          ) : null}
                          {row.insurance_url ? (
                            <a
                              href={row.insurance_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold text-blue-700 hover:underline"
                            >
                              View insurance
                            </a>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold capitalize text-slate-800">
                          {row.admin_status.replace(/_/g, ' ')}
                        </span>
                        {row.matched_booking_id ? (
                          <div className="mt-1 font-mono text-[10px] text-slate-500" title={row.matched_booking_id}>
                            → {shortId(row.matched_booking_id)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          placeholder="Booking UUID"
                          value={preTripMatchIds[row.id] ?? row.matched_booking_id ?? ''}
                          onChange={(e) =>
                            setPreTripMatchIds((prev) => ({ ...prev, [row.id]: e.target.value }))
                          }
                          className="mb-2 w-full min-w-[180px] rounded border border-slate-300 px-2 py-1 text-xs"
                        />
                        {row.groupon_code || row.email ? (
                          <div className="mb-2">
                            <button
                              type="button"
                              disabled={preTripSuggestionsLoading === row.id}
                              onClick={() => void loadPreTripSuggestions(row.id)}
                              className="text-xs font-semibold text-cyan-700 hover:underline disabled:opacity-50"
                            >
                              {preTripSuggestionsLoading === row.id
                                ? 'Finding matches…'
                                : 'Suggest matching bookings'}
                            </button>
                            {(preTripSuggestions[row.id] || []).length > 0 ? (
                              <ul className="mt-2 space-y-1">
                                {preTripSuggestions[row.id].map((s) => (
                                  <li key={s.id}>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPreTripMatchIds((prev) => ({ ...prev, [row.id]: s.id }))
                                      }
                                      className="w-full rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-left text-[11px] text-emerald-900 hover:bg-emerald-100"
                                    >
                                      <span className="font-semibold">{s.match_reason}</span>
                                      <br />
                                      {s.customer_name || 'Customer'} ·{' '}
                                      {new Date(s.start_time).toLocaleDateString()}
                                      {s.promo_code ? ` · ${s.promo_code}` : ''}
                                      <br />
                                      <span className="font-mono text-[10px]" title={s.id}>{shortId(s.id)}</span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            ) : preTripSuggestions[row.id] ? (
                              <p className="mt-1 text-[11px] text-slate-500">No automatic matches found.</p>
                            ) : null}
                          </div>
                        ) : null}
                        <textarea
                          placeholder="Admin notes"
                          rows={2}
                          value={preTripNotes[row.id] ?? row.admin_notes ?? ''}
                          onChange={(e) =>
                            setPreTripNotes((prev) => ({ ...prev, [row.id]: e.target.value }))
                          }
                          className="w-full min-w-[180px] rounded border border-slate-300 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            disabled={preTripActionBusy === row.id}
                            onClick={() => void runPreTripAdminAction(row.id, 'match')}
                            className="rounded bg-cyan-700 px-2 py-1 text-xs font-semibold text-white hover:bg-cyan-800 disabled:opacity-40"
                          >
                            Match
                          </button>
                          <button
                            type="button"
                            disabled={preTripActionBusy === row.id}
                            onClick={() => void runPreTripAdminAction(row.id, 'approve')}
                            className="rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-40"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={preTripActionBusy === row.id}
                            onClick={() => void runPreTripAdminAction(row.id, 'reject')}
                            className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
              </div>
            }

            mobile={
              <div className="space-y-3 p-3">
                {preTripSubmissions.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">No pre-trip submissions yet.</p>
                ) : null}
                {preTripSubmissions.map((row) => (
                  <MobileAdminCard
                    key={`pre-m-${row.id}`}
                    title={row.customer_name || 'Customer'}
                    subtitle={row.email}
                    badge={
                      <StatusBadge tone={row.admin_status === 'approved' ? 'success' : row.admin_status === 'rejected' ? 'danger' : 'warning'}>
                        {humanizeLabel(row.admin_status)}
                      </StatusBadge>
                    }
                    fields={[
                      { label: 'Phone', value: row.phone || '—', hideIfEmpty: true },
                      { label: 'Trip', value: tripTypeLabel(row.trip_type) },
                      {
                        label: 'Requested',
                        value: row.requested_trip_date
                          ? new Date(row.requested_trip_date).toLocaleString()
                          : '—',
                        hideIfEmpty: true,
                      },
                      {
                        label: 'Docs',
                        value: `Waiver ${row.waiver_signed ? 'Yes' : 'No'} · License ${humanizeLabel(row.license_status)} · Insurance ${humanizeLabel(row.insurance_status)}`,
                      },
                      {
                        label: 'Matched',
                        value: row.matched_booking_id ? (
                          <span className="font-mono text-xs" title={row.matched_booking_id}>
                            {shortId(row.matched_booking_id)}
                          </span>
                        ) : (
                          '—'
                        ),
                      },
                      {
                        label: 'Ref',
                        value: (
                          <span className="font-mono text-xs" title={row.id}>
                            {shortId(row.id)}
                          </span>
                        ),
                      },
                    ]}
                    actions={
                      <AdminActions columns={1}>
                        <label className="block text-sm font-semibold text-slate-700">
                          Match booking
                          <input
                            type="text"
                            placeholder="Booking UUID"
                            value={preTripMatchIds[row.id] ?? row.matched_booking_id ?? ''}
                            onChange={(e) =>
                              setPreTripMatchIds((prev) => ({ ...prev, [row.id]: e.target.value }))
                            }
                            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          />
                        </label>
                        {(row.groupon_code || row.email) ? (
                          <button
                            type="button"
                            disabled={preTripSuggestionsLoading === row.id}
                            onClick={() => void loadPreTripSuggestions(row.id)}
                            className="rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-900 disabled:opacity-50"
                          >
                            {preTripSuggestionsLoading === row.id ? 'Finding matches…' : 'Suggest matches'}
                          </button>
                        ) : null}
                        {(preTripSuggestions[row.id] || []).length > 0 ? (
                          <ul className="space-y-1">
                            {preTripSuggestions[row.id].map((s) => (
                              <li key={s.id}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPreTripMatchIds((prev) => ({ ...prev, [row.id]: s.id }))
                                  }
                                  className="w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-left text-xs text-emerald-900"
                                >
                                  <span className="font-semibold">{s.match_reason}</span>
                                  <br />
                                  {s.customer_name || 'Customer'} · {new Date(s.start_time).toLocaleDateString()}
                                  <br />
                                  <span className="font-mono" title={s.id}>{shortId(s.id)}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <textarea
                          placeholder="Admin notes"
                          rows={2}
                          value={preTripNotes[row.id] ?? row.admin_notes ?? ''}
                          onChange={(e) =>
                            setPreTripNotes((prev) => ({ ...prev, [row.id]: e.target.value }))
                          }
                          className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            disabled={preTripActionBusy === row.id}
                            onClick={() => void runPreTripAdminAction(row.id, 'match')}
                            className="rounded-lg bg-cyan-700 px-2 py-2 text-sm font-semibold text-white disabled:opacity-40"
                          >
                            Match
                          </button>
                          <button
                            type="button"
                            disabled={preTripActionBusy === row.id}
                            onClick={() => void runPreTripAdminAction(row.id, 'approve')}
                            className="rounded-lg bg-green-600 px-2 py-2 text-sm font-semibold text-white disabled:opacity-40"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={preTripActionBusy === row.id}
                            onClick={() => void runPreTripAdminAction(row.id, 'reject')}
                            className="rounded-lg bg-red-600 px-2 py-2 text-sm font-semibold text-white disabled:opacity-40"
                          >
                            Reject
                          </button>
                        </div>
                        {row.license_url ? (
                          <a href={row.license_url} target="_blank" rel="noopener noreferrer" className="text-center text-sm font-semibold text-blue-700 underline">
                            View license
                          </a>
                        ) : null}
                        {row.insurance_url ? (
                          <a href={row.insurance_url} target="_blank" rel="noopener noreferrer" className="text-center text-sm font-semibold text-blue-700 underline">
                            View insurance
                          </a>
                        ) : null}
                      </AdminActions>
                    }
                  />
                ))}
              </div>
            }
          />
        </div>

        <div className="rounded-xl bg-white shadow">
          <div className="border-b border-slate-200 p-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Unmatched Payments</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Payments, webhook failures, abandoned checkouts, and email failures that need staff attention.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void loadPaymentRecovery()}
                  disabled={paymentRecoveryLoading}
                  className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  Refresh payments
                </button>
                <button
                  type="button"
                  onClick={() => void loadBookingHealth()}
                  disabled={bookingHealthLoading}
                  className="rounded border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-900 hover:bg-cyan-100 disabled:opacity-50"
                >
                  Check health
                </button>
              </div>
            </div>

            {bookingHealth ? (
              <div
                className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
                  bookingHealth.ok
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : 'border-amber-200 bg-amber-50 text-amber-950'
                }`}
              >
                <div className="font-semibold">
                  Booking system health: {bookingHealth.ok ? 'Healthy' : 'Needs attention'}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {Object.entries(bookingHealth.checks || {}).map(([name, check]) => (
                    <span
                      key={name}
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        check.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
                      }`}
                      title={String(check.error || '')}
                    >
                      {name}: {check.ok ? 'OK' : 'Fail'}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {paymentRecoveryError ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {paymentRecoveryError}
              </div>
            ) : null}
          </div>

          <AdminResponsiveList
            desktop={
              <div className="overflow-x-auto">
                <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">
                    Customer
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">
                    Payment
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">
                    Trip
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">
                    Reason
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {paymentRecoveryLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                      Loading unmatched payments...
                    </td>
                  </tr>
                ) : paymentRecoveryItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                      No unmatched payments or failed booking jobs are currently open.
                    </td>
                  </tr>
                ) : (
                  paymentRecoveryItems.map((item) => {
                    const amount =
                      item.amount == null
                        ? 'Unknown'
                        : `$${Number(item.amount).toFixed(2)} ${String(item.currency || 'usd').toUpperCase()}`;
                    const stripeHref = item.checkout_session_id
                      ? `https://dashboard.stripe.com/payments?query=${encodeURIComponent(item.checkout_session_id)}`
                      : item.payment_intent_id
                        ? `https://dashboard.stripe.com/payments/${encodeURIComponent(item.payment_intent_id)}`
                        : '';
                    const logs = paymentRecoveryLogs[item.id];
                    return (
                      <tr key={item.id} className="align-top hover:bg-slate-50">
                        <td className="px-4 py-4">
                          <div className="font-semibold text-slate-900">{item.customer_name || 'Unknown customer'}</div>
                          <div className="text-sm text-slate-600">{item.customer_email || 'No email'}</div>
                          {item.customer_phone ? <div className="text-xs text-slate-500">{item.customer_phone}</div> : null}
                        </td>
                        <td className="px-4 py-4">
                          <div className="font-semibold text-slate-900">{amount}</div>
                          <div
                            className="mt-1 max-w-[16rem] font-mono text-[11px] text-slate-500"
                            title={item.checkout_session_id || item.payment_intent_id || undefined}
                          >
                            {shortId(item.checkout_session_id || item.payment_intent_id || 'No Stripe id', 14)}
                          </div>
                          <span className="mt-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold capitalize text-amber-900">
                            {humanizeLabel(item.status)}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-700">
                          <div>{item.boats?.name || item.trip_type || 'Trip details unavailable'}</div>
                          {item.start_time ? <div>{new Date(item.start_time).toLocaleString()}</div> : null}
                          {item.booking_id ? <div className="mt-1 font-mono text-[11px]" title={item.booking_id}>{shortId(item.booking_id)}</div> : null}
                        </td>
                        <td className="px-4 py-4">
                          <div className="text-sm font-semibold capitalize text-slate-900">
                            {item.reason.replace(/_/g, ' ')}
                          </div>
                          <div className="mt-1 max-w-sm text-xs text-slate-600">
                            {item.error || 'No error message recorded.'}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Retries: {item.retry_count}
                            {item.next_retry_at ? ` · Next: ${new Date(item.next_retry_at).toLocaleString()}` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={paymentRecoveryBusyId === item.id}
                              onClick={() => void runPaymentRecoveryAction(item.id, 'retry')}
                              className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Retry booking
                            </button>
                            <button
                              type="button"
                              disabled={paymentRecoveryBusyId === item.id || !item.payment_intent_id}
                              onClick={() => void runPaymentRecoveryAction(item.id, 'refund')}
                              className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              Refund
                            </button>
                            {item.customer_email ? (
                              <a
                                href={`mailto:${item.customer_email}?subject=${encodeURIComponent('Launch Zone booking follow-up')}`}
                                className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                              >
                                Contact
                              </a>
                            ) : null}
                            {stripeHref ? (
                              <a
                                href={stripeHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-900 hover:bg-indigo-100"
                              >
                                Stripe
                              </a>
                            ) : null}
                            <button
                              type="button"
                              disabled={paymentRecoveryBusyId === item.id}
                              onClick={() => void loadPaymentRecoveryLogs(item.id)}
                              className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                            >
                              View logs
                            </button>
                            <button
                              type="button"
                              disabled={paymentRecoveryBusyId === item.id}
                              onClick={() => void runPaymentRecoveryAction(item.id, 'ignore')}
                              className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                            >
                              Ignore
                            </button>
                          </div>
                          {logs ? (
                            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                              <div className="font-semibold">Recent logs</div>
                              {(logs.webhooks || []).slice(0, 3).map((log) => (
                                <div key={log.event_id} className="mt-1">
                                  {log.event_type} · {log.processing_status}
                                  {log.error ? ` · ${log.error}` : ''}
                                </div>
                              ))}
                              {(logs.activity || []).slice(0, 3).map((log) => (
                                <div key={log.id} className="mt-1">
                                  {log.event_type}
                                  {log.message ? ` · ${log.message}` : ''}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
              </div>
            }

            mobile={
              <div className="space-y-3 p-3">
                {paymentRecoveryLoading ? (
                  <p className="py-6 text-center text-sm text-slate-500">Loading unmatched payments...</p>
                ) : null}
                {!paymentRecoveryLoading && paymentRecoveryItems.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">
                    No unmatched payments or failed booking jobs are currently open.
                  </p>
                ) : null}
                {paymentRecoveryItems.map((item) => {
                  const amount =
                    item.amount == null
                      ? 'Unknown'
                      : `$${Number(item.amount).toFixed(2)} ${String(item.currency || 'usd').toUpperCase()}`;
                  const stripeHref = item.checkout_session_id
                    ? `https://dashboard.stripe.com/payments?query=${encodeURIComponent(item.checkout_session_id)}`
                    : item.payment_intent_id
                      ? `https://dashboard.stripe.com/payments/${encodeURIComponent(item.payment_intent_id)}`
                      : '';
                  const logs = paymentRecoveryLogs[item.id];
                  return (
                    <MobileAdminCard
                      key={`pay-m-${item.id}`}
                      title={item.customer_name || 'Unknown customer'}
                      subtitle={item.customer_email || 'No email'}
                      badge={
                        <StatusBadge tone="warning">{humanizeLabel(item.status)}</StatusBadge>
                      }
                      fields={[
                        { label: 'Amount', value: <span className="font-semibold">{amount}</span> },
                        {
                          label: 'Stripe',
                          value: (
                            <span
                              className="font-mono text-xs"
                              title={item.checkout_session_id || item.payment_intent_id || undefined}
                            >
                              {shortId(item.checkout_session_id || item.payment_intent_id || '—', 14)}
                            </span>
                          ),
                        },
                        {
                          label: 'Trip',
                          value: item.boats?.name || item.trip_type || 'Unavailable',
                        },
                        {
                          label: 'When',
                          value: item.start_time ? new Date(item.start_time).toLocaleString() : '—',
                          hideIfEmpty: true,
                        },
                        { label: 'Reason', value: humanizeLabel(item.reason) },
                        {
                          label: 'Error',
                          value: item.error || 'No error message recorded.',
                        },
                      ]}
                      actions={
                        <AdminActions>
                          <button
                            type="button"
                            disabled={paymentRecoveryBusyId === item.id}
                            onClick={() => void runPaymentRecoveryAction(item.id, 'retry')}
                            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            Retry booking
                          </button>
                          <button
                            type="button"
                            disabled={paymentRecoveryBusyId === item.id || !item.payment_intent_id}
                            onClick={() => void runPaymentRecoveryAction(item.id, 'refund')}
                            className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            Refund
                          </button>
                          <button
                            type="button"
                            disabled={paymentRecoveryBusyId === item.id}
                            onClick={() => void loadPaymentRecoveryLogs(item.id)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50"
                          >
                            View logs
                          </button>
                          <button
                            type="button"
                            disabled={paymentRecoveryBusyId === item.id}
                            onClick={() => void runPaymentRecoveryAction(item.id, 'ignore')}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600 disabled:opacity-50"
                          >
                            Ignore
                          </button>
                          {stripeHref ? (
                            <a
                              href={stripeHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-sm font-semibold text-slate-800 sm:col-span-2"
                            >
                              Open Stripe
                            </a>
                          ) : null}
                          {item.customer_email ? (
                            <a
                              href={`mailto:${item.customer_email}`}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-sm font-semibold text-slate-800 sm:col-span-2"
                            >
                              Email customer
                            </a>
                          ) : null}
                          {logs ? (
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 sm:col-span-2">
                              <div className="font-semibold">Recent logs</div>
                              {(logs.webhooks || []).slice(0, 3).map((log) => (
                                <div key={log.event_id} className="mt-1">
                                  {log.event_type} · {log.processing_status}
                                  {log.error ? ` · ${log.error}` : ''}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </AdminActions>
                      }
                    />
                  );
                })}
              </div>
            }
          />
        </div>

        <div className="relative rounded-xl bg-white shadow">
          {tableLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/60">
              <div className="text-sm font-semibold text-slate-600">Updating…</div>
            </div>
          )}
          <div className="border-b border-slate-200 p-6">
            <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <h2 className="text-2xl font-bold text-slate-900">Bookings</h2>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="flex flex-col text-sm font-medium text-slate-700">
                  Status
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                    className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    <option value="all">All</option>
                    <option value="pending">Pending</option>
                    <option value="pending_verification">Pending verification</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="ready_for_departure">Ready for departure</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </label>
                <label className="flex w-full flex-col text-sm font-medium text-slate-700 sm:min-w-[240px] sm:w-auto">
                  Search by email
                  <input
                    type="search"
                    value={emailSearch}
                    onChange={(e) => setEmailSearch(e.target.value)}
                    placeholder="customer@email.com"
                    className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </label>
              </div>
            </div>
            <p className="text-sm text-slate-500">
              Showing {bookings.length} of {totalCount} matching · Page {currentPage} / {totalPages}. Use{' '}
              <span className="font-medium text-slate-700">Cancel booking</span> to stop a trip while keeping the
              record; <span className="font-medium text-slate-700">Delete</span> only removes unpaid draft bookings.
            </p>
          </div>
          <AdminResponsiveList
            desktop={
              <div className="overflow-x-auto">
                <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-600">
                    Customer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-600">
                    Boat
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-600">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-600">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-600">
                    Waiver
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-600">
                    License
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-600">
                    Insurance status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-600">
                    Buoy
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-600">
                    Docs
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-600">
                    Incidents
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-600">
                    Total
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {bookings.map((booking) => {
                  const buoy = buoyVerificationRow(booking.user_verifications);
                  const canApproveReject =
                    booking.status === 'pending' || booking.status === 'pending_verification';
                  const stripePid = booking.stripe_payment_id;
                  const hasStripePayment = stripePid != null && String(stripePid).trim() !== '';
                  const payStatus = String(booking.payment_status || 'pending');
                  const canDeleteBooking =
                    canApproveReject && !hasStripePayment && payStatus !== 'deposit_paid';
                  const canCancelBooking =
                    booking.status !== 'cancelled' && booking.status !== 'completed';
                  const licenseDocHref =
                    booking.license_url?.trim() || booking.customers?.id_document_url || '';
                  const insuranceDocHref =
                    booking.insurance_url?.trim() || booking.customers?.insurance_proof_url || '';
                  const insuranceProofHref =
                    insuranceDocHref || buoy?.buoy_proof_url?.trim() || '';
                  const insuranceEmojiStatus = insuranceComplianceEmojiLabel(booking.insurance_status);
                  return (
                  <tr
                    key={booking.id}
                    className="transition-colors hover:bg-slate-100"
                  >
                    <td className="px-6 py-4">
                      <div>
                        <div className="font-semibold text-slate-900">
                          {booking.customers?.full_name}
                        </div>
                        <div className="text-sm text-slate-600">{booking.customers?.email}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-900">{booking.boats?.name}</td>
                    <td className="px-6 py-4 text-slate-900">
                      {new Date(booking.start_time).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusBadgeClass(
                          booking.status
                        )}`}
                      >
                        {booking.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-800">
                      {booking.waiver_signed === true ||
                      (Array.isArray(booking.waivers) && booking.waivers.length > 0) ? (
                        <span className="font-semibold text-green-700">Yes</span>
                      ) : (
                        <span className="text-slate-500">No</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${docStatusBadgeClass(
                            String(booking.license_status || 'pending')
                          )}`}
                        >
                          {booking.license_status || 'pending'}
                        </span>
                        <select
                          value={(booking.license_status as DocStatus) || 'pending'}
                          onChange={(e) =>
                            handleDocStatusUpdate(booking.id, 'license_status', e.target.value as DocStatus)
                          }
                          className="max-w-[9rem] rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                          aria-label="License verification status"
                        >
                          <option value="pending">Pending</option>
                          <option value="verified">Verified</option>
                          <option value="rejected">Rejected</option>
                        </select>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-slate-800">
                          <span aria-hidden>{insuranceEmojiStatus.emoji}</span> {insuranceEmojiStatus.text}
                        </span>
                        <span
                          className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${docStatusBadgeClass(
                            String(booking.insurance_status || 'pending')
                          )}`}
                        >
                          {booking.insurance_status || 'pending'}
                        </span>
                        <select
                          value={(booking.insurance_status as DocStatus) || 'pending'}
                          onChange={(e) =>
                            handleDocStatusUpdate(
                              booking.id,
                              'insurance_status',
                              e.target.value as DocStatus
                            )
                          }
                          className="max-w-[9rem] rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                          aria-label="Insurance verification status"
                        >
                          <option value="pending">Pending</option>
                          <option value="submitted">Submitted</option>
                          <option value="verified">Verified</option>
                          <option value="rejected">Rejected</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => void handleVerifyInsurance(booking.id)}
                          className="w-fit rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          Verify Insurance
                        </button>
                        <p className="max-w-[14rem] text-[10px] leading-snug text-slate-600">
                          {insuranceStatusCaption(booking.insurance_status, Boolean(insuranceProofHref))}
                        </p>
                        {insuranceProofHref ? (
                          <a
                            href={insuranceProofHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-800"
                          >
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            View insurance file
                          </a>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex min-w-[10rem] flex-col gap-2">
                        <span
                          className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${docStatusBadgeClass(
                            String(buoy?.buoy_status || 'pending')
                          )}`}
                        >
                          {buoy?.buoy_proof_url ? buoy.buoy_status || 'pending' : 'N/A'}
                        </span>
                        <a
                          href={buoy?.buoy_proof_url || '#'}
                          target="_blank"
                          rel="noreferrer"
                          className={`inline-flex items-center gap-1 text-xs font-semibold ${
                            buoy?.buoy_proof_url
                              ? 'text-amber-700 hover:text-amber-800'
                              : 'pointer-events-none text-slate-400'
                          }`}
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          View Buoy proof
                        </a>
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            disabled={!buoy?.buoy_proof_url}
                            onClick={() => handleBuoyStatusUpdate(booking.id, 'verified')}
                            className="rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-40 hover:bg-green-700"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={!buoy?.buoy_proof_url}
                            onClick={() => handleBuoyStatusUpdate(booking.id, 'rejected')}
                            className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-40 hover:bg-red-700"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-2">
                        <div
                          className="flex flex-col gap-0.5"
                          aria-label="License document upload"
                        >
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            License
                          </span>
                          {licenseDocHref ? (
                            <a
                              href={licenseDocHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Click to view uploaded document"
                              className="inline-flex w-fit items-center rounded px-2 py-1 text-sm font-semibold bg-green-100 text-green-700 hover:underline"
                            >
                              ✅ View
                            </a>
                          ) : (
                            <span
                              className="inline-flex w-fit items-center rounded px-2 py-1 text-sm font-semibold bg-red-100 text-red-700"
                              role="status"
                            >
                              ❌ Missing
                            </span>
                          )}
                        </div>
                        <div
                          className="flex flex-col gap-0.5"
                          aria-label="Insurance document upload"
                        >
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            Insurance
                          </span>
                          {insuranceProofHref ? (
                            <a
                              href={insuranceProofHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Click to view uploaded document"
                              className="inline-flex w-fit items-center rounded px-2 py-1 text-sm font-semibold bg-green-100 text-green-700 hover:underline"
                            >
                              ✅ View
                            </a>
                          ) : (
                            <span
                              className="inline-flex w-fit items-center rounded px-2 py-1 text-sm font-semibold bg-red-100 text-red-700"
                              role="status"
                            >
                              ❌ Missing
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        type="button"
                        onClick={() => setSelectedIncidentBookingId(booking.id)}
                        className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                      >
                        {incidentCounts[booking.id] ?? 0}
                      </button>
                    </td>
                    <td className="px-6 py-4 font-semibold text-slate-900">
                      <div>${parseFloat(String(booking.total_price)).toFixed(2)}</div>
                      {booking.promo_code ? (
                        <div className="mt-1 text-xs font-medium text-emerald-700">
                          {booking.promo_code}
                          {booking.discount_amount != null
                            ? ` · −$${parseFloat(String(booking.discount_amount)).toFixed(2)}`
                            : ''}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/admin/bookings/${booking.id}`}
                          className="rounded bg-slate-900 px-3 py-1 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                        >
                          Details
                        </Link>
                        <button
                          type="button"
                          disabled={!canApproveReject || tableLoading}
                          onClick={() => void handleApprove(booking.id)}
                          className="rounded bg-green-600 px-3 py-1 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={tableLoading}
                          onClick={() => void copyWaiversLink(booking.id)}
                          className="rounded border border-cyan-300 bg-cyan-50 px-3 py-1 text-sm font-semibold text-cyan-900 transition-colors hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
                          title="Copy /waivers-insurance?bookingId= link for this customer"
                        >
                          Copy waivers link
                        </button>
                        <button
                          type="button"
                          disabled={booking.status !== 'confirmed' || tableLoading}
                          onClick={() => void handleReadyForDeparture(booking.id)}
                          className="rounded bg-cyan-700 px-3 py-1 text-sm font-semibold text-white transition-colors hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Ready for departure
                        </button>
                        <button
                          type="button"
                          disabled={!canCancelBooking || tableLoading}
                          onClick={() => void handleCancelBooking(booking.id)}
                          title="Stop the booking without removing the record (use instead of Delete for paid or confirmed trips)"
                          className="rounded border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Cancel booking
                        </button>
                        <button
                          type="button"
                          disabled={!canDeleteBooking || tableLoading}
                          onClick={() => void handleDelete(booking.id)}
                          className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-3 py-1 text-sm font-medium text-red-800 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                          title={
                            canDeleteBooking
                              ? 'Delete booking'
                              : 'Delete only for pending / pending_verification without payment or deposit paid'
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
                })}
              </tbody>
            </table>
              </div>
            }

            mobile={
              <div className="space-y-3 p-3">
                {bookings.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">No bookings on this page.</p>
                ) : null}
                {bookings.map((booking) => {
                  const canApproveReject =
                    booking.status === 'pending' || booking.status === 'pending_verification';
                  const stripePid = booking.stripe_payment_id;
                  const hasStripePayment = stripePid != null && String(stripePid).trim() !== '';
                  const payStatus = String(booking.payment_status || 'pending');
                  const canDeleteBooking =
                    canApproveReject && !hasStripePayment && payStatus !== 'deposit_paid';
                  const canCancelBooking =
                    booking.status !== 'cancelled' && booking.status !== 'completed';
                  const licenseDocHref =
                    booking.license_url?.trim() || booking.customers?.id_document_url || '';
                  const insuranceDocHref =
                    booking.insurance_url?.trim() || booking.customers?.insurance_proof_url || '';
                  const buoy = buoyVerificationRow(booking.user_verifications);
                  const insuranceProofHref =
                    insuranceDocHref || buoy?.buoy_proof_url?.trim() || '';
                  const waiverDone =
                    booking.waiver_signed === true ||
                    (Array.isArray(booking.waivers) && booking.waivers.length > 0);
                  return (
                    <MobileAdminCard
                      key={`m-${booking.id}`}
                      title={booking.customers?.full_name || 'Customer'}
                      subtitle={booking.customers?.email || undefined}
                      badge={
                        <StatusBadge
                          tone={
                            booking.status === 'cancelled'
                              ? 'danger'
                              : booking.status === 'confirmed' || booking.status === 'ready_for_departure'
                                ? 'success'
                                : 'warning'
                          }
                        >
                          {humanizeLabel(booking.status)}
                        </StatusBadge>
                      }
                      fields={[
                        { label: 'Boat', value: booking.boats?.name || '—' },
                        {
                          label: 'Date',
                          value: new Date(booking.start_time).toLocaleDateString(),
                        },
                        {
                          label: 'Total',
                          value: (
                            <span className="font-semibold">
                              ${parseFloat(String(booking.total_price)).toFixed(2)}
                            </span>
                          ),
                        },
                        {
                          label: 'Waiver',
                          value: waiverDone ? (
                            <span className="font-semibold text-green-700">Yes</span>
                          ) : (
                            <span className="text-slate-500">No</span>
                          ),
                        },
                        {
                          label: 'License',
                          value: humanizeLabel(String(booking.license_status || 'pending')),
                        },
                        {
                          label: 'Insurance',
                          value: humanizeLabel(String(booking.insurance_status || 'pending')),
                        },
                        {
                          label: 'Docs',
                          value: `L: ${licenseDocHref ? 'Yes' : 'No'} · I: ${insuranceProofHref ? 'Yes' : 'No'}`,
                        },
                        {
                          label: 'Ref',
                          value: (
                            <span className="font-mono text-xs" title={booking.id}>
                              {shortId(booking.id)}
                            </span>
                          ),
                        },
                      ]}
                      actions={
                        <AdminActions>
                          <Link
                            to={`/admin/bookings/${booking.id}`}
                            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
                          >
                            Details
                          </Link>
                          <button
                            type="button"
                            disabled={!canApproveReject || tableLoading}
                            onClick={() => void handleApprove(booking.id)}
                            className="rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={tableLoading}
                            onClick={() => void copyWaiversLink(booking.id)}
                            className="rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-900 disabled:opacity-40"
                          >
                            Copy waivers link
                          </button>
                          <button
                            type="button"
                            disabled={booking.status !== 'confirmed' || tableLoading}
                            onClick={() => void handleReadyForDeparture(booking.id)}
                            className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
                          >
                            Ready for departure
                          </button>
                          <button
                            type="button"
                            disabled={!canCancelBooking || tableLoading}
                            onClick={() => void handleCancelBooking(booking.id)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-40"
                          >
                            Cancel booking
                          </button>
                          <button
                            type="button"
                            disabled={!canDeleteBooking || tableLoading}
                            onClick={() => void handleDelete(booking.id)}
                            className="inline-flex items-center justify-center gap-1 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedIncidentBookingId(booking.id)}
                            className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 sm:col-span-2"
                          >
                            Incidents ({incidentCounts[booking.id] ?? 0})
                          </button>
                        </AdminActions>
                      }
                    />
                  );
                })}
              </div>
            }
          />

          <div className="flex flex-col items-center justify-between gap-4 border-t border-slate-200 px-6 py-4 sm:flex-row">
            <button
              type="button"
              disabled={page <= 0 || tableLoading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
            <span className="text-sm text-slate-600">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages - 1 || tableLoading}
              onClick={() => setPage((p) => p + 1)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow">
          <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4">
            <h2 className="text-lg font-bold text-slate-900">Incidents</h2>
            <p className="mt-1 text-sm text-slate-600">
              Create and manage booking incidents without changing booking, payment, or legal workflow.
            </p>
          </div>
          <div className="space-y-5 px-5 py-5">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">Create Incident</h3>
              <p className="mt-1 text-xs text-slate-500">
                Attach a new incident to a booking and optionally upload a supporting photo.
              </p>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <label className="block text-sm font-medium text-gray-700">
                  <span className="font-medium text-gray-700">Booking</span>
                  <select
                    value={selectedIncidentBookingId}
                    onChange={(e) => setSelectedIncidentBookingId(e.target.value)}
                    className="mt-1 h-11 w-full rounded-lg border border-gray-300 bg-white px-4 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    {bookings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {(b.customers?.email || 'Unknown customer').slice(0, 60)} - #{b.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-gray-700 lg:col-span-2">
                  <span className="font-medium text-gray-700">Description</span>
                  <input
                    type="text"
                    value={incidentDescription}
                    onChange={(e) => setIncidentDescription(e.target.value)}
                    placeholder="Describe damage or issue"
                    className="mt-1 h-11 w-full rounded-lg border border-gray-300 bg-white px-4 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </label>
              </div>
              {selectedIncidentBooking ? (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  Incident will be attached to booking #{selectedIncidentBooking.id.slice(0, 8)} for{' '}
                  {selectedIncidentBooking.customers?.email || 'Unknown customer'} on{' '}
                  {new Date(selectedIncidentBooking.start_time).toLocaleDateString()}.
                </div>
              ) : null}
              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <label className="block text-sm font-medium text-gray-700">
                  <span className="font-medium text-gray-700">Upload image (optional)</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setIncidentFile(e.target.files?.[0] || null)}
                    className="mt-1 block h-11 w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 shadow-sm file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-2.5 file:py-1.5 file:text-xs file:font-semibold file:text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleCreateIncident()}
                  disabled={incidentSubmitting || !selectedIncidentBookingId || !incidentDescription.trim()}
                  className="h-11 rounded-lg bg-orange-600 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                >
                  {incidentSubmitting ? 'Creating...' : 'Create Incident'}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">Existing Incidents</h3>
              </div>
              {incidentsLoading ? (
                <p className="px-4 py-5 text-sm text-slate-500">Loading incidents...</p>
              ) : bookingIncidents.length === 0 ? (
                <p className="px-4 py-5 text-sm text-slate-500">No incidents for this booking.</p>
              ) : (
                <div className="space-y-6 p-4">
                  <section>
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-sm font-bold uppercase tracking-wide text-slate-700">Open Incidents</h4>
                      <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                        {openIncidents.length}
                      </span>
                    </div>
                    {openIncidents.length === 0 ? (
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                        No open incidents.
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {openIncidents.map((inc) => {
                          const draft = incidentEditDrafts[inc.id] || {
                            status: String(inc.status || 'pending'),
                            estimated_cost:
                              inc.estimated_cost == null || Number.isNaN(Number(inc.estimated_cost))
                                ? ''
                                : String(inc.estimated_cost),
                            actual_cost:
                              inc.actual_cost == null || Number.isNaN(Number(inc.actual_cost))
                                ? ''
                                : String(inc.actual_cost),
                            admin_notes: String(inc.admin_notes || ''),
                          };
                          return (
                            <article key={inc.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                <div className="min-w-0">
                                  <p className="truncate text-base font-semibold text-slate-900">{inc.description}</p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {new Date(inc.created_at).toLocaleString(undefined, {
                                      dateStyle: 'medium',
                                      timeStyle: 'short',
                                    })}
                                  </p>
                                </div>
                                <span
                                  className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${incidentStatusBadgeClass(
                                    draft.status
                                  )}`}
                                >
                                  {draft.status}
                                </span>
                              </div>
                              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(180px,220px)_1fr_1fr_auto] lg:items-end">
                                <label className="block text-sm font-medium text-gray-700">
                                  <span className="font-medium text-gray-700">Status</span>
                                  <select
                                    value={draft.status}
                                    onChange={(e) => handleIncidentDraftChange(inc.id, 'status', e.target.value)}
                                    className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-4 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 disabled:bg-gray-100 disabled:text-gray-400"
                                  >
                                    <option value="pending">pending</option>
                                    <option value="approved">approved</option>
                                    <option value="charged">charged</option>
                                    <option value="disputed">disputed</option>
                                  </select>
                                </label>
                                <label className="block text-sm font-medium text-gray-700">
                                  <span className="font-medium text-gray-700">Estimated Cost</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={draft.estimated_cost}
                                    onChange={(e) => handleIncidentDraftChange(inc.id, 'estimated_cost', e.target.value)}
                                    placeholder="0.00"
                                    className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-4 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 disabled:bg-gray-100 disabled:text-gray-400"
                                  />
                                </label>
                                <label className="block text-sm font-medium text-gray-700">
                                  <span className="font-medium text-gray-700">Actual Cost</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={draft.actual_cost}
                                    onChange={(e) => handleIncidentDraftChange(inc.id, 'actual_cost', e.target.value)}
                                    placeholder="0.00"
                                    className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-4 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 disabled:bg-gray-100 disabled:text-gray-400"
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => void handleSaveIncident(inc.id)}
                                  disabled={editingIncidentId === inc.id}
                                  className="rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-orange-700 disabled:bg-gray-100 disabled:text-gray-400"
                                >
                                  {editingIncidentId === inc.id ? 'Saving...' : 'Save'}
                                </button>
                              </div>
                              <label className="mt-4 block text-sm font-medium text-gray-700">
                                <span className="font-medium text-gray-700">Admin Notes</span>
                                <textarea
                                  value={draft.admin_notes}
                                  onChange={(e) => handleIncidentDraftChange(inc.id, 'admin_notes', e.target.value)}
                                  placeholder="Add internal notes for follow-up, customer communication, or charges."
                                  rows={3}
                                  className="mt-1 min-h-[100px] w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 disabled:bg-gray-100 disabled:text-gray-400"
                                />
                              </label>
                              {Array.isArray(inc.photos) && inc.photos.length > 0 ? (
                                <div className="mt-4">
                                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Photos</p>
                                  <div className="flex flex-wrap gap-3">
                                    {inc.photos.map((photo, idx) => {
                                      const filePath = String(photo.file_path || '').trim();
                                      const { data } = supabase.storage.from('incident-photos').getPublicUrl(filePath);
                                      const url = data?.publicUrl || '';
                                      const key = `${inc.id}-${idx}-${filePath}`;
                                      if (!url) return null;
                                      return (
                                        <a
                                          key={key}
                                          href={url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="group block h-24 w-24 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 md:h-28 md:w-28"
                                          title="Open full image"
                                        >
                                          {incidentImageFailures[key] ? (
                                            <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs font-medium text-slate-500">
                                              Image unavailable
                                            </div>
                                          ) : (
                                            <img
                                              src={url}
                                              alt={photo.file_name || 'Incident photo'}
                                              className="h-full w-full object-cover transition-transform group-hover:scale-105"
                                              loading="lazy"
                                              onError={() =>
                                                setIncidentImageFailures((prev) => ({ ...prev, [key]: true }))
                                              }
                                            />
                                          )}
                                        </a>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : null}
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <section>
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-sm font-bold uppercase tracking-wide text-slate-700">Past / Resolved Incidents</h4>
                      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {pastIncidents.length}
                      </span>
                    </div>
                    {pastIncidents.length === 0 ? (
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                        No past incidents.
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {pastIncidents.map((inc) => {
                          const draft = incidentEditDrafts[inc.id] || {
                            status: String(inc.status || 'pending'),
                            estimated_cost:
                              inc.estimated_cost == null || Number.isNaN(Number(inc.estimated_cost))
                                ? ''
                                : String(inc.estimated_cost),
                            actual_cost:
                              inc.actual_cost == null || Number.isNaN(Number(inc.actual_cost))
                                ? ''
                                : String(inc.actual_cost),
                            admin_notes: String(inc.admin_notes || ''),
                          };
                          const isExpanded = expandedResolvedIncidentId === inc.id;
                          const estimatedCostText =
                            inc.estimated_cost == null || Number.isNaN(Number(inc.estimated_cost))
                              ? '-'
                              : `$${Number(inc.estimated_cost).toFixed(2)}`;
                          const actualCostText =
                            inc.actual_cost == null || Number.isNaN(Number(inc.actual_cost))
                              ? '-'
                              : `$${Number(inc.actual_cost).toFixed(2)}`;
                          const photoCount = Array.isArray(inc.photos) ? inc.photos.length : 0;
                          return (
                            <article key={inc.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedResolvedIncidentId((current) => (current === inc.id ? null : inc.id))
                                }
                                className="w-full rounded-lg border border-transparent px-1 py-1 text-left transition-colors hover:border-slate-200 hover:bg-slate-50"
                                aria-expanded={isExpanded}
                              >
                                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                  <div className="min-w-0">
                                    <p className="truncate text-base font-semibold text-slate-900">{inc.description}</p>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {new Date(inc.created_at).toLocaleString(undefined, {
                                        dateStyle: 'medium',
                                        timeStyle: 'short',
                                      })}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                                    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                                      Est: {estimatedCostText}
                                    </span>
                                    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                                      Actual: {actualCostText}
                                    </span>
                                    {photoCount > 0 ? (
                                      <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                                        Photos: {photoCount}
                                      </span>
                                    ) : null}
                                    <span
                                      className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${incidentStatusBadgeClass(
                                        draft.status
                                      )}`}
                                    >
                                      {draft.status}
                                    </span>
                                    <span className="text-xs font-semibold text-amber-700">
                                      {isExpanded ? 'Hide Details' : 'View Details'}
                                    </span>
                                  </div>
                                </div>
                              </button>
                              {isExpanded ? (
                                <>
                                  <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(180px,220px)_1fr_1fr_auto] lg:items-end">
                                    <label className="block text-sm font-medium text-gray-700">
                                      <span className="font-medium text-gray-700">Status</span>
                                      <select
                                        value={draft.status}
                                        onChange={(e) => handleIncidentDraftChange(inc.id, 'status', e.target.value)}
                                        className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-4 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 disabled:bg-gray-100 disabled:text-gray-400"
                                      >
                                        <option value="pending">pending</option>
                                        <option value="approved">approved</option>
                                        <option value="charged">charged</option>
                                        <option value="disputed">disputed</option>
                                      </select>
                                    </label>
                                    <label className="block text-sm font-medium text-gray-700">
                                      <span className="font-medium text-gray-700">Estimated Cost</span>
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={draft.estimated_cost}
                                        onChange={(e) => handleIncidentDraftChange(inc.id, 'estimated_cost', e.target.value)}
                                        placeholder="0.00"
                                        className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-4 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 disabled:bg-gray-100 disabled:text-gray-400"
                                      />
                                    </label>
                                    <label className="block text-sm font-medium text-gray-700">
                                      <span className="font-medium text-gray-700">Actual Cost</span>
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={draft.actual_cost}
                                        onChange={(e) => handleIncidentDraftChange(inc.id, 'actual_cost', e.target.value)}
                                        placeholder="0.00"
                                        className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-4 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 disabled:bg-gray-100 disabled:text-gray-400"
                                      />
                                    </label>
                                    <button
                                      type="button"
                                      onClick={() => void handleSaveIncident(inc.id)}
                                      disabled={editingIncidentId === inc.id}
                                      className="rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-orange-700 disabled:bg-gray-100 disabled:text-gray-400"
                                    >
                                      {editingIncidentId === inc.id ? 'Saving...' : 'Save'}
                                    </button>
                                  </div>
                                  <label className="mt-4 block text-sm font-medium text-gray-700">
                                    <span className="font-medium text-gray-700">Admin Notes</span>
                                    <textarea
                                      value={draft.admin_notes}
                                      onChange={(e) => handleIncidentDraftChange(inc.id, 'admin_notes', e.target.value)}
                                      placeholder="Add internal notes for follow-up, customer communication, or charges."
                                      rows={3}
                                      className="mt-1 min-h-[100px] w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 disabled:bg-gray-100 disabled:text-gray-400"
                                    />
                                  </label>
                                  {Array.isArray(inc.photos) && inc.photos.length > 0 ? (
                                    <div className="mt-4">
                                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Photos</p>
                                      <div className="flex flex-wrap gap-3">
                                        {inc.photos.map((photo, idx) => {
                                          const filePath = String(photo.file_path || '').trim();
                                          const { data } = supabase.storage.from('incident-photos').getPublicUrl(filePath);
                                          const url = data?.publicUrl || '';
                                          const key = `${inc.id}-${idx}-${filePath}`;
                                          if (!url) return null;
                                          return (
                                            <a
                                              key={key}
                                              href={url}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="group block h-24 w-24 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 md:h-28 md:w-28"
                                              title="Open full image"
                                            >
                                              {incidentImageFailures[key] ? (
                                                <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs font-medium text-slate-500">
                                                  Image unavailable
                                                </div>
                                              ) : (
                                                <img
                                                  src={url}
                                                  alt={photo.file_name || 'Incident photo'}
                                                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                                                  loading="lazy"
                                                  onError={() =>
                                                    setIncidentImageFailures((prev) => ({ ...prev, [key]: true }))
                                                  }
                                                />
                                              )}
                                            </a>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ) : null}
                                </>
                              ) : null}
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
    </AdminShell>
  );
}


