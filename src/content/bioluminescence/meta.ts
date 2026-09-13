export const BIO_GUIDE_HERO_IMAGE = '/images/glowinghuman.avif';

export const BIO_GUIDE_HERO_ALT =
  'Electric blue bioluminescent wake behind a boat at night on the Indian River Lagoon near Titusville, with a guest silhouette and distant bridge lights';

export const BIO_GUIDE_LAST_UPDATED = '2026-09-13';

export const BIO_GUIDE_META = {
  title: 'Florida Bioluminescence Boat Tours | Titusville & Indian River Lagoon | Launch Zone Charters',
  description:
    'Captain-led Florida bioluminescence boat tours near Titusville on the Indian River Lagoon. Small groups of up to five, glow forecast tips, and direct package booking with Launch Zone Charters.',
  keywords:
    'Florida bioluminescence, bioluminescence boat tour Titusville, Indian River Lagoon glow, Mosquito Lagoon bioluminescence, Space Coast night tour, Launch Zone Charters',
  headline: 'Florida Bioluminescence Boat Tours',
  subheading:
    'Explore the Indian River Lagoon near Titusville on a captain-led nighttime boat tour. Watch the water come alive as movement creates flashes of blue-green light around the boat.',
} as const;

export const BIO_GUIDE_PHOTOS = {
  hero: {
    src: BIO_GUIDE_HERO_IMAGE,
    alt: BIO_GUIDE_HERO_ALT,
    caption: 'Nighttime bioluminescence on the Indian River Lagoon',
  },
  handClose: {
    src: '/images/glowinghand.avif',
    alt: 'Silhouette of a hand reaching into dark water glowing with bright electric-blue bioluminescence',
    caption: 'Guests exploring the lagoon after dark',
  },
  armReach: {
    src: '/images/glowingarmandhand.avif',
    alt: "A guest's arm and hand reaching toward vibrant blue bioluminescent water from a boat at night",
    caption: 'A small-group Launch Zone Charters experience',
  },
} as const;

/** Words-per-minute for estimated reading time (schema only). */
export const BIO_GUIDE_WPM = 220;
