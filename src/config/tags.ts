/**
 * Every tag a game is allowed to carry, and how each kind is presented.
 *
 * A game lists tags as plain lowercase strings in its front matter:
 *
 *     tags: [game designer, unity, ludomancer]
 *
 * Writing a tag that isn't registered here fails the build, naming the file and the
 * offending tag — see the check in src/content.config.ts. That's deliberate: a typo
 * should stop at your terminal rather than ship as a silently missing filter.
 *
 * Tags are written lowercase because the same words appear un-capitalised in the hero
 * credit ("game designer and game developer for Cursed Blight"). Everything on display
 * is Title Cased from here, so you never have to think about it — except for names
 * Title Case gets wrong, which set `label` explicitly.
 */

/** Where a category's icons sit, relative to the date on a portfolio card. */
type IconSide = 'left' | 'right' | 'none';

export interface Category {
  /** Singular, used as the label in a game's detail table. */
  label: string;
  /** Heading for the same row when a game has more than one. */
  plural: string;
  /**
   * Whether this category's tags show as icons beside a card's date, and which side of
   * it they sit on. Independent of `chips` below — a category can do both, either, or
   * neither.
   */
  icons: IconSide;
  /**
   * Whether this category's tags show as chips in the row under a card's text.
   *
   * Turning it off doesn't hide the tag anywhere else: it still appears in the game's
   * detail table, and still counts for filtering later. It only leaves the card's chip
   * row — worth doing for a category that already shows as an icon beside the date,
   * since otherwise the card says the same thing twice.
   */
  chips: boolean;
}

export interface Tag {
  category: CategoryId;
  /**
   * Overrides the automatic Title Case. Only needed where Title Case gets it wrong:
   * 'qa' would become "Qa", 'rpg maker vx ace' would become "Rpg Maker Vx Ace".
   */
  label?: string;
  /**
   * Either a Font Awesome name already registered in Icon.astro ('unity'), or a file
   * sitting in src/assets/tags/ ('ludomancer.svg'). Anything containing a dot is
   * treated as a filename. A tag with no icon still shows in the tag row as text.
   */
  icon?: string;
}

/* ---------------------------------------------------------------- categories --- */

export const categories = {
  role: { label: 'Role', plural: 'Roles', icons: 'none', chips: true },
  genre: { label: 'Genre', plural: 'Genres', icons: 'none', chips: false },
  // Set chips: false here and technologies become icons beside the date only, instead
  // of appearing a second time as chips underneath.
  technology: { label: 'Built with', plural: 'Built with', icons: 'right', chips: false },
  client: { label: 'Client', plural: 'Clients', icons: 'left', chips: false },
  generic: { label: 'Tag', plural: 'Tags', icons: 'none', chips: false },
} as const satisfies Record<string, Category>;

export type CategoryId = keyof typeof categories;

/**
 * Left to right on the card, and top to bottom in a game's detail table. Tags sort
 * alphabetically within each category; the categories themselves sort by this list.
 * Reorder here and every surface follows.
 */
export const categoryOrder: CategoryId[] = [
  'role',
  'genre',
  'technology',
  'client',
  'generic',
];

/* ---------------------------------------------------------------------- tags --- */

export const tags = {
  // roles
  'game designer': { category: 'role' },
  'game developer': { category: 'role' },
  'level designer': { category: 'role' },
  'solo developer': { category: 'role' },
  'art director': { category: 'role' },
  localization: { category: 'role' },
  qa: { category: 'role', label: 'QA' },

  // genres — taken from the wording of each game's own description
  horror: { category: 'genre' },
  tactics: { category: 'genre' },
  strategy: { category: 'genre' },
  'dungeon crawler': { category: 'genre' },
  stealth: { category: 'genre' },
  platformer: { category: 'genre' },
  merge: { category: 'genre' },
  multiplayer: { category: 'genre' },
  narrative: { category: 'genre' },

  // technologies
  unity: { category: 'technology', icon: 'unity' },
  python: { category: 'technology', icon: 'python' },
  pygame: { category: 'technology' },
  'rpg maker': { category: 'technology', label: 'RPG Maker VX Ace' },
  netcode: { category: 'technology', label: 'Netcode for GameObjects' },
  relay: { category: 'technology', label: 'Unity Relay' },

  // clients — drop a logo in src/assets/tags/ and name it here to get an icon
  ludomancer: { category: 'client', label: 'Ludomancer Studio' },
  yougo: { category: 'client', label: 'YouGo Games' },
  personal: { category: 'client', label: 'Personal Project' },
} as const satisfies Record<string, Tag>;

export type TagId = keyof typeof tags;

/* ------------------------------------------------------------------- helpers --- */

export const isTag = (name: string): name is TagId => name in tags;

/** Every registered name, for the error message when one doesn't match. */
export const knownTags = Object.keys(tags).sort();

/** 'game designer' -> 'Game Designer'. Hyphenated words capitalise on both sides. */
export const titleCase = (value: string) =>
  value.replace(/(^|[\s(/-])([a-z])/g, (_, before, letter) => before + letter.toUpperCase());

/** What a tag reads as on the page. */
export const labelOf = (name: TagId) => (tags[name] as Tag).label ?? titleCase(name);

export interface ResolvedTag {
  id: string;
  label: string;
  category: CategoryId;
  icon?: string;
  /** True when `icon` names a file rather than a Font Awesome glyph. */
  iconIsFile: boolean;
}

export const resolve = (name: TagId): ResolvedTag => {
  const tag = tags[name] as Tag;
  return {
    id: name,
    label: labelOf(name),
    category: tag.category,
    icon: tag.icon,
    iconIsFile: Boolean(tag.icon?.includes('.')),
  };
};

/**
 * Category order first, then alphabetical by display label inside each. Unknown names
 * are dropped rather than thrown on, because the build has already refused them by the
 * time anything renders — this only runs on data that passed the schema.
 */
export const sortTags = (names: readonly string[]): ResolvedTag[] =>
  names
    .filter(isTag)
    .map(resolve)
    .sort((a, b) => {
      const byCategory =
        categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
      return byCategory !== 0 ? byCategory : a.label.localeCompare(b.label);
    });

/** The tags of one category, in display order. */
export const tagsIn = (names: readonly string[], category: CategoryId) =>
  sortTags(names).filter((tag) => tag.category === category);

/** The tags belonging in a card's chip row, in display order. */
export const chipTags = (names: readonly string[]): ResolvedTag[] =>
  sortTags(names).filter((tag) => categories[tag.category].chips);

/** Tags that should show an icon on the given side of a card's date. */
export const iconsOn = (names: readonly string[], side: Exclude<IconSide, 'none'>) =>
  sortTags(names).filter((tag) => tag.icon && categories[tag.category].icons === side);

/**
 * "2024 – 2025", or just the one that's filled, or nothing at all. Accepts a year or
 * anything Date can parse, so `2024` and `2024-03-01` both render as 2024.
 */
export const yearRange = (start?: string | number, end?: string | number) => {
  const year = (value?: string | number) => {
    if (value === undefined || value === '') return undefined;
    const asNumber = Number(value);
    if (Number.isInteger(asNumber) && asNumber > 1000) return String(asNumber);
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? String(value) : String(parsed.getFullYear());
  };

  const from = year(start);
  const to = year(end);

  if (from && to) return from === to ? from : `${from} – ${to}`;
  return from ?? to ?? undefined;
};
