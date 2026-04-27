#!/usr/bin/env python3
"""
Cron / Task Scheduler entry: run the Captain's Log upload pipeline once.

Delegates to upload.run_pipeline() only — use `python upload.py` as the canonical CLI.

Requires (best-effort): SUPABASE_*, CAPTAINS_LOG_IMAGE_BUCKET, UNSPLASH optional, Ollama optional.
"""

from __future__ import annotations

import logging
import sys

from upload import run_pipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("run_daily")


def main() -> None:
    try:
        stats = run_pipeline()
        log.info(
            "Daily run finished — processed=%s inserted=%s insert_failed=%s errors=%s",
            stats.get("processed"),
            stats.get("inserted"),
            stats.get("insert_failed", 0),
            stats.get("errors"),
        )
    except Exception:
        log.exception("Daily run: unexpected exception (upload should not raise)")
    sys.exit(0)


if __name__ == "__main__":
    main()
