import { useCallback, useEffect, useState } from 'react';
import { fetchAdminSharedCounts } from '../../lib/adminHeadCounts';

export type AdminQuickCounts = {
  unreadMessages: number;
  pendingApprovals: number;
};

const EMPTY: AdminQuickCounts = {
  unreadMessages: 0,
  pendingApprovals: 0,
};

/** Lightweight head-count queries for dashboard badges (uses shared cache). */
export function useAdminQuickCounts(enabled: boolean) {
  const [counts, setCounts] = useState<AdminQuickCounts>(EMPTY);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (force = false) => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const shared = await fetchAdminSharedCounts({ force });
      setCounts({
        unreadMessages: shared.unreadMessages,
        pendingApprovals: shared.pendingBookings + shared.pendingPreTrip,
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
