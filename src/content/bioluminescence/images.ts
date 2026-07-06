import { BIO_GUIDE_HERO_IMAGE, BIO_GUIDE_HERO_ALT } from './meta';

export type BioGuideImageKey =
  | 'dinoflagellates'
  | 'combJellies'
  | 'indianRiverLagoon'
  | 'mosquitoLagoon'
  | 'nightKayak'
  | 'rocketGlowingWater';

export type BioGuideImage = {
  src: string;
  alt: string;
  caption?: string;
};

/** Real project assets only — no generated placeholders. */
export const BIO_GUIDE_IMAGES: Record<BioGuideImageKey, BioGuideImage> = {
  dinoflagellates: {
    src: '/images/titusville-florida-bioluminescent-boat-tour-marine-conditions-indian-river-lagoon.png',
    alt: 'Indian River Lagoon at night — contextual scene for Florida dinoflagellate bioluminescence viewing',
    caption: 'Lagoon conditions and night water on the Indian River — dinoflagellate glow appears when blooms are active.',
  },
  combJellies: {
    src: '/images/bioluminescent-boat-tour-florida-night-glowing-water-charter-launch-zone-charters-indian-river-lagoon-experience.png',
    alt: 'Bioluminescent night water on a Florida lagoon charter — soft glow and comb jelly viewing context',
    caption: 'Some nights comb jellies drift as slow pulsing shapes beneath sharper dinoflagellate flashes.',
  },
  indianRiverLagoon: {
    src: BIO_GUIDE_HERO_IMAGE,
    alt: BIO_GUIDE_HERO_ALT,
    caption: 'The Indian River Lagoon near Titusville — a primary Space Coast bioluminescence access corridor.',
  },
  mosquitoLagoon: {
    src: '/images/bioluminescent-boat-tour-titusville-florida-indian-river-lagoon-night-glowing-water-launch-zone-charters-pontoon-center-console.png',
    alt: 'Night bioluminescence charter on sheltered Florida lagoon water near Titusville',
    caption: 'Mosquito Lagoon and northern IRL basins are famous for dark, shallow habitat when blooms align.',
  },
  nightKayak: {
    src: '/images/bioluminescent-boat-tour-titusville-florida-glowing-water-night-kayak-indian-river-lagoon-adventure-launch-zone-charters.png',
    alt: 'Night kayak and boat tour bioluminescence on the Indian River Lagoon, Titusville Florida',
    caption: 'Paddle strokes and hull wakes trigger disturbance flashes when organism densities are high.',
  },
  rocketGlowingWater: {
    src: '/images/rocket-launch-viewing-titusville-florida-boat-charter-falcon9-night-water.png',
    alt: 'Rocket launch viewing from a boat on Florida night water — separate from lagoon bioluminescence planning',
    caption: 'Rocket nights and bio nights both need dark skies — plan them as separate experiences when possible.',
  },
};

/** Optional figure per section id */
export const BIO_SECTION_IMAGES: Partial<Record<string, BioGuideImageKey>> = {
  'dinoflagellates-comb-jellies': 'nightKayak',
  'florida-dinoflagellates': 'dinoflagellates',
  'comb-jellies-detail': 'combJellies',
  'micro-indian-river-lagoon': 'indianRiverLagoon',
  'micro-mosquito-lagoon': 'mosquitoLagoon',
  'bio-vs-rocket-launch-nights': 'rocketGlowingWater',
};
