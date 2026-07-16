import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { withTimeout } from '../../lib/adminDiagnostics';

export type AdminQuickCounts = {
  unreadMessages: number;
  pendingApprovals: number;
};

const EMPTY: AdminQuickCounts = {
  unreadMessages: 0,
  pendingApprovals: 0,
};

/** Lightweight head-count queries for dashboard badges. */
export function useAdminQuickCounts(enabled: boolean) {
  const [counts, setCounts] = useState<AdminQuickCounts>(EMPTY);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [unread, pendingBookings, pendingPreTrip] = await withTimeout(
        'Admin quick counts',
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

      setCounts({
        unreadMessages: unread.count ?? 0,
        pendingApprovals: (pendingBookings.count ?? 0) + (pendingPreTrip.count ?? 0),
      });
    } catch {
      setCounts(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { counts, countsLoading: loading, reloadCounts: reload };
}
