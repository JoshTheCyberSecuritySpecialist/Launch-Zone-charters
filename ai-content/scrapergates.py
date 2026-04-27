"""
Captain's Log pipeline gates: local intent, niche keywords, publisher allowlist, pillar scoring,
and `is_relevant_to_topic_with_summary` (RSS row → topic fit).

Kept separate from scraper.py for maintainability; imported with `from scrapergates import *`.
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

from config import PIPELINE_VERBOSE


def _log_title(title: str | None, max_len: int = 220) -> str:
    """Single line for logs — RSS titles may contain newlines and break [PYTHON STDOUT] lines."""
    t = " ".join((title or "").split())
    return t[:max_len] if len(t) > max_len else t


def _rg_log(*args: object) -> None:
    """Relevance gate chatter — off when PIPELINE_VERBOSE=0 (counts still in fetch_all reject_stats)."""
    if PIPELINE_VERBOSE:
        print(*args)

LOCAL_INTENT_TERMS: tuple[str, ...] = (
    "daytona",
    "daytona beach",
    "port orange",
    "titusville",
    "space coast",
    "cape canaveral",
    "kennedy",
    "indian river",
    "indian river lagoon",
    "lagoon",
    "florida",
    "ponce inlet",
    "halifax",
    "halifax river",
    "volusia",
    "brevard",
    "new smyrna",
    "ormond beach",
)

REQUIRED_NICHE_KEYWORDS: tuple[str, ...] = (
    "boat",
    "boats",
    "boating",
    "marine",
    "lagoon",
    "launch",
    "fishing",
    "charter",
    "rocket",
    "spacex",
    "cape canaveral",
    "kennedy",
    "titusville",
    "daytona",
    "space coast",
    "sandbar",
    "intracoastal",
    "pontoon",
    "marina",
)

# Strict gate: title/summary must show local intent OR strong marine intent (final relevance layer).
STRICT_LOCAL_SIGNAL_PHRASES: tuple[str, ...] = (
    "daytona beach",
    "daytona",
    "port orange",
    "titusville",
    "space coast",
    "indian river lagoon",
    "halifax river",
    "cape canaveral",
)

_STRONG_MARINE_INTENT_RE = re.compile(
    r"boat\s+rental|boating\s+safety|marine\s+weather|marine\s+forecast|"
    r"fishing\s+conditions|"
    r"launch\s+viewing.{0,80}\bwater\b|\bwater\b.{0,80}launch\s+viewing|"
    r"viewing\s+from\s+the\s+water|"
    r"\blagoon\b|waterway\s+navigation|intracoastal\s+navigation",
    re.I,
)

_HARD_EXCLUDE_RE = re.compile(
    r"\b(?:crypto|bitcoin|ethereum|blockchain|nft|defi)\b|"
    r"\b(?:election|politics|political\s+campaign|gubernatorial|midterms?)\b|"
    r"\b(?:celebrity|hollywood|influencer)\b|"
    r"\b(?:ai\s+startup|venture\s+capital|\bipo\b|wall\s+street|stock\s+market|nasdaq)\b|"
    r"\b(?:tech\s+startup|silicon\s+valley)\b",
    re.I,
)

ALLOWED_SOURCE_HOST_SUFFIXES: tuple[str, ...] = (
    "spacecoastdaily.com",
    "floridatoday.com",
    "news-journalonline.com",
    "clickorlando.com",
    "hometownnewsvolusia.com",
    "orlandosentinel.com",
    "fox35orlando.com",
    "wesh.com",
    "space.com",
    "spaceflightnow.com",
    "weather.gov",
    "myfwc.com",
    "visitflorida.com",
    "visitspacecoast.com",
    "daytonabeach.com",
    "nasa.gov",
    "spacex.com",
    "boatingmag.com",
    "sportfishingmag.com",
    "tampabay.com",
    "fox13news.com",
    "tcpalm.com",
    "foxweather.com",
    "jacksonville.com",
    "bairdmaritime.com",
    "boatingindustry.com",
    "local10.com",
    "wkmg.com",
)


def _local_geo_hit(blob: str) -> bool:
    b = (blob or "").lower()
    return any(t in b for t in LOCAL_INTENT_TERMS)


def _required_niche_keyword_hit(blob: str) -> bool:
    b = (blob or "").lower()
    return any(k in b for k in REQUIRED_NICHE_KEYWORDS)


def _strict_local_signal_hit(blob: str) -> bool:
    b = (blob or "").lower()
    return any(p in b for p in STRICT_LOCAL_SIGNAL_PHRASES)


def _strong_marine_intent_hit(blob: str) -> bool:
    return bool(_STRONG_MARINE_INTENT_RE.search(blob or ""))


def passes_strict_launch_zone_relevance(title: str, summary: str) -> bool:
    """True if (A) strict local geo signal or (B) strong marine / on-water intent — see product spec."""
    blob = f"{title} {summary}"
    return _strict_local_signal_hit(blob) or _strong_marine_intent_hit(blob)


def is_hard_excluded_content(title: str, summary: str, url: str | None = None) -> bool:
    """
    Hard deny: finance, politics, crypto, celebrity, generic tech/business — never used to remove
    existing gates; this is an additional filter.
    """
    blob = f"{title} {summary} {url or ''}"
    if _HARD_EXCLUDE_RE.search(blob):
        return True
    try:
        path = (urlparse(url or "").path or "").lower()
    except Exception:
        path = ""
    if "/politics/" in path or "/election/" in path:
        return True
    return False


def _strict_gate(title: str | None, summary: str | None, lt: str) -> bool:
    if passes_strict_launch_zone_relevance(title or "", summary or ""):
        return True
    _rg_log("[RELEVANCE] rejected (strict local/marine required):", lt)
    return False


def _source_host_allowed(url: str) -> bool:
    try:
        host = (urlparse(url or "").hostname or "").lower()
    except Exception:
        return False
    if host.startswith("www."):
        host = host[4:]
    return any(host.endswith(suffix) for suffix in ALLOWED_SOURCE_HOST_SUFFIXES)


def _is_google_news_transport_url(url: str | None) -> bool:
    try:
        host = (urlparse((url or "").strip()).hostname or "").lower()
    except Exception:
        return False
    if host.startswith("www."):
        host = host[4:]
    return host == "news.google.com"


def _source_allowed_with_transport_hint(resolved_url: str | None, source_hint_url: str | None) -> bool:
    if resolved_url and _is_google_news_transport_url(resolved_url):
        if not source_hint_url:
            return False
        return _source_host_allowed(source_hint_url)
    return _source_host_allowed(resolved_url or "")


def _water_activity_hit(blob: str) -> bool:
    b = (blob or "").lower()
    return bool(
        re.search(
            r"\b(boat|boats|boating|boat\s+rental|rentals?|pontoon|yacht|vessel|sailboat|"
            r"charter|marina|dock|inlet|"
            r"intracoastal|lagoon|kayak|paddleboard|paddle\s+board|jet\s*ski|"
            r"wildlife\s+tour|dolphin|sunset\s+cruise|sandbar|on\s+the\s+water)\b",
            b,
        )
    )


def _fishing_intent_hit(blob: str) -> bool:
    b = (blob or "").lower()
    return bool(
        re.search(
            r"\b(fishing|fisherman|fishermen|angler|anglers|fly\s+fishing|"
            r"kingfish|king\s+fish|wahoo|mahi|mahi[- ]mahi|dolphin\s+fish|"
            r"tuna|snapper|grouper|snook|redfish|trout|seatrout|speckled|tarpon|"
            r"pompano|crappie|marlin|sailfish|cobia|flounder|drum|"
            r"inshore|offshore|jigging|trolling|shore\s+jigging|"
            r"bait\s+fishing|live\s+bait|chum|"
            r"hot\s+bites?|fishing\s+destination|spearfishing|catch\s+and\s+release|"
            r"pier\s+fishing|surf\s+fishing|flats\s+fishing)\b",
            b,
        )
    )


def _is_obvious_non_niche_story(title: str, summary: str) -> bool:
    blob = f"{title} {summary}".lower()
    return bool(
        re.search(
            r"\b(hit[- ]and[- ]run|school\s+bus|bus\s+crash|crash|collision|"
            r"shooting|stabbing|murder|arrest|police|deputy|sheriff|"
            r"students?\s+hurt|hospitalized|injured|killed|dead|amber\s+alert)\b",
            blob,
        )
    )


def _rocket_launch_brand_false_positive(blob: str) -> bool:
    b = (blob or "").lower()
    if re.search(r"\blaunch\s+credit(\s+union)?\b", b):
        return True
    if re.search(r"\b(product|software|app|startup|game)\s+launch\b", b):
        return True
    return False


def _has_space_coast_launch_intent(blob: str) -> bool:
    b = (blob or "").lower()
    if any(
        t in b
        for t in (
            "kennedy space",
            "kennedy space center",
            " ksc",
            "ksc ",
            "cape canaveral",
            "space coast",
            "brevard",
            "titusville",
            "playalinda",
            "max brewer",
            "port canaveral",
            "cocoa beach",
            "satellite beach",
            "melbourne",
            "patrick space",
            "launch complex",
            "pad 39",
            "pad a",
            "pad b",
        )
    ):
        return True
    if "florida" in b and re.search(r"\b(launch|scrub|slip|falcon|spacex|rocket|starship)\b", b):
        return True
    if re.search(r"\b(spacex|falcon)\b", b) and (
        "florida" in b or "space coast" in b or "canaveral" in b or "kennedy" in b
    ):
        return True
    return False


def _rocket_pillar_reject_national_nasa_event(title: str, summary: str) -> bool:
    b = f"{title} {summary}".lower()
    if re.search(r"\b(human\s+)?exploration\s+rover\s+challenge\b", b):
        return True
    if re.search(r"\bstudent\s+(?:team\s+)?challenge\b", b) and "marshall" in b:
        return True
    if re.search(
        r"\b(marshall\s+space\s+flight|u\.s\.\s+space\s*(?:&|and)\s*rocket\s+center|"
        r"in\s+huntsville|huntsville,\s*alabama)\b",
        b,
    ):
        if not _has_space_coast_launch_intent(b) and "florida" not in b and "cape canaveral" not in b:
            return True
    return False


def _is_rocket_pillar_space_content(title: str, summary: str) -> bool:
    blob = f"{title} {summary}".lower()
    if _rocket_launch_brand_false_positive(blob):
        return False
    if _rocket_pillar_reject_national_nasa_event(title, summary):
        return False
    if re.search(
        r"\b(spacex|falcon\s*9|falcon\s*heavy|starship|starlink|dragon\b|"
        r"rocket\b|rockets\b|artemis|kennedy\s+space|cape\s+canaveral|space\s+coast|"
        r"launch\s+complex|pad\s*39|crew\s+dragon|starliner|"
        r"blue\s+origin|new\s+glenn|ula\b|globalstar|iss\b|space\s+station|"
        r"orbital\s+launch|mission\s+to\s+(the\s+)?(moon|iss|station))\b",
        blob,
    ):
        return True
    if re.search(r"\b(launches?|liftoff|scrub)\b", blob) and _has_space_coast_launch_intent(blob):
        return True
    if re.search(r"\bnasa\b", blob) and _has_space_coast_launch_intent(blob):
        return True
    if "florida" in blob and re.search(r"\bnasa\b", blob) and re.search(
        r"\b(launch|rocket|pad|kennedy|canaveral|falcon|spacex|artemis)\b", blob
    ):
        return True
    return False


def _is_local_launch_news_host(host: str) -> bool:
    h = (host or "").lower()
    if h.startswith("www."):
        h = h[4:]
    return any(
        h.endswith(s)
        for s in (
            "spacecoastdaily.com",
            "floridatoday.com",
            "news-journalonline.com",
            "clickorlando.com",
            "wesh.com",
            "mynews13.com",
            "spectrumnews13.com",
            "fox35orlando.com",
            "tampabay.com",
            "tcpalm.com",
            "fox13news.com",
            "wkmg.com",
            "local10.com",
        )
    )


_LAUNCH_PR_TITLE_JUNK = re.compile(
    r"invites\s+media|media\s+to\b|rollout\s+event|photo\s+op|news\s+conference",
    re.I,
)


def _rocket_pillar_education_ceremony(title: str, summary: str) -> bool:
    b = f"{title} {summary}".lower()
    if re.search(r"\b(commencement|graduation\s+ceremony)\b", b):
        return True
    if re.search(r"\bcommencement\s+speaker\b", b):
        return True
    return False


def _pillar_signal_score(topic_id: str, title: str, summary: str) -> int:
    blob = f"{title} {summary}".lower()
    local_hits = sum(1 for term in LOCAL_INTENT_TERMS if term in blob)

    if topic_id == "rocket-titusville":
        terms = (
            "rocket",
            "spacex",
            "falcon",
            "nasa",
            "artemis",
            "canaveral",
            "kennedy",
        )
        rocket_hits = sum(1 for term in terms if term in blob)
        if not _rocket_launch_brand_false_positive(blob) and "launch" in blob:
            rocket_hits += 1
        return rocket_hits * 3 + local_hits

    if topic_id == "bioluminescent-titusville":
        bio_hits = sum(
            1
            for term in ("bioluminescent", "bioluminescence", "dinoflagellate", "glow", "night paddle")
            if term in blob
        )
        waterday_hits = sum(
            1 for term in ("lagoon", "kayak", "paddle", "tour", "night tour", "wake") if term in blob
        )
        return bio_hits * 4 + waterday_hits * 2 + local_hits

    if topic_id == "boating-port-orange":
        boating_hits = sum(
            1
            for term in (
                "boat",
                "boats",
                "boating",
                "yacht",
                "vessel",
                "sailboat",
                "charter",
                "rental",
                "rentals",
                "pontoon",
                "deck boat",
                "inlet",
                "intracoastal",
                "marine forecast",
                "small craft",
                "halifax",
                "daytona",
                "titusville",
                "sandbar",
                "sunset cruise",
                "dolphin",
                "manatee",
                "jet ski",
                "jetski",
                "kayak",
                "paddleboard",
                "paddle board",
                "ecotour",
                "eco tour",
                "wildlife tour",
                "marina",
                "boat ramp",
                "ramp",
                "volusia",
                "ponce",
                "waterfront",
                "lagoon",
            )
            if term in blob
        )
        return boating_hits * 3 + local_hits * 2

    if topic_id == "fishing-irl":
        fishing_hits = sum(
            1
            for term in (
                "fishing",
                "angler",
                "snook",
                "redfish",
                "trout",
                "seatrout",
                "tarpon",
                "kingfish",
                "wahoo",
                "mahi",
                "snapper",
                "grouper",
                "jigging",
                "trolling",
                "inshore",
                "offshore",
                "indian river lagoon",
                "pompano",
                "flounder",
                "marlin",
                "sailfish",
                "destinations",
                "hot bite",
            )
            if term in blob
        )
        return fishing_hits * 3 + local_hits

    if topic_id == "things-to-do-water-local":
        activity_hits = sum(
            1
            for term in (
                "things to do",
                "on the water",
                "boat tour",
                "charter",
                "rental",
                "rentals",
                "pontoon",
                "cruise",
                "waterfront",
                "lagoon",
                "inlet",
                "wildlife",
                "dolphin",
                "sunset",
                "day trip",
                "family",
                "weekend",
                "visitors",
                "beach",
                "snorkel",
                "paddle",
                "kayak",
                "jet ski",
                "sandbar",
            )
            if term in blob
        )
        return activity_hits * 3 + local_hits * 2

    return 0


def is_relevant_to_topic_with_summary(
    title: str,
    summary: str,
    topic_id: str,
    resolved_url: str | None = None,
    source_hint_url: str | None = None,
) -> bool:
    lt = _log_title(title)
    _rg_log("[RELEVANCE]", lt)
    if resolved_url and not _source_allowed_with_transport_hint(resolved_url, source_hint_url):
        rejected_source = source_hint_url or resolved_url
        _rg_log("[RELEVANCE] rejected source (not allowed):", rejected_source)
        return False

    _rg_log("[RELEVANCE] checking niche keywords:", lt)
    if not _required_niche_keyword_hit(f"{title} {summary}"):
        _rg_log("[RELEVANCE] rejected (no niche keyword):", lt)
        return False
    _rg_log("[RELEVANCE] passed keyword filter:", lt)

    if _is_obvious_non_niche_story(title, summary):
        _rg_log("[RELEVANCE] rejected (crime/traffic/incident):", lt)
        return False

    if topic_id == "rocket-titusville":
        if _rocket_pillar_education_ceremony(title or "", summary or ""):
            _rg_log("[RELEVANCE] rejected (commencement / graduation):", lt)
            return False
        if not _is_rocket_pillar_space_content(title or "", summary or ""):
            _rg_log("[RELEVANCE] rejected (not rocket/space launch story):", lt)
            return False

    score = _pillar_signal_score(topic_id, title or '', summary or '')
    blob = f'{title} {summary}'
    host = ''
    if resolved_url:
        try:
            host = (urlparse(resolved_url).hostname or '').lower()
        except Exception:
            host = ''

    if topic_id == "rocket-titusville":
        if host.endswith("nasa.gov") or "nasa.gov" in (resolved_url or "").lower():
            if not _has_space_coast_launch_intent(blob):
                _rg_log("[RELEVANCE] rejected (nasa.gov without Space Coast angle):", lt)
                return False

    if topic_id == "things-to-do-water-local":
        if not _local_geo_hit(blob):
            _rg_log("[RELEVANCE] rejected (no local geo):", lt)
            return False
        if not _water_activity_hit(blob):
            _rg_log("[RELEVANCE] rejected (no water activity):", lt)
            return False
        if _local_geo_hit(blob):
            return score >= 2 and _strict_gate(title, summary, lt)
        return score >= 3 and _strict_gate(title, summary, lt)

    if topic_id == "boating-port-orange":
        if not _water_activity_hit(blob):
            _rg_log("[RELEVANCE] rejected (no water/boat intent):", lt)
            return False
        if _local_geo_hit(blob) and score >= 2:
            return _strict_gate(title, summary, lt)
        if score >= 3:
            return _strict_gate(title, summary, lt)
        _rg_log("[RELEVANCE] rejected (boating score too low):", lt)
        return False

    if topic_id == "fishing-irl":
        if not _fishing_intent_hit(blob):
            _rg_log("[RELEVANCE] rejected (no fishing intent):", lt)
            return False
        if _local_geo_hit(blob) and score >= 2:
            return _strict_gate(title, summary, lt)
        if score >= 3:
            return _strict_gate(title, summary, lt)
        _rg_log("[RELEVANCE] rejected (fishing score too low):", lt)
        return False

    if score >= 4:
        return _strict_gate(title, summary, lt)
    _rg_log("[RELEVANCE] rejected (pillar score too low):", lt)
    return False



__all__ = [
    "ALLOWED_SOURCE_HOST_SUFFIXES",
    "LOCAL_INTENT_TERMS",
    "REQUIRED_NICHE_KEYWORDS",
    "STRICT_LOCAL_SIGNAL_PHRASES",
    "passes_strict_launch_zone_relevance",
    "is_hard_excluded_content",
    "_LAUNCH_PR_TITLE_JUNK",
    "_fishing_intent_hit",
    "_has_space_coast_launch_intent",
    "_is_google_news_transport_url",
    "_is_local_launch_news_host",
    "_is_obvious_non_niche_story",
    "_is_rocket_pillar_space_content",
    "_local_geo_hit",
    "_pillar_signal_score",
    "_required_niche_keyword_hit",
    "_rocket_launch_brand_false_positive",
    "_rocket_pillar_education_ceremony",
    "_rocket_pillar_reject_national_nasa_event",
    "_source_allowed_with_transport_hint",
    "_source_host_allowed",
    "_water_activity_hit",
    "is_relevant_to_topic_with_summary",
]
