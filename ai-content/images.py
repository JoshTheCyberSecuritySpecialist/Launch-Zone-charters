"""
Pipeline images: scraped hero first, re-scrape, Unsplash API search.
"""

from __future__ import annotations

import json
import mimetypes
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import requests
from requests.exceptions import Timeout as RequestsTimeout

from config import (
    HARD_FALLBACK_IMAGE_URLS,
    IMAGE_BOAT_URL,
    IMAGE_PIPELINE_FALLBACK,
    IMAGE_ROCKET_URL,
    PIPELINE_DEFAULT_IMAGE_WEB_PATH,
    PIPELINE_IMAGE_CACHE_DIR,
    REQUEST_TIMEOUT_SEC,
    SCRAPER_STOCK_IMAGE_FALLBACK,
    UNSPLASH_ACCESS_KEY,
)
from image_seo import build_image_seo_fields
from image_instrumentation import (
    MAX_UNSPLASH_CANDIDATES_LOGGED_PER_TIER,
    article_id_hash,
    domain_and_filename,
    enabled as image_instrumentation_enabled,
    is_logo_like_filename,
    keywords_hit_list,
    log_image_article_summary,
    log_image_candidate,
    suggested_penalties,
)
from pipeline_metrics import record_if_requests_timeout, record_timeout_error, record_unsplash_429
from scraper import rescrape_article_hero, validate_image_url
from unsplash_queries import build_unsplash_query_tiers

MIN_IMAGE_BYTES = 50 * 1024
MIN_IMAGE_WIDTH_PX = 800
# Unsplash search: one repeat request after brief sleep (429 / 5xx only).
_UNSPLASH_RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})

# Per pipeline run: avoid reusing the same stock URL when possible
_run_used_image_urls: set[str] = set()
_persistent_used_image_urls: list[str] = []
_PERSISTENT_URL_PATH = Path(__file__).resolve().parent / "pipeline_recent_image_urls.json"
_PERSISTENT_URL_MAX = 100
_BUILTIN_FALLBACK_ALLOW_RECENT = (
    os.environ.get("PIPELINE_BUILTIN_FALLBACK_ALLOW_RECENT", "1").strip().lower()
    in ("1", "true", "yes", "on")
)
_UNSPLASH_LAST_RESORT_ONLY = (
    os.environ.get("PIPELINE_UNSPLASH_LAST_RESORT_ONLY", "1").strip().lower()
    in ("1", "true", "yes", "on")
)

_IMAGE_RELAX_DEBUG = False

HEADERS = {
    "User-Agent": "LaunchZoneChartersBot/1.1 (Captain's Log pipeline image fetch)",
    "Accept": "image/*,*/*;q=0.8",
}

DEFAULT_IMAGE_WEB = PIPELINE_DEFAULT_IMAGE_WEB_PATH

_TOPIC_KEYWORDS = frozenset(
    (
        "spacex",
        "falcon",
        "nasa",
        "rocket",
        "launch",
        "boat",
        "ocean",
        "space",
        "kennedy",
        "canaveral",
        "artemis",
        "fishing",
        "lagoon",
        "florida",
        "titusville",
        "spacecoast",
        "space-coast",
        "bioluminescence",
        "kayak",
        "boating",
        "marine",
        "charter",
        "night",
        "water",
        "viewing",
    )
)


def reset_image_run_dedupe() -> None:
    """Call once at the start of each upload pipeline run."""
    global _run_used_image_urls
    _run_used_image_urls = set()
    _load_persistent_url_state()


def _url_fingerprint(url: str) -> str:
    return (url or "").strip().split("?", 1)[0]


def _mark_url_used(url: str) -> None:
    fp = _url_fingerprint(url)
    if fp:
        _run_used_image_urls.add(fp)
        if fp in _persistent_used_image_urls:
            _persistent_used_image_urls.remove(fp)
        _persistent_used_image_urls.append(fp)
        if len(_persistent_used_image_urls) > _PERSISTENT_URL_MAX:
            del _persistent_used_image_urls[:-_PERSISTENT_URL_MAX]
        _save_persistent_url_state()


