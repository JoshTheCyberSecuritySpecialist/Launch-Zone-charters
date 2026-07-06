"""
Ollama rewrite: Captain's Log from source text — local Launch Zone Charters voice (streaming /generate).

Tip: warm the model once before batch runs: `ollama run phi3:mini` (type anything, exit).
"""

from __future__ import annotations

import json
import logging
import os
import random
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import unquote, urlparse

import requests
from bs4 import BeautifulSoup

from config import (
    OLLAMA_MODEL,
    OLLAMA_NUM_PREDICT,
    OLLAMA_STREAM_ATTEMPTS,
    OLLAMA_TEMPERATURE,
    OLLAMA_TIMEOUT_SEC,
    OLLAMA_TOP_P,
    OLLAMA_URL,
    PIPELINE_SEO_HUB_MODE,
    REQUEST_TIMEOUT_SEC,
)
from grounding import validate_rewritten_article
from pipeline_metrics import record_if_requests_timeout
from seo_evergreen import (
    build_paraphrase_first_engine,
    detect_seo_template,
)
from scraper import (
    _rocket_pillar_reject_national_nasa_event,
    strip_scraped_news_chaff,
    validate_pipeline_fetched_content,
)

logger = logging.getLogger(__name__)

# Public site origin for markdown internal links (Captain's Log → site pages).
LAUNCH_ZONE_SITE_ORIGIN = (os.environ.get("LAUNCH_ZONE_SITE_ORIGIN") or "https://launchzonecharters.com").rstrip(
    "/"
)

# Markdown `[text](url)` targets we keep in Captain's Log bodies (matches src/navigation.ts routes).
ALLOWED_INTERNAL_MARKDOWN_PATHS: frozenset[str] = frozenset(
    {
        "/",
        "/about",
        "/bioluminescence",
        "/bioluminescent-tours",
        "/boat-rentals",
        "/boat-rentals/daytona",
        "/boat-rentals/titusville",
        "/booking",
        "/captains-log",
        "/conditions",
        "/contact",
        "/faqs",
        "/launches",
        "/pricing",
        "/shop/observation-bottle",
    }
)


def _normalize_internal_path(path: str) -> str:
    p = unquote((path or "").strip().split("?", 1)[0].split("#", 1)[0]).lower()
    if not p.startswith("/"):
        p = "/" + p if p else "/"
    p = re.sub(r"/+", "/", p)
    p = p.rstrip("/") or "/"
    return p


def _launch_zone_hosts_match(netloc: str) -> bool:
    if not netloc:
        return False
    h = netloc.lower()
    if h.startswith("www."):
        h = h[4:]
    env_host = urlparse(LAUNCH_ZONE_SITE_ORIGIN).netloc.lower()
    if env_host.startswith("www."):
        env_host = env_host[4:]
    return h == env_host or h.endswith("." + env_host)


def markdown_internal_link_allowed(url: str) -> bool:
    """True if url is a same-site path or full URL whose path is in ALLOWED_INTERNAL_MARKDOWN_PATHS."""
    u = (url or "").strip()
    if not u:
        return False
    if u.startswith("/"):
        return _normalize_internal_path(u) in ALLOWED_INTERNAL_MARKDOWN_PATHS
    if u.startswith(("http://", "https://")):
        try:
            parsed = urlparse(u)
        except Exception:
            return False
        if not _launch_zone_hosts_match(parsed.netloc or ""):
            return False
        return _normalize_internal_path(parsed.path or "/") in ALLOWED_INTERNAL_MARKDOWN_PATHS
    return False


# Markdown `[text](https://…)` only — bare URLs still stripped. Strict allowlist (pipeline spec).


def _norm_authority_host(netloc: str) -> str:
    h = (netloc or "").strip().lower()
    if h.startswith("www."):
        h = h[4:]
    return h


def _host_trusted_authority(netloc: str) -> bool:
    h = _norm_authority_host(netloc)
    if h in (
        "marine.weather.gov",
        "weather.gov",
        "noaa.gov",
        "nasa.gov",
        "spaceforce.mil",
        "myfwc.com",
        "uscgboating.org",
    ):
        return True
    return h.endswith(".noaa.gov") or h.endswith(".weather.gov") or h.endswith(".nasa.gov")


def markdown_trusted_authority_link_allowed(url: str) -> bool:
    """HTTPS (or HTTP) links to NOAA/NWS/FWC/USCG — not arbitrary external sites."""
    u = (url or "").strip()
    if not u.startswith(("http://", "https://")):
        return False
    try:
        parsed = urlparse(u)
    except Exception:
        return False
    if (parsed.scheme or "").lower() not in ("http", "https"):
        return False
    return _host_trusted_authority(parsed.netloc or "")


def markdown_pipeline_link_allowed(url: str) -> bool:
    """Internal Launch Zone paths or trusted authority links (for CMS sanitize)."""
    return markdown_internal_link_allowed(url) or markdown_trusted_authority_link_allowed(url)


_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def _sanitize_markdown_links_for_cms(text: str) -> str:
    """Strip or unwrap `[text](url)`; keep allowlisted internal + trusted authority targets."""

    def _repl(m: re.Match[str]) -> str:
        anchor, raw_url = m.group(1), m.group(2).strip()
        if markdown_pipeline_link_allowed(raw_url):
            return m.group(0)
        return anchor

    return _MD_LINK_RE.sub(_repl, text)


def _canonicalize_internal_markdown_links(text: str) -> str:
    """Normalize internal links to `/path`; upgrade trusted authority links to `https://` form."""

    def _repl(m: re.Match[str]) -> str:
        anchor, raw_url = m.group(1), m.group(2).strip()
        if markdown_internal_link_allowed(raw_url):
            if raw_url.startswith("/"):
                path = _normalize_internal_path(raw_url)
            else:
                parsed = urlparse(raw_url)
                path = _normalize_internal_path(parsed.path or "/")
            return f"[{anchor}]({path})"
        if markdown_trusted_authority_link_allowed(raw_url):
            parsed = urlparse(raw_url)
            netloc = (parsed.netloc or "").lower()
            if netloc.startswith("www."):
                netloc = netloc[4:]
            path = parsed.path or "/"
            if not path.startswith("/"):
                path = "/" + path
            tail = ""
            if parsed.query:
                tail += "?" + parsed.query
            if parsed.fragment:
                tail += "#" + parsed.fragment
            return f"[{anchor}](https://{netloc}{path}{tail})"
        return anchor

    return _MD_LINK_RE.sub(_repl, text)


def _strip_bare_http_keep_markdown_links(text: str) -> str:
    """Remove raw http(s) in prose without destroying allowed `[anchor](url)` pairs."""
    chunks: list[str] = []

    def _shield(m: re.Match[str]) -> str:
        chunks.append(m.group(0))
        return f"\x00MDLINK{len(chunks) - 1}\x00"

    shielded = _MD_LINK_RE.sub(_shield, text)
    shielded = re.sub(r"https?://[^\s\)\]>'\"<>]+", "", shielded, flags=re.I)
    out = shielded
    for i, orig in enumerate(chunks):
        out = out.replace(f"\x00MDLINK{i}\x00", orig)
    return out


ALLOWED_INTERNAL_PATHS_PROMPT_LIST = ", ".join(sorted(ALLOWED_INTERNAL_MARKDOWN_PATHS))
TRUSTED_AUTHORITY_DOMAINS_PROMPT = (
    "marine.weather.gov, weather.gov, noaa.gov, nasa.gov, spaceforce.mil, myfwc.com, uscgboating.org "
    "(markdown `[text](https://…)` only)"
)

# Injected into LOCAL_CONTENT_ENGINE / SEO hub — avoids duplicate marketing blocks in the body.
PIPELINE_WRITER_CONVENTIONS = """CMS / CTA (non-negotiable):
- Do NOT add "### Book Your Experience", "Ready to get on the water?", phone numbers, or any booking/CTA block — conversion CTAs are added by the site outside the article body.
- Do NOT duplicate Launch Zone marketing sentences that match a site footer.

VARIATION:
- Vary intro hooks and transitions; do not reuse identical multi-sentence blocks or the same authority-link paragraph on every article.

AUTHORITY LINKS:
- Optional **0–2** markdown links to allowed hosts only when marine weather, safety, or rules clearly fit the topic — do not force links on unrelated stories."""

# Legacy conversion footer template — optional via `fallback_rewrite(..., append_footer=True)` when not in SEO hub mode.
PIPELINE_MARKDOWN_FOOTER = """---

### Book Your Experience

Ready to get on the water?

Launch Zone Charters offers one of the best ways to experience Daytona Beach, Titusville, and the Space Coast.

Book your trip today."""

# Back-compat alias for grounding / older logs
ALLOWED_CTA_SENTENCE = (
    "Launch Zone Charters offers one of the best ways to experience Daytona Beach, Titusville, and the Space Coast."
)


def _has_allowed_cta(content: str) -> bool:
    c = (content or "").lower()
    return "book your experience" in c or "launch zone charters" in c


def _append_allowed_cta_only(content: str) -> str:
    """Append the standard conversion footer once (strict mode)."""
    c = (content or "").strip()
    if not c:
        return PIPELINE_MARKDOWN_FOOTER.strip()
    if _has_allowed_cta(c):
        return c
    return f"{c}\n\n{PIPELINE_MARKDOWN_FOOTER}"


