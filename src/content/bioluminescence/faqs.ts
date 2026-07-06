export type BioFaqCategory =
  | 'science'
  | 'viewing'
  | 'safety'
  | 'kids'
  | 'photography'
  | 'florida'
  | 'tours';

export type BioGuideFaq = {
  question: string;
  answer: string;
  categories: BioFaqCategory[];
};

export const BIO_FAQ_CATEGORY_LABELS: Record<BioFaqCategory, string> = {
  science: 'Science',
  viewing: 'Viewing',
  safety: 'Safety',
  kids: 'Kids',
  photography: 'Photography',
  florida: 'Florida',
  tours: 'Tours',
};

const FAQ_ENTRIES: Array<{ question: string; answer: string }> = [
  {
    question: 'When is bioluminescence season in Florida?',
    answer:
      'Peak dinoflagellate activity on the Space Coast is most often reported from late spring through early fall, when lagoon water is warmest. Comb jellies may appear outside that window. Seasonal patterns are trends — not guarantees for any single night.',
  },
  {
    question: 'Does bioluminescence happen every night?',
    answer:
      'No. Organism concentrations, wind, cloud cover, moon brightness, and recent weather all affect visibility. Some nights are spectacular; others are faint or difficult to see. Always check current conditions rather than assuming a calendar date alone will deliver a show.',
  },
  {
    question: 'What is the best moon phase for bioluminescence?',
    answer:
      'Dark-sky periods around the new moon are generally best because moonlight does not wash out faint glow. A bright full moon can still work in very sheltered, tree-lined creeks, but open lagoon viewing is easier when the moon is thin or below the horizon.',
  },
  {
    question: 'How do I use moon phase when planning a trip?',
    answer:
      'Check moonrise, moonset, and illumination percentage alongside wind and clouds. Plan trips in the window after astronomical dusk when the moon is below the horizon or blocked by clouds. Our live widget includes moon data for tonight.',
  },
  {
    question: 'Can clouds block bioluminescence?',
    answer:
      'Thick low clouds often bring wind and rain that end trips. Thin, broken clouds can sometimes dim moonlight without lighting up the whole sky — which may help you see faint glow on otherwise bright moon weeks. Context matters more than a single cloud percentage.',
  },
  {
    question: 'How does wind affect bioluminescence viewing?',
    answer:
      'Wind creates chop that makes faint flashes harder to see and less comfortable to paddle through. Sustained winds under about 10–15 mph are a common comfort guideline for night tours. Local funneling between islands can differ from airport readings.',
  },
  {
    question: 'Does water clarity matter for bioluminescence?',
    answer:
      'Lagoon glow happens in the upper water column where dinoflagellates concentrate. Heavy sediment runoff after storms can change conditions quickly. Natural tannin-stained water is not the same as muddy pollution — but either can affect how crisp flashes look to your eye.',
  },
  {
    question: 'What are Florida dinoflagellates?',
    answer:
      'They are microscopic single-celled protists — many photosynthetic — that can bloom in warm lagoon water. When dense enough, they flash blue-green light when disturbed. They are the usual source of paddle-stroke sparkles on the Indian River and Mosquito Lagoon.',
  },
  {
    question: 'What is Noctiluca?',
    answer:
      'Noctiluca scintillans is a bioluminescent dinoflagellate sometimes called sea sparkle. It can produce dramatic glow in some coastal systems. Along Florida’s coast it appears in scientific monitoring discussions; it is not the only organism behind every Space Coast glow night.',
  },
  {
    question: 'What is Pyrodinium?',
    answer:
      'Pyrodinium is a dinoflagellate genus known for bioluminescence and, in some species and regions, harmful bloom potential. Florida monitors water quality separately from tourism. Heed official health advisories — bioluminescence and safe contact are not the same question.',
  },
  {
    question: 'What is Pyrocystis?',
    answer:
      'Pyrocystis is a marine dinoflagellate genus famous in lab demonstrations for reliable flash responses. Wild lagoon populations may contribute to disturbance-triggered sparkle, but open-water viewing depends on bloom density — not aquarium conditions.',
  },
  {
    question: 'Are dinoflagellates algae?',
    answer:
      'They are often described as algae-like because many photosynthesize, but dinoflagellates are protists — neither true plants nor animals. That distinction matters mostly in science class; on the water, think of them as microscopic lagoon plankton.',
  },
  {
    question: 'Can you see bioluminescence from the beach in Daytona?',
    answer:
      'Daytona Beach itself is not a primary bioluminescence viewing area. The effect is most associated with sheltered lagoon and estuary water to the north and inland — especially Mosquito Lagoon and the Indian River Lagoon near Titusville. Plan lagoon access, not a surf-line walk.',
  },
  {
    question: 'Is bioluminescence the same as red tide?',
    answer:
      'No. Bioluminescent dinoflagellates produce light through a natural chemical reaction. Harmful algal blooms (sometimes called red tide) involve different species and can produce toxins. Follow official Florida health advisories and avoid water contact when warnings are posted.',
  },
  {
    question: 'Do comb jellies sting?',
    answer:
      'Comb jellies (ctenophores) are not true jellyfish and do not sting the way sea nettles do. They are delicate animals — observe gently and return them to the water if you handle one briefly.',
  },
  {
    question: 'Why do paddle strokes glow but the water looks dark between strokes?',
    answer:
      'Dinoflagellates flash in response to motion. Still water between strokes may look dark until something disturbs it again. Long-exposure photographs often exaggerate the effect compared with what the human eye sees in real time.',
  },
  {
    question: 'Is it safe to swim in bioluminescent water?',
    answer:
      'Many people wade or swim on calm nights, but night swimming in lagoons carries boating, wildlife, and water-quality risks separate from bioluminescence itself. Wear a life jacket near deep channels, avoid ingesting water, and heed any posted health advisories.',
  },
  {
    question: 'Can I take bioluminescent water home in a bottle?',
    answer:
      'You should not transport lagoon water or try to keep organisms alive at home. If you collect a small sample for brief observation, return it to the same waterway afterward. Organisms die quickly outside their natural conditions.',
  },
  {
    question: 'Why should I return sample water to the same lagoon?',
    answer:
      'Organisms are tuned to local salinity, temperature, and microbial communities. Moving water to another system stresses or kills them and risks unintended transfer. Pour samples back where you collected them — never into storm drains or backyard ponds.',
  },
  {
    question: 'What is safe, brief observation?',
    answer:
      'Use a small clean cup or jar once, observe for a minute or two under dim light, do not drink the water, and release it back to the same spot. Avoid repeated scooping from one patch and never harass wildlife for a brighter photo.',
  },
  {
    question: 'What should I wear on a bioluminescence tour?',
    answer:
      'Dress in layers — lagoon air cools after sunset even in summer. Soft-soled shoes, insect repellent applied before boarding (not on the boat deck if your operator requests), and a life jacket are standard. Minimize bright white headlamps.',
  },
  {
    question: 'Will rain ruin bioluminescence?',
    answer:
      'Heavy rain and wind can disrupt visibility and mix surface layers. A clearing sky after an afternoon storm sometimes yields good viewing, but thunderstorms with lightning are unsafe for boating regardless of glow potential.',
  },
  {
    question: 'How windy is too windy for bioluminescence viewing?',
    answer:
      'There is no single cutoff, but whitecaps and chop scatter light and make paddling harder. Many operators prefer sustained winds under about 10–15 mph for comfortable guest experiences. Check a live marine forecast before you launch.',
  },
  {
    question: 'Can you photograph bioluminescence on a phone?',
    answer:
      'Phone cameras struggle in low light without a tripod and long exposure. Dedicated cameras with manual settings, high ISO, and a stable platform on calm water produce the iconic images. Enjoy the experience first — photos second.',
  },
  {
    question: 'Can bioluminescence harm fish or wildlife?',
    answer:
      'Natural bioluminescence in healthy water is part of the food web. Harmful algal blooms are a separate issue involving toxins and oxygen stress. Report fish kills or unusual water color to authorities rather than assuming glow equals danger.',
  },
  {
    question: 'Where does Launch Zone run bioluminescence tours?',
    answer:
      'Launch Zone Charters operates captain-led bioluminescence trips from the Titusville / Max Brewer Bridge area on the Indian River Lagoon. See our bioluminescent tours page for booking details and live condition tools.',
  },
  {
    question: 'How do I check tonight’s bioluminescence conditions?',
    answer:
      'Use the live conditions widget on this page or our bioluminescent tours page. Both pull from the same server-side model using wind, cloud cover, moon data, water temperature when available, and seasonal factors.',
  },
  {
    question: 'Are bioluminescence tours kid-friendly?',
    answer:
      'Many families join night tours, but consider bedtimes, weather, and whether your children can sit safely on a boat after dark. Ask your operator about age policies, life jacket sizes, and trip length before booking.',
  },
  {
    question: 'What is the difference between a rental and a bio charter?',
    answer:
      'A charter includes a licensed captain who knows local channels, lighting, and night navigation. Self-drive rentals require your own boating competence and are generally better suited to daytime trips unless you have strong local night experience.',
  },
  {
    question: 'Why protect the Indian River Lagoon if bioluminescence is natural?',
    answer:
      'Healthy estuaries support the food web that sustains plankton and wildlife. Pollution and habitat damage can harm the broader ecosystem even when occasional blooms still occur. Conservation keeps the lagoon worth visiting for reasons beyond a single glowing night.',
  },
  {
    question: 'What months are best for bioluminescence on the Space Coast?',
    answer:
      'Warm months from late spring through early fall are the usual peak for dinoflagellates, with June through August often cited as strong windows. Winter can still produce comb jellies or surprise warm spells. Use the month-by-month calendar on this guide plus live conditions — not memory alone.',
  },
  {
    question: 'Can I photograph bioluminescence without a DSLR?',
    answer:
      'Phones can capture usable images with a tripod, timer delay, and night mode on very calm nights, but results vary. Dedicated cameras with manual exposure control perform better. Prioritize watching the water with your eyes; photos are a bonus.',
  },
  {
    question: 'Should I plan a rocket launch and bioluminescence on the same night?',
    answer:
      'Usually no — each experience deserves its own forecast, timing, and focus. Multi-day visits can split a launch charter and a bio night across separate evenings. Check our launches page for schedules and our live widget for tonight’s glow potential.',
  },
  {
    question: 'Is Mosquito Lagoon better than Titusville for bioluminescence?',
    answer:
      'Mosquito Lagoon is famous for dark, shallow habitat when blooms are active, but access and navigation are specialized. Titusville offers practical charter operations on the Indian River Lagoon. Neither guarantees glow; conditions on the night matter more than reputation.',
  },
];

