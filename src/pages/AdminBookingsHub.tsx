import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileCheck2,
  Mail,
  PlusCircle,
  Ship,
  Tag,
  Inbox,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import AdminDashboardCard from '../components/admin/AdminDashboardCard';
import { withTimeout } from '../lib/adminDiagnostics';

type HubCounts = {
  pendingApprovals: number;
  unreadMessages: number;
  pendingPreTrip: number;
  activePromos: number;
  openPaymentRecovery: number;
};

const EMPTY_COUNTS: HubCounts = {
  pendingApprovals: 0,
  unreadMessages: 0,
  pendingPreTrip: 0,
  activePromos: 0,
  openPaymentRecovery: 0,
};

function statusLine(count: number, singular: string, plural: string, empty: string) {
  if (count <= 0) return empty;
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function AdminBookingsHub() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [counts, setCounts] = useState<HubCounts>(EMPTY_COUNTS);
  const [countsLoading, setCountsLoading] = useState(true);
  const [countsError, setCountsError] = useState<string | null>(null);

  const loadCounts = useCallback(async () => {
    setCountsLoading(true);
    setCountsError(null);
    try {
      const [
        pendingApprovals,
        unreadMessages,
        pendingPreTrip,
        activePromos,
        openPaymentRecovery,
      ] = await withTimeout(
        'Admin hub counts',
        Promise.all([
          supabase
            .from('bookings')
            .select('*', { count: 'exact', head: true })
            .in('status', ['pending', 'pending_verification']),
          supabase
            .from('contact_messages')
            .select('*', { count: 'exact', head: true })
            .eq('is_read', false),
          supabase
            .from('pre_trip_submissions')
            .select('*', { count: 'exact', head: true })
            .eq('admin_status', 'pending'),
          supabase
            .from('promo_codes')
            .select('*', { count: 'exact', head: true })
            .eq('active', true),
          supabase
            .from('payment_recovery_queue')
            .select('*', { count: 'exact', head: true })
            .in('status', ['open', 'retrying']),
        ]),
        15000
      );

      setCounts({
        pendingApprovals: pendingApprovals.error ? 0 : pendingApprovals.count ?? 0,
        unreadMessages: unreadMessages.error ? 0 : unreadMessages.count ?? 0,
        pendingPreTrip: pendingPreTrip.error ? 0 : pendingPreTrip.count ?? 0,
        // Promo list is API-managed; count may be blocked by RLS — treat as optional.
        activePromos: activePromos.error ? 0 : activePromos.count ?? 0,
        openPaymentRecovery: openPaymentRecovery.error
          ? 0
          : openPaymentRecovery.count ?? 0,
      });

      const criticalError =
        pendingApprovals.error || unreadMessages.error || pendingPreTrip.error;
      if (criticalError) {
        setCountsError(criticalError.message || 'Some counts could not load.');
      }
    } catch (err) {
      setCountsError(err instanceof Error ? err.message : 'Could not load dashboard counts.');
      setCounts(EMPTY_COUNTS);
    } finally {
      setCountsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void loadCounts();
  }, [isAdmin, loadCounts]);

  if (authLoading) {
    return <FullPageLoader message="Checking admin access…" />;
  }

  if (!isAdmin) {
    return <AdminAccessDenied signedIn={Boolean(user)} />;
  }

  const approvalsTotal = counts.pendingApprovals + counts.pendingPreTrip;

  return (
    <AdminShell
      title="Bookings Hub"
      subtitle="Choose a tool — each opens its own page."
      actions={
        <button
          type="button"
          onClick={() => void loadCounts()}
          disabled={countsLoading}
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50"
        >
          {countsLoading ? 'Refreshing…' : 'Refresh counts'}
        </button>
      }
    >
      {countsError ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
          {countsError}{' '}
          <button type="button" className="underline" onClick={() => void loadCounts()}>
            Retry
          </button>
        </div>
      ) : null}

      <p className="mb-4 text-base text-slate-600">
        Day-of ops stay on the{' '}
        <Link to="/admin" className="font-bold text-amber-800 underline">
          Dashboard
        </Link>
        . This hub is for bookings tools.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <AdminDashboardCard
          to="/admin/approvals"
          title="Pending Approvals"
          description="Bookings and pre-trip items waiting for review."
          icon={<FileCheck2 className="h-6 w-6" />}
          status={statusLine(approvalsTotal, 'item needs review', 'items need review', 'All clear')}
          highlight={approvalsTotal > 0}
        />
        <AdminDashboardCard
          to="/admin/calendar"
          title="Calendar"
          description="See and manage the trip schedule."
          icon={<CalendarDays className="h-6 w-6" />}
          status="Open calendar"
        />
        <AdminDashboardCard
          to="/admin/staff-booking"
          title="Create Booking"
          description="Book a trip for a customer as staff."
          icon={<PlusCircle className="h-6 w-6" />}
          status="New staff booking"
        />
        <AdminDashboardCard
          to="/admin/messages"
          title="Customer Messages"
          description="Inbox from the public contact form."
          icon={<Mail className="h-6 w-6" />}
          status={statusLine(counts.unreadMessages, 'unread message', 'unread messages', 'No unread')}
          highlight={counts.unreadMessages > 0}
        />
        <AdminDashboardCard
          to="/admin/pre-trip"
          title="Pre-Trip Submissions"
          description="Match and approve customer pre-trip packets."
          icon={<ClipboardList className="h-6 w-6" />}
          status={statusLine(counts.pendingPreTrip, 'pending', 'pending', 'None pending')}
          highlight={counts.pendingPreTrip > 0}
        />
        <AdminDashboardCard
          to="/admin/bookings/list"
          title="All Bookings"
          description="Search, filter, and open every reservation."
          icon={<Ship className="h-6 w-6" />}
          status={statusLine(counts.pendingApprovals, 'pending booking', 'pending bookings', 'Open list')}
        />
        <AdminDashboardCard
          to="/admin/promo-codes"
          title="Promo Codes"
          description="Create and manage checkout discounts."
          icon={<Tag className="h-6 w-6" />}
          status={statusLine(counts.activePromos, 'active code', 'active codes', 'No active codes')}
        />
        <AdminDashboardCard
          to="/admin/captains-log"
          title="Captain's Log"
          description="Articles, subscribers, and alert tools."
          icon={<BookOpen className="h-6 w-6" />}
          status="Manage content"
        />
        <AdminDashboardCard
          to="/admin/outbox"
          title="Communications Outbox"
          description="Sent email and SMS history."
          icon={<Inbox className="h-6 w-6" />}
          status="View outbox"
        />
        <AdminDashboardCard
          to="/admin/disputes"
          title="Disputes"
          description="Stripe disputes and evidence."
          icon={<AlertTriangle className="h-6 w-6" />}
          status="Open disputes"
        />
        <AdminDashboardCard
          to="/admin/bookings/list#payment-recovery"
          title="Payment Recovery"
          description="Unmatched payments and failed booking jobs."
          icon={<AlertTriangle className="h-6 w-6" />}
          status={statusLine(
            counts.openPaymentRecovery,
            'open item',
            'open items',
            'None open'
          )}
          highlight={counts.openPaymentRecovery > 0}
        />
      </div>
    </AdminShell>
  );
}