LOCAL_CONTENT_ENGINE = f"""
SEARCH-INTENT BOAT-RENTAL CONTENT ENGINE (Captain's Log)

GROUNDING (mandatory — automated QC rejects violations):
- PARAPHRASE ONLY from SOURCE FACTS below. You may reorder, shorten, and clarify; you must NOT add facts.
- Do NOT introduce numbers, statistics, dates, times, prices, or named places/venues/businesses unless they appear in SOURCE FACTS (exception: you may name the broad regions Daytona Beach, Port Orange, Titusville, Space Coast, Indian River Lagoon, or Halifax River for local framing when truthful).
- Geography: stay on the Space Coast / Volusia–Brevard boating corridor implied above. Do not pivot to unrelated Florida destinations (for example Miami, the Keys, or Tampa) unless those places explicitly appear in SOURCE FACTS.
- If the source is thin, write a shorter, honest answer — do not invent specifics to sound complete.

BUSINESS CONTEXT (voice only — do not invent prices, fleet, or policies):
- Primary revenue: boat rentals. Secondary: charters. Also: local water experiences (fishing, lagoon, launch viewing from the water).
- Every piece should help someone move toward a confident decision: "Is today/this weekend worth it?", "Where should we go?", "What should we watch for?"

EDUCATIONAL VOICE (within grounding — no invented incidents or statistics):
- Help readers be safer and better informed: conditions, preparation, and what to verify before launching.
- Prefer calm, practical guidance; do not invent accident details or regulatory specifics not in SOURCE FACTS.

{PIPELINE_WRITER_CONVENTIONS}

You are writing a SEARCH ANSWER that helps people who look up: pricing signals (only if in the source), safety, weather, where to go, what to bring, weekend plans, local recommendations — always through a BOATING / WATER-DAY lens.

PRIMARY SIGNALS: HEADLINE and SUMMARY define the topic. Optional BODY may add facts from the publisher.

STEP 1 — DETECT INTENT (internally; do not print labels unless natural)
From HEADLINE + SUMMARY, infer: event (e.g. rocket launch), weather, conditions (water/marine), activity, or general news.

STEP 2 — BOAT-RENTAL RELEVANCE (mandatory — this is the revenue bridge)
Ask: "If someone is planning to rent a boat, book a charter, or spend a day on the water in this area, why does this story matter?"
- Reframe news/weather/events into practical implications: timing windows, go/no-go, routes, safety, what to verify before leaving the dock.
- Do NOT force a fake sales story. DO connect the topic to real boating use cases (pontoon day, lagoon run, inlet caution, launch viewing from the water, etc.).

STEP 3 — SEARCH-BASED TITLE (required)
First output line: TITLE: <title>
- The TITLE must be a normal reader-facing headline only. Never include internal or meta labels: no "SEO Hub", "SEO Hub Entry", "hub entry", "hub mode", "pipeline", "CMS", or similar — those are not part of a real article title.

TITLE SHAPE (mandatory — improves SEO and click-through):
1) **Topic** — what the piece is about (marine weather, launch viewing, fishing, safety, bioluminescence, etc.), using words supported by SOURCE FACTS.
2) **Location** — when SOURCE FACTS mention a place, include at least one: Daytona Beach, Port Orange, Titusville, Space Coast, Indian River Lagoon, Halifax River, Cape Canaveral, or Brevard — only if that place appears in SOURCE FACTS (do not invent a city).
3) **User intent** — signal why a renter or day-boater should click: questions, "what to know", "before you go", "weekend planning", "what renters should check", etc.

Forbidden vague TITLE patterns (do not use): single-word labels like "Overview" or "Update"; generic stubs like "Marine Conditions Overview" or "Weather Update" without location (when the source names a place) and without an intent hook.

Strong patterns (adapt to SOURCE FACTS):
- "Marine Conditions in Daytona Beach: What Boat Renters Need to Know" (only if Daytona Beach appears in SOURCE FACTS)
- "Do You Need a License to Rent a Boat in Daytona Beach?" (only if the source supports licensing/education facts)
- "Best Places to Take a Pontoon Boat in Port Orange"
- "Is This Weekend Good for Boating in Daytona Beach?"
- "Where to Go by Boat in Titusville (Local Guide)"
- "Best Time to Watch the Rocket Launch in Titusville This Week"
Prefer: question form, "best…", "what to know…", weekend/conditions, colon subtitles that pair topic + renter intent.

STEP 4 — DIRECT ANSWER OPENING (mandatory)
First 2–3 sentences of the body MUST answer the implied question immediately using ONLY SOURCE FACTS. Tie the answer to on-water planning when natural (e.g. wind → small craft caution, not a generic news recap).

STEP 5 — LOCAL FOCUS (required)
Include at least one of: Daytona Beach, Port Orange, Titusville, Space Coast, Indian River Lagoon, or Halifax River where truthful. Never invent locations.

STEP 6 — SEO MARKDOWN STRUCTURE (mandatory — exact headings, exact order)
- After the TITLE: line, the markdown body MUST use:
  1) First line of body: `##` + a concise main headline aligned with the TITLE (not the same string as TITLE, not "Local Boating Update", not "What to know").
  2) Intro: **2–4 short paragraphs** only — direct answer first. No "Summary" heading, no min read, no byline, no "appeared first on…" lines.
  3) Then these `###` headings **in this exact order** (each **at most once**):
     ### What This Means For Your Trip
     ### Best Ways to Experience the Space Coast Safely
     ### Practical Checklist Before You Leave the Dock
     (this section: **bullets only** — lines starting with "- ")
     ### Local Context: Daytona Beach & Space Coast
     ### Questions Readers Ask
     (optional — include only if 2–4 real **Q:** / **A:** pairs fit the source; otherwise omit this entire `###` section)
     ### Before You Go
- Do NOT add any other `###` sections. Do NOT use legacy labels: "Key takeaways", "Local context" alone, "What to know", "Summary".

SECTION LENGTH (mandatory — single response, bounded sections):
- After the ## headline: intro (before the first ###) — target **≤150 words** total.
- Each ### section (non-checklist) — target **80–140 words** when the source supports it; shorter is OK if thin — do not pad.
- Whole markdown body (after TITLE:) — target roughly **400–800 words**; stay under **~900 words** max.

- **Practical Checklist** is only "- " bullets (imperatives). Do not paste raw wire copy.
- Do NOT embed images or `<img>` tags in the body (hero is handled by the site from `image_url`).
- INTERNAL LINKS (optional): up to **4** markdown links to Launch Zone pages. Paths only: {ALLOWED_INTERNAL_PATHS_PROMPT_LIST}. Do **not** use `/log/...` article URLs.
- AUTHORITY LINKS: do not add authority links in rewrite output (final formatter owns authority-link placement).
- Do not put phone numbers, affiliate URLs, or non-allowlisted domains in the body.
- Tone: calm and direct. Avoid travel-blog filler ("sparkling", "pristine", "reminiscent", etc.).
- Do NOT name specific marinas, piers, businesses, or prices unless they appear in SOURCE FACTS.

DO NOT OUTPUT:
- A section titled "Summary", "Key takeaways", "Abstract", or "Article"
- Reading time / "min read"
- Journalist, author, or "appeared first on…" attribution lines

INTENT ANGLE HINTS (SOURCE FACTS only for specifics):
- rocket / launch → viewing from the water, timing, weather windows, safety (no invented schedules)
- weather / marine → rental-day go/no-go, weekend viability
- wind / advisory → PFDs, seamanship, smaller craft caution
- beach / coast → where to go by boat, lagoon etiquette

FACT RULES:
- Names, dates, numbers, quotes, claims: ONLY from SOURCE FACTS. No invented businesses, people, or incidents.
- Do not repeat a brand/business name in the body; sound neutral and local.
- No phone numbers in the body. URLs only as allowlisted markdown links per STEP 6 (internal paths only — not bare pasted links). Do **not** add a CTA or booking block; the site adds conversion UI separately.

OUTPUT: First line TITLE: ..., blank line, then SEO markdown body per STEP 6. No images in the body; http(s) only inside allowlisted markdown links (internal paths only).
"""

# Long-form hub variant: same grounding as LOCAL_CONTENT_ENGINE; deeper outline for blog-style SEO.
# (Avoid "SEO HUB" in the banner — models sometimes echo it into TITLE lines.)
LOCAL_CONTENT_ENGINE_SEO_HUB = f"""
SEARCH-INTENT BOAT-RENTAL CONTENT ENGINE — LONG-FORM ARTICLE (Captain's Log)

GROUNDING (mandatory — automated QC rejects violations):
- PARAPHRASE ONLY from SOURCE FACTS below. You may reorder, shorten, and clarify; you must NOT add facts.
- Do NOT introduce numbers, statistics, dates, times, prices, or named places/venues/businesses unless they appear in SOURCE FACTS (exception: you may name the broad regions Daytona Beach, Port Orange, Titusville, Space Coast, Indian River Lagoon, or Halifax River for local framing when truthful).
- Geography: stay on the Space Coast / Volusia–Brevard boating corridor implied above. Do not pivot to unrelated Florida destinations (for example Miami, the Keys, or Tampa) unless those places explicitly appear in SOURCE FACTS.
- If the source is thin, write shorter sections honestly — do not invent FAQs, prices, or itineraries.

BUSINESS CONTEXT (voice only — do not invent prices, fleet, or policies):
- Primary revenue: boat rentals. Secondary: charters. Also: local water experiences (fishing, lagoon, launch viewing from the water).
- Help readers decide: conditions, safety, timing, what to verify before leaving the dock.

EDUCATIONAL VOICE (within grounding — no invented incidents or statistics):
- Prioritize practical safety and informed planning; teach without inventing case details or numbers not in SOURCE FACTS.

{PIPELINE_WRITER_CONVENTIONS}

STEP 1 — DETECT INTENT (internally; do not print labels unless natural)
From HEADLINE + SUMMARY (+ BODY if present), infer: event, weather, marine conditions, activity, or general news.

STEP 2 — BOAT-RENTAL RELEVANCE (mandatory)
Ask: "If someone is planning to rent a boat or spend a day on the water here, why does this matter?"
- Practical implications: timing, go/no-go, routes, safety, what to verify before leaving the dock.
- Do NOT invent trips or bookings the source does not describe.

STEP 3 — SEARCH-BASED TITLE (required)
First output line: TITLE: <title>
- The TITLE must be a normal reader-facing headline only. Never include internal or meta labels: no "SEO Hub", "SEO Hub Entry", "hub entry", "hub mode", "pipeline", or similar.

TITLE SHAPE (mandatory):
1) **Topic** — from SOURCE FACTS (launch, marine weather, fishing, safety, bioluminescence, etc.).
2) **Location** — include a named place from SOURCE FACTS when available (Daytona Beach, Port Orange, Titusville, Space Coast, Indian River Lagoon, Halifax River, Cape Canaveral, Brevard). Never invent a location.
3) **User intent** — why a renter should click: "what to know", questions, weekend planning, "what boat renters should check", etc.

Avoid vague titles ("Overview", "Update", "Marine Conditions Overview" with no place or intent). Prefer patterns like "Topic in Location: What Boat Renters Need to Know" when the source supports the place name.
Prefer titles renters search: questions, "best…", "what to know…", weekend/conditions, colon subtitles combining topic + intent.

STEP 4 — DIRECT ANSWER (mandatory)
The opening under ## must answer the implied question in 2–4 short paragraphs using ONLY SOURCE FACTS.

STEP 5 — LOCAL FOCUS (required where truthful)
Include at least one of: Daytona Beach, Port Orange, Titusville, Space Coast, Indian River Lagoon, or Halifax River when supported. Never invent locations.

STEP 6 — LONG-FORM SECTION STRUCTURE (mandatory — exact headings, exact order)
After the TITLE: line, the markdown body MUST use:
  1) First line of body: `##` + a concise main headline aligned with the TITLE (not a duplicate string, not "Local Boating Update", not "What to know").
  2) Intro: **2–4 short paragraphs** — direct answer first; no "Summary", no min read, no byline, no "appeared first on…".
  3) Then these `###` headings **in this exact order** (each **at most once**):
     ### What This Means For Your Trip
     ### Best Ways to Experience the Space Coast Safely
     ### Practical Checklist Before You Leave the Dock
     (this section: **bullets only** — lines starting with "- ")
     ### Local Context: Daytona Beach & Space Coast
     ### Questions Readers Ask
     (optional — include only if 2–4 real **Q:** / **A:** pairs fit the source; otherwise omit this entire `###` section)
     ### Before You Go
- Under **Questions Readers Ask** (when included): 2–4 **Q:** / **A:** pairs; answers only from SOURCE FACTS. If the source cannot support Q&A, omit this section entirely (do not fabricate).
- Do NOT add "Key takeaways", "Local context" alone, or any extra `###` headings.

SECTION LENGTH (mandatory — single Ollama response, bounded sections):
- After the ## headline: intro — target **≤180 words** total before the first ###.
- Each ### section (except bullet-only checklist) — target **80–150 words**. **Q:**/**A:** answers: **2–4 sentences** each when present.
- Whole markdown body (after TITLE:) — target roughly **700–1000 words**; stay under **~1100 words** absolute max.

- Use short paragraphs; tone calm and direct. No travel-blog filler.
- Do NOT embed images or `<img>` in the body.
- INTERNAL LINKS (optional): up to **4** links to Launch Zone pages; paths only: {ALLOWED_INTERNAL_PATHS_PROMPT_LIST}. Do **not** use `/log/...` article URLs.
- AUTHORITY LINKS: do not add authority links in rewrite output (final formatter owns authority-link placement). No bare URLs in prose. Do **not** add booking CTAs — the site handles conversion separately.

DO NOT OUTPUT:
- A section titled "Summary", "Key takeaways", "Abstract", or "Article"
- Reading time / "min read"
- Journalist, author, or "appeared first on…" attribution lines

OUTPUT: First line TITLE: ..., blank line, then markdown per STEP 6. No images; http(s) only inside allowlisted markdown links (internal paths only).
"""

