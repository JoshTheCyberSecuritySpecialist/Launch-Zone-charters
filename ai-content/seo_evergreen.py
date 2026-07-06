"""
Captain's Log long-form SEO: article-type templates, evergreen Space Coast sections,
validation gates, and prompt builders for the rewrite pipeline.
"""

from __future__ import annotations

import re
from typing import Any

# Semantic keywords woven naturally through articles (prompt + validation hints).
SEO_SEMANTIC_KEYWORDS: tuple[str, ...] = (
    "rocket launch Titusville",
    "Cape Canaveral launch",
    "Florida Space Coast",
    "rocket launch viewing",
    "boat launch viewing",
    "Indian River Lagoon",
    "Port Canaveral",
    "NASA launch",
    "Florida rocket launch",
    "launch viewing charter",
    "bioluminescence tours",
    "Titusville boat tours",
)

BANNED_FILLER_PHRASES: tuple[str, ...] = (
    "key details are limited",
    "use available source details",
    "plan conservatively",
    "use the available source details to plan conservatively",
    "check for the latest source update before finalizing your plan",
    "review the latest source update before departure",
    "source excerpt unavailable",
    "as an ai language model",
    "lorem ipsum",
)

TEMPLATE_LAUNCH = "launch"
TEMPLATE_BIO = "bioluminescence"
TEMPLATE_MARINE = "marine_conditions"
TEMPLATE_LOCAL = "local_highlights"

TEMPLATE_SECTIONS: dict[str, tuple[str, ...]] = {
    TEMPLATE_LAUNCH: (
        "Mission Overview",
        "Why This Launch Matters",
        "Launch Details",
        "Best Viewing Locations",
        "Why Watch From a Boat",
        "Marine Conditions",
        "Wildlife You May See",
        "Photography Tips",
        "Safety Tips",
        "Local Restaurants",
        "Nearby Attractions",
        "Frequently Asked Questions",
        "Final Thoughts",
    ),
    TEMPLATE_BIO: (
        "What Bioluminescence Looks Like Here",
        "Why Night Tours on the Lagoon Matter",
        "Best Times and Conditions",
        "Best Viewing From a Boat",
        "Marine Conditions at Night",
        "Wildlife You May See",
        "Photography Tips",
        "Safety Tips",
        "Local Restaurants",
        "Nearby Attractions",
        "Frequently Asked Questions",
        "Final Thoughts",
    ),
    TEMPLATE_MARINE: (
        "Conditions Overview",
        "Why This Matters for Boaters",
        "Forecast Details",
        "Where Conditions Hit Hardest",
        "Why Check Conditions From a Boat",
        "Marine Forecast Resources",
        "Wildlife and Seasonal Patterns",
        "Safety Tips",
        "Local Restaurants",
        "Nearby Attractions",
        "Frequently Asked Questions",
        "Final Thoughts",
    ),
    TEMPLATE_LOCAL: (
        "Area Overview",
        "Why Explore by Boat",
        "What to Know Before You Go",
        "Best Launch Points",
        "Why Rent Instead of Trailering",
        "Marine Conditions",
        "Wildlife You May See",
        "Photography Tips",
        "Safety Tips",
        "Local Restaurants",
        "Nearby Attractions",
        "Frequently Asked Questions",
        "Final Thoughts",
    ),
}

_H3_RE = re.compile(r"(?mi)^#{2,3}\s+(.+?)\s*$")

