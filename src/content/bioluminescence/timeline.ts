export type BioTimelineStep = {
  id: string;
  title: string;
  description: string;
};

export const BIO_VIEWING_TIMELINE: BioTimelineStep[] = [
  {
    id: 'sunset',
    title: 'Sunset',
    description: 'Civil twilight ends; ramp traffic peaks. Check marine forecast and moon data before casting off.',
  },
  {
    id: 'water-settles',
    title: 'Water settles',
    description: 'Afternoon chop often eases after seabreeze fades. Organisms concentrate near the surface layer.',
  },
  {
    id: 'dark-adaptation',
    title: 'Dark adaptation',
    description: 'Allow 10–15 minutes for eyes to adjust. Dim red deck lights; avoid phone glare on the water.',
  },
  {
    id: 'peak-glow',
    title: 'Peak glow window',
    description: 'Many tours target roughly 9:00 PM–midnight when skies are dark and wind stays low — not a guarantee.',
  },
  {
    id: 'moonrise-effects',
    title: 'Moonrise effects',
    description: 'If the moon climbs, faint glow may wash out on open lagoon. Sheltered routes help on bright moon nights.',
  },
  {
    id: 'end-viewing',
    title: 'End of viewing window',
    description: 'Wind shifts, fatigue, and ramp curfews end the night. Plan a conservative return before conditions change.',
  },
];
