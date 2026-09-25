/**
 * On a touch screen, a trailer goes fullscreen as soon as it starts playing.
 *
 * iPhone needs none of this. YouTube's embed already plays fullscreen there by default,
 * and iPhone Safari won't make anything else fullscreen anyway. This is for Android,
 * where the embed plays small, inline in the page.
 *
 * Fullscreen is only allowed right after the visitor does something. The tap on Play
 * lands inside YouTube's frame, not on this page, but the HTML spec still counts it for
 * the page around the frame, for a few seconds. So the request has to go out as soon as
 * the player says it has started, which it tells us over postMessage, the same channel
 * game-tabs.ts uses to pause it.
 *
 * If YouTube ever changes that channel, the messages stop arriving and the trailer
 * simply plays inline as before. Nothing breaks.
 */

// Makes this file a module, so its names stay its own rather than joining the shared
// global scope TypeScript gives files with no import or export.
export {};

const touch = matchMedia('(pointer: coarse)');

// A YouTube player reports nothing about itself until it's asked to.
const LISTEN = JSON.stringify({ event: 'listening', id: 1, channel: 'widget' });

// YouTube's player states: 1 is playing, 3 is buffering on the way to playing.
const STARTING = new Set([1, 3]);

const trailers = () => document.querySelectorAll<HTMLIFrameElement>('iframe[data-trailer]');

// A trailer that finished loading before this script ran has already fired its load
// event, so every trailer is asked once now as well. Asking one that isn't ready yet
// goes unheard, and it's asked again when it loads.
for (const frame of trailers()) {
  if (frame.getAttribute('src')) frame.contentWindow?.postMessage(LISTEN, '*');
}

// Trailers get their src late (a dialog fills it in on open, a tab on switch), so each
// one is asked to report once it has actually loaded. load doesn't bubble, hence the
// capture phase.
document.addEventListener(
  'load',
  (event) => {
    const frame = event.target;
    if (frame instanceof HTMLIFrameElement && frame.matches('iframe[data-trailer]')) {
      frame.contentWindow?.postMessage(LISTEN, '*');
    }
  },
  true
);

// The last state each player reported. Fullscreen happens on the change into playing,
// not on every report: YouTube repeats "playing" several times a second, and acting on
// each one would drag someone straight back in after they chose to leave fullscreen.
const lastState = new Map<MessageEventSource, number>();

window.addEventListener('message', (event) => {
  if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(event.origin) || !event.source) return;

  let data: { event?: string; info?: number | { playerState?: number } };
  try {
    data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  } catch {
    return;
  }

  const state =
    data?.event === 'onStateChange' && typeof data.info === 'number'
      ? data.info
      : data?.event === 'infoDelivery' && typeof data.info === 'object'
        ? data.info?.playerState
        : undefined;
  if (state === undefined) return;

  const was = lastState.get(event.source);
  lastState.set(event.source, state);
  if (!STARTING.has(state) || (was !== undefined && STARTING.has(was))) return;

  if (!touch.matches || document.fullscreenElement) return;
  const frame = [...trailers()].find((f) => f.contentWindow === event.source);
  // Optional call: iPhone Safari has no requestFullscreen on an iframe, and doesn't need one.
  frame?.requestFullscreen?.().catch(() => {});
});
