from __future__ import annotations
import copy, io, json, re, sys
from contextlib import redirect_stdout
from config import OLLAMA_TEMPERATURE, OLLAMA_TOP_P, PIPELINE_SEO_HUB_MODE
from grounding import validate_rewritten_article
import rewrite
from rewrite import _pipeline_source_blob, rewrite_pipeline_article
from _audit_rewrite_grounding_batch import FIXTURES

rewrite._ollama_stream_generate = lambda _prompt: ""

def has_qna(body: str) -> bool:
    return bool(re.search(r"^###\\s*Questions\\s+Readers\\s+Ask\\b", body, re.I | re.M))

rows = []
meta = {
    "mode": "simulated_weak_model_forced_fallback",
    "OLLAMA_TEMPERATURE": OLLAMA_TEMPERATURE,
    "OLLAMA_TOP_P": OLLAMA_TOP_P,
    "PIPELINE_SEO_HUB_MODE": PIPELINE_SEO_HUB_MODE,
}
for spec in FIXTURES:
    art = {
        "title": spec["title"], "summary": spec["summary"], "content": spec.get("content") or "",
        "category": spec["category"], "keyword_topic": spec["keyword_topic"],
    }
    blob = _pipeline_source_blob(art)
    buf = io.StringIO()
    with redirect_stdout(buf):
        out = rewrite_pipeline_article(copy.deepcopy(art))
    if not out:
        rows.append({"fixture_id": spec["id"], "source_title": spec["title"], "error": "rewrite_returned_none"})
        continue
    title = (out.get("title") or "").strip()
    body = (out.get("content") or "").strip()
    gm = out.get("_grounding_meta") or {}
    ok_q, reason_q, meta_direct = validate_rewritten_article(blob, title, body)
    rows.append({
        "fixture_id": spec["id"],
        "source_title": spec["title"],
        "source_fact_summary": (spec["summary"] + " " + (spec.get("content") or ""))[:500].strip(),
        "rewritten_title": title,
        "rewritten_body": body,
        "optional_qna_present": has_qna(body),
        "grounding_from_article_meta": gm,
        "validate_rewritten_article_direct": {"ok": ok_q, "reason": reason_q, **meta_direct},
        "used_grounding_fallback": bool(gm.get("fallback")),
    })

print(json.dumps({"audit_meta": meta, "count": len(rows)}, ensure_ascii=False))
for r in rows:
    print(json.dumps(r, ensure_ascii=False))