# Evergreen paragraphs per template/section (~100–140 words each). Event-specific facts stay in SOURCE FACTS.
_EVERGREEN: dict[str, dict[str, str]] = {
    TEMPLATE_LAUNCH: {
        "Mission Overview": (
            "Rocket launches from Cape Canaveral and Kennedy Space Center are among the most "
            "spectacular events on Florida's Space Coast. From the Indian River Lagoon near "
            "Titusville, you get an unobstructed horizon line and a front-row feel without "
            "fighting shoreline traffic. A launch viewing charter puts you on open water with "
            "room to move, stable footing for cameras, and a captain who knows where enforcement "
            "zones begin. Whether you are tracking a SpaceX Falcon or a ULA mission, the goal is "
            "the same: arrive early, read the marine forecast, and position safely before the "
            "countdown reaches its final minutes."
        ),
        "Why This Launch Matters": (
            "Every Cape Canaveral launch carries payload, science, or national-security significance "
            "that draws visitors from across Florida. For boaters, that means crowded ramps, "
            "restricted zones, and shifting schedules when weather scrubs a window. Watching from "
            "the water turns a headline into an experience—you feel the rumble through the hull "
            "and see the plume arc over the lagoon. Local captains who run rocket launch viewing "
            "trips near Titusville help guests avoid common mistakes: anchoring in the wrong lane, "
            "underestimating post-launch traffic, or missing the best light for photography."
        ),
        "Launch Details": (
            "Confirm the official launch window through NASA, Space Launch Delta 45, or the "
            "mission's operator before you leave the dock. Scrubbed attempts are common when "
            "upper-level winds or marine-layer visibility fail range criteria. Build slack into "
            "your evening—many guests plan a sunset cruise first, then hold position for the "
            "window. Keep fuel, water, and patience in reserve; holding on the Indian River "
            "Lagoon is comfortable when seas stay calm but tedious when chop picks up."
        ),
        "Best Viewing Locations": (
            "Titusville and the Mosquito Lagoon side of the Space Coast offer classic launch "
            "lines toward the pads. Many charter guests prefer mid-lagoon positions east of "
            "the Max Brewer Bridge corridor where sightlines open toward Cape Canaveral. "
            "Shore viewers crowd Jetty Park and Playalinda, but on the water you can adjust "
            "for haze and avoid the worst gridlock after liftoff. Ask your captain about "
            "current enforcement patterns—restricted waters move with each mission profile."
        ),
        "Why Watch From a Boat": (
            "Boat launch viewing beats standing in a parking lot for three practical reasons: "
            "mobility, comfort, and angle. You can shift a few hundred yards if fog hugs the "
            "shore, spread out for kids and cameras, and ride home while roads clog. A launch "
            "viewing charter also handles navigation lights, idle zones, and the unglamorous "
            "work of finding a legal hold point. For first-time rocket launch viewers on the "
            "Florida Space Coast, that local knowledge is worth the booking."
        ),
        "Marine Conditions": (
            "Marine weather drives go/no-go decisions more than excitement does. Check "
            "small-craft advisories, wind against current on the lagoon, and thunderstorm "
            "buildups that Florida summers throw at you with little warning. Night launches "
            "add visibility concerns—haze and lightning miles away can still scrub a window. "
            "Compare [Marine Conditions](/conditions) before you reserve and again at "
            "departure; captains will postpone when guest safety or visibility fails."
        ),
        "Wildlife You May See": (
            "The Indian River Lagoon is one of North America's most diverse estuaries. "
            "Dolphins often surf wake near channel markers, manatees graze in warm months, "
            "and pelicans work the bait schools at dusk. Night launches and bioluminescence "
            "season overlap with active wildlife—keep a respectful distance and idle speed "
            "in manatee zones. Guests sometimes spot bioluminescent streaks after a launch "
            "when dinoflagellates bloom; it is a bonus show few land-based viewers ever see."
        ),
        "Photography Tips": (
            "Bring a stable platform—a boat rail beats handheld if seas allow. Wide angle "
            "captures pad and plume; telephoto isolates staging shots before ignition. "
            "Disable flash; use manual focus and a remote or timer to avoid shake. "
            "Arrive before civil twilight for exposure tests. Salt air kills unprotected "
            "gear, so bag lenses until minutes before T-0. Practice shots during golden hour "
            "on the lagoon make the actual Florida rocket launch frame much easier to nail."
        ),
        "Safety Tips": (
            "Wear life jackets when underway, keep navigation lights compliant after dark, "
            "and never cross into posted exclusion zones. Assign a sober operator, brief "
            "guests on seated balance, and stow loose gear before acceleration. "
            "Thunderstorms can build in minutes—have a return plan that does not depend on "
            "a perfect launch. Carry extra water, sun protection, and a charged phone. "
            "If conditions deteriorate, the right call is to head in; there will always "
            "be another launch window on the Space Coast."
        ),
        "Local Restaurants": (
            "Plan food around your slip time—many Titusville and Cocoa Beach spots fill "
            "fast on launch nights. Waterfront casual dining along the Indian River lets "
            "you debrief with a view while traffic thins. If you are on a charter, confirm "
            "whether snacks are provided and whether alcohol policies apply underway. "
            "Early dinner before an evening window beats hungry waiting on anchor; "
            "post-launch bites are easier when you are not racing shore crowds from the boat."
        ),
        "Nearby Attractions": (
            "Pair launch day with a morning on the lagoon or a bioluminescence tour when "
            "seasonal blooms align. Kennedy Space Center Visitor Complex, Merritt Island "
            "National Wildlife Refuge drives, and Port Canaveral seafood stops round out "
            "a Space Coast weekend. Renters from out of state often stack a [rocket launch "
            "charter](/launches) with a daytime [Titusville boat rental](/boat-rentals/titusville) "
            "to see both shoreline and open-water perspectives."
        ),
        "Frequently Asked Questions": (
            "**Q:** What is the best place to watch today's rocket launch in Titusville?\n\n"
            "**A:** On the Indian River Lagoon east of downtown Titusville, from a boat with "
            "a captain who knows current hold zones—mobility beats a fixed shoreline spot "
            "when haze or crowds shift.\n\n"
            "**Q:** Can I watch a SpaceX launch from the water?\n\n"
            "**A:** Yes, when marine conditions and range restrictions allow. Book a launch "
            "viewing charter, verify the window with official sources, and plan for possible "
            "scrubs.\n\n"
            "**Q:** How early should we arrive?\n\n"
            "**A:** Most captains want guests aboard well before the published window—often "
            "two hours or more on peak missions—so positioning and safety briefings are done "
            "before countdown milestones."
        ),
        "Final Thoughts": (
            "A Cape Canaveral launch from the water is the way locals prefer to watch when "
            "conditions cooperate. Combine official schedule checks with a marine forecast, "
            "book through [Launch Zone Charters](/launches), and give yourself grace if the "
            "range scrubs—tomorrow's Florida Space Coast sunset on the lagoon is still worth "
            "the trip. See [Pricing](/pricing), [About Us](/about), and [Book Now](/booking) "
            "when you are ready to plan."
        ),
        "_top_up": (
            "Planning a rocket launch viewing trip on the Indian River Lagoon rewards patience "
            "and local knowledge. Holiday weekends and high-profile SpaceX missions compress "
            "ramp parking, inflate wait times at Titusville bridges, and push shoreline viewers "
            "into tight quarters hours before a window opens. Charter guests skip much of that "
            "friction: your captain monitors marine weather, knows where idle zones are tolerated "
            "versus enforced, and keeps the boat positioned for a clean horizon line toward "
            "Cape Canaveral. Pack layers—warm afternoons turn cool on the water after sunset—and "
            "bring binoculars even if you are shooting video; the human view still beats a phone "
            "screen for first-time launch emotion. If you are visiting from out of state, stack "
            "a daytime [boat rental](/boat-rentals/titusville) with an evening launch charter to "
            "see the Space Coast from two angles. Scrubs happen; treat them as part of the "
            "experience, not a ruined vacation. Official NASA and Space Launch Delta 45 updates "
            "remain the source of truth for go/no-go calls—use them alongside our [Marine "
            "Conditions](/conditions) page before every departure."
        ),
    },
    TEMPLATE_BIO: {
        "What Bioluminescence Looks Like Here": (
            "On dark nights when dinoflagellates bloom, every paddle stroke or wake ripple "
            "glows blue-green in the Indian River Lagoon and Mosquito Lagoon. Bioluminescence "
            "tours near Titusville feel otherworldly—fish leave comet trails and dolphins "
            "become shadows sparkled with light. Peak season varies with salinity, temperature, "
            "and recent rain, so flexible planning wins. For science, seasons, and responsible "
            "observation, see the [Florida bioluminescence guide](/bioluminescence). A guided "
            "night charter keeps you in known shallow lanes and away from busy channels while "
            "you experience one of Florida's most memorable water adventures."
        ),
        "Why Night Tours on the Lagoon Matter": (
            "Land-based visitors rarely see the full show; depth and distance kill the effect. "
            "From a boat or kayak launched with a local operator, you are in the biomass "
            "where strokes ignite water like embers. Captains time departures after astronomical "
            "twilight and route away from bridge glare. For couples and families, bioluminescence "
            "tours pair naturally with a daytime Space Coast boat day—two completely different "
            "faces of the same estuary."
        ),
        "Best Times and Conditions": (
            "New-moon weeks offer the darkest skies. Calm wind and minimal chop improve "
            "visibility; heavy rain upstream can dilute blooms. Summer months often produce "
            "stronger displays but also thunderstorms—flexible booking helps. The "
            "[Florida bioluminescence guide](/bioluminescence) covers moon phase, seasonality, "
            "and lagoon ethics in more detail. Check [Marine Conditions](/conditions) for wind "
            "and storm trends before a night run. Operators may reschedule when lightning or "
            "small-craft advisories threaten guest comfort and safety."
        ),
        "Best Viewing From a Boat": (
            "Slow speeds maximize glow—fast planing washes out the effect. Many guests "
            "dip hands or nets gently (where permitted) to swirl light pools. Anchoring in "
            "shallow grass flats can be spectacular when tides cooperate. A Titusville "
            "bioluminescence charter handles launch timing, lighting rules, and the mundane "
            "work of finding dark water away from shoreline sodium lights—"
            "[book a night tour](/bioluminescent-tours) when forecasts look calm."
        ),
        "Marine Conditions at Night": (
            "Night boating demands sharp situational awareness: navigation lights, chart "
            "plotters, and conservative routing. Insects near shore can annoy but open "
            "lagoon breezes help. Post-storm visibility sometimes spikes bloom intensity "
            "or shuts it down—local operators watch both. Never chase storms for photos; "
            "Florida squalls move fast on the lagoon."
        ),
        "Wildlife You May See": (
            "Expect dolphins, jumping mullet, and wading birds settling at dusk. Manatees "
            "require idle speed in posted zones even after dark. Bioluminescence does not "
            "harm wildlife, but bright white headlamps can disorient—use red lights on deck. "
            "The estuary is alive at night; quiet voices and steady hands keep encounters "
            "respectful."
        ),
        "Photography Tips": (
            "Bioluminescence photography needs long exposures, high ISO, and a tripod or "
            "braced body—phone shots rarely do justice. Focus manually on distant lights, "
            "experiment from 5–20 seconds, and accept some blur from moving water. "
            "Protect gear from salt spray; ziplock dry bags between shots extend camera life "
            "on night charters."
        ),
        "Safety Tips": (
            "Wear life jackets, bring bug spray, and dress for 10-degree cooler air over "
            "water. Brief guests on seated balance when others move about deck. Assign a "
            "lookout even at idle speeds—unlit crab pot floats and channel markers still "
            "matter. If lightning appears on the horizon, head in without debate."
        ),
        "Local Restaurants": (
            "Late tours finish hungry—know which Titusville and Cocoa Beach kitchens stay "
            "open after 9 p.m. on weekdays versus weekends. Quick waterfront bites beat "
            "long drives when kids are tired. Ask your operator about cooler policies if "
            "you want to pack sandwiches and celebrate on the ride home under stars."
        ),
        "Nearby Attractions": (
            "Stack a bioluminescence tour with Kennedy Space Center, a daytime kayak trail, "
            "or a rocket launch viewing charter when schedules align. Port Canaveral cruises "
            "and beach mornings round out a Florida Space Coast itinerary without extra "
            "highway time between hubs."
        ),
        "Frequently Asked Questions": (
            "**Q:** When is bioluminescence strongest near Titusville?\n\n"
            "**A:** Dark moonless nights in warm months, after calm days without heavy runoff—"
            "but blooms vary; operators monitor conditions daily. See the "
            "[Florida bioluminescence guide](/bioluminescence) for season, moon, and safety "
            "basics.\n\n"
            "**Q:** Is it safe for kids?\n\n"
            "**A:** With life jackets, calm weather, and a reputable charter, yes—choose "
            "trips matched to your group's comfort on the water at night.\n\n"
            "**Q:** Can I combine bio and launch viewing?\n\n"
            "**A:** Sometimes, on multi-day visits—read the "
            "[Florida bioluminescence guide](/bioluminescence) for timing basics, then ask "
            "about [bioluminescence tours](/bioluminescent-tours) and "
            "[launch charters](/launches) when planning."
        ),
        "Final Thoughts": (
            "Bioluminescence on the Indian River Lagoon is a bucket-list Florida experience "
            "best seen from the water. Book when forecasts look calm, stay flexible if "
            "operators reschedule, and explore [bioluminescence tours](/bioluminescent-tours), "
            "[Book Now](/booking), and [Pricing](/pricing) at Launch Zone Charters for your "
            "next night on the lagoon."
        ),
        "_top_up": (
            "Visitors often underestimate how dark the lagoon feels once you leave shoreline "
            "lights behind—that darkness is exactly what makes bioluminescence pop. Operators "
            "near Titusville route through shallows where blooms concentrate, but tides and "
            "recent rain still matter. A calm, warm evening after a sunny day often beats a "
            "windy week regardless of calendar hype. Dress for mosquitoes near mangrove edges, "
            "keep voices low, and let your eyes adjust before judging the show. Pair a night "
            "tour with daytime wildlife runs or a Kennedy Space Center visit to anchor the "
            "trip in more than one memory. When conditions align, bioluminescence tours rank "
            "alongside rocket launch viewing as the two experiences that define boating on "
            "Florida's Space Coast."
        ),
    },
    TEMPLATE_MARINE: {
        "Conditions Overview": (
            "Marine weather on the Space Coast blends Atlantic swell, inlet tidal rip, and "
            "afternoon seabreeze chop on the Indian River Lagoon. Small-craft advisories "
            "should end rental-day debates before you tow or book. Compare observed wind "
            "at the ramp with [Marine Conditions](/conditions) and NOAA marine forecasts "
            "for your specific zone—nearshore versus lagoon can differ by 10 knots and "
            "two feet of seas."
        ),
        "Why This Matters for Boaters": (
            "Pontoon renters, fishing skiffs, and charter guests all share the same risk: "
            "underestimating afternoon buildups. A calm 9 a.m. launch can become an uncomfortable "
            "3 p.m. beat back to Port Orange or Titusville ramps. Planning conservative "
            "routes, shorter loops, and hard turn-back times keeps weekends fun instead "
            "of stressful."
        ),
        "Forecast Details": (
            "Read wind direction against fetch length on open lagoon stretches. "
            "Thunderstorm cells may not appear in a morning forecast but still pop by lunch. "
            "Check updates at departure and mid-trip via marine radio or data apps. "
            "If official advisories upgrade, treat that as a binding go/no-go signal—not "
            "a suggestion."
        ),
        "Where Conditions Hit Hardest": (
            "Open water north of Titusville, Ponce Inlet approaches, and unprotected "
            "crossings toward Mosquito Lagoon see the worst chop during east winds. "
            "Canals and leeward shorelines offer relief for novice operators. "
            "Ask locals at the ramp where today's uncomfortable zones are—shoaling and "
            "wind fetch change seasonally after storms."
        ),
        "Why Check Conditions From a Boat": (
            "Shore forecasts miss micro-effects: channel funneling, bridge shadow, and "
            "shallow-water steepening. On the water you feel whether a rental day should "
            "shorten or relocate. Captains and experienced renters adjust plans hourly; "
            "that adaptability is harder when you committed to a fixed shoreline picnic spot."
        ),
        "Marine Forecast Resources": (
            "Use NOAA marine forecasts, National Weather Service zone products, and local "
            "operator briefings together. Official advisories trump social media hype. "
            "Bookmark trusted sources before your trip so you are not searching on a "
            "spotty signal at the dock."
        ),
        "Wildlife and Seasonal Patterns": (
            "Manatee zones, migratory birds, and seasonal bait runs shift where wildlife "
            "concentrates. Winter cold fronts bring clarity and wind; summer afternoons "
            "bring heat lightning. Wildlife activity does not pause for your rental window—"
            "plan routes that respect slow-speed postings and give dolphins wide berth."
        ),
        "Safety Tips": (
            "Life jackets for everyone, throwable PFDs on larger rentals, and working "
            "navigation lights if you will be out near dusk. File a float plan, carry "
            "water, and teach guests how to sit when wakes hit. When in doubt, return early—"
            "ramps get slick in rain and tempers fray when seas build."
        ),
        "Local Restaurants": (
            "Weather scrubbed your day? Nearby Daytona Beach and Port Orange waterfront "
            "spots still salvage the outing. On good days, pack coolers but know where "
            "to grab post-trip meals when everyone is sun-tired and happy."
        ),
        "Nearby Attractions": (
            "Combine a conditions-aware half-day with Kennedy Space Center, lagoon "
            "wildlife drives, or a calmer sunset hour when winds lay down. Flexibility "
            "turns a marginal forecast into a still-memorable Florida Space Coast visit."
        ),
        "Frequently Asked Questions": (
            "**Q:** Where do I check marine weather for Titusville boating?\n\n"
            "**A:** Start with [Marine Conditions](/conditions) and NOAA marine zone "
            "forecasts for the Indian River and nearshore Atlantic.\n\n"
            "**Q:** Should I cancel for 15 mph winds?\n\n"
            "**A:** Depends on vessel, experience, and wind direction against fetch—"
            "small craft advisories are the clearest cancel signal for most renters.\n\n"
            "**Q:** Do charters run in rough weather?\n\n"
            "**A:** Reputable operators postpone—guest safety and Coast Guard compliance "
            "come first."
        ),
        "Final Thoughts": (
            "Respecting marine forecasts is the mark of a smart Space Coast boater. "
            "Use official sources, keep plans flexible, and when conditions align, "
            "book through [Launch Zone Charters](/booking)—see [Pricing](/pricing) and "
            "[About Us](/about) for rental and charter options."
        ),
        "_top_up": (
            "Afternoon seabreeze is a daily rhythm along the Indian River Lagoon—flat mornings "
            "can mislead renters into long offshore loops that become uncomfortable by midafternoon. "
            "Build margin into your return time, especially with novice drivers on pontoon boats. "
            "Inlet mouths and open fetch zones amplify chop faster than sheltered canals behind "
            "Titusville or Port Orange. Thunderstorms may form inland and move toward the coast "
            "with little warning; if you hear thunder, treat it as a turn-back signal even when "
            "sun still shines at the ramp. Smart crews check [Marine Conditions](/conditions) twice: "
            "once at breakfast and again at the dock."
        ),
    },
    TEMPLATE_LOCAL: {
        "Area Overview": (
            "Florida's Space Coast stretches from Daytona Beach through Port Orange, "
            "Titusville, and the Cape Canaveral corridor—linked by the Indian River Lagoon "
            "and a culture built on boats, launches, and beach life. Renters come for "
            "pontoon afternoons, fishing mornings, and rocket nights without trailering "
            "across state lines. Knowing one region well beats rushing three in a day."
        ),
        "Why Explore by Boat": (
            "Highway tourism sees bridges and parking lots; the lagoon reveals dolphins, "
            "hidden sandbars, and launch silhouettes land visitors miss. A day rental "
            "from Titusville or Daytona puts you in the middle of what makes this coast "
            "different—water access to wildlife refuges, waterfront dining, and open horizon "
            "lines toward the pads."
        ),
        "What to Know Before You Go": (
            "Reserve early on holiday weekends and launch-adjacent dates. Bring sun gear, "
            "legal ID, and realistic expectations about afternoon weather. Brief your crew "
            "on life jackets and seated balance before throttling up. First-time renters "
            "should ask for orientation on local no-wake zones and shallow markers."
        ),
        "Best Launch Points": (
            "Titusville ramps serve launch viewers and lagoon cruisers; Port Orange and "
            "Daytona access Halifax River and inlet runs. Pick the ramp closest to your "
            "planned route to minimize idle time. Peak days mean early arrival—parking "
            "fills and lines form when SpaceX windows coincide with Saturday sunshine."
        ),
        "Why Rent Instead of Trailering": (
            "Visitors flying into Orlando or Sanford skip tow stress, maintenance, and "
            "storage fees. Local livery boats know the water, include safety kits, and "
            "often provide maps of shallow trouble spots. For one or two-day adventures, "
            "renting beats importing a trailer across I-95."
        ),
        "Marine Conditions": (
            "Check [Marine Conditions](/conditions) and ramp-side observations before "
            "casting off. Afternoon storms are routine June through September. Winter "
            "fronts bring north wind and chop but also excellent fishing clarity. "
            "Match your route to the forecast instead of forcing a bucket list crossing."
        ),
        "Wildlife You May See": (
            "Dolphins, manatees, ospreys, and seasonal bait boils entertain guests on "
            "even slow cruising days. Maintain distance, idle in posted zones, and never "
            "feed wildlife—FWC rules exist to protect animals and operators alike."
        ),
        "Photography Tips": (
            "Golden hour on the lagoon flatters phone cameras and DSLRs alike. "
            "Polarized lenses cut glare; dry bags protect gear from spray. "
            "Launch days need wider lenses; wildlife days benefit from telephoto "
            "from a stable, seated position."
        ),
        "Safety Tips": (
            "Sun, wind, and dehydration end more trips than mechanical issues. "
            "Assign a sober captain, stock water, and rehearse what to do if someone "
            "falls overboard. Keep a charged phone in a waterproof pouch and know "
            "local emergency channels."
        ),
        "Local Restaurants": (
            "Waterfront casual dining clusters in Titusville, Cocoa Beach, and Daytona "
            "shores—ideal for post-rental debriefs. Reservations help on launch weekends. "
            "If you boat to lunch, confirm docking guest policies ahead of time."
        ),
        "Nearby Attractions": (
            "Kennedy Space Center, bioluminescence tours, surf beaches, and Port Canaveral "
            "cruises fill multi-day itineraries. Stack experiences by geography to reduce "
            "drive time—lagoon days pair with Titusville; beach days with Daytona."
        ),
        "Frequently Asked Questions": (
            "**Q:** Do I need a license to rent a boat in Florida?\n\n"
            "**A:** Operators explain state requirements during booking—see [FAQs](/faqs) "
            "for orientation details.\n\n"
            "**Q:** Best area for first-time renters?\n\n"
            "**A:** Protected lagoon routes near Titusville or Port Orange beat open "
            "inlet runs for beginners.\n\n"
            "**Q:** How do I add rocket launch viewing?\n\n"
            "**A:** Browse [Rocket Launch Charters](/launches) and sync with official "
            "schedule updates."
        ),
        "Final Thoughts": (
            "The Space Coast rewards curious boaters who plan around weather and take "
            "time on the lagoon seriously. Explore [boat rentals](/boat-rentals), "
            "[Pricing](/pricing), and [Book Now](/booking) when you are ready—"
            "Launch Zone Charters lives here and runs these waters daily."
        ),
        "_top_up": (
            "Whether you are here for a weekend rental or a once-in-a-lifetime launch charter, "
            "the through-line is the same: respect the lagoon, read the weather, and give yourself "
            "time. Traffic on I-95 and A1A spikes during holidays and launch windows—on-water "
            "itineraries reduce stress when you plan routes that match your group's experience level. "
            "First-time captains should favor protected waters near Titusville or Port Orange before "
            "attempting inlet runs to the Atlantic. Locals stack experiences across seasons: winter "
            "clarity for fishing, summer bioluminescence, and year-round sunsets that make even a "
            "short pontoon loop feel like vacation."
        ),
    },
}