STRICT_SOURCE_GROUNDING = """
STRICT PARAPHRASE MODE (non-negotiable):
- ONLY use information present in the INPUT article below. Paraphrase and reorganize; do not research or invent.
- Do NOT add new facts, dates, numbers, quotes, locations, businesses, people, or events not explicitly supported by the input.
- Do NOT expand beyond what is given. If a detail is not explicitly in the source content, DO NOT include it.
- Do NOT invent boating trips, charters-as-experiences, or "days on the water" unless the source describes them.

If the article is NOT about boating:
- Do NOT force it into a boating narrative. Reframe as news, conditions, advisory, or general update while preserving the original meaning.

You MAY:
- Simplify wording, improve readability, add markdown headings, and use bullet lists that restate source points only.

STYLE CONTROL (no extra content):
- Better formatting only — no new paragraphs of invented narrative.
- If you must shorten, preserve meaning; do not substitute new claims.

OUTPUT — marketing:
- Do NOT add charter CTAs, booking prompts, phone numbers, or site URLs in your response. Stop after the last paraphrased section of the source.
"""

SOURCE_FIDELITY_ABSOLUTE = """
If information is not explicitly present in the source:
- DO NOT generate it.
- DO NOT assume it.
- DO NOT expand beyond the provided content.
"""

WEAK_SOURCE_FALLBACK_TEXT = """Topic: boating, boat rental planning, charters, or water activities around Daytona Beach, Port Orange, Titusville, or the Space Coast.

Write a search-answer style guide that helps someone decide on a boat day: conditions, safety, where to go, or what to verify before renting — no invented facts.
"""

FINAL_SEO_FALLBACK_CONTENT = """## Boat Rentals in Daytona Beach & Titusville

Looking to get out on the water in Daytona Beach or Titusville? Launch Zone Charters offers one of the best ways to experience Florida's Space Coast.

Whether you're planning a relaxing cruise, fishing trip, or rocket launch viewing, there's no better way to enjoy the area.

Book your trip today with Launch Zone Charters.
"""


def _ensure_final_content_floor(content: str) -> str:
    """Strict mode: never substitute invented placeholder copy for short paraphrases."""
    c = (content or "").strip()
    if not c:
        print("[WARN] empty body after rewrite")
    return c


def _has_word(text: str, word: str) -> bool:
    """Whole-word match only (no substring matches). `text` must be lowercased by caller."""
    return re.search(rf"\b{re.escape(word)}\b", text) is not None


def _has_phrase(text: str, phrase: str) -> bool:
    """Multi-word phrase with word boundaries between tokens. `text` must be lowercased."""
    phrase = phrase.strip().lower()
    if not phrase:
        return False
    parts = phrase.split()
    if len(parts) == 1:
        return _has_word(text, parts[0])
    pat = r"\b" + r"\s+".join(re.escape(p) for p in parts) + r"\b"
    return re.search(pat, text) is not None


# Rocket pillar — strict list (word-boundary checks only). Bare "launch" handled in
# `_rocket_keyword_topic_match` (excludes "Launch Credit Union", etc.).
ROCKET_TERMS: tuple[str, ...] = (
    "spacex",
    "falcon",
    "rocket",
    "nasa",
    "kennedy",
    "canaveral",
)


def _rocket_brand_false_positive(blob: str) -> bool:
    b = (blob or "").lower()
    if re.search(r"\blaunch\s+credit(\s+union)?\b", b):
        return True
    if re.search(r"\b(product|software|app|startup)\s+launch\b", b):
        return True
    return False


def _rocket_keyword_topic_match(title: str, body: str) -> bool:
    """Rocket SEO pillar: space launch context, not business names containing 'Launch'."""
    blob = f"{title} {body}".lower()
    if _rocket_brand_false_positive(blob):
        return False
    if _rocket_pillar_reject_national_nasa_event(title, (body or "")[:12000]):
        return False
    if any(_has_word(blob, t) for t in ROCKET_TERMS):
        return True
    if _has_word(blob, "launch") or _has_word(blob, "launches"):
        return bool(
            re.search(
                r"\b(spacex|falcon|nasa|rocket|kennedy|canaveral|space\s+coast|orbit|"
                r"pad|starlink|starship|astronaut)\b",
                blob,
            )
        )
    return False

BIO_TERMS: tuple[str, ...] = (
    "bioluminescent",
    "bioluminescence",
    "dinoflagellate",
    "dinoflagellates",
    "plankton",
)

BOAT_TERMS: tuple[str, ...] = (
    "boat",
    "boats",
    "boating",
    "yacht",
    "pontoon",
    "vessel",
    "dock",
    "docks",
    "harbor",
    "sail",
    "marine",
    "marina",
    "intracoastal",
    "hull",
    "deck",
    "wake",
    "motorboat",
    "skiff",
    "catamaran",
)

FISHING_TERMS: tuple[str, ...] = (
    "fishing",
    "angler",
    "snook",
    "redfish",
    "trout",
    "seatrout",
    "speckled",
    "inshore",
    "offshore",
    "flats",
    "lagoon",
    "inlet",
    # Sportfishing / tournament stories often title with "boat" but omit "fishing"
    "boat",
    "boats",
)

LOCAL_SPACE_COAST_TERMS: tuple[str, ...] = (
    "daytona",
    "daytona beach",
    "port orange",
    "titusville",
    "space coast",
    "indian river",
    "indian river lagoon",
    "halifax",
    "halifax river",
    "brevard",
    "volusia",
    "ponce inlet",
    "canaveral",
    "cape canaveral",
)


class TopicMismatchError(Exception):
    """Raised when scraped body/title does not match keyword_topic (skip article)."""


class RewriteFailedError(RuntimeError):
    """Ollama failed after retries or output failed quality gates (skip article; no stub insert)."""


def text_matches_keyword_topic(title: str, body: str, keyword_topic: str) -> bool:
    """
    True if title + body supports the SEO pillar — whole-word matches only, no auto-pass.
    """
    blob = f"{title} {body}".lower()
    kt = (keyword_topic or "").strip().lower()
    if not kt:
        return False

    # Bioluminescence / glow-tour pillars (scraper: "bioluminescent tours …")
    if (
        "bioluminescent" in kt
        or "bioluminescence" in kt
        or "glow tour" in kt
        or "night glow" in kt
    ):
        if any(_has_word(blob, t) for t in BIO_TERMS):
            return True
        return bool(
            _has_word(blob, "glow")
            and (
                _has_word(blob, "lagoon")
                or _has_word(blob, "kayak")
                or _has_word(blob, "paddle")
                or _has_word(blob, "night")
                or _has_word(blob, "tour")
            )
        )

    # Rocket / launch pillars (scraper: "rocket launches …")
    if "rocket" in kt or "launch" in kt or "spacex" in kt:
        return _rocket_keyword_topic_match(title, body)

    # Boating / Port Orange (scraper: "boating in Port Orange …")
    if "boat" in kt or "port orange" in kt or "rental" in kt:
        if _has_phrase(blob, "port orange"):
            return True
        return any(_has_word(blob, t) for t in BOAT_TERMS)

    # Fishing / lagoon (scraper: "fishing Indian River Lagoon")
    if "fishing" in kt or ("indian" in kt and "river" in kt):
        has_fishing = any(_has_word(blob, t) for t in FISHING_TERMS)
        has_local = any(_has_phrase(blob, t) for t in LOCAL_SPACE_COAST_TERMS)
        if _has_phrase(blob, "indian river"):
            return True
        # Require both fishing signal and local Space Coast signal; blocks non-local
        # stories like "New England surfcasting" from passing this pillar.
        return has_fishing and has_local

    # Explicit local-daytrip style topics (not used by current pipeline specs)
    if "daytona" in kt or "things to do" in kt:
        if _has_word(blob, "daytona") or _has_word(blob, "titusville"):
            return True
        if _has_phrase(blob, "space coast"):
            return True
        return sum(1 for t in ("brevard", "beach", "lagoon") if _has_word(blob, t)) >= 2

    return False


@dataclass(frozen=True)
class ArticleRewrite:
    """Rewritten SEO article for captains_log (topic- and image-aligned)."""

    seo_title: str
    content: str
    image_url: str
    category: str

    @property
    def title(self) -> str:
        """Alias for seo_title (API shape: title, content, image_url, category)."""
        return self.seo_title

