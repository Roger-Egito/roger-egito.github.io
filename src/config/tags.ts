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
   * it they sit on.
   */
  icons: IconSide;
  /**
   * Responsibilities only. A Font Awesome free name, shown inside every one of this
   * discipline's chips on a card. It stands in for the word the chip drops, which is
   * why design and programming need theirs most.
   */
  chipIcon?: string;
}

export interface Tag {
  category: CategoryId;
  /**
   * Overrides the automatic Title Case. Only needed where Title Case gets it wrong:
   * 'ui programming' would become "Ui Programming", 'rpg maker vx ace' would become
   * "Rpg Maker Vx Ace".
   */
  label?: string;
  /**
   * Either any Font Awesome free name ('unity', 'network-wired', 'dice'), or a file
   * sitting in src/assets/tags/ ('ludomancer.svg'). Anything containing a dot is
   * treated as a filename, which is why Font Awesome names never have one.
   *
   * Font Awesome names need no setting up. Search https://fontawesome.com/search?m=free
   * and use the name as printed. A name that doesn't exist fails the build and suggests
   * the closest matches. A tag with no icon at all simply shows as text.
   */
  icon?: string;
  /**
   * Roles only. How the title reads once a game marks it sole, when the plain label
   * says too much next to the prefix: "Sole Designer" rather than "Sole Game
   * Designer". Left off, the prefix goes on the normal label.
   */
  soleLabel?: string;
}

/* ---------------------------------------------------------------- categories --- */

export const categories = {
  // Where you can actually get the thing, or that you can't. Shares the eyebrow's icon
  // row with technology and leads it, because "is this out?" comes before "what's it
  // built in?".
  platform: { label: 'Platform', plural: 'Platforms', icons: 'right' },
  role: { label: 'Role', plural: 'Roles', icons: 'none' },
  genre: { label: 'Genre', plural: 'Genres', icons: 'none' },
  // Icons by the year for a quick read of the stack.
  technology: { label: 'Built with', plural: 'Built with', icons: 'right' },
  // Shares the right-hand icon row with platform and technology. Where it lands in
  // that row is set by categoryOrder below, not here.
  client: { label: 'Client', plural: 'Clients', icons: 'right' },
  // What this site itself offers for a game, as opposed to what the game is or who it
  // was for.
  feature: { label: 'Feature', plural: 'Features', icons: 'right' },
  generic: { label: 'Tag', plural: 'Tags', icons: 'none' },

  // Responsibilities: what I did on a game, grouped into five disciplines. Roles above
  // are the titles I held, these are the work behind them. Each discipline is a labeled
  // group of chips on a card and a line on a game's page. The groups are broad on
  // purpose: writing counts as design, software engineering as programming, and
  // marketing, localization, QA and content as production. The label doubles as the
  // plural since a discipline reads the same either way.
  // chipIcon is the mark each discipline wears on a card. Not pen-ruler for design:
  // that one already sits on the roles line right above, where it means something else.
  design: { label: 'Design', plural: 'Design', icons: 'none', chipIcon: 'compass-drafting' },
  programming: { label: 'Programming', plural: 'Programming', icons: 'none', chipIcon: 'code' },
  art: { label: 'Art', plural: 'Art', icons: 'none', chipIcon: 'palette' },
  audio: { label: 'Audio', plural: 'Audio', icons: 'none', chipIcon: 'volume-high' },
  production: { label: 'Production', plural: 'Production', icons: 'none', chipIcon: 'clipboard-list' },
} as const satisfies Record<string, Category>;

export type CategoryId = keyof typeof categories;

/** The responsibility disciplines, in the order they read everywhere. */
const responsibilities: CategoryId[] = ['design', 'programming', 'art', 'audio', 'production'];

/**
 * Left to right on the card, and top to bottom in a game's detail table. Tags sort
 * alphabetically within each category, and the categories themselves sort by this
 * list. Reorder here and every surface follows.
 */
export const categoryOrder: CategoryId[] = [
  'client',
  'platform',
  'role',
  // Right under Roles on a game's page, so the titles read first and the work that
  // backs them up follows straight after.
  ...responsibilities,
  'genre',
  'technology',
  // Last, so it lands as the rightmost icon beside the year, the closest thing to the
  // card's edge, where an offer to play something right now is worth the most.
  'feature',
  'generic',
];


