import { Helmet } from 'react-helmet-async';
import { SITE_APPLE_TOUCH_ICON_PATH, SITE_FAVICON_PATH } from '../../constants/branding';

/** Captain portal document title and mobile home-screen hints. */
export default function CaptainDocumentHead() {
  return (
    <Helmet>
      <title>Launch Zone Captain</title>
      <meta name="application-name" content="Launch Zone Captain" />
      <meta name="apple-mobile-web-app-title" content="Launch Zone Captain" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="theme-color" content="#0c4a6e" />
      <link rel="icon" type="image/png" sizes="32x32" href={SITE_FAVICON_PATH} />
      <link rel="apple-touch-icon" sizes="180x180" href={SITE_APPLE_TOUCH_ICON_PATH} />
    </Helmet>
  );
}
