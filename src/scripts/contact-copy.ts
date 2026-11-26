/**
 * The copy button on the contact card (ContactCard.astro). Copies my address, says so,
 * and turns back after a moment.
 *
 * When the browser won't allow copying, the address is selected instead, so the
 * visitor only has to press Ctrl+C (or Cmd+C) themselves. Either way they leave with
 * the address, which is the point of the button.
 *
 * One listener for the whole page, since the card appears many times on the homepage
 * (in every game's dialog), and dialogs only exist once the page has loaded.
 */
const RESET_MS = 2000;
const timers = new WeakMap<HTMLElement, number>();

function select(node: Element) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

document.addEventListener('click', async (event) => {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-copy-email]');
  if (!button) return;
  const card = button.closest('.contact');
  const status = card?.querySelector<HTMLElement>('.status');
  const label = button.querySelector<HTMLElement>('.copy-label');

  let copied = true;
  try {
    await navigator.clipboard.writeText(button.dataset.copyEmail!);
  } catch {
    copied = false; // no permission, or not a secure page
  }

  if (copied) {
    button.dataset.state = 'done';
    if (label) label.textContent = 'Copied';
    if (status) status.textContent = 'Copied to your clipboard.';
  } else {
    const address = card?.querySelector('.address');
    if (address) select(address);
    if (status) status.textContent = 'Your browser didn’t allow copying. The address is selected: press Ctrl+C (Cmd+C on a Mac) to copy it.';
  }

  window.clearTimeout(timers.get(button));
  timers.set(
    button,
    window.setTimeout(() => {
      delete button.dataset.state;
      if (label) label.textContent = 'Copy';
      if (status && copied) status.textContent = '';
    }, RESET_MS)
  );
});
