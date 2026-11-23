/**
 * The views the tracker can't see on its own.
 *
 * The tracker counts a page view on every load and every change to the address bar, so the
 * homepage, every page, every game dialog (which puts /games/<slug>/ in the address) and
 * the About dialog (/about/) are already covered. One thing never touches the address
 * bar: the CV, a PDF, which can't run a tracker. It's sent here as a page view with the
 * PDF's path, so it sits in the same Pages list as everything else.
 *
 * Nothing here checks the no-track switch: the tracker does that itself, on every
 * send, so a browser switched with ?no-track is flagged as mine for these too.
 *
 * What this can't cover: someone opening the CV's address directly, from a link
 * shared elsewhere, never loads a page with this script on it.
 */
import { pageview } from './tracker';

/** Sends a page view for a path the address bar never shows. */
const view = (url: string, title: string) => pageview(url, title);

/* --- the CV ---------------------------------------------------------------------- */

// click covers a normal click and ctrl/cmd-click; auxclick covers the middle button,
// the usual way to open a document in a new tab.
const onDocumentLink = (event: MouseEvent) => {
  if (event.type === 'auxclick' && event.button !== 1) return;
  const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href$=".pdf"]');
  if (!link) return;
  view(new URL(link.href).pathname, link.textContent?.trim() || 'CV');
};

document.addEventListener('click', onDocumentLink);
document.addEventListener('auxclick', onDocumentLink);
