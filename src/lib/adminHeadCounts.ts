import { supabase } from './supabase';
import { withTimeout } from './adminDiagnostics';

export type AdminSharedCounts = {
  unreadMessages: number;
  pendingBookings: number;
  pendingPreTrip: number;
  fetchedAt: number;
};

const TTL_MS = 45_000;

let cached: AdminSharedCounts | null = null;
let inflight: Promise<AdminSharedCounts> | null = null;

/** Head-count queries shared by ops dashboard and bookings hub (deduped + short TTL cache). */
export async function fetchAdminSharedCounts(options?: {
  force?: boolean;
}): Promise<AdminSharedCounts> {
  const force = options?.force ?? false;
  const now = Date.now();

  if (!force && cached && now - cached.fetchedAt < TTL_MS) {
    return cached;
  }
  if (!force && inflight) {
    return inflight;
  }

  inflight = (async () => {
    try {
      const [unread, pendingBookings, pendingPreTrip] = await withTimeout(
        'Admin shared counts',
        Promise.all([
          supabase
            .from('contact_messages')
            .select('*', { count: 'exact', head: true })
            .eq('is_read', false),
          supabase
            .from('bookings')
            .select('*', { count: 'exact', head: true })
            .in('status', ['pending', 'pending_verification']),
          supabase
            .from('pre_trip_submissions')
            .select('*', { count: 'exact', head: true })
            .eq('admin_status', 'pending'),
        ]),
        12000
      );

      cached = {
        unreadMessages: unread.count ?? 0,
        pendingBookings: pendingBookings.count ?? 0,
        pendingPreTrip: pendingPreTrip.count ?? 0,
        fetchedAt: Date.now(),
      };
      return cached;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function invalidateAdminSharedCounts() {
  cached = null;
}
