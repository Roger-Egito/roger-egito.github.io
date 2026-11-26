/**
 * The role pages, /designer/, /developer/ and /writer/, and the sections a game's
 * write-up is split into.
 *
 * Each CV links to the page for its role. A role page is the homepage grid with one
 * filter already on: the role itself, as a single chip the visitor can take off to see
 * everything. So a role here is a filter like Released in filters.ts, worked out from
 * tags a game already carries rather than written into each entry.
 *
 * The same ids name the sections of a game's write-up (src/components/mdx/Work.astro),
 * so a card on /designer/ can open its game at the Game Design Work section, and
 * checkWork() below makes sure that section is there to open.
 */
import type { CollectionEntry } from 'astro:content';
import { isTag, type TagId } from './tags';

export interface RoleLens {
  /** The chip's text. Kept apart from the role tags' labels ("Game Designer"), so the two never read the same when both are on. */
  label: string;
  /** The browser tab and search result title: "Roger Egito - <title>". */
  title: string;
  /** The page's search result line and link preview text. */
  description: string;
  /** A game is on the page when it carries any of these. */
  anyOf: readonly TagId[];
}

export const roleLenses = {
  designer: {
    label: 'Designer',
    title: 'Game Designer Portfolio',
    description:
      'Games Roger Egito designed: systems, levels, encounters and narrative design, for ' +
      'studios, clients and his own projects.',
    anyOf: ['game designer', 'level designer', 'narrative design'],
  },
  developer: {
    label: 'Developer',
    title: 'Game Developer Portfolio',
    description:
      'Games Roger Egito programmed in Unity and Python: gameplay, UI, networking and AI, ' +
      'for studios, clients and his own projects.',
    anyOf: ['game developer', 'programmer', 'solo developer'],
  },
  writer: {
    label: 'Writer',
    title: 'Narrative Writer Portfolio',
    description:
      'Games Roger Egito wrote for and localized: lore, dialogue, narrative design and ' +
      'English localization.',
    anyOf: ['narrative design', 'narrative writing', 'dialogue writing', 'english localization'],
  },
} as const satisfies Record<string, RoleLens>;

export type RoleId = keyof typeof roleLenses;

export const roleIds = Object.keys(roleLenses) as RoleId[];

export const isRole = (value: string): value is RoleId => value in roleLenses;

// A role id goes into the address bar as a filter (?f=designer), next to tag ids. One
// that was also a tag would be two filters answering to the same name.
for (const id of roleIds) {
  if (isTag(id)) {
    throw new Error(`The role "${id}" in src/config/roles.ts has the same name as a tag. Rename one of them.`);
  }
}

/** The roles whose page a game appears on. */
export const rolesFor = (tags: readonly string[]): RoleId[] =>
  roleIds.filter((id) => roleLenses[id].anyOf.some((tag) => tags.includes(tag)));

/**
 * The sections a write-up can have, top to bottom in this order. One per role, plus
 * Other Work for what fits none of them: trailers, art, audio, QA, project management.
 */
export const workSections = {
  designer: 'Game Design Work',
  developer: 'Game Development Work',
  writer: 'Writing & Localization Work',
  other: 'Other Work',
} as const satisfies Record<RoleId | 'other', string>;

export type WorkId = keyof typeof workSections;

/** The sections a game's .mdx body opens, read off its <Work section="..."> tags. */
export const workIn = (body = ''): string[] =>
  [...body.matchAll(/<Work\s+section=["']([^"']+)["']/g)].map((match) => match[1]);

/**
 * Stops the build when a role page would link a card to a section its game doesn't
 * have, or when a game names a section that doesn't exist. A section without its role
 * page is fine: All Stars Merge has design work worth telling without being a
 * design-led game.
 *
 * Also stops it when a role page would come out empty, which only happens if every
 * tag in its anyOf has left the games.
 */
export const checkWork = (games: CollectionEntry<'games'>[]) => {
  const problems: string[] = [];

  for (const game of games) {
    const sections = workIn(game.body);
    for (const name of sections) {
      if (!(name in workSections)) {
        problems.push(`${game.id}: <Work section="${name}"> isn't a section. Use one of ${Object.keys(workSections).join(', ')}.`);
      }
    }
    for (const role of rolesFor(game.data.tags)) {
      if (!sections.includes(role)) {
        problems.push(
          `${game.id}: it's on /${role}/ but has no <Work section="${role}"> section, so the card there would open nothing.`
        );
      }
    }
  }

  for (const role of roleIds) {
    if (!games.some((game) => rolesFor(game.data.tags).includes(role))) {
      problems.push(`/${role}/ would be empty: no game carries any of ${roleLenses[role].anyOf.join(', ')}.`);
    }
  }

  if (problems.length > 0) throw new Error(`Role pages:\n  ${problems.join('\n  ')}`);
};