def detect_seo_template(
    *,
    category: str = "",
    keyword_topic: str = "",
    title: str = "",
    body: str = "",
) -> str:
    """Pick long-form outline from category + content signals."""
    blob = f"{category} {keyword_topic} {title} {body}".lower()
    if category == "Launch Updates" or any(
        x in blob for x in ("rocket launch", "spacex", "falcon", "starship", "ula launch", "nasa launch", "cape canaveral launch")
    ):
        return TEMPLATE_LAUNCH
    if category == "Water Adventures" or any(
        x in blob for x in ("bioluminescence", "bioluminescent", "night paddle", "glow water", "dinoflagellate")
    ):
        return TEMPLATE_BIO
    if any(
        x in blob
        for x in (
            "marine forecast",
            "marine weather",
            "small craft",
            "wind advisory",
            "hurricane",
            "sea state",
            "thunderstorm",
            "weather advisory",
        )
    ):
        return TEMPLATE_MARINE
    return TEMPLATE_LOCAL


def template_section_headings(template: str) -> tuple[str, ...]:
    return TEMPLATE_SECTIONS.get(template, TEMPLATE_SECTIONS[TEMPLATE_LOCAL])


def _norm_heading(h: str) -> str:
    return re.sub(r"\s+", " ", (h or "").strip().lower())


