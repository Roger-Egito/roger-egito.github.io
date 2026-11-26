/**
 * What the portfolio grid can be filtered by, worked out at build time.
 *
 * Every option here is a tag a game already carries, so nothing new has to be written
 * into an entry to make it filterable. The one exception is Status, which reads a
 * game's platform tags and answers a question the tags only imply: can I get this?
 *
 * The menus are built from the games that exist, so an option never appears unless at
 * least one game would come back when you pick it.
 */
import type { CollectionEntry } from 'astro:content';
import { categories, resolve, tagsIn, type CategoryId, type TagId } from './tags';
import { roleIds, roleLenses, rolesFor } from './roles';

type GameData = CollectionEntry<'games'>['data'];

/**
 * Filters that aren't tags, which no entry writes by hand. Released, and the three
 * roles the role pages open with (src/config/roles.ts). The roles sit in no menu: the
 * Roles menu already lists the titles they're made of, and the same name twice in one
 * menu would only confuse. They only ever appear as the chip a role page starts with.
 */
export const derivedFilters: Record<string, { label: string; category: CategoryId }> = {
  released: { label: 'Released', category: 'platform' },
  ...Object.fromEntries(roleIds.map((id) => [id, { label: roleLenses[id].label, category: 'role' as CategoryId }])),
};

/** The stores. A game on any of them is out in the world. */
const storeTags = ['steam', 'itch', 'google play'];

/**
 * Every filter id a game answers to: its own tags, plus Released when it's on a store,
 * plus each role page it belongs on. Status needs no ids of its own beyond that, since
 * private, in development and playable are already tags.
 */
export const filterIdsFor = (data: GameData): string[] => {
  const ids = [...data.tags];
  if (ids.some((tag) => storeTags.includes(tag))) ids.push('released');
  ids.push(...rolesFor(data.tags));
  return ids;
};

const plainText = (value: string) =>
  value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * What the search box looks through, kept in three parts because a hit on the name is
 * worth more than a hit on a tag, and the results are ordered by which one matched.
 *
 * Only what the card actually prints: the name, the blurb it shows, and the labels of
 * its tags. The long write-up is deliberately left out. Searching it would turn up
 * cards with nothing on them to show why, since a card doesn't carry that text.
 *
 * Labels rather than ids, so typing "itch.io" or "RPG Maker VX Ace" finds what's on
 * the page rather than what's in the front matter.
 */
export const searchPartsFor = (data: GameData, blurb: string) => ({
  title: plainText(data.title),
  blurb: plainText(blurb),
  tags: plainText(data.tags.map((tag) => resolve(tag as TagId).label).join(' ')),
});

export interface FilterOption {
  id: string;
  label: string;
  category: CategoryId;
  count: number;
}

export interface FilterGroup {
  label: string;
  options: FilterOption[];
}

export interface FilterMenu {
  id: string;
  label: string;
  /** Flat menus have options. Responsibilities has groups, one per discipline. */
  options?: FilterOption[];
  groups?: FilterGroup[];
}

/** The disciplines, in the order they read everywhere else. */
const disciplines: CategoryId[] = ['design', 'programming', 'art', 'audio', 'production'];

/** How many of these games carry a given filter. Shown beside each option. */
const counter = (games: CollectionEntry<'games'>[]) => {
  const counts = new Map<string, number>();
  for (const game of games) {
    for (const id of filterIdsFor(game.data)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
};

/**
 * The menus, left to right. Anything with a count of zero is dropped: an option that
 * can only ever empty the grid is a trap, not a filter.
 */
export const buildMenus = (games: CollectionEntry<'games'>[]): FilterMenu[] => {
  const counts = counter(games);
  const used = [...new Set(games.flatMap((game) => game.data.tags))];

  const optionsIn = (category: CategoryId): FilterOption[] =>
    tagsIn(used, category)
      .filter((tag) => (counts.get(tag.id) ?? 0) > 0)
      .map((tag) => ({
        id: tag.id,
        label: tag.label,
        category,
        count: counts.get(tag.id) ?? 0,
      }));

  const status: FilterOption[] = [
    { id: 'released', ...describeFilter('released') },
    { id: 'in development', label: 'In Development', category: 'platform' as CategoryId },
    { id: 'private', label: 'Private', category: 'platform' as CategoryId },
    { id: 'playable', label: 'Playable Here', category: 'feature' as CategoryId },
  ]
    .map((option) => ({ ...option, count: counts.get(option.id) ?? 0 }))
    .filter((option) => option.count > 0);

  const menus: FilterMenu[] = [
    { id: 'roles', label: 'Roles', options: optionsIn('role') },
    {
      id: 'responsibilities',
      label: 'Responsibilities',
      groups: disciplines
        .map((category) => ({ label: categories[category].label, options: optionsIn(category) }))
        .filter((group) => group.options.length > 0),
    },
    { id: 'genre', label: 'Genre', options: optionsIn('genre') },
    { id: 'status', label: 'Status', options: status },
    // Where it's published, as opposed to Status, which is whether it's out at all.
    {
      id: 'platform',
      label: 'Platform',
      options: optionsIn('platform').filter((option) => storeTags.includes(option.id)),
    },
    { id: 'technology', label: 'Technology', options: optionsIn('technology') },
    { id: 'clients', label: 'Clients', options: optionsIn('client') },
  ];

  return menus.filter((menu) => (menu.options?.length ?? 0) > 0 || (menu.groups?.length ?? 0) > 0);
};

/**
 * Label and category for any filter id, so a chip added by clicking a card knows what
 * to call itself and which color to wear.
 */
export const describeFilter = (id: string): { label: string; category: CategoryId } => {
  const derived = derivedFilters[id];
  if (derived) return derived;
  const tag = resolve(id as TagId);
  return { label: tag.label, category: tag.category };
};
