from __future__ import annotations

import copy
import io
import json
import re
from contextlib import redirect_stdout
from typing import Any

from grounding import validate_rewritten_article
from rewrite import _pipeline_source_blob, rewrite_pipeline_article

FIXTURES: list[dict[str, Any]] = [
    {
        "id": "thin_source",
        "category": "Boating Tips",
        "keyword_topic": "boat rentals Port Orange Florida",
        "title": "Coast Guard suspends search off Canaveral",
        "summary": "Breaking: search suspended pending daylight; no further details.",
        "content": "",
    },
    {
        "id": "launch",
        "category": "Launch Updates",
        "keyword_topic": "rocket launches Titusville Florida",
        "title": "Falcon 9 launch window set for Cape Canaveral tonight",
        "summary": "Range opens at 9:12 p.m.; weather watch says 60% go with cloud concerns. Titusville waterfront expected to fill early.",
        "content": "Officials said no backup window was listed in this advisory. Traffic controls may be used near riverfront access roads if demand spikes.",
    },
    {
        "id": "marine_conditions",
        "category": "Boating Tips",
        "keyword_topic": "boat rentals Port Orange Florida",
        "title": "Small craft advisory for Volusia nearshore waters",
        "summary": "NWS calls for west winds 15 to 20 knots and seas 3 to 5 feet through late day.",
        "content": "Forecasters noted advisory may extend if the gradient holds. Mariners should monitor updated marine statements.",
    },
    {
        "id": "bio_glow",
        "category": "Water Adventures",
        "keyword_topic": "bioluminescence tours Florida lagoon",
        "title": "Dinoflagellate bloom reported near Titusville lagoon waters",
        "summary": "Researchers observed elevated dinoflagellates in evening samples; no health advisory was attached.",
        "content": "Field notes mention changing visibility and tide effects during sampling. No rule changes were announced.",
    },
]

BANNED_PATTERNS = [
    r"\(20\d{2}\)",
    r"What Boat Renters Need to Know",
    r"Titusville\s*&\s*Space Coast",
    r"^###\s*Questions\s+Readers\s+Ask\b",
]


def analyze(article: dict[str, Any]) -> dict[str, Any]:
    blob = _pipeline_source_blob(article)
    cap = io.StringIO()
    with redirect_stdout(cap):
        out = rewrite_pipeline_article(copy.deepcopy(article))
    logs = cap.getvalue()

    if out is None:
        return {
            "error": "rewrite_returned_none",
            "logs": logs[-1200:],
        }

    title = (out.get("title") or "").strip()
    body = (out.get("content") or "").strip()
    ok, reason, meta = validate_rewritten_article(blob, title, body)

    fallback_used = "[AI] weak output" in logs or "grounding_fallback" in logs
    ollama_timeout = "Read timed out" in logs
    ollama_responded = (not fallback_used) and (not ollama_timeout)

    banned_hits: list[str] = []
    scan_text = f"{title}\n{body}"
    for pat in BANNED_PATTERNS:
        if re.search(pat, scan_text, re.I | re.M):
            banned_hits.append(pat)

    path_used = "live" if ollama_responded else "fallback"

    return {
        "path_used": path_used,
        "ollama_response_received": ollama_responded,
        "fallback_used": fallback_used,
        "fallback_trigger_reason": "timeout" if ollama_timeout else ("weak_output" if fallback_used else "none"),
        "grounding_ok": ok,
        "grounding_reason": reason,
        "grounding_meta": meta,
        "banned_pattern_hits": banned_hits,
        "title": title,
        "body_preview": body[:500],
        "log_tail": logs[-800:],
    }


def main() -> None:
    rows = []
    for f in FIXTURES:
        art = {
            "title": f["title"],
            "summary": f["summary"],
            "content": f.get("content") or "",
            "category": f["category"],
            "keyword_topic": f["keyword_topic"],
        }
        result = analyze(art)
        result["fixture_id"] = f["id"]
        rows.append(result)

    live = [r for r in rows if r.get("path_used") == "live"]
    fb = [r for r in rows if r.get("path_used") == "fallback"]

    print(json.dumps({
        "summary": {
            "total": len(rows),
            "live_count": len(live),
            "fallback_count": len(fb),
            "live_grounding_pass": sum(1 for r in live if r.get("grounding_ok")),
            "fallback_grounding_pass": sum(1 for r in fb if r.get("grounding_ok")),
            "live_banned_hits": sum(1 for r in live if r.get("banned_pattern_hits")),
            "fallback_banned_hits": sum(1 for r in fb if r.get("banned_pattern_hits")),
        }
    }, ensure_ascii=False))
    for r in rows:
        print(json.dumps(r, ensure_ascii=False))


if __name__ == "__main__":
    main()
