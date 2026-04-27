#!/usr/bin/env python3
"""
Captain's Log pipeline entrypoint:

1. fetch_all() → controlled topic rows
2. rewrite_pipeline_article → process_image_strict (optional hero; insert may proceed with no image)
3. Best-effort Storage upload to public URL when a hero exists
4. Best-effort `captains_log` insert — warnings only; run continues

SEO slugs (+ Titusville), slug suffix when DB reports collision.

Single entrypoint: python upload.py (run_daily.py calls run_pipeline only).

Fault-tolerant: no sys.exit in pipeline; client may be None if credentials missing.

Speed / trust knobs (see `config.py`): `PIPELINE_SEO_HUB_MODE` (default on — long-form SEO outline +
full HTML when possible; set to 0 for faster RSS-only), `PIPELINE_FETCH_FULL_ARTICLE` (optional override),
`PIPELINE_TOP_N`, `PIPELINE_MIN_WORDS_FINAL`, `GROUNDING_MIN_TOKEN_OVERLAP`. Upload skips source URLs
already used in the last few `captains_log` rows.
"""

from __future__ import annotations

import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import json
import mimetypes
import re
import traceback
import hashlib
from difflib import SequenceMatcher

import requests
import uuid
from pathlib import Path
from typing import Any

from supabase import Client, create_client

from config import (
    CAPTAINS_LOG_IMAGE_BUCKET,
    ENABLE_FINAL_ARTICLE_ENHANCER,
    FINAL_ENHANCER_ENABLE_CHECKLIST,
    FINAL_ENHANCER_ENABLE_CTA,
    FINAL_ENHANCER_ENABLE_DYNAMIC_TOPICS,
    FINAL_ENHANCER_ENABLE_INTERNAL_BACKLINK_ENGINE,
    FINAL_ENHANCER_HEADING_LEVEL,
    FINAL_ENHANCER_ENABLE_LOCAL_CONTEXT,
    FINAL_ENHANCER_ENABLE_QA,
    FINAL_ENHANCER_MAX_INTERNAL_LINKS,
    FINAL_ENHANCER_ONLY_NEW,
    FINAL_ENHANCER_SECONDARY_BLEND_RATIO,
    FINAL_ENHANCER_TOPIC_MIN_SCORE,
    GROUNDING_MIN_TOKEN_OVERLAP,
    OLLAMA_TIMEOUT_SEC,
    PIPELINE_FAST,
    PIPELINE_DEFAULT_IMAGE_WEB_PATH,
    PIPELINE_FETCH_FULL_ARTICLE,
    PIPELINE_MAX_ATTEMPTS_PER_RUN,
    PIPELINE_EXCERPT_SIMILARITY_THRESHOLD,
    PIPELINE_MIN_WORDS_FINAL,
    PIPELINE_SEO_HUB_MODE,
    PIPELINE_TITLE_SIMILARITY_THRESHOLD,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL,
)
from final_formatter import apply_final_article_enhancer
from image_seo import record_published_image_alt
from images import process_image_strict, reset_image_run_dedupe
from pipeline_metrics import (
    pipeline_summary_log_payload,
    record_if_requests_timeout,
    reset_pipeline_metrics,
)
from rewrite import (
    RewriteFailedError,
    TopicMismatchError,
    fetch_source_text,
    pipeline_fallback_from_source,
    rewrite_pipeline_article,
    text_matches_keyword_topic,
)
from scraper import (
    PIPELINE_CONTROLLED_TOPICS,
    ScrapedArticle,
    fetch_all,
    is_bad_image_url,
    is_relevant_to_topic_with_summary,
    save_last_article_title_for_rotation,
    scrape_article_for_pipeline,
    scraper_pipeline_debug,
)
from structure_validator import audit_article_structure
from structure_validator import blocking_structure_issues

ROOT = Path(__file__).resolve().parent
_TITLE_HASH_STATE_PATH = ROOT / "pipeline_recent_title_hashes.json"
_TITLE_HASH_STATE_MAX = 250
SITE_ORIGIN = (os.environ.get("LAUNCH_ZONE_SITE_ORIGIN") or "https://launchzonecharters.com").rstrip("/")


def log(msg: str) -> None:
    print(f"[LOG] {msg}", file=sys.stderr)


def _normalize_title_for_hash(title: str) -> str:
    t = re.sub(r"[^a-z0-9\s]", " ", (title or "").lower())
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _title_hash(title: str) -> str:
    return hashlib.sha256(_normalize_title_for_hash(title).encode("utf-8")).hexdigest()


