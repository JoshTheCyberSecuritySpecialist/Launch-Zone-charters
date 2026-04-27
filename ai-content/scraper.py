"""
Launch Zone Charters content engine → Supabase raw_news (multi-source scrape, Ollama rewrite on web articles).

Clone of Elite flyboarding scraper pipeline with Florida rockets/boating niche. Original: scraper.py (unchanged).

Env (project root .env):
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Optional YouTube (RSS first, HTML /@handle/videos + oEmbed fallback — never aborts the run):
  Unlimited channels: any env key YOUTUBE_CHANNEL_<NAME>=value
    (e.g. YOUTUBE_CHANNEL_SPACEX=UC…|SpaceX). Label shown in logs is derived from <NAME>.
  Legacy bulk key YOUTUBE_CHANNEL_IDS (comma CSV) is ignored — use one YOUTUBE_CHANNEL_* per channel.
  Fallback / extra sources after those: YOUTUBE_HANDLES=comma-separated handle, @handle, or UC…
  Entry formats in YOUTUBE_CHANNEL_* values:
    UCxxxxxxxxxxxxxxxxxxxxxx           → RSS / channel listing
    @SomeChannel  or  SomeChannel  → /@handle/videos scrape
    UCxxxx|handle or UCxxxx|@handle     → RSS then HTML fallback for that channel

Per YouTube source the pipeline tries: RSS → /@handle/videos → /channel/UC…/videos → Google News RSS
web fallback (no uncaught errors; optional inserts use scrape_article for non-YouTube links).
"""

from __future__ import annotations

import html
import json
import random
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, TypedDict
from urllib.parse import quote_plus, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
import os
from pathlib import Path

import config as _lz_config  # noqa: F401 — loads dotenv via config.py
from config import (
    BOATING_MAG_RSS,
    FRESHNESS_MAX_AGE_DAYS,
    GOOGLE_NEWS_RSS_BIO_FL,
    GOOGLE_NEWS_RSS_BOATING_FL,
    GOOGLE_NEWS_RSS_DAYTONA_BOAT,
    GOOGLE_NEWS_RSS_FISHING_FL,
    GOOGLE_NEWS_RSS_PORT_ORANGE_WATER,
    GOOGLE_NEWS_RSS_ROCKET_LAUNCH_FL,
    GOOGLE_NEWS_RSS_SPACEX_LAUNCH,
    GOOGLE_NEWS_RSS_TITUSVILLE_WATER,
    NASA_RSS_FALLBACK,
    NEWS_JOURNAL_ONLINE_RSS,
    PIPELINE_TITLE_DENYLIST,
    PIPELINE_VERBOSE,
    SPORTFISHING_MAG_RSS,
    SPACECOAST_DAILY_RSS,
    SCRAPER_STOCK_IMAGE_FALLBACK,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL,
    UNSPLASH_ACCESS_KEY,
    YOUTUBE_HANDLES,
)

from scrapergates import *  # noqa: F403 — relevance gates, allowlist, pillar scoring

from image_instrumentation import (
    MAX_SCRAPER_CANDIDATES_LOGGED,
    article_id_hash,
    enabled as image_instrumentation_enabled,
    is_logo_like_filename,
    is_small_dimensions,
    keywords_hit_list,
    log_image_article_summary,
    log_image_candidate,
    suggested_penalties,
)
from pipeline_metrics import record_if_requests_timeout, record_unsplash_429
from unsplash_queries import build_scraper_rss_fallback_query

ROOT = Path(__file__).resolve().parent


def _one_line_title(s: str, max_len: int = 220) -> str:
    """RSS titles may include newlines; normalize for logs."""
    t = " ".join((s or "").split())
    return t[:max_len] if len(t) > max_len else t


# Last Captain's Log title (written by upload.py after insert) for topic rotation on the next fetch.
_TOPIC_ROTATION_STATE = ROOT / "topic_rotation_state.json"

SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY


def _load_topic_rotation_last_title() -> str:
    try:
        if _TOPIC_ROTATION_STATE.is_file():
            data = json.loads(_TOPIC_ROTATION_STATE.read_text(encoding="utf-8"))
            return (data.get("last_title") or "").strip()
    except Exception:
        pass
    return ""


def save_last_article_title_for_rotation(title: str) -> None:
    """Persist last published title so the next scrape can deprioritize repeating the same topic."""
    try:
        payload = {"last_title": (title or "").strip()[:500]}
        _TOPIC_ROTATION_STATE.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        print(f"[pipeline] topic rotation state write failed: {e}")


_LAST_RSS_PICK_BY_TOPIC = ROOT / "last_selected_rss_by_topic.json"
# Cross-run dedupe: last N article URLs picked by the pipeline (reduces repeating the same NASA row).
_PIPELINE_RECENT_URLS = ROOT / "pipeline_recent_urls.json"
_PIPELINE_RECENT_URLS_MAX = 12


