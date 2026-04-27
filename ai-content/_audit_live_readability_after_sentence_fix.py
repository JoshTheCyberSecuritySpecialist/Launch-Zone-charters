from __future__ import annotations
import copy, io, json, re
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any

from rewrite import rewrite_pipeline_article
from _audit_rewrite_grounding_batch import FIXTURES

sample = FIXTURES[:10]


def readability_metrics(body: str) -> dict[str, Any]:
    sec_pat = re.compile(r"(?mis)^###\s+(.+?)\s*$")
    matches = list(sec_pat.finditer(body or ""))
    sections = []
    for i, m in enumerate(matches):
        st = m.end()
        en = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        sections.append((m.group(1).strip(), (body[st:en] or "").strip()))

    mid_sentence = False
    transition_clean = True
    broken_hits = 0
    for name, txt in sections:
        if name in ("What This Means For Your Trip", "Best Ways to Experience the Space Coast Safely"):
            if txt and re.match(r"^[a-z]", txt):
                mid_sentence = True
                broken_hits += 1
        if txt and re.search(r"\b(in|and|or|the)\s*$", txt):
            transition_clean = False
            broken_hits += 1

    if broken_hits == 0:
        flow = "clean"
        overall = "good"
    elif broken_hits == 1:
        flow = "minor issues"
        overall = "acceptable"
    else:
        flow = "broken"
        overall = "poor"

    return {
        "paragraph_flow": flow,
        "mid_sentence_starts": bool(mid_sentence),
        "section_transition_clean": bool(transition_clean),
        "overall_readability": overall,
        "broken_signal_count": broken_hits,
    }


rows: list[dict[str, Any]] = []
timeouts = 0
live_count = 0
fallback_count = 0

for spec in sample:
    article = {
        "title": spec["title"],
        "summary": spec["summary"],
        "content": spec.get("content") or "",
        "category": spec["category"],
        "keyword_topic": spec["keyword_topic"],
    }
    buf = io.StringIO()
    with redirect_stdout(buf):
        out = rewrite_pipeline_article(copy.deepcopy(article))
    logs = buf.getvalue()

    timeout = "Read timed out" in logs
    weak_fallback = "[AI] weak output" in logs
    used_fallback = timeout or weak_fallback
    if timeout:
        timeouts += 1
    if used_fallback:
        fallback_count += 1
    else:
        live_count += 1

    if out is None:
        rows.append({
            "fixture_id": spec["id"],
            "title": spec["title"],
            "path": "none",
            "timeout": timeout,
            "error": "rewrite_returned_none",
        })
        continue

    body = (out.get("content") or "").strip()
    metrics = readability_metrics(body)

    # regression vs expected fallback post-fix quality: fallback should not be broken now.
    regression = used_fallback and metrics["overall_readability"] == "poor"

    rows.append({
        "fixture_id": spec["id"],
        "title": (out.get("title") or spec["title"]),
        "path": "fallback" if used_fallback else "live",
        "timeout": timeout,
        "paragraph_flow": metrics["paragraph_flow"],
        "mid_sentence_starts": metrics["mid_sentence_starts"],
        "section_transition_clean": metrics["section_transition_clean"],
        "overall_readability": metrics["overall_readability"],
        "regression_vs_fallback_expectation": regression,
    })

summary = {
    "total": len(rows),
    "live_count": live_count,
    "fallback_count": fallback_count,
    "timeout_count": timeouts,
    "timeout_rate": round((timeouts / len(rows)) * 100, 1) if rows else 0,
    "good": sum(1 for r in rows if r.get("overall_readability") == "good"),
    "acceptable": sum(1 for r in rows if r.get("overall_readability") == "acceptable"),
    "poor": sum(1 for r in rows if r.get("overall_readability") == "poor"),
    "regressions": sum(1 for r in rows if r.get("regression_vs_fallback_expectation") is True),
}

report = {"summary": summary, "articles": rows}
Path("_audit_live_readability_after_sentence_fix.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False))
