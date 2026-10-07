/**
 * Places a grid card's info panel as it opens: beside the card on whichever side has
 * room, or under it when neither does, and lifted when it would run off the bottom of
 * the screen. The opening itself is CSS (:hover and :focus-visible in GameCard.astro).
 *
 * The side is picked on the way in, from the panel's width, which CSS fixes even while
 * the panel is still display: none. The lift needs its height, which only exists once
 * it's open, so that waits a frame. The panel fades up from nothing, so that frame
 * isn't seen.
 */

const GAP = 12;
// The sticky navbar's height plus a little air: a lifted panel stops under it.
const TOP = 76;

function placePanel(card: HTMLElement) {
  const panel = card.querySelector<HTMLElement>('.details');
  if (!panel) return;

  // Read beside the card, since under it the panel takes the card's width instead.
  card.dataset.side = 'right';
  const width = parseFloat(getComputedStyle(panel).width);
  const box = card.getBoundingClientRect();
  const viewport = document.documentElement.clientWidth;

  if (box.right + GAP + width <= viewport) card.dataset.side = 'right';
  else if (box.left - GAP - width >= 0) card.dataset.side = 'left';
  else card.dataset.side = 'below';

  card.style.setProperty('--popup-lift', '0px');
  if (card.dataset.side === 'below') return;

  // Beside the card, the panel starts level with its top. If that runs it off the
  // bottom of the screen, it rides up, but never under the navbar.
  requestAnimationFrame(() => {
    const top = card.getBoundingClientRect().top;
    const overflow = top + panel.offsetHeight - (window.innerHeight - GAP);
    const lift = Math.max(0, Math.min(overflow, top - TOP));
    card.style.setProperty('--popup-lift', `${Math.round(lift)}px`);
  });
}

for (const card of document.querySelectorAll<HTMLElement>('.card[data-size="grid"]')) {
  card.addEventListener('pointerenter', () => placePanel(card));
  card.addEventListener('focusin', () => placePanel(card));
}