def existing_section_titles(content: str) -> set[str]:
    return {_norm_heading(m.group(1)) for m in _H3_RE.finditer(content or "")}


def word_count(text: str) -> int:
    return len(re.findall(r"\b[\w'-]+\b", text or ""))


def count_title_repetitions(content: str, title: str) -> int:
    """How many times the article title (or close variant) appears as a heading or standalone line."""
    t = re.sub(r"\s+", " ", (title or "").strip())
    if not t or len(t) < 12:
        return 0
    low_title = t.lower()
    count = 0
    for line in (content or "").splitlines():
        ln = line.strip()
        if not ln:
            continue
        if ln.lower().startswith("title:"):
            continue
        heading = re.sub(r"^#{1,6}\s*", "", ln).strip().lower()
        if heading == low_title or heading.startswith(low_title[: min(len(low_title), 48)]):
            count += 1
    return count


def contains_banned_filler(text: str) -> str | None:
    low = (text or "").lower()
    for phrase in BANNED_FILLER_PHRASES:
        if phrase in low:
            return phrase
    return None


def validate_seo_hub_structure(
    content: str,
    *,
    template: str,
    title: str = "",
    min_words: int = 1500,
    min_sections: int = 8,
) -> tuple[bool, str, dict[str, Any]]:
    """Post-formatter gate: length, section coverage, headline repetition, filler."""
    body = (content or "").strip()
    meta: dict[str, Any] = {
        "template": template,
        "word_count": word_count(body),
        "title_repetitions": count_title_repetitions(body, title),
    }
    if not body:
        return False, "empty_content", meta
    wc = meta["word_count"]
    if wc < min_words:
        return False, f"below_min_words:{wc}", meta
    filler = contains_banned_filler(body)
    if filler:
        return False, f"filler:{filler}", meta
    if meta["title_repetitions"] > 1:
        return False, "headline_repeated", meta
    required = template_section_headings(template)
    present = existing_section_titles(body)
    matched = sum(1 for s in required if _norm_heading(s) in present)
    meta["sections_matched"] = matched
    meta["sections_required"] = len(required)
    if matched < min_sections:
        return False, f"missing_sections:{matched}/{len(required)}", meta
    return True, "ok", meta


