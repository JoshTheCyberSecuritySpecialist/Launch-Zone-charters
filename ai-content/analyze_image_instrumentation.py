#!/usr/bin/env python3
"""
Parse stdout logs from pipeline runs with PIPELINE_IMAGE_INSTRUMENTATION=1.

Usage:
  python upload.py 2>&1 | python analyze_image_instrumentation.py
  python analyze_image_instrumentation.py path/to/pipeline.log
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


def _loads(line: str) -> dict[str, Any] | None:
    line = line.strip()
    if not line or not line.startswith("{"):
        return None
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return None


def main() -> None:
    paths = sys.argv[1:]
    if paths:
        lines: list[str] = []
        for p in paths:
            lines.extend(Path(p).read_text(encoding="utf-8", errors="replace").splitlines())
    else:
        lines = sys.stdin.read().splitlines()

    candidates: list[dict[str, Any]] = []
    summaries: list[dict[str, Any]] = []

    for line in lines:
        o = _loads(line)
        if not o:
            continue
        ev = o.get("event")
        if ev == "image_candidate":
            candidates.append(o)
        elif ev == "image_article_summary":
            summaries.append(o)

    # Group by article_id
    by_aid_c = defaultdict(list)
    by_aid_s = defaultdict(list)
    for c in candidates:
        by_aid_c[str(c.get("article_id", ""))].append(c)
    for s in summaries:
        by_aid_s[str(s.get("article_id", ""))].append(s)

    # --- Selection distribution (from image_article_summary — prefer process_image_strict stage)
    src_counts = Counter()
    tier_counts = Counter()
    for s in summaries:
        extra = s.get("extra") or {}
        if extra.get("pipeline_stage") == "process_image_strict":
            src = (s.get("selected_source") or "none").strip()
            src_counts[src] += 1
            t = s.get("tier")
            if t is not None:
                tier_counts[f"tier_{t}"] += 1

    # Fallback: any summary if no pipeline_stage
    if not src_counts:
        for s in summaries:
            src = (s.get("selected_source") or "none").strip()
            src_counts[src] += 1
            t = s.get("tier")
            if t is not None:
                tier_counts[f"tier_{t}"] += 1

    n_art = max(sum(src_counts.values()), 1)

    # One winning candidate per article_id (last selected row wins if duplicates)
    sel_by_aid: dict[str, dict[str, Any]] = {}
    for r in candidates:
        if not r.get("selected"):
            continue
        aid = str(r.get("article_id", ""))
        # last wins if duplicate
        sel_by_aid[aid] = r

    og_wins = twitter_wins = img_wins = unsplash_wins = 0
    for aid, r in sel_by_aid.items():
        src = (r.get("source") or "").lower()
        rs = (r.get("reason_selected") or "").lower()
        if src == "og" or rs == "og_preferred":
            og_wins += 1
        elif src == "twitter" or rs == "twitter_preferred":
            twitter_wins += 1
        elif src == "unsplash" or "unsplash" in rs:
            unsplash_wins += 1
        else:
            img_wins += 1

    n_sel = len(sel_by_aid)

    # Failure patterns
    reason_ct = Counter()
    validate_failed = 0
    logo_true_selected = 0
    logo_true_any = 0
    small_true = 0
    for c in candidates:
        rs = str(c.get("reason_selected") or "")
        reason_ct[rs] += 1
        if rs == "validate_failed":
            validate_failed += 1
        if c.get("is_logo_like"):
            logo_true_any += 1
            if c.get("selected"):
                logo_true_selected += 1
        if c.get("is_small"):
            small_true += 1

    # Scores
    scores_true: list[float] = []
    scores_false: list[float] = []
    for c in candidates:
        fs = c.get("final_score")
        if fs is None:
            continue
        try:
            fv = float(fs)
        except (TypeError, ValueError):
            continue
        if c.get("selected"):
            scores_true.append(fv)
        else:
            scores_false.append(fv)

    # Better candidate not selected: heuristic using max false score vs selected score per article
    better_missed: list[dict[str, Any]] = []
    for aid, rows in by_aid_c.items():
        selected_rows = [x for x in rows if x.get("selected")]
        if not selected_rows:
            continue
        try:
            sel_score = float(selected_rows[-1].get("final_score", -1e9))
        except (TypeError, ValueError):
            continue
        for x in rows:
            if x.get("selected"):
                continue
            try:
                fs = float(x.get("final_score", -1e9))
            except (TypeError, ValueError):
                continue
            if fs == -1:
                continue
            if fs > sel_score + 0.01:
                better_missed.append(
                    {
                        "article_id": aid,
                        "selected_score": sel_score,
                        "better_score": fs,
                        "better_source": x.get("source"),
                        "better_reason": x.get("reason_selected"),
                    }
                )
                break

    out: dict[str, Any] = {
        "articles_with_candidates": len(by_aid_c),
        "articles_with_summaries": len(by_aid_s),
        "total_image_candidate_lines": len(candidates),
        "total_image_article_summary_lines": len(summaries),
        "selection_from_summaries_process_strict": dict(src_counts),
        "approx_pct_from_selected_candidates": {
            "og": round(100 * og_wins / n_sel, 1) if n_sel else 0.0,
            "twitter": round(100 * twitter_wins / n_sel, 1) if n_sel else 0.0,
            "img_scraped": round(100 * img_wins / n_sel, 1) if n_sel else 0.0,
            "unsplash": round(100 * unsplash_wins / n_sel, 1) if n_sel else 0.0,
            "n_selected_rows_used": n_sel,
        },
        "unsplash_tier_from_summaries": dict(tier_counts),
        "reason_selected_counts": dict(reason_ct),
        "validate_failed_lines": validate_failed,
        "is_logo_like_any_candidate": logo_true_any,
        "is_logo_like_selected": logo_true_selected,
        "is_small_any_candidate": small_true,
        "final_score_selected_count": len(scores_true),
        "final_score_not_selected_count": len(scores_false),
        "final_score_selected_avg": round(sum(scores_true) / len(scores_true), 2) if scores_true else None,
        "final_score_not_selected_avg": round(sum(scores_false) / len(scores_false), 2) if scores_false else None,
        "better_score_than_selected_cases": len(better_missed),
        "better_score_examples": better_missed[:12],
    }

    print(json.dumps({"stage": "image_instrumentation_analysis", **out}, ensure_ascii=False, indent=2))

    # Human-readable block
    print("\n--- Summary ---\n")
    print(f"Candidate log lines: {len(candidates)} | Summary log lines: {len(summaries)}")
    if not candidates and not summaries:
        print(
            "No instrumentation events found. Run with PIPELINE_IMAGE_INSTRUMENTATION=1 "
            "and capture stdout (e.g. python upload.py 2>&1 | tee run.log)."
        )
        return

    print("\nSelection (from summaries, selected_source):")
    for k, v in sorted(src_counts.items(), key=lambda x: -x[1]):
        print(f"  {k}: {v} ({round(100 * v / n_art, 1)}%)")

    print("\nApprox. winning source (from selected image_candidate rows):")
    print(f"  og: {og_wins}  twitter: {twitter_wins}  img/scraped: {img_wins}  unsplash: {unsplash_wins}")

    print("\nTop reason_selected:")
    for k, v in reason_ct.most_common(15):
        print(f"  {k}: {v}")

    print("\nScores: selected avg =", out["final_score_selected_avg"], "| not selected avg =", out["final_score_not_selected_avg"])

    print("\nHeuristic 'higher score not picked' cases:", len(better_missed))
    for b in better_missed[:8]:
        print(" ", b)

    # Phase 3 suggestion (rule-based, not weights)
    print("\n--- Phase 3 hint (data-driven placeholder) ---")
    if not better_missed:
        print("No obvious 'better score missed' pairs in this sample (or scores not comparable).")
    else:
        print("Review examples above — if consistent, consider override when max(candidate score) >> selected score.")
    if tier_counts.get("tier_3", 0) > tier_counts.get("tier_1", 0) and tier_counts.get("tier_3", 0) > 0:
        print("Tier 3 Unsplash appears frequent vs tier 1 — consider stricter Unsplash gating after confirming in logs.")
    if logo_true_selected > 0:
        print(f"Warning: {logo_true_selected} selected row(s) flagged is_logo_like — review penalties / OG override.")


if __name__ == "__main__":
    main()
