/**
 * Starts and stops a game's preview clip so it tracks the card's hover state exactly.
 *
 * The cross-fade itself is CSS, keyed off the same :hover / :focus-visible that scales
 * the card up, so the clip and the zoom can never get out of sync. All this file does
 * is load the clip the first time it's needed and keep playback in step:
 *
 *   pointer enters or card is focused -> play
 *   mouse leaves, card is blurred, or
 *   a touch lands somewhere else      -> pause and rewind
 *
 * On a touch screen the browser keeps :hover on a card after you lift your finger and
 * only drops it when you touch something else, so pausing is driven by that instead of
 * by touchend.
 *
 * The clip's URL sits in data-src rather than src so nothing downloads until someone
 * actually interacts with the card.
 */

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

const clipIn = (card: Element) => card.querySelector<HTMLVideoElement>('video[data-src]');

function play(video: HTMLVideoElement) {
  // Someone who's asked for less motion gets the still image and no download.
  if (REDUCED_MOTION.matches) return;

  if (!video.getAttribute('src')) {
    const src = video.dataset.src;
    if (!src) return;
    video.src = src;
  }
  // Muted playback is allowed without a user gesture; if it's refused anyway the
  // still stays put underneath, so there's nothing to undo.
  video.play().catch(() => {});
}

function pause(video: HTMLVideoElement) {
  video.pause();
  video.currentTime = 0;
}

function wire(card: HTMLElement) {
  const video = clipIn(card);
  if (!video) return;

  // pointerenter covers mouse, pen and the first touch on a card.
  card.addEventListener('pointerenter', () => play(video));
  card.addEventListener('focus', () => play(video));

  // For a mouse, leaving is exactly when :hover ends. For touch, pointerleave fires
  // as soon as the finger lifts even though :hover stays on, so it's ignored here and
  // handled by the document listener below.
  card.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'touch') return;
    pause(video);
  });
  card.addEventListener('blur', () => pause(video));
}

// Touching anywhere else is what clears the sticky hover on a touch screen, so that's
// the moment any playing clip should stop. Registered once, not per card.
document.addEventListener('pointerdown', (event) => {
  const target = event.target as Node | null;
  for (const card of document.querySelectorAll<HTMLElement>('.card.has-preview')) {
    if (target && card.contains(target)) continue;
    const video = clipIn(card);
    if (video) pause(video);
  }
});

// Deferred module, so the cards are already in the document.
document.querySelectorAll<HTMLElement>('.card').forEach(wire);
