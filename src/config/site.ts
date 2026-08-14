// Site text and links. Colors and type are in src/styles/tokens.css instead, so the
// CSS can use them directly.
import type { IconName } from '../components/Icon.astro';

interface Link {
  icon: IconName;
  /** Read out by screen readers, since the icon on its own says nothing. */
  label: string;
  url: string;
}

export const site = {
  title: 'Roger Egito',
  url: 'https://roger-egito.github.io',
  description: 'Portfolio of game designer and developer Roger Egito.',
  author: 'Roger Egito',
  skills: 'Game Designer | Developer',
  slogan: 'Creating games with heart and soul',

  /** Where the contact form posts to. */
  contactAction: 'https://formspree.io/f/xldnwyla',

  footerNote: 'Games developed by Roger Egito (fully or partially), not restricted by NDA.',

  social: [
    { icon: 'itch-io', label: 'itch.io', url: 'https://egito.itch.io' },
    { icon: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/in/roger-egito/' },
    { icon: 'github', label: 'GitHub', url: 'https://github.com/Roger-Egito' },
  ] satisfies Link[],

  links: [
    {
      icon: 'file',
      label: 'Curriculum vitae',
      url: 'https://drive.google.com/file/d/1hZ3cvIdgSqQ17rHSOdth92TKjoFSWDFk/view?usp=sharing',
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
