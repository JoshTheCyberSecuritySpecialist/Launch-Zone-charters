"""
Run-scoped counters for end-of-pipeline logging only (no behavior changes elsewhere).
Reset at the start of each `run_pipeline()` invocation.
"""

from __future__ import annotations

from typing import Any

_counts: dict[str, int] = {
    "timeout_errors": 0,
    "unsplash_429": 0,
}


def reset_pipeline_metrics() -> None:
    _counts["timeout_errors"] = 0
    _counts["unsplash_429"] = 0


def record_timeout_error() -> None:
    _counts["timeout_errors"] += 1


def record_unsplash_429() -> None:
    _counts["unsplash_429"] += 1


def record_if_requests_timeout(exc: BaseException) -> None:
    """Increment timeout counter when `exc` is a requests timeout (or chained cause)."""
    try:
        from requests.exceptions import Timeout as RequestsTimeout
    except ImportError:
        return
    cur: BaseException | None = exc
    while cur is not None:
        if isinstance(cur, RequestsTimeout):
            record_timeout_error()
            return
        cur = getattr(cur, "__cause__", None) or getattr(cur, "__context__", None)


def get_pipeline_metrics() -> dict[str, int]:
    return dict(_counts)


def pipeline_summary_log_payload(stats: dict[str, Any]) -> dict[str, int]:
    """Single object for stdout: matches monitoring fields + existing skip counters."""
    m = get_pipeline_metrics()
    return {
        "processed": int(stats.get("processed", 0)),
        "inserted": int(stats.get("inserted", 0)),
        "skipped_image": int(stats.get("skipped_image", 0)),
        "skipped_recent": int(stats.get("skipped_recent", 0)),
        "skipped_validation": int(stats.get("skipped_validation", 0)),
        "timeout_errors": m["timeout_errors"],
        "unsplash_429": m["unsplash_429"],
    }