function inferFaqCategories(question: string, answer: string): BioFaqCategory[] {
  const blob = `${question} ${answer}`.toLowerCase();
  const cats = new Set<BioFaqCategory>();
  if (/dinoflagellate|noctiluca|pyrodinium|pyrocystis|comb jelly|organism|algae|protist|red tide/.test(blob)) {
    cats.add('science');
  }
  if (/moon|wind|cloud|season|month|when|time|conditions|forecast|calendar/.test(blob)) {
    cats.add('viewing');
  }
  if (/safe|swim|health|advisory|harm|ingest|bottle|collect|return/.test(blob)) {
    cats.add('safety');
  }
  if (/kid|child|family/.test(blob)) {
    cats.add('kids');
  }
  if (/photo|camera|phone|dslr|exposure/.test(blob)) {
    cats.add('photography');
  }
  if (/daytona|titusville|mosquito|indian river|florida|space coast|port orange|smyrna|lagoon/.test(blob)) {
    cats.add('florida');
  }
  if (/launch zone|tour|charter|book|rental/.test(blob)) {
    cats.add('tours');
  }
  if (!cats.size) cats.add('viewing');
  return [...cats];
}

export const BIO_GUIDE_FAQS: BioGuideFaq[] = FAQ_ENTRIES.map((faq) => ({
  ...faq,
  categories: inferFaqCategories(faq.question, faq.answer),
}));