_TOP_UP_EXTRA: tuple[str, ...] = (
    "Charter guests often ask how early to arrive for a Cape Canaveral launch—the honest answer "
    "depends on mission profile, bridge traffic, and whether you want sunset photos before "
    "the window. Build buffer for weather holds and enjoy the lagoon instead of white-knuckling "
    "a schedule you cannot control.",
    "The Indian River Lagoon ecosystem is fragile; pack out trash, respect no-wake zones, and "
    "keep distance from manatees and nesting birds. Good stewardship keeps these waters open "
    "for launch viewing and bioluminescence tours season after season.",
    "If you are comparing shore viewing versus a launch viewing charter, consider who is in "
    "your group: kids, older guests, and photographers all benefit from stable deck space and "
    "a captain who handles navigation while you watch the sky.",
)


def append_missing_evergreen_sections(
    content: str,
    *,
    template: str,
    min_words: int = 1500,
) -> str:
    """Append template sections from evergreen library until structure and length targets are met."""
    body = (content or "").strip()
    present = existing_section_titles(body)
    sections = template_section_headings(template)
    additions: list[str] = []
    for heading in sections:
        if _norm_heading(heading) in present:
            continue
        para = (_EVERGREEN.get(template) or {}).get(heading, "").strip()
        if not para:
            continue
        additions.append(f"### {heading}\n\n{para}")
        present.add(_norm_heading(heading))

    out = body
    if additions:
        out = f"{body}\n\n" + "\n\n".join(additions).strip()

    # Supplement when template sections alone are under the SEO floor.
    top_up = (_EVERGREEN.get(template) or {}).get("_top_up", "").strip()
    if top_up and word_count(out) < min_words and _norm_heading("Space Coast Planning Notes") not in existing_section_titles(out):
        out = f"{out}\n\n### Space Coast Planning Notes\n\n{top_up}".strip()

    if word_count(out) < min_words:
        # Last resort: append any sections still missing (none expected) or extend Final Thoughts.
        for heading in sections:
            if _norm_heading(heading) in existing_section_titles(out):
                continue
            para = (_EVERGREEN.get(template) or {}).get(heading, "").strip()
            if para:
                out = f"{out}\n\n### {heading}\n\n{para}".strip()
            if word_count(out) >= min_words:
                break

    idx = 0
    guard = 0
    while word_count(out) < min_words and guard < 12:
        chunk = _TOP_UP_EXTRA[idx % len(_TOP_UP_EXTRA)]
        out = f"{out}\n\n{chunk}".strip()
        idx += 1
        guard += 1

    return out.strip()


