// Site text and links. Colors and type are in src/styles/tokens.css instead, so the
// CSS can use them directly.
import type { IconName } from '../components/Icon.astro';

export interface Link {
  icon: IconName;
  /** Read out by screen readers, since the icon on its own says nothing. */
  label: string;
  /** Shorter wording for the hover label, where space is tight. Defaults to label. */
  tip?: string;
  url: string;
}

export const site = {
  title: 'Roger Egito',
  url: 'https://roger-egito.github.io',
  description: 'Portfolio of game designer and Unity developer Roger Egito.',
  author: 'Roger Egito',
  skills: 'Game Designer & Unity Developer',
  /**
   * Shown as "RJ, Brazil" in the banner, and read by StructuredData for search engines.
   * Kept as parts so both come from the same place. No city on purpose: the page
   * doesn't show one, so the data doesn't either.
   */
  location: { region: 'RJ', country: 'Brazil', countryCode: 'BR' },
  timezone: 'UTC-03:00',
  email: 'rogeregito@outlook.com',
  slogan: 'Creating games with heart and soul',

  /** Where the contact form posts to. */
  contactAction: 'https://formspree.io/f/xldnwyla',

  /**
   * Pageview counters. Both are cookieless and collect nothing personal, so there's no
   * consent banner to put up. Running side by side for now to compare them on the
   * same traffic. Drop the one that loses and its script goes with it.
   *
   * goatcounter: stats at https://roger-egito.goatcounter.com
   * umami: the website ID from Umami Cloud, stats at https://cloud.umami.is
   */
  analytics: {
    goatcounter: 'https://roger-egito.goatcounter.com/count',
    umami: '913e43fb-62a5-46f8-8ce3-3249ef11d660',
  },

  footerNote: 'Everything here I made alone or as part of a team. Work under NDA isn\'t shown.',

  social: [
    { icon: 'itch-io', label: 'itch.io', url: 'https://egito.itch.io' },
    { icon: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/in/roger-egito/' },
    { icon: 'github', label: 'GitHub', url: 'https://github.com/Roger-Egito' },
  ] satisfies Link[],

  links: [
    {
      icon: 'file-lines',
      label: 'Curriculum vitae',
      tip: 'CV',
      // Served from this domain rather than Google Drive: a Drive link looks
      // provisional, can hit a permission wall, and takes the reader off the site. The
      // file lives in public/, which Astro copies through untouched, so the URL stays
      // put when the PDF is replaced.
      url: '/Roger_Egito_CV.pdf',
    },
  ] satisfies Link[],
};

/** Only icon shown above the contact form. */
export const contactSocial = site.social[1];

/**
 * Browser tab / search result title. "Roger Egito - Portfolio" on the homepage,
 * "Roger Egito - Hotel 77" on a game. Kept here so every page builds it the same way.
 */
export const pageTitle = (section: string) => `${site.title} - ${section}`;

/** Strips the inline HTML some titles carry, e.g. the <br> in Prison Break. */
export const plainText = (value: string) =>
  value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
