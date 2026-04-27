"""
Last-pass Captain's Log formatter: optional dynamic topic scoring, authority links,
and explicit internal routes (single module; one call site in upload.py).
"""

from __future__ import annotations

import re
from rewrite import markdown_internal_link_allowed, markdown_trusted_authority_link_allowed

_H3_RE = re.compile(r"(?mi)^#{2,3}\s+(.+?)\s*$")
_SENT_RE = re.compile(r"(?<=[.!?])\s+")

# Strong local evidence (minimum bar for the local context section).
_STRONG_LOCAL_RE = re.compile(
    r"\b("
    r"daytona beach|daytona\b|port orange|titusville|indian river lagoon|"
    r"mosquito lagoon|space coast|coco\w* beach|edgewater|new smyrna|"
    r"banana river|melbourne\b|brevard"
    r")\b",
    re.I,
)
# Cape Canaveral / KSC also imply local Space Coast boating context when paired with water/boat context.
_LOCAL_SPACE_COAST = re.compile(
    r"\b(cape canaveral|kennedy space center|ksc)\b.{0,120}\b(boat|water|lagoon|river|marine|launch)\b|\b(boat|water|lagoon|river|marine)\b.{0,120}\b(cape canaveral|kennedy space center)\b",
    re.I | re.DOTALL,
)

TOPIC_PRIORITY: tuple[str, ...] = (
    "regulations_compliance",
    "rocket_launch",
    "bioluminescence_night",
    "marine_weather",
    "boating_safety",
    "first_time_renter",
    "fishing_wildlife",
    "seasonal_holiday",
    "local_boating_conditions",
    "general_boating_guidance",
)

_TOPIC_KEYWORDS: dict[str, tuple[str, ...]] = {
    "regulations_compliance": (
        "boater safety card",
        "rental requirements",
        "age requirement",
        "livery",
        "operator requirements",
        "safety course",
        "boating regulation",
        "fwc",
        "florida boating",
    ),
    "rocket_launch": (
        "rocket launch",
        "launch viewing",
        "launch schedule",
        "cape canaveral",
        "kennedy space center",
        "launch scrub",
        "viewing area",
        "spacex",
        "falcon",
        "starship",
        "space launch",
        "launch window",
    ),
    "bioluminescence_night": (
        "bioluminescence",
        "bioluminescent",
        "night paddle",
        "night water",
        "glow water",
        "dinoflagellate",
    ),
    "marine_weather": (
        "marine forecast",
        "marine weather",
        "sea state",
        "chop",
        "swell",
        "thunderstorm",
        "squall",
        "small craft",
        "small craft advisory",
        "wind advisory",
    ),
    "boating_safety": (
        "life jacket",
        "pfd",
        "navigation lights",
        "throwable",
        "kill switch",
        "boating safety",
        "safe boating",
        "personal flotation",
    ),
    "first_time_renter": (
        "first time",
        "first-time",
        "beginner boater",
        "new renter",
        "rental orientation",
        "new to boating",
        "first rental",
    ),
    "fishing_wildlife": (
        "fishing",
        "angler",
        "flats fishing",
        "wildlife",
        "manatee",
        "dolphin",
        "catch and release",
    ),
    "seasonal_holiday": (
        "holiday weekend",
        "memorial day",
        "fourth of july",
        "labor day",
        "summer season",
        "spring break",
        "winter boating",
    ),
    "local_boating_conditions": (
        "indian river lagoon",
        "mosquito lagoon",
        "banana river",
        "port orange",
        "titusville boating",
        "daytona boating",
        "space coast boating",
        "local marina",
        "local channel",
        "local waterway",
    ),
}

