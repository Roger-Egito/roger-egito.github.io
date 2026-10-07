/**
 * The views Umami can't see on its own.
 *
 * Umami counts a page view on every load and every change to the address bar, so the
 * homepage, every game page and every game dialog (which puts /games/<slug>/ in the
 * address) are already covered. Two things never touch the address bar:
 *
 *   - The About dialog opens over the homepage without a URL of its own.
 *   - The CV is a PDF, and a PDF can't run a tracker.
 *
 * Both are sent here as page views with a path of their own, /about and the PDF's,
 * so they sit in the same Pages list as everything else instead of under events.
 *
 * Nothing here checks the no-track switch: umami.track does that itself, on every
 * call, so a browser switched off with ?no-track stays off for these too.
 *
 * What this can't cover: someone opening the CV's address directly, from a link
 * shared elsewhere, never loads a page with this script on it.
 */
export {};

type Umami = {
  track: (payload: (props: Record<string, unknown>) => Record<string, unknown>) => void;
};

/** Sends a page view for a path the address bar never shows. */
const view = (url: string, title: string) => {
  // Undefined when Umami was blocked or hasn't loaded, which costs one view, not a crash.
  const umami = (window as unknown as { umami?: Umami }).umami;
  umami?.track((props) => ({ ...props, url, title }));
};

/* --- the About dialog ------------------------------------------------------------ */

// Watched rather than hooked into modal.ts, so it counts however the dialog was opened:
// the nav, the name in the hero, or anything added later.
const about = document.querySelector<HTMLDialogElement>('#about-dialog');
if (about) {
  let wasOpen = about.open;
  new MutationObserver(() => {
    if (about.open && !wasOpen) view('/about', 'About');
    wasOpen = about.open;
  }).observe(about, { attributes: true, attributeFilter: ['open'] });
}

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
