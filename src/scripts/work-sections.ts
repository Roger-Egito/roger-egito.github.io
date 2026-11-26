/**
 * Which sections of a game's write-up start open (src/components/mdx/Work.astro).
 *
 * A visitor who came from a role page sees the work they came for: a card on /designer/
 * links to /games/<slug>/#designer, and only that section stays open. Anyone else, from
 * the homepage, a search result or a shared link, gets every section open, which is
 * also how the page is served, so nothing changes for them and nothing depends on this
 * script running.
 *
 * modal.ts calls showWork() when it opens a game's dialog, and this file does the same
 * for a game's own page when it loads with a role in its address.
 */

/**
 * Opens only the section named by `role` inside `root`, or every section when `role`
 * names none of them (or isn't given). A game the role doesn't cover still opens whole,
 * rather than with everything shut.
 */
export function showWork(root: ParentNode, role?: string) {
  const sections = [...root.querySelectorAll<HTMLDetailsElement>('details[data-work]')];
  const target = role ? sections.find((section) => section.dataset.work === role) : undefined;
  for (const section of sections) section.open = !target || section === target;
}

// A game's own page. The homepage keeps its sections inside dialogs, which modal.ts
// handles as each one opens, and its only hash is #portfolio, which names no section.
const role = location.hash.slice(1);
if (role && !document.querySelector('dialog[data-url]')) showWork(document, role);
