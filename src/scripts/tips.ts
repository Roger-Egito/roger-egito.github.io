/**
 * The hover labels on the hero's controls.
 *
 * One shared element rather than a ::after on each button, for two reasons: it can sit
 * above the pointer and follow it, which a pseudo-element anchored to its button can't
 * do; and living in the top layer it can't be clipped by the hero's overflow or lose a
 * stacking-context argument with the video underneath.
 */

// Offset from the pointer, up and to the right, the way an item tooltip sits in a
// game — beside the cursor rather than centred over it, so it never hides what you're
// pointing at.
const OFFSET_X = 18;
const OFFSET_Y = 3;

const tip = document.createElement('div');
tip.className = 'tip';
tip.setAttribute('role', 'status');
document.body.append(tip);

// Top layer, so nothing on the page can paint over it or crop it.
tip.popover = 'manual';

let showing: HTMLElement | null = null;

function place(x: number, y: number) {
  const box = tip.getBoundingClientRect();

  // Flips to the other side of the pointer rather than sliding along the edge, so it
  // never ends up sitting under the cursor near the corners of the window.
  let left = x + OFFSET_X;
  if (left + box.width > innerWidth - 8) left = x - box.width - OFFSET_X;

  let top = y - box.height - OFFSET_Y;
  if (top < 8) top = y + OFFSET_Y; // no room above, so it drops below instead

  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}

function show(target: HTMLElement, x: number, y: number) {
  showing = target;
  tip.textContent = target.dataset.tip ?? '';
  tip.showPopover?.();
  tip.dataset.on = '';
  place(x, y);
}

function hide() {
  showing = null;
  delete tip.dataset.on;
  tip.hidePopover?.();
}

document.addEventListener('pointerover', (event) => {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]');
  // A touch has no hovering pointer to put a label above, so it's left alone.
  if (!target || event.pointerType === 'touch') return;
  show(target, event.clientX, event.clientY);
});

document.addEventListener('pointermove', (event) => {
  if (showing) place(event.clientX, event.clientY);
});

document.addEventListener('pointerout', (event) => {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]');
  if (target && target === showing) hide();
});

// Keyboard users get the label over the control itself, since there's no pointer.
// :focus-visible is what keeps this to the keyboard — clicking a button focuses it too,
// and without the check the label would jump from the cursor to the button on every
// press of Next or Previous.
document.addEventListener('focusin', (event) => {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]');
  if (!target || !target.matches(':focus-visible')) return;
  const box = target.getBoundingClientRect();
  show(target, box.left + box.width / 2, box.top);
});

document.addEventListener('focusout', (event) => {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]');
  // Losing focus while still hovered isn't a reason to drop the label.
  if (target?.matches(':hover')) return;
  if (showing) hide();
});

// Anything that moves the page out from under the pointer should take the label with it.
addEventListener('scroll', () => showing && hide(), { passive: true });