BALANCED_GROUNDING_SEO_HUB = """
BALANCED GROUNDING (SEO hub — long-form Captain's Log):

EVENT-SPECIFIC FACTS (strict):
- Launch times, vehicle names, payload details, scrub/delay status, official quotes, statistics, prices, and named businesses: ONLY from SOURCE FACTS below.
- Do NOT invent schedules or mission outcomes.

EVERGREEN LOCAL EXPERTISE (allowed):
- You MAY author original guidance about Florida Space Coast boating: viewing areas, why watch from a boat, lagoon wildlife, photography, safety, general restaurant/attraction planning, and FAQs—as a local captain would.
- Use regions: Titusville, Cape Canaveral, Indian River Lagoon, Port Canaveral, Space Coast, Port Orange, Daytona Beach.
- Do NOT invent specific restaurant or marina names unless they appear in SOURCE FACTS.

VOICE:
- Sound like a captain who runs rocket launch and bioluminescence charters—not an AI summarizing wire copy.
- Never use filler such as "Key details are limited", "Use available source details", or "Plan conservatively".
- Never repeat the source headline more than once (TITLE line + one ## headline only).

SEMANTIC KEYWORDS (natural, not stuffed):
- Work in phrases like rocket launch Titusville, Cape Canaveral launch, Florida Space Coast, boat launch viewing, launch viewing charter, bioluminescence tours where relevant.
"""