# DB category → primary phrase (diversity pillars; matches scraper keyword_topic intents).
CATEGORY_PRIMARY_SEO_PHRASE: dict[str, str] = {
    "Launch Updates": "rocket launches Titusville Florida",
    "Water Adventures": "bioluminescence tours Florida lagoon",
    "Boating Tips": "boat rentals Port Orange Florida",
    "Local Highlights": "things to do in Daytona Beach",
}

CAT_DEFAULT = "Boating Tips"

# Target length band (words); prompt + validation gates (see validate_article in upload.py).
MIN_WORDS_HARD = 400
MIN_WORDS_TARGET = 400
MAX_WORDS_TARGET = 700
# SEO hub mode: long-form evergreen articles (see seo_evergreen.py + config PIPELINE_MIN_WORDS_SEO_HUB).
MIN_WORDS_SEO_HUB = 350
MAX_WORDS_SEO_HUB = 1200


def _pipeline_max_output_words() -> int:
    return MAX_WORDS_SEO_HUB if PIPELINE_SEO_HUB_MODE else MAX_WORDS_TARGET


# Streaming /generate — SEO hub runs need a longer read timeout (large num_predict on local GPUs).
OLLAMA_STREAM_TIMEOUT_SEC = int(
    os.environ.get(
        "OLLAMA_STREAM_TIMEOUT_SEC",
        str(
            max(OLLAMA_TIMEOUT_SEC + 120, 240)
            if PIPELINE_SEO_HUB_MODE
            else max(OLLAMA_TIMEOUT_SEC + 10, 30)
        ),
    )
)
OLLAMA_REQUEST_ATTEMPTS = OLLAMA_STREAM_ATTEMPTS


def _ollama_num_predict() -> int:
    """Token cap per /generate completion; aligns with bounded STEP 6 (single call, not multi-section requests)."""
    if OLLAMA_NUM_PREDICT > 0:
        return OLLAMA_NUM_PREDICT
    return 4000 if PIPELINE_SEO_HUB_MODE else 2400


def truncate_text(text: str, max_words: int = 200) -> str:
    return " ".join(text.split()[:max_words])


_ROBOTIC_FALLBACK_HEADINGS = re.compile(
    r"(?m)^#{1,2}\s*(Summary|Headline|Abstract|Article)\s*$\n*",
    re.IGNORECASE,
)


def _dedupe_short_sentences(text: str) -> str:
    """Drop repeated sentences (case-insensitive) from thin-source blobs."""
    text = (text or "").strip()
    if not text:
        return text
    parts = re.split(r"(?<=[.!?])\s+", text)
    seen: set[str] = set()
    out: list[str] = []
    for p in parts:
        s = p.strip()
        if not s:
            continue
        key = re.sub(r"\s+", " ", s.lower())
        if len(key) >= 14 and key in seen:
            continue
        if len(key) >= 14:
            seen.add(key)
        out.append(s)
    return " ".join(out).strip()


def _word_set_overlap(a: str, b: str) -> float:
    wa = set(re.findall(r"\b[\w'-]+\b", a.lower()))
    wb = set(re.findall(r"\b[\w'-]+\b", b.lower()))
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / min(len(wa), len(wb))


def _collapse_repeated_head_prefix(text: str) -> str:
    """
    Two headlines are often pasted back-to-back with a single space (no `.` between).
    If the same 8-word prefix appears twice, keep the longer first span.
    """
    w = text.split()
    if len(w) < 16:
        return text
    head_len = min(8, len(w) // 3)
    head = w[:head_len]
    for i in range(head_len, len(w) - head_len + 1):
        if w[i : i + head_len] == head:
            return " ".join(w[:i]).strip()
    return text


def _merge_overlapping_headline_pairs(text: str) -> str:
    """
    RSS title + excerpt often repeat the same headline with small edits; keep one sentence.
    """
    t = (text or "").strip()
    if not t:
        return t
    t = _collapse_repeated_head_prefix(t)
    # Single-line blobs: split on long gaps (two headlines concatenated)
    chunks = re.split(r"\s{2,}", t)
    if len(chunks) >= 2:
        merged: list[str] = []
        for c in chunks:
            c = c.strip()
            if not c:
                continue
            if merged and _word_set_overlap(merged[-1], c) >= 0.55:
                if len(c) > len(merged[-1]):
                    merged[-1] = c
                continue
            merged.append(c)
        t = " ".join(merged)

    parts = re.split(r"(?<=[.!?])\s+", t)
    if len(parts) < 2:
        return t.strip()
    out: list[str] = [parts[0].strip()]
    for p in parts[1:]:
        s = p.strip()
        if not s:
            continue
        prev = out[-1]
        if len(s.split()) >= 5 and _word_set_overlap(prev, s) >= 0.55:
            if len(s) > len(prev):
                out[-1] = s
            continue
        out.append(s)
    return " ".join(out).strip()


def _strip_leading_title_echo(text: str, *candidates: str) -> str:
    t = (text or "").strip()
    for cand in candidates:
        c = (cand or "").strip()
        if len(c) < 8:
            continue
        cl, tl = c.lower(), t.lower()
        if tl.startswith(cl):
            t = t[len(c) :].lstrip(" .:\n—-")
            continue
        m = re.match(r"^([^.!?]+[.!?])\s*", t)
        if m and m.group(1).strip().lower().rstrip(".") == cl.rstrip("."):
            t = t[m.end() :].lstrip()
    return t.strip()


def _clean_fallback_source_text(source_text: str, raw_title: str, seo_title: str) -> str:
    """
    Thin RSS/HTML blobs often repeat the headline many times; strip meta headings and echoes
    before building the deterministic fallback excerpt.
    """
    t = (source_text or "").strip()
    t = _ROBOTIC_FALLBACK_HEADINGS.sub("", t)
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    t = t.replace("&nbsp;", " ").replace("\xa0", " ")
    t = re.sub(r"\s+", " ", t).strip()
    t = _strip_leading_title_echo(t, raw_title, seo_title)
    t = _merge_overlapping_headline_pairs(t)
    return _dedupe_short_sentences(t)


def fetch_source_text(
    url: str,
    max_chars: int = 12000,
    *,
    timeout: float | None = None,
    max_retries: int = 0,
) -> str:
    """Pull visible paragraph text from the article page (best-effort). Preserves paragraph breaks."""
    to = timeout if timeout is not None else REQUEST_TIMEOUT_SEC
    last_err: Exception | None = None
    html_text = ""
    non_retryable_statuses = {400, 401, 403, 404, 410, 451}
    for attempt in range(max(0, max_retries) + 1):
        try:
            r = requests.get(
                url,
                timeout=to,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; LaunchZoneCaptainsLogBot/1.0)"
                },
            )
            r.raise_for_status()
            html_text = r.text
            break
        except requests.RequestException as e:
            record_if_requests_timeout(e)
            last_err = e
            logger.warning(
                "Could not fetch source body (attempt %s) %s: %s", attempt + 1, url, e
            )
            status_code = getattr(getattr(e, "response", None), "status_code", None)
            if status_code in non_retryable_statuses:
                logger.warning(
                    "Could not fetch source body (non-retryable status %s) %s; skipping retries",
                    status_code,
                    url,
                )
                break
    else:
        if last_err:
            logger.warning("Could not fetch source body after retries %s: %s", url, last_err)
        return ""
    if not html_text:
        return ""

    soup = BeautifulSoup(html_text, "html.parser")
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header", "aside"]):
        tag.decompose()

    root = (
        soup.find("article")
        or soup.find("main")
        or soup.select_one(".entry-content, .post-content, .article-body, .story-body")
        or soup.body
        or soup
    )
    paras: list[str] = []
    for p in root.find_all("p"):
        t = p.get_text(separator=" ", strip=True)
        t = re.sub(r"\s+", " ", t).strip()
        if len(t) > 40:
            paras.append(t)

    text = "\n\n".join(paras)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) > max_chars:
        cut = text[: max_chars + 1]
        if " " in cut:
            text = cut.rsplit(" ", 1)[0] + "…"
        else:
            text = cut[:max_chars] + "…"
    text = strip_scraped_news_chaff(text)
    if not validate_pipeline_fetched_content(text):
        return ""
    return text


def _clean_source_for_prompt(body: str) -> str:
    """Strip common scraped noise; keep paragraph breaks."""
    t = body.strip()
    t = re.sub(r"\r\n", "\n", t)
    # Drop lines that look like cookie / subscribe chrome (short boilerplate)
    lines = []
    for line in t.split("\n"):
        s = line.strip()
        if len(s) < 3:
            continue
        low = s.lower()
        if low in ("cookie", "cookies", "subscribe", "sign up", "newsletter", "advertisement"):
            continue
        if re.match(r"^(share|tweet|follow us)\b", low):
            continue
        lines.append(s)
    t = "\n\n".join(lines) if lines else t
    t = re.sub(r"\n{3,}", "\n\n", t)
    t = strip_scraped_news_chaff(t)
    return t.strip()


def _word_count(text: str) -> int:
    return len(re.findall(r"\b[\w'-]+\b", text))


def ensure_minimum_length(content: str, title: str, min_words: int = 400) -> str:
    """Strict mode: do not pad with invented text to hit a word count."""
    _ = title, min_words
    return (content or "").strip()


_SECTION_HEADING_LINE = re.compile(
    r"^#{0,2}\s*Section\s*\d+\s*:?\s*\S?.*$",
    re.MULTILINE | re.IGNORECASE,
)

_NATURAL_HEADINGS_CYCLE = (
    "What to Expect",
    "Best Local Experience",
    "Local Tips",
    "Best Time to Go",
    "Why It's Worth It",
    "Quick Tips",
    "Call to Action",
)


def _replace_section_x_headings(text: str) -> str:
    idx = [0]

    def repl(_m: re.Match[str]) -> str:
        h = _NATURAL_HEADINGS_CYCLE[idx[0] % len(_NATURAL_HEADINGS_CYCLE)]
        idx[0] += 1
        return f"## {h}"

    return _SECTION_HEADING_LINE.sub(repl, text)


def _strip_inline_section_labels(text: str) -> str:
    t = re.sub(r"(?m)^\s*Section\s+\d+\s*[:\.]?\s*", "", text)
    return re.sub(r"\bSection\s+\d+\s*[:\.]?\s*", "", t, flags=re.IGNORECASE)


_MAX_PARA_WORDS = 80


