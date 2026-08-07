/** Allowed values must match server ALLOWED_SORT / ALLOWED_FILTER. */
export type OpsDashboardSort = 'trip_date' | 'recently_booked' | 'customer_name';

export type OpsDashboardFilter =
  | ''
  | 'today'
  | 'tomorrow'
  | 'week'
  | 'weekend'
  | 'new'
  | 'conflict'
  | 'missing_boat'
  | 'missing_captain'
  | 'direct'
  | 'groupon'
  | 'staff';

export type OpsDashboardQueryParams = {
  sort?: OpsDashboardSort;
  filter?: OpsDashboardFilter | string;
};

/** Builds path + query for GET /api/admin/operations-dashboard (no host). */
export function buildOperationsDashboardPath(query?: OpsDashboardQueryParams): string {
  const params = new URLSearchParams();
  if (query?.sort) params.set('sort', query.sort);
  const filter = query?.filter != null ? String(query.filter).trim() : '';
  if (filter) params.set('filter', filter);
  const qs = params.toString();
  return `/api/admin/operations-dashboard${qs ? `?${qs}` : ''}`;
}

export function normalizeOpsFilterFromApi(value: string | null | undefined): OpsDashboardFilter {
  if (value == null || String(value).trim() === '') return '';
  return String(value).trim() as OpsDashboardFilter;
}

export function normalizeOpsSortFromApi(value: string | null | undefined): OpsDashboardSort {
  const v = String(value || 'trip_date').trim() as OpsDashboardSort;
  if (v === 'recently_booked' || v === 'customer_name') return v;
  return 'trip_date';
}