# Trusted authority candidates: (label, url) — hosts must match rewrite.markdown_trusted_authority_link_allowed.
_AUTHORITY_POOLS: dict[str, tuple[tuple[str, str], ...]] = {
    "regulations_compliance": (
        ("Florida FWC boating", "https://myfwc.com/boating/"),
        ("U.S. Coast Guard boating safety", "https://www.uscgboating.org/"),
        ("NOAA weather & oceans", "https://www.noaa.gov/"),
    ),
    "rocket_launch": (
        ("NOAA weather & oceans", "https://www.noaa.gov/"),
        ("Marine forecasts", "https://marine.weather.gov/"),
        ("U.S. Coast Guard boating safety", "https://www.uscgboating.org/"),
    ),
    "bioluminescence_night": (
        ("Marine forecasts", "https://marine.weather.gov/"),
        ("Florida FWC", "https://myfwc.com/"),
        ("NOAA weather & oceans", "https://www.noaa.gov/"),
    ),
    "marine_weather": (
        ("Marine forecasts", "https://marine.weather.gov/"),
        ("NOAA weather & oceans", "https://www.noaa.gov/"),
        ("U.S. Coast Guard boating safety", "https://www.uscgboating.org/"),
    ),
    "boating_safety": (
        ("U.S. Coast Guard boating safety", "https://www.uscgboating.org/"),
        ("Florida FWC boating", "https://myfwc.com/boating/"),
        ("Marine forecasts", "https://marine.weather.gov/"),
    ),
    "first_time_renter": (
        ("U.S. Coast Guard boating safety", "https://www.uscgboating.org/"),
        ("Florida FWC boating", "https://myfwc.com/boating/"),
        ("Marine forecasts", "https://marine.weather.gov/"),
    ),
    "fishing_wildlife": (
        ("Florida FWC", "https://myfwc.com/"),
        ("Marine forecasts", "https://marine.weather.gov/"),
        ("NOAA weather & oceans", "https://www.noaa.gov/"),
    ),
    "seasonal_holiday": (
        ("NOAA weather & oceans", "https://www.noaa.gov/"),
        ("Marine forecasts", "https://marine.weather.gov/"),
        ("U.S. Coast Guard boating safety", "https://www.uscgboating.org/"),
    ),
    "local_boating_conditions": (
        ("Marine forecasts", "https://marine.weather.gov/"),
        ("NOAA weather & oceans", "https://www.noaa.gov/"),
        ("Florida FWC boating", "https://myfwc.com/boating/"),
    ),
    "general_boating_guidance": (
        ("Marine forecasts", "https://marine.weather.gov/"),
        ("NOAA weather & oceans", "https://www.noaa.gov/"),
        ("U.S. Coast Guard boating safety", "https://www.uscgboating.org/"),
    ),
}

# Explicit internal routes only (subset of rewrite.ALLOWED_INTERNAL_MARKDOWN_PATHS).
_INTERNAL_ROUTES_BY_TOPIC: dict[str, tuple[str, ...]] = {
    "regulations_compliance": ("/faqs", "/booking", "/boat-rentals"),
    "rocket_launch": ("/launches", "/conditions", "/booking", "/captains-log"),
    "bioluminescence_night": ("/bioluminescent-tours", "/booking", "/conditions"),
    "marine_weather": ("/conditions", "/faqs", "/booking"),
    "boating_safety": ("/faqs", "/booking", "/boat-rentals"),
    "first_time_renter": ("/faqs", "/pricing", "/booking"),
    "fishing_wildlife": ("/boat-rentals", "/booking", "/captains-log"),
    "seasonal_holiday": ("/pricing", "/booking", "/captains-log"),
    "local_boating_conditions": (
        "/boat-rentals/daytona",
        "/boat-rentals/titusville",
        "/conditions",
        "/booking",
    ),
    "general_boating_guidance": ("/booking", "/captains-log", "/faqs"),
}