def build_paraphrase_first_engine(*, allowed_paths: str, writer_conventions: str, min_words: int = 350) -> str:
    """Prompt engine: paraphrase full source first, boating context only after."""
    return f"""
PARAPHRASE-FIRST CAPTAIN'S LOG ENGINE

GROUNDING (mandatory — automated QC rejects violations):
- The NEWS portion must PARAPHRASE ONLY from SOURCE FACTS (especially BODY). Reorder and reword; do NOT add facts.
- Do NOT invent schedules, payloads, quotes, statistics, or named places not in SOURCE FACTS.
- Do NOT write from the headline alone when BODY provides more detail — use the full BODY.
- NEVER output: "Key details are limited", "Use available source details", "Plan conservatively",
  "Check for the latest source update", or similar placeholder filler.

VOICE:
- News sections: neutral editor paraphrasing the publisher story.
- Boating appendix: local captain tone for Launch Zone Charters (Titusville, Indian River Lagoon, Space Coast).

{writer_conventions}

STEP 1 — READ SOURCE FACTS completely before writing.

STEP 2 — TITLE (required)
First output line: TITLE: <SEO title with topic + Space Coast location when supported by source>

STEP 3 — ARTICLE STRUCTURE (mandatory order)
After TITLE:, the markdown body MUST use:

  1) `##` + one reader-facing headline (NOT identical to TITLE line; do not repeat it in other headings).

  2) NEWS PARAPHRASE (comes first — target **≥{max(min_words - 120, 180)} words**):
     - Paraphrase the publisher story from SOURCE FACTS in original wording.
     - Use `###` subheadings only when the source supports distinct topics (do not invent sections).
     - Short paragraphs; preserve who/what/when/where/why from the source.
     - Do NOT add Launch Zone marketing or boating advice in this portion.

  3) `### What This Means For Your Space Coast Boat Trip` (AFTER the news paraphrase):
     - Practical boating/charter context: timing, marine conditions, viewing from the water, lagoon routes.
     - General Space Coast expertise allowed; no new facts about the news event.

  4) `### Before You Go`
     - 3–5 bullet checklist (`- ` lines only).
     - Optional internal markdown links (paths only): {allowed_paths}

MINIMUM total length: **~{min_words} words** (news paraphrase must be the majority).

FORBIDDEN:
- Placeholder filler, headline repeated in every section, "Summary" sections, booking CTA blocks.
- Images, phone numbers, bare URLs in prose.
"""