def _split_long_paragraph_blocks(text: str) -> str:
    """Keep bullets and headings; split dense paragraphs for mobile reading."""
    out: list[str] = []
    for block in text.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        if block.lstrip().startswith("##") or (
            "\n" in block and _is_markdown_list_line(block.split("\n", 1)[0])
        ):
            out.append(block)
            continue
        if _is_markdown_list_line(block.split("\n", 1)[0]):
            out.append(block)
            continue
        if _word_count(block) <= _MAX_PARA_WORDS:
            out.append(block)
            continue
        chunks: list[str] = []
        cur: list[str] = []
        cur_w = 0
        for sent in re.split(r"(?<=[.!?])\s+", block):
            s = sent.strip()
            if not s:
                continue
            sw = _word_count(s)
            if cur and cur_w + sw > _MAX_PARA_WORDS:
                chunks.append(" ".join(cur))
                cur = [s]
                cur_w = sw
            else:
                cur.append(s)
                cur_w += sw
        if cur:
            chunks.append(" ".join(cur))
        out.extend(chunks)
    return "\n\n".join(out)


def _is_markdown_list_line(s: str) -> bool:
    t = s.strip()
    if not t:
        return False
    return bool(re.match(r"^[-*•]\s", t)) or bool(re.match(r"^\d+\.\s", t))


_ROBOTIC_H2_HEADINGS = re.compile(
    r"(?m)^##\s*(Direct Answer Opening|Answer Opening|Opening Section|Introduction|"
    r"Section\s*\d+|TL;DR|Executive\s+Summary)\s*$\n?",
    re.IGNORECASE,
)


def _strip_robotic_h2_labels(text: str) -> str:
    """Remove meta section titles the model sometimes prints; keeps body text."""
    return _ROBOTIC_H2_HEADINGS.sub("", text)


def _split_fused_dash_bullets(text: str) -> str:
    """
    Split run-on prose where the model fused checklist items as `...end. - Next item. - Next`
    (common readability failure on long hub outputs).
    """
    lines = text.split("\n")
    out: list[str] = []
    for line in lines:
        s = line.strip()
        if not s or s.startswith("#"):
            out.append(line)
            continue
        if len(s) < 220 or s.count(". - ") < 2:
            out.append(line)
            continue
        parts = re.split(r"(?<=[.!?])\s+-\s+", s)
        if len(parts) < 3:
            out.append(line)
            continue
        first = parts[0].strip()
        if first:
            out.append(first)
        for p in parts[1:]:
            p = p.strip()
            if not p:
                continue
            out.append(f"- {p}" if not p.startswith("- ") else p)
    return "\n".join(out)


def _split_fused_bullet_lines(text: str) -> str:
    """
    Split list items that were fused on one line, e.g.
    '- First sentence. - Second bullet...' -> two lines.
    """
    lines = text.split("\n")
    out: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped.startswith("- "):
            out.append(line)
            continue
        inner = stripped[2:].strip()
        if re.search(r"[.!?]\s+-\s+", inner):
            parts = re.split(r"(?<=[.!?])\s+-\s+", inner)
            for p in parts:
                p = p.strip()
                if p:
                    out.append(f"- {p}")
            continue
        out.append(stripped)
    return "\n".join(out)


def _space_paragraphs_and_lists(text: str) -> str:
    """Ensure double newlines between blocks; single newlines between list items."""
    lines = [ln.rstrip() for ln in text.split("\n")]
    blocks: list[str] = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.lstrip().startswith("##"):
            blocks.append(line.strip())
            i += 1
            continue
        if _is_markdown_list_line(line):
            lst: list[str] = []
            while i < n:
                L = lines[i]
                if not L.strip():
                    i += 1
                    break
                if _is_markdown_list_line(L):
                    lst.append(L.strip())
                    i += 1
                elif L.startswith(("  ", "\t")) and lst:
                    lst[-1] = f"{lst[-1]} {L.strip()}"
                    i += 1
                else:
                    break
            blocks.append("\n".join(lst))
            continue
        para: list[str] = [line.strip()]
        i += 1
        while i < n and lines[i].strip():
            L = lines[i]
            if L.lstrip().startswith("##") or _is_markdown_list_line(L):
                break
            para.append(L.strip())
            i += 1
        blocks.append(" ".join(para))
    return "\n\n".join(blocks)