_CHECKLIST_PRIMARY: dict[str, tuple[str, ...]] = {
    "regulations_compliance": (
        "Confirm Florida rental-boating requirements that apply to your trip before you reserve.",
        "Verify operator age and education requirements for your party.",
        "Keep proof of safety-course completion accessible if your rental operator requests it.",
    ),
    "rocket_launch": (
        "Check marine weather and visibility along the coast near your viewing plan.",
        "Expect traffic and shoreline crowding near popular viewing windows - leave extra time.",
        "Avoid anchoring or drifting into restricted zones; follow local enforcement guidance.",
    ),
    "bioluminescence_night": (
        "Bring reliable lighting for boarding and navigation rules compliance after dark.",
        "Tell someone your planned return time and general paddling route.",
        "Watch wind and thunderstorms closely — bioluminescence nights can turn rough fast.",
    ),
    "marine_weather": (
        "Read the marine forecast for wind, seas, and thunderstorm chances before departure.",
        "If small craft advisories are posted, shorten your route or postpone.",
        "Plan a bailout point if chop or swell builds during your rental window.",
    ),
    "boating_safety": (
        "Fit life jackets for each passenger before you cast off.",
        "Confirm navigation lights and safety gear match your planned hours on the water.",
        "Brief guests on seated balance and sudden wake risks in crowded channels.",
    ),
    "first_time_renter": (
        "Ask for a renter orientation covering controls, mooring, and emergency shutoff.",
        "Practice slow-speed maneuvers in open water before entering tight quarters.",
        "Keep the rental operator’s emergency contact saved in your phone.",
    ),
    "fishing_wildlife": (
        "Know seasonal closures and wildlife protection rules for your area.",
        "Carry release tools and minimize handling time when practicing catch and release.",
        "Give wildlife wide berth — encounters are unpredictable near shallow flats.",
    ),
    "seasonal_holiday": (
        "Expect heavier boat traffic on holiday weekends — widen following distances.",
        "Book earlier and confirm parking or ramp timing during peak weekends.",
        "Watch for congested anchorages and wake turbulence near sandbars.",
    ),
    "local_boating_conditions": (
        "Compare forecasts for your specific lagoon vs open inlet areas.",
        "Ask locals about shoaling or channel shifts since the last storm season.",
        "Mind afternoon seabreeze spikes common along the Space Coast.",
    ),
    "general_boating_guidance": (
        "Re-check marine forecast and wind before departure.",
        "Confirm life jackets, throwables, and navigation lights are ready.",
        "Keep your route conservative if conditions change.",
    ),
}

_CHECKLIST_SECONDARY_EXTRA: dict[str, tuple[str, ...]] = {
    "regulations_compliance": (
        "Cross-check county or marina notices that sometimes layer on local rules.",
    ),
    "rocket_launch": (
        "Confirm launch schedules can slip — keep fuel and hydration plans flexible.",
    ),
    "bioluminescence_night": (
        "Avoid solo night trips if you are unfamiliar with the waterway.",
    ),
    "marine_weather": (
        "Watch for rapidly building thunderstorms in Florida afternoons.",
    ),
    "boating_safety": (
        "Assign a sober operator before leaving the dock.",
    ),
    "first_time_renter": (
        "Photo-document pre-rental hull condition with the operator when possible.",
    ),
    "fishing_wildlife": (
        "Dispose of line and tackle responsibly to protect wildlife.",
    ),
    "seasonal_holiday": (
        "Consider a weekday rental if you want quieter water.",
    ),
    "local_boating_conditions": (
        "Chat with bait shops or marinas for real-time shallow-water hazards.",
    ),
    "general_boating_guidance": (
        "File a basic float plan with someone on shore.",
    ),
}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _priority_index(topic_id: str) -> int:
    try:
        return TOPIC_PRIORITY.index(topic_id)
    except ValueError:
        return len(TOPIC_PRIORITY)


def _sentences(blob: str) -> list[str]:
    cleaned_lines: list[str] = []
    for line in (blob or "").splitlines():
        ln = line.strip()
        if not ln:
            continue
        if ln.startswith("#"):
            continue
        if re.match(r"^\*\*q:\*\*|\*\*a:\*\*", ln, re.I):
            continue
        if ln.startswith("- "):
            ln = ln[2:].strip()
        cleaned_lines.append(ln)
    cleaned = re.sub(r"\s+", " ", " ".join(cleaned_lines)).strip()
    out: list[str] = []
    for part in _SENT_RE.split(cleaned):
        p = part.strip()
        if len(p) >= 24:
            out.append(p)
    return out


