/**
 * The navbar's phone menu: the button opens and closes the panel of links under the
 * bar. Escape, a tap anywhere else, or following one of the links closes it again.
 *
 * Opened by click, like the portfolio's filter menus, because a hover menu can't be
 * opened on a touch screen without the tap also landing on whatever is underneath.
 */
export {};

const toggle = document.querySelector<HTMLButtonElement>('[data-nav-toggle]');
const links = document.getElementById('site-nav-links');

if (toggle && links) {
  const setOpen = (open: boolean) => {
    toggle.setAttribute('aria-expanded', String(open));
    links.toggleAttribute('data-open', open);
  };

  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  // A link was followed (a jump down the page, the About dialog, the CV), so the
  // menu has done its job.
  links.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) setOpen(false);
  });

  document.addEventListener('click', (event) => {
    const target = event.target as Node;
    if (!toggle.contains(target) && !links.contains(target)) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || toggle.getAttribute('aria-expanded') !== 'true') return;
    setOpen(false);
    toggle.focus();
  });
}
