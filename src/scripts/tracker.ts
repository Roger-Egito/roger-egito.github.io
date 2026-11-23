/**
 * Counts visits, for the site's own collector (collector/ in this repo, a Cloudflare
 * Worker). Replaces Umami's script, and sends what it sent, plus one thing it couldn't:
 * when a visitor leaves a page, so the last page of a visit has a time too.
 *
 *   - a pageview on load, and again whenever the address changes without a reload
 *     (a game dialog puts /games/<slug>/ in the bar, the filters write ?f= and ?q=)
 *   - a click on anything with data-event="name", with each data-event-* attribute as
 *     a property: data-event="store-click" data-event-game="hotel-77"
 *   - a leave when the page is hidden or closed
 *
 * Nothing is stored on the visitor's device and no cookie is set: the collector tells
 * visitors apart by a monthly-salted hash it works out itself.
 *
 * Sent with navigator.sendBeacon as plain text: the browser delivers it even while the
 * page is unloading, and plain text needs no CORS preflight. So a click on a link that
 * leaves the site is still counted, without holding the navigation back the way
 * Umami's script did.
 *
 * Sends everything, flagged when it isn't an ordinary visitor, so the dashboard filters
 * it rather than never seeing it:
 *   - me: this browser was switched with ?no-track (the umami.disabled key, kept by
 *     name so the browsers switched before the collector stay switched). Also while
 *     the switch's password is still being asked for, so the visit carrying the link
 *     is marked whatever the answer.
 *   - webdriver: the browser is under automation
 *   - no-screen: it reports no screen, which is how headless bots give themselves away
 *
 * Sends nothing at all when the page isn't on the live site, so working on it locally
 * stays out of the data.
 */
import { site } from '../config/site';

const endpoint = site.analytics.collector ? `${site.analytics.collector}/e` : '';
const liveHost = new URL(site.url).hostname;

function switched() {
  try {
    return Boolean(localStorage.getItem('umami.disabled'));
  } catch {
    // Storage blocked: there's no switch to read, so it can't be on.
    return false;
  }
}

/** What this browser is, when it isn't an ordinary visitor's. Read on every send. */
const flag = () =>
  switched() ? 'me' : navigator.webdriver ? 'webdriver' : !screen.width || !screen.height ? 'no-screen' : undefined;

const silent = () => !endpoint || location.hostname !== liveHost;

type Body = {
  type: 'pageview' | 'event' | 'leave';
  url?: string;
  title?: string;
  name?: string;
  data?: Record<string, string>;
};

/** Where the visitor came from: the outside page for the first view, then the last page here. */
let referrer = document.referrer;

function send(body: Body) {
  if (silent()) return;
  const full = {
    url: location.href,
    title: document.title,
    referrer,
    screen: `${screen.width}x${screen.height}`,
    language: navigator.language,
    flag: flag(),
    ...body,
  };
  navigator.sendBeacon(endpoint, new Blob([JSON.stringify(full)], { type: 'text/plain' }));
}

/**
 * A pageview, for the page as it is or for one the address bar never shows (the About
 * dialog, the CV). analytics.ts sends those.
 */
export function pageview(path?: string, title?: string) {
  // Left out rather than set to undefined, which would wipe out the page's own values.
  send({
    type: 'pageview',
    ...(path ? { url: new URL(path, location.origin).href } : {}),
    ...(title ? { title } : {}),
  });
}

/** A named event with properties: track('store-click', { game: 'hotel-77' }). */
export function track(name: string, data: Record<string, string> = {}) {
  send({ type: 'event', name, data });
}

/* --- pageviews ------------------------------------------------------------------- */

const here = () => location.pathname + location.search + location.hash;
let last = here();
pageview();

// The address changing without a reload is a new view, the same as Umami counted it.
const watch = (method: 'pushState' | 'replaceState') => {
  const original = history[method].bind(history);
  history[method] = (...args: Parameters<History['pushState']>) => {
    original(...args);
    changed();
  };
};

function changed() {
  const now = here();
  if (now === last) return;
  referrer = location.origin + last;
  last = now;
  pageview();
}

watch('pushState');
watch('replaceState');
window.addEventListener('popstate', changed);

/* --- clicks ---------------------------------------------------------------------- */

document.addEventListener(
  'click',
  (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>('[data-event]');
    if (!target) return;
    const data: Record<string, string> = {};
    for (const attribute of target.getAttributeNames()) {
      const key = attribute.match(/^data-event-(.+)$/)?.[1];
      if (key) data[key] = target.getAttribute(attribute) ?? '';
    }
    track(target.dataset.event!, data);
  },
  // Capture, so the click is counted even when another handler stops it from bubbling.
  true
);

/* --- leaving ---------------------------------------------------------------------- */

// Hidden covers switching tabs, closing the tab and going to another app on a phone.
// pagehide covers the rest of closing and leaving. Once per hiding, so a tab that's
// closed while hidden doesn't send it twice.
let hidden = false;
const leave = () => {
  if (hidden) return;
  hidden = true;
  send({ type: 'leave' });
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') leave();
  else hidden = false;
});
window.addEventListener('pagehide', leave);