def _normalize_article_output(text: str) -> str:
    """Normalize whitespace; preserve ## headings and short paragraphs."""
    t = text.strip()
    t = re.sub(r"\r\n", "\n", t)
    t = _strip_inline_section_labels(t)
    t = _strip_robotic_h2_labels(t)
    # Phase 3: stop auto-renaming "Section X" headings here; let structure gate
    # reject malformed headings deterministically instead of masking them.
    t = _split_fused_dash_bullets(t)
    t = _split_fused_bullet_lines(t)
    t = _space_paragraphs_and_lists(t)
    t = re.sub(r"\n[ \t]*\n[ \t]*\n+", "\n\n", t)
    parts: list[str] = []
    for block in t.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        if block.lstrip().startswith("##"):
            parts.append(block)
        elif "\n" in block and _is_markdown_list_line(block.split("\n", 1)[0]):
            lines = [re.sub(r"[ \t]+", " ", ln.strip()) for ln in block.split("\n") if ln.strip()]
            parts.append("\n".join(lines))
        else:
            block = re.sub(r"[ \t]+", " ", block)
            parts.append(block)
    t = "\n\n".join(parts)
    t = _split_long_paragraph_blocks(t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def _strip_syndication_and_trailing_cta(text: str) -> str:
    """Remove attribution/syndication lines and any booking CTA block accidentally included in the body."""
    t = (text or "").strip()
    if not t:
        return ""
    lines_out: list[str] = []
    for line in t.split("\n"):
        low = line.lower()
        if "appeared first on" in low or "originally appeared on" in low:
            continue
        lines_out.append(line)
    t = "\n".join(lines_out)
    # Drop horizontal rule + pipeline-style footer / CTA (anything after is marketing noise here).
    for pat in (
        r"\n---\s*\n\s*###\s*Book Your Experience\b",
        r"\n###\s*Book Your Experience\b",
        r"\n---\s*\n\s*###\s*Ready to get on the water",
    ):
        m = re.search(pat, t, flags=re.I | re.M)
        if m:
            t = t[: m.start()].strip()
            break
    # Collapse broken `---` directly before a heading (common model glitch).
    t = re.sub(r"(?m)^---\s*\n+(?=#{1,3}\s)", "", t)
    return t.strip()


def finalize_pipeline_body_for_cms(text: str) -> str:
    """
    Remove markdown images and HTML <img>; keep allowlisted internal `[text](/path)` links and
    trusted authority markdown links. Strips other bare URLs.
    """
    t = (text or "").strip()
    if not t:
        return ""
    t = _strip_syndication_and_trailing_cta(t)
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", t, flags=re.DOTALL)
    t = re.sub(r"<img\b[^>]*>", "", t, flags=re.I)
    t = _sanitize_markdown_links_for_cms(t)
    t = _canonicalize_internal_markdown_links(t)
    t = _strip_bare_http_keep_markdown_links(t)
    lines_out: list[str] = []
    for line in t.split("\n"):
        ln = re.sub(r"[ \t]+", " ", line.strip())
        if re.match(r"^#{1,6}\s*summary\s*$", ln, re.I):
            continue
        lines_out.append(ln)
    t = "\n".join(lines_out)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def seo_image_alt_from_title(title: str, content_hint: str = "") -> str:
    raw = re.sub(r"\s+", " ", (title or "").strip())
    blob = f"{raw} {content_hint}".lower()
    if not raw and not (content_hint or "").strip():
        return "Florida Space Coast boating and Indian River Lagoon water view"
    if any(w in blob for w in ("rocket", "launch", "spacex", "falcon", "nasa")):
        return "rocket launch view from boat in Titusville Florida"
    if "daytona" in blob:
        return "boat rental Daytona Beach sunset water view"
    if any(w in blob for w in ("weather", "forecast", "wind", "storm", "hurricane")):
        return "marine weather and sky conditions over Florida coastal waters"
    clean = re.sub(r"[^\w\s,.-]", "", raw)[:88].strip().lower()
    if not clean:
        clean = "space coast boating"
    return f"{clean} — florida lagoon and water view"[:200]


STRUCTURE_VARIANTS: tuple[str, ...] = (
    """STRUCTURE A — use ## headings; lead with a short hook using only source facts (plain lines, no heading on the hook):
- ## What the article says
- ## Key details
- ## Notes (bullets with "- " only if they restate source points)""",
    """STRUCTURE B — use ## headings:
- Opening lines from the source (no invented scenario), no heading on the opening
- ## Main points
- ## Timeline or context (only if the source provides it)
- ## Takeaways (bullets must mirror the source)""",
    """STRUCTURE C — use ## headings:
- Short intro in your own words, facts from the source only
- ## Background
- ## What happens next / implications (only if stated in the source)
- ## Bullet summary (source-only)""",
    """STRUCTURE D — use ## headings:
- Direct summary first (source-only)
- ## Supporting detail
- ## Checklist (bullets = source facts only)""",
)

TONE_VARIANTS: tuple[str, ...] = (
    "neutral news editor — facts only",
    "plain explanatory — no embellishment",
    "concise advisory — conditions and updates only when in the source",
    "factual summary style — no storytelling beyond the text",
)

OPENING_VARIANTS: tuple[str, ...] = (
    "Lead with the strongest fact or claim as stated in the source (reordered wording allowed).",
    "Start with a neutral summary sentence that contains only source-supported information.",
    "Open with the article's main news or update in plain language, using only what the source states.",
    "Begin with who/what/when/where only if those appear in the source; otherwise start with the clearest stated point.",
)

ANTI_REPETITION_BLOCK = """
READABILITY (within strict paraphrase):
- Vary sentence openings when paraphrasing, but do not add new claims.
- Avoid generic AI filler phrases.
- Do not duplicate the headline as empty filler in multiple sections.
"""

SEARCH_INTENT_READABILITY = """
READABILITY (scan-friendly):
- Follow STEP 6 exactly: one `##` title line, intro, then the five `###` sections in order.
- Obey SECTION LENGTH in STEP 6 (per-section word budgets; one completion).
- One bullet per line; never fuse two bullets on one line.
- Short sentences; no travel-blog adjectives (sparkling, pristine, reminiscent, nestled).
- Do not repeat the TITLE line verbatim as the only sentence in the intro.
"""

SEARCH_INTENT_READABILITY_HUB = """
READABILITY (paraphrase-first):
- Follow STEP 3 exactly: ## headline, news paraphrase FIRST, then boating appendix sections.
- News paraphrase must use original wording drawn from SOURCE FACTS BODY — not generic filler.
- Boating sections come only after the news paraphrase is complete.
- Do not repeat the TITLE line verbatim in every section.
- No placeholder phrases (Key details are limited, plan conservatively, etc.).
"""


def _search_intent_prompt_block(title: str, keyword_topic: str, *, hub: bool = False) -> str:
    """Pipeline-only: reinforces SEO section structure (standard or hub outline)."""
    _ = title, keyword_topic
    if hub:
        return f"""TONE: Local captain — long-form Space Coast boating guide, honest and useful.

STRUCTURE: Obey STEP 6 template outline for the assigned ARTICLE TYPE.

OPENING: The ## section must answer the search intent before subsections.

{SEARCH_INTENT_READABILITY_HUB}
"""
    return f"""TONE: Calm local expert — tight sentences, conversion-aware but honest.

STRUCTURE: Obey STEP 6 in LOCAL_CONTENT_ENGINE (## headline + five ### sections in fixed order). No "Summary" sections.

OPENING: The paragraph under ## must give a direct answer from SOURCE FACTS.

{SEARCH_INTENT_READABILITY}
"""


def _variation_prompt_block(title: str, keyword_topic: str) -> str:
    _ = title, keyword_topic
    return f"""{random.choice(STRUCTURE_VARIANTS)}

TONE (paraphrase only — no new facts): {random.choice(TONE_VARIANTS)}.

OPENING: {random.choice(OPENING_VARIANTS)}

{ANTI_REPETITION_BLOCK}

Formatting: blank line between sections; bullets "- " only when listing points already in the source.
"""


def _append_booster_if_short(content: str) -> str:
    """Strict mode: never invent padding to meet length."""
    return (content or "").strip()


def _ensure_local_place_mention(content: str, category: str = "") -> str:
    """Strict mode: do not append invented local flavor not in the source."""
    _ = category
    return (content or "").strip()


def _append_explore_more(content: str, category: str = "", keyword_topic: str = "") -> str:
    """Strict mode: internal marketing links removed; syndication/CTA blocks stripped when present."""
    _ = category, keyword_topic
    return (content or "").strip()


def _sanitize_published_title(title: str) -> str:
    """Strip model-echoed pipeline jargon from TITLE lines (e.g. 'SEO Hub Entry')."""
    t = (title or "").strip()
    if not t:
        return t
    # Phrases the model copies from internal prompts
    t = re.sub(
        r"(?i)\s*[-–—,;]*\s*\b(SEO\s+hub\s+entry|SEO\s+hub|hub\s+entry|hub\s+mode|pipeline\s+mode)\b"
        r"(\s+for\s+renters\s+and\s+charters)?\s*",
        " ",
        t,
    )
    t = re.sub(r"\s{2,}", " ", t).strip(" ,;–—-")
    return t.strip()


def _parse_seo_title_and_body(raw: str) -> tuple[str | None, str]:
    """
    Expect first lines: TITLE: ... then blank line then body.
    Falls back to body-only if unparsed.
    """
    text = raw.strip()
    if not text:
        return None, ""

    # TITLE: ... then newline(s) then body
    m = re.match(
        r"^\s*TITLE:\s*(.+?)\s*\n+(.*)$",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )
    if m:
        return _sanitize_published_title(m.group(1)), m.group(2).strip()

    first_nl = text.find("\n")
    if first_nl != -1:
        line0 = text[:first_nl].strip()
        rest = text[first_nl + 1 :].strip()
        if line0.upper().startswith("TITLE:"):
            return _sanitize_published_title(line0[6:].strip()), rest

    return None, text


# Substrings must appear in source text before we echo a place in a repaired title.
_TITLE_PLACE_HINTS: tuple[tuple[str, str], ...] = (
    ("daytona beach", "Daytona Beach"),
    ("port orange", "Port Orange"),
    ("titusville", "Titusville"),
    ("space coast", "Space Coast"),
    ("indian river lagoon", "Indian River Lagoon"),
    ("halifax river", "Halifax River"),
    ("cape canaveral", "Cape Canaveral"),
    ("indian river", "Indian River"),
    ("brevard", "Brevard County"),
    ("volusia", "Volusia County"),
    ("cocoa beach", "Cocoa Beach"),
    ("melbourne", "Melbourne"),
)

_TITLE_INTENT_HINT_RE = re.compile(
    r"what\s+to\s+know|need\s+to\s+know|renters|boaters|boat\s+rent|planning\s+your|weekend|before\s+you\s+go|"
    r"should\s+you|what\s+you\s+need|\?",
    re.I,
)


def _ensure_title_seo_shape(title: str, source_blob: str) -> str:
    """
    Soften vague LLM titles using topic + location (from source only) + intent.
    Does not add place names unless they appear in source_blob.
    """
    t = (title or "").strip()
    if not t:
        return t
    blob_l = (source_blob or "").lower()
    tl = t.lower()
    if "?" in t:
        return t[:500]
    if ":" in t and len(t) > 38:
        return t[:500]
    if _TITLE_INTENT_HINT_RE.search(t):
        return t[:500]
    vague = (
        len(t) < 34
        or bool(re.search(r"\b(overview|latest news|news update)\b", tl))
        or (bool(re.search(r"\b(update|conditions)\s*$", tl)) and ":" not in t)
    )
    if not vague and len(t) > 46:
        return t[:500]
    place_disp = None
    for key, disp in _TITLE_PLACE_HINTS:
        if key in blob_l and key not in tl:
            place_disp = disp
            break
    if place_disp:
        return f"{t} in {place_disp}: What Boat Renters Need to Know"[:500]
    return f"{t}: What to Know Before Your Boat Day"[:500]


def _fallback_seo_title(source_title: str, category: str) -> str:
    """When the model omits TITLE, keep a conservative source-grounded headline."""
    _ = category
    base = re.sub(r"\s+", " ", (source_title or "").strip())[:500]
    if base:
        return base
    return "Space Coast boating and marine update"


def _title_has_strong_local_signal(text: str) -> bool:
    return bool(
        re.search(
            r"\b(daytona|titusville|space coast|indian river|lagoon|port orange|halifax|brevard|volusia|canaveral|florida)\b",
            (text or ""),
            re.I,
        )
    )


def _sanitize_fallback_title(title: str, source_blob: str = "") -> str:
    """Remove unsupported fallback title expansions when not source-grounded."""
    t = re.sub(r"\s+", " ", (title or "").strip())
    if not t:
        return ""
    t = re.sub(r"\s*\(\d{4}\)\s*$", "", t).strip()
    t = re.sub(r"(?i)\s*:\s*what boat renters need to know\s*$", "", t).strip()
    if not _title_has_strong_local_signal(source_blob):
        t = re.sub(r"(?i)\s*[—-]\s*titusville\s*&\s*space\s*coast\s*$", "", t).strip()
    return t[:500]


def _simple_rewrite_prompt(
    text: str,
    *,
    title: str = "",
    keyword_topic: str = "",
) -> str:
    vb = _variation_prompt_block(title, keyword_topic)
    return f"""You are an editor producing clean markdown for a local Florida charter site's blog.

{SOURCE_FIDELITY_ABSOLUTE}

{STRICT_SOURCE_GROUNDING}

---

{vb}

---

INPUT ARTICLE (only factual source you may use):
{text}

---
RESPONSE FORMAT (required for the CMS):
- First line: TITLE: <SEO title — topic + location when the source names one + renter intent; see STEP 3 TITLE SHAPE in the main engine if present; no vague stubs>
- Blank line
- Then markdown body: paraphrase and structure only; no marketing or charter CTAs in your text.
"""


def _fallback_excerpt_thirds(excerpt: str) -> tuple[str, str, str]:
    """Split excerpt into intro + two section bodies using sentence boundaries."""
    text = re.sub(r"\s+", " ", (excerpt or "").strip())
    if not text:
        return "", "", ""

    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    if not sents:
        return text, text, text

    # Keep section starts readable: split by sentence index, not raw words.
    n = len(sents)
    if n == 1:
        # Split one long sentence into clauses to avoid repeated-long-phrase failures.
        clauses = [c.strip(" ,;:-") for c in re.split(r"[;,:-]\s+", sents[0]) if c.strip(" ,;:-")]
        if len(clauses) >= 3:
            return clauses[0], clauses[1], clauses[2]
        if len(clauses) == 2:
            return clauses[0], clauses[1], clauses[0]
        # Last resort: split by word windows so sections are distinct snippets.
        words = sents[0].split()
        if len(words) >= 18:
            a = " ".join(words[:18]).strip()
            b = " ".join(words[18:36]).strip() or a
            c = " ".join(words[36:54]).strip() or b
            return a, b, c
        return sents[0], sents[0][:120].rstrip(" ,;:-"), sents[0][:80].rstrip(" ,;:-")
    if n == 2:
        # Keep three sections distinct even when only two sentences are available.
        tail_words = sents[1].split()
        tail = " ".join(tail_words[-18:]).strip() if len(tail_words) > 18 else sents[0][:120].strip()
        return sents[0], sents[1], tail

    t1 = max(1, n // 3)
    t2 = max(t1 + 1, (2 * n) // 3)
    intro = " ".join(sents[:t1]).strip()
    mid = " ".join(sents[t1:t2]).strip()
    end = " ".join(sents[t2:]).strip()
    if not mid:
        mid = intro
    if not end:
        end = mid
    return intro, mid, end


def _norm_phrase(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", (s or "").lower())).strip()


def _too_similar_phrase(a: str, b: str) -> bool:
    na, nb = _norm_phrase(a), _norm_phrase(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    if na in nb or nb in na:
        return True
    wa = set(na.split())
    wb = set(nb.split())
    if not wa or not wb:
        return False
    overlap = len(wa & wb) / max(1, min(len(wa), len(wb)))
    return overlap >= 0.8


def _dedupe_fallback_sections(
    title: str, intro: str, means: str, ways: str, before_go: str
) -> tuple[str, str, str, str]:
    """Reduce repeated-long-phrase risk in thin fallback outputs."""
    intro_out = intro.strip()
    means_out = means.strip()
    ways_out = ways.strip()
    before_out = before_go.strip()

    # If intro mostly echoes title, prefer a shorter neutral lead.
    if _too_similar_phrase(intro_out, title):
        intro_out = intro_out[:140].strip()

    if _too_similar_phrase(means_out, intro_out) or _too_similar_phrase(means_out, title):
        means_out = ""
    if _too_similar_phrase(ways_out, intro_out) or _too_similar_phrase(ways_out, means_out) or _too_similar_phrase(
        ways_out, title
    ):
        ways_out = ""
    if _too_similar_phrase(before_out, intro_out) or _too_similar_phrase(before_out, means_out) or _too_similar_phrase(
        before_out, ways_out
    ):
        before_out = ""

    # Keep sections non-empty without reusing long repeated phrases.
    if not means_out:
        means_out = (
            "On the Indian River Lagoon near Titusville, launch news affects ramp traffic, "
            "hold zones, and how early you should be on the water for a safe viewing position."
        )
    if not ways_out:
        ways_out = (
            "Watching from a boat gives mobility when haze sits on shore and room for cameras "
            "without parking-lot crowds along the Space Coast."
        )
    if not before_out:
        before_out = (
            "Confirm the official launch window and marine forecast before you leave the dock, "
            "and keep plans flexible if the range scrubs."
        )

    return intro_out, means_out, ways_out, before_out


def _fallback_before_you_go_tail(excerpt: str) -> str:
    """Closing section: last source sentence when available; no authority links in fallback."""
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+", (excerpt or "").strip()) if s.strip()]
    return sents[-1] if sents else ""


def _fallback_local_context_sentence(excerpt: str) -> str:
    """Return a local context sentence only when source has strong local geography."""
    blob = re.sub(r"\s+", " ", (excerpt or "").strip())
    if not blob:
        return ""
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+", blob) if s.strip()]
    pat = re.compile(
        r"daytona|titusville|space coast|indian river|lagoon|port orange|halifax|brevard|volusia|canaveral",
        re.I,
    )
    for s in sents:
        if pat.search(s):
            return s
    return ""


def _fallback_checklist_from_source(excerpt: str, title: str = "") -> list[str]:
    """Extract short checklist bullets from source sentences; always return at least one source-grounded bullet."""
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+", (excerpt or "").strip()) if s.strip()]
    if not sents:
        return []
    cue = re.compile(
        r"\b(check|must|required|advisory|warning|forecast|avoid|wear|confirm|expect|rule|regulation|safety)\b",
        re.I,
    )
    bullets: list[str] = []
    for s in sents:
        if _too_similar_phrase(s, title):
            continue
        if cue.search(s):
            cleaned = re.sub(r"\s+", " ", s).strip()
            if len(cleaned.split()) < 4:
                continue
            bullets.append(cleaned[:180])
        if len(bullets) >= 2:
            break
    if not bullets:
        # Keep structure valid without inventing guidance.
        fallback = ""
        for s in sents:
            if not _too_similar_phrase(s, title):
                fallback = re.sub(r"\s+", " ", s).strip()
                break
        if not fallback:
            fallback = (
                "Use only facts stated above when planning your trip on the Indian River Lagoon."
            )
        if fallback:
            bullets.append(fallback[:180])
    return bullets


def fallback_rewrite(
    source_text: str, title: str, category: str, *, append_footer: bool | None = None
) -> str:
    """Structured paraphrase of source text only; CTA blocks are handled downstream."""
    if append_footer is None:
        append_footer = False
    raw_title = (title or "").strip()
    st = (source_text or "").strip()
    if len(st.split()) < 80:
        st = f"{raw_title}. {st}".strip() if raw_title else st
    ft = _sanitize_fallback_title(_fallback_seo_title(raw_title, category), st)
    st = _clean_fallback_source_text(st, raw_title, ft)
    excerpt = truncate_text(st, max_words=400).strip()
    if not excerpt or len(excerpt.split()) < 8:
        excerpt = re.sub(r"\s+", " ", (raw_title or ft or "Source excerpt unavailable."))[:2000].strip()
    h2 = re.sub(r"\s*\(\d{4}\s*Guide\)\s*$", "", ft).strip()
    h2 = re.sub(r"\s*[—–]\s*Titusville.*$", "", h2).strip()
    if len(h2) < 8:
        h2 = "Space Coast Water Update"
    intro_part, means_part, ways_part = _fallback_excerpt_thirds(excerpt)
    local_ctx = _fallback_local_context_sentence(excerpt)
    checklist_items = _fallback_checklist_from_source(excerpt, ft)
    before_go = _fallback_before_you_go_tail(excerpt)
    intro_part, means_part, ways_part, before_go = _dedupe_fallback_sections(
        ft, intro_part, means_part, ways_part, before_go
    )
    checklist_section = "### Practical Checklist Before You Leave the Dock\n\n" + "\n".join(
        f"- {x}" for x in checklist_items[:2]
    )
    local_context_section = ""
    if local_ctx:
        local_context_section = f"### Local Context: Daytona Beach & Space Coast\n\n{local_ctx}"
    body = f"""TITLE: {ft}

## {h2}

{intro_part}

### What This Means For Your Trip

{means_part}

### Best Ways to Experience the Space Coast Safely

{ways_part}

{checklist_section}

{local_context_section}

### Before You Go

{before_go}
"""
    if append_footer:
        return _append_allowed_cta_only(body)
    return body.strip()


def pipeline_fallback_from_source(source_blob: str, title: str, category: str) -> dict[str, str]:
    """
    When the LLM fails, use deterministic excerpt formatting — still from `source_blob` only
    (plus the standard CTA appended inside fallback_rewrite).
    """
    raw = fallback_rewrite(source_blob, title, category)
    parsed_title, body = _parse_seo_title_and_body(raw)
    return {
        "title": _sanitize_fallback_title(
            ((parsed_title or "").strip() or (title or "").strip())[:500],
            source_blob,
        ),
        "content": (body or "").strip(),
    }


def _ollama_stream_generate(prompt: str) -> str:
    """Stream /api/generate to avoid long blocking on a single JSON response."""
    payload: dict[str, Any] = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": True,
        "options": {
            "num_predict": _ollama_num_predict(),
            "temperature": OLLAMA_TEMPERATURE,
            "top_p": OLLAMA_TOP_P,
        },
    }
    last_err: Exception | None = None
    for attempt in range(1, OLLAMA_REQUEST_ATTEMPTS + 1):
        try:
            with requests.post(
                OLLAMA_URL,
                json=payload,
                stream=True,
                timeout=OLLAMA_STREAM_TIMEOUT_SEC,
                headers={"Content-Type": "application/json"},
            ) as r:
                r.raise_for_status()
                parts: list[str] = []
                for line in r.iter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line.decode("utf-8"))
                    except json.JSONDecodeError:
                        continue
                    parts.append(chunk.get("response", "") or "")
            text = "".join(parts).strip()
            if text:
                return text
            last_err = RuntimeError("Empty Ollama streamed response")
            print(f"ERROR: Ollama stream empty (attempt {attempt}/{OLLAMA_REQUEST_ATTEMPTS})")
        except Exception as e:
            record_if_requests_timeout(e)
            last_err = e
            print(f"ERROR: Ollama stream attempt {attempt}/{OLLAMA_REQUEST_ATTEMPTS}: {e}")
        if attempt < OLLAMA_REQUEST_ATTEMPTS:
            time.sleep(1.5 * (attempt + 1))
    return ""


def _final_image_url(raw: str) -> str:
    s = (raw or "").strip()
    return s if s else "/images/rocket-launch-boat-rentals-titusville-florida-launch-zone-charters-logo-indian-river-lagoon.png"


def fallback_summary(text: str) -> str:
    """Simple safe fallback when Ollama is unavailable (first ~800 chars of source)."""
    return (text or "")[:800]


def generate_with_ollama(
    title: str,
    category: str = CAT_DEFAULT,
    keyword_topic: str = "",
) -> str:
    """
    Generate a full article when source text could not be loaded.
    Uses streaming /generate for lower perceived latency; weak output uses fallback_rewrite.
    """
    vb = _variation_prompt_block(title, keyword_topic)
    prompt = f"""You are an editor. No full article text was provided — only a headline/topic line.

{SOURCE_FIDELITY_ABSOLUTE}

{STRICT_SOURCE_GROUNDING}

CRITICAL: Do NOT invent facts, places, events, or story details. Do NOT write a fake boating narrative.

You MAY:
- Restate the topic in plain language in 1–2 short paragraphs.
- Add one sentence that you cannot verify details without the full article (neutral, no fake specifics).

You MUST NOT:
- Add locations, times, people, or businesses not in the topic line.

---

{vb}

---

TOPIC LINE (only source):
{title}

---
RESPONSE FORMAT (required for the CMS):
- First line: TITLE: <your SEO title — conservative; only what the topic line can support>
- Blank line
- Short markdown body per rules above. No charter CTAs in your text.
"""
    out = _ollama_stream_generate(prompt)
    if not (out or "").strip():
        print("[AI] weak output → fallback")
        return fallback_rewrite("", title, category)
    if len(out.split()) < 40:
        print("[AI] weak output → fallback")
        return fallback_rewrite("", title, category)
    return out


def _pipeline_source_blob(article: dict[str, Any]) -> str:
    """Title + summary + required scraped body for paraphrase-first rewrite."""
    title = (article.get("title") or "").strip()
    summary = (article.get("summary") or "").strip()
    body = _clean_source_for_prompt((article.get("content") or "").strip())
    parts: list[str] = []
    if title:
        parts.append(f"HEADLINE:\n{title}")
    if summary:
        parts.append(f"SUMMARY:\n{summary}")
    if body:
        parts.append(f"BODY (required — paraphrase this publisher text):\n{body}")
    return "\n\n".join(parts).strip()


def rewrite_pipeline_article(article: dict[str, Any]) -> dict[str, Any] | None:
    """
    Run Ollama rewrite using standardized article keys; mutates and returns the same dict.
    Title + RSS summary drive the piece; scraped body is optional. On failure returns None.

    When `PIPELINE_SEO_HUB_MODE` is on (default in config), uses LOCAL_CONTENT_ENGINE_SEO_HUB:
    longer outline (optional Q&A, checklist) and a larger source word budget.
    """
    try:
        title = (article.get("title") or "").strip()
        cat = str(article.get("category") or CAT_DEFAULT)
        cat = cat if cat in CATEGORY_PRIMARY_SEO_PHRASE else CAT_DEFAULT
        keyword_topic = str(article.get("keyword_topic") or "")

        summary_raw = (article.get("summary") or "").strip()
        body_clean = _clean_source_for_prompt((article.get("content") or "").strip())
        if _word_count(body_clean) < 80:
            raise RewriteFailedError(
                f"Source body too short for paraphrase ({_word_count(body_clean)} words)"
            )
        blob = _pipeline_source_blob(article)
        if not blob or "BODY (required" not in blob:
            raise RewriteFailedError("Missing publisher body — cannot paraphrase")

        fallback_title = _fallback_seo_title(title, cat)
        hub = PIPELINE_SEO_HUB_MODE
        max_src_words = 2500 if hub else 800
        article_text = truncate_text(blob, max_words=max_src_words)
        seo_template = detect_seo_template(
            category=cat,
            keyword_topic=keyword_topic,
            title=title,
            body=body_clean,
        )
        engine = (
            build_paraphrase_first_engine(
                allowed_paths=ALLOWED_INTERNAL_PATHS_PROMPT_LIST,
                writer_conventions=PIPELINE_WRITER_CONVENTIONS,
                min_words=MIN_WORDS_SEO_HUB,
            )
            if hub
            else LOCAL_CONTENT_ENGINE
        )
        vb = _search_intent_prompt_block(title, keyword_topic, hub=hub)
        step6_line = (
            "## headline, news paraphrase first, then ### What This Means For Your Space Coast Boat Trip, then ### Before You Go"
            if hub
            else "## headline, intro, five required ### sections in strict order (optional sixth: Questions Readers Ask)"
        )
        grounding_block = f"{SOURCE_FIDELITY_ABSOLUTE}\n\n{STRICT_SOURCE_GROUNDING}"
        print(
            json.dumps(
                {
                    "stage": "pipeline_mode",
                    "seo_hub": hub,
                    "seo_template": seo_template if hub else None,
                    "source_url": (article.get("source_url") or "")[:200],
                    "source_words_cap": max_src_words,
                    "source_body_words": _word_count(body_clean),
                    "max_output_words": _pipeline_max_output_words(),
                    "min_output_words": MIN_WORDS_SEO_HUB if hub else MIN_WORDS_TARGET,
                    "ollama_num_predict": _ollama_num_predict(),
                    "source_summary_words": len(summary_raw.split()),
                    "source_has_body": bool(body_clean),
                },
                ensure_ascii=False,
            )
        )
        prompt = f"""
You are an editor paraphrasing a news article for Launch Zone Charters Captain's Log.

{engine}

---

{vb}

---

{grounding_block}

---

SOURCE FACTS (paraphrase the BODY; use HEADLINE/SUMMARY for context only):
{article_text}

---
RESPONSE FORMAT (required for the CMS):
- First line: TITLE: <SEO title>
- Blank line
- Markdown body: follow STEP 3 exactly ({step6_line}).
- News paraphrase MUST come before any boating-context sections.
- No placeholder filler. No images or phone numbers. Internal markdown links in Before You Go only.
"""
        response_text = _ollama_stream_generate(prompt)
        if not response_text or len(response_text.split()) < 80:
            raise RewriteFailedError(
                "Ollama rewrite too short or empty — refusing placeholder fallback"
            )
        if not (response_text or "").strip():
            raise RewriteFailedError(
                f"Ollama rewrite failed after {OLLAMA_REQUEST_ATTEMPTS} attempts (empty output)"
            )

        try:
            parsed_title, rewritten_content = _parse_seo_title_and_body(response_text)
            rewritten_content = _normalize_article_output(rewritten_content)
            rewritten_content = finalize_pipeline_body_for_cms(rewritten_content)
            if not rewritten_content.strip():
                raise RewriteFailedError("Ollama returned TITLE/body but body parsed empty")
            seo_title = ((parsed_title or "").strip() or fallback_title)[:500]
            seo_title = _ensure_title_seo_shape(seo_title, blob)[:500]

            rewritten_content = _ensure_local_place_mention(rewritten_content, cat)
            rewritten_content = _append_booster_if_short(rewritten_content)
            rewritten_content = ensure_minimum_length(rewritten_content, title)
            wc_final = _word_count(rewritten_content)
            max_out = _pipeline_max_output_words()
            if wc_final > max_out + 100:
                rewritten_content = _trim_to_word_budget(
                    rewritten_content, max_words=max_out + 120
                )

            ok_qc, reason_qc, meta_qc = validate_rewritten_article(
                blob,
                seo_title,
                rewritten_content,
            )
            article["_pipeline_source_blob"] = blob
            article["_grounding_meta"] = meta_qc
            print(
                json.dumps(
                    {
                        "stage": "grounding_qc",
                        "ok": ok_qc,
                        "reason": reason_qc,
                        "generated_word_count": _word_count(rewritten_content),
                        **meta_qc,
                    },
                    ensure_ascii=False,
                )
            )
            if not ok_qc:
                raise RewriteFailedError(f"Grounding QC failed: {reason_qc}")

        except RewriteFailedError:
            raise
        except Exception as e:
            raise RewriteFailedError(f"Ollama output parse/handle failed: {e}") from e

        article["title"] = seo_title
        article["image_alt"] = seo_image_alt_from_title(
            seo_title,
            (rewritten_content or "")[:600],
        )
        content = _ensure_final_content_floor(rewritten_content)
        article["content"] = content
        article["category"] = cat
        article["_pipeline_source_blob"] = blob
        return article
    except TopicMismatchError:
        raise
    except RewriteFailedError:
        raise
    except Exception as e:
        print(f"[REWRITE FAILED] {e}")
        return None


def rewrite_article(
    title: str,
    source_url: str | None = None,
    source_text: str | None = None,
    *,
    category: str = CAT_DEFAULT,
    keyword_topic: str = "",
    image_url: str = "",
) -> ArticleRewrite:
    """
    Rewrite SOURCE into SEO title + structured body for the Captain's Log.
    If source_text is None, may download from source_url. If source_text is provided (including ""),
    only that text is used — no URL fetch and no weak placeholder body.
    Raises TopicMismatchError if scraped text does not match keyword_topic (caller should skip).
    """
    cat = category if category in CATEGORY_PRIMARY_SEO_PHRASE else CAT_DEFAULT
    img_out = _final_image_url(image_url)
    explicit_source = source_text is not None
    body = (source_text or "").strip()
    if not explicit_source and source_url:
        su = (source_url or "").strip().lower()
        if "news.google.com" not in su:
            body = fetch_source_text(source_url)

    body = _clean_source_for_prompt(body)

    weak_injected = False
    if not body or len(body.strip()) < 100:
        if explicit_source:
            raise RewriteFailedError(
                "No real article content for rewrite (need at least 100 words after cleaning)"
            )
        print("[SKIP] empty or weak content → using fallback content")
        body = WEAK_SOURCE_FALLBACK_TEXT.strip()
        weak_injected = True

    if not body:
        if not text_matches_keyword_topic(title, "", keyword_topic):
            raise TopicMismatchError(
                f"Title/source empty and title does not match keyword_topic={keyword_topic!r} url={source_url!r}"
            )
        logger.warning("No source text for '%s'; generating full article via Ollama", title)
        print("[USING OLLAMA]", title)
        content = generate_with_ollama(title, cat, keyword_topic)
        rewritten_content = _normalize_article_output(content)
        if not (rewritten_content or "").strip():
            raise RewriteFailedError("Ollama returned no text for empty source body")
        rewritten_content = _ensure_local_place_mention(rewritten_content, cat)
        rewritten_content = _append_booster_if_short(rewritten_content)
        rewritten_content = ensure_minimum_length(rewritten_content, title)
        max_out = _pipeline_max_output_words()
        if _word_count(rewritten_content) > max_out + 50:
            rewritten_content = _trim_to_word_budget(
                rewritten_content, max_words=max_out + 80
            )
        rewritten_content = finalize_pipeline_body_for_cms(rewritten_content)
        return ArticleRewrite(
            seo_title=title[:500], content=rewritten_content, image_url=img_out, category=cat
        )

    if not weak_injected and not text_matches_keyword_topic(title, body, keyword_topic):
        raise TopicMismatchError(
            f"source does not match keyword_topic={keyword_topic!r} title={title[:80]!r}"
        )

    fallback_title = _fallback_seo_title(title, cat)

    body = truncate_text(body)
    prompt = _simple_rewrite_prompt(body, title=title, keyword_topic=keyword_topic)
    response_text = _ollama_stream_generate(prompt)
    if not response_text or len(response_text.split()) < 100:
        print("[AI] weak output → fallback")
        response_text = fallback_rewrite(body, title, cat)
    if not (response_text or "").strip():
        raise RewriteFailedError(
            f"Ollama rewrite failed after {OLLAMA_REQUEST_ATTEMPTS} attempts (empty output)"
        )

    try:
        parsed_title, rewritten_content = _parse_seo_title_and_body(response_text)
        rewritten_content = _normalize_article_output(rewritten_content)
        if not rewritten_content.strip():
            raise RewriteFailedError("Ollama returned TITLE/body but body parsed empty")
        seo_title = ((parsed_title or "").strip() or fallback_title)[:500]
        seo_title = _ensure_title_seo_shape(seo_title, f"{title}\n\n{body}")[:500]

        rewritten_content = _ensure_local_place_mention(rewritten_content, cat)
        rewritten_content = _append_booster_if_short(rewritten_content)
        rewritten_content = ensure_minimum_length(rewritten_content, title)
        wc_final = _word_count(rewritten_content)
        max_out = _pipeline_max_output_words()
        if wc_final > max_out + 50:
            rewritten_content = _trim_to_word_budget(
                rewritten_content, max_words=max_out + 80
            )

        rewritten_content = finalize_pipeline_body_for_cms(rewritten_content)

        return ArticleRewrite(
            seo_title=seo_title, content=rewritten_content, image_url=img_out, category=cat
        )
    except RewriteFailedError:
        raise
    except Exception as e:
        raise RewriteFailedError(f"Ollama output parse/handle failed: {e}") from e


def _trim_to_word_budget(text: str, max_words: int = 650) -> str:
    """Cap length while keeping paragraph breaks where possible."""
    if _word_count(text) <= max_words:
        return text
    logger.info("Trimming article to ~%s words for readability", max_words)
    paras = [p.strip() for p in text.split("\n\n") if p.strip()]
    out_parts: list[str] = []
    count = 0
    for p in paras:
        wc_p = _word_count(p)
        if count + wc_p <= max_words:
            out_parts.append(p)
            count += wc_p
            continue
        remaining = max_words - count
        if remaining > 30:
            w = p.split()
            if len(w) > remaining:
                out_parts.append(" ".join(w[:remaining]).rstrip(",;:") + "…")
            else:
                out_parts.append(p)
        break
    return "\n\n".join(out_parts) if out_parts else text[:4000].rsplit(" ", 1)[0] + "…"
