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
        {
          '@type': 'TouristTrip',
          name: 'Bioluminescence Night Tour',
          description: BIO_GUIDE_META.description,
          touristType: 'Nature tourism',
          itinerary: {
            '@type': 'Place',
            name: 'Indian River Lagoon',
            address: {
              '@type': 'PostalAddress',
              addressLocality: 'Titusville',
              addressRegion: 'FL',
              addressCountry: 'US',
            },
          },
          provider: {
            '@type': 'Organization',
            name: 'Launch Zone Charters',
            url: origin,
            telephone: '+1-803-542-1761',
          },
        },
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
              name: 'Florida Bioluminescence Boat Tours',
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
