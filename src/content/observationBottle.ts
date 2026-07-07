export const OBSERVATION_BOTTLE = {
  name: 'Launch Zone Observation Bottle',
  tagline: 'Catch the Glow. Return the Magic.',
  brand: 'Launch Zone Charters',
  imagePath: '/images/Launch_Zone_Observation_Bottle.png',
  imageAlt:
    'Launch Zone Observation Bottle for responsibly observing Florida bioluminescent lagoon water.',
  route: '/shop/observation-bottle',
  successRoute: '/shop/order-success',
  priceUsd: 34.99,
  currency: 'USD',
  minQuantity: 1,
  maxQuantity: 10,
} as const;

export const OBSERVATION_BOTTLE_CHECKOUT_FEATURES = [
  'Premium Borosilicate Glass',
  'Bamboo Lid',
  'Leakproof Silicone Seal',
  'BPA-Free',
  'Reusable',
  'Eco-Friendly',
  'Observation Guide Included',
  'Free Standard Shipping (United States)',
] as const;

export const OBSERVATION_BOTTLE_SHIPPING_NOTICE =
  'This product is made to order. Please allow approximately 12–16 business days for processing and delivery. Tracking information will be emailed once your order ships.';

export const OBSERVATION_BOTTLE_FEATURES = [
  '16 oz (473 mL)',
  'Premium Borosilicate Glass',
  'Bamboo Lid',
  'Leakproof Silicone Seal',
  'BPA Free',
  'Reusable',
  'Eco-Friendly',
  'Durable Construction',
  'Observation Guide Included',
  'Perfect Florida Souvenir',
] as const;

export const OBSERVATION_BOTTLE_HOW_TO_USE = [
  'Gently collect a small amount of water where bioluminescence is active.',
  'Slowly swirl the bottle to activate the glow.',
  'Enjoy the light show while learning about one of Florida\'s most fascinating ecosystems.',
  'Return the water to the exact location where it was collected to help protect the lagoon and the microscopic organisms that make the glow possible.',
] as const;

export const OBSERVATION_BOTTLE_CONSERVATION = [
  'Observe responsibly',
  'Learn about Florida\'s lagoon ecosystem',
  'Return the water to the same location where it was collected',
  'Respect wildlife',
  'Leave the lagoon better than you found it',
] as const;

export const OBSERVATION_BOTTLE_FAQS: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: 'What creates the glow?',
    answer:
      'Bioluminescence is light produced by living organisms — often dinoflagellates in Florida lagoon water — when they are disturbed. The Observation Bottle lets you see that effect up close for a brief moment without removing organisms from their habitat long-term.',
  },
  {
    question: 'Is the glow safe to touch?',
    answer:
      'The glow is a natural chemical reaction in the water. Follow your tour guide\'s briefing, wash hands after handling lagoon water as you would after any outdoor activity, and avoid ingesting lagoon water.',
  },
  {
    question: 'Can children use the bottle?',
    answer:
      'Yes, with adult supervision. The bottle is durable borosilicate glass; teach children to handle it carefully, collect only a small amount of water, and return it promptly with your guide\'s help.',
  },
  {
    question: 'Why should I return the water?',
    answer:
      'Returning water to the same spot protects microscopic life, salinity, and the health of the Indian River Lagoon ecosystem. Our philosophy is observe, learn, and return — not keep.',
  },
  {
    question: 'How long does the glow last?',
    answer:
      'The glow is brightest right after gentle swirling and fades within moments as organisms settle. That brief display is intentional — long enough to wonder, short enough to encourage a quick, responsible return.',
  },
  {
    question: 'What organisms create bioluminescence?',
    answer:
      'On the Space Coast, dinoflagellates are the most common source of blue-green sparkles in lagoon water. Comb jellies can also appear on some nights. Your observation guide explains what you are seeing on your tour.',
  },
  {
    question: 'Why does swirling make it glow?',
    answer:
      'Swirling disturbs the organisms and triggers their natural light response — a defense mechanism evolved over millions of years. A gentle swirl is enough; aggressive shaking is unnecessary and stresses the sample.',
  },
  {
    question: 'Can I use this bottle again?',
    answer:
      'Yes. Rinse with fresh water after each use, keep the silicone seal clean, and store dry. The bottle is designed for repeated educational observation during responsible lagoon visits — not for long-term storage of living water.',
  },
];

export const OBSERVATION_BOTTLE_RELATED_LINKS = [
  { label: 'Bioluminescence guide', path: '/bioluminescence' },
  { label: 'Bioluminescent tours', path: '/bioluminescent-tours' },
  { label: 'Marine conditions', path: '/conditions' },
  { label: 'Rocket launches', path: '/launches' },
] as const;
