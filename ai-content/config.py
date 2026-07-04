"""
Central configuration for the Captain's Log AI pipeline.
Use environment variables for secrets; defaults are dev-friendly only.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

_config_dir = Path(__file__).resolve().parent
PROJECT_ROOT: Path = _config_dir.parent

# Project root .env first; ai-content/.env fills any keys not set (python-dotenv default: no override)
load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(_config_dir / ".env")

# Supabase — loaded after dotenv (also honor process env from e.g. systemd)
# Frontend often uses VITE_SUPABASE_* only; map those so `python ai-content/upload.py` works from one .env.
SUPABASE_URL: str = (
    (os.getenv("SUPABASE_URL") or "").strip()
    or (os.getenv("VITE_SUPABASE_URL") or "").strip()
)
SUPABASE_SERVICE_ROLE_KEY: str = (
    (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    or (os.getenv("SUPABASE_KEY") or "").strip()
    or (os.getenv("VITE_SUPABASE_ANON_KEY") or "").strip()
)
CAPTAINS_LOG_IMAGE_BUCKET: str = (os.getenv("CAPTAINS_LOG_IMAGE_BUCKET") or "").strip()
# Backward-compatible alias (same value as SUPABASE_SERVICE_ROLE_KEY)
SUPABASE_KEY: str = SUPABASE_SERVICE_ROLE_KEY

# Ollama OpenAI-compatible generate endpoint
OLLAMA_URL: str = os.environ.get(
    "OLLAMA_URL", "http://localhost:11434/api/generate"
).strip()

OLLAMA_MODEL: str = os.environ.get("OLLAMA_MODEL", "phi3:mini").strip()

if os.environ.get("PIPELINE_LOG_OLLAMA_MODEL", "").strip() in ("1", "true", "yes"):
    print("[OLLAMA MODEL]", OLLAMA_MODEL, file=sys.stderr)

# Keyword → safe, stable placeholder images (no API keys; direct CDN URLs)
IMAGE_ROCKET_URL: str = os.environ.get(
    "IMAGE_ROCKET_URL",
    "https://images.unsplash.com/photo-1516849841032-87cbac4d88f7?w=1200&q=80",
).strip()
IMAGE_BOAT_URL: str = os.environ.get(
    "IMAGE_BOAT_URL",
    "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1200&q=80",
).strip()
# Relative path ok if your Vite app serves `public/fallback.jpg`
IMAGE_FALLBACK: str = os.environ.get("IMAGE_FALLBACK", "/fallback.jpg").strip()
# Legacy env alias — prefer direct images.unsplash.com/photo/* URLs (`source.unsplash.com` is unreliable).
IMAGE_PIPELINE_FALLBACK: str = os.environ.get(
    "IMAGE_PIPELINE_FALLBACK",
    "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1200&q=80",
).strip()

NASA_NEWS_URL: str = os.environ.get(
    "NASA_NEWS_URL", "https://www.nasa.gov/news/"
).strip()
# NASA official RSS (200, stable)
NASA_RSS_FALLBACK: str = os.environ.get(
    "NASA_RSS_FALLBACK", "https://www.nasa.gov/rss/dyn/breaking_news.rss"
).strip()

# Google News search RSS — resolved to publisher URLs in scraper.py (see allowlist there)
GOOGLE_NEWS_RSS_ROCKET_LAUNCH_FL: str = os.environ.get(
    "GOOGLE_NEWS_RSS_ROCKET_LAUNCH_FL",
    "https://news.google.com/rss/search?q=rocket+launch+Florida",
).strip()
GOOGLE_NEWS_RSS_BOATING_FL: str = os.environ.get(
    "GOOGLE_NEWS_RSS_BOATING_FL",
    "https://news.google.com/rss/search?q=boating+Florida",
).strip()
GOOGLE_NEWS_RSS_FISHING_FL: str = os.environ.get(
    "GOOGLE_NEWS_RSS_FISHING_FL",
    "https://news.google.com/rss/search?q=fishing+Florida",
).strip()
GOOGLE_NEWS_RSS_BIO_FL: str = os.environ.get(
    "GOOGLE_NEWS_RSS_BIO_FL",
    "https://news.google.com/rss/search?q=bioluminescence+Florida",
).strip()
# SpaceX coverage via News (replaces direct spacex.com listing; fewer 403/block issues)
GOOGLE_NEWS_RSS_SPACEX_LAUNCH: str = os.environ.get(
    "GOOGLE_NEWS_RSS_SPACEX_LAUNCH",
    "https://news.google.com/rss/search?q=SpaceX+launch",
).strip()

# Direct publisher RSS (supplements Google News resolution)
FLORIDA_TODAY_SPACE_RSS: str = os.environ.get(
    "FLORIDA_TODAY_SPACE_RSS",
    "https://rssfeeds.floridatoday.com/space/",
).strip()
# Main Florida Today feed (local news + broader coverage than space-only RSS)
FLORIDA_TODAY_MAIN_RSS: str = os.environ.get(
    "FLORIDA_TODAY_MAIN_RSS",
    "https://www.floridatoday.com/arc/outboundfeeds/rss/?outputType=xml",
).strip()
SPACECOAST_DAILY_RSS: str = os.environ.get(
    "SPACECOAST_DAILY_RSS",
    "https://spacecoastdaily.com/feed/",
).strip()
BOATING_MAG_RSS: str = os.environ.get(
    "BOATING_MAG_RSS",
    "https://www.boatingmag.com/feed/",
).strip()
SPORTFISHING_MAG_RSS: str = os.environ.get(
    "SPORTFISHING_MAG_RSS",
    "https://www.sportfishingmag.com/feed/",
).strip()
# Gannett arc RSS often404s; leave empty unless you have a working URL (see scraper Boating & Water).
NEWS_JOURNAL_ONLINE_RSS: str = os.environ.get(
    "NEWS_JOURNAL_ONLINE_RSS",
    "",
).strip()

# Google News — niche local water / boat rental intent (resolved to publisher URLs in scraper)
GOOGLE_NEWS_RSS_DAYTONA_BOAT: str = os.environ.get(
    "GOOGLE_NEWS_RSS_DAYTONA_BOAT",
    "https://news.google.com/rss/search?q=boat+rental+Daytona+Beach+Florida+OR+Halifax+River&hl=en-US&gl=US&ceid=US:en",
).strip()
GOOGLE_NEWS_RSS_PORT_ORANGE_WATER: str = os.environ.get(
    "GOOGLE_NEWS_RSS_PORT_ORANGE_WATER",
    "https://news.google.com/rss/search?q=Port+Orange+boating+OR+Halifax+River+Florida&hl=en-US&gl=US&ceid=US:en",
).strip()
GOOGLE_NEWS_RSS_TITUSVILLE_WATER: str = os.environ.get(
    "GOOGLE_NEWS_RSS_TITUSVILLE_WATER",
    "https://news.google.com/rss/search?q=Titusville+Indian+River+Lagoon+boating+OR+Ponce+Inlet+boating&hl=en-US&gl=US&ceid=US:en",
).strip()

# Captain's Log — fetch_all() RSS title/summary filter (static lists; no env)
PIPELINE_TITLE_DENYLIST: list[str] = [
    "arrest",
    "murder",
    "shooting",
    "crime",
    "police",
    "sheriff",
    "court",
    "investigation",
]

PIPELINE_ROCKET_TITLE_ALLOWLIST: list[str] = [
    "spacex",
    "falcon",
    "rocket",
    "launch",
    "nasa",
    "kennedy",
    "cape canaveral",
]

REQUEST_TIMEOUT_SEC: int = int(os.environ.get("REQUEST_TIMEOUT_SEC", "25"))

# Ollama generate — production pipeline (Captain's Log rewrite)
OLLAMA_TIMEOUT_SEC: int = int(os.environ.get("OLLAMA_TIMEOUT_SEC", "90"))
OLLAMA_MAX_RETRIES: int = int(os.environ.get("OLLAMA_MAX_RETRIES", "3"))
# Stream /generate retry count (rewrite.py); keep low for faster failure → fallback.
OLLAMA_STREAM_ATTEMPTS: int = int(os.environ.get("OLLAMA_STREAM_ATTEMPTS", "2"))
# Optional cap on completion tokens per Ollama /generate (0 = rewrite.py picks hub vs standard defaults).
OLLAMA_NUM_PREDICT: int = int(os.environ.get("OLLAMA_NUM_PREDICT", "0"))
# Rewrite fidelity: lower temperature reduces paraphrase drift / hallucination (override via env).
try:
    _OLLAMA_TEMPERATURE_RAW = float(os.environ.get("OLLAMA_TEMPERATURE", "0.18"))
except ValueError:
    _OLLAMA_TEMPERATURE_RAW = 0.18
OLLAMA_TEMPERATURE: float = max(0.05, min(0.95, _OLLAMA_TEMPERATURE_RAW))
try:
    _OLLAMA_TOP_P_RAW = float(os.environ.get("OLLAMA_TOP_P", "0.85"))
except ValueError:
    _OLLAMA_TOP_P_RAW = 0.85
OLLAMA_TOP_P: float = max(0.5, min(1.0, _OLLAMA_TOP_P_RAW))

# RSS articles older than this (by pubDate) are skipped in fetch_all (0 = no age filter)
FRESHNESS_MAX_AGE_DAYS: int = int(os.environ.get("FRESHNESS_MAX_AGE_DAYS", "21"))

# Scraper HTTP: short timeouts + retries (article fetch / RSS / listing pages only — not Ollama)
SCRAPER_HTTP_TIMEOUT_SEC: int = int(os.environ.get("SCRAPER_HTTP_TIMEOUT_SEC", "5"))
SCRAPER_HTTP_MAX_RETRIES: int = int(os.environ.get("SCRAPER_HTTP_MAX_RETRIES", "2"))
SCRAPER_THREAD_POOL_WORKERS: int = int(os.environ.get("SCRAPER_THREAD_POOL_WORKERS", "5"))

# Scrape pool size per source before scoring / balancing (traffic pipeline)
SCRAPER_POOL_PER_SOURCE: int = int(os.environ.get("SCRAPER_POOL_PER_SOURCE", "12"))

# Final articles to process per run (after score sort + category mix)
PIPELINE_TOP_N: int = int(os.environ.get("PIPELINE_TOP_N", "6"))
# Hard cap of article attempts processed by upload.py in a single run.
PIPELINE_MAX_ATTEMPTS_PER_RUN: int = int(os.environ.get("PIPELINE_MAX_ATTEMPTS_PER_RUN", "10"))

# Quality control — Captain's Log insert gate (grounding + SEO)
PIPELINE_MIN_WORDS_STANDARD: int = int(os.environ.get("PIPELINE_MIN_WORDS_FINAL", "220"))
PIPELINE_MIN_WORDS_SEO_HUB: int = int(os.environ.get("PIPELINE_MIN_WORDS_SEO_HUB", "1500"))
GROUNDING_MIN_TOKEN_OVERLAP: float = float(os.environ.get("GROUNDING_MIN_TOKEN_OVERLAP", "0.055"))

# Near-duplicate gate: SequenceMatcher ratio vs recent titles/excerpts (upload.py).
# Lower = stricter (e.g. 0.75 blocks more near-duplicates). Range 0.5–0.99 clamped.
def _pipeline_sim_threshold(name: str, default: str) -> float:
    try:
        v = float(os.environ.get(name, default))
    except ValueError:
        v = float(default)
    return max(0.5, min(0.99, v))


PIPELINE_TITLE_SIMILARITY_THRESHOLD: float = _pipeline_sim_threshold(
    "PIPELINE_TITLE_SIMILARITY_THRESHOLD", "0.8"
)
PIPELINE_EXCERPT_SIMILARITY_THRESHOLD: float = _pipeline_sim_threshold(
    "PIPELINE_EXCERPT_SIMILARITY_THRESHOLD", "0.8"
)


def _env_disabled(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("0", "false", "no", "off")


# RSS step-by-step logs (CHECKING URL, per-row relevance chatter). Set PIPELINE_VERBOSE=0 for cron/API (e.g. generate-content).
PIPELINE_VERBOSE: bool = not _env_disabled("PIPELINE_VERBOSE")


# Evergreen SEO hub: long-form outline + prefer full publisher HTML (see rewrite.py LOCAL_CONTENT_ENGINE_SEO_HUB).
# Default on so Captain's Log reads like useful blog posts; set PIPELINE_SEO_HUB_MODE=0 for RSS-only (faster).
_PIPELINE_SEO_HUB_RAW = (os.environ.get("PIPELINE_SEO_HUB_MODE") or "1").strip().lower()
PIPELINE_SEO_HUB_MODE: bool = _PIPELINE_SEO_HUB_RAW not in ("0", "false", "no", "off")

# Effective minimum word count for validate_article (1500 in SEO hub mode).
PIPELINE_MIN_WORDS_FINAL: int = (
    PIPELINE_MIN_WORDS_SEO_HUB if PIPELINE_SEO_HUB_MODE else PIPELINE_MIN_WORDS_STANDARD
)

# Full HTML fetch per RSS row in fetch_all() (slow). Also enabled when SEO hub mode is on.
# Override with PIPELINE_FETCH_FULL_ARTICLE=0 to force RSS-only even if hub mode is on.
PIPELINE_FETCH_FULL_ARTICLE: bool = (
    PIPELINE_SEO_HUB_MODE and not _env_disabled("PIPELINE_FETCH_FULL_ARTICLE")
) or os.environ.get("PIPELINE_FETCH_FULL_ARTICLE", "").strip().lower() in ("1", "true", "yes")

# Unsplash Search API: required for per-article dynamic heroes when scrape fails (see images.py).
UNSPLASH_ACCESS_KEY: str = os.environ.get("UNSPLASH_ACCESS_KEY", "").strip()

# Pipeline downloaded / fallback images
PIPELINE_IMAGE_CACHE_DIR: Path = _config_dir / "pipeline_image_cache"

# Unsplash query when pipeline has no valid scraped image URL
PIPELINE_UNSPLASH_FALLBACK_QUERY: str = os.environ.get(
    "PIPELINE_UNSPLASH_FALLBACK_QUERY",
    "rocket launch boating Florida fishing Florida coast",
).strip()

# Web path stored in DB when hero cannot be uploaded (site serves from public/)
PIPELINE_DEFAULT_IMAGE_WEB_PATH: str = (
    os.environ.get("PIPELINE_DEFAULT_IMAGE", "/images/default.jpg").strip() or "/images/default.jpg"
)

# Scraper legacy / raw_news (single source of truth for env)
SCRAPER_STOCK_IMAGE_FALLBACK: str = os.environ.get(
    "SCRAPER_STOCK_IMAGE_FALLBACK",
    "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1200&q=80",
).strip()

# Last-resort pool disabled by default (Option B uses Unsplash API fallback only).
HARD_FALLBACK_IMAGE_URLS: tuple[str, ...] = tuple(
    u.strip()
    for u in os.environ.get(
        "HARD_FALLBACK_IMAGE_URLS",
        "",
    ).splitlines()
    if u.strip()
)
YOUTUBE_HANDLES: str = os.environ.get("YOUTUBE_HANDLES", "").strip()


def _env_truthy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


# Final article enhancer (single late-pass formatter in upload pipeline).
# Default ON when SEO hub mode is enabled unless explicitly disabled.
def _final_enhancer_default() -> bool:
    raw = os.environ.get("ENABLE_FINAL_ARTICLE_ENHANCER")
    if raw is None or not raw.strip():
        return PIPELINE_SEO_HUB_MODE
    return _env_truthy("ENABLE_FINAL_ARTICLE_ENHANCER")


ENABLE_FINAL_ARTICLE_ENHANCER: bool = _final_enhancer_default()
FINAL_ENHANCER_ONLY_NEW: bool = not _env_disabled("FINAL_ENHANCER_ONLY_NEW")
FINAL_ENHANCER_ENABLE_CHECKLIST: bool = not _env_disabled("FINAL_ENHANCER_ENABLE_CHECKLIST")
FINAL_ENHANCER_ENABLE_LOCAL_CONTEXT: bool = not _env_disabled("FINAL_ENHANCER_ENABLE_LOCAL_CONTEXT")
FINAL_ENHANCER_ENABLE_QA: bool = not _env_disabled("FINAL_ENHANCER_ENABLE_QA")
FINAL_ENHANCER_ENABLE_CTA: bool = not _env_disabled("FINAL_ENHANCER_ENABLE_CTA")
FINAL_ENHANCER_HEADING_LEVEL: str = (
    "##" if (os.environ.get("FINAL_ENHANCER_HEADING_LEVEL", "###").strip() == "##") else "###"
)

# Dynamic topic classification + explicit-route internal backlinks (final_formatter.py only).
FINAL_ENHANCER_ENABLE_DYNAMIC_TOPICS: bool = not _env_disabled("FINAL_ENHANCER_ENABLE_DYNAMIC_TOPICS")
FINAL_ENHANCER_ENABLE_INTERNAL_BACKLINK_ENGINE: bool = not _env_disabled(
    "FINAL_ENHANCER_ENABLE_INTERNAL_BACKLINK_ENGINE"
)
FINAL_ENHANCER_MAX_INTERNAL_LINKS: int = max(
    0, min(10, int(os.environ.get("FINAL_ENHANCER_MAX_INTERNAL_LINKS", "3")))
)
FINAL_ENHANCER_TOPIC_MIN_SCORE: int = max(
    1, min(12, int(os.environ.get("FINAL_ENHANCER_TOPIC_MIN_SCORE", "4")))
)
FINAL_ENHANCER_SECONDARY_BLEND_RATIO: float = float(
    os.environ.get("FINAL_ENHANCER_SECONDARY_BLEND_RATIO", "0.7")
)


# Structured JSON logs for image candidate evaluation (see image_instrumentation.py). Does not change selection logic.
PIPELINE_IMAGE_INSTRUMENTATION: bool = _env_truthy("PIPELINE_IMAGE_INSTRUMENTATION")


# Fast pipeline: RSS-only body, no SEO hub prompts, shorter Ollama waits, fewer articles per run.
# Opt in with PIPELINE_FAST=1 (generate-content defaults to off — full SEO unless you set it).
PIPELINE_FAST: bool = _env_truthy("PIPELINE_FAST")
if PIPELINE_FAST:
    PIPELINE_SEO_HUB_MODE = False
    PIPELINE_FETCH_FULL_ARTICLE = False
    PIPELINE_MIN_WORDS_FINAL = PIPELINE_MIN_WORDS_STANDARD
    OLLAMA_TIMEOUT_SEC = min(OLLAMA_TIMEOUT_SEC, 50)
    OLLAMA_STREAM_ATTEMPTS = min(OLLAMA_STREAM_ATTEMPTS, 1)
    PIPELINE_TOP_N = min(PIPELINE_TOP_N, 4)
    PIPELINE_MAX_ATTEMPTS_PER_RUN = min(PIPELINE_MAX_ATTEMPTS_PER_RUN, 6)
