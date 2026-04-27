/**
 * Click / interaction timing for UX audits only.
 * Enable: dev server, `?perf=1`, or `VITE_CLICK_PERF=1` in env.
 * Does not change app behavior — logging is no-op when disabled.
 */

export type ClickPerfSeverity = 'ok' | 'noticeable' | 'slow' | 'unacceptable';

export interface ClickPerfPayload {
  action: string;
  /** performance.now() at pointer interaction */
  startTime: number;
  /** Time until synchronous handler finished (setState scheduled, etc.) */
  syncHandlerMs?: number;
  /** Approx. time until paint after sync work (double rAF — not a spec, useful for UX) */
  uiResponseMs?: number;
  /** Click → first line before fetch() */
  clickToNetworkStartMs?: number;
  /** fetch start → response settled (or thrown) */
  networkDurationMs?: number;
  /** Click → handler / flow completion */
  totalMs?: number;
  severity?: ClickPerfSeverity;
  note?: string;
  /** Marker for filtering console / future beacon */
  _clickPerf?: true;
}

export function isClickPerfEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  if (import.meta.env.VITE_CLICK_PERF === '1') return true;
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).has('perf');
  } catch {
    return false;
  }
}

export function severityForMs(ms: number): ClickPerfSeverity {
  if (ms > 1000) return 'unacceptable';
  if (ms > 300) return 'slow';
  if (ms > 100) return 'noticeable';
  return 'ok';
}

export function logClickPerf(payload: ClickPerfPayload): void {
  if (!isClickPerfEnabled()) return;
  const total =
    payload.totalMs ??
    payload.uiResponseMs ??
    payload.syncHandlerMs ??
    payload.networkDurationMs ??
    0;
  const severity = payload.severity ?? severityForMs(total);
  const line: ClickPerfPayload & { _clickPerf: true; severity: ClickPerfSeverity } = {
    ...payload,
    severity,
    _clickPerf: true,
  };
  if (severity === 'unacceptable' || severity === 'slow') {
    console.warn('[click-perf]', line);
  } else {
    console.info('[click-perf]', line);
  }
}

/** After sync work, estimate time until next paint (two animation frames). */
export function measurePaintAfterSync(action: string, clickStart: number, afterSync: number): void {
  if (!isClickPerfEnabled()) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const afterPaint = performance.now();
      const uiResponseMs = afterPaint - clickStart;
      logClickPerf({
        action,
        startTime: clickStart,
        syncHandlerMs: afterSync - clickStart,
        uiResponseMs,
        totalMs: uiResponseMs,
        severity: severityForMs(uiResponseMs),
        note: 'sync_click_post_paint',
      });
    });
  });
}

/** Wrap a synchronous click handler (state updates). */
export function wrapSyncClick(action: string, handler: () => void): () => void {
  return () => {
    const t0 = performance.now();
    handler();
    const t1 = performance.now();
    measurePaintAfterSync(action, t0, t1);
  };
}

/** Safe segment for action names (page keys, slugs, hash paths). */
export function perfActionSegment(id: string): string {
  return id.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'action';
}

/**
 * `onNavigate(pageKey)` with paint timing — use for Header/Footer/Home CTAs.
 * @param prefix - e.g. `footer`, `home`, `pricing`
 */
export function wrapNavigateClick(
  prefix: string,
  pageKey: string,
  onNavigate: (page: string) => void
): () => void {
  return wrapSyncClick(`${prefix}_nav_${perfActionSegment(pageKey)}`, () => onNavigate(pageKey));
}

/**
 * `react-router` `navigate(to)` (supports hash paths).
 */
export function wrapRouterNavigate(
  prefix: string,
  actionId: string,
  navigate: (to: string) => void,
  to: string
): () => void {
  return wrapSyncClick(`${prefix}_route_${perfActionSegment(actionId)}`, () => navigate(to));
}

export interface AsyncInteractionHandle {
  markNetworkStart: () => void;
  end: (note: string, extra?: Partial<ClickPerfPayload>) => void;
}

/**
 * Long-running interaction (e.g. checkout). Call markNetworkStart() immediately before fetch().
 * Call end() once when the flow finishes (success, error, or early exit after work started).
 */
export function beginAsyncInteraction(action: string): AsyncInteractionHandle {
  if (!isClickPerfEnabled()) {
    return {
      markNetworkStart: () => {},
      end: () => {},
    };
  }
  const start = performance.now();
  let networkAt: number | undefined;
  return {
    markNetworkStart() {
      if (networkAt === undefined) networkAt = performance.now();
    },
    end(note, extra) {
      const endT = performance.now();
      const totalMs = endT - start;
      logClickPerf({
        action,
        startTime: start,
        clickToNetworkStartMs: networkAt != null ? networkAt - start : undefined,
        networkDurationMs: networkAt != null ? endT - networkAt : undefined,
        totalMs,
        severity: severityForMs(totalMs),
        note,
        ...extra,
      });
    },
  };
}