def _load_recent_pipeline_urls() -> list[str]:
    try:
        if _PIPELINE_RECENT_URLS.is_file():
            data = json.loads(_PIPELINE_RECENT_URLS.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return [str(x).strip() for x in data if str(x).strip()][: _PIPELINE_RECENT_URLS_MAX]
    except Exception:
        pass
    return []


def _save_recent_pipeline_urls(urls: list[str]) -> None:
    try:
        clean = [str(u).strip() for u in urls if str(u).strip()][: _PIPELINE_RECENT_URLS_MAX]
        _PIPELINE_RECENT_URLS.write_text(json.dumps(clean, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        print(f"[pipeline] recent urls state write failed: {e}")


def _append_recent_pipeline_url(url: str) -> None:
    u = (url or "").strip()
    if not u.startswith("http"):
        return
    prev = _load_recent_pipeline_urls()
    key = u.split("#")[0].rstrip("/").lower()
    deduped = [x for x in prev if x.split("#")[0].rstrip("/").lower() != key]
    deduped.append(u)
    _save_recent_pipeline_urls(deduped[-_PIPELINE_RECENT_URLS_MAX:])


def _load_last_rss_url_for_topic(topic_id: str) -> str:
    try:
        if _LAST_RSS_PICK_BY_TOPIC.is_file():
            data = json.loads(_LAST_RSS_PICK_BY_TOPIC.read_text(encoding="utf-8"))
            return (data.get(topic_id) or "").strip()
    except Exception:
        pass
    return ""


def _save_last_rss_url_for_topic(topic_id: str, url: str) -> None:
    try:
        data: dict[str, Any] = {}
        if _LAST_RSS_PICK_BY_TOPIC.is_file():
            data = json.loads(_LAST_RSS_PICK_BY_TOPIC.read_text(encoding="utf-8"))
        data[topic_id] = (url or "").strip()[:800]
        _LAST_RSS_PICK_BY_TOPIC.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        print(f"[pipeline] last RSS pick state write failed: {e}")


def _is_rocket_tilted_content(title: str, summary: str) -> bool:
    """True if this row is primarily space/launch weighted (score rotation target)."""
    blob = f"{title} {summary}".lower()
    return bool(
        re.search(
            r"\b(rocket|spacex|falcon|launch|nasa|artemis|kennedy|space\s+center|cape\s+canaveral)\b",
            blob,
        )
    )

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
# Dedicated headers for image HEAD/GET checks (HTML Accept breaks some CDNs / og:image URLs).
IMAGE_CHECK_HEADERS = {
    **HEADERS,
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.5",
}
HTTP_TIMEOUT = 10

# Captain's Log relevance — title OR body must contain at least one (substring match, lowercase).
BOATING_SPACE_TOPIC_KEYWORDS: tuple[str, ...] = (
    "launch",
    "rocket",
    "space",
    "weather",
    "wind",
    "water",
    "boating",
    "lagoon",
    "fishing",
    "coast",
    "beach",
)


def is_boating_space_topic_relevant(title: str, text: str) -> bool:
    """True if title or text mentions any allowed keyword (case-insensitive substring)."""
    blob = f"{title} {text}".lower()
    return any(k in blob for k in BOATING_SPACE_TOPIC_KEYWORDS)

# RSS title+description — keep low so weak feeds still produce rows (body optional downstream)
MIN_RSS_COMBINED_WORDS = 8


def score_article(
    title: str,
    summary: str,
    *,
    last_article_title: str = "",
    article_url: str = "",
) -> int:
    blob = f"{title} {summary}".lower()
    title_lower = (title or "").lower()
    score = 0

    try:
        host = (urlparse(article_url or "").hostname or "").lower()
    except Exception:
        host = ""
    if host.startswith("www."):
        host = host[4:]

    # Space / launch — capped so boating & weather rows can compete (was uncapped high stack).
    _rocket_pts = 0
    if re.search(r"\bspacex\b", blob):
        _rocket_pts += 6
    if re.search(r"\bfalcon\b", blob):
        _rocket_pts += 5
    if re.search(r"\brocket\b", blob):
        _rocket_pts += 5
    if re.search(r"\blaunch\b", blob) and not _rocket_launch_brand_false_positive(blob):
        _rocket_pts += 4
    if re.search(r"\bnasa\b", blob):
        _rocket_pts += 4
    score += min(_rocket_pts, 22)

    _space_coast_local = (
        "daytona",
        "port orange",
        "titusville",
        "space coast",
        "cape canaveral",
    )
    if any(loc in blob for loc in _space_coast_local):
        score += 50

    # Weather & water conditions — stronger so marine/safety/forecast pieces score with launch news.
    if re.search(
        r"\b(weather|forecast|marine\s+forecast|wind|tide|tides|rip\s+current|rip\s+currents|surf|"
        r"swell|nws|small\s+craft|advisory|gale|storm|hurricane|lightning|flood|beach\s+hazard)\b",
        blob,
    ):
        score += 38
    if re.search(
        r"\b(water\s+conditions|rough\s+seas|seas|chop|buoy|wave\s+height|surf\s+height|"
        r"intracoastal|lagoon\s+conditions)\b",
        blob,
    ):
        score += 28

    if re.search(r"\barrest\b|\bmurder\b|\bshooting\b|\bcrime\b", blob):
        score -= 100

    if len(blob.split()) < 20:
        score -= 20

    # Bio / boat / fishing RSS (rocket terms often absent — keeps scores comparable across pillars)
    if re.search(r"\b(bioluminescent|bioluminescence|dinoflagellate)\b", blob):
        score += 30
    if re.search(r"\b(boat|boats|boating|yacht|marina|pontoon|hull|dock|charter|helm)\b", blob):
        score += 38
    if re.search(r"\b(fishing|angler|snook|redfish|trout|seatrout)\b", blob):
        score += 30
    if re.search(r"\blagoon\b", blob):
        score += 22

    if any(
        keyword in title_lower
        for keyword in (
            "things to do",
            "beach",
            "festival",
            "event",
            "park",
            "water",
            "boating",
            "weekend",
            "weather",
            "marine",
            "forecast",
            "tide",
            "wind",
        )
    ):
        score += 22

    if last_article_title and "rocket" in last_article_title.lower():
        if _is_rocket_tilted_content(title, summary):
            score = max(0, int(score * 0.5))
            print("[pipeline] topic rotation: deprioritized rocket/launch candidate (50% score)")

    # Niche: Volusia / Space Coast + boat rental or on-water activity keywords.
    if _local_geo_hit(blob) and re.search(
        r"\b(boat\s+rental|rentals?|pontoon|charter|halifax|lagoon|jetski|kayak|marina|sandbar|intracoastal)\b",
        blob,
    ):
        score += 24

    # Prefer Florida / Space Coast outlets; push down national NASA pages without local viewer angle.
    if host.endswith("nasa.gov") and not _has_space_coast_launch_intent(f"{title} {summary}"):
        score -= 55
    elif _is_local_launch_news_host(host):
        score += 30

    # Source tier — ranking only (does not drop rows; adjusts relative scores).
    _tier_fl_boost = (
        "spacecoastdaily.com",
        "floridatoday.com",
        "news-journalonline.com",
        "clickorlando.com",
        "wesh.com",
        "fox35orlando.com",
        "hometownnewsvolusia.com",
        "orlandosentinel.com",
        "tcpalm.com",
        "fox13news.com",
        "local10.com",
        "wkmg.com",
        "jacksonville.com",
        "tampabay.com",
        "visitspacecoast.com",
        "daytonabeach.com",
        "myfwc.com",
    )
    _tier_national_penalty = (
        "space.com",
        "spaceflightnow.com",
        "boatingindustry.com",
        "bairdmaritime.com",
    )
    if host.endswith("weather.gov") or host.endswith("noaa.gov"):
        score += 18
    elif any(host.endswith(s) for s in _tier_fl_boost):
        score += 14
    elif host.endswith("boatingmag.com") or host.endswith("sportfishingmag.com"):
        pass
    elif host.endswith("nasa.gov"):
        pass
    elif any(host.endswith(s) for s in _tier_national_penalty):
        score -= 12

    return score


OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "mistral"

# Listing pages: each is scraped for <a> links; see link_is_launch_related() for keyword filter.
sources = [
    {"name": "NASA News", "url": "https://www.nasa.gov/news-release/"},
    {"name": "SpaceX Updates", "url": "https://www.spacex.com/updates/"},
    {"name": "Florida Today Space", "url": "https://www.floridatoday.com/space/"},
    {"name": "Florida Today — News", "url": "https://www.floridatoday.com/"},
    {"name": "Space Coast Daily", "url": "https://spacecoastdaily.com/"},
    {"name": "Boating Magazine", "url": "https://www.boatingmag.com/"},
    {"name": "Sport Fishing Magazine", "url": "https://www.sportfishingmag.com/"},
    {"name": "Daytona Beach News-Journal", "url": "https://www.news-journalonline.com/"},
]


class ScrapedArticle(TypedDict, total=False):
    """Captain's Log pipeline row before Ollama rewrite (upload.py)."""

    title: str
    url: str
    category: str
    keyword_topic: str
    topic_id: str  # pipeline pillar id — used for relevance checks before rewrite
    image_url: str
    summary: str
    source: str
    publish_date: str
    content: str  # optional: full HTML scrape (RSS summary kept in summary)


# Hard title blocklist (politics / crime) — applied before scoring and before staging
PIPELINE_TITLE_HARD_BLOCKLIST: tuple[str, ...] = (
    "politics",
    "election",
    "crime",
    "arrest",
    "shooting",
    "iran",
    "israel",
    "gaza",
    "ukraine",
    "war",
    "missile",
    "fluoride",
    "drinking water",
    "water utility",
    "hit-and-run",
    "hit and run",
    "school bus",
    "crash",
    "collision",
    "students hurt",
    "injured",
    "dead",
    "killed",
    "hospitalized",
    "shooting",
    "stabbing",
    "amber alert",
)


def title_hard_blocked(title: str) -> bool:
    t = (title or "").lower()
    return any(k in t for k in PIPELINE_TITLE_HARD_BLOCKLIST)


def is_english_title(title: str) -> bool:
    """
    English/Latin titles — allows curly quotes and dashes common in publisher RSS;
    still blocks non-Latin scripts (e.g. Spanish diacritics in headlines).
    """
    t = title or ""
    t = (
        t.replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2013", "-")
        .replace("\u2014", "-")
    )
    try:
        t.encode("ascii")
    except UnicodeEncodeError:
        return False
    return True


def is_relevant_to_topic(title: str, topic_id: str) -> bool:
    """Pillar gate: title must match pillar keywords so RSS noise (politics, etc.) does not bind to wrong topic."""
    t = (title or "").lower()

    if topic_id == "bioluminescent-titusville":
        return any(
            k in t
            for k in (
                "bioluminescence",
                "bioluminescent",
                "lagoon",
                "water",
                "kayak",
                "tour",
                "night",
            )
        )

    if topic_id == "boating-port-orange":
        return any(k in t for k in ("boat", "boating", "water", "fishing", "charter"))

    if topic_id == "rocket-titusville":
        if _rocket_pillar_education_ceremony(title or "", ""):
            return False
        # Do not treat bare substring "launch" as rocket news (see Launch Credit Union, product launches).
        return _is_rocket_pillar_space_content(title or "", "")

    if topic_id == "fishing-irl":
        return any(
            k in t
            for k in (
                "fish",
                "fishing",
                "angler",
                "snook",
                "redfish",
                "trout",
                "lagoon",
                "inshore",
                "offshore",
                "tarpon",
                "drum",
                "seatrout",
                "bass",
            )
        )

    return True


# —— Captain's Log pipeline (upload.py): pillar metadata + real RSS per topic in fetch_all() ——
# image_url often filled in upload after scrape_article_for_pipeline (og:image / hero img).
PIPELINE_CONTROLLED_TOPIC_SPECS: list[dict[str, str]] = [
    {
        "id": "bioluminescent-titusville",
        "keyword_topic": "bioluminescent tours Titusville Florida",
        "title": "Bioluminescent night tours in Titusville along the Indian River Lagoon",
        "category": "Water Adventures",
        "summary": (
            "Bioluminescent algae and dinoflagellates light up calm nights on the Indian River Lagoon near Titusville "
            "and the Max Brewer Bridge. Motor boats often produce the brightest glowing wake compared with paddle-only "
            "craft. Peak season runs late spring through early fall when salinity and temperature align; check wind, "
            "moon phase, and cloud cover before planning a night run. Launch Zone Charters runs private evening trips "
            "for small groups who want a smooth ride and a long glowing trail behind the hull."
        ),
    },
    {
        "id": "rocket-titusville",
        "keyword_topic": "rocket launches Titusville Florida",
        "title": "Rocket launches and Space Coast viewing from the Titusville waterfront",
        "category": "Launch Updates",
        "summary": (
            "Titusville sits across the Indian River from Cape Canaveral and Kennedy Space Center, offering wide-lens "
            "views of Falcon 9, Falcon Heavy, and NASA launches. Playalinda beaches, the Max Brewer Bridge, and the "
            "Intracoastal are popular public sight lines; schedules slip with weather and range safety. Boaters should "
            "respect security zones, use running lights at night, and monitor marine VHF for updates. A calm lagoon "
            "run can pair launch viewing with bioluminescence when dates line up."
        ),
    },
    {
        "id": "boating-port-orange",
        "keyword_topic": "boating in Port Orange Florida",
        "title": "Boating in Port Orange: Halifax River access and day-boat outings",
        "category": "Boating Tips",
        "summary": (
            "Port Orange spans the Halifax River and connects Daytona Beach-area boaters to the Intracoastal Waterway. "
            "Ramps and marinas serve center consoles, pontoons, and deck boats heading south toward Ponce Inlet or north "
            "toward Palm Coast. Watch idle-speed and manatee zones, carry required safety gear, and plan fuel plus tide "
            "for skinny-water cuts. Evening cruises pair well with sunset on the river; night runs need proper lighting "
            "and afloat navigation cues."
        ),
    },
    {
        "id": "fishing-irl",
        "keyword_topic": "fishing Indian River Lagoon",
        "title": "Inshore fishing the Indian River Lagoon: tides, targets, and ethics",
        "category": "Local Highlights",
        "summary": (
            "The Indian River Lagoon supports snook, redfish, seatrout, black drum, and seasonal tarpon from Titusville "
            "to Stuart. Focus moving water around docks, mangrove edges, and grass flats; live shrimp and artificial "
            "paddle tails work year-round with light tackle. Check FWC regulations for size and bag limits, avoid props "
            "in shallow seagrass, and handle fish for quick release during warm months. Bridge shadow lines and night "
            "tides add options for experienced anglers."
        ),
    },
    {
        "id": "things-to-do-water-local",
        "keyword_topic": "things to do on the water Daytona Beach Port Orange Titusville",
        "title": "Best things to do on the water in Daytona Beach, Port Orange, and Titusville",
        "category": "Local Highlights",
        "summary": (
            "From Daytona Beach and Port Orange to Titusville, visitors can plan full on-water days with "
            "pontoon rentals, scenic lagoon cruises, and launch-viewing outings. Halifax River, Ponce Inlet, "
            "and the Indian River Lagoon offer easy options for family trips, wildlife watching, and sunset "
            "boating. Conditions change fast on the coast, so check marine forecasts, tide windows, and ramp "
            "timing before heading out."
        ),
    },
]

PIPELINE_CONTROLLED_TOPICS: tuple[str, ...] = tuple(s["keyword_topic"] for s in PIPELINE_CONTROLLED_TOPIC_SPECS)

# Google News RSS — boat rental & on-the-water activity intent (Daytona / Port Orange / Titusville).
_NICHE_WATER_GOOGLE_NEWS_FEEDS: list[str] = [
    u.strip()
    for u in (
        GOOGLE_NEWS_RSS_DAYTONA_BOAT,
        GOOGLE_NEWS_RSS_PORT_ORANGE_WATER,
        GOOGLE_NEWS_RSS_TITUSVILLE_WATER,
    )
    if (u or "").strip()
]

_ROCKET_GOOGLE_NEWS_FEEDS: list[str] = [
    u.strip()
    for u in (
        GOOGLE_NEWS_RSS_ROCKET_LAUNCH_FL,
        GOOGLE_NEWS_RSS_SPACEX_LAUNCH,
    )
    if (u or "").strip()
]

_BOATING_GOOGLE_NEWS_FEEDS: list[str] = [
    u.strip()
    for u in (
        GOOGLE_NEWS_RSS_BOATING_FL,
        GOOGLE_NEWS_RSS_DAYTONA_BOAT,
        GOOGLE_NEWS_RSS_PORT_ORANGE_WATER,
        GOOGLE_NEWS_RSS_TITUSVILLE_WATER,
    )
    if (u or "").strip()
]

_FISHING_GOOGLE_NEWS_FEEDS: list[str] = [
    u.strip() for u in (GOOGLE_NEWS_RSS_FISHING_FL,) if (u or "").strip()
]

_BIO_GOOGLE_NEWS_FEEDS: list[str] = [
    u.strip() for u in (GOOGLE_NEWS_RSS_BIO_FL,) if (u or "").strip()
]

# Canonical feed list (Florida Space Coast, Volusia, weather, backup). Also split into `RSS_FEEDS` for pillars.
RSS_URLS = [
    # 🔥 Space / launches (HIGH VALUE for your brand)
    SPACECOAST_DAILY_RSS,
    *_ROCKET_GOOGLE_NEWS_FEEDS,
    # 🔥 Weather (VERY good for boating content)
    "https://www.weather.gov/rss_page.php?site_name=mlb",  # Melbourne FL NWS
    # 🔥 Local boating/fishing/activity intent
    *_BOATING_GOOGLE_NEWS_FEEDS,
    *_FISHING_GOOGLE_NEWS_FEEDS,
    *_BIO_GOOGLE_NEWS_FEEDS,
]

# Central RSS catalog — mapped per pillar in `_feeds_for_topic_id`.
RSS_FEEDS: dict[str, list[str]] = {
    # Local Space Coast + Florida launch news only — not NASA national breaking RSS (repeats generic HQ stories).
    "Launch Updates": [
        SPACECOAST_DAILY_RSS,
        *_ROCKET_GOOGLE_NEWS_FEEDS,
    ],
    "Boating & Water": [
        BOATING_MAG_RSS,
        SPORTFISHING_MAG_RSS,
        *([NEWS_JOURNAL_ONLINE_RSS] if (NEWS_JOURNAL_ONLINE_RSS or "").strip() else []),
        "https://www.weather.gov/rss_page.php?site_name=mlb",
        *_BOATING_GOOGLE_NEWS_FEEDS,
        *_NICHE_WATER_GOOGLE_NEWS_FEEDS,
    ],
    "Local News": [
        *_BOATING_GOOGLE_NEWS_FEEDS,
    ],
    "Weather": [
        "https://www.weather.gov/rss_page.php?site_name=mlb",
    ],
    "Things To Do": [
        *_BOATING_GOOGLE_NEWS_FEEDS,
        *_BIO_GOOGLE_NEWS_FEEDS,
        *_NICHE_WATER_GOOGLE_NEWS_FEEDS,
    ],
    # Search-shaped Google News feeds — more Daytona / Port Orange / Titusville boat & water stories.
    "Volusia Brevard Water Niche": _NICHE_WATER_GOOGLE_NEWS_FEEDS,
}

# Competitor blog index or RSS feed URLs for `get_competitor_topics()` — titles only, never article bodies.
COMPETITOR_TOPIC_SOURCE_URLS: list[str] = []

# Pillar id → RSS_FEEDS keys (order preserved; URLs deduped).
# bioluminescent / boating: no "Things To Do" (broad Orlando/ClickOrlando) or "Local News" — reduces off-topic rows.
TOPIC_ID_TO_RSS_GROUPS: dict[str, list[str]] = {
    "rocket-titusville": ["Launch Updates"],
    "bioluminescent-titusville": ["Weather", "Boating & Water", "Volusia Brevard Water Niche"],
    "boating-port-orange": ["Boating & Water", "Volusia Brevard Water Niche", "Weather"],
    "fishing-irl": ["Boating & Water", "Local News", "Volusia Brevard Water Niche"],
    "things-to-do-water-local": [
        "Boating & Water",
        "Things To Do",
        "Volusia Brevard Water Niche",
        "Weather",
    ],
}

# Last `fetch_all()` counters (for upload.py logging)
_pipeline_debug: dict[str, Any] = {"links_raw": 0, "after_filter": 0}

MRSS_THUMB_TAG = "{http://search.yahoo.com/mrss/}thumbnail"

# YouTube: guaranteed thumbnail when we have a watch URL (11-char id).
YOUTUBE_WATCH_ID_RE = re.compile(
    r"(?:[?&]v=|/embed/|youtu\.be/)([a-zA-Z0-9_-]{11})",
    re.I,
)
YOUTUBE_THUMB_HQ = "https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
# Last-resort static thumb if URL cannot be parsed (rare).
YOUTUBE_PLACEHOLDER_THUMB = "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg"


def extract_youtube_video_id(url: str) -> str | None:
    m = YOUTUBE_WATCH_ID_RE.search(url or "")
    return m.group(1) if m else None


def normalize_youtube_entry(ent: dict[str, Any]) -> dict[str, str] | None:
    """
    Build a DB-safe YouTube row: non-empty title, url, content, thumbnail.
    Returns None if the record cannot be stored (skip without crashing).
    """
    try:
        url = (ent.get("url") or "").strip()
        if not url.startswith("http"):
            return None
        vid = extract_youtube_video_id(url)
        if not vid:
            return None
        canonical = f"https://www.youtube.com/watch?v={vid}"
        title = (ent.get("title") or "").strip()
        if not title:
            title = "YouTube video"
        thumb = (ent.get("thumbnail") or "").strip()
        if not thumb or is_bad_image_url(thumb):
            thumb = YOUTUBE_THUMB_HQ.format(vid=vid)
        if not thumb.startswith("http"):
            thumb = YOUTUBE_PLACEHOLDER_THUMB
        content = f"YouTube video: {title}"
        return {
            "title": title,
            "url": canonical,
            "content": content,
            "thumbnail": thumb,
        }
    except Exception as e:
        print(f"YouTube normalize skip (invalid entry {ent!r}): {e}")
        return None


def _token_channel_or_handle(token: str) -> tuple[str | None, str | None]:
    """Classify one env token as channel id (UC…) or @handle / handle."""
    t = token.strip()
    if not t:
        return None, None
    if t.upper().startswith("UC") and re.match(r"^UC[a-zA-Z0-9_-]{10,}$", t):
        return t, None
    ht = t[1:] if t.startswith("@") else t
    return None, (ht.strip() or None)


def _parse_youtube_source_spec(spec: str) -> tuple[str | None, str | None]:
    """Parse combined spec: UC…|@handle or single token."""
    spec = spec.strip()
    if not spec:
        return None, None
    channel_id: str | None = None
    handle: str | None = None
    for part in [p.strip() for p in spec.split("|") if p.strip()]:
        c, h = _token_channel_or_handle(part)
        if c:
            channel_id = c
        if h:
            handle = h
    return channel_id, handle


def _youtube_source_strings() -> list[tuple[str, str]]:
    """Return (label, spec) where spec is passed to fetch_youtube_videos (UC…, @handle, or UC…|handle)."""
    out: list[tuple[str, str]] = []
    seen_specs: set[str] = set()

    prefix = "YOUTUBE_CHANNEL_"
    for key, raw_val in sorted(os.environ.items()):
        if not key.startswith(prefix):
            continue
        # Legacy bulk CSV key — not a single-channel spec (deprecated)
        if key == "YOUTUBE_CHANNEL_IDS":
            continue
        spec = (raw_val or "").strip()
        if not spec:
            continue
        if spec in seen_specs:
            continue
        suffix = key[len(prefix) :].strip("_")
        label = suffix.replace("_", " ").title() if suffix else "YouTube"
        out.append((label, spec))
        seen_specs.add(spec)

    # Additional sources: YOUTUBE_HANDLES=handle1,@handle2,UC…,… (merged; dedupe by spec)
    handles_env = YOUTUBE_HANDLES.strip()
    handle_list = [h.strip() for h in handles_env.split(",") if h.strip()]
    seen_specs = {s for _, s in out}
    for raw in handle_list:
        if "|" in raw:
            spec = raw
            label_extra = f"YouTube ({raw})"
        elif raw.upper().startswith("UC") and re.match(r"^UC[a-zA-Z0-9_-]{10,}$", raw):
            spec = raw
            label_extra = f"YouTube ({raw})"
        else:
            hn = raw.lstrip("@").strip()
            if not hn:
                continue
            spec = f"@{hn}"
            label_extra = f"YouTube (@{hn})"
        if spec in seen_specs:
            continue
        seen_specs.add(spec)
        out.append((label_extra, spec))

    return out


def _youtube_oembed_meta(watch_url: str) -> tuple[str | None, str | None]:
    """Lightweight title + thumbnail from YouTube oEmbed (no API key)."""
    try:
        oe = requests.get(
            "https://www.youtube.com/oembed",
            params={"url": watch_url, "format": "json"},
            headers=HEADERS,
            timeout=HTTP_TIMEOUT,
        )
        if not oe.ok:
            return None, None
        data = oe.json()
        return data.get("title"), data.get("thumbnail_url")
    except Exception:
        return None, None


def _youtube_videos_from_listing_url(list_url: str, log_tag: str, max_videos: int = 20) -> list[dict[str, Any]]:
    """
    Shared HTML listing scraper for /@handle/videos and /channel/UC…/videos.
    Extracts videoId from embedded JSON / hrefs, then oEmbed + thumb fallback.
    """
    try:
        r = requests.get(list_url, headers=HEADERS, timeout=HTTP_TIMEOUT)
        r.raise_for_status()
    except Exception as e:
        print(f"YouTube listing page fetch failed {log_tag} ({list_url!r}): {e}")
        return []

    text = r.text
    ids_ordered: list[str] = []
    seen: set[str] = set()
    for m in re.finditer(r'"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"', text):
        vid = m.group(1)
        if vid in seen:
            continue
        seen.add(vid)
        ids_ordered.append(vid)
        if len(ids_ordered) >= max_videos:
            break
    if not ids_ordered:
        for m in re.finditer(
            r'(?:href="|\\u0026quot;)(?:https://)?(?:www\.)?youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})',
            text,
        ):
            vid = m.group(1)
            if vid in seen:
                continue
            seen.add(vid)
            ids_ordered.append(vid)
            if len(ids_ordered) >= max_videos:
                break

    rows: list[dict[str, Any]] = []
    for vid in ids_ordered[:max_videos]:
        watch = f"https://www.youtube.com/watch?v={vid}"
        title, thumb = _youtube_oembed_meta(watch)
        if not title:
            title = f"YouTube video {vid}"
        if not thumb or is_bad_image_url(thumb):
            thumb = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
        rows.append({"title": title, "url": watch, "thumbnail": thumb, "published": None})
    return rows


def parse_youtube_videos_from_channel_page(handle: str, max_videos: int = 20) -> list[dict[str, Any]]:
    """ /@HANDLE/videos """
    handle = handle.strip().lstrip("@").strip("/")
    if not handle:
        return []
    return _youtube_videos_from_listing_url(
        f"https://www.youtube.com/@{handle}/videos",
        f"@{handle}",
        max_videos,
    )


def fetch_youtube_videos(source: str) -> list[dict[str, Any]]:
    """
    Fetch videos for one configured source. Order:
      1) Atom RSS when channel_id (UC…) present
      2) /@handle/videos when handle present and still empty
      3) /channel/UC…/videos HTML when channel_id present and still empty
    Always returns a list (possibly empty); never raises.
    """
    entries: list[dict[str, Any]] = []
    channel_id, handle = _parse_youtube_source_spec(source)
    try:
        if channel_id:
            try:
                feed_url = yt_feed_url(channel_id)
                r = requests.get(feed_url, headers=HEADERS, timeout=HTTP_TIMEOUT)
                r.raise_for_status()
                entries = parse_youtube_feed(r.text)
            except Exception as e:
                print(f"YouTube RSS failed for {channel_id!r}: {e}")
                entries = []
            if not entries:
                print(f"[youtube] RSS empty or failed for {channel_id!r}")
        if not entries and handle:
            try:
                print(f"[youtube] trying /@{handle}/videos")
                entries = parse_youtube_videos_from_channel_page(handle)
            except Exception as e:
                print(f"YouTube @handle HTML failed for @{handle}: {e}")
                entries = []
        if not entries and channel_id:
            try:
                cid = channel_id.strip()
                ch_url = f"https://www.youtube.com/channel/{cid}/videos"
                print(f"[youtube] trying channel listing {ch_url!r}")
                entries = _youtube_videos_from_listing_url(ch_url, f"channel:{cid}")
            except Exception as e:
                print(f"YouTube channel /videos listing failed: {e}")
                entries = []
    except Exception as e:
        print(f"YouTube fetch_youtube_videos unexpected error ({source!r}): {e}")
        return []
    return entries


def _parse_rss_item_links(xml_text: str, limit: int) -> list[tuple[str, str]]:
    """RSS 2.0 / Atom: return (title, link) pairs."""
    out: list[tuple[str, str]] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        print(f"[web fallback] RSS/Atom parse error: {e}")
        return []
    for item in root.findall(".//item"):
        t_el = item.find("title")
        l_el = item.find("link")
        title = (t_el.text or "").strip() if t_el is not None and t_el.text else ""
        link = (l_el.text or "").strip() if l_el is not None and l_el.text else ""
        if link.startswith("http"):
            out.append((title or link, link))
        if len(out) >= limit:
            return out
    if out:
        return out
    atom_ns = "http://www.w3.org/2005/Atom"
    for entry in root.findall(f".//{{{atom_ns}}}entry"):
        t_el = entry.find(f"{{{atom_ns}}}title")
        title = (t_el.text or "").strip() if t_el is not None and t_el.text else ""
        link = ""
        for le in entry.findall(f"{{{atom_ns}}}link"):
            href = (le.get("href") or "").strip()
            if href.startswith("http"):
                link = href
                break
        if link:
            out.append((title or link, link))
        if len(out) >= limit:
            break
    return out


def fetch_web_articles_fallback(label: str, spec: str, max_items: int = 10) -> list[dict[str, Any]]:
    """
    When YouTube paths return nothing: Google News RSS search → YouTube or normal URLs.
    Returns YouTube-shaped dicts or {_web: True, title, url, source_name} for later scrape_article.
    Never raises.
    """
    _ = spec  # reserved for future query tuning
    out: list[dict[str, Any]] = []
    try:
        q = (
            f"{label} Florida rocket launch boating space coast"
            if (label or "").strip()
            else "Florida Space Coast rocket launch boating"
        ).strip()
        rss_url = f"https://news.google.com/rss/search?q={quote_plus(q)}&hl=en-US&gl=US&ceid=US:en"
        r = requests.get(rss_url, headers=HEADERS, timeout=HTTP_TIMEOUT)
        r.raise_for_status()
        pairs = _parse_rss_item_links(r.text, max_items * 3)
        for title, link in pairs:
            if not link_is_launch_related(title, link):
                continue
            if extract_youtube_video_id(link):
                out.append({"title": title or "YouTube video", "url": link, "thumbnail": None})
            else:
                src_name = f"Web fallback ({label})" if label else "Web fallback"
                out.append({"_web": True, "title": title or link, "url": link, "source_name": src_name})
            if len(out) >= max_items:
                break
    except Exception as e:
        print(f"[web fallback] failed for label={label!r}: {e}")
        return []
    return out


# Match link text/URL to Launch Zone niche (rockets, Space Coast, boating, water).
LAUNCH_ZONE_RE = re.compile(
    r"rocket|spacex|falcon|artemis|launch|nasa|"
    r"boating|boat|fishing|charter|water|lagoon|"
    r"bioluminescence|bioluminescent|"
    r"daytona|titusville|port orange|space coast|cape canaveral|"
    r"marine\s+conditions|boating\s+safety|local\s+events|weather",
    re.I,
)
# Reject only obvious junk filenames — do not scan full URL for "banner" (false positives on CDNs).
_BAD_IMAGE_FILENAME_RE = re.compile(
    r"(^|[-_/])(logo|icon|avatar|favicon|sprite)([-_.]|$)|(^|[-_])(logo|icon)\.(png|jpg|jpeg|webp)|[-_]icon\d*\.(png|jpg)",
    re.I,
)
# When scrape yields no usable hero — raster Unsplash (rocket theme), not tracking pixels
PIPELINE_DEFAULT_HERO_URL = "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa"
MIN_PARA_LEN = 40
MIN_PARA_TARGET = 5
MIN_ARTICLE_WORDS = 120
MIN_IMG_WIDTH_IF_KNOWN = 800
# Captain's Log pipeline: inline <img> with known width or height below this is skipped (og/twitter meta exempt).
PIPELINE_MIN_IMG_PX = 800
# Reject raster heroes smaller than this when Content-Length is present (tracking pixels, icons).
MIN_HERO_IMAGE_BYTES = 50 * 1024
IMG_RELEVANCE_RE = re.compile(
    r"boat|boating|water|fishing|florida|ocean|bay|lagoon|intracoastal|marine|dock|yacht|pontoon|"
    r"launch|rocket|space|saltwater|charter|harbor|vessel|coast",
    re.I,
)
BASE64_IMG_RE = re.compile(r"^\s*data:\s*image/", re.I)

def normalize_url(base: str, href: str | None) -> str | None:
    if not href or not isinstance(href, str):
        return None
    h = href.strip()
    if not h or h.startswith("#") or h.startswith("javascript:") or h.startswith("mailto:"):
        return None
    absolute = urljoin(base, h)
    parsed = urlparse(absolute)
    if parsed.scheme not in ("http", "https"):
        return None
    return absolute.split("#")[0]


def link_is_launch_related(title: str, url: str) -> bool:
    t = f"{title} {url}".lower()
    return bool(LAUNCH_ZONE_RE.search(t))


def is_bad_image_url(url: str | None) -> bool:
    if not url or not isinstance(url, str):
        return True
    u = url.strip()
    if BASE64_IMG_RE.match(u):
        return True
    u_low = u.lower()
    if not u_low.startswith("http"):
        return True
    try:
        path = urlparse(u).path
        pl = path.lower()
    except Exception:
        pl = ""
        path = ""
    if pl.endswith(".svg") or pl.endswith(".svgz"):
        return True
    base = path.rsplit("/", 1)[-1] if path else ""
    if base and _BAD_IMAGE_FILENAME_RE.search(base):
        return True
    if any(x in u_low for x in ("doubleclick.net", "googlesyndication.com", "/adview", "/ads/")):
        return True
    return False


def is_valid_image(url: str | None) -> bool:
    """
    Block obvious junk; prefer raster paths. Extensionless https URLs are allowed — many CDNs
    (`/resize/…`, signed URLs, `?format=webp`) omit extensions; `validate_image_url()` confirms bytes.
    """
    if not url:
        return False
    u = url.strip()
    if not isinstance(u, str):
        return False
    u_low = u.lower()
    if "facebook" in u_low:
        return False
    if "pixel" in u_low:
        return False
    if "tracker" in u_low:
        return False
    try:
        parsed = urlparse(u)
        path = parsed.path.lower()
    except Exception:
        return False
    if path.endswith(".svg") or path.endswith(".svgz"):
        return False
    if path.endswith(".gif"):
        return False
    if path.endswith((".jpg", ".jpeg", ".png", ".webp")):
        return True
    if "images.unsplash.com" in u_low and "/photo-" in path:
        return True
    if u_low.endswith((".jpg", ".jpeg", ".png", ".webp")):
        return True
    if parsed.scheme in ("http", "https") and parsed.netloc:
        return True
    return False


def _content_length_too_small_for_hero(cl_raw: str | None) -> bool:
    if not cl_raw:
        return False
    try:
        return int(str(cl_raw).strip()) < MIN_HERO_IMAGE_BYTES
    except ValueError:
        return False


def _word_count(text: str) -> int:
    return len(re.findall(r"\b[\w'-]+\b", (text or "").strip()))


def auto_tags(text: str) -> list[str]:
    """Part 7: lightweight topical tags from content."""
    t = (text or "").lower()
    raw: list[str] = []
    if "bioluminescence" in t or "bioluminescent" in t:
        raw.append("nature")
    if re.search(r"\b(boat|boats|boating|marine|vessel|pontoon|yacht|charter)\b", t):
        raw.append("boating")
    if re.search(r"\b(fish|fishing|angler)\b", t):
        raw.append("fishing")
    out: list[str] = []
    seen: set[str] = set()
    for x in raw if raw else ["local"]:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def parse_rewrite_title_body(raw: str, fallback_title: str) -> tuple[str, str]:
    """First line TITLE: … then body (Part 6 SEO titles)."""
    text = (raw or "").strip()
    m = re.match(r"(?is)^\s*TITLE:\s*(.+?)\s*\n\s*\n(.*)$", text)
    if m:
        return m.group(1).strip()[:500], m.group(2).strip()
    m2 = re.match(r"(?is)^\s*TITLE:\s*(.+?)\s*\n+(.*)$", text)
    if m2:
        return m2.group(1).strip()[:500], m2.group(2).strip()
    fb = (fallback_title or "Article").strip()[:500]
    return fb, text


def _img_effective_width(img: Any) -> int | None:
    """Best-effort width from tag attrs or srcset (e.g. 800w)."""
    w_attr = img.get("width")
    if w_attr:
        try:
            return int(str(w_attr).replace("px", "").strip())
        except ValueError:
            pass
    ss = (img.get("srcset") or "").strip()
    best: int | None = None
    for part in ss.split(","):
        part = part.strip()
        m = re.search(r"\s(\d+)w\s*$", part)
        if m:
            v = int(m.group(1))
            best = v if best is None else max(best, v)
    return best


def _img_effective_height(img: Any) -> int | None:
    h_attr = img.get("height")
    if h_attr:
        try:
            return int(str(h_attr).replace("px", "").strip())
        except ValueError:
            pass
    return None


def _pipeline_img_dims_ok(w: int | None, h: int | None) -> bool:
    """If width and/or height are known, require >= PIPELINE_MIN_IMG_PX."""
    if w is not None and w < PIPELINE_MIN_IMG_PX:
        return False
    if h is not None and h < PIPELINE_MIN_IMG_PX:
        return False
    return True


def _img_src_raw(img: Any) -> str:
    for key in ("src", "data-src", "data-lazy-src", "data-original", "data-lazy"):
        v = img.get(key)
        if v:
            if isinstance(v, list):
                v = v[0] if v else ""
            s = str(v).strip()
            if s:
                return s
    return ""


def _image_relevance_score(alt: str, img_url: str, title_hint: str) -> float:
    blob = f"{alt} {img_url} {title_hint}"
    return float(len(IMG_RELEVANCE_RE.findall(blob)))


def _image_size_score(width: int | None) -> float:
    if width is None:
        return 50.0
    if width >= 1200:
        return 200.0
    if width >= MIN_IMG_WIDTH_IF_KNOWN:
        return 100.0 + min(width / 12.0, 40.0)
    return float(width) * 0.05


def _url_suggests_image_extension(url: str) -> bool:
    """True if path ends with a common raster extension (query strings on URL are OK)."""
    try:
        path = urlparse(url).path.lower()
    except Exception:
        return False
    return path.endswith((".jpg", ".jpeg", ".png", ".webp"))


def _bytes_look_like_raster_image(data: bytes) -> bool:
    """JPEG / PNG / WebP / AVIF — catches `application/octet-stream` and mislabeled CDN responses."""
    if len(data) < 12:
        return False
    if data[:3] == b"\xff\xd8\xff":
        return True
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return True
    # ISO BMFF / AVIF (ftyp ... avif or avis)
    if len(data) >= 32 and data[4:8] == b"ftyp":
        tail = data[8:32]
        if b"avif" in tail or b"avis" in tail:
            return True
    return False


def _image_keyword_boost(url: str) -> float:
    u = url.lower()
    for k in ("boat", "water", "ocean", "fishing", "florida"):
        if k in u:
            return 50.0
    return 0.0


def validate_image_url(url: str, timeout: float = HTTP_TIMEOUT) -> bool:
    """HEAD when helpful; GET with Content-Type or magic-byte sniff (CDNs often mislabel)."""
    if not url or is_bad_image_url(url):
        return False
    if not is_valid_image(url):
        return False

    try:
        r = requests.head(url, headers=IMAGE_CHECK_HEADERS, timeout=timeout, allow_redirects=True)
        if r.status_code == 200:
            if _content_length_too_small_for_hero(r.headers.get("Content-Length")):
                return False
            ct = (r.headers.get("Content-Type") or "").lower().strip()
            if ct.startswith("image/"):
                return True
            if _url_suggests_image_extension(url):
                return True
    except Exception:
        pass

    try:
        gr = requests.get(url, headers=IMAGE_CHECK_HEADERS, timeout=timeout, stream=True)
        try:
            if gr.status_code != 200:
                return False
            if _content_length_too_small_for_hero(gr.headers.get("Content-Length")):
                return False
            ct = (gr.headers.get("Content-Type") or "").lower().strip()
            if ct.startswith("image/"):
                return True
            if _url_suggests_image_extension(url):
                return True
            chunk = next(gr.iter_content(chunk_size=16384), b"")
            if _bytes_look_like_raster_image(chunk):
                return True
            return False
        finally:
            gr.close()
    except Exception:
        return False


def _meta_content_image(soup: BeautifulSoup, page_url: str, **meta_kwargs: Any) -> str | None:
    el = soup.find("meta", meta_kwargs)
    if not el:
        return None
    raw = (el.get("content") or el.get("value") or "").strip()
    if not raw:
        return None
    if raw.startswith("//"):
        raw = "https:" + raw
    u = normalize_url(page_url, raw)
    if u and not is_bad_image_url(u) and is_valid_image(u):
        return u
    return None


def _candidate_passes_width(w: int | None, relaxed: bool) -> bool:
    if w is None:
        return True
    if w >= MIN_IMG_WIDTH_IF_KNOWN:
        return True
    return relaxed


def _gather_img_candidates(
    soup: BeautifulSoup,
    page_url: str,
    link_title: str,
    relaxed_width: bool,
    *,
    pipeline_mode: bool = False,
) -> list[tuple[str, str, int | None, str, int]]:
    """
    (url, source_label, width|None, alt, priority) — lower priority wins first (og=1).
    pipeline_mode: apply min pixel gate on <img> tags (og/twitter always kept).
    """
    out: list[tuple[str, str, int | None, str, int]] = []

    u = _meta_content_image(soup, page_url, property="og:image")
    if u:
        out.append((u, "og:image", None, "", 1))
    u = _meta_content_image(soup, page_url, property="og:image:url")
    if u:
        out.append((u, "og:image:url", None, "", 1))
    u = _meta_content_image(soup, page_url, property="og:image:secure_url")
    if u:
        out.append((u, "og:image:secure_url", None, "", 1))

    for name in ("twitter:image", "twitter:image:src"):
        tw = soup.find("meta", attrs={"name": name})
        if tw and tw.get("content"):
            raw = tw["content"].strip()
            if raw.startswith("//"):
                raw = "https:" + raw
            tu = normalize_url(page_url, raw)
            if tu and not is_bad_image_url(tu) and is_valid_image(tu):
                out.append((tu, f"meta:{name}", None, "", 2))

    article = soup.find("article")
    if article:
        for img in article.find_all("img"):
            src = _img_src_raw(img)
            if not src:
                continue
            if src.startswith("//"):
                src = "https:" + src
            iu = normalize_url(page_url, src)
            if not iu or is_bad_image_url(iu) or not is_valid_image(iu):
                continue
            alt = str(img.get("alt") or "")
            w = _img_effective_width(img)
            h = _img_effective_height(img)
            if pipeline_mode and not _pipeline_img_dims_ok(w, h):
                continue
            if not _candidate_passes_width(w, relaxed_width):
                continue
            out.append((iu, "article img", w, alt, 3))

    for img in soup.find_all("img"):
        src = _img_src_raw(img)
        if not src:
            continue
        if src.startswith("//"):
            src = "https:" + src
        iu = normalize_url(page_url, src)
        if not iu or is_bad_image_url(iu) or not is_valid_image(iu):
            continue
        alt = str(img.get("alt") or "")
        w = _img_effective_width(img)
        h = _img_effective_height(img)
        if pipeline_mode and not _pipeline_img_dims_ok(w, h):
            continue
        if not _candidate_passes_width(w, relaxed_width):
            continue
        out.append((iu, "img tag", w, alt, 4))

    # Dedupe by URL keep best priority / first occurrence
    seen: set[str] = set()
    deduped: list[tuple[str, str, int | None, str, int]] = []
    for row in sorted(out, key=lambda x: (x[4], x[0])):
        uurl = row[0].split("#")[0]
        if uurl in seen:
            continue
        seen.add(uurl)
        deduped.append(row)
    return deduped


def _source_label_to_instrument_source(label: str) -> str:
    bl = (label or "").lower()
    if bl.startswith("og") or "og:image" in bl:
        return "og"
    if bl.startswith("meta:twitter") or "twitter" in bl:
        return "twitter"
    return "img"


def _pick_best_scored_image(
    candidates: list[tuple[str, str, int | None, str, int]],
    link_title: str,
    *,
    instrument_page_url: str | None = None,
) -> tuple[str | None, int, int, float | None]:
    aid = (
        article_id_hash(instrument_page_url or "", link_title)
        if image_instrumentation_enabled() and instrument_page_url
        else ""
    )
    fail_logs = 0

    validated: list[tuple[str, str, int | None, str, int, float]] = []
    for url, label, w, alt, pri in candidates:
        src = _source_label_to_instrument_source(label)
        blob = f"{alt} {url} {link_title}"
        kwh = keywords_hit_list(blob)
        td, lp, sp = suggested_penalties(url, alt, w, None)
        logo_like = is_logo_like_filename(url, alt)
        small = is_small_dimensions(w, None)

        if not validate_image_url(url):
            if image_instrumentation_enabled() and aid and fail_logs < 24:
                log_image_candidate(
                    article_id=aid,
                    title=link_title,
                    source=src,
                    url=url,
                    width=int(w or 0),
                    height=0,
                    keywords_hit=kwh,
                    is_logo_like=logo_like,
                    is_small=small,
                    score_components={
                        "og_bonus": 0,
                        "keyword_match": 0,
                        "resolution": 0,
                        "trusted_domain": td,
                        "logo_penalty": lp,
                        "size_penalty": sp,
                    },
                    final_score=-1,
                    selected=False,
                    reason_selected="validate_failed",
                    extra={"label": label[:80]},
                )
                fail_logs += 1
            continue

        rel = _image_relevance_score(alt, url, link_title)
        sz = _image_size_score(w)
        boost = _image_keyword_boost(url)
        score = rel * 15 + sz - pri * 3 + boost
        validated.append((url, label, w, alt, pri, score))

    if not validated:
        return None, 0, fail_logs, None
    best = max(validated, key=lambda x: x[5])
    bl = best[1]

    if image_instrumentation_enabled() and aid:
        to_log = list(validated)
        if len(to_log) > MAX_SCRAPER_CANDIDATES_LOGGED:
            win_rows = [x for x in to_log if x[0] == best[0]]
            others = sorted([x for x in to_log if x[0] != best[0]], key=lambda x: -x[5])[
                : max(0, MAX_SCRAPER_CANDIDATES_LOGGED - len(win_rows))
            ]
            to_log = win_rows + others
        for u, lb, wv, al, pr, sc in to_log:
            rel_b = _image_relevance_score(al, u, link_title)
            sz_b = _image_size_score(wv)
            boost_b = _image_keyword_boost(u)
            km_b = rel_b * 15 + boost_b
            res_b = sz_b - pr * 3
            td_b, lp_b, sp_b = suggested_penalties(u, al, wv, None)
            log_image_candidate(
                article_id=aid,
                title=link_title,
                source=_source_label_to_instrument_source(lb),
                url=u,
                width=int(wv or 0),
                height=0,
                keywords_hit=keywords_hit_list(f"{al} {u} {link_title}"),
                is_logo_like=is_logo_like_filename(u, al),
                is_small=is_small_dimensions(wv, None),
                score_components={
                    "og_bonus": 0,
                    "keyword_match": round(km_b, 2),
                    "resolution": round(res_b, 2),
                    "trusted_domain": td_b,
                    "logo_penalty": lp_b,
                    "size_penalty": sp_b,
                },
                final_score=round(sc, 2),
                selected=u == best[0],
                reason_selected="highest_score" if u == best[0] else "not_selected",
                extra={"label": lb[:80]},
            )

    if bl.startswith("og") or bl in ("og:image:url", "og:image:secure_url"):
        print("[SCRAPER] Found og:image")
    elif bl.startswith("meta:twitter"):
        print("[SCRAPER] Found twitter:image")
    elif bl == "article img":
        print("[SCRAPER] Using article image")
    else:
        print("[SCRAPER] Using page img candidate")
    print(f"[SCRAPER] Picked image source={bl!r} score={best[5]:.1f}")
    return best[0], len(validated), fail_logs, float(best[5])


def _pick_first_valid_image(
    candidates: list[tuple[str, str, int | None, str, int]],
) -> str | None:
    """Second pass: first URL that validates — no width or relevance scoring."""
    for url, label, w, alt, pri in candidates:
        if validate_image_url(url):
            print(f"[SCRAPER] Picked relaxed image source={label!r}")
            return url
    return None


def extract_og_image(soup: BeautifulSoup, page_url: str) -> str | None:
    """Primary: Open Graph hero (`og:image`). Resolves relative URLs when `page_url` is set."""
    tag = soup.find("meta", property="og:image")
    if not tag:
        return None
    raw = (tag.get("content") or "").strip()
    if not raw:
        return None
    if raw.startswith("//"):
        raw = "https:" + raw
    u = normalize_url(page_url, raw) if page_url else (raw if raw.startswith("http") else None)
    if not u or is_bad_image_url(u) or not is_valid_image(u):
        return None
    return u


def extract_lazy_images(soup: BeautifulSoup, page_url: str) -> str | None:
    """Lazy-loaded heroes: `data-src` / `data-lazy-src` before `src` is hydrated."""
    for img in soup.find_all("img"):
        for attr in ("data-src", "data-lazy-src"):
            raw = img.get(attr)
            if not raw:
                continue
            if isinstance(raw, list):
                raw = raw[0] if raw else ""
            s = str(raw).strip()
            if not s:
                continue
            if s.startswith("//"):
                s = "https:" + s
            u = normalize_url(page_url, s) if page_url else (s if s.startswith("http") else None)
            if u and not is_bad_image_url(u) and is_valid_image(u):
                return u
    return None


def extract_first_image(soup: BeautifulSoup, page_url: str) -> str | None:
    """Last resort: first `<img src>` that resolves to http(s)."""
    for img in soup.find_all("img"):
        src = img.get("src")
        if not src:
            continue
        if isinstance(src, list):
            src = src[0] if src else ""
        s = str(src).strip()
        if not s:
            continue
        if s.startswith("//"):
            s = "https:" + s
        if not s.startswith("http"):
            continue
        u = normalize_url(page_url, s) if page_url else s
        if u and not is_bad_image_url(u) and is_valid_image(u):
            return u
    return None


def extract_best_image(html: str, page_url: str) -> str | None:
    """
    Fast fallback chain: og:image → lazy attributes → first valid img src.
    Use after scored candidates; still validates with `normalize_url` / `is_bad_image_url`.
    """
    soup = BeautifulSoup(html, "html.parser")
    return (
        extract_og_image(soup, page_url)
        or extract_lazy_images(soup, page_url)
        or extract_first_image(soup, page_url)
    )


def _try_immediate_og_and_twitter_images(
    soup: BeautifulSoup, page_url: str, link_title: str = ""
) -> tuple[str | None, str, int]:
    """
    Scrape-first: use first validated Open Graph image before any <img> scoring.
    Then twitter:image — still publisher-provided hero metadata.

    Returns (url_or_none, kind, candidates_evaluated) where kind is og|twitter|"".
    """
    aid = article_id_hash(page_url, link_title) if image_instrumentation_enabled() else ""
    evaluated = 0

    def _log_meta(url: str, source: str, *, ok: bool, prop: str) -> None:
        nonlocal evaluated
        evaluated += 1
        if not image_instrumentation_enabled() or not aid:
            return
        kwh = keywords_hit_list(f"{link_title} {url}")
        td, lp, sp = suggested_penalties(url, "", None, None)
        reason_sel = "validate_failed"
        if ok:
            reason_sel = "og_preferred" if source == "og" else "twitter_preferred"
        log_image_candidate(
            article_id=aid,
            title=link_title,
            source=source,
            url=url,
            width=0,
            height=0,
            keywords_hit=kwh,
            is_logo_like=is_logo_like_filename(url, ""),
            is_small=False,
            score_components={
                "og_bonus": 40 if source == "og" else 35,
                "keyword_match": 0,
                "resolution": 0,
                "trusted_domain": td,
                "logo_penalty": lp,
                "size_penalty": sp,
            },
            final_score=40 if source == "og" and ok else (35 if source == "twitter" and ok else -1),
            selected=ok,
            reason_selected=reason_sel,
            extra={"meta_property": prop[:80]},
        )

    for prop in ("og:image", "og:image:url", "og:image:secure_url"):
        u = _meta_content_image(soup, page_url, property=prop)
        if not u:
            continue
        if validate_image_url(u):
            _log_meta(u, "og", ok=True, prop=prop)
            print(
                json.dumps(
                    {"stage": "hero_pick", "source": prop, "mode": "og_immediate"},
                    ensure_ascii=False,
                )
            )
            return u, "og", evaluated
        _log_meta(u, "og", ok=False, prop=prop)

    for name in ("twitter:image", "twitter:image:src"):
        tw = soup.find("meta", attrs={"name": name})
        if tw and tw.get("content"):
            raw = tw["content"].strip()
            if raw.startswith("//"):
                raw = "https:" + raw
            tu = normalize_url(page_url, raw)
            if tu and not is_bad_image_url(tu) and is_valid_image(tu) and validate_image_url(tu):
                _log_meta(tu, "twitter", ok=True, prop=name)
                print(
                    json.dumps(
                        {"stage": "hero_pick", "source": f"meta:{name}", "mode": "twitter_immediate"},
                        ensure_ascii=False,
                    )
                )
                return tu, "twitter", evaluated
            if tu:
                _log_meta(tu, "twitter", ok=False, prop=name)
    return None, "", evaluated


def extract_best_page_image(
    soup: BeautifulSoup,
    page_url: str,
    link_title: str,
    *,
    pipeline_mode: bool = False,
) -> str | None:
    """Priority: validated og/twitter → scored <img> in article/page → lazy → first img."""
    aid = article_id_hash(page_url, link_title) if image_instrumentation_enabled() else ""
    print("[SCRAPER] Trying og:image / twitter:image (immediate)…")
    immediate, imm_kind, imm_ev = _try_immediate_og_and_twitter_images(soup, page_url, link_title)
    if immediate:
        if image_instrumentation_enabled() and aid:
            log_image_article_summary(
                article_id=aid,
                title=link_title,
                selected_source=imm_kind or "og",
                selected_url=immediate,
                selected_score=40 if imm_kind == "og" else 35,
                tier=None,
                candidates_evaluated=imm_ev,
                extra={"reason": "og_preferred" if imm_kind == "og" else "twitter_preferred"},
            )
        return immediate

    print("[SCRAPER] Trying article images (scored <img>)…")
    for relaxed in (False, True):
        candidates = _gather_img_candidates(
            soup, page_url, link_title, relaxed, pipeline_mode=pipeline_mode
        )
        subset = [c for c in candidates if c[4] >= 3]
        picked, n_val, n_fail, sc_pick = _pick_best_scored_image(
            subset, link_title, instrument_page_url=page_url
        )
        if picked:
            if image_instrumentation_enabled() and aid:
                log_image_article_summary(
                    article_id=aid,
                    title=link_title,
                    selected_source="img",
                    selected_url=picked,
                    selected_score=sc_pick,
                    tier=None,
                    candidates_evaluated=n_val + n_fail,
                    extra={"reason": "highest_score", "relaxed_width_pass": relaxed},
                )
            return picked

    print("[SCRAPER] Trying relaxed fallback images (body <img>)…")
    candidates = _gather_img_candidates(
        soup, page_url, link_title, relaxed_width=True, pipeline_mode=pipeline_mode
    )
    body_only = [c for c in candidates if c[4] >= 3]
    relaxed_pick = _pick_first_valid_image(body_only) or _pick_first_valid_image(candidates)
    if relaxed_pick:
        if image_instrumentation_enabled() and aid:
            log_image_article_summary(
                article_id=aid,
                title=link_title,
                selected_source="img",
                selected_url=relaxed_pick,
                selected_score=None,
                tier=None,
                candidates_evaluated=1,
                extra={"reason": "relaxed_first_valid"},
            )
        return relaxed_pick

    print("[SCRAPER] Trying extract_best_image (og → lazy → first img)…")
    best = extract_best_image(str(soup), page_url)
    if best and validate_image_url(best):
        print("[SCRAPER] extract_best_image fallback OK")
        if image_instrumentation_enabled() and aid:
            log_image_article_summary(
                article_id=aid,
                title=link_title,
                selected_source="img",
                selected_url=best,
                selected_score=None,
                tier=None,
                candidates_evaluated=1,
                extra={"reason": "extract_best_image_chain"},
            )
        return best
    if image_instrumentation_enabled() and aid:
        log_image_article_summary(
            article_id=aid,
            title=link_title,
            selected_source="none",
            selected_url="",
            selected_score=None,
            tier=None,
            candidates_evaluated=0,
            extra={"reason": "no_hero_found"},
        )
    return None


def fetch_unsplash_fallback(title: str, excerpt: str) -> str | None:
    key = UNSPLASH_ACCESS_KEY.strip()
    if not key:
        print("[SCRAPER] Unsplash: no UNSPLASH_ACCESS_KEY, skipping API fallback")
        return None
    q = build_scraper_rss_fallback_query(title, excerpt)
    try:
        r = requests.get(
            "https://api.unsplash.com/search/photos",
            params={"query": q, "per_page": 1, "orientation": "landscape"},
            headers={**HEADERS, "Authorization": f"Client-ID {key}"},
            timeout=HTTP_TIMEOUT,
        )
        if r.status_code == 429:
            record_unsplash_429()
        r.raise_for_status()
        data = r.json()
        results = data.get("results") or []
        if not results:
            return None
        u = (results[0].get("urls") or {}).get("regular") or (results[0].get("urls") or {}).get("full")
        if isinstance(u, str) and u.startswith("http") and validate_image_url(u):
            print(f"[SCRAPER] Fallback triggered: Unsplash query={q!r}")
            return u
    except Exception as e:
        record_if_requests_timeout(e)
        print(f"[SCRAPER] Unsplash fallback failed: {e}")
    return None


def strip_scraped_news_chaff(text: str) -> str:
    """
    Remove syndication footers, breadcrumb tails, and list-style sidebar dumps that many
    WordPress/news themes inject after the real article (e.g. Space Coast Daily).
    """
    t = (text or "").strip()
    if not t:
        return t
    # "The post TITLE appeared first on SITE."
    m = re.search(r"\bThe post .{0,260}? appeared first on .+?\.(?:\s|$)", t, re.I | re.DOTALL)
    if m:
        t = t[: m.start()].strip()
    elif re.search(r"\bappeared first on\b", t, re.I):
        t = re.split(r"\bappeared first on\b", t, maxsplit=1, flags=re.I)[0].strip()
    # Sidebar run often starts with bracketed dates then unrelated headlines
    cut = re.search(
        r"\s\[\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+"
        r"\d{1,2},\s*\d{4}\s*\]\s+(?:WATCH LIVE|BREAKING!|Brevard\b)",
        t,
        re.I,
    )
    if cut:
        t = t[: cut.start()].strip()
    t = re.sub(r"\s*Home\s*»[\s\S]{0,600}$", "", t, flags=re.I).strip()
    lines_out: list[str] = []
    for line in t.split("\n"):
        s = line.strip()
        if not s:
            continue
        if re.match(
            r"^\[\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+"
            r"\d{1,2},\s*\d{4}\s*\]",
            s,
            re.I,
        ):
            continue
        if re.match(
            r"^(WATCH LIVE:|BREAKING!|Brevard News|Brevard Crime News|Brevard Business News)\b",
            s,
            re.I,
        ):
            continue
        if re.search(r"to view this video please enable javascript", s, re.I):
            continue
        if re.search(r"consider upgrading to a web browser", s, re.I):
            continue
        if re.match(r"^Requests for Exhibits\b", s, re.I):
            continue
        if re.match(
            r"^(Human-Powered|Remote-Control)\s+.+\s+Division\s*$",
            s,
            re.I,
        ):
            continue
        if re.match(r"^(First Place|Second Place|Third Place):", s, re.I):
            continue
        lines_out.append(s)
    t = "\n\n".join(lines_out)
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    # Drop duplicate back-to-back paragraphs (common when CMS duplicates teaser + body)
    paras = [p.strip() for p in re.split(r"\n\s*\n+", t) if p.strip()]
    deduped: list[str] = []
    prev_key: str | None = None
    for p in paras:
        key = re.sub(r"\s+", " ", p)[:480]
        if prev_key is not None and key == prev_key and len(key) > 70:
            continue
        deduped.append(p)
        prev_key = key
    t = "\n\n".join(deduped)
    return t


def _clean_soup_chrome(soup: BeautifulSoup) -> None:
    for sel in (
        "script",
        "style",
        "noscript",
        "iframe",
        "nav",
        "header",
        "footer",
        "aside",
        "form",
    ):
        for el in soup.find_all(sel):
            el.decompose()
    for el in soup.find_all(attrs={"role": re.compile(r"navigation|banner|complementary", re.I)}):
        el.decompose()
    for el in soup.find_all(True):
        try:
            cls = " ".join(el.get("class") or []).lower()
            el_id = (el.get("id") or "").lower()
        except (AttributeError, TypeError):
            continue
        noise = (
            "advert" in cls
            or "ad-container" in cls
            or "sponsor" in cls
            or "banner-ad" in cls
            or "google_ads" in el_id
            or cls.startswith("ad-")
        )
        if noise:
            el.decompose()


def extract_article_content(soup: BeautifulSoup) -> str:
    """Real article text: prefer <article>/<main>, minimum paragraph depth, cleaned chrome."""
    root = (
        soup.find("article")
        or soup.find("main")
        or soup.select_one('[role="main"]')
        or soup.select_one(".entry-content, .post-content, .article-body, .story-body")
        or soup.body
        or soup
    )
    paras: list[str] = []
    min_len = MIN_PARA_LEN
    for p in root.find_all("p"):
        text = p.get_text(separator=" ", strip=True)
        text = re.sub(r"\s+", " ", text)
        if len(text) < min_len:
            continue
        paras.append(text)
    if len(paras) < MIN_PARA_TARGET:
        min_len = 25
        paras = []
        for p in root.find_all("p"):
            text = p.get_text(separator=" ", strip=True)
            text = re.sub(r"\s+", " ", text)
            if len(text) < min_len:
                continue
            paras.append(text)
    body = "\n\n".join(paras[:45])
    return strip_scraped_news_chaff(body)


def fetch_full_article(url: str) -> str | None:
    """
    Fetch article HTML and extract <p> text (prefer <article>, else all <p> on the page).
    Up to 2 attempts with short backoff; returns text only when word count exceeds 100.
    """
    non_retryable_statuses = {400, 401, 403, 404, 410, 451}
    for attempt in range(2):
        try:
            res = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT)
            res.raise_for_status()
            soup = BeautifulSoup(res.text, "html.parser")
            article = soup.find("article")
            if article:
                paragraphs = article.find_all("p")
            else:
                paragraphs = soup.find_all("p")
            content = " ".join([p.get_text() for p in paragraphs])
            content = re.sub(r"\s+", " ", content).strip()
            if len(content.split()) > 100:
                return content
        except Exception as e:
            print("[SCRAPE RETRY]", e)
            status_code = getattr(getattr(e, "response", None), "status_code", None)
            if status_code in non_retryable_statuses:
                print(f"[SCRAPE RETRY] non-retryable status {status_code}; skipping further retries")
                return None
        if attempt == 0:
            time.sleep(0.5)
    return None


def discover_links_from_page(list_url: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    try:
        r = requests.get(list_url, headers=HEADERS, timeout=HTTP_TIMEOUT)
        r.raise_for_status()
    except Exception as e:
        print(f"Error scraping list {list_url!r}: {e}")
        return out
    soup = BeautifulSoup(r.text, "html.parser")
    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        title = (a.get_text(separator=" ", strip=True) or a.get("title") or "").strip()
        url = normalize_url(list_url, href)
        if not url or url in seen:
            continue
        if not link_is_launch_related(title, url):
            continue
        seen.add(url)
        if not title:
            title = url
        out.append((title, url))
    return out


def rescrape_article_hero(page_url: str, link_title: str = "") -> str | None:
    """
    Re-fetch HTML and re-run hero extraction (reduces one-shot misses).
    Same validation as primary scrape (pipeline_mode).
    """
    fetch_url = (page_url or "").strip()
    if not fetch_url:
        return None
    if "news.google.com" in fetch_url.lower():
        resolved = resolve_rss_article_url(fetch_url)
        if resolved:
            fetch_url = resolved
    non_retryable_statuses = {400, 401, 403, 404, 410, 451}
    for attempt in range(2):
        try:
            r = requests.get(fetch_url, headers=HEADERS, timeout=HTTP_TIMEOUT)
            r.raise_for_status()
            soup_body = BeautifulSoup(r.text, "html.parser")
            image = extract_best_page_image(soup_body, fetch_url, link_title, pipeline_mode=True)
            if image and is_valid_image(image) and validate_image_url(image):
                print(
                    json.dumps(
                        {
                            "stage": "rescrape_article_hero",
                            "ok": True,
                            "attempt": attempt + 1,
                            "preview": (image or "")[:120],
                        },
                        ensure_ascii=False,
                    )
                )
                return image
        except Exception as e:
            print(f"[SCRAPER] rescrape_article_hero attempt {attempt + 1} failed:", e)
            status_code = getattr(getattr(e, "response", None), "status_code", None)
            if status_code in non_retryable_statuses:
                print(
                    f"[SCRAPER] rescrape_article_hero non-retryable status {status_code}; skipping retry"
                )
                break
        if attempt == 0:
            time.sleep(0.45)
    print(json.dumps({"stage": "rescrape_article_hero", "ok": False}, ensure_ascii=False))
    return None


def _scrape_article_impl(
    url: str, link_title: str = "", *, allow_image_fallback: bool
) -> tuple[str, str | None]:
    """Shared HTML fetch: content + hero URL. No Unsplash/stock unless allow_image_fallback."""
    fetch_url = (url or "").strip()
    # Google News transport pages rarely expose article hero images. Resolve publisher URL first.
    if "news.google.com" in fetch_url.lower():
        resolved = resolve_rss_article_url(fetch_url)
        if resolved and resolved != fetch_url:
            print("[SCRAPER] Resolved Google News URL for image scrape:", resolved[:160])
            fetch_url = resolved
    try:
        r = requests.get(fetch_url, headers=HEADERS, timeout=HTTP_TIMEOUT)
        r.raise_for_status()
    except Exception as e:
        record_if_requests_timeout(e)
        raise RuntimeError(str(e)) from e
    html_text = r.text
    soup_body = BeautifulSoup(html_text, "html.parser")
    pipeline_mode = not allow_image_fallback
    image = extract_best_page_image(soup_body, fetch_url, link_title, pipeline_mode=pipeline_mode)
    if not image:
        print("[SCRAPER] No strong image found, retrying relaxed mode...")
        image = extract_best_page_image(soup_body, fetch_url, link_title, pipeline_mode=pipeline_mode)
    if image and not is_valid_image(image):
        print(f"[SKIP IMAGE] {image}")
        image = None
    _clean_soup_chrome(soup_body)
    content = extract_article_content(soup_body)
    if not content or len(content.split()) < 100:
        print("[SKIP] weak content")
        return "", None
    if pipeline_mode and not validate_pipeline_fetched_content(content, link_title):
        return "", None
    if allow_image_fallback:
        if not image:
            print("[SCRAPER] Using default hero image (Unsplash)")
            image = PIPELINE_DEFAULT_HERO_URL
        if not image:
            print("[SCRAPER] Using Unsplash API fallback")
            image = fetch_unsplash_fallback(link_title, content)
        if not image:
            image = SCRAPER_STOCK_IMAGE_FALLBACK
            print("[SCRAPER] Fallback triggered: stock SCRAPER_STOCK_IMAGE_FALLBACK")
        if image and not validate_image_url(image):
            if validate_image_url(SCRAPER_STOCK_IMAGE_FALLBACK):
                image = SCRAPER_STOCK_IMAGE_FALLBACK
            else:
                image = YOUTUBE_PLACEHOLDER_THUMB
            print("[SCRAPER] Fallback triggered: stock (primary failed HEAD/GET check)")
    else:
        if image and not validate_image_url(image):
            print(f"[SKIP IMAGE] {image}")
            image = None
        print("Scraped image:", image)
    return content, image


def scrape_article_for_pipeline(url: str, link_title: str = "") -> tuple[str, str | None]:
    """Scrape article text and best-effort image URL only (no Unsplash/stock). Prints Scraped image."""
    return _scrape_article_impl(url, link_title, allow_image_fallback=False)


def scrape_article(url: str, link_title: str = "") -> tuple[str, str]:
    """Returns (content text, image_url). Image is always non-empty (validated / Unsplash / stock)."""
    content, image = _scrape_article_impl(url, link_title, allow_image_fallback=True)
    if not image:
        image = YOUTUBE_PLACEHOLDER_THUMB
    return content, image


def pick_og_image(soup: BeautifulSoup, page_url: str) -> str | None:
    """Backward-compatible helper: og:image meta only (same as extract_og_image)."""
    return extract_og_image(soup, page_url)


def pick_first_img(soup: BeautifulSoup, page_url: str) -> str | None:
    """Backward-compatible helper: first reasonable <img> (no validation)."""
    for img in soup.find_all("img"):
        src = _img_src_raw(img)
        if not src:
            continue
        if src.startswith("//"):
            src = "https:" + src
        u = normalize_url(page_url, src)
        if u and not is_bad_image_url(u):
            return u
    return None


def yt_feed_url(channel_id: str) -> str:
    return f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id.strip()}"


def parse_youtube_feed(xml_text: str) -> list[dict[str, Any]]:
    ns = {
        "atom": "http://www.w3.org/2005/Atom",
        "media": "http://search.yahoo.com/mrss/",
    }
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        print(f"YouTube RSS XML parse error: {e}")
        return []
    rows = []
    for entry in root.findall("atom:entry", ns):
        title_el = entry.find("atom:title", ns)
        title = title_el.text.strip() if title_el is not None and title_el.text else ""
        link_el = None
        for le in entry.findall("atom:link", ns):
            rel = (le.get("rel") or "").lower()
            href = le.get("href") or ""
            if rel in ("alternate", "") and "watch?v=" in href:
                link_el = le
                break
        if link_el is None:
            for le in entry.findall("atom:link", ns):
                href = le.get("href") or ""
                if "watch?v=" in href:
                    link_el = le
                    break
        video_url = link_el.get("href") if link_el is not None else ""
        pub_el = entry.find("atom:published", ns) or entry.find("atom:updated", ns)
        published = pub_el.text.strip() if pub_el is not None and pub_el.text else None
        thumb_url = None
        thumb = entry.find("media:thumbnail", ns)
        if thumb is None:
            for el in entry.iter():
                if el.tag == MRSS_THUMB_TAG:
                    thumb = el
                    break
        if thumb is not None:
            thumb_url = thumb.get("url")
        if thumb_url and is_bad_image_url(thumb_url):
            thumb_url = None
        if video_url.startswith("http"):
            if not (title or "").strip():
                title = "YouTube video"
            if not thumb_url:
                vid_guess = extract_youtube_video_id(video_url)
                if vid_guess:
                    thumb_url = YOUTUBE_THUMB_HQ.format(vid=vid_guess)
            rows.append(
                {
                    "title": title.strip(),
                    "url": video_url.strip(),
                    "thumbnail": thumb_url,
                    "published": published,
                }
            )
    return rows


def rewrite_with_ollama(title: str, content: str, url: str) -> str:
    import requests as _hq

    _ = url
    original_content = content or ""
    snippet = original_content[:2500]
    prompt = f"""You are writing a news-style local content article for Launch Zone Charters.

TASK:
Turn the SOURCE TEXT into a structured, clear, and useful summarized article.

IMPORTANT:
This is a SUMMARIZATION task — NOT a full rewrite.

You MUST stay grounded in the SOURCE TEXT.

GOALS:
- Sound like a local boating and charter news writer
- Be clear, structured, and useful
- Preserve the meaning of the source
- Improve readability ONLY

STRICT RULES:
- ONLY use facts from SOURCE TEXT
- DO NOT invent anything
- DO NOT expand beyond what is supported
- DO NOT add fake details
- If source is short → output is short
- No creative rewriting

OUTPUT FORMAT:
TITLE: <SEO headline based on source>

(blank line)

- 2 to 5 sections
- Use ## headings
- Keep paragraphs short
- Organize content logically

LOCAL CONTEXT:
Only include Daytona Beach, Port Orange, Titusville, Space Coast IF mentioned or clearly implied.

BACKLINK:
Add at end:

Related:
[Launch Zone Charters](https://launchzonecharters.com)

CTA:
Launch Zone Charters — Call or Text 803-542-1761
https://launchzonecharters.com

SOURCE TITLE:
{title}

SOURCE TEXT:
{snippet}

Return ONLY formatted article.
"""

    fallback_bundle = f"TITLE: {title}\n\n{original_content}".strip()
    out: str | None = None
    for attempt in range(2):
        try:
            start = time.time()
            response = _hq.post(
                OLLAMA_URL,
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": True,
                },
                timeout=180,
                stream=True,
            )
            response.raise_for_status()
            chunks: list[str] = []
            try:
                for line in response.iter_lines(decode_unicode=False):
                    if not line:
                        continue
                    try:
                        data = json.loads(line.decode("utf-8"))
                        piece = data.get("response", "")
                        if isinstance(piece, str):
                            chunks.append(piece)
                    except Exception:
                        continue
            finally:
                response.close()
            out = "".join(chunks)
            print(f"[SCRAPER] Ollama took {time.time() - start:.2f}s")
            break
        except Exception as e:
            print(f"[SCRAPER] Ollama attempt {attempt + 1} failed: {e}")
            if attempt == 1:
                return fallback_bundle

    try:
        if isinstance(out, str) and out.strip():
            rewritten = out.strip()
            _, body_check = parse_rewrite_title_body(rewritten, title)
            wc = _word_count(body_check)
            print(f"[SCRAPER] Rewrite output: {wc} words (body)")
            if len(body_check) > len(original_content) * 2:
                print("[SCRAPER] Rewrite too long → likely hallucinated → using original")
                return fallback_bundle
            if wc < 60 and len(rewritten) < 400:
                print("[SCRAPER] Rewrite thin; using source text bundle")
                return fallback_bundle
            if wc < 40:
                print("[SCRAPER] Rewrite very thin; using source text bundle")
                return fallback_bundle
            return rewritten
        return fallback_bundle
    except Exception as e:
        print(f"[SCRAPER] Ollama rewrite failed: {e}")
        return fallback_bundle


def scraper_pipeline_debug() -> dict[str, Any]:
    """Snapshot from the most recent `fetch_all()` run (link counts)."""
    return dict(_pipeline_debug)


def _strip_html_fragment(raw: str) -> str:
    t = re.sub(r"<[^>]+>", " ", raw or "")
    return re.sub(r"\s+", " ", t).strip()


_COMPETITOR_NAV_JUNK = frozenset(
    {
        "home",
        "about",
        "contact",
        "subscribe",
        "login",
        "search",
        "menu",
        "privacy",
        "terms",
        "read more",
        "more",
    }
)


def _normalize_headline_candidate(raw: str) -> str:
    raw = (raw or "").strip()
    if not raw:
        return ""
    if "<" in raw:
        raw = BeautifulSoup(raw, "html.parser").get_text(separator=" ", strip=True)
    raw = html.unescape(raw)
    return re.sub(r"\s+", " ", raw).strip()


def _looks_like_post_headline(text: str) -> bool:
    t = (text or "").strip()
    if len(t) < 12 or len(t) > 220:
        return False
    low = t.lower()
    if low in _COMPETITOR_NAV_JUNK:
        return False
    if len(t.split()) < 2 and len(t) < 24:
        return False
    return True


def _response_looks_like_xml_feed(text: str) -> bool:
    s = (text or "").lstrip()[:1200].lower()
    return (
        s.startswith("<?xml")
        or "<rss" in s
        or "<feed" in s
        or "xmlns:atom" in s
        or "<rdf:rdf" in s
    )


def _titles_from_feed_xml_titles_only(xml_text: str, limit: int) -> list[str]:
    """RSS 2.0 / Atom: item/entry titles only (no descriptions, no content:encoded)."""
    out: list[str] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    for item in root.findall(".//item"):
        if len(out) >= limit:
            break
        t_el = item.find("title")
        raw = (t_el.text or "").strip() if t_el is not None and t_el.text else ""
        t = _normalize_headline_candidate(raw)
        if t and _looks_like_post_headline(t):
            out.append(t)
    if out:
        return out[:limit]
    atom_ns = "http://www.w3.org/2005/Atom"
    for entry in root.findall(f".//{{{atom_ns}}}entry"):
        if len(out) >= limit:
            break
        t_el = entry.find(f"{{{atom_ns}}}title")
        raw = (t_el.text or "").strip() if t_el is not None and t_el.text else ""
        t = _normalize_headline_candidate(raw)
        if t and _looks_like_post_headline(t):
            out.append(t)
    return out[:limit]


def _titles_from_blog_listing_html(html_text: str, limit: int) -> list[str]:
    """Best-effort headings from a blog index / category page (no per-article fetches)."""
    soup = BeautifulSoup(html_text, "html.parser")
    out: list[str] = []
    seen_lower: set[str] = set()
    selectors = (
        "article h2 a",
        "article h3 a",
        ".entry-title a",
        "h2.entry-title a",
        ".post-title a",
        ".post-title",
        "main h2 a",
        "main h3 a",
    )
    for sel in selectors:
        for el in soup.select(sel):
            if len(out) >= limit:
                return out[:limit]
            text = _normalize_headline_candidate(el.get_text(separator=" ", strip=True))
            if not text:
                continue
            key = text.lower()
            if key in seen_lower:
                continue
            if not _looks_like_post_headline(text):
                continue
            seen_lower.add(key)
            out.append(text)
    return out[:limit]


def get_competitor_topics(
    *,
    source_urls: list[str] | None = None,
    max_per_source: int = 25,
) -> list[str]:
    """
    Topic inspiration only: fetch competitor blog RSS feeds or listing pages and return post titles.

    Does not download article bodies, does not persist competitor text, and returns only headline strings.

    Example::

        [
            "Best time to go boating in Daytona Beach",
            "Top things to do on the water in Florida",
            "Boat safety tips for beginners",
        ]

    Populate `COMPETITOR_TOPIC_SOURCE_URLS` or pass `source_urls=`.
    """
    urls = [
        u.strip()
        for u in (source_urls if source_urls is not None else COMPETITOR_TOPIC_SOURCE_URLS)
        if (u or "").strip()
    ]
    if not urls:
        return []

    combined: list[str] = []
    seen: set[str] = set()
    for url in urls:
        try:
            r = requests.get(url, headers=HEADERS, timeout=HTTP_TIMEOUT)
            r.raise_for_status()
            body = r.text
        except Exception as e:
            print(f"[competitor topics] fetch failed {url!r}: {e}")
            continue

        if _response_looks_like_xml_feed(body):
            titles = _titles_from_feed_xml_titles_only(body, max_per_source)
        else:
            titles = _titles_from_blog_listing_html(body, max_per_source)

        for t in titles:
            k = t.lower().strip()
            if k in seen:
                continue
            seen.add(k)
            combined.append(t)

    return combined


def validate_pipeline_fetched_content(content: str, title: str = "") -> bool:
    """
    Full-page article text (fetch_source_text / extract_article_content):
    require minimum length and title or body matching boating/space topic keywords.
    """
    content = (content or "").strip()
    n_words = len(content.split())
    print(f"[SCRAPER] Content length: {n_words} words")
    if not content or n_words < 100:
        print("[SKIP] content too short or invalid")
        return False
    if not is_boating_space_topic_relevant(title, content):
        print("[SKIP] not relevant to boating/space use case")
        return False
    return True


def validate_rss_item_title_and_summary(title: str, summary_html: str) -> bool:
    """RSS gate: need a title or summary; light word floor; crime denylist only (topic fit is rewrite's job)."""
    summary = _strip_html_fragment(summary_html or "")
    combined = f"{title} {summary}".strip()
    n_words = len(combined.split())
    print(f"[SCRAPER] Content length: {n_words} words")
    if not (title or "").strip() and not summary.strip():
        print("[SKIP] empty title and summary")
        return False
    if not combined or n_words < MIN_RSS_COMBINED_WORDS:
        print("[SKIP] content too short")
        return False
    blob = combined.lower()
    if any(x in blob for x in PIPELINE_TITLE_DENYLIST):
        return False
    return True


def _rss_item_non_empty(title: str, summary_html: str) -> bool:
    """Last-resort gate: must have some text; denylist still applied."""
    summary = _strip_html_fragment(summary_html or "")
    combined = f"{title} {summary}".strip()
    if not combined:
        return False
    blob = combined.lower()
    if any(x in blob for x in PIPELINE_TITLE_DENYLIST):
        return False
    return True


def _parse_rss_article_items(xml_text: str, limit: int) -> list[dict[str, str]]:
    """RSS 2.0 / Atom: title, link, description/summary, pub date."""
    out: list[dict[str, str]] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        print(f"[fetch_all] RSS XML parse error: {e}")
        return []
    for item in root.findall(".//item"):
        t_el = item.find("title")
        l_el = item.find("link")
        d_el = item.find("description")
        p_el = item.find("pubDate")
        source_url = ""
        title = (t_el.text or "").strip() if t_el is not None and t_el.text else ""
        link = (l_el.text or "").strip() if l_el is not None and l_el.text else ""
        if not link.startswith("http"):
            g_el = item.find("guid")
            if g_el is not None and (g_el.text or "").strip():
                gt = (g_el.text or "").strip()
                if gt.startswith("http"):
                    link = gt
        desc = (d_el.text or "").strip() if d_el is not None and d_el.text else ""
        if not desc:
            for el in item.iter():
                tag = el.tag.split("}")[-1] if "}" in el.tag else el.tag
                if tag == "encoded" and (el.text or "").strip():
                    desc = _strip_html_fragment(el.text or "")[:8000]
                    break
        pub = (p_el.text or "").strip() if p_el is not None and p_el.text else ""
        s_el = item.find("source")
        if s_el is not None:
            source_url = (s_el.attrib.get("url") or "").strip()
        if not pub:
            dc_ns = "{http://purl.org/dc/elements/1.1/}"
            dc_date = item.find(f"{dc_ns}date")
            if dc_date is not None and (dc_date.text or "").strip():
                pub = (dc_date.text or "").strip()
        if link.startswith("http"):
            out.append(
                {
                    "title": title,
                    "link": link,
                    "summary": desc,
                    "pub": pub,
                    "source_url": source_url,
                }
            )
        if len(out) >= limit:
            return out
    if out:
        return out
    atom_ns = "http://www.w3.org/2005/Atom"
    for entry in root.findall(f".//{{{atom_ns}}}entry"):
        t_el = entry.find(f"{{{atom_ns}}}title")
        title = (t_el.text or "").strip() if t_el is not None and t_el.text else ""
        link = ""
        for le in entry.findall(f"{{{atom_ns}}}link"):
            href = (le.get("href") or "").strip()
            if href.startswith("http"):
                link = href
                break
        s_el = entry.find(f"{{{atom_ns}}}summary")
        summ = (s_el.text or "").strip() if s_el is not None and s_el.text else ""
        p_el = entry.find(f"{{{atom_ns}}}published")
        pub = (p_el.text or "").strip() if p_el is not None and p_el.text else ""
        source_url = ""
        src_el = entry.find(f"{{{atom_ns}}}source")
        if src_el is not None:
            link_el = src_el.find(f"{{{atom_ns}}}link")
            if link_el is not None:
                source_url = (link_el.get("href") or "").strip()
        if link.startswith("http"):
            out.append(
                {
                    "title": title,
                    "link": link,
                    "summary": summ,
                    "pub": pub,
                    "source_url": source_url,
                }
            )
        if len(out) >= limit:
            break
    return out


def _norm_dedupe_key(url: str) -> str:
    return url.strip().split("#")[0].rstrip("/").lower()


def _feeds_for_topic_id(topic_id: str) -> list[str]:
    """Merge RSS_FEEDS groups for a pipeline pillar; dedupe URLs; NASA fallback if empty."""
    groups = TOPIC_ID_TO_RSS_GROUPS.get(topic_id)
    if not groups:
        return [NASA_RSS_FALLBACK]
    seen: set[str] = set()
    out: list[str] = []
    for g in groups:
        for u in RSS_FEEDS.get(g, []):
            u = (u or "").strip()
            if u and u not in seen:
                seen.add(u)
                out.append(u)
    return out or [NASA_RSS_FALLBACK]


def resolve_rss_article_url(link: str) -> str | None:
    """Turn RSS item link into a publisher article URL (follow Google News redirects)."""
    link = (link or "").strip()
    if not link.startswith("http"):
        return None
    if "news.google.com" not in link.lower():
        return link.split("#")[0].rstrip("/") or None
    try:
        r = requests.get(
            link,
            timeout=HTTP_TIMEOUT,
            headers=HEADERS,
            allow_redirects=True,
        )
        final = (r.url or "").strip()
        if final.startswith("http") and "news.google.com" not in final.lower():
            return final.split("#")[0].rstrip("/") or None
    except Exception as e:
        record_if_requests_timeout(e)
        print(f"[RSS] Google News URL resolve failed: {e}")
    # Keep unresolved Google News URL instead of dropping the row entirely.
    return link.split("#")[0].rstrip("/") or None


def _parse_rss_pub_datetime(pub: str) -> datetime | None:
    """RFC 2822 (typical RSS) or ISO 8601 (typical Atom / some publisher feeds)."""
    pub = (pub or "").strip()
    if not pub:
        return None
    try:
        dt = parsedate_to_datetime(pub)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        pass
    try:
        raw = pub.replace("Z", "+00:00")
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _rss_pub_sort_key(pub: str) -> float:
    """Higher = newer (for sorting). Unknown dates sort low."""
    dt = _parse_rss_pub_datetime(pub)
    return dt.timestamp() if dt else 0.0


def _rss_item_fresh(pub: str, max_days: int) -> bool:
    if max_days <= 0:
        return True
    dt = _parse_rss_pub_datetime(pub)
    if not dt:
        return True
    age = datetime.now(timezone.utc) - dt
    return age.days <= max_days


def _pick_balanced_by_category(
    staged: list[tuple[int, ScrapedArticle]], n: int
) -> list[ScrapedArticle]:
    if n <= 0:
        return []
    staged_sorted = sorted(staged, key=lambda x: x[0])
    by_cat: dict[str, list[ScrapedArticle]] = {}
    for _, article in staged_sorted:
        by_cat.setdefault(article["category"], []).append(article)
    # Boating Tips before Water Adventures so small PIPELINE_TOP_N still includes on-water charter content.
    preferred = (
        "Launch Updates",
        "Boating Tips",
        "Water Adventures",
        "Local Highlights",
    )
    cats = [c for c in preferred if c in by_cat]
    for c in by_cat:
        if c not in cats:
            cats.append(c)
    out: list[ScrapedArticle] = []
    ptr = {c: 0 for c in by_cat}
    while len(out) < n:
        progressed = False
        for c in cats:
            if len(out) >= n:
                break
            lst = by_cat[c]
            i = ptr[c]
            if i < len(lst):
                out.append(lst[i])
                ptr[c] = i + 1
                progressed = True
        if not progressed:
            break
    return out


def _emergency_one_rss_article(
    seen_urls: set[str],
) -> tuple[int, ScrapedArticle] | None:
    """
    If every pillar failed to stage, pull one item from any feed using normal or minimal validation.
    Guarantees output when feeds returned rows but strict per-topic paths collided or emptied.
    """
    for jidx, spec in enumerate(PIPELINE_CONTROLLED_TOPIC_SPECS):
        topic_id = spec["id"]
        feeds = _feeds_for_topic_id(topic_id)
        for feed_url in feeds:
            try:
                r = requests.get(
                    feed_url,
                    timeout=HTTP_TIMEOUT,
                    headers={**HEADERS, "Accept": "application/rss+xml, application/xml, text/xml, */*"},
                )
                r.raise_for_status()
                items = _parse_rss_article_items(r.text, limit=40)
                for it in items:
                    raw_link = (it.get("link") or "").strip()
                    if not raw_link:
                        continue
                    pub = (it.get("pub") or "").strip()
                    if not _rss_item_fresh(pub, FRESHNESS_MAX_AGE_DAYS):
                        continue
                    resolved = resolve_rss_article_url(raw_link)
                    if not resolved:
                        continue
                    key = _norm_dedupe_key(resolved)
                    if key in seen_urls:
                        continue
                    raw_title = it.get("title") or ""
                    raw_summary = it.get("summary") or ""
                    if not (
                        validate_rss_item_title_and_summary(raw_title, raw_summary)
                        or _rss_item_non_empty(raw_title, raw_summary)
                    ):
                        continue
                    if title_hard_blocked(raw_title):
                        continue
                    if is_hard_excluded_content(raw_title, raw_summary, resolved):
                        continue
                    if not is_english_title(raw_title):
                        print(f"[SKIP] non-english → {raw_title[:200]}")
                        continue
                    if not is_relevant_to_topic_with_summary(
                        raw_title,
                        raw_summary,
                        topic_id,
                        resolved,
                        it.get("source_url") or "",
                    ):
                        continue
                    title = (it.get("title") or spec["title"]).strip() or spec["title"]
                    summary = _strip_html_fragment(it.get("summary") or "")[:4000]
                    host = urlparse(resolved).hostname or "rss"
                    full_content = _optional_pipeline_full_article_body(resolved)
                    art: ScrapedArticle = {
                        "title": title,
                        "url": resolved,
                        "category": spec["category"],
                        "keyword_topic": spec["keyword_topic"],
                        "topic_id": topic_id,
                        "source_hint_url": (it.get("source_url") or "").strip(),
                        "image_url": "",
                        "summary": summary or spec["summary"][:2000],
                        "source": host,
                        "publish_date": (it.get("pub") or "").strip() or None,
                    }
                    if full_content and full_content.strip():
                        art["content"] = full_content
                    seen_urls.add(key)
                    _append_recent_pipeline_url(resolved)
                    print(
                        json.dumps(
                            {
                                "[DEBUG] emergency_staged": (title or "")[:120],
                                "topic_id": topic_id,
                                "url": (resolved or "")[:200],
                            },
                            ensure_ascii=False,
                        )
                    )
                    return (jidx, art)
            except Exception as e:
                record_if_requests_timeout(e)
                print(f"[emergency] RSS fetch failed topic={topic_id} feed={feed_url[:80]}: {e}")
    return None


def _optional_pipeline_full_article_body(url: str) -> str:
    """Heavy HTML scrape — optional; RSS title+summary is the default trust path."""
    from config import PIPELINE_FETCH_FULL_ARTICLE

    if not PIPELINE_FETCH_FULL_ARTICLE:
        return ""
    try:
        return (fetch_full_article(url) or "").strip()
    except Exception as ex:
        record_if_requests_timeout(ex)
        print(f"[fetch_full_article] optional body failed: {ex}")
        return ""


def fetch_all() -> list[ScrapedArticle]:
    """
    Captain's Log pipeline: real RSS feeds per pillar, freshness filter, resolved article URLs.

    Hero `image_url` is often filled in upload via `scrape_article_for_pipeline` when the feed omits media.
    """
    global _pipeline_debug
    print("🚀 SCRAPER STARTED")

    from config import PIPELINE_FETCH_FULL_ARTICLE, PIPELINE_TOP_N

    if not PIPELINE_FETCH_FULL_ARTICLE:
        print(
            "[PIPELINE] RSS-first mode: full article HTML fetch is OFF "
            "(set PIPELINE_FETCH_FULL_ARTICLE=1 for optional richer body text)"
        )

    last_article_title = _load_topic_rotation_last_title()

    staged: list[tuple[int, ScrapedArticle]] = []
    seen_urls: set[str] = set()
    for _ru in _load_recent_pipeline_urls():
        seen_urls.add(_norm_dedupe_key(_ru))
    links_raw = 0
    reject_stats: dict[str, int] = {
        "freshness": 0,
        "resolve_fail": 0,
        "duplicate_recent": 0,
        "blocked": 0,
        "hard_excluded": 0,
        "irrelevant": 0,
        "rss_validation": 0,
        "non_english": 0,
        "launch_pr": 0,
        "low_score_pillar": 0,
    }

    for jidx, spec in enumerate(PIPELINE_CONTROLLED_TOPIC_SPECS):
        topic_id = spec["id"]
        feeds = _feeds_for_topic_id(topic_id)
        candidates: list[tuple[float, dict[str, str], str]] = []

        for feed_url in feeds:
            try:
                r = requests.get(
                    feed_url,
                    timeout=HTTP_TIMEOUT,
                    headers={**HEADERS, "Accept": "application/rss+xml, application/xml, text/xml, */*"},
                )
                r.raise_for_status()
                items = _parse_rss_article_items(r.text, limit=40)
                links_raw += len(items)
                for it in items:
                    raw_link = (it.get("link") or "").strip()
                    if not raw_link:
                        continue
                    pub = (it.get("pub") or "").strip()
                    if not _rss_item_fresh(pub, FRESHNESS_MAX_AGE_DAYS):
                        reject_stats["freshness"] += 1
                        continue
                    resolved = resolve_rss_article_url(raw_link)
                    if not resolved:
                        reject_stats["resolve_fail"] += 1
                        continue
                    if PIPELINE_VERBOSE:
                        print("🔗 CHECKING URL:", resolved)
                    key = _norm_dedupe_key(resolved)
                    if key in seen_urls:
                        if PIPELINE_VERBOSE:
                            print("❌ DUPLICATE URL:", resolved)
                            print(f"[SKIP] duplicate URL in fetch (cross-topic) -> {resolved[:120]}")
                        reject_stats["duplicate_recent"] += 1
                        continue
                    candidates.append((_rss_pub_sort_key(pub), it, resolved))
            except Exception as e:
                record_if_requests_timeout(e)
                print(f"[fetch_all] RSS fetch failed topic={topic_id} feed={feed_url[:80]}: {e}")

        candidates.sort(key=lambda x: -x[0])
        print(
            json.dumps(
                {"[DEBUG] fetched count": len(candidates), "topic_id": topic_id},
                ensure_ascii=False,
            )
        )

        scored: list[tuple[int, float, tuple[float, dict[str, str], str]]] = []

        for c in candidates:
            _sort_key, it, resolved_url = c
            if not resolved_url:
                continue

            raw_title = it.get("title") or ""
            raw_summary = it.get("summary") or ""
            title_lower = raw_title.lower()

            if is_hard_excluded_content(raw_title, raw_summary, resolved_url):
                reject_stats["hard_excluded"] += 1
                if PIPELINE_VERBOSE:
                    print(f"[SKIP] hard excluded → {_one_line_title(raw_title, 200)}")
                continue

            if title_hard_blocked(raw_title):
                reject_stats["blocked"] += 1
                if PIPELINE_VERBOSE:
                    print(f"[SKIP] blocked content → {_one_line_title(raw_title, 200)}")
                continue

            if not is_relevant_to_topic_with_summary(
                raw_title,
                raw_summary,
                topic_id,
                resolved_url,
                it.get("source_url") or "",
            ):
                reject_stats["irrelevant"] += 1
                if PIPELINE_VERBOSE:
                    print(f"[SKIP] irrelevant to topic → {_one_line_title(raw_title, 200)}")
                continue

            if not validate_rss_item_title_and_summary(raw_title, raw_summary):
                reject_stats["rss_validation"] += 1
                continue

            if not is_english_title(raw_title):
                reject_stats["non_english"] += 1
                if PIPELINE_VERBOSE:
                    print(f"[SKIP] non-english → {_one_line_title(raw_title, 200)}")
                continue

            if spec["category"] == "Launch Updates":
                if _LAUNCH_PR_TITLE_JUNK.search(raw_title) and not _has_space_coast_launch_intent(
                    f"{raw_title} {raw_summary}"
                ):
                    reject_stats["launch_pr"] += 1
                    if PIPELINE_VERBOSE:
                        print(f"[SKIP] launch PR / media pattern → {_one_line_title(raw_title, 200)}")
                    continue
                if "press release" in title_lower and not _has_space_coast_launch_intent(
                    f"{raw_title} {raw_summary}"
                ):
                    reject_stats["launch_pr"] += 1
                    if PIPELINE_VERBOSE:
                        print(f"[SKIP] generic press release (no local angle) → {_one_line_title(raw_title, 200)}")
                    continue

            score = score_article(
                raw_title,
                raw_summary,
                last_article_title=last_article_title,
                article_url=resolved_url,
            )
            if PIPELINE_VERBOSE:
                print(
                    json.dumps(
                        {
                            "stage": "SCORING",
                            "title": _one_line_title(raw_title, 300),
                            "topic": topic_id,
                            "score": score,
                        },
                        ensure_ascii=False,
                    )
                )
            scored.append((score, _sort_key, c))

        scored.sort(key=lambda x: (-x[0], -x[1]))

        if not scored:
            print(f"[fetch_all] no fresh RSS row for topic={topic_id} — pillar skipped")
            continue

        best_score = scored[0][0]
        min_score_required = 5
        if topic_id in (
            "boating-port-orange",
            "things-to-do-water-local",
            "fishing-irl",
            "bioluminescent-titusville",
        ):
            min_score_required = 3
        if best_score < min_score_required:
            reject_stats["low_score_pillar"] += 1
            print(
                json.dumps(
                    {
                        "stage": "SKIP_PILLAR",
                        "topic_id": topic_id,
                        "best_score": best_score,
                        "min_score_required": min_score_required,
                        "reason": "best_score_below_threshold",
                    },
                    ensure_ascii=False,
                )
            )
            continue

        # Top pool by score; drop last run's URL when other candidates exist (fresher rotation)
        score_pool: list[tuple[float, dict[str, str], str]] = [c for _, _, c in scored[:20]]

        last_pick = _load_last_rss_url_for_topic(topic_id)
        nk = _norm_dedupe_key
        last_k = nk(last_pick) if last_pick else ""
        if last_k:
            alt_pool = [c for c in score_pool if nk(c[2]) != last_k]
            if alt_pool:
                score_pool = alt_pool

        # Deterministic ordering: highest score/newest first (no random shuffle).
        try_order = list(score_pool)

        print(
            json.dumps(
                {
                    "[DEBUG] scored candidates": len(scored),
                    "[DEBUG] pool (top by score, cap 20)": len(score_pool),
                    "[DEBUG] try_order": len(try_order),
                    "topic_id": topic_id,
                    "excluded_last_used_url": bool(last_k),
                },
                ensure_ascii=False,
            )
        )

        staged_this_topic = False
        selected_this_topic = 0
        for attempt_idx, picked_row in enumerate(try_order):
            _sort_key, it, resolved_url = picked_row
            key = nk(resolved_url)
            if PIPELINE_VERBOSE:
                print("🔗 CHECKING URL:", resolved_url)
            if key in seen_urls:
                if PIPELINE_VERBOSE:
                    print("❌ DUPLICATE URL:", resolved_url)
                    print(f"[SKIP] duplicate URL (cross-topic) -> {resolved_url[:120]}")
                reject_stats["duplicate_recent"] += 1
                continue
            raw_for_gate = (it.get("title") or "").strip()
            if title_hard_blocked(raw_for_gate):
                reject_stats["blocked"] += 1
                if PIPELINE_VERBOSE:
                    print(f"[SKIP] blocked content → {_one_line_title(raw_for_gate, 200)}")
                continue
            if not is_english_title(raw_for_gate):
                reject_stats["non_english"] += 1
                if PIPELINE_VERBOSE:
                    print(f"[SKIP] non-english → {_one_line_title(raw_for_gate, 200)}")
                continue
            if not is_relevant_to_topic_with_summary(
                raw_for_gate,
                it.get("summary") or "",
                topic_id,
                resolved_url,
                it.get("source_url") or "",
            ):
                reject_stats["irrelevant"] += 1
                if PIPELINE_VERBOSE:
                    print(f"[SKIP] irrelevant to topic → {_one_line_title(raw_for_gate, 200)}")
                continue
            title = (it.get("title") or spec["title"]).strip() or spec["title"]
            summary = _strip_html_fragment(it.get("summary") or "")[:4000]
            host = urlparse(resolved_url).hostname or "rss"
            full_content = _optional_pipeline_full_article_body(resolved_url)
            art: ScrapedArticle = {
                "title": title,
                "url": resolved_url,
                "category": spec["category"],
                "keyword_topic": spec["keyword_topic"],
                "topic_id": topic_id,
                "source_hint_url": (it.get("source_url") or "").strip(),
                "image_url": "",
                "summary": summary or spec["summary"][:2000],
                "source": host,
                "publish_date": (it.get("pub") or "").strip() or None,
            }
            if full_content and full_content.strip():
                art["content"] = full_content
            seen_urls.add(key)
            _append_recent_pipeline_url(resolved_url)
            staged.append((jidx, art))
            _save_last_rss_url_for_topic(topic_id, resolved_url)
            staged_this_topic = True
            selected_this_topic += 1
            print(
                json.dumps(
                    {
                        "[DEBUG] selected article": (title or "")[:120],
                        "topic_id": topic_id,
                        "attempt": attempt_idx,
                        "url": (resolved_url or "")[:200],
                    },
                    ensure_ascii=False,
                )
            )
            # Balanced upstream fix: stage top 2 items per topic, not just one.
            if selected_this_topic >= 2:
                break

        if not staged_this_topic:
            print(f"[fetch_all] no article staged after {len(try_order)} tries topic={topic_id}")

    if not staged and links_raw > 0:
        em = _emergency_one_rss_article(seen_urls)
        if em:
            staged.append(em)
            print("[FALLBACK] emergency RSS row staged so the run is not empty")

    after_filter = len(staged)
    print("📦 FINAL CANDIDATES:", after_filter)
    picked = _pick_balanced_by_category(staged, PIPELINE_TOP_N)
    if not picked and staged:
        print("[FALLBACK] using most recent articles")
        all_articles = [a for _, a in staged]
        picked = sorted(
            all_articles,
            key=lambda a: _rss_pub_sort_key((a.get("publish_date") or "")),
            reverse=True,
        )[:PIPELINE_TOP_N]
    _pipeline_debug = {
        "links_raw": links_raw,
        "after_filter": after_filter,
        "picked_count": len(picked),
        "PIPELINE_TOP_N": PIPELINE_TOP_N,
        "reject_stats": reject_stats,
    }
    print(
        json.dumps({"[DEBUG] fetch_all summary": _pipeline_debug}, ensure_ascii=False)
    )
    dbg_reason = None
    if links_raw > 0 and len(picked) < PIPELINE_TOP_N:
        dbg_reason = "low content pool"
    print(
        json.dumps(
            {
                "stage": "PIPELINE_DEBUG",
                "total_links": links_raw,
                "after_filter": after_filter,
                "picked_count": len(picked),
                "PIPELINE_TOP_N": PIPELINE_TOP_N,
                "reason": dbg_reason,
            },
            ensure_ascii=False,
        )
    )
    print(
        f"[fetch_all] RSS pipeline → {len(picked)} article(s) "
        f"(candidates_seen≈{links_raw}, topics_ok={after_filter}, PIPELINE_TOP_N={PIPELINE_TOP_N})"
    )
    return picked


def run():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Error scraping: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — skipping database pipeline")
        return

    from supabase import create_client

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    insert_failures = 0

    def url_exists(u: str) -> bool:
        """Return True if URL already in raw_news. On errors, return True to skip insert (safe dedupe)."""
        try:
            res = supabase.table("raw_news").select("id").eq("url", u).limit(1).execute()
            data = getattr(res, "data", None) or []
            return bool(data)
        except Exception as e:
            print(f"Error scraping (dedupe check failed, skipping insert for this URL): {e}")
            return True

    def insert_raw(title: str, url: str, content: str, image: str | None, source_name: str) -> bool:
        nonlocal insert_failures
        if not title or not str(title).strip():
            print("Error scraping (insert skipped: empty title)")
            return False
        if not url or not str(url).strip().startswith("http"):
            print("Error scraping (insert skipped: invalid url)")
            return False
        if content is None or not str(content).strip():
            print("Error scraping (insert skipped: empty content)")
            return False
        payload: dict[str, Any] = {
            "title": str(title).strip(),
            "url": str(url).strip(),
            "content": str(content).strip(),
            "source": source_name,
            "processed": False,
        }
        if image and str(image).strip():
            payload["image_url"] = str(image).strip()
        host = urlparse(str(url).strip()).hostname or ""
        if host.lower().startswith("www."):
            host = host[4:]
        payload["source_domain"] = host.lower() if host else None
        try:
            res = supabase.table("raw_news").upsert(payload, on_conflict="url").execute()
            err = getattr(res, "error", None)
            if err:
                print(f"Error scraping (insert rejected): {err}")
                insert_failures += 1
                return False
            data = getattr(res, "data", None)
            if data is None:
                print("Error scraping (insert returned no data)")
                insert_failures += 1
                return False
            print("Saved")
            return True
        except Exception as e:
            print(f"Error scraping (insert failed): {e}")
            insert_failures += 1
            return False

    def content_image_before_rewrite(
        page_url: str,
        page_title: str,
        rss_summary: str | None,
    ) -> tuple[str, str] | None:
        """Full article text + hero image for Ollama; None if content too weak to rewrite."""
        if "captains-log.internal" in (page_url or ""):
            content = (rss_summary or "").strip()
            image = ""
            if not validate_rss_item_title_and_summary(page_title, content):
                return None
        else:
            content, image = scrape_article(page_url, page_title)
            if not validate_pipeline_fetched_content(content, page_title):
                return None
        print(f"[SCRAPER] Content length: {len(content)} chars")
        if len(content.strip()) < 100:
            print("[SCRAPER] Expanding from title context...")
            content = page_title + ". " + content
        if not content or len(content.strip()) < 100:
            print(f"[SCRAPER] Skipping weak content: {page_url}")
            return None
        return content, image

    # — Web sources
    for src in sources:
        try:
            name = src["name"]
            list_url = src["url"]
            links = discover_links_from_page(list_url)[:40]
            for title, url in links:
                try:
                    if url_exists(url):
                        print("Skipped duplicate")
                        continue
                    packed = content_image_before_rewrite(url, title, None)
                    if packed is None:
                        continue
                    content, image = packed
                    raw_bundle = rewrite_with_ollama(title, content, url)
                    seo_title, body = parse_rewrite_title_body(raw_bundle, title)
                    wc = _word_count(body)
                    if wc < 80:
                        print(f"[SCRAPER] REJECTED (too weak even for summary): {url}")
                        continue
                    tag_line = ", ".join(auto_tags(f"{seo_title} {body}"))
                    content_out = body.rstrip() + f"\n\n---\nTags: {tag_line}\n"
                    if not content_out.strip():
                        print(f"Error scraping (no body): {url!r}")
                        continue
                    insert_raw(seo_title, url, content_out, image, name)
                except Exception as e:
                    print(f"[pipeline] web row failed ({name}): {url!r} — {e}")
                    continue
        except Exception as e:
            print(f"[pipeline] web source failed ({src.get('name')}): {e}")
            continue

    # — YouTube: RSS when UC ids present; /@handle/videos + oEmbed when RSS fails or handle-only
    yt_sources = _youtube_source_strings()
    if not yt_sources:
        print(
            "Skipped YouTube: no sources — set YOUTUBE_CHANNEL_<NAME>=UC…|handle (or UC… / @handle) "
            "and/or YOUTUBE_HANDLES"
        )
    for label, spec in yt_sources:
        data: list[dict[str, Any]] = []
        try:
            try:
                data = list(fetch_youtube_videos(spec) or [])
            except Exception as e:
                print(f"[pipeline] YouTube fetch failed [{label}] {spec!r}: {e}")
                data = []
            if not data:
                print(f"[youtube] empty, trying web fallback for [{label}]")
                try:
                    data = list(fetch_web_articles_fallback(label, spec) or [])
                except Exception as e:
                    print(f"[web fallback] source failed [{label}]: {e}")
                    data = []
            if not data:
                print(f"[pipeline] no data, skipping source [{label}] {spec!r}")
                continue
        except Exception as e:
            print(f"[pipeline] source failed [{label}]: {e}")
            continue

        for item in data:
            try:
                if item.get("_web"):
                    w_url = (item.get("url") or "").strip()
                    w_title = (item.get("title") or "").strip() or w_url
                    w_src = (item.get("source_name") or "Web fallback").strip()
                    if not w_url.startswith("http"):
                        continue
                    if url_exists(w_url):
                        print("Skipped duplicate")
                        continue
                    packed = content_image_before_rewrite(
                        w_url, w_title, item.get("summary")
                    )
                    if packed is None:
                        continue
                    content, image = packed
                    raw_bundle = rewrite_with_ollama(w_title, content, w_url)
                    seo_title, body = parse_rewrite_title_body(raw_bundle, w_title)
                    wc = _word_count(body)
                    if wc < 80:
                        print(f"[SCRAPER] REJECTED (too weak even for summary): {w_url}")
                        continue
                    tag_line = ", ".join(auto_tags(f"{seo_title} {body}"))
                    content_out = body.rstrip() + f"\n\n---\nTags: {tag_line}\n"
                    insert_raw(seo_title, w_url, content_out, image, w_src)
                    continue
                norm = normalize_youtube_entry(item)
                if not norm:
                    print(f"YouTube: skipped invalid record: {item!r}")
                    continue
                if url_exists(norm["url"]):
                    print("Skipped duplicate")
                    continue
                insert_raw(
                    norm["title"],
                    norm["url"],
                    norm["content"],
                    norm["thumbnail"],
                    "YouTube",
                )
            except Exception as e:
                print(f"[db] insert failed ({label}): {e}")
                continue

    if insert_failures > 0:
        print(
            f"Warning scraping: {insert_failures} insert(s) failed — pipeline finished without exit error"
        )


if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        print(f"Error scraping (top-level, non-fatal): {e}")
