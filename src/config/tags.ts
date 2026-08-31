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
   * Either any Font Awesome free name ('unity', 'network-wired', 'dice'), or a file
   * sitting in src/assets/tags/ ('ludomancer.svg'). Anything containing a dot is
   * treated as a filename, which is why Font Awesome names never have one.
   *
   * Font Awesome names need no setting up — search https://fontawesome.com/search?m=free
   * and use the name as printed. A name that doesn't exist fails the build and suggests
   * the closest matches. A tag with no icon at all still shows in the chip row as text.
   */
  icon?: string;
}

/* ---------------------------------------------------------------- categories --- */

export const categories = {
  // Where you can actually get the thing, or that you can't. Shares the eyebrow's icon
  // row with technology and leads it, because "is this out?" comes before "what's it
  // built in?". No chip: each store already has its own line further down the card,
  // spelling out where it goes, so a chip repeating the name adds nothing.
  platform: { label: 'Platform', plural: 'Platforms', icons: 'right', chips: false },
  // Roles have their own line on a card, and the client sits in the eyebrow beside
  // the year — so neither repeats itself down in the chip row.
  role: { label: 'Role', plural: 'Roles', icons: 'none', chips: false },
  genre: { label: 'Genre', plural: 'Genres', icons: 'none', chips: true },
  // Deliberately in both places: an icon by the year for a quick read of the stack,
  // and a chip below for anyone actually reading the card.
  technology: { label: 'Built with', plural: 'Built with', icons: 'right', chips: true },
  // Shares the right-hand icon row with platform and technology. Where it lands in
  // that row is set by categoryOrder below, not here.
  client: { label: 'Client', plural: 'Clients', icons: 'right', chips: false },
  // What this site itself offers for a game, as opposed to what the game is or who it
  // was for. Icons only: a chip saying the same thing would sit in a row about the work
  // rather than about the portfolio, which is a different subject.
  feature: { label: 'Feature', plural: 'Features', icons: 'right', chips: false },
  generic: { label: 'Tag', plural: 'Tags', icons: 'none', chips: true },
} as const satisfies Record<string, Category>;

export type CategoryId = keyof typeof categories;

/**
 * Left to right on the card, and top to bottom in a game's detail table. Tags sort
 * alphabetically within each category; the categories themselves sort by this list.
 * Reorder here and every surface follows.
 */
export const categoryOrder: CategoryId[] = [
  'client',
  'platform',
  'role',
  'genre',
  'technology',
  // Last, so it lands as the rightmost icon beside the year — the closest thing to the
  // card's edge, where an offer to play something right now is worth the most.
  'feature',
  'generic',
];

/**
 * Heading over a card's chip row.
 *
 * The row is deliberately mixed — platform, genre, technology, and whatever else earns
 * a chip — so neither "Stack" nor "Responsibilities" covers it: each names about a
 * third of what's there. Something broad is the honest label while one row holds all
 * of it. Split the row by category and each group can take its own `plural` instead.
 */
export const chipsHeading = 'Highlights';

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

  // platforms — where it's published, or that it isn't
  steam: { category: 'platform', icon: 'steam' },
  itch: { category: 'platform', label: 'itch.io', icon: 'itch-io' },
  'google play': { category: 'platform', icon: 'google-play' },
  private: { category: 'platform', icon: 'lock' },

  // technologies
  unity: { category: 'technology', icon: 'unity' },
  python: { category: 'technology', icon: 'python' },
  pygame: { category: 'technology' },
  'rpg maker': { category: 'technology', label: 'RPG Maker VX Ace', icon: 'rpg-maker-vx-ace.png' },
  netcode: { category: 'technology', label: 'Netcode for GameObjects', icon: 'network-wired' },
  relay: { category: 'technology', label: 'Unity Relay' },

  // features — what this site offers for the game, rather than anything about the game
  // itself. Only add this to an entry that actually carries a `game:` embed, since it's
  // promising something the page has to deliver.
  playable: {
    category: 'feature',
    label: 'Playable in the portfolio',
    icon: 'gamepad',
  },

  // clients — drop a logo in src/assets/tags/ and name it here to get an icon
  // ludomancer-full.png is the same logo with its "LUDOMANCER STUDIO" banner still
  // attached; swap the name here if you prefer it. Two lines of type do not survive
  // being 16px tall, which is why the mark is the one wired up.
  ludomancer: { category: 'client', label: 'Ludomancer Studio', icon: 'ludomancer-mark.png' },
  yougo: { category: 'client', label: 'YouGo Games', icon: 'yougogames.png' },
  // Your own face, since on a personal project you are the client.
  personal: { category: 'client', label: 'Personal Project', icon: 'profile.webp' },
} as const satisfies Record<string, Tag>;

export type TagId = keyof typeof tags;

/* -------------------------------------------------------------------- stores --- */

/**
 * The storefronts a game can link to, top to bottom as they list on a card.
 *
 * Each one borrows its name and icon from a platform tag above, so a store row and the
 * icon beside the year can't drift apart — rename `steam`'s label there and both follow.
 * The `field` is the front matter key a game puts the link in.
 */
export const stores = [
  { field: 'urlSteam', tag: 'steam' },
  { field: 'urlItchIo', tag: 'itch' },
  { field: 'urlGooglePlay', tag: 'google play' },
] as const satisfies readonly { field: string; tag: TagId }[];

export type StoreField = (typeof stores)[number]['field'];

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