def _pick_sentence_excluding(blob: str, keywords: tuple[str, ...], used: set[str]) -> str:
    for s in _sentences(blob):
        if s in used:
            continue
        low = s.lower()
        if any(k in low for k in keywords):
            used.add(s)
            return s
    for s in _sentences(blob):
        if s not in used:
            used.add(s)
            return s
    return ""


def _keyword_hit(text: str, keywords: tuple[str, ...]) -> bool:
    low = text.lower()
    return any(k in low for k in keywords)


def _body_keyword_hits(body: str, keywords: tuple[str, ...]) -> int:
    low = body.lower()
    return sum(1 for k in keywords if k in low)


def _score_topics(title: str, slug: str, body: str) -> dict[str, int]:
    """Title match +3, slug +2, body +1 per topic (non-stackable within channel)."""
    scores: dict[str, int] = {tid: 0 for tid in TOPIC_PRIORITY if tid != "general_boating_guidance"}
    slug_norm = _norm(slug.replace("-", " "))
    title_n = _norm(title)
    body_n = body.lower()

    for tid, keys in _TOPIC_KEYWORDS.items():
        if tid == "general_boating_guidance":
            continue
        if _keyword_hit(title_n, keys):
            scores[tid] += 3
        if _keyword_hit(slug_norm, keys):
            scores[tid] += 2
        if _keyword_hit(body_n, keys):
            scores[tid] += 1
    return scores


def _best_topic_from_scores(scores: dict[str, int]) -> tuple[str, int]:
    """Highest score; ties broken by TOPIC_PRIORITY (earlier wins)."""
    best_id = "general_boating_guidance"
    best_v = -1
    for tid in TOPIC_PRIORITY:
        if tid == "general_boating_guidance":
            continue
        v = scores.get(tid, 0)
        if v > best_v:
            best_v = v
            best_id = tid
        elif v == best_v and v >= 0 and tid != best_id:
            if _priority_index(tid) < _priority_index(best_id):
                best_id = tid
    return best_id, best_v


def _sorted_topic_scores(scores: dict[str, int]) -> list[tuple[str, int]]:
    items = [(tid, scores.get(tid, 0)) for tid in TOPIC_PRIORITY if tid != "general_boating_guidance"]
    items.sort(key=lambda x: (-x[1], _priority_index(x[0])))
    return items


def _ts_scores(title: str, slug: str) -> dict[str, int]:
    """Title + slug only (+3 / +2) for alignment checks."""
    out: dict[str, int] = {tid: 0 for tid in TOPIC_PRIORITY if tid != "general_boating_guidance"}
    slug_norm = _norm(slug.replace("-", " "))
    title_n = _norm(title)
    for tid, keys in _TOPIC_KEYWORDS.items():
        if tid == "general_boating_guidance":
            continue
        if _keyword_hit(title_n, keys):
            out[tid] += 3
        if _keyword_hit(slug_norm, keys):
            out[tid] += 2
    return out


def _body_hit_counts(body: str) -> dict[str, int]:
    """Raw keyword hit counts per topic for misalignment detection."""
    low = body.lower()
    out: dict[str, int] = {}
    for tid, keys in _TOPIC_KEYWORDS.items():
        if tid == "general_boating_guidance":
            continue
        out[tid] = sum(1 for k in keys if k in low)
    return out


def _misaligned_intent(ts_s: dict[str, int], body_counts: dict[str, int]) -> bool:
    top_ts, ts_val = _best_topic_from_scores(ts_s)
    if ts_val <= 0:
        return False
    # Dominant body topic by raw hit count
    body_sorted = sorted(
        body_counts.items(),
        key=lambda x: (-x[1], _priority_index(x[0])),
    )
    top_body, bc_val = body_sorted[0]
    if bc_val < 2:
        return False
    if top_ts == top_body:
        return False
    return True