/* ---------------------------------------------------------------------- tags --- */

export const tags = {
  // roles: job titles, the way a credits screen would list them. The activity behind
  // a title lives in the responsibilities below, and a game lists both.
  'game designer': { category: 'role', soleLabel: 'Designer' },
  'game developer': { category: 'role' },
  // Separate from "game developer" because that one reads as "made the game", which
  // contradicts a team size above 1 once it's marked sole. "Programmer" can't.
  programmer: { category: 'role' },
  'level designer': { category: 'role' },
  'solo developer': { category: 'role' },
  'art director': { category: 'role' },
  'english localizer': { category: 'role' },
  'project lead': { category: 'role' },
  'quality assurance': { category: 'role' },

  // responsibilities. A database of everything I might have done, so most of these
  // sit unused until a game needs one. Where two names meant the same thing, only
  // one is kept: Testing over Quality Assurance, Gameplay Programming over Game
  // Programming, Network Programming over Multiplayer Programming, Shader
  // Programming and Technical Art over Shaders, and Creative Direction over Game
  // Direction.

  // design
  'combat design': { category: 'design' },
  'content design': { category: 'design' },
  'economy design': { category: 'design' },
  'encounter design': { category: 'design' },
  'game design direction': { category: 'design' },
  'interaction design': { category: 'design' },
  'level design': { category: 'design' },
  'mission design': { category: 'design' },
  'monetization design': { category: 'design' },
  'multiplayer design': { category: 'design' },
  'narrative design': { category: 'design' },
  'progression design': { category: 'design' },
  'puzzle design': { category: 'design' },
  'quest design': { category: 'design' },
  'systems design': { category: 'design' },
  'ui/ux design': { category: 'design', label: 'UI/UX Design' },

  // design: writing
  'dialogue writing': { category: 'design' },
  // Just "Writing" because it sits under the Design heading, where a bare "Narrative"
  // already means narrative design. The full name would read as a repeat.
  'narrative writing': { category: 'design', label: 'Writing' },
  'quest writing': { category: 'design' },
  'script editing': { category: 'design' },
  scriptwriting: { category: 'design' },
  worldbuilding: { category: 'design' },

  // programming
  'ai programming': { category: 'programming', label: 'AI Programming' },
  'game engine development': { category: 'programming' },
  'gameplay programming': { category: 'programming' },
  'graphics & rendering': { category: 'programming' },
  'network programming': { category: 'programming' },
  'physics programming': { category: 'programming' },
  'porting & platform adaptation': { category: 'programming' },
  'programming direction': { category: 'programming' },
  'shader programming': { category: 'programming' },
  'tools programming': { category: 'programming' },
  'ui programming': { category: 'programming', label: 'UI Programming' },
  'vfx programming': { category: 'programming', label: 'VFX Programming' },

  // art
  '2d art': { category: 'art', label: '2D Art' },
  '3d art': { category: 'art', label: '3D Art' },
  '3d modeling': { category: 'art', label: '3D Modeling' },
  'art direction': { category: 'art' },
  'character art': { category: 'art' },
  'concept art': { category: 'art' },
  'environment art': { category: 'art' },
  'marketing art': { category: 'art' },
  'material creation': { category: 'art' },
  storyboarding: { category: 'art' },
  'technical art': { category: 'art' },
  'texture art': { category: 'art' },
  'ui art': { category: 'art', label: 'UI Art' },
  'vehicle art': { category: 'art' },
  'vfx art': { category: 'art', label: 'VFX Art' },
  'weapon art': { category: 'art' },

  // audio
  'audio editing': { category: 'audio' },
  'audio implementation': { category: 'audio' },
  'music editing': { category: 'audio' },
  'sound design': { category: 'audio' },
  'voice direction': { category: 'audio' },
  'voice editing': { category: 'audio' },

  // production: marketing
  'trailer production': { category: 'production' },

  // production
  'creative direction': { category: 'production' },
  'project management': { category: 'production' },
  'release management': { category: 'production' },

  // production: quality assurance
  testing: { category: 'production' },

  // production: localization
  'english localization': { category: 'production' },
  'portuguese localization': { category: 'production' },

  // production: content
  'livestream production': { category: 'production' },
  'social media content': { category: 'production' },
  'video content creation': { category: 'production' },

  // programming: software engineering
  'ai engineering': { category: 'programming', label: 'AI Engineering' },
  'backend development': { category: 'programming' },
  'cloud engineering': { category: 'programming' },
  'data analytics': { category: 'programming' },
  devops: { category: 'programming', label: 'DevOps' },
  'frontend development': { category: 'programming' },
  'full-stack development': { category: 'programming' },
  'mobile development': { category: 'programming' },
  'network engineering': { category: 'programming' },
  'security engineering': { category: 'programming' },

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
  educational: { category: 'genre' },
  vr: { category: 'genre', label: 'VR' },

  // platforms — where it's published, or that it isn't
  steam: { category: 'platform', icon: 'steam' },
  itch: { category: 'platform', label: 'itch.io', icon: 'itch-io' },
  'google play': { category: 'platform', icon: 'google-play' },
  private: { category: 'platform', icon: 'lock' },
  // Still being made, so there's nothing to get yet, as opposed to finished but kept
  // private.
  'in development': { category: 'platform', icon: 'person-digging' },

  // technologies
  unity: { category: 'technology', icon: 'unity' },
  python: { category: 'technology', icon: 'python' },
  pygame: { category: 'technology' },
  'rpg maker': { category: 'technology', label: 'RPG Maker VX Ace', icon: 'rpg-maker-vx-ace.png' },
  netcode: { category: 'technology', label: 'Netcode for GameObjects', icon: 'network-wired' },
  relay: { category: 'technology', label: 'Unity Relay' },
  'xr interaction toolkit': { category: 'technology', label: 'XR Interaction Toolkit' },
  fmod: { category: 'technology', label: 'FMOD' },

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
  uff: { category: 'client', label: 'UFF' },
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
  soleLabel?: string;
}

