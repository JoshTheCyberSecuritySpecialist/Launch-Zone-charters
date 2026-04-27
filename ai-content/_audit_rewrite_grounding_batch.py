"""
One-off audit: run rewrite_pipeline_article on representative fixtures.
Delete after review; not part of the production pipeline.
"""
from __future__ import annotations

import copy
import json
import re
import sys
from typing import Any

from config import OLLAMA_TEMPERATURE, OLLAMA_TOP_P, PIPELINE_SEO_HUB_MODE
from grounding import validate_rewritten_article
from rewrite import _pipeline_source_blob, rewrite_pipeline_article

# Representative sources (synthetic but realistic) — cover requested niches.
FIXTURES: list[dict[str, Any]] = [
    {
        "id": "rocket_viewing",
        "category": "Launch Updates",
        "keyword_topic": "rocket launches Titusville Florida",
        "title": "SpaceX eyes weekend Falcon 9 launch from Cape Canaveral",
        "summary": (
            "The 45th Weather Squadron issued a 60% go for a Friday night window. "
            "Kennedy Space Center says the two-hour window opens 9:12 p.m. Viewing is best from the "
            "Titusville riverfront; some public parking lots along U.S. 1 fill early. The company has not "
            "published a new T-0 in the last advisory."
        ),
        "content": (
            "The two-hour window on the Eastern Range begins at 9:12 p.m. Friday, per the published range "
            "clock. The 45th Weather Squadron's last update put the probability of go at 60% for the primary "
            "day, citing a low risk of thick cloud. If the attempt scrubs, a backup is not listed in the same "
            "advisory. For onlookers, the Titusville side of the Indian River is a common public line of "
            "sight; local law enforcement has in the past closed some small side streets when traffic backs up. "
            "This story will be updated if a new T-0 is released."
        ),
    },
    {
        "id": "marine_weather",
        "category": "Boating Tips",
        "keyword_topic": "boat rentals Port Orange Florida",
        "title": "NWS: small craft advisory for Volusia nearshore into the weekend",
        "summary": (
            "A small craft advisory is in effect for the nearshore Volusia waters with west winds 15 to 20 "
            "knots. Seas 3 to 5 feet. A higher end of the range is possible in squalls. The discussion said the "
            "advisory may be extended if the pressure gradient holds."
        ),
        "content": (
            "The National Weather Service office in Melbourne has a small craft advisory for the nearshore "
            "Volusia County waters. Westerly winds 15 to 20 knots and seas 3 to 5 feet are in the warning text. "
            "The forecast discussion states a shortwave may keep the pressure gradient tight, so the advisory "
            "could be extended. Mariners on the Halifax River and the Ponce Inlet approach should expect choppy "
            "confused seas. The product is not a replacement for a full trip plan; it is a single snapshot in a "
            "larger package of marine products."
        ),
    },
    {
        "id": "safety_pfd",
        "category": "Boating Tips",
        "keyword_topic": "boat rentals Port Orange Florida",
        "title": "USCG: children under 6 need PFDs on open motorboats in Florida",
        "summary": (
            "A state and federal combination rule: on boats under 26 feet, children under 6 must wear a U.S. "
            "Coast Guard-approved PFD when the vessel is underway, with some small craft exceptions. The USCG "
            "reminder was republished in a news note; it is not a new policy change."
        ),
        "content": (
            "The U.S. Coast Guard and state partners re-circulated a long-standing rule: for vessels under 26 "
            "feet, children under 6 years of age are to wear a Type I, II, or III PFD that is in good serviceable "
            "condition and the right size, when the boat is not at anchor, moored, or made fast to the shore, and "
            "is not in an enclosed cabin. The republished item is a safety reminder, not a new law. It also points "
            "to the need for a throwable PFD on many small outboard-driven craft, as required on the class of boat. "
            "The text does not name a specific brand of life jacket."
        ),
    },
    {
        "id": "renter_education",
        "category": "Boating Tips",
        "keyword_topic": "boat rentals Port Orange Florida",
        "title": "What to know before your first Pontoon rental in Daytona Beach",
        "summary": (
            "A local operator's page says new renters get a pre-rental walkthrough, a map of the no-wake "
            "zones on the Halifax River, and a cap on the number of passengers that cannot be exceeded. "
            "The company requires a boater-safety card for anyone born on or after 1988, in line with FWC rules."
        ),
        "content": (
            "The short fact sheet on the website is very specific: the pre-rental walkthrough includes an engine "
            "shutoff check, a head count, and a map of the no-wake areas of the Halifax River in the city zone. "
            "The same page says the maximum person count is on a plate in the console and is not negotiable. For "
            "anyone born on or after Jan. 1, 1988, the company says a Florida boater-safety card is required to "
            "operate, per the FWC table. The text does not list a price, a phone number, or a specific address. "
            "It also does not say what year the pontoons were manufactured."
        ),
    },
    {
        "id": "wildlife_lagoon",
        "category": "Water Adventures",
        "keyword_topic": "bioluminescence tours Florida lagoon",
        "title": "FWC biologists note seasonal manatee counts rising in Mosquito Lagoon",
        "summary": (
            "In a briefing summary, wildlife staff said aerial survey counts were higher than the prior January "
            "snapshot, but cautioned that tides and visibility affect totals. No new speed-zone changes were listed "
            "in the excerpt."
        ),
        "content": (
            "The excerpt from an FWC briefing repeats that Mosquito Lagoon is within the broader Indian River "
            "Lagoon system where manatees aggregate in cooler months. The aerial survey total for the sampling day "
            "was higher than the comparable window last year; the briefing stresses that tides, water clarity, and "
            "observer paths change year to year, so counts are not a population census. The materials attached to "
            "the briefing mention ongoing seagrass mapping but do not publish a map in the excerpt we received. "
            "No net change to seasonal slow-speed rules was announced in this excerpt."
        ),
    },
    {
        "id": "thin_source",
        "category": "Boating Tips",
        "keyword_topic": "boat rentals Port Orange Florida",
        "title": "Coast Guard suspends search off Canaveral",
        "summary": "Breaking: search suspended pending daylight; no further details.",
        "content": "",
    },
    {
        "id": "rocket_spacex_extra",
        "category": "Launch Updates",
        "keyword_topic": "rocket launches Titusville Florida",
        "title": "ULA sets Atlas V rollout for NET Tuesday",
        "summary": (
            "United Launch Alliance moved an Atlas first stage to the vertical integration facility on Monday. "
            "The net launch date is advertised as Tuesday morning pending range approval."
        ),
        "content": (
            "Photos published with the wire story show rollout at Cape Canaveral Space Force Station; the tower "
            "crew work is occurring during normal business shifts. Weather was not cited as a constraint in this "
            "specific photo caption. Nothing in this short caption addresses boat viewing locations."
        ),
    },
    {
        "id": "fishing_local",
        "category": "Local Highlights",
        "keyword_topic": "things to do in Daytona Beach",
        "title": "Snook season reopens on Atlantic coast portions this week",
        "summary": (
            "Florida Fish and Wildlife Conservation Commission reminders say the Atlantic snook recreational "
            "season opens Feb. 1 with the usual slot limits; harvest rules differ from Gulf seasons."
        ),
        "content": (
            "FWC landing rules for Atlantic waters include slot limits printed each year on the brochure; the "
            "article only states that Daytona Beach anglers should confirm the pamphlet bag and length tables "
            "because some boundaries follow inlets differently. Indian River Lagoon waters are explicitly mentioned "
            "as Atlantic region for season purposes in this article. Nothing in this clip lists a charter company."
        ),
    },
    {
        "id": "bio_glow_thin",
        "category": "Water Adventures",
        "keyword_topic": "bioluminescence tours Florida lagoon",
        "title": "Rare winter dinoflagellate bloom reported near Titusville",
        "summary": (
            "Researchers sampled greenish water late Thursday and noted elevated dinoflagellates consistent with "
            "bioluminescence-friendly species; no public health advisory text was attached."
        ),
        "content": "",
    },
    {
        "id": "weather_detailed",
        "category": "Boating Tips",
        "keyword_topic": "boat rentals Port Orange Florida",
        "title": "Rip current statement for Volusia beaches Sunday",
        "summary": (
            "The Weather Prediction Center flagged a moderate risk of rip currents for Volusia beaches Sunday "
            "afternoon as swell builds from a distant storm."
        ),
        "content": (
            "The beach hazards statement references Volusia County beaches from Ponce Inlet north through "
            "Flagler line in the text body. Surf heights in the story are given as 3 to 5 feet face values for "
            "open Atlantic spots. The article says lifeguard towers may fly red flags but tells readers to check "
            "the daily flag at their specific beach access. It does not mention boat ramps on the lagoon side."
        ),
    },
]