def _finalize_classification(
    *,
    title: str,
    slug: str,
    body: str,
    min_score: int,
    blend_ratio: float,
) -> tuple[str, str | None]:
    """
    Resolve primary topic (fallback to general_boating_guidance below confidence).
    Secondary qualifies for checklist + authority blending when score >= blend_ratio * top score.
    Secondary never replaces primary classification.
    """
    scores = _score_topics(title, slug, body)
    raw_primary, raw_val = _best_topic_from_scores(scores)
    sorted_s = _sorted_topic_scores(scores)
    secondary: str | None = None
    if raw_val > 0 and len(sorted_s) >= 2:
        cand_id, cand_val = sorted_s[1]
        if cand_val > 0 and cand_val >= blend_ratio * raw_val:
            secondary = cand_id

    ts_s = _ts_scores(title, slug)
    body_counts = _body_hit_counts(body)
    mis = _misaligned_intent(ts_s, body_counts)
    effective = raw_val - (3 if mis else 0)
    primary = raw_primary if effective >= min_score and raw_val > 0 else "general_boating_guidance"
    return primary, secondary


def _collect_authority_links(
    primary: str,
    secondary: str | None,
    max_links: int,
) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []

    def _take(topic: str) -> None:
        if len(out) >= max_links:
            return
        for label, url in _AUTHORITY_POOLS.get(topic, _AUTHORITY_POOLS["general_boating_guidance"]):
            if len(out) >= max_links:
                return
            if not markdown_trusted_authority_link_allowed(url):
                continue
            if url in seen:
                continue
            seen.add(url)
            out.append(f"[{label}]({url})")

    _take(primary)
    if secondary:
        _take(secondary)
    if len(out) < max_links:
        _take("general_boating_guidance")
    return out[:max_links]


def _too_thin_for_authority_links(body: str, min_words: int = 120) -> bool:
    return len(re.findall(r"\b[\w'-]+\b", body or "")) < min_words


def _is_low_information_fallback_body(body: str) -> bool:
    low = (body or "").lower()
    markers = (
        "key details are limited in the current source update",
        "use the available source details to plan conservatively before departure",
        "check for the latest source update before finalizing your plan",
    )
    if any(m in low for m in markers):
        return True
    # Weak-source fallback often repeats one phrase in multiple sections.
    lines = [re.sub(r"\s+", " ", ln.strip().lower()) for ln in (body or "").splitlines() if ln.strip()]
    if not lines:
        return True
    dup_ratio = 1.0 - (len(set(lines)) / max(1, len(lines)))
    return dup_ratio > 0.42


def _append_to_section(body: str, section_title: str, text: str) -> str:
    """Append text to an existing ##/### section once; no-op when section is missing."""
    if not (body and text):
        return body
    pat = re.compile(
        rf"(?mis)(^#{{2,3}}\s*{re.escape(section_title)}\s*$)(.*?)(?=^#{{2,3}}\s+|\Z)"
    )
    m = pat.search(body)
    if not m:
        return body
    block = m.group(2).rstrip()
    if text in block:
        return body
    replacement = f"{m.group(1)}\n\n{block}\n\n{text}\n"
    return body[: m.start()] + replacement + body[m.end() :]


