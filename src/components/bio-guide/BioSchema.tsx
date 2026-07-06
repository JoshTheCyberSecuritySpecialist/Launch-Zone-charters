import { useMemo } from 'react';
import { BIO_GUIDE_FAQS } from '../../content/bioluminescence/faqs';
import {
  BIO_GUIDE_HERO_ALT,
  BIO_GUIDE_HERO_IMAGE,
  BIO_GUIDE_LAST_UPDATED,
  BIO_GUIDE_META,
} from '../../content/bioluminescence/meta';
import { SITE_LOGO_PATH } from '../../constants/branding';
import { siteOrigin } from '../../lib/siteOrigin';

type BioSchemaProps = {
  canonicalUrl: string;
  wordCount: number;
};

const SAFE_OBSERVATION_HOWTO = {
  '@type': 'HowTo',
  name: 'How to safely observe bioluminescent lagoon water briefly',
  description:
    'Collect a small sample, observe briefly under dim light, and return water to the same Florida lagoon location.',
  step: [
    {
      '@type': 'HowToStep',
      position: 1,
      name: 'Use a small clean container once',
      text: 'Fill a cup or jar a single time rather than repeated scooping from the same patch.',
    },
    {
      '@type': 'HowToStep',
      position: 2,
      name: 'Observe for one to two minutes',
      text: 'Keep the sample shaded from bright deck lights. Do not drink the water.',
    },
    {
      '@type': 'HowToStep',
      position: 3,
      name: 'Return water to the same location',
      text: 'Pour the sample back where it was collected. Never transport lagoon water home or into storm drains.',
    },
  ],
};

export default function BioSchema({ canonicalUrl, wordCount }: BioSchemaProps) {
  const jsonLd = useMemo(() => {
    const origin = siteOrigin();
    const imageUrl = `${origin}${BIO_GUIDE_HERO_IMAGE}`;

    const faqEntities = BIO_GUIDE_FAQS.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    }));

    const webPageId = canonicalUrl;

    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          '@id': webPageId,
          url: canonicalUrl,
          name: BIO_GUIDE_META.headline,
          description: BIO_GUIDE_META.description,
          inLanguage: 'en-US',
          isPartOf: {
            '@type': 'WebSite',
            name: 'Launch Zone Charters',
            url: origin,
          },
          speakable: {
            '@type': 'SpeakableSpecification',
            cssSelector: ['.bio-guide-speakable'],
          },
          primaryImageOfPage: {
            '@type': 'ImageObject',
            url: imageUrl,
            caption: BIO_GUIDE_HERO_ALT,
          },
        },
        {
          '@type': 'Article',
          headline: BIO_GUIDE_META.headline,
          description: BIO_GUIDE_META.description,
          image: {
            '@type': 'ImageObject',
            url: imageUrl,
            caption: BIO_GUIDE_HERO_ALT,
          },
          datePublished: '2026-07-05',
          dateModified: BIO_GUIDE_LAST_UPDATED,
          author: {
            '@type': 'Organization',
            name: 'Launch Zone Charters',
          },
          publisher: {
            '@type': 'Organization',
            name: 'Launch Zone Charters',
            logo: {
              '@type': 'ImageObject',
              url: `${origin}${SITE_LOGO_PATH}`,
            },
          },
          mainEntityOfPage: {
            '@type': 'WebPage',
            '@id': webPageId,
          },
          wordCount,
          inLanguage: 'en-US',
        },
        {
          '@type': 'FAQPage',
          mainEntity: faqEntities,
        },
        SAFE_OBSERVATION_HOWTO,
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            {
              '@type': 'ListItem',
              position: 1,
              name: 'Home',
              item: `${origin}/`,
            },
            {
              '@type': 'ListItem',
              position: 2,
              name: 'Florida Bioluminescence Guide',
              item: canonicalUrl,
            },
          ],
        },
        {
          '@type': 'Organization',
          name: 'Launch Zone Charters',
          url: origin,
          logo: `${origin}${SITE_LOGO_PATH}`,
          telephone: '+1-803-542-1761',
          areaServed: {
            '@type': 'State',
            name: 'Florida',
          },
        },
      ],
    };
  }, [canonicalUrl, wordCount]);

  return <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>;
}
