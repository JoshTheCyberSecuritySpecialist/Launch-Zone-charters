export type BioGuideRelatedLink = {
  label: string;
  path: string;
};

export type BioGuideSubsection = {
  id: string;
  title: string;
  paragraphs: string[];
  relatedLinks?: BioGuideRelatedLink[];
};

export type BioGuideSection = {
  id: string;
  title: string;
  paragraphs: string[];
  subsections?: BioGuideSubsection[];
  relatedLinks?: BioGuideRelatedLink[];
};

export const BIO_GUIDE_SECTIONS: BioGuideSection[] = [
  {
    id: 'what-is-bioluminescence',
    title: 'What Is Bioluminescence?',
    paragraphs: [
      'Bioluminescence is light produced by a living organism through a chemical reaction inside its cells. On Florida’s east coast lagoons, that light usually appears as a cool blue-green flash when water is stirred — a paddle stroke, a fish darting away, or ripples against a hull.',
      'Unlike sunlight reflecting off the surface, bioluminescence comes from within the water column. The effect is often subtle on cloudy or moonlit nights and more dramatic when the sky is dark, the water is calm, and concentrations of light-producing organisms are high.',
      'Florida’s lagoon systems — especially the Indian River Lagoon and Mosquito Lagoon — are among the better-known places in the state to see this phenomenon. It is seasonal and weather-dependent. A great photo from last summer does not guarantee the same show tonight.',
      'Bioluminescence is not the same as phosphorescence or chemiluminescence in a lab beaker. It is a biological process tuned to survival — startling predators, attracting mates, or communicating stress. That is why the glow responds to motion and why it can disappear when conditions change overnight.',
    ],
  },
  {
    id: 'why-florida-water-glows-blue',
    title: 'Why Does Florida Water Glow Blue?',
    paragraphs: [
      'The color you see is tied to the chemistry of the organism doing the glowing. Dinoflagellates — microscopic algae-like plankton common in lagoon water — typically produce blue-green light through a reaction involving luciferin and the enzyme luciferase.',
      'Comb jellies, which are gelatinous animals rather than jellyfish, can also contribute a soft pulsing glow along their edges. Their light may read as blue, green, or even pink depending on species and how your eyes adapt in the dark.',
      'Lagoon water on the Space Coast tends to be sheltered compared with the open Atlantic. That shelter helps plankton accumulate, and reduced light pollution away from bridge glare and shoreline strip lighting makes the glow easier to notice. Warm summer water temperatures often support higher activity, but bloom strength still varies week to week.',
      'Human eyes are more sensitive to blue-green wavelengths at night, which is why photographs sometimes look greener or bluer than you remember. Long exposures also stack many brief flashes into one bright frame — real-time viewing is usually softer.',
    ],
  },
  {
    id: 'organisms-cause-glow',
    title: 'What Organisms Cause the Glow?',
    paragraphs: [
      'Two groups dominate most Florida night-tour conversations: bioluminescent dinoflagellates and comb jellies (ctenophores). Both occur naturally; neither is a sign of pollution by itself.',
      'Dinoflagellates flash when physically disturbed — a defense mechanism that may startle predators or attract secondary predators to the attacker. Comb jellies produce light along rows of specialized cells and can appear as drifting, faintly glowing shapes in the water.',
      'Other marine life — certain fish, shrimp, and worms — can bioluminesce in deeper offshore water, but the classic “sparkling trail behind every paddle stroke” experience on the Indian River and Mosquito Lagoon is usually dinoflagellate-driven, sometimes with comb jellies visible as slow-moving glowing forms.',
      'Species composition shifts with season, salinity, temperature, and recent rainfall. Identifying organisms by eye is not necessary for a great night on the water, but understanding the cast of characters helps set realistic expectations.',
    ],
  },
  {
    id: 'dinoflagellates-comb-jellies',
    title: 'Dinoflagellates and Comb Jellies',
    paragraphs: [
      'Dinoflagellates are single-celled organisms. You will not see an individual cell without a microscope, but when millions are present, the water responds to movement with a burst of light. Peak activity on the Space Coast is generally associated with warmer months, though local conditions always matter more than a calendar date alone.',
      'Comb jellies are transparent, oval-shaped animals that move by rows of tiny cilia — the “combs” that scatter light. They do not sting like sea nettles. Paddlers sometimes scoop one gently and watch it pulse in a cupped hand before releasing it.',
      'On the same night you may see both effects: sharp sparkles from dinoflagellates when you disturb the surface, and softer glowing shapes drifting below. That combination is part of what makes a lagoon night memorable — and why a captain-led tour or a stable platform on open water helps you focus on the water instead of navigation in the dark.',
    ],
    subsections: [
      {
        id: 'florida-dinoflagellates',
        title: 'Florida Dinoflagellates',
        paragraphs: [
          'Florida lagoon dinoflagellates are microscopic, single-celled protists — not true algae, though they share some traits with plants. Many species photosynthesize; others consume prey. When cell densities rise in warm, stratified water, a modest wake can trigger thousands of simultaneous flashes.',
          'On the Space Coast, the “spark trail” effect visitors love is typically linked to bioluminescent dinoflagellate blooms in the Indian River and Mosquito Lagoon systems. Bloom strength is patchy: one basin may glow brightly while a mile away looks ordinary.',
          'Dinoflagellates respond to shear stress. That is why a slow paddle stroke often produces a cleaner light trail than a fast motor wash, which can churn the surface without giving your eyes time to register individual flashes.',
          'Cell division can accelerate after calm, warm periods with adequate nutrients. That is why two consecutive nights with similar weather can look different — populations change faster than most guests expect.',
          'Dinoflagellates also migrate vertically in the water column over a 24-hour cycle. Night tours benefit when surface concentrations are high; a midday look at ordinary water says little about after-dark potential.',
          'Not every dinoflagellate bloom is harmless. Some species elsewhere are associated with toxins and fish kills. If water looks rusty, smells strongly abnormal, or official advisories are posted, treat that as a water-quality issue first — not a bioluminescence bucket-list night.',
        ],
      },
      {
        id: 'comb-jellies-detail',
        title: 'Comb Jellies on the Space Coast',
        paragraphs: [
          'Comb jellies (ctenophores) are gelatinous animals — predators and filter feeders that drift with tidal currents. Their eight rows of cilia (“combs”) refract and scatter light, producing a slow rainbow or pulsing glow along the body margin.',
          'Unlike stinging jellyfish, comb jellies use sticky cells called colloblasts to capture prey. They are fragile: rough handling can tear the body. Brief, gentle observation in a wet hand or clear cup, then immediate release, is the respectful approach.',
          'Some nights comb jellies are the main luminous show when dinoflagellate flashes are sparse. Their slow drift reads like embers underwater — a different aesthetic from sharp paddle sparkles, but equally memorable on a dark lagoon.',
          'Comb jellies can appear when dinoflagellate flashes are faint, giving guests something luminous to watch even on mixed nights. They are part of the lagoon food web — not props for transport home.',
        ],
      },
    ],
  },
  {
    id: 'lagoon-plankton-species',
    title: 'Other Lagoon Light Producers',
    paragraphs: [
      'Visitors and field guides sometimes name specific plankton genera when discussing Florida night glow. You will not identify these reliably without microscopy, but knowing the names helps you read marine reports and ask better questions.',
      'Noctiluca, Pyrodinium, and Pyrocystis are dinoflagellate genera discussed in Gulf and Atlantic coastal science. Their presence, abundance, and risk profile vary by location and season. A glowing lagoon is not automatically a harmful bloom — context matters.',
      'Tour guides and captains speak in plain language; researchers speak in species names. Both can be right — the visitor experience is about conditions and ethics on the water, while lab IDs happen later in sample analysis.',
    ],
    subsections: [
      {
        id: 'noctiluca',
        title: 'Noctiluca',
        paragraphs: [
          'Noctiluca scintillans is a bioluminescent dinoflagellate sometimes called “sea sparkle.” It can produce dramatic surface glow when abundant. In some regions it is associated with red-tinted water when blooms are dense.',
          'Reports of Noctiluca along Florida’s Atlantic coast appear in scientific literature and regional monitoring discussions. It is not the only organism responsible for Space Coast glow nights, but it illustrates how a single genus can dominate headlines when conditions align.',
          'Noctiluca can feed on other plankton and sometimes change how food webs respond during blooms. That complexity sits in the background of tourism — you experience the visual result without needing to ID species on a phone screen.',
          'If you encounter strongly discolored water, foam, or dead fish, prioritize official Florida Fish and Wildlife Conservation Commission and health department guidance over curiosity sampling.',
        ],
      },
      {
        id: 'pyrodinium',
        title: 'Pyrodinium',
        paragraphs: [
          'Pyrodinium is a dinoflagellate genus known in subtropical waters for bioluminescence and, in some species and regions, toxin production under bloom conditions. Florida monitoring networks track harmful algal bloom indicators separately from recreational glow tourism.',
          'Historical bloom events in various parts of the world made Pyrodinium a textbook example of why coastal communities watch dinoflagellates closely. Florida’s monitoring approach treats public health and tourism as parallel tracks — glowing water is not a stand-in for an all-clear on water contact.',
          'Pyrodinium highlights an important distinction: bioluminescence is beautiful and natural, but not every luminous plankton event is safe for unrestricted contact. Heed posted advisories, especially after heavy runoff or unusual water color.',
          'For planning purposes, treat Pyrodinium as a reminder to check water-quality bulletins — not as a reason to avoid the lagoon entirely on clear, advisory-free nights.',
        ],
      },
      {
        id: 'pyrocystis',
        title: 'Pyrocystis',
        paragraphs: [
          'Pyrocystis is a marine dinoflagellate genus often used in laboratory bioluminescence demonstrations because its flash response is reliable. In wild lagoon water, related species may contribute to the disturbance-triggered sparkle visitors see from boats and paddles.',
          'Pyrocystis flashes are brief — often described as a quick blue spark when a cell is agitated. At natural densities you experience the aggregate effect across countless cells, not individual sparks.',
          'Researchers study Pyrocystis to understand circadian rhythms and light production chemistry. That science underpins what you see recreationally: a biological clock tied to darkness and motion.',
          'Seeing Pyrocystis-level brilliance in a classroom jar is not the same as an open-lagoon night. Wild populations vary; enjoy the scale of the estuary rather than expecting aquarium intensity every trip.',
        ],
      },
    ],
  },
  {
    id: 'why-flashes-when-disturbed',
    title: 'Why It Flashes When Disturbed',
    paragraphs: [
      'For dinoflagellates, bioluminescence is a response to shear stress and motion. When a cell is jostled, internal chemistry converts stored energy into a brief photon burst — often lasting a fraction of a second.',
      'That is why kayaks, paddles, and even fish leave glowing trails. It is also why heavy wind and chop can spread organisms thin or make the surface too rough to see fine detail. Calm nights after afternoon storms sometimes offer good visibility once the sky clears, but only if organism concentrations remain high.',
      'Comb jellies behave differently: many species glow continuously or pulse along their combs without needing the same sharp disturbance. Understanding the difference helps set expectations — not every glow will look like a photograph with long exposure.',
      'Predators may learn to associate flashes with prey movement. From a viewer’s perspective, that ecological arms race is what turns an ordinary wake into a line of light across the lagoon.',
    ],
  },
  {
    id: 'is-bioluminescence-safe',
    title: 'Is Bioluminescence Safe?',
    paragraphs: [
      'For most healthy visitors, observing natural lagoon bioluminescence from a boat, kayak, or shoreline is considered low risk when standard boating safety rules apply. The organisms themselves are not treated like a recreational “touch tank” attraction — avoid ingesting lagoon water and rinse skin and gear after your trip.',
      'Some dinoflagellate species elsewhere in the world are associated with harmful algal blooms and toxins. On the Space Coast, operators and local agencies monitor water quality; if an official health advisory is posted for an area, treat it seriously and choose another night or location.',
      'Night boating adds real hazards: reduced visibility, other vessels, channel markers, and weather that can change quickly. Wear a life jacket, bring a light for safety (while keeping glare off the water when possible), and check marine forecasts before you go. A calm, dark sky helps the glow — it does not make the lagoon less serious as a navigational environment.',
    ],
  },
  {
    id: 'collect-bioluminescent-water',
    title: 'Can You Collect Bioluminescent Water?',
    paragraphs: [
      'Curiosity is natural — many first-time visitors want to scoop a jar of glowing water. If you do, keep the amount small, use a clean container, observe briefly, and return the water to the same waterway. Do not transport lagoon water home, do not dump it into another system, and do not attempt to “keep” living organisms as pets.',
      'Organisms begin to die quickly without proper temperature, oxygen, and salinity. What looked brilliant on the water often fades within minutes in a jar. That is normal and a reminder that the experience belongs on the lagoon, not on a shelf.',
      'If you are on a guided tour, follow your captain’s guidance. Some areas have additional protections; leaving no trace applies on the water as much as on land.',
    ],
    subsections: [
      {
        id: 'safe-brief-observation',
        title: 'Safe, Brief Observation',
        paragraphs: [
          'A respectful sample is small — a cup or jar filled once, not repeated scooping from the same patch. Observe for a minute or two, avoid splashing near wildlife, and keep the container shaded from bright deck lights.',
          'Never drink lagoon water or encourage children to submerge faces in sample jars. Rinse hands after contact, especially before eating.',
          'Brief observation satisfies curiosity without meaningfully depleting a bloom. The goal is a memory, not a collection.',
          'If children are sampling, supervise closely, pour gently, and make returning the water a ritual — that habit protects the lagoon long after your trip ends.',
        ],
      },
      {
        id: 'return-water-same-lagoon',
        title: 'Why Return Water to the Same Lagoon',
        paragraphs: [
          'Lagoon organisms are adapted to local salinity, temperature, and microbial communities. Moving water even a few miles to a different inlet can introduce stress or unintended species transfer.',
          'Even a cup of water can contain dozens of species invisible to the naked eye. Releasing it elsewhere is a miniature invasive-species gamble — one casual jar at a time adds up when thousands of visitors repeat the habit.',
          'Releasing sample water back where it was collected minimizes ecological disruption and follows the same logic as catch-and-release fishing: leave the system as you found it.',
          'Dumping bioluminescent water into a backyard pond, pool, or storm drain is never appropriate. It kills the organisms and may violate local discharge rules.',
        ],
      },
    ],
  },
  {
    id: 'responsible-observation-ethics',
    title: 'Responsible Observation Ethics',
    paragraphs: [
      'Treat bioluminescence as a wildlife experience, not a guaranteed product. Avoid excessive splashing for social media when it stresses wildlife or other guests. Keep voices low at night — sound carries across flat water.',
      'Minimize artificial light: headlamps and phone screens destroy night vision and can ruin the experience for others. Red-filter lights or downward-facing dim lights are better when you need visibility for safety.',
      'Do not anchor or drive through seagrass beds. Stay in marked channels where required, respect slow-speed zones, and give wildlife space. Manatees, dolphins, and resting birds use the same lagoons you visit after dark. Ethical observation protects both the ecosystem and the conditions that make future glow nights possible.',
      'Share what you saw; do not share GPS pins to fragile flats or manatee rest areas. Crowding sensitive shorelines can damage habitat faster than a single night of paddling.',
    ],
  },
  {
    id: 'best-time-florida',
    title: 'Best Time To See Bioluminescence in Florida',
    paragraphs: [
      'On the Space Coast, strong dinoflagellate displays are most often reported during warmer months — roughly late spring through early fall — when lagoon water temperatures support higher activity. Comb jellies can appear across a broader season, but intensity still varies.',
      'Weather and wind are equally important. Clear skies, light winds, and manageable cloud cover generally beat a perfectly dark night with whitecaps. Check a live conditions snapshot before you drive to the ramp — our widget below uses the same server-side model as our tour operations page.',
      'Timing within the night: many guests prefer the first hours after true darkness, often between about 9:00 PM and midnight local time, but legal boating hours, tides, and launch-site access vary. There is no universal “best hour” — only the best fit for tonight’s forecast and your crew’s experience level.',
    ],
    subsections: [
      {
        id: 'moon-phase-strategy',
        title: 'Moon Phase Viewing Strategy',
        paragraphs: [
          'Astronomical darkness is your ally. Around the new moon — plus several nights before and after — the sky stays darker longer, so faint water glow competes less with moonlight.',
          'Quarter-moon nights can still work if the moon is low on the horizon during your trip window or blocked by mangrove canopy along narrow creeks. Open lagoon basins near Titusville are more moon-sensitive than tree-lined side channels.',
          'Full-moon weeks are not automatic cancellations. Plan later starts when the moon sets, choose sheltered routes away from bridge glare, and temper expectations — the same biomass may look far less dramatic under bright sky glow.',
          'Bridge lights and marina sodium vapor lamps act like a local “full moon” along some shorelines. Operators with local knowledge route toward darker water — another reason night charters differ from daytime rentals.',
          'Bring 10–15 minutes for your eyes to adapt. Avoid checking bright phone screens on deck; use a red filter or dim mode if you must navigate an app.',
          'Use a simple moon calendar alongside our live widget: dark sky plus calm wind plus in-season water temperature beats any single factor alone.',
        ],
      },
      {
        id: 'wind-and-water-clarity',
        title: 'Wind and Water Clarity',
        paragraphs: [
          'Wind drives chop. Chop mixes surface layers, adds noise to your visual field, and makes paddles and passengers work harder — all of which reduce the magic per stroke.',
          'Many experienced operators prefer sustained winds under about 10–15 mph for guest comfort and glow viewing. That is a guideline, not a law of physics: local funneling between islands can amplify breeze even when airport readings look mild.',
          'Afternoon seabreeze patterns on the Space Coast can calm after sunset — or accelerate if a front approaches. Check both evening forecast and the trend arrow, not a single daytime snapshot.',
          'Water clarity matters differently than offshore diving. Lagoon bioluminescence is about organisms at the surface and in the upper water column. Heavy runoff after storms can change salinity and clarity overnight — sometimes suppressing blooms, occasionally redistributing them.',
          'Tea-colored tannin water from natural coastal vegetation is not the same as sediment pollution. Do not confuse dark but healthy lagoon color with muddy discharge after construction or erosion events.',
          'If you see floating debris, fuel sheens, or unusual foam lines after heavy rain, treat that as a sign to verify water-quality bulletins before planning contact recreation.',
        ],
      },
      {
        id: 'when-clouds-help',
        title: 'Why Clouds Can Sometimes Help',
        paragraphs: [
          'Clouds are usually framed as enemies of stargazing — and bright overcast can flatten contrast. But thin, broken cloud layers can block moonlight while leaving the horizon dark, effectively dimming sky glow without fully illuminating the water.',
          'A passing high cloud deck during a near-full-moon week may improve perceived bioluminescence compared with a clear, bright moonlit sky. Conversely, low thick clouds often bring wind shifts, rain, or canceled trips.',
          'Fog and marine layer haze behave differently from rain clouds: they diffuse light and can obscure stars while still allowing strong flashes at the surface when organisms are dense.',
          'Treat clouds as part of a system: check both cloud cover percentage and moon illumination. Our conditions widget includes cloud data for that reason — not to replace your eyes on the ramp, but to frame tonight’s odds.',
        ],
      },
    ],
  },
  {
    id: 'month-by-month-calendar',
    title: 'Month-by-Month Florida Bioluminescence Calendar',
    paragraphs: [
      'Calendar months are trends, not guarantees. Water temperature, moon phase, wind, and recent rainfall matter more than the date on your ticket. Use this guide to frame expectations — then check the live widget before you drive to the ramp.',
      'Peak dinoflagellate seasons on the Space Coast most often cluster in warmer months, while comb jellies and other luminous plankton can appear across a wider window. Combine this calendar with our weekly outlook when you are planning multi-day trips.',
    ],
    relatedLinks: [
      { label: 'Check tonight’s conditions', path: '/bioluminescence#tonights-conditions' },
      { label: 'Marine conditions', path: '/conditions' },
    ],
    subsections: [
      {
        id: 'calendar-january',
        title: 'January',
        paragraphs: [
          'Cooler lagoon water often suppresses classic dinoflagellate sparkle, though comb jellies may still appear on calm nights. Focus on forecasts and moon phase rather than peak-season hype.',
        ],
      },
      {
        id: 'calendar-february',
        title: 'February',
        paragraphs: [
          'Similar to January — mixed potential. Warm spells can briefly improve conditions; cold fronts bring wind that ends comfortable viewing. A flexible schedule helps.',
        ],
      },
      {
        id: 'calendar-march',
        title: 'March',
        paragraphs: [
          'Transition month: water begins warming and daylight lengthens. Occasional strong nights appear after calm, warm afternoons — verify with live data, not historical social posts alone.',
        ],
      },
      {
        id: 'calendar-april',
        title: 'April',
        paragraphs: [
          'Increasingly viable as temperatures rise. Spring break traffic affects ramps and parking near popular access points — plan extra time if you are self-launching.',
        ],
      },
      {
        id: 'calendar-may',
        title: 'May',
        paragraphs: [
          'Often cited as the opening of reliable warm-water season for dinoflagellates on the Space Coast. New-moon weeks in calm weather are prime planning windows.',
        ],
      },
      {
        id: 'calendar-june',
        title: 'June',
        paragraphs: [
          'Strong month for warm water and long evenings. Afternoon thunderstorms are common — evening trips depend on clearing skies and lightning staying away.',
          'School-year schedules loosen, so weekday launches can be quieter than summer weekends. Check both recreation forecasts and our live rating before you commit.',
        ],
      },
      {
        id: 'calendar-july',
        title: 'July',
        paragraphs: [
          'Peak tourism month with high biological potential when rain and wind cooperate. Book early for holiday weekends; conditions still vary night to night.',
          'Heat index affects crew comfort more than plankton chemistry — hydrate, shade younger guests before boarding, and treat afternoon storm warnings seriously.',
        ],
      },
      {
        id: 'calendar-august',
        title: 'August',
        paragraphs: [
          'Warm water continues to support blooms. Watch tropical weather systems that can cancel trips for safety even when water would otherwise glow.',
          'Late-August new-moon windows are popular planning targets; pair them with a flexible backup date when possible.',
        ],
      },
      {
        id: 'calendar-september',
        title: 'September',
        paragraphs: [
          'Still warm; hurricane-season vigilance matters more than any plankton cycle. Some of the best dark-sky nights follow stable post-front conditions.',
        ],
      },
      {
        id: 'calendar-october',
        title: 'October',
        paragraphs: [
          'Cooling begins but many seasons still produce memorable nights, especially early in the month. Monitor water-temperature trends on our live snapshot.',
        ],
      },
      {
        id: 'calendar-november',
        title: 'November',
        paragraphs: [
          'Hit-or-miss for dinoflagellate intensity as water cools. Comb jellies and clear, calm evenings can still reward patient visitors.',
        ],
      },
      {
        id: 'calendar-december',
        title: 'December',
        paragraphs: [
          'Cooler water and holiday schedules reduce spontaneous trips, but mild spells happen. Dress warmly; lagoon air drops faster than inland forecasts suggest.',
        ],
      },
    ],
  },
  {
    id: 'best-places',
    title: 'Location Micro-Guides: Space Coast & Lagoon Access',
    paragraphs: [
      'Bioluminescence is a lagoon story, not an Atlantic surf story. The micro-guides below explain what each area offers, how it relates to glow viewing, and how far you may need to travel from your hotel.',
      'Launch Zone operates night bio charters from Titusville on the Indian River Lagoon. Daytona-area guests often combine a daytime rental with a northbound glow trip when conditions align.',
    ],
    relatedLinks: [
      { label: 'Book a bioluminescence tour', path: '/bioluminescent-tours' },
      { label: 'Daytona boat rentals', path: '/boat-rentals/daytona' },
      { label: 'Titusville boat rentals', path: '/boat-rentals/titusville' },
    ],
    subsections: [
      {
        id: 'micro-titusville',
        title: 'Titusville',
        paragraphs: [
          'Titusville is the practical hub for Indian River Lagoon bio charters near Max Brewer Bridge and the Haulover Canal corridor. Ramp access, channel knowledge, and night navigation experience matter more here than on a daytime sandbar run.',
          'Bridge and shoreline lighting can reduce perceived glow near developed banks — local captains route toward darker water when possible. Pair your trip with a conditions check the same afternoon.',
          'Kennedy Space Center visitors often extend a trip with a bio night; count drive time, parking, and fatigue when stacking educational days with late lagoon departures.',
        ],
        relatedLinks: [
          { label: 'Bioluminescent tours', path: '/bioluminescent-tours' },
          { label: 'Titusville rentals', path: '/boat-rentals/titusville' },
        ],
      },
      {
        id: 'micro-indian-river-lagoon',
        title: 'Indian River Lagoon',
        paragraphs: [
          'The IRL is a 156-mile estuary along Florida’s east coast — shallow, biodiverse, and sensitive to runoff. Bioluminescence reports cluster where water is sheltered and plankton can accumulate, not along every mile equally.',
          'From Titusville north toward Mosquito Lagoon, basin geography and local weather create patchy blooms. Think in terms of segments and access points, not one uniform lake.',
        ],
        relatedLinks: [{ label: 'Marine conditions', path: '/conditions' }],
      },
      {
        id: 'micro-mosquito-lagoon',
        title: 'Mosquito Lagoon',
        paragraphs: [
          'Mosquito Lagoon is widely regarded as one of Florida’s premier bioluminescence destinations — shallow, dark, and relatively protected when winds stay low. It is not a casual midnight detour from a Daytona beach hotel.',
          'Some zones have access rules and shoaling hazards. If you do not know the bottom contours, a permitted captain-led trip is safer than improvising with a rental trailer after dark.',
        ],
        relatedLinks: [{ label: 'Book a night charter', path: '/bioluminescent-tours' }],
      },
      {
        id: 'micro-merritt-island',
        title: 'Merritt Island',
        paragraphs: [
          'Merritt Island sits between the Indian River and Mosquito Lagoon, with extensive refuge lands that limit development and light pollution in places. That darkness helps bioluminescence read brighter to the human eye.',
          'Wildlife refuges and security buffers mean not every shoreline is open to casual launching. Respect posted boundaries and plan authorized access rather than chasing social-media pins.',
        ],
      },
      {
        id: 'micro-daytona-beach',
        title: 'Daytona Beach',
        paragraphs: [
          'Daytona Beach is a strong daytime boating market — sandbars, lagoon runs, and family hours on the water — but it is not a primary open-ocean bioluminescence viewing area. Expect to drive toward Titusville or Mosquito Lagoon access for dedicated glow nights.',
          'Many visitors rent in Daytona by day and book a northbound charter on a dark, calm evening rather than searching for glow along the surf zone.',
        ],
        relatedLinks: [{ label: 'Daytona boat rentals', path: '/boat-rentals/daytona' }],
      },
      {
        id: 'micro-port-orange',
        title: 'Port Orange',
        paragraphs: [
          'Port Orange and the Halifax River system are excellent for daytime lagoon culture — fishing, sandbars, and short runs — but bioluminescence hotspots remain farther north in the IRL and Mosquito Lagoon complexes.',
          'Treat Port Orange as a comfortable base for rentals and provisioning, then plan travel time and a marine forecast for the lagoon where you will actually view glow.',
        ],
        relatedLinks: [{ label: 'Daytona-area rentals', path: '/boat-rentals/daytona' }],
      },
      {
        id: 'micro-new-smyrna-beach',
        title: 'New Smyrna Beach',
        paragraphs: [
          'New Smyrna Beach offers Atlantic surf and inlet access, not the sheltered dinoflagellate habitat that produces classic paddle-stroke sparkles. Visitors here should plan inland lagoon travel for bioluminescence rather than walking the beach at night expecting glow.',
          'Inlet tidal rips and night fishing traffic add separate safety concerns — do not confuse inlet nightlife with lagoon bioluminescence tourism.',
        ],
      },
    ],
  },
  {
    id: 'photography-glowing-water',
    title: 'Photography Tips for Glowing Water',
    paragraphs: [
      'Bioluminescence photography is harder than it looks on Instagram. The human eye integrates thousands of brief flashes; cameras need time, stability, and conservative expectations.',
      'Put experience first. A single memorable paddle stroke you watched with your own eyes often matters more than a blurry phone attempt in the dark.',
      'If you do shoot: mount the camera or brace against a stable hull on calm water. Manual mode, high ISO, wide aperture, and exposures from several seconds to twenty seconds are starting points — adjust for moonlight and boat motion.',
      'Autofocus struggles in darkness. Pre-focus on a distant shore light, then switch to manual focus to hold infinity or mid-range where your subject will be.',
      'Protect gear from salt spray; keep a microfiber cloth handy. Red-deck lighting preserves night vision for you and courtesy for other guests.',
      'Phone users can try night mode with a tripod clip and timer delay to avoid shake. Results vary widely; burst mode rarely captures the subtle flash pattern dinoflagellates produce.',
      'Leave drones aboard unless your operator explicitly allows them — noise, wildlife disturbance, and night-flight rules make them a poor default on lagoon trips.',
      'Share photos with accurate context: mention that long exposures exaggerate glow compared with what guests saw in real time. Honest captions build trust.',
    ],
    relatedLinks: [{ label: 'Book a stable platform charter', path: '/bioluminescent-tours' }],
  },
  {
    id: 'family-kids-viewing',
    title: 'Family and Kids Viewing Tips',
    paragraphs: [
      'Children often love bioluminescence when trips match their stamina, bedtime, and weather comfort. The goal is wonder — not an endurance test on a cold, windy lagoon.',
      'Choose operator policies that fit your crew: life jacket sizes, seated stability on a pontoon or deck boat, and realistic return times. Ask about restroom access before booking late-night trips with younger kids.',
      'Dress kids in layers and bring a change of dry shirt for the ride home. Lagoon air cools quickly after sunset even when daytime highs were in the 90s.',
      'Minimize bright white headlamps on deck. Explain the “quiet voice” rule — sound carries and wildlife shares the waterway.',
      'Let kids observe a small water sample briefly if the operator allows, then pour it back where it came from. That ritual teaches ethics better than a lecture.',
      'If glow is faint on your night, frame it as nature’s variability rather than a failed adventure. Flexibility models the same patience operators use when rescheduling around weather.',
    ],
    relatedLinks: [
      { label: 'Bioluminescent tours', path: '/bioluminescent-tours' },
      { label: 'FAQs', path: '/faqs' },
    ],
  },
  {
    id: 'bio-vs-rocket-launch-nights',
    title: 'Planning Bio Nights vs. Rocket Launch Nights',
    paragraphs: [
      'The Space Coast offers two very different night-sky experiences: biological glow in the lagoon and mechanical brilliance on the horizon when rockets lift from Cape Canaveral. They compete for the same calendar — dark skies, calm wind, and your group’s attention span.',
      'Rocket launches reward timing precision and official schedule updates. Bioluminescence rewards ecological conditions that change daily. Stacking both on one trip is sometimes possible on multi-day visits, but rarely on the same hour without compromise.',
      'Launch nights draw shoreline crowds and marine traffic near viewing corridors. Bio nights benefit from darker, less congested lagoon segments away from bridge glare. Plan separate evenings when possible rather than one overloaded itinerary.',
      'If a launch scrubs, keep your bio reservation flexible — weather that scrubs rockets may still yield glow, or vice versa. Treat each as its own experience with its own forecast.',
      'Photography goals differ: launches need horizon framing and burst timing; bioluminescence needs long exposure and minimal boat motion. Pick one primary mission per night for best results.',
      'Visitors staying a week can sandwich a daytime rental, a launch charter, and a bio night across separate evenings — each draws on different skills from the same crew.',
      'When launch traffic clogs ramps near the river, bio operators may adjust meeting times. Build buffer into dining and hotel plans so neither experience feels rushed.',
    ],
    relatedLinks: [
      { label: 'Rocket launch schedule', path: '/launches' },
      { label: 'Bioluminescent tours', path: '/bioluminescent-tours' },
      { label: 'Marine conditions', path: '/conditions' },
    ],
  },
  {
    id: 'conservation-lagoon-protection',
    title: 'Conservation and Lagoon Protection',
    paragraphs: [
      'The Indian River Lagoon is an estuary of national significance — seagrass, fisheries, manatees, and coastal resilience all depend on water quality. Nutrient runoff, habitat loss, and periodic algal events are long-term threats unrelated to the brief flash of a healthy bioluminescent dinoflagellate.',
      'Visitors can help: use pump-out facilities, avoid fuel spills, stay off prop-scarred flats, and support operators who follow wildlife viewing guidelines. Report unusual fish kills or large discolored patches to Florida Fish and Wildlife Conservation Commission channels rather than assuming it is “just bioluminescence.”',
      'Protecting the lagoon protects the conditions that make glowing water possible. The goal is not maximum traffic every night — it is sustainable access to a natural wonder for years to come.',
      'Seagrass scars from propellers take seasons to recover. Manatee slow-speed zones exist for a reason — especially after dark when animals are harder to spot. Choosing a licensed captain who knows depth and wildlife corridors is both a safety decision and a conservation one.',
      'Nutrient pollution from upland runoff can fuel harmful blooms that overshadow benign bioluminescence. Supporting watershed stewardship inland — fewer careless fertilizer applications, better stormwater awareness — helps the lagoon you visit from the water.',
      'Responsible ecotourism scales: small groups, slower speeds, and captains who refuse to chase wildlife for photos all reduce repeated stress on the same animals night after night.',
      'If bioluminescence inspires you, channel that enthusiasm into respectful use: take memories and photos, not liters of lagoon water; teach the next paddler to return samples and avoid wildlife harassment. The glow is a signal that the estuary is alive — our job is to keep it that way.',
    ],
    relatedLinks: [
      { label: 'Marine conditions', path: '/conditions' },
      { label: 'Book a responsible charter', path: '/bioluminescent-tours' },
    ],
  },
];

export function bioGuideWordCount(): number {
  let count = 0;
  const countText = (t: string) => {
    count += t.split(/\s+/).filter(Boolean).length;
  };
  for (const s of BIO_GUIDE_SECTIONS) {
    s.paragraphs.forEach(countText);
    s.subsections?.forEach((sub) => sub.paragraphs.forEach(countText));
  }
  return count;
}

export function bioGuideTocItems(): { id: string; title: string; level: 2 | 3 }[] {
  const items: { id: string; title: string; level: 2 | 3 }[] = [];
  for (const s of BIO_GUIDE_SECTIONS) {
    items.push({ id: s.id, title: s.title, level: 2 });
    s.subsections?.forEach((sub) => items.push({ id: sub.id, title: sub.title, level: 3 }));
  }
  items.push({ id: 'tonights-conditions', title: 'Tonight’s Conditions', level: 2 });
  items.push({ id: 'weekly-outlook', title: 'Weekly Outlook', level: 2 });
  items.push({ id: 'related-resources', title: 'Plan Your Trip', level: 2 });
  items.push({ id: 'bio-guide-faq', title: 'FAQ', level: 2 });
  return items;
}
