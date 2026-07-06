export type BioComparisonRow = {
  feature: string;
  dinoflagellates: string;
  combJellies: string;
};

export const DINOFLAGELLATE_VS_COMB_JELLY: BioComparisonRow[] = [
  {
    feature: 'Glow color',
    dinoflagellates: 'Blue-green flash on disturbance',
    combJellies: 'Soft blue, green, or pink along combs',
  },
  {
    feature: 'Why they glow',
    dinoflagellates: 'Defense flash when cells are sheared',
    combJellies: 'Continuous or pulsing comb-row light',
  },
  {
    feature: 'Season',
    dinoflagellates: 'Peak warm months (often May–Oct trend)',
    combJellies: 'Broader season; visible many months',
  },
  {
    feature: 'Visible from boat',
    dinoflagellates: 'Sharp trails behind wake and paddles',
    combJellies: 'Drifting glowing shapes below surface',
  },
  {
    feature: 'Safe to touch',
    dinoflagellates: 'Avoid ingestion; brief observation only',
    combJellies: 'No sting; fragile — gentle release only',
  },
  {
    feature: 'Best viewing conditions',
    dinoflagellates: 'Dark moon, calm wind, warm water',
    combJellies: 'Calm nights; visible even when flashes are faint',
  },
];