def _load_persistent_url_state() -> None:
    global _persistent_used_image_urls
    try:
        if _PERSISTENT_URL_PATH.is_file():
            data = json.loads(_PERSISTENT_URL_PATH.read_text(encoding="utf-8"))
            if isinstance(data, list):
                _persistent_used_image_urls = [
                    str(x).strip() for x in data if isinstance(x, str) and str(x).strip()
                ][-_PERSISTENT_URL_MAX:]
    except Exception as e:
        print(json.dumps({"stage": "image_url_state", "ok": False, "error": str(e)[:120]}, ensure_ascii=False))


def _save_persistent_url_state() -> None:
    try:
        _PERSISTENT_URL_PATH.write_text(
            json.dumps(_persistent_used_image_urls[-_PERSISTENT_URL_MAX:], ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception as e:
        print(json.dumps({"stage": "image_url_state_save", "ok": False, "error": str(e)[:120]}, ensure_ascii=False))


def _url_recently_used(url: str) -> bool:
    fp = _url_fingerprint(url)
    if not fp:
        return True
    return fp in _run_used_image_urls or fp in set(_persistent_used_image_urls)


def _extension_from_content_type(ct: str) -> str:
    low = (ct or "").split(";")[0].strip().lower()
    ext = mimetypes.guess_extension(low, strict=False) or ".bin"
    if ext == ".jpe":
        ext = ".jpg"
    if ext in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"):
        return ext
    if "avif" in low:
        return ".avif"
    return ".jpg"


def _download_bytes(url: str, timeout: float | None = None) -> tuple[bytes, str]:
    """Fetch image bytes; one extra attempt after 1s sleep on connect/read timeout only."""
    to = timeout if timeout is not None else float(REQUEST_TIMEOUT_SEC)

    def _once() -> tuple[bytes, str]:
        r = requests.get(url, headers=HEADERS, timeout=to, stream=True)
        try:
            r.raise_for_status()
            ct = (r.headers.get("Content-Type") or "").lower()
            data = r.content
            if not data:
                raise ValueError("empty image body")
            cl_raw = r.headers.get("Content-Length")
            if cl_raw:
                try:
                    expected = int(str(cl_raw).strip())
                    if expected > 0 and len(data) < expected:
                        raise ValueError("partial image body")
                except ValueError:
                    if "partial" in cl_raw.lower():
                        raise
            return data, ct
        finally:
            r.close()

    try:
        return _once()
    except RequestsTimeout:
        record_timeout_error()
        time.sleep(1)
        try:
            return _once()
        except RequestsTimeout:
            record_timeout_error()
            raise


def _bytes_look_like_raster_image(data: bytes) -> bool:
    if len(data) < 12:
        return False
    if data[:3] == b"\xff\xd8\xff":
        return True
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return True
    if len(data) >= 32 and data[4:8] == b"ftyp":
        tail = data[8:32]
        if b"avif" in tail or b"avis" in tail:
            return True
    return False


def _bytes_valid_image(data: bytes, content_type: str) -> bool:
    if _IMAGE_RELAX_DEBUG:
        return len(data) > 0
    if len(data) < MIN_IMAGE_BYTES:
        return False
    ct = (content_type or "").lower()
    if ct and not ct.startswith("image/") and "octet-stream" not in ct:
        return False
    if "svg" in ct:
        return False
    return _bytes_look_like_raster_image(data)


def _width_hint_from_url(url: str) -> int | None:
    try:
        q = parse_qs(urlparse(url).query)
    except Exception:
        return None
    for key in ("w", "width"):
        vals = q.get(key) or []
        for v in vals:
            try:
                n = int(str(v).strip())
                if n > 0:
                    return n
            except ValueError:
                continue
    return None


def _jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        i += 2
        if marker in (0xD8, 0xD9):
            continue
        if i + 2 > len(data):
            break
        seg_len = (data[i] << 8) + data[i + 1]
        if seg_len < 2 or i + seg_len > len(data):
            break
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7):
            if i + 7 < len(data):
                h = (data[i + 3] << 8) + data[i + 4]
                w = (data[i + 5] << 8) + data[i + 6]
                if w > 0 and h > 0:
                    return (w, h)
        i += seg_len
    return None


def _png_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    w = int.from_bytes(data[16:20], "big")
    h = int.from_bytes(data[20:24], "big")
    if w > 0 and h > 0:
        return (w, h)
    return None


def _gif_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 10 or data[:6] not in (b"GIF87a", b"GIF89a"):
        return None
    w = int.from_bytes(data[6:8], "little")
    h = int.from_bytes(data[8:10], "little")
    if w > 0 and h > 0:
        return (w, h)
    return None


def _webp_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 30 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None
    if data[12:16] == b"VP8X" and len(data) >= 30:
        w = 1 + int.from_bytes(data[24:27], "little")
        h = 1 + int.from_bytes(data[27:30], "little")
        if w > 0 and h > 0:
            return (w, h)
    return None


def _image_dimensions(data: bytes) -> tuple[int, int] | None:
    return _jpeg_dimensions(data) or _png_dimensions(data) or _gif_dimensions(data) or _webp_dimensions(data)


def is_image_relevant(image_url: str, article: dict[str, Any], meta_text: str = "") -> bool:
    blob = f"{image_url} {meta_text}".lower()
    title = (article.get("title") or "").lower()
    kw = (article.get("keyword_topic") or "").lower()
    words = set(_TOPIC_KEYWORDS)
    words.update(w for w in re.findall(r"[a-z0-9]+", title) if len(w) >= 4)
    words.update(w for w in re.findall(r"[a-z0-9]+", kw) if len(w) >= 3)
    return any(w in blob for w in words)


_STOP_IMG = frozenset(
    "that this with from your have been were will are was for and the you not but can may our out any all new how "
    "what when where which their there about into than then more most some very just also only".split()
)


def launch_signals_present(article: dict[str, Any]) -> bool:
    """True only when article text suggests a rocket/space launch story (not generic 'boat launch')."""
    blob = (
        f"{article.get('title') or ''} {article.get('keyword_topic') or ''} {(article.get('content') or '')}"
    ).lower()
    if "rocket" in blob or "spacex" in blob:
        return True
    if "launch" in blob:
        return True
    return False


def extract_image_keywords(article: dict[str, Any]) -> list[str]:
    """
    Lightweight keywords for Unsplash query and scoring (5–10 items): location, activity, time;
    rocket/launch terms only when `launch_signals_present`.
    """
    title = (article.get("title") or "").strip()
    kw = (article.get("keyword_topic") or "").strip()
    content = article.get("content") or ""
    headings = re.findall(r"(?m)^#{2,3}\s+(.+)$", content)
    plain = re.sub(r"#{1,6}\s*[^\n]+\n?", " ", content)
    plain = re.sub(r"[*_`>\[\]()]|!\[[^\]]*\]", " ", plain)
    plain = re.sub(r"\s+", " ", plain).strip()
    first_words = plain.split()[:400]
    blob = " ".join([title, kw] + headings + first_words).lower()

    out: list[str] = []
    seen: set[str] = set()

    def add(token: str) -> None:
        t = token.strip()
        if not t or len(t) < 3:
            return
        tl = t.lower()
        if tl in seen:
            return
        seen.add(tl)
        out.append(t)

    for phrase in (
        "daytona beach",
        "port orange",
        "indian river lagoon",
        "space coast",
        "halifax river",
        "cape canaveral",
    ):
        if phrase in blob:
            add(phrase.title())

    if "titusville" in blob:
        add("Titusville")
    if "daytona" in blob and "daytona beach" not in seen:
        add("Daytona")
    if "florida" in blob:
        add("Florida")

    for w in ("boating", "fishing", "charter", "rental", "pontoon", "lagoon", "boat"):
        if w in blob:
            add(w)

    for w in ("sunrise", "sunset", "night", "morning", "evening"):
        if w in blob:
            add(w)

    if launch_signals_present(article):
        for w in ("spacex", "rocket", "nasa"):
            if w in blob:
                add(w)
                break
        if "launch" in blob:
            add("launch")

    for tok in re.findall(r"[A-Za-z][A-Za-z0-9-]+", title):
        if len(tok) >= 4 and tok.lower() not in _STOP_IMG:
            add(tok)
        if len(out) >= 10:
            break

    if len(out) < 5:
        for filler in ("Florida", "boating", "lagoon", "Space Coast"):
            add(filler)
            if len(out) >= 5:
                break

    return out[:10]


def compute_image_score(hit: dict[str, str], keywords: list[str]) -> int:
    """Higher = better semantic match to article keywords (Unsplash meta/tags/url)."""
    meta = (hit.get("meta") or "").lower()
    tags = (hit.get("tags") or "").lower()
    url = (hit.get("url") or "").lower()
    text = f"{meta} {tags}"

    score = 0
    for kw in keywords:
        k = (kw or "").strip().lower()
        if len(k) < 3:
            continue
        if k in meta:
            score += 6
        elif k in text or k in url:
            score += 4

    for loc in ("daytona", "titusville", "florida", "lagoon", "coast", "ocean", "beach", "river"):
        if loc in text:
            score += 2

    for bad in ("logo", "icon", "illustration", "vector", "graphic", "mockup"):
        if bad in text:
            score -= 10

    return max(0, score)


def _passes_final_image_gate(url: str, data: bytes, ct: str, article: dict[str, Any], meta_text: str = "") -> bool:
    if not _bytes_valid_image(data, ct):
        return False
    dims = _image_dimensions(data)
    width = dims[0] if dims else _width_hint_from_url(url)
    if width is None:
        return False
    if width < MIN_IMAGE_WIDTH_PX:
        return False
    if not is_image_relevant(url, article, meta_text=meta_text):
        return False
    return True


def _save_cache(data: bytes, suffix: str) -> str:
    PIPELINE_IMAGE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{suffix}"
    path = PIPELINE_IMAGE_CACHE_DIR / name
    path.write_bytes(data)
    return str(path.resolve())


def _url_path_allows_relaxed_image(url: str) -> bool:
    u = (url or "").strip()
    if not u:
        return False
    try:
        parsed = urlparse(u)
    except Exception:
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def _prepend_hero_markdown(article: dict[str, Any], image_url: str, alt: str) -> None:
    _ = article, image_url, alt
    return


def _resolve_hero_from_url(url: str, article: dict[str, Any], meta_text: str = "") -> bool:
    print(f"[IMAGE CHECK] {url}")
    if not _url_path_allows_relaxed_image(url):
        print(f"[IMAGE REJECTED] {url}")
        return False
    print("IMAGE: trying URL:", url[:160])
    try:
        data, ct = _download_bytes(url)
        if _passes_final_image_gate(url, data, ct, article, meta_text=meta_text):
            suffix = _extension_from_content_type(ct)
            article["local_image"] = _save_cache(data, suffix)
            print("Downloaded image (validated):", article["local_image"])
            return True
        print(f"[IMAGE REJECTED] {url}")
        print("ERROR: image failed validation (size/type)", url[:120])
    except Exception as e:
        print(f"[IMAGE REJECTED] {url}")
        print("ERROR: image download failed:", str(e))
    return False


def _resolve_hero_builtin_fallback(url: str, article: dict[str, Any]) -> bool:
    """
    Last-resort stock CDN URL: byte/size checks only (skips semantic relevance — URL is curated).
    Used when Unsplash returns no hits or every candidate fails relevance/download.
    """
    print(f"[IMAGE CHECK] builtin_fallback {url}")
    if not _url_path_allows_relaxed_image(url):
        return False
    try:
        data, ct = _download_bytes(url)
        if not _bytes_valid_image(data, ct):
            print(f"[IMAGE REJECTED] builtin_fallback bytes {url[:120]}")
            return False
        dims = _image_dimensions(data)
        width = dims[0] if dims else _width_hint_from_url(url)
        if width is None or width < MIN_IMAGE_WIDTH_PX:
            print(f"[IMAGE REJECTED] builtin_fallback width {width} {url[:120]}")
            return False
        suffix = _extension_from_content_type(ct)
        article["local_image"] = _save_cache(data, suffix)
        article["image_source"] = "BUILTIN_FALLBACK"
        print("Downloaded image (builtin fallback):", article["local_image"])
        return True
    except Exception as e:
        print(f"[IMAGE REJECTED] builtin_fallback {url}: {e}")
    return False


def build_unsplash_search_query(article: dict[str, Any]) -> str:
    """Tier 1 string (for callers); full tier list lives in `unsplash_queries.build_unsplash_query_tiers`."""
    tiers = build_unsplash_query_tiers(extract_image_keywords(article), article)
    return tiers[0][1] if tiers else ""


def build_unsplash_search_query_tier2(article: dict[str, Any]) -> str:
    """Tier 2 string — prefer `build_unsplash_query_tiers` for the pipeline."""
    tiers = build_unsplash_query_tiers(extract_image_keywords(article), article)
    for t, q in tiers:
        if t == 2:
            return q
    return build_unsplash_search_query(article)


def unsplash_search_photo_urls(
    query: str, per_page: int = 10, *, tier: int | None = None
) -> list[dict[str, str]]:
    key = (UNSPLASH_ACCESS_KEY or "").strip()
    if not key:
        print(
            json.dumps(
                {
                    "stage": "unsplash_search",
                    "ok": False,
                    "reason": "no_UNSPLASH_ACCESS_KEY",
                    **({"tier": tier} if tier is not None else {}),
                },
                ensure_ascii=False,
            )
        )
        return []
    params = {
        "query": query,
        "per_page": min(per_page, 30),
        "orientation": "landscape",
    }
    headers = {
        "Authorization": f"Client-ID {key}",
        "Accept": "application/json",
        "User-Agent": HEADERS["User-Agent"],
    }
    url = "https://api.unsplash.com/search/photos"
    try:
        r = requests.get(url, params=params, headers=headers, timeout=25)
        if r.status_code == 429:
            record_unsplash_429()
        if r.status_code in _UNSPLASH_RETRYABLE_STATUS:
            time.sleep(2)
            r = requests.get(url, params=params, headers=headers, timeout=25)
            if r.status_code == 429:
                record_unsplash_429()
        r.raise_for_status()
        data = r.json()
        out: list[dict[str, str]] = []
        for item in data.get("results") or []:
            urls = item.get("urls") or {}
            u = urls.get("regular") or urls.get("small") or urls.get("full")
            if isinstance(u, str) and u.startswith("http"):
                meta = " ".join(
                    str(x).strip()
                    for x in (
                        item.get("alt_description") or "",
                        item.get("description") or "",
                    )
                    if str(x).strip()
                )
                tag_parts: list[str] = []
                for t in item.get("tags") or []:
                    if isinstance(t, dict) and t.get("title"):
                        tag_parts.append(str(t["title"]).strip())
                    elif isinstance(t, str) and t.strip():
                        tag_parts.append(t.strip())
                tags = " ".join(tag_parts)
                out.append({"url": u, "meta": meta, "tags": tags})
        payload: dict[str, Any] = {
            "stage": "unsplash_search",
            "ok": True,
            "count": len(out),
            "query": query[:120],
        }
        if tier is not None:
            payload["tier"] = tier
        print(json.dumps(payload, ensure_ascii=False))
        return out
    except RequestsTimeout:
        record_timeout_error()
        err_payload = {"stage": "unsplash_search", "ok": False, "error": "timeout"}
        if tier is not None:
            err_payload["tier"] = tier
        print(json.dumps(err_payload, ensure_ascii=False))
        return []
    except Exception as e:
        record_if_requests_timeout(e)
        err_payload: dict[str, Any] = {"stage": "unsplash_search", "ok": False, "error": str(e)[:200]}
        if tier is not None:
            err_payload["tier"] = tier
        print(json.dumps(err_payload, ensure_ascii=False))
        return []


def process_image(article: dict[str, Any]) -> dict[str, Any] | None:
    return process_image_strict(article)


def process_image_strict(article: dict[str, Any]) -> dict[str, Any]:
    """
    1) Scraped URL download  2) Re-scrape HTML  3) Unsplash API (dynamic query).
    Sets image_source, seo_keywords, image_alt, image_seo_filename; logs each stage.
    """
    title = (article.get("title") or "")[:500]
    article["pipeline_image_failed"] = False
    article["_image_keywords"] = extract_image_keywords(article)

    url_in: str | None = None
    raw = article.get("image_url")
    if isinstance(raw, str) and raw.strip().startswith("http"):
        url_in = raw.strip()

    source_url = ""
    for key in ("source_url", "url"):
        v = article.get(key)
        if isinstance(v, str) and v.strip().startswith("http"):
            source_url = v.strip()
            break

    def log_source(src: str, detail: str = "") -> None:
        article["image_source"] = src
        print(
            json.dumps(
                {"stage": "image_source", "source": src, "detail": detail[:200], "title": (title or "")[:80]},
                ensure_ascii=False,
            )
        )

    chosen: str | None = None
    instr = image_instrumentation_enabled()
    aid = article_id_hash(source_url or "", title) if instr else ""
    eval_total = 0
    chosen_tier: int | None = None

    # 1) Primary scraped URL
    if url_in:
        if _url_recently_used(url_in):
            url_in = None
        else:
            article["image_url"] = url_in
            primary_ok = _resolve_hero_from_url(url_in, article)
            if instr:
                eval_total += 1
                dh, fn = domain_and_filename(url_in)
                kwh = keywords_hit_list(f"{title} {url_in}")
                td, lp, sp = suggested_penalties(url_in, "", None, None)
                log_image_candidate(
                    article_id=aid,
                    title=title,
                    source="scraped",
                    url=url_in,
                    width=0,
                    height=0,
                    domain=dh,
                    filename=fn,
                    keywords_hit=kwh,
                    is_logo_like=is_logo_like_filename(url_in, ""),
                    is_small=False,
                    score_components={
                        "og_bonus": 0,
                        "keyword_match": 0,
                        "resolution": 0,
                        "trusted_domain": td,
                        "logo_penalty": lp,
                        "size_penalty": sp,
                    },
                    final_score=0,
                    selected=primary_ok,
                    reason_selected="primary_url_resolve_ok" if primary_ok else "primary_resolve_failed",
                    extra={"stage": "pipeline_primary"},
                )
            if primary_ok:
                chosen = url_in
                log_source("SCRAPED", "primary_url")
                _mark_url_used(chosen)

    # 2) Re-scrape publisher page
    if not chosen and source_url.startswith("http"):
        hero2 = rescrape_article_hero(source_url, title)
        if hero2 and not _url_recently_used(hero2):
            article["image_url"] = hero2
            article.pop("local_image", None)
            rescrape_ok = _resolve_hero_from_url(hero2, article)
            if instr:
                eval_total += 1
                dh, fn = domain_and_filename(hero2)
                kwh = keywords_hit_list(f"{title} {hero2}")
                td, lp, sp = suggested_penalties(hero2, "", None, None)
                log_image_candidate(
                    article_id=aid,
                    title=title,
                    source="scraped",
                    url=hero2,
                    width=0,
                    height=0,
                    domain=dh,
                    filename=fn,
                    keywords_hit=kwh,
                    is_logo_like=is_logo_like_filename(hero2, ""),
                    is_small=False,
                    score_components={
                        "og_bonus": 0,
                        "keyword_match": 0,
                        "resolution": 0,
                        "trusted_domain": td,
                        "logo_penalty": lp,
                        "size_penalty": sp,
                    },
                    final_score=0,
                    selected=rescrape_ok,
                    reason_selected="rescrape_resolve_ok" if rescrape_ok else "rescrape_resolve_failed",
                    extra={"stage": "rescrape_article_hero"},
                )
            if rescrape_ok:
                chosen = hero2
                log_source("SCRAPED", "rescrape_article_hero")
                _mark_url_used(chosen)

    # 3) Curated CDN stock when scrape/rescrape yield nothing usable.
    # Option B: keep Unsplash as true last-resort fallback.
    if not chosen:
        seen_builtin: set[str] = set()
        builtin_pool = (
            IMAGE_BOAT_URL,
            IMAGE_ROCKET_URL,
            SCRAPER_STOCK_IMAGE_FALLBACK,
            IMAGE_PIPELINE_FALLBACK,
            *HARD_FALLBACK_IMAGE_URLS,
        )
        # Pass 1: prefer non-recent fallback URLs.
        # Pass 2 (optional): if dedupe pool is saturated, allow recent fallback reuse
        # to avoid dropping the article purely due image rotation state.
        for pass_allow_recent in (False, _BUILTIN_FALLBACK_ALLOW_RECENT):
            if chosen:
                break
            for u in builtin_pool:
                u = (u or "").strip()
                if not u.startswith("http") or u in seen_builtin:
                    continue
                seen_builtin.add(u)
                if (not pass_allow_recent) and _url_recently_used(u):
                    continue
                article["image_url"] = u
                article.pop("local_image", None)
                if _resolve_hero_builtin_fallback(u, article):
                    chosen = u
                    chosen_tier = None
                    detail = "cdn_stock_allow_recent" if pass_allow_recent else "cdn_stock"
                    log_source("BUILTIN_FALLBACK", detail)
                    _mark_url_used(chosen)
                    print(
                        json.dumps(
                            {
                                "stage": "builtin_image_fallback",
                                "ok": True,
                                "allow_recent": bool(pass_allow_recent),
                                "url_preview": u[:160],
                            },
                            ensure_ascii=False,
                        )
                    )
                    break

    # 4) Unsplash search — last-resort fallback only.
    if not chosen and _UNSPLASH_LAST_RESORT_ONLY:
        img_keywords = article["_image_keywords"]
        for tier_num, q in build_unsplash_query_tiers(extract_image_keywords(article), article):
            hits = unsplash_search_photo_urls(q, per_page=12, tier=tier_num)
            if not hits:
                continue
            ranked = sorted(
                hits,
                key=lambda h: compute_image_score(h, img_keywords),
                reverse=True,
            )
            tier_logged = 0
            for hit in ranked:
                if tier_logged >= MAX_UNSPLASH_CANDIDATES_LOGGED_PER_TIER:
                    break
                u = (hit.get("url") or "").strip()
                meta = (hit.get("meta") or "").strip()
                if not u.startswith("http"):
                    continue
                tier_logged += 1
                eval_total += 1
                sc = compute_image_score(hit, img_keywords)
                dh, fn = domain_and_filename(u)
                blob = f"{meta} {u} {title}"
                kwh = keywords_hit_list(blob)
                td, lp, sp = suggested_penalties(u, meta, None, None)
                logo_guess = any(
                    x in (meta or "").lower() for x in ("logo", "icon", "vector")
                ) or is_logo_like_filename(u, meta)
                dup = _url_recently_used(u)
                val_ok = validate_image_url(u) if not dup else False
                rel_ok = is_image_relevant(u, article, meta_text=meta) if val_ok else False
                reason = "candidate"
                if dup:
                    reason = "recently_used_dedupe"
                elif not val_ok:
                    reason = "validate_failed"
                elif not rel_ok:
                    reason = "irrelevant"
                resolve_ok = False
                if not dup and val_ok and rel_ok:
                    article["image_url"] = u
                    article.pop("local_image", None)
                    resolve_ok = bool(_resolve_hero_from_url(u, article, meta_text=meta))
                    if not resolve_ok:
                        reason = "download_or_gate_failed"
                if instr:
                    log_image_candidate(
                        article_id=aid,
                        title=title,
                        source="unsplash",
                        url=u,
                        width=0,
                        height=0,
                        domain=dh,
                        filename=fn,
                        keywords_hit=kwh,
                        is_logo_like=logo_guess,
                        is_small=False,
                        score_components={
                            "og_bonus": 0,
                            "keyword_match": float(sc),
                            "resolution": 0,
                            "trusted_domain": td,
                            "logo_penalty": lp,
                            "size_penalty": sp,
                        },
                        final_score=sc,
                        selected=resolve_ok,
                        reason_selected=("unsplash_tier_pick" if resolve_ok else reason),
                        extra={"tier": tier_num, "query": q[:160]},
                    )
                if resolve_ok:
                    chosen = u
                    chosen_tier = tier_num
                    log_source(
                        "UNSPLASH_SEARCH",
                        f"tier{tier_num} score={sc} {q[:160]}",
                    )
                    _mark_url_used(chosen)
                    print(
                        json.dumps(
                            {
                                "stage": "unsplash_pick",
                                "tier": tier_num,
                                "score": sc,
                                "query": q[:120],
                            },
                            ensure_ascii=False,
                        )
                    )
                    break
            if chosen:
                break

    if instr and aid:
        sel_src = "none"
        if chosen:
            cu = str(chosen or "")
            if "images.unsplash.com" in cu or article.get("image_source") == "UNSPLASH_SEARCH":
                sel_src = "unsplash"
            else:
                sel_src = "scraped"
        log_image_article_summary(
            article_id=aid,
            title=title,
            selected_source=sel_src if chosen else "none",
            selected_url=str(chosen or article.get("image_url") or ""),
            selected_score=None,
            tier=chosen_tier,
            candidates_evaluated=eval_total,
            extra={"image_source": article.get("image_source"), "pipeline_stage": "process_image_strict"},
        )

    if not chosen:
        article["pipeline_image_failed"] = True
        article["image_url"] = ""
        article.pop("local_image", None)
        log_source("NONE", "no_valid_image")
        print(json.dumps({"stage": "image_warning", "message": "no_valid_image_found"}, ensure_ascii=False))
    else:
        seo = build_image_seo_fields(article)
        article["seo_keywords"] = seo["seo_keywords"]
        article["image_alt"] = (article.get("image_alt") or "").strip() or seo["image_alt"]
        article["image_seo_filename"] = seo.get("image_seo_filename") or ""

    _prepend_hero_markdown(article, str(article.get("image_url") or ""), str(article.get("image_alt") or ""))
    print(
        json.dumps(
            {
                "stage": "image_final",
                "image_source": article.get("image_source"),
                "url_preview": str(article.get("image_url") or "")[:120],
                "failed": bool(article.get("pipeline_image_failed")),
            },
            ensure_ascii=False,
        )
    )
    return article


__all__ = [
    "DEFAULT_IMAGE_WEB",
    "process_image",
    "process_image_strict",
    "reset_image_run_dedupe",
    "build_unsplash_search_query",
    "is_image_relevant",
    "extract_image_keywords",
    "compute_image_score",
    "launch_signals_present",
]