def _rank_internal_paths(
    primary: str,
    secondary: str | None,
    *,
    title: str,
    slug: str,
    body: str,
) -> list[str]:
    blob = f"{title} {slug} {body}".lower()
    scored: list[tuple[int, str]] = []

    def register(topic: str, base_weight: int) -> None:
        for p in _INTERNAL_ROUTES_BY_TOPIC.get(topic, ("/booking",)):
            if not markdown_internal_link_allowed(p):
                continue
            w = base_weight
            pl = p.lower()
            if "daytona" in pl and "daytona" in blob:
                w += 3
            if "titusville" in pl and "titusville" in blob:
                w += 3
            if "launch" in pl and any(
                x in blob for x in ("launch", "rocket", "spacex", "canaveral")
            ):
                w += 2
            if "bio" in pl or "bioluminescent" in pl:
                if any(x in blob for x in ("bioluminescence", "bioluminescent", "night paddle")):
                    w += 2
            if "conditions" in pl and any(
                x in blob for x in ("forecast", "weather", "marine", "wind")
            ):
                w += 2
            scored.append((w, p))

    register(primary, 10)
    if secondary:
        register(secondary, 7)

    scored.sort(key=lambda x: (-x[0], x[1]))
    ordered: list[str] = []
    seen: set[str] = set()
    for _, path in scored:
        if path in seen:
            continue
        seen.add(path)
        ordered.append(path)
    return ordered


def _has_strong_local_signal(title: str, slug: str, body: str) -> bool:
    blob = f"{title}\n{slug}\n{body}"
    if _STRONG_LOCAL_RE.search(blob):
        return True
    if _LOCAL_SPACE_COAST.search(blob):
        return True
    return False


def _local_heading_and_blurb(
    body: str,
    used: set[str],
    heading_marker: str,
) -> str | None:
    locs = sorted({m.group(1).title() for m in _STRONG_LOCAL_RE.finditer(body)})
    loc_line = ", ".join(locs[:4]) if locs else "Daytona Beach and the Space Coast"
    details = _pick_sentence_excluding(
        body,
        ("daytona", "titusville", "lagoon", "coast", "port orange", "indian river"),
        used,
    )
    if not details:
        details = "Conditions can change quickly across local waterways, so check updates close to launch time."
    return (
        f"{heading_marker} Local Context: Daytona Beach & Space Coast\n\n"
        f"Local renters around {loc_line} should plan around current marine conditions and launch timing.\n\n"
        f"{details}"
    )


def _legacy_authority_link(blob: str) -> str:
    low = (blob or "").lower()
    candidates = [
        ("marine weather", "https://marine.weather.gov/"),
        ("forecast", "https://marine.weather.gov/"),
        ("coast guard", "https://www.uscgboating.org/"),
        ("regulation", "https://myfwc.com/"),
        ("safety", "https://www.noaa.gov/"),
    ]
    for needle, url in candidates:
        if needle in low and markdown_trusted_authority_link_allowed(url):
            return f"[{needle.title()}]({url})"
    return ""


def _legacy_internal_link(blob: str) -> str:
    low = (blob or "").lower()
    for path in ("/booking", "/boat-rentals/daytona", "/boat-rentals/titusville", "/captains-log"):
        if markdown_internal_link_allowed(path):
            if "daytona" in low and "daytona" in path:
                return path
            if "titusville" in low and "titusville" in path:
                return path
    return "/booking" if markdown_internal_link_allowed("/booking") else ""


