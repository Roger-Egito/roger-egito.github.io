// Site text and links. Colors and type are in src/styles/tokens.css instead, so the
// CSS can use them directly.
import type { IconName } from '../components/Icon.astro';
import { labelOf, rolesOf, type TagId } from './tags';

export interface Link {
  icon: IconName;
  /** Read out by screen readers, since the icon on its own says nothing. */
  label: string;
  /** Shorter wording for the hover label, where space is tight. Defaults to label. */
  tip?: string;
  url: string;
  /** Sent to the collector as a click event of this name, for links worth counting. */
  event?: string;
}

export const site = {
  title: 'Roger Egito',
  url: 'https://roger-egito.github.io',
  /** The homepage's search result line and the feed's subtitle. About the site. */
  description:
    'Roger Egito is a game designer and Unity developer from Brazil. Case studies of the ' +
    'games he designed, programmed and localized for studios, clients and his own projects.',
  /**
   * About me rather than the site: the About page's search result line, and the
   * description in StructuredData. Only claims the case studies show on the page.
   */
  bio:
    'Game designer and Unity developer from Brazil, designing games at Ludomancer Studio ' +
    "and leading a VR project at UFF's Media Lab.",
  author: 'Roger Egito',
  /** The line under my name in the hero, the homepage title, and my job title for search engines. */
  skills: 'Game Designer & Unity Developer',
  /**
   * What I know, for StructuredData's knowsAbout. Picked by hand rather than gathered
   * from every game's tags, which would hand search engines a list of seventy terms.
   */
  specialties: [
    'Game design',
    'Systems design',
    'Level design',
    'Narrative design',
    'Gameplay programming',
    'Unity',
    'C#',
    'Game localization',
  ],
  /** Languages I work in, as BCP 47 tags, for StructuredData's knowsLanguage. */
  languages: ['pt-BR', 'en'],
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
   * Visit counter: the site's own collector, a Cloudflare Worker in collector/. No
   * cookies and nothing personal stored, so there's no consent banner to put up.
   *
   * collector: the Worker's address, with no slash at the end. Empty sends nothing.
   * The numbers are read on the /umami page, with the collector's read key.
   */
  analytics: {
    collector: 'https://portfolio-data.roger-egito.workers.dev',
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
      event: 'cv-open',
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

/**
 * Strips the inline HTML some titles carry. A <br> in a title only ever splits a title
 * from its subtitle, as in "Prison Break<br>Escape Big Sister", so it reads as a colon
 * once the line break is gone: "Prison Break: Escape Big Sister", not two titles run
 * together.
 */
export const plainText = (value: string) =>
  value
    .replace(/\s*<br\s*\/?>\s*/gi, ': ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * What a game's cover shows, for its alt text: the game's own alt when its data gives
 * one, otherwise "<title> key art". The grid card and the game page show the same
 * cover, so both read it from here and can't describe it differently.
 */
export const coverAlt = (data: { title: string; alt?: string }) => data.alt ?? `${plainText(data.title)} key art`;

/**
 * What search engines need about a client that its tag doesn't say: the full name where
 * the label is a short form, since an organization is matched by its name, and a more
 * specific schema.org type where one fits.
 */
const organizations: Partial<Record<TagId, { name: string; type: string }>> = {
  uff: { name: 'Universidade Federal Fluminense', type: 'CollegeOrUniversity' },
};

/**
 * A client tag as a schema.org Organization. The @id is what ties the employer on my
 * Person to the studio on each of its games, so every page describes it the same way.
 */
export const organizationOf = (tag: TagId) => {
  const label = labelOf(tag);
  const { name = label, type = 'Organization' } = organizations[tag] ?? {};
  return {
    '@type': type,
    '@id': `${site.url}/#org-${tag}`,
    name,
    ...(name !== label && { alternateName: label }),
  };
};

/** The front matter fields a game's title and summary are built from. */
interface GameText {
  title: string;
  roles?: string;
  tags: readonly string[];
  blurb?: string;
  summary?: string;
}

/**
 * A game's browser tab / search result title, "Red Death Party - English localization
 * and QA | Roger Egito". The game comes first because that's the part a results page
 * truncates least, and the role is there so the result says what I did before anyone
 * clicks. Used by the game's page and by its dialog on the homepage, so the tab reads
 * the same either way.
 */
export const gameTitle = (game: GameText) =>
  `${plainText(game.title)} - ${rolesOf(game)} | ${site.title}`;

/**
 * A game's meta description. Its own `summary` when it has one, which the schema caps
 * at a length a results page shows in full. Otherwise one built from fields every game
 * already has, short enough not to need cutting.
 */
export const gameSummary = (game: GameText) => {
  if (game.summary) return game.summary;
  const roles = rolesOf(game);
  const lead = `${roles.charAt(0).toUpperCase()}${roles.slice(1)} on ${plainText(game.title)}.`;
  return game.blurb ? `${lead} ${game.blurb}` : lead;
};