def _has_qna_section(body: str) -> bool:
    return bool(re.search(r"^###\s*Questions\s+Readers\s+Ask\b", body, re.I | re.M))


def main() -> None:
    print(
        json.dumps(
            {
                "audit_meta": {
                    "OLLAMA_TEMPERATURE": OLLAMA_TEMPERATURE,
                    "OLLAMA_TOP_P": OLLAMA_TOP_P,
                    "PIPELINE_SEO_HUB_MODE": PIPELINE_SEO_HUB_MODE,
                }
            },
            ensure_ascii=False,
        )
    )
    for spec in FIXTURES:
        art = {
            "title": spec["title"],
            "summary": spec["summary"],
            "content": spec.get("content") or "",
            "category": spec["category"],
            "keyword_topic": spec["keyword_topic"],
        }
        blob = _pipeline_source_blob(art)
        print("\n" + "=" * 80)
        print(json.dumps({"fixture_id": spec["id"], "source_title": spec["title"]}, ensure_ascii=False))
        try:
            out = rewrite_pipeline_article(copy.deepcopy(art))
        except Exception as e:
            print(json.dumps({"error": str(e), "fixture": spec["id"]}, ensure_ascii=False))
            continue
        if not out:
            print(json.dumps({"fixture": spec["id"], "result": "None"}, ensure_ascii=False))
            continue
        title = (out.get("title") or "").strip()
        body = (out.get("content") or "").strip()
        gm = out.get("_grounding_meta") or {}
        fb = gm.get("fallback") or False
        ok_q, reason_q, meta_direct = validate_rewritten_article(blob, title, body)
        record = {
            "fixture_id": spec["id"],
            "source_fact_summary": (spec["summary"] + " " + (spec.get("content") or ""))[:500].strip(),
            "rewritten_title": title,
            "rewritten_body_chars": len(body),
            "rewritten_body": body,
            "optional_qna_present": _has_qna_section(body),
            "grounding_from_article_meta": gm,
            "validate_rewritten_article_direct": {"ok": ok_q, "reason": reason_q, **meta_direct},
            "used_grounding_fallback": fb,
        }
        print(json.dumps(record, ensure_ascii=False))
    print("\nDONE")


if __name__ == "__main__":
    sys.exit(main() or 0)
