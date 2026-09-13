export type BioGuideFaq = {
  question: string;
  answer: string;
};

/** Short customer FAQ for the /bioluminescence guide page. */
export const BIO_GUIDE_FAQS: BioGuideFaq[] = [
  {
    question: 'Is bioluminescence guaranteed?',
    answer:
      'No. It is a natural phenomenon, and brightness changes with weather, moonlight, season, and water conditions.',
  },
  {
    question: 'Where do tours meet?',
    answer:
      'The primary meeting area is Parrish Park Boat Ramp in Titusville. Check your booking confirmation before leaving because operational conditions may require an adjustment.',
  },
  {
    question: 'How many guests can come?',
    answer:
      'The boat can carry up to five guests plus the captain. Package availability and shared or private seating depend on the option selected during booking.',
  },
  {
    question: 'What happens if the weather is unsafe?',
    answer:
      'The captain reviews local conditions before departure. If weather or water conditions require a schedule or meeting-location change, customers will receive updated instructions.',
  },
];

/** @deprecated Category labels retained for any leftover imports; guide FAQ is uncategorized. */
export type BioFaqCategory =
  | 'science'
  | 'viewing'
  | 'safety'
  | 'kids'
  | 'photography'
  | 'florida'
  | 'tours';

export const BIO_FAQ_CATEGORY_LABELS: Record<BioFaqCategory, string> = {
  science: 'Science',
  viewing: 'Viewing',
  safety: 'Safety',
  kids: 'Kids',
  photography: 'Photography',
  florida: 'Florida',
  tours: 'Tours',
};