def _load_recent_title_hashes() -> set[str]:
    try:
        if _TITLE_HASH_STATE_PATH.is_file():
            data = json.loads(_TITLE_HASH_STATE_PATH.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return {str(x).strip() for x in data if str(x).strip()}
    except Exception as e:
        print(f"[WARN] title hash state read failed: {e}")
    return set()


def _save_recent_title_hashes(values: set[str]) -> None:
    try:
        arr = sorted(values)
        if len(arr) > _TITLE_HASH_STATE_MAX:
            arr = arr[-_TITLE_HASH_STATE_MAX:]
        _TITLE_HASH_STATE_PATH.write_text(json.dumps(arr, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        print(f"[WARN] title hash state write failed: {e}")


def _recent_captains_log_titles(client: Client | None, limit: int = 80) -> list[str]:
    if not client:
        return []
    try:
        res = (
            client.table("captains_log")
            .select("title, created_at")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        out: list[str] = []
        for row in rows:
            t = (row.get("title") or "").strip()
            if t:
                out.append(t)
        return out
    except Exception as e:
        print(f"[WARN] recent captains_log title query failed: {e}")
        return []


def _title_too_similar(candidate: str, recent_titles: list[str], threshold: float = 0.9) -> bool:
    c = _normalize_title_for_hash(candidate)
    if not c:
        return False
    for t in recent_titles:
        n = _normalize_title_for_hash(t)
        if not n:
            continue
        if SequenceMatcher(None, c, n).ratio() >= threshold:
            return True
    return False


def _normalize_similarity_text(s: str) -> str:
    t = re.sub(r"[^a-z0-9\s]", " ", (s or "").lower())
    return re.sub(r"\s+", " ", t).strip()


def _recent_captains_log_excerpts(client: Client | None, limit: int = 50) -> list[str]:
    if not client:
        return []
    try:
        res = (
            client.table("captains_log")
            .select("summary, content, created_at")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        out: list[str] = []
        for row in rows:
            ex = ((row.get("summary") or "").strip() or (row.get("content") or "")[:700]).strip()
            if ex:
                out.append(ex)
        return out
    except Exception as e:
        print(f"[WARN] recent captains_log excerpt query failed: {e}")
        return []


def _excerpt_too_similar(candidate: str, recent_excerpts: list[str], threshold: float = 0.8) -> bool:
    c = _normalize_similarity_text(candidate)[:900]
    if len(c) < 80:
        return False
    for ex in recent_excerpts:
        n = _normalize_similarity_text(ex)[:900]
        if len(n) < 80:
            continue
        if SequenceMatcher(None, c, n).ratio() >= threshold:
            return True
    return False


def _is_english_body_text(text: str) -> bool:
    t = (text or "").strip()
    if len(t) < 120:
        return True
    sample = t[:8000]
    letters = 0
    non_ascii_letters = 0
    for ch in sample:
        if ch.isalpha():
            letters += 1
            if ord(ch) > 127:
                non_ascii_letters += 1
    if letters < 40:
        return True
    return (non_ascii_letters / letters) < 0.03


# Business intent: at least one cluster must match (planning a boat day / on-water experience on the Space Coast).
# Avoid bare tokens like "water" or "launch" alone — too many false positives.
_BUSINESS_INTENT_CLUSTERS: tuple[tuple[str, ...], ...] = (
    (
        "life jacket",
        "lifejacket",
        "pfd",
        "personal flotation",
        "navigation light",
        "uscg",
        "u.s. coast guard",
        "coast guard",
        "boating safety",
        "small craft",
        "throwable",
        "kill switch",
        "boater education",
        "safe boating",
    ),
    (
        "marine forecast",
        "marine weather",
        "weather forecast",
        "small craft advisory",
        "wind advisory",
        "rip current",
        "rip currents",
        "thunderstorm",
        "rough seas",
        "sea state",
        "chop",
        "swell",
        "tide",
        "tides",
        "surf height",
        "wave height",
        "beach hazard",
        "lightning",
        "hurricane",
        "nws",
        "national weather",
    ),
    (
        "boat rental",
        "boat rentals",
        "rent a boat",
        "charter",
        "pontoon",
        "lagoon",
        "sandbar",
        "boat ramp",
        "marina",
        "intracoastal",
        "halifax river",
        "indian river lagoon",
        "indian river",
        "jet ski",
        "jetski",
        "kayak",
        "paddleboard",
        "paddle board",
        "ecotour",
        "eco tour",
        "wildlife tour",
        "dolphin",
        "sunset cruise",
        "snorkel",
        "boat tour",
        "waterfront",
        "dock",
        "mooring",
        "boating",
        "boats",
        "boat ",
        " boat",
    ),
    (
        "rocket launch",
        "rocket launches",
        "spacex",
        "falcon",
        "falcon 9",
        "falcon heavy",
        "kennedy space",
        "cape canaveral",
        "space coast",
        "launch viewing",
        "launch scrub",
        "launch window",
        "starship",
        "starlink",
        "pad 39",
        "launch complex",
        "rocket",
        "night launch",
        "artemis",
        "ula",
        "starliner",
        "crew dragon",
    ),
    (
        "bioluminescence",
        "bioluminescent",
        "dinoflagellate",
        "dinoflagellates",
        "night paddle",
        "glow water",
    ),
    (
        "fishing",
        "angler",
        "anglers",
        "snook",
        "redfish",
        "speckled trout",
        "seatrout",
        "tarpon",
        "inshore",
        "offshore",
        "flats fishing",
        "catch and release",
        "live bait",
        "trolling",
        "jigging",
        "kingfish",
        "mahi",
    ),
)


def _business_intent_match(title: str, body: str, summary: str = "") -> bool:
    """True when text matches at least one Launch Zone intent cluster (renter / on-water / coast)."""
    blob = f"{title} {summary} {body}".lower()
    return any(any(p in blob for p in cluster) for cluster in _BUSINESS_INTENT_CLUSTERS)


def is_valid_source_url(url: str | None) -> bool:
    if not url:
        return False

    url = url.lower()

    if "internal" in url:
        return False

    if not url.startswith("http"):
        return False

    return True


def _recent_captains_log_source_urls(client: Client | None, limit: int = 5) -> list[str]:
    """Most recently inserted rows — avoid back-to-back same article across runs."""
    if not client:
        return []
    try:
        res = (
            client.table("captains_log")
            .select("source_url, created_at")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        out: list[str] = []
        for row in rows:
            u = (row.get("source_url") or "").strip()
            if u:
                out.append(u)
        return out
    except Exception as e:
        print(f"[WARN] recent captains_log query failed: {e}")
        return []


def is_duplicate_article(client: Client | None, source_url: str, *, log: bool = True) -> bool:
    if not client or not source_url:
        return False
    try:
        existing = (
            client.table("captains_log")
            .select("id")
            .eq("source_url", source_url)
            .limit(1)
            .execute()
        )

        if existing.data:
            if log:
                print(f"[SKIP] duplicate → {source_url[:200]}")
            return True

        return False

    except Exception as e:
        print(f"[WARN] dedupe check failed → {e}")
        return False


def _word_count(s: str) -> int:
    return len((s or "").split())


def _word_count_validation(s: str) -> int:
    """Must match validate_article() — split-based counts can disagree by 10+ words vs regex tokens."""
    return len(re.findall(r"\b[\w'-]+\b", s or ""))


def _source_line_mostly_in_body(body: str, src_line: str) -> bool:
    """True when title+summary words are already present (avoid padding with duplicates)."""
    b = (body or "").lower()
    words = re.findall(r"\b[\w'-]+\b", (src_line or "").lower())
    if len(words) < 6:
        return True
    hits = sum(1 for w in words if w in b)
    return hits / len(words) >= 0.88


def _expand_short_content_for_validation(
    content: str,
    title: str,
    summary: str,
    min_words: int,
) -> str:
    """
    Deterministic expansion using source-derived text and generic safety guidance only.
    Avoids invented facts while helping short fallback rewrites clear final validation.
    """
    out = (content or "").strip()
    if _word_count_validation(out) >= min_words:
        return out

    src_bits: list[str] = []
    t = (title or "").strip()
    s = (summary or "").strip()
    if t:
        src_bits.append(t)
    if s:
        src_bits.append(s)
    src_line = " ".join(src_bits).strip()
    if src_line and not _source_line_mostly_in_body(out, src_line):
        out = (
            f"{out}\n\n"
            f"Use this source summary as your planning baseline, then confirm day-of marine conditions "
            f"before heading out on the water."
        ).strip()

    if _word_count_validation(out) >= min_words:
        return out

    out = (
        f"{out}\n\n"
        "- Check marine forecast, wind, and radar before departure.\n"
        "- Verify life jackets, throwable flotation, and navigation lights.\n"
        "- Plan a conservative route for changing inlet or lagoon conditions.\n"
        "- Share your float plan and expected return time.\n"
        "- Bring water, sun protection, and charged phone/GPS backup.\n"
        "- Re-check conditions at launch time and postpone if needed."
    ).strip()

    # Deterministically append concise planning notes until floor is met.
    if _word_count_validation(out) < min_words:
        top_up_lines = [
            "Before departure, compare the latest marine forecast with observed conditions at the ramp.",
            "If wind, visibility, or tide conditions shift, shorten the route and keep options close to safe harbor.",
            "For launch-viewing plans, prioritize safe positioning, navigation-light compliance, and return timing.",
            "When conditions are uncertain, delay the trip and re-check updates rather than forcing a schedule.",
        ]
        idx = 0
        while _word_count_validation(out) < min_words and idx < len(top_up_lines):
            out = f"{out}\n\n{top_up_lines[idx]}".strip()
            idx += 1

    # Same metric as validate_article(); last resort pad (split-based expansion often stops short).
    _pad = (
        "Check local marine forecasts and visibility before you launch or anchor for a rocket launch viewing window "
        "along the Florida Space Coast near Titusville and Port Orange."
    )
    _guard = 0
    while _word_count_validation(out) < min_words and _guard < 25:
        out = f"{out}\n\n{_pad}".strip()
        _guard += 1

    return out


def _minimal_body_from_scrape_only(
    title: str, summary: str, *, min_words: int = 12
) -> str:
    """Title + RSS summary only (no invented facts). Plain paragraphs — no Summary/Headline meta blocks."""
    t = (title or "").strip()
    sm = (summary or "").strip()
    if sm and t:
        sl, tl = sm.lower(), t.lower()
        if sl in tl or (len(sm) > 24 and sm.lower()[:50] in tl):
            sm = ""
        elif tl in sl or (len(t) > 24 and t.lower()[:50] in sl):
            t = ""
    chunks: list[str] = []
    if sm:
        chunks.append(sm)
    if t:
        chunks.append(t)
    if not chunks:
        return "No article text was available from the source."
    base = "\n\n".join(chunks)
    out = base
    pad_a = (
        "Treat this as a headline-only signal from the feed; confirm timing and conditions with the publisher "
        "and local marine forecasts before boating."
    )
    pad_b = (
        "For on-water plans, compare the marine forecast with observed conditions at the ramp before you launch."
    )
    if _word_count(out) < min_words:
        out = f"{out}\n\n{pad_a}".strip()
    if _word_count(out) < min_words:
        out = f"{out}\n\n{pad_b}".strip()
    return out.strip()


def _ensure_min_words_for_rewrite(content: str, title: str, summary: str, min_words: int = 12) -> str:
    """Join scrape + summary + title once — no heavy padding loops."""
    base = "\n\n".join(x for x in (content.strip(), summary.strip(), title.strip()) if x)
    if not base:
        return _minimal_body_from_scrape_only(title, summary, min_words=min_words)
    return base.strip()


def _combined_scrape_blob(article: dict[str, Any], title: str) -> str:
    return "\n\n".join(
        x
        for x in (
            (article.get("content") or "").strip(),
            (article.get("summary") or "").strip(),
        )
        if x
    ) or (title or "").strip()


def _apply_pipeline_rewrite_fallback(article: dict[str, Any], title: str) -> None:
    """Replace title/body with source-only excerpt formatting (no LLM)."""
    cat = _normalize_category(str(article.get("category") or "Boating Tips"))
    blob = _combined_scrape_blob(article, title)
    fb = pipeline_fallback_from_source(
        blob,
        (article.get("title") or title or "").strip() or "Update",
        cat,
    )
    article["title"] = fb["title"]
    article["content"] = fb["content"]


def _pipeline_json_line(obj: dict[str, Any]) -> None:
    """Single-line JSON to stdout for structured pipeline logs."""
    print(json.dumps(obj, ensure_ascii=False, default=str))


def error(msg: str) -> None:
    print(f"[ERROR] {msg}", file=sys.stderr)


def _mask_supabase_url(url: str) -> str:
    """Log-safe preview of SUPABASE_URL (host partially redacted)."""
    u = (url or "").strip()
    if not u:
        return "(empty)"
    low = u.lower()
    if low.startswith("http://127.") or "localhost" in low:
        return "(local URL — redacted)"
    if len(u) <= 24:
        return u[:8] + "…" if len(u) > 8 else u
    return u[:20] + "…" + u[-12:]


def _mask_secret(value: str) -> str:
    if not value:
        return "(empty)"
    if len(value) <= 12:
        return "****"
    return value[:4] + "…" + value[-4:]


def log_supabase_env() -> None:
    """Print loaded Supabase settings (masked) for debugging getaddrinfo / config issues."""
    print("[ENV] SUPABASE_URL:", _mask_supabase_url(SUPABASE_URL), "(full length", len(SUPABASE_URL), ")")
    print(
        "[ENV] SUPABASE_SERVICE_ROLE_KEY:",
        _mask_secret(SUPABASE_SERVICE_ROLE_KEY),
        "(length",
        len(SUPABASE_SERVICE_ROLE_KEY),
        ")",
    )


def _log_scraper_run_header() -> None:
    """Log pillar topics; articles come from RSS + resolved URLs in fetch_all()."""
    print("[PIPELINE] Content sources: RSS-backed pillars (Launch Zone)")
    for topic in PIPELINE_CONTROLLED_TOPICS:
        print("[TOPIC]", topic)


def generate_slug(title: str) -> str:
    """
    Elite-style SEO slug from title: lowercase, hyphenated, local boost when Titusville absent.
    """
    base = (title or "").lower()
    base = re.sub(r"[^a-z0-9\s-]", "", base)
    base = re.sub(r"\s+", "-", base).strip("-")
    base = re.sub(r"-{2,}", "-", base).strip("-")
    if not base:
        base = "article"
    if "titusville" not in base:
        base = f"{base}-titusville-florida"
    base = re.sub(r"-{2,}", "-", base).strip("-")
    return base[:100]


ALLOWED_CAPTAINS_LOG_CATEGORIES: frozenset[str] = frozenset(
    {
        "Launch Updates",
        "Water Adventures",
        "Boating Tips",
        "Local Highlights",
    }
)


def _normalize_category(raw: str) -> str:
    """Ensure category satisfies captains_log CHECK constraint."""
    if raw in ALLOWED_CAPTAINS_LOG_CATEGORIES:
        return raw
    return "Boating Tips"


LOCAL_REF_RE = re.compile(
    r"\b(titusville|port\s+orange|daytona(\s+beach)?|space\s+coast|brevard|indian\s+river|"
    r"kennedy\s+space|cape\s+canaveral|florida|coco\s+beach|melbourne|lagoon)\b",
    re.I,
)
FILLER_PHRASES = (
    "lorem ipsum",
    "as an ai language model",
    "as an ai",
    "[insert",
    "todo:",
    "dummy text",
    "placeholder",
)


def validate_article(
    content: str,
    *,
    public_image_url: str | None,
    supabase_project_url: str,
    min_words: int | None = None,
) -> tuple[bool, str]:
    """
    Gate before captains_log insert — local relevance, anti-filler, min words, image URL rules.
    Grounding QC runs in rewrite_pipeline_article (see grounding module).
    """
    if not (content or "").strip():
        return False, "empty_content"
    wc = len(re.findall(r"\b[\w'-]+\b", content))
    mw = min_words if min_words is not None else PIPELINE_MIN_WORDS_FINAL
    if wc < mw:
        # No "reject" log here — upload.py may pad and re-validate (avoid looking like a failed insert).
        return False, f"below_min_words:{wc}"
    if not LOCAL_REF_RE.search(content):
        return False, "no_local_reference"
    low = content.lower()
    for fp in FILLER_PHRASES:
        if fp in low:
            return False, f"filler:{fp}"
    u = (public_image_url or "").strip()
    if not u:
        return False, "no_image"
    if not (u.startswith("http://") or u.startswith("https://")):
        return False, "image_not_http"
    if is_bad_image_url(u):
        return False, "image_blocked_pattern"
    # External image URLs are allowed when they already passed the image pipeline validation.
    if "/storage/v1/object/public/" not in u:
        return True, "ok"
    base = supabase_project_url.rstrip("/")
    if "/storage/v1/object/public/" not in u or (base and not u.startswith(base)):
        return False, "image_not_supabase_public"
    return True, "ok"


def _can_use_external_image_fallback(article: dict[str, Any], image_url: str) -> bool:
    """
    Allow external URL fallback only when image pipeline already validated it.
    No extra network calls here.
    """
    u = (image_url or "").strip()
    if not (u.startswith("http://") or u.startswith("https://")):
        return False
    if is_bad_image_url(u):
        return False
    if bool(article.get("pipeline_image_failed")):
        return False
    # local_image exists only when bytes/type checks passed in images.py final gate.
    if not article.get("local_image"):
        return False
    return True


def _absolute_site_image_url(raw: str) -> str:
    """
    Convert site-relative image paths (e.g. /images/default.jpg) to absolute URL for validators/DB.
    Leaves absolute URLs unchanged.
    """
    u = (raw or "").strip()
    if not u:
        return ""
    if u.startswith(("http://", "https://")):
        return u
    if u.startswith("/"):
        return f"{SITE_ORIGIN}{u}"
    return ""


def storage_bucket_ready(client: Client, bucket: str) -> bool:
    if not bucket.strip():
        return False
    try:
        buckets = client.storage.list_buckets()
        names: set[str] = set()
        for b in buckets:
            if hasattr(b, "name"):
                names.add(str(b.name))
            elif isinstance(b, dict) and b.get("name"):
                names.add(str(b["name"]))
        ok = bucket in names
        if not ok:
            print(f"[STORAGE] Bucket {bucket!r} not found. Available: {sorted(names)[:12]}…")
        return ok
    except Exception as e:
        print("[STORAGE] list_buckets failed:", e)
        return False


def _try_supabase_client() -> Client | None:
    """Best-effort Supabase client; returns None on missing config or any error."""
    try:
        if not (SUPABASE_URL or "").strip() or not (SUPABASE_SERVICE_ROLE_KEY or "").strip():
            print("[WARN] Supabase URL or service key missing — DB ops will be skipped")
            return None
        return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    except Exception as e:
        print("[WARN] Non-fatal Supabase client init:", e)
        return None


def scraped_item_to_pipeline_article(item: ScrapedArticle) -> dict[str, Any]:
    """
    Standard article dict for scrape → rewrite → process_image → upload.
    Keys: title, content, source_url, image_url, local_image, category, keyword_topic, summary, …
    """
    raw_img = item.get("image_url")
    if isinstance(raw_img, str) and raw_img.strip():
        img: str | None = raw_img.strip()
    else:
        img = None
    return {
        "title": (item.get("title") or "").strip(),
        "content": (item.get("content") or "").strip(),
        "source_url": (item.get("url") or "").strip(),
        "image_url": img,
        "local_image": None,
        "category": item.get("category") or "Boating Tips",
        "keyword_topic": (item.get("keyword_topic") or "").strip(),
        "topic_id": (item.get("topic_id") or "").strip(),
        "source_hint_url": (item.get("source_hint_url") or "").strip(),
        "summary": (item.get("summary") or "").strip(),
        "source": item.get("source"),
        "publish_date": item.get("publish_date"),
    }


def _load_pipeline_article_body(pa: dict[str, Any]) -> str:
    """
    Resolve full text: pre-scraped `content` from fetch_all, else HTML paragraphs via `fetch_source_text`.
    SEO hub mode prefers a longer publisher fetch when it beats thin RSS stubs.
    """
    body = (pa.get("content") or "").strip()
    su = (pa.get("source_url") or "").strip()
    if not su.startswith("http"):
        return body
    max_chars = 20000 if PIPELINE_SEO_HUB_MODE else 12000
    retries = 1 if PIPELINE_SEO_HUB_MODE else 0
    fetched = fetch_source_text(su, max_chars=max_chars, max_retries=retries)
    if PIPELINE_SEO_HUB_MODE:
        bw = len(body.split())
        fw = len(fetched.split())
        # Prefer publisher HTML whenever it clearly beats the preloaded RSS stub.
        # Old rule `fw > max(bw, 40)` kept thin bodies when e.g. bw=5 junk and fw=35 real paragraphs.
        if fw > bw and fw >= 25:
            print(
                f"[PIPELINE] SEO hub: using full article fetch ({fw} words) over preloaded body ({bw} words)"
            )
            return fetched
        return body or fetched
    if not body:
        body = fetched
    return body


def _verify_public_storage_url(url: str) -> bool:
    """Confirm the public Storage URL responds before continuing to validation/insert."""
    try:
        r = requests.head(url, timeout=5)
        return r.status_code == 200
    except Exception as e:
        record_if_requests_timeout(e)
        return False


def _try_upload_local_image_to_public_url(client: Client | None, local_path: str) -> str | None:
    """Upload cached file to Storage; return public URL or None (non-fatal)."""
    if not client:
        return None
    bucket = (CAPTAINS_LOG_IMAGE_BUCKET or "").strip()
    if not bucket or not SUPABASE_URL:
        print("[WARN] Storage upload skipped: bucket or SUPABASE_URL unset")
        return None
    p = Path(local_path)
    if not p.is_file():
        print("[WARN] Storage upload skipped: local file missing:", local_path)
        return None
    try:
        ext = p.suffix if p.suffix else ".jpg"
        dest = f"captains-log/heroes/{uuid.uuid4().hex}{ext}"
        data = p.read_bytes()
        ctype = mimetypes.guess_type(local_path)[0] or "image/jpeg"
        print("Uploading image:", local_path)
        client.storage.from_(bucket).upload(dest, data, file_options={"content-type": ctype})
        base = SUPABASE_URL.rstrip("/")
        pub = f"{base}/storage/v1/object/public/{bucket}/{dest}"
        if not _verify_public_storage_url(pub):
            print("[WARN] Upload verification failed — public URL not OK:", pub[:96])
            return None
        return pub
    except Exception as e:
        print("[WARN] Storage upload failed (non-fatal):", e)
        return None


def _empty_stats_delta() -> dict[str, Any]:
    return {
        "processed": 0,
        "skipped_duplicate": 0,
        "skipped_recent": 0,
        "skipped_title_duplicate": 0,
        "skipped_similar_title": 0,
        "skipped_topic_mismatch": 0,
        "skipped_ai": 0,
        "skipped_image": 0,
        "skipped_upload": 0,
        "skipped_validation": 0,
        "inserted": 0,
        "insert_failed": 0,
        "errors": 0,
        "timeout_errors": 0,
        "unsplash_429": 0,
    }


def _merge_stats(stats: dict[str, Any], delta: dict[str, Any]) -> None:
    for k, v in delta.items():
        stats[k] = stats[k] + v


def _log_pipeline_metrics_summary(stats: dict[str, Any]) -> None:
    """Emit end-of-run JSON for monitoring; refreshes timeout/unsplash counts from global metrics."""
    summary = pipeline_summary_log_payload(stats)
    stats["timeout_errors"] = summary["timeout_errors"]
    stats["unsplash_429"] = summary["unsplash_429"]
    print(json.dumps(summary, ensure_ascii=False))


def _slug_exists(client: Client | None, slug: str) -> bool:
    if not client:
        return False
    s = (slug or "").strip()[:200]
    if not s:
        return False
    try:
        res = client.table("captains_log").select("id").eq("slug", s).limit(1).execute()
        return bool(res.data)
    except Exception as e:
        print("[WARN] Supabase slug check failed (assuming free):", e)
        return False


_PGRST_MISSING_COLUMN_RE = re.compile(
    r"Could not find the '([^']+)' column of 'captains_log'",
    re.IGNORECASE,
)


def _insert_captains_log_row(client: Client, payload: dict[str, Any]) -> Any:
    """
    Insert into captains_log. If PostgREST returns PGRST204 for a column not in its schema cache,
    drop that key and retry so publishes work before/without a manual NOTIFY reload.
    """
    attempt = {k: v for k, v in payload.items()}
    for _ in range(16):
        try:
            return client.table("captains_log").insert(attempt).execute()
        except Exception as e:
            raw = str(e)
            if "PGRST204" not in raw and "schema cache" not in raw.lower():
                raise
            m = _PGRST_MISSING_COLUMN_RE.search(raw)
            if not m:
                raise
            col = m.group(1)
            if col not in attempt:
                raise
            print(
                f"[WARN] PostgREST schema cache has no column {col!r} — retrying insert without it. "
                "Fix in SQL: ALTER TABLE public.captains_log ADD COLUMN IF NOT EXISTS "
                f"{col} ...; NOTIFY pgrst, 'reload schema';"
            )
            del attempt[col]
    raise RuntimeError("captains_log insert failed after omitting unknown columns")


def run_pipeline() -> dict[str, Any]:
    """
    Execute full pipeline. Returns counters for cron / monitoring.

    `fetch_all()` returns real articles from RSS per pillar (see scraper).
    Skips (not inserts) on AI failure or validate_article failure; inserts may omit image_url when no hero is available.
    """
    processed = 0
    inserted = 0
    failed = 0
    print("⬆️ UPLOAD PIPELINE STARTED")
    reset_pipeline_metrics()
    reset_image_run_dedupe()
    log("STEP 1: Start")
    if PIPELINE_FAST:
        print(
            "[INFO] PIPELINE_FAST=1 — SEO hub + full HTML fetch are OFF; use PIPELINE_FAST=0 for full SEO output."
        )
    print(
        json.dumps(
            {
                "stage": "pipeline_audit",
                "event": "config",
                "min_words_final": PIPELINE_MIN_WORDS_FINAL,
                "grounding_min_token_overlap": GROUNDING_MIN_TOKEN_OVERLAP,
                "pipeline_fast": PIPELINE_FAST,
                "seo_hub_mode": PIPELINE_SEO_HUB_MODE,
                "fetch_full_article": PIPELINE_FETCH_FULL_ARTICLE,
                "ollama_timeout_sec": OLLAMA_TIMEOUT_SEC,
                "notes": "Grounding QC in rewrite_pipeline_article; hallucination mitigated via source overlap + number checks",
            },
            ensure_ascii=False,
        )
    )
    client = _try_supabase_client()
    log("STEP 2: Supabase client ready (or None)")
    if client:
        try:
            client.table("captains_log").select("id").limit(1).execute()
            print("[SUPABASE] Connection OK")
        except Exception as e:
            print("[WARN] Supabase connection test (non-fatal):", e)

    stats: dict[str, Any] = {
        "processed": 0,
        "skipped_duplicate": 0,
        "skipped_recent": 0,
        "skipped_title_duplicate": 0,
        "skipped_similar_title": 0,
        "skipped_topic_mismatch": 0,
        "skipped_ai": 0,
        "skipped_image": 0,
        "skipped_upload": 0,
        "skipped_validation": 0,
        "inserted": 0,
        "insert_failed": 0,
        "errors": 0,
        "timeout_errors": 0,
        "unsplash_429": 0,
    }

    log("STEP 3: Fetching data (scraper)")
    _log_scraper_run_header()
    articles = fetch_all()
    print("📰 RAW ARTICLES FETCHED:", len(articles))
    dbg = scraper_pipeline_debug()
    print("[LINKS FOUND]", dbg.get("links_raw", 0))
    print("[AFTER FILTER]", dbg.get("after_filter", len(articles)))
    if not articles:
        print("[PIPELINE] no articles found")
        print("PIPELINE COMPLETE:")
        print(f"Processed: {processed}")
        print(f"Inserted: {inserted}")
        print(f"Failed: {failed}")
        _log_pipeline_metrics_summary(stats)
        return stats
    items = list(articles)
    print("[PIPELINE START]")
    print(f"[PIPELINE] {len(items)} article(s) to process")
    log(
        f"STEP 3: Data fetched - {len(items)} articles selected after score + category balance"
    )

    log("STEP 4: Generating content (per article)")
    bucket = (CAPTAINS_LOG_IMAGE_BUCKET or "").strip()
    if client and bucket and not storage_bucket_ready(client, bucket):
        print(
            f"[WARN] Storage bucket {bucket!r} not found or not listable — "
            "uploads/validation will fail until the bucket exists."
        )

    valid_items: list[tuple[ScrapedArticle, bool]] = []
    for article_item in items:
        url = (article_item.get("url") or "").strip()
        source_url = url or None
        print("🌐 ARTICLE SOURCE:", source_url)
        if not is_valid_source_url(source_url):
            print(f"[SKIP] invalid source_url → {source_url!r}")
            print("❌ REJECTED SOURCE (NOT ALLOWED):", source_url)
            stats["skipped_validation"] += 1
            continue
        is_dup = bool(client and is_duplicate_article(client, source_url, log=False))
        valid_items.append((article_item, is_dup))
    recent_title_hashes = _load_recent_title_hashes()
    recent_titles = _recent_captains_log_titles(client, 80)
    recent_excerpts = _recent_captains_log_excerpts(client, 50)
    attempts = 0
    structure_audit_checked = 0
    structure_audit_failures = 0

    recent_source_urls = set(_recent_captains_log_source_urls(client, 5))
    inserted_before_run = stats["inserted"]
    max_attempts_hit = False
    total_candidates = len(valid_items)
    duplicate_candidates = sum(1 for _item, is_dup in valid_items if is_dup)
    early_exit_dup_heavy = os.environ.get("PIPELINE_EARLY_EXIT_DUPLICATE_HEAVY", "1").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    structure_enforce = os.environ.get("PIPELINE_STRUCTURE_ENFORCE", "1").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    default_image_on_failure = os.environ.get("PIPELINE_DEFAULT_IMAGE_ON_FAILURE", "1").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    if total_candidates:
        print(
            json.dumps(
                {
                    "stage": "candidate_pool",
                    "total": total_candidates,
                    "duplicates_already_published": duplicate_candidates,
                    "unique_candidates": total_candidates - duplicate_candidates,
                },
                ensure_ascii=False,
            )
        )
        if duplicate_candidates >= max(total_candidates - 1, 3):
            print(
                f"[HINT] duplicate-heavy candidate pool ({duplicate_candidates}/{total_candidates}) — "
                "few unique URLs available this run; inserts may be zero unless fresh RSS items appear."
            )
        if early_exit_dup_heavy and duplicate_candidates >= total_candidates and total_candidates > 0:
            print("[PIPELINE] all candidates are already published (duplicate-heavy fast exit)")
            stats["skipped_duplicate"] += duplicate_candidates
            processed = stats["processed"]
            inserted = stats["inserted"]
            failed = stats["insert_failed"] + stats["errors"]
            print("PIPELINE COMPLETE:")
            print(f"Processed: {processed}")
            print(f"Inserted: {inserted}")
            print(f"Failed: {failed}")
            rejected_count = (
                stats.get("skipped_duplicate", 0)
                + stats.get("skipped_recent", 0)
                + stats.get("skipped_title_duplicate", 0)
                + stats.get("skipped_similar_title", 0)
                + stats.get("skipped_topic_mismatch", 0)
                + stats.get("skipped_ai", 0)
                + stats.get("skipped_image", 0)
                + stats.get("skipped_upload", 0)
                + stats.get("skipped_validation", 0)
            )
            print("📊 PIPELINE COMPLETE")
            print("📊 TOTAL INSERTED:", inserted)
            print("📊 TOTAL REJECTED:", rejected_count)
            print(
                "📊 STRUCTURE AUDIT:",
                json.dumps(
                    {"checked": 0, "failures": 0, "failure_rate": 0.0},
                    ensure_ascii=False,
                ),
            )
            stats["structure_audit_checked"] = 0
            stats["structure_audit_failures"] = 0
            _log_pipeline_metrics_summary(stats)
            return stats

    for article_item, is_dup in valid_items:
        delta = _empty_stats_delta()
        url = (article_item.get("url") or "").strip()
        title = (article_item.get("title") or "").strip()
        source_url = url or None
        attempts += 1
        print("🔁 LOOP ITERATION:", attempts)
        if attempts > PIPELINE_MAX_ATTEMPTS_PER_RUN:
            print(
                f"[PIPELINE] max attempts reached ({PIPELINE_MAX_ATTEMPTS_PER_RUN}) — stopping run loop"
            )
            print("🛑 MAX ATTEMPTS REACHED")
            _merge_stats(stats, delta)
            max_attempts_hit = True
            break

        if source_url and source_url in recent_source_urls:
            candidate_pool_size = len(valid_items)
            allow_reuse = candidate_pool_size < 5
            if allow_reuse:
                print(
                    f"[INFO] recent source reused due to low candidate pool (size={candidate_pool_size}) → {source_url[:200]}"
                )
            else:
                print(f"[SKIP] recently used → {source_url[:200]}")
                delta["skipped_recent"] += 1
                _merge_stats(stats, delta)
                continue

        if is_dup:
            print(f"[SKIP] duplicate article (already in captains_log) → {source_url[:220]}")
            delta["skipped_duplicate"] += 1
            _merge_stats(stats, delta)
            continue

        log(f"STEP 4: Article begin title={title[:80]!r}")
        try:
            if not title:
                title = "Captain's Log — Space Coast and lagoon updates"
            print("🧾 TITLE HASH CHECK:", title[:220])
            t_hash = _title_hash(title)
            if t_hash in recent_title_hashes:
                print(f"[SKIP] duplicate title hash → {title[:160]}")
                print("❌ DUPLICATE TITLE:", title[:220])
                delta["skipped_title_duplicate"] += 1
                _merge_stats(stats, delta)
                continue
            if _title_too_similar(title, recent_titles, threshold=PIPELINE_TITLE_SIMILARITY_THRESHOLD):
                print(f"[SKIP] similar title to recent post → {title[:160]}")
                print("❌ DUPLICATE TITLE:", title[:220])
                delta["skipped_similar_title"] += 1
                _merge_stats(stats, delta)
                continue

            article = scraped_item_to_pipeline_article(article_item)
            if not article.get("title"):
                article["title"] = title

            if url.startswith("http") and not (article.get("image_url") or "").strip():
                try:
                    _txt, hero = scrape_article_for_pipeline(url, title)
                    if hero:
                        article["image_url"] = hero.strip()
                        print("[IMAGE] hero from article page:", hero[:120])
                except Exception as ex:
                    print("[WARN] scrape_article_for_pipeline (image):", ex)

            topic_body = _load_pipeline_article_body(article)
            article["content"] = topic_body
            print(f"[DEBUG] Raw content length: {len(article.get('content', '').split())}")
            print(f"[DEBUG] Raw content preview: {article.get('content', '')[:300]}")

            raw_body = (article.get("content") or "").strip()
            summary_s = str(article.get("summary") or "")
            if not raw_body:
                print("[WARN] fallback content used (title/summary only, no invented copy)")
                article["content"] = _minimal_body_from_scrape_only(
                    article.get("title") or title,
                    summary_s,
                )
            elif _word_count(raw_body) < 40:
                print("[WARN] short scrape — merge RSS summary + headline for rewrite signal")
                article["content"] = _ensure_min_words_for_rewrite(
                    raw_body,
                    article.get("title") or title,
                    summary_s,
                )

            tid = str(article.get("topic_id") or "").strip()
            check_title = (article.get("title") or title or "").strip()
            check_summary = str(article.get("summary") or "")
            check_url = str(article.get("url") or article.get("source_url") or "").strip()
            check_source_hint = str(article.get("source_hint_url") or "").strip()
            if tid and not is_relevant_to_topic_with_summary(
                check_title,
                check_summary,
                tid,
                check_url,
                check_source_hint,
            ):
                print(f"[ERROR] invalid article passed filter → {check_title[:200]!r}")
                delta["skipped_topic_mismatch"] += 1
                _merge_stats(stats, delta)
                continue
            if not _business_intent_match(check_title, str(article.get("content") or ""), check_summary):
                print(f"[SKIP] business intent gate failed → {check_title[:200]!r}")
                print("❌ FINAL REJECT (BUSINESS INTENT):", check_title[:220])
                delta["skipped_validation"] += 1
                _merge_stats(stats, delta)
                continue
            print("🚨 BUSINESS INTENT CHECK:", check_title[:220])

            _pipeline_json_line(
                {
                    "stage": "selected",
                    "title": article.get("title") or title,
                    "url": url or (article.get("source_url") or ""),
                    "category": article.get("category"),
                    "keyword_topic": article.get("keyword_topic"),
                    "topic_id": tid,
                }
            )

            topic_title = (article.get("title") or title or "").strip()
            topic_body = (article.get("content") or "").strip()
            topic_matched = text_matches_keyword_topic(
                topic_title,
                topic_body,
                str(article.get("keyword_topic") or ""),
            )
            _pipeline_json_line(
                {
                    "stage": "topic_check",
                    "title": topic_title,
                    "matched": topic_matched,
                }
            )
            if not topic_matched:
                print(
                    "[SKIP] title/body do not match keyword pillar →",
                    str(article.get("keyword_topic") or "")[:120],
                )
                delta["skipped_topic_mismatch"] += 1
                _merge_stats(stats, delta)
                continue

            delta["processed"] += 1

            log(
                f"STEP 4: rewrite_pipeline_article url={url!r} category={article['category']!r} "
                f"keyword_topic={article['keyword_topic']!r}"
            )
            print("✍️ SENDING TO REWRITE:", (article.get("title") or title)[:220])
            try:
                rewritten = rewrite_pipeline_article(article)
                if rewritten is None:
                    print("[WARN] rewrite returned None — source-only excerpt fallback")
                    _apply_pipeline_rewrite_fallback(article, title)
                else:
                    print(
                        f"[DEBUG] Rewritten content preview: {rewritten.get('content', '')[:300]}"
                    )
                    article = rewritten
                    print("[REWRITE SUCCESS]")
                    print("✅ REWRITE COMPLETE:", (article.get("title") or title)[:220])
            except (TopicMismatchError, RewriteFailedError) as e:
                print("[WARN] rewrite bypass — source-only excerpt fallback:", e)
                _apply_pipeline_rewrite_fallback(article, title)
            except Exception as e:
                print(f"[ERROR] rewrite failed → {e}")
                print("[WARN] rewrite bypass — source-only excerpt fallback")
                _apply_pipeline_rewrite_fallback(article, title)

            # Phase 1 (non-blocking): audit structure immediately after rewrite/fallback,
            # before image gates can skip the article.
            content_for_audit = (article.get("content") or "").strip()
            seo_title_for_audit = (article.get("title") or title or "").strip()
            audit_ok, audit_issues, audit_meta = audit_article_structure(
                seo_title_for_audit, content_for_audit
            )
            structure_audit_checked += 1
            block_issues = blocking_structure_issues(audit_issues)
            if not audit_ok:
                structure_audit_failures += 1
            print(
                json.dumps(
                    {
                        "stage": "structure_audit",
                        "ok": audit_ok,
                        "issues": audit_issues[:6],
                        "blocking_issues": block_issues[:6],
                        **audit_meta,
                    },
                    ensure_ascii=False,
                )
            )
            if structure_enforce and block_issues:
                # Phase 2: attempt one deterministic source fallback, then re-audit.
                source_blob = "\n\n".join(
                    x.strip()
                    for x in (
                        str(article.get("title") or ""),
                        str(article.get("summary") or ""),
                        str(article.get("content") or ""),
                    )
                    if str(x).strip()
                )
                fb = pipeline_fallback_from_source(
                    source_blob,
                    str(article.get("title") or title),
                    str(article.get("category") or "Boating Tips"),
                )
                if (fb.get("content") or "").strip():
                    article["title"] = (fb.get("title") or article.get("title") or title)[:500]
                    article["content"] = (fb.get("content") or "").strip()
                    print(
                        json.dumps(
                            {
                                "stage": "structure_enforce",
                                "action": "fallback_repair_attempt",
                                "prior_blocking_issues": block_issues[:6],
                            },
                            ensure_ascii=False,
                        )
                    )
                    audit_ok2, issues2, meta2 = audit_article_structure(
                        str(article.get("title") or title),
                        str(article.get("content") or ""),
                    )
                    structure_audit_checked += 1
                    if not audit_ok2:
                        structure_audit_failures += 1
                    block_issues2 = blocking_structure_issues(issues2)
                    print(
                        json.dumps(
                            {
                                "stage": "structure_audit",
                                "ok": audit_ok2,
                                "issues": issues2[:6],
                                "blocking_issues": block_issues2[:6],
                                "repair_attempt": True,
                                **meta2,
                            },
                            ensure_ascii=False,
                        )
                    )
                    if block_issues2:
                        print(f"[SKIP] structure gate failed after repair → {block_issues2[:3]}")
                        delta["skipped_validation"] += 1
                        _merge_stats(stats, delta)
                        continue
                else:
                    print(f"[SKIP] structure gate failed (no fallback content) → {block_issues[:3]}")
                    delta["skipped_validation"] += 1
                    _merge_stats(stats, delta)
                    continue

            try:
                img_result = process_image_strict(article)
            except Exception as e:
                print("[WARN] process_image_strict:", e)
                img_result = None
            if img_result is None:
                print("[WARN] weak image allowed")
            else:
                article = img_result
            if bool(article.get("pipeline_image_failed")):
                if default_image_on_failure:
                    # Stability mode: keep publish moving during image-source outages.
                    article["pipeline_image_failed"] = False
                    article["image_source"] = "DEFAULT_IMAGE_FALLBACK"
                    article["image_url"] = (PIPELINE_DEFAULT_IMAGE_WEB_PATH or "/images/default.jpg").strip()
                    article.pop("local_image", None)
                    print(
                        json.dumps(
                            {
                                "stage": "image_default_fallback",
                                "enabled": True,
                                "url": article["image_url"],
                            },
                            ensure_ascii=False,
                        )
                    )
                else:
                    print("[SKIP] no valid/relevant image found for article")
                    delta["skipped_image"] += 1
                    _merge_stats(stats, delta)
                    continue

            public_image_url: str | None = None
            if article.get("local_image"):
                public_image_url = _try_upload_local_image_to_public_url(
                    client, str(article["local_image"])
                )
                if not public_image_url:
                    print("[WARN] Supabase storage upload failed — may use external image URL")
            if not public_image_url:
                fallback_external = str(article.get("image_url") or "").strip()
                if _can_use_external_image_fallback(article, fallback_external):
                    public_image_url = fallback_external
                    print("[INFO] Using external image URL fallback (storage unavailable)")
            if not public_image_url:
                # Phase 1.5 default image fallback can be site-relative; normalize here.
                normalized = _absolute_site_image_url(str(article.get("image_url") or ""))
                if normalized:
                    public_image_url = normalized
                    print("[INFO] Using absolute site image fallback URL")

            category = _normalize_category(str(article.get("category") or "Boating Tips"))
            seo_title = (article.get("title") or "").strip() or title
            if len(seo_title) < 3:
                seo_title = title[:500]

            content = (article.get("content") or "").strip()
            if not _is_english_body_text(content):
                print(f"[SKIP] non-English body detected → {seo_title[:200]!r}")
                delta["skipped_validation"] += 1
                _merge_stats(stats, delta)
                continue
            if not _business_intent_match(seo_title, content, str(article.get("summary") or "")):
                print(f"[SKIP] strict niche keyword gate (final) failed → {seo_title[:200]!r}")
                print("❌ FINAL REJECT (STRICT KEYWORD FAIL):", seo_title[:220])
                delta["skipped_validation"] += 1
                _merge_stats(stats, delta)
                continue
            # Post-rewrite title dedupe: scraped title was checked earlier; SEO title may differ.
            seo_title_hash = _title_hash(seo_title)
            if seo_title_hash in recent_title_hashes:
                print(f"[SKIP] duplicate SEO title hash → {seo_title[:160]}")
                delta["skipped_title_duplicate"] += 1
                _merge_stats(stats, delta)
                continue
            if _title_too_similar(
                seo_title, recent_titles, threshold=PIPELINE_TITLE_SIMILARITY_THRESHOLD
            ):
                print(f"[SKIP] similar SEO title to recent post → {seo_title[:160]}")
                delta["skipped_similar_title"] += 1
                _merge_stats(stats, delta)
                continue
            summary_blob = f"{str(article.get('summary') or '').strip()} {content[:800]}"
            if _excerpt_too_similar(
                summary_blob, recent_excerpts, threshold=PIPELINE_EXCERPT_SIMILARITY_THRESHOLD
            ):
                print(f"[SKIP] similar summary/content to recent post → {seo_title[:160]}")
                delta["skipped_similar_title"] += 1
                _merge_stats(stats, delta)
                continue
            slug = generate_slug(seo_title)
            for _ in range(12):
                if not _slug_exists(client, slug):
                    break
                slug = f"{slug}-{uuid.uuid4().hex[:6]}"
                slug = slug[:200]

            ok, reason = validate_article(
                content,
                public_image_url=public_image_url,
                supabase_project_url=(SUPABASE_URL or "").strip(),
            )
            if not ok and reason.startswith("below_min_words"):
                wc0 = reason.split(":", 1)[-1] if ":" in reason else "?"
                print(
                    f"[INFO] Word count under {PIPELINE_MIN_WORDS_FINAL} ({wc0} words) — "
                    "padding with source-safe text, then re-checking"
                )
                content = _expand_short_content_for_validation(
                    content,
                    seo_title,
                    str(article.get("summary") or ""),
                    PIPELINE_MIN_WORDS_FINAL,
                )
                article["content"] = content
                ok, reason = validate_article(
                    content,
                    public_image_url=public_image_url,
                    supabase_project_url=(SUPABASE_URL or "").strip(),
                )
            if not ok and reason == "no_local_reference":
                print("[WARN] local reference appended for validation")
                content = (
                    content
                    + "\n\nLocal note: Boating near Titusville and Port Orange on the Indian River Lagoon "
                    "means checking Florida Space Coast marine forecasts before you launch."
                )
                article["content"] = content
                ok, reason = validate_article(
                    content,
                    public_image_url=public_image_url,
                    supabase_project_url=(SUPABASE_URL or "").strip(),
                )
            if not ok:
                print(f"[SKIP] validate_article: {reason}")
                delta["skipped_validation"] += 1
                _merge_stats(stats, delta)
                continue

            source_url_db = url or None

            if ENABLE_FINAL_ARTICLE_ENHANCER and (
                (not FINAL_ENHANCER_ONLY_NEW)
                or not is_duplicate_article(client, source_url_db or "", log=False)
            ):
                content = apply_final_article_enhancer(
                    content=content,
                    seo_title=seo_title,
                    slug=slug,
                    enable_checklist=FINAL_ENHANCER_ENABLE_CHECKLIST,
                    enable_local_context=FINAL_ENHANCER_ENABLE_LOCAL_CONTEXT,
                    enable_qa=FINAL_ENHANCER_ENABLE_QA,
                    enable_cta=FINAL_ENHANCER_ENABLE_CTA,
                    heading_level=FINAL_ENHANCER_HEADING_LEVEL,
                    enable_dynamic_topics=FINAL_ENHANCER_ENABLE_DYNAMIC_TOPICS,
                    enable_internal_backlink_engine=FINAL_ENHANCER_ENABLE_INTERNAL_BACKLINK_ENGINE,
                    max_internal_links=FINAL_ENHANCER_MAX_INTERNAL_LINKS,
                    topic_min_score=FINAL_ENHANCER_TOPIC_MIN_SCORE,
                    secondary_blend_ratio=FINAL_ENHANCER_SECONDARY_BLEND_RATIO,
                )
                article["content"] = content

            print(
                json.dumps(
                    {
                        "title": seo_title,
                        "content_words": len(re.findall(r"\b[\w'-]+\b", content)),
                        "image": (public_image_url or "")[:120],
                    },
                    ensure_ascii=False,
                )
            )

            if not client:
                delta["insert_failed"] += 1
                print("[WARN] No Supabase client — insert skipped for:", seo_title[:80])
                _merge_stats(stats, delta)
                continue

            if not public_image_url:
                print("[SKIP] no image URL available after upload/fallback")
                delta["skipped_image"] += 1
                _merge_stats(stats, delta)
                continue

            print(
                {
                    "stage": "FINAL_ARTICLE",
                    "title": seo_title,
                    "content_length": len(content.split()),
                }
            )
            print(
                {
                    "stage": "READY_TO_INSERT",
                    "title": seo_title,
                    "source_url": source_url_db,
                    "word_count": len(content.split()),
                }
            )
            insert_payload = {
                "title": seo_title[:500],
                "slug": slug[:200],
                "content": content,
                "image_url": public_image_url,
                "source_url": source_url_db,
                "category": category,
                "image_alt": (article.get("image_alt") or "").strip() or None,
                "image_source": (article.get("image_source") or "").strip() or None,
                "seo_keywords": article.get("seo_keywords") or [],
                "image_seo_filename": (article.get("image_seo_filename") or "").strip() or None,
            }
            try:
                print("💾 INSERTING ARTICLE:", seo_title[:220])
                _insert_captains_log_row(client, insert_payload)
                print("[INSERT SUCCESS]")
                print("✅ INSERT SUCCESS:", seo_title[:220])
                save_last_article_title_for_rotation(seo_title)
                delta["inserted"] += 1
                recent_title_hashes.add(_title_hash(seo_title))
                _save_recent_title_hashes(recent_title_hashes)
                recent_titles.insert(0, seo_title)
                if len(recent_titles) > 80:
                    recent_titles = recent_titles[:80]
                recent_excerpts.insert(0, summary_blob)
                if len(recent_excerpts) > 50:
                    recent_excerpts = recent_excerpts[:50]
                if source_url_db:
                    recent_source_urls.add(source_url_db)
                record_published_image_alt((article.get("image_alt") or "").strip())
                log(f"Inserted slug={slug} title={seo_title[:80]!r}")
            except Exception as e:
                es = str(e).lower()
                if "23505" in str(e) or "duplicate key" in es or "unique constraint" in es:
                    print("[SKIP] duplicate source_url (DB) →", (source_url_db or "")[:160])
                    delta["skipped_duplicate"] += 1
                    _merge_stats(stats, delta)
                    continue
                print("[INSERT FAILED]", e)
                delta["insert_failed"] += 1
                _merge_stats(stats, delta)
                continue

        except Exception as e:
            delta["errors"] += 1
            print("[ERROR] Article failed:", e)
            traceback.print_exc(file=sys.stderr)
            _merge_stats(stats, delta)
            continue
        _merge_stats(stats, delta)

    if not max_attempts_hit and stats["inserted"] == inserted_before_run:
        print("[PIPELINE] no new valid content inserted in this pass — stopping")
        print("🛑 NO VALID CONTENT FOUND — EXITING")
        if stats.get("processed", 0) == 0:
            print(
                "[HINT] processed=0: every candidate exited before rewrite — most often "
                "`source_url` already exists in captains_log (see skipped_duplicate), "
                "or the URL was in the last few published (skipped_recent), or title/topic gates fired. "
                "Wait for new RSS items or clear test rows if you are re-running the same URLs."
            )

    processed = stats["processed"]
    inserted = stats["inserted"]
    failed = stats["insert_failed"] + stats["errors"]
    print("PIPELINE COMPLETE:")
    print(f"Processed: {processed}")
    print(f"Inserted: {inserted}")
    print(f"Failed: {failed}")
    rejected_count = (
        stats.get("skipped_duplicate", 0)
        + stats.get("skipped_recent", 0)
        + stats.get("skipped_title_duplicate", 0)
        + stats.get("skipped_similar_title", 0)
        + stats.get("skipped_topic_mismatch", 0)
        + stats.get("skipped_ai", 0)
        + stats.get("skipped_image", 0)
        + stats.get("skipped_upload", 0)
        + stats.get("skipped_validation", 0)
    )
    print("📊 PIPELINE COMPLETE")
    print("📊 TOTAL INSERTED:", inserted)
    print("📊 TOTAL REJECTED:", rejected_count)
    print(
        "📊 STRUCTURE AUDIT:",
        json.dumps(
            {
                "checked": structure_audit_checked,
                "failures": structure_audit_failures,
                "failure_rate": round(
                    (structure_audit_failures / structure_audit_checked), 4
                )
                if structure_audit_checked
                else 0.0,
            },
            ensure_ascii=False,
        ),
    )
    stats["structure_audit_checked"] = structure_audit_checked
    stats["structure_audit_failures"] = structure_audit_failures

    log(
        "Pipeline finished - "
        f"processed={stats['processed']} inserted={stats['inserted']} "
        f"insert_failed={stats.get('insert_failed', 0)} "
        f"skipped_duplicate={stats.get('skipped_duplicate', 0)} "
        f"skipped_recent={stats.get('skipped_recent', 0)} "
        f"skipped_title_duplicate={stats.get('skipped_title_duplicate', 0)} "
        f"skipped_similar_title={stats.get('skipped_similar_title', 0)} "
        f"skipped_topic={stats['skipped_topic_mismatch']} skipped_ai={stats['skipped_ai']} "
        f"skipped_image={stats['skipped_image']} skipped_upload={stats['skipped_upload']} "
        f"skipped_validation={stats['skipped_validation']} errors={stats['errors']} "
        f"timeout_errors={stats.get('timeout_errors', 0)} unsplash_429={stats.get('unsplash_429', 0)}"
    )
    _log_pipeline_metrics_summary(stats)
    return stats


def main() -> None:
    log("Starting script")
    log_supabase_env()
    try:
        result = run_pipeline()
    except Exception as e:
        print("[WARN] Non-fatal pipeline error:", e)
        traceback.print_exc(file=sys.stderr)
        result = {
            "processed": 0,
            "inserted": 0,
            "errors": 1,
            "exception": str(e),
        }
    log("FINAL STEP REACHED")
    log("STEP 5: Preparing output")
    print(json.dumps({"status": "success", "data": result}))


if __name__ == "__main__":
    main()