def apply_final_article_enhancer(
    *,
    content: str,
    seo_title: str,
    slug: str = "",
    enable_checklist: bool = True,
    enable_local_context: bool = True,
    enable_qa: bool = True,
    enable_cta: bool = True,
    heading_level: str = "###",
    enable_dynamic_topics: bool = True,
    enable_internal_backlink_engine: bool = True,
    max_internal_links: int = 3,
    topic_min_score: int = 4,
    secondary_blend_ratio: float = 0.7,
) -> str:
    """
    Last-pass enhancer for publish consistency.
    Appends only missing sections; prefers sentences already present in content.
    """
    body = (content or "").strip()
    if not body:
        return body
    if _is_low_information_fallback_body(body):
        # Keep weak-source fallback concise; avoid piling on generic checklist/QA/CTA blocks.
        return body
    h = "##" if heading_level == "##" else "###"

    existing = {_norm(x) for x in _H3_RE.findall(body)}
    additions: list[str] = []
    used_sentences: set[str] = set()

    primary, secondary = _finalize_classification(
        title=seo_title,
        slug=slug,
        body=body,
        min_score=topic_min_score,
        blend_ratio=secondary_blend_ratio,
    )

    qa_keywords = ("weather", "marine", "wind", "advisory", "safety", "regulation", "forecast")
    authority_links: list[str] = []
    if not _too_thin_for_authority_links(body):
        authority_links = _collect_authority_links(primary, secondary, max_links=2)
        authority_links = [a for a in authority_links if a not in body]

    if enable_checklist and _norm("Practical Checklist Before You Leave the Dock") not in existing:
        bullets: list[str] = []
        if enable_dynamic_topics:
            chk = list(_CHECKLIST_PRIMARY.get(primary, _CHECKLIST_PRIMARY["general_boating_guidance"]))
            if secondary:
                chk = chk[:3]
                extra = (_CHECKLIST_SECONDARY_EXTRA.get(secondary) or ("",))[0].strip()
                if extra:
                    chk.append(extra)
            for line in chk:
                line = line.strip()
                if line:
                    bullets.append(f"- {line}")
        else:
            line = _pick_sentence_excluding(
                body, ("check", "before", "launch", "safety", "forecast"), used_sentences
            )
            bullets = [
                "- Re-check marine forecast and wind before departure.",
                "- Confirm life jackets, throwables, and navigation lights are ready.",
                "- Keep your route conservative if conditions change.",
            ]
            if line:
                bullets.append(f"- {line}")
        if authority_links:
            bullets.append(f"- Review {authority_links[0]} before you leave.")
        additions.append(
            f"{h} Practical Checklist Before You Leave the Dock\n\n"
            + "Use this quick prep list before your day on the water.\n\n"
            + "\n".join(bullets[:8])
        )

    if (
        enable_local_context
        and _norm("Local Context: Daytona Beach & Space Coast") not in existing
        and _has_strong_local_signal(seo_title, slug, body)
    ):
        loc_block = _local_heading_and_blurb(body, used_sentences, h)
        if loc_block:
            additions.append(loc_block)

    if enable_qa and _norm("Questions Readers Ask") not in existing:
        answer = _pick_sentence_excluding(body, qa_keywords, used_sentences) or _pick_sentence_excluding(
            body, ("water", "trip", "boat"), used_sentences
        )
        if answer:
            additions.append(
                f"{h} Questions Readers Ask\n\n"
                f"**Q:** What should I double-check before heading out?\n\n"
                f"**A:** {answer}"
            )

    if len(authority_links) > 1:
        body = _append_to_section(body, "Before You Go", f"Review {authority_links[1]} before you go.")

    if enable_cta and _norm("Book Your Experience") not in existing:
        cta_line = "Launch Zone Charters makes it easy to book your next day on the water."
        if enable_dynamic_topics and enable_internal_backlink_engine:
            paths = _rank_internal_paths(
                primary,
                secondary,
                title=seo_title,
                slug=slug,
                body=body,
            )
            cap = max(0, max_internal_links)
            pieces: list[str] = []
            labels = {
                "/booking": "Book now",
                "/launches": "Launch viewing resources",
                "/conditions": "Marine conditions",
                "/bioluminescent-tours": "Bioluminescence tours",
                "/faqs": "FAQs",
                "/pricing": "Pricing",
                "/captains-log": "Captain's Log",
                "/boat-rentals": "Boat rentals",
                "/boat-rentals/daytona": "Daytona rentals",
                "/boat-rentals/titusville": "Titusville rentals",
            }
            for p in paths[:cap]:
                label = labels.get(p, "Learn more")
                pieces.append(f"[{label}]({p})")
            if pieces:
                cta_line += " " + " · ".join(pieces) + "."
        else:
            internal = _legacy_internal_link(body)
            if internal:
                cta_line += f" Reserve your trip here: [Book now]({internal})."
        additions.append(f"{h} Book Your Experience\n\n{cta_line}")

    if not additions:
        return body
    return f"{body}\n\n" + "\n\n".join(additions).strip()