def append_boating_context_section(content: str, *, template: str = "launch") -> str:
    """
    Append only the boating-context + Before You Go sections when the model omitted them.
    Does not replace or pad the news paraphrase.
    """
    body = (content or "").strip()
    if not body:
        return body
    present = existing_section_titles(body)
    additions: list[str] = []

    boating_heading = "What This Means For Your Space Coast Boat Trip"
    if _norm_heading(boating_heading) not in present:
        para = (_EVERGREEN.get(template) or _EVERGREEN.get(TEMPLATE_LAUNCH) or {}).get(
            "Why Watch From a Boat",
            "",
        ).strip()
        if not para:
            para = (
                "If you are planning time on the Indian River Lagoon near Titusville, factor marine "
                "weather and ramp traffic into your day. Watching from a boat can beat shore crowds "
                "when conditions allow — check [Marine Conditions](/conditions) before you go."
            )
        additions.append(f"### {boating_heading}\n\n{para}")

    if _norm_heading("Before You Go") not in present:
        additions.append(
            "### Before You Go\n\n"
            "- Check [Marine Conditions](/conditions) and small-craft advisories before departure.\n"
            "- Confirm life jackets and navigation lights for your planned hours.\n"
            "- See [Rocket Launch Charters](/launches), [Pricing](/pricing), and [Book Now](/booking)."
        )

    if not additions:
        return body
    return f"{body}\n\n" + "\n\n".join(additions).strip()


def build_seo_hub_step6(template: str, allowed_paths: str) -> str:
    """STEP 6 outline for the selected article template."""
    sections = template_section_headings(template)
    section_list = "\n".join(f"     ### {s}" for s in sections)
    return f"""
STEP 6 — LONG-FORM TEMPLATE STRUCTURE (mandatory — `{template}` outline)
After TITLE:, the markdown body MUST use:
  1) First body line: `##` + a reader-facing headline (NOT identical to TITLE line; not repeated elsewhere).
  2) Intro: **3–5 short paragraphs** under the ## headline — direct answer + local boating angle.
  3) Then these `###` headings **in this exact order** (each **at most once**):
{section_list}

SECTION LENGTH (mandatory — single Ollama response):
- Intro under ##: **200–350 words**.
- Each ### section: **100–180 words** (FAQ may use **Q:** / **A:** pairs).
- Whole markdown body (after TITLE:): **minimum 1,500 words**; target **1,600–2,000**; max **~2,400**.

INTERNAL LINKS (required — at least 3):
- Use markdown links to Launch Zone pages. Paths only: {allowed_paths}.
- Required targets when relevant: /launches (Rocket Launch Charters), /conditions (Marine Conditions), /pricing, /booking (Book Now), /about (About Us).

AUTHORITY LINKS:
- Do not paste bare URLs in prose; the final formatter adds NASA, NOAA, NWS, and Space Launch Delta 45 links.
- In Launch Details, reference checking official sources without inventing URLs.

DO NOT OUTPUT:
- "Summary", "Key takeaways", reading time, bylines, or "appeared first on…"
- Booking CTA blocks titled "Book Your Experience" — use Final Thoughts with subtle internal links instead.
"""


def build_seo_hub_engine(*, template: str, allowed_paths: str, writer_conventions: str) -> str:
    """Full SEO hub content engine prompt block."""
    step6 = build_seo_hub_step6(template, allowed_paths)
    keywords_line = ", ".join(SEO_SEMANTIC_KEYWORDS[:8])
    return f"""
SEARCH-INTENT BOAT-RENTAL CONTENT ENGINE — LONG-FORM SEO ARTICLE (Captain's Log)

{BALANCED_GROUNDING_SEO_HUB}

BUSINESS CONTEXT (voice only):
- Launch Zone Charters: rocket launch viewing, bioluminescence tours, boat rentals on the Space Coast.
- Help readers plan, stay safe, and understand why on-water viewing beats shore crowds.

{writer_conventions}

ARTICLE TYPE: {template}

STEP 1 — DETECT INTENT from HEADLINE + SUMMARY (+ BODY): launch, bioluminescence, marine weather, or local boating.

STEP 2 — BOAT-RENTAL RELEVANCE: Why does this matter to someone renting or chartering on the Space Coast today?

STEP 3 — SEARCH-BASED TITLE (required)
First output line: TITLE: <title>
- Topic + Florida Space Coast location + renter intent (what to know, best place to watch, guide, etc.).
- No internal labels ("SEO hub", "pipeline", etc.).
- Optimize for long-tail searches like "best place to watch rocket launch Titusville" or "boat tour Cape Canaveral launch".

STEP 4 — DIRECT ANSWER: Opening ## section answers the search intent immediately, then expands with local expertise.

STEP 5 — LOCAL FOCUS: Name Titusville, Indian River Lagoon, Cape Canaveral, or Space Coast naturally.

{step6}

KEYWORDS (weave naturally): {keywords_line}, and related Florida boating terms.

OUTPUT: First line TITLE: ..., blank line, then markdown per STEP 6. No images in body.
"""
