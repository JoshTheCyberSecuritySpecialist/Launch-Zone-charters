export type BioCalloutVariant =
  | 'did-you-know'
  | 'marine-biology'
  | 'local-tip'
  | 'captains-tip'
  | 'conservation-tip';

export type BioCallout = {
  variant: BioCalloutVariant;
  body: string;
};

/** Short authority callouts keyed by section or subsection id — no long-form prose. */
export const BIO_SECTION_CALLOUTS: Record<string, BioCallout[]> = {
  'what-is-bioluminescence': [
    {
      variant: 'did-you-know',
      body: 'A single dinoflagellate flash lasts only a fraction of a second — your brain blends thousands of flashes into what looks like a continuous glow trail.',
    },
  ],
  'why-florida-water-glows-blue': [
    {
      variant: 'marine-biology',
      body: 'Blue-green bioluminescence in lagoons is produced by luciferin–luciferase chemistry inside living cells, not by reflected moonlight on the surface.',
    },
  ],
  'florida-dinoflagellates': [
    {
      variant: 'marine-biology',
      body: 'Dinoflagellates are protists — not true algae — though many species photosynthesize like plants.',
    },
  ],
  'comb-jellies-detail': [
    {
      variant: 'did-you-know',
      body: 'Comb jellies use sticky colloblasts to capture prey; they do not sting like sea nettles.',
    },
  ],
  'moon-phase-strategy': [
    {
      variant: 'local-tip',
      body: 'Open lagoon basins near bridges are more moon-sensitive than narrow, tree-lined creeks — plan routes with local knowledge.',
    },
  ],
  'wind-and-water-clarity': [
    {
      variant: 'captains-tip',
      body: 'If whitecaps appear at the ramp, expect faint glow and harder paddling — consider rescheduling before you leave the dock.',
    },
  ],
  'when-clouds-help': [
    {
      variant: 'did-you-know',
      body: 'Thin high clouds can block moon glare without lighting the whole sky — sometimes improving perceived glow on bright moon weeks.',
    },
  ],
  'safe-brief-observation': [
    {
      variant: 'captains-tip',
      body: 'One cup, one minute, same-location release — curiosity satisfied without stressing the bloom.',
    },
  ],
  'return-water-same-lagoon': [
    {
      variant: 'conservation-tip',
      body: 'Never pour lagoon samples into storm drains or backyard ponds — organisms die and ecosystems do not mix safely.',
    },
  ],
  'conservation-lagoon-protection': [
    {
      variant: 'conservation-tip',
      body: 'Prop scars on seagrass take seasons to heal. Slow speed in posted zones protects habitat and manatees after dark.',
    },
  ],
  'micro-titusville': [
    {
      variant: 'local-tip',
      body: 'Max Brewer Bridge area operators know channel markers and glare pockets — valuable on your first night trip.',
    },
  ],
  'photography-glowing-water': [
    {
      variant: 'captains-tip',
      body: 'Brace the camera on a stable hull before chasing long exposures — boat motion blurs more shots than low ISO.',
    },
  ],
  'family-kids-viewing': [
    {
      variant: 'local-tip',
      body: 'Layer kids like it is 10°F cooler than the daytime forecast — lagoon air drops fast after sunset.',
    },
  ],
};