export const resolve = (name: TagId): ResolvedTag => {
  const tag = tags[name] as Tag;
  return {
    id: name,
    label: labelOf(name),
    category: tag.category,
    icon: tag.icon,
    iconIsFile: Boolean(tag.icon?.includes('.')),
    soleLabel: tag.soleLabel,
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

/**
 * The two disciplines whose word would otherwise repeat down the whole line: eight
 * chips each ending in "Design", three ending in "Programming". Their icon says which
 * one it is instead. The other three read fine as they are, since "Art Direction" and
 * "Trailer Production" aren't the same word twice.
 */
const dropsGroupWord: CategoryId[] = ['design', 'programming'];

/**
 * A chip's label with its discipline's own word taken off: "Level Design" under Design
 * reads "Level". Only a first or last word goes, because one in the middle is part of a
 * different job: "Game Design Direction" minus "Design" would read "Game Direction".
 */
const withoutGroupWord = (label: string, group: string) => {
  const words = label.split(' ');
  if (words.length > 1 && words.at(-1) === group) return words.slice(0, -1).join(' ');
  if (words.length > 1 && words[0] === group) return words.slice(1).join(' ');
  return label;
};

/**
 * What I did on a game, as the card shows it: every discipline's tags on one wrapping
 * line, in discipline order. Each chip carries its discipline's icon and colour, so
 * design and programming can drop the word itself. A game's own page still lists the
 * same tags in full, split by category.
 */
export const responsibilityChipsIn = (names: readonly string[]) =>
  responsibilities.flatMap((category) => {
    const { label, chipIcon } = categories[category];
    return tagsIn(names, category).map((tag) => ({
      ...tag,
      label: dropsGroupWord.includes(category) ? withoutGroupWord(tag.label, label) : tag.label,
      chipIcon,
    }));
  });

/**
 * A game's role titles as they read on the page. The ones it held alone come first,
 * marked "Sole", since they're the strongest claim on the line. The schema checks that
 * every entry in `sole` is one of the game's own role tags, so nothing here has to
 * guard against a stray name.
 */
export const creditsFor = (names: readonly string[], sole: readonly string[] = []) =>
  tagsIn(names, 'role')
    .map((tag) => ({ tag, held: sole.includes(tag.id) }))
    .sort((a, b) => Number(b.held) - Number(a.held))
    .map(({ tag, held }) => (held ? `Sole ${tag.soleLabel ?? tag.label}` : tag.label));

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
