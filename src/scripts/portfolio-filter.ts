/**
 * Filtering for the portfolio grid.
 *
 * The rules, in one place:
 *
 *   - Filters from the same menu are an "or": Unity or Python shows both.
 *   - Filters from different menus are an "and": Unity and Ludomancer shows the
 *     Ludomancer games built in Unity. That's how a store's filters behave, so picking
 *     a second option in one menu widens the grid instead of emptying it.
 *   - Search narrows whatever the filters left, matching the name, the blurb, the
 *     description and every tag's printed label.
 *
 * State lives in the address bar (?f=unity,itch&q=vr), which is what makes a filtered
 * grid something you can send to someone, and what makes the browser's own Back button
 * undo a filter rather than leave the page.
 *
 * Menus open on click rather than hover: a hover menu can't be opened on a touch
 * screen without a tap that also counts as a click on whatever is underneath.
 */
export {};

const bar = document.querySelector<HTMLElement>('[data-filter-bar]');
const grid = document.querySelector<HTMLElement>('[data-portfolio-grid]');
if (bar && grid) {
  const activeBox = bar.querySelector<HTMLElement>('[data-active-filters]')!;
  const countLine = bar.querySelector<HTMLElement>('[data-filter-count]')!;
  const searchForm = bar.querySelector<HTMLFormElement>('[data-search-form]')!;
  const searchInput = bar.querySelector<HTMLInputElement>('[data-search-input]')!;
  const cards = [...grid.querySelectorAll<HTMLElement>('[data-filters]')];
  const empty = document.querySelector<HTMLElement>('[data-filter-empty]');

  /** Every option button in the bar, so a filter can be toggled from either end. */
  const optionButtons = [...bar.querySelectorAll<HTMLButtonElement>('[data-filter]')];

  /** id -> { label, category }, read off the menus rather than shipped twice. */
  const known = new Map<string, { label: string; category: string }>();
  for (const button of optionButtons) {
    known.set(button.dataset.filter!, {
      label: button.querySelector('.option-label')?.textContent?.trim() ?? button.dataset.filter!,
      category: button.dataset.category ?? '',
    });
  }

  /** What each card answers to, parsed once. */
  const cardFilters = new Map<HTMLElement, Set<string>>();
  for (const card of cards) {
    cardFilters.set(card, new Set(JSON.parse(card.dataset.filters ?? '[]') as string[]));
  }

  const active = new Set<string>();
  let query = '';

  /* ---------------------------------------------------------------- the model --- */

  /**
   * Which menu a filter belongs to, which is what makes "or within, and across" work.
   * A tag clicked on a card carries its category instead, and a category no menu shows
   * still groups with itself.
   */
  const menuOf = (id: string) => {
    const button = optionButtons.find((option) => option.dataset.filter === id);
    return button?.closest<HTMLElement>('[data-menu]')?.dataset.menu ?? known.get(id)?.category ?? id;
  };

  const matches = (card: HTMLElement) => {
    const has = cardFilters.get(card)!;

    const byMenu = new Map<string, string[]>();
    for (const id of active) {
      const menu = menuOf(id);
      byMenu.set(menu, [...(byMenu.get(menu) ?? []), id]);
    }
    for (const group of byMenu.values()) {
      if (!group.some((id) => has.has(id))) return false;
    }

    if (query && rankOf(card) === undefined) return false;
    return true;
  };

  /**
   * Where the search text turned up, which is also the order the results come back in:
   * the name first, then the blurb, then the tags. Nothing found returns undefined,
   * and that's what drops the card.
   */
  const rankOf = (card: HTMLElement) => {
    if (!query) return 0;
    if ((card.dataset.searchTitle ?? '').includes(query)) return 0;
    if ((card.dataset.searchBlurb ?? '').includes(query)) return 1;
    if ((card.dataset.searchTags ?? '').includes(query)) return 2;
    return undefined;
  };

  /* ----------------------------------------------------------------- painting --- */

  const chipFor = (id: string) => {
    const { label, category } = known.get(id) ?? { label: id, category: '' };
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'active-filter';
    chip.dataset.filter = id;
    chip.dataset.category = category;
    // The label reads as the whole control, so the X needs no name of its own.
    chip.setAttribute('aria-label', `Remove filter: ${label}`);
    chip.innerHTML = `<span>${label}</span><span class="remove" aria-hidden="true">✕</span>`;
    return chip;
  };

  /* --------------------------------------------------- what the search matched --- */

  /**
   * Wraps every run of the search text in a <mark>, inside the card's own words: the
   * name, the blurb, the genres and the tags. Walking text nodes rather than touching
   * innerHTML, so the markup around them survives, and the original is kept so the
   * next search starts from clean text instead of a card marked up three times over.
   */
  const originals = new WeakMap<HTMLElement, string>();
  const markable = '.title a, .blurb, .genres, .chips button';

  const highlight = (card: HTMLElement, needle: string) => {
    /* A card says less than it's searched by: the tech icons are pictures, and a chip
       reads "Level" where the search knows it as "Level Design". So a tag whose full
       name matches gets a ring instead of a <mark>, and a search for "unity" lights up
       the Unity icon rather than leaving the card looking like it matched nothing. */
    for (const tagged of card.querySelectorAll<HTMLElement>('[data-card-filter]')) {
      const label = known.get(tagged.dataset.cardFilter!)?.label.toLowerCase() ?? '';
      tagged.toggleAttribute('data-match', Boolean(needle) && label.includes(needle));
    }

    for (const el of card.querySelectorAll<HTMLElement>(markable)) {
      const original = originals.get(el) ?? el.innerHTML;
      originals.set(el, original);
      if (el.innerHTML !== original) el.innerHTML = original;
      if (!needle) continue;

      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const texts: Text[] = [];
      while (walker.nextNode()) texts.push(walker.currentNode as Text);

      for (const node of texts) {
        const text = node.nodeValue ?? '';
        const lower = text.toLowerCase();
        if (!lower.includes(needle)) continue;

        const parts = document.createDocumentFragment();
        let cut = 0;
        for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + needle.length)) {
          parts.append(text.slice(cut, at));
          const hit = document.createElement('mark');
          hit.textContent = text.slice(at, at + needle.length);
          parts.append(hit);
          cut = at + needle.length;
        }
        parts.append(text.slice(cut));
        node.replaceWith(parts);
      }
    }
  };

  /* ------------------------------------------------------------ the reshuffle --- */

  const items = cards.map((card) => card.closest('li') ?? card);
  const still = matchMedia('(prefers-reduced-motion: reduce)');

  /**
   * Shows exactly the cards in `keep`, with the grid reflowing rather than jumping.
   *
   * Three moments: the cards being dropped fade out where they stand, the layout then
   * changes in one go, and every card that stayed is put back where it was and let go,
   * so it slides to its new spot. That last part is the FLIP trick: take the position
   * before and after, and animate the difference, since the browser has already done
   * the hard work of deciding where everything lands.
   */
  const reflow = (keep: Set<Element>, order: Element[]) => {
    const show = () => {
      for (const li of items) li.toggleAttribute('hidden', !keep.has(li));
      // Moving the elements themselves rather than setting a CSS order, because the
      // grid is a plain list below the tablet breakpoint, where order does nothing.
      for (const li of order) li.parentElement?.append(li);
    };

    if (still.matches) {
      show();
      return;
    }

    const before = new Map<Element, DOMRect>();
    const leaving: Element[] = [];
    for (const li of items) {
      if (li.hasAttribute('hidden')) continue;
      before.set(li, li.getBoundingClientRect());
      if (!keep.has(li)) leaving.push(li);
    }

    const fades = leaving.map((li) =>
      li.animate(
        [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(0.94)' },
        ],
        { duration: 130, easing: 'ease-in', fill: 'forwards' }
      )
    );

    const settle = () => {
      show();
      for (const fade of fades) fade.cancel();

      for (const li of items) {
        if (!keep.has(li)) continue;
        const now = li.getBoundingClientRect();
        const was = before.get(li);

        if (!was) {
          // Wasn't on screen a moment ago, so it arrives rather than moves.
          li.animate(
            [
              { opacity: 0, transform: 'scale(0.97)' },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 220, easing: 'ease-out' }
          );
          continue;
        }

        const dx = was.left - now.left;
        const dy = was.top - now.top;
        if (!dx && !dy) continue;
        li.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
          duration: 300,
          easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
        });
      }
    };

    if (fades.length) Promise.all(fades.map((fade) => fade.finished)).then(settle, settle);
    else settle();
  };

  const apply = () => {
    const keep = new Set<Element>();
    const ranked: { li: Element; rank: number; home: number }[] = [];
    for (const [home, card] of cards.entries()) {
      if (!matches(card)) continue;
      // The <li> is what the grid lays out, so that's what has to go.
      const li = card.closest('li') ?? card;
      keep.add(li);
      ranked.push({ li, rank: rankOf(card) ?? 0, home });
      highlight(card, query);
    }

    // Best match first, and inside one rank the grid's own order, so clearing the
    // search puts every card back where it belongs.
    ranked.sort((a, b) => a.rank - b.rank || a.home - b.home);

    const shown = keep.size;
    reflow(keep, ranked.map((entry) => entry.li));

    activeBox.replaceChildren(...[...active].map(chipFor));
    if (active.size > 1) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'clear-filters';
      clear.dataset.clearFilters = '';
      clear.textContent = 'Clear all';
      activeBox.append(clear);
    }

    for (const button of optionButtons) {
      button.setAttribute('aria-pressed', String(active.has(button.dataset.filter!)));
    }

    const filtering = active.size > 0 || query.length > 0;
    countLine.textContent = filtering
      ? `Showing ${shown} of ${cards.length} games`
      : `Showing all ${cards.length} games`;
    empty?.toggleAttribute('hidden', shown > 0);

    // Cards carry their own filter chips, and those light up too when their filter is on.
    for (const chip of grid.querySelectorAll<HTMLElement>('[data-card-filter]')) {
      chip.toggleAttribute('data-on', active.has(chip.dataset.cardFilter!));
    }
  };

  /* ---------------------------------------------------------------- the address --- */

  const readUrl = () => {
    const params = new URLSearchParams(location.search);
    active.clear();
    for (const id of params.get('f')?.split(',').filter(Boolean) ?? []) active.add(id);
    query = (params.get('q') ?? '').toLowerCase();
    if (searchInput.value.toLowerCase() !== query) searchInput.value = params.get('q') ?? '';
  };

  const writeUrl = (replace = false) => {
    const params = new URLSearchParams(location.search);
    params.delete('f');
    params.delete('q');

    // Written by hand rather than with URLSearchParams.toString(), which turns every
    // comma into %2C. These addresses show up in the analytics as the record of what
    // people filter and search for, so they're kept readable: ?f=unity,python&q=war
    // rather than ?f=unity%2Cpython. Each part is still escaped, and the comma left
    // bare between them is exactly what readUrl splits on.
    const part = (value: string) => encodeURIComponent(value).replace(/%20/g, '+');
    const own = [
      active.size ? `f=${[...active].map(part).join(',')}` : '',
      query ? `q=${part(searchInput.value.trim())}` : '',
      params.toString(),
    ].filter(Boolean);

    const url = `${location.pathname}${own.length ? `?${own.join('&')}` : ''}${location.hash}`;
    // replaceState while typing, so a search doesn't leave one history entry per letter.
    history[replace ? 'replaceState' : 'pushState']({}, '', url);
  };

  const toggle = (id: string) => {
    if (!active.delete(id)) active.add(id);
    writeUrl();
    apply();
  };

  /* ------------------------------------------------------------------- menus --- */

  const closeMenus = (except?: Element) => {
    for (const menu of bar.querySelectorAll<HTMLElement>('[data-menu]')) {
      if (menu === except) continue;
      menu.querySelector('[data-menu-button]')?.setAttribute('aria-expanded', 'false');
      menu.querySelector('[data-menu-panel]')?.setAttribute('hidden', '');
    }
  };

  /** Flips a panel to the other side of its button when it would leave the screen. */
  const keepOnScreen = (panel: HTMLElement, side: 'panel' | 'sub') => {
    panel.removeAttribute('data-align');
    const box = panel.getBoundingClientRect();
    if (box.right > window.innerWidth - 8) {
      panel.dataset.align = side === 'panel' ? 'right' : 'left';
    }
  };

  bar.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    const menuButton = target.closest<HTMLButtonElement>('[data-menu-button]');
    if (menuButton) {
      const menu = menuButton.closest<HTMLElement>('[data-menu]')!;
      const panel = menu.querySelector<HTMLElement>('[data-menu-panel]')!;
      const open = menuButton.getAttribute('aria-expanded') === 'true';
      closeMenus(menu);
      menuButton.setAttribute('aria-expanded', String(!open));
      panel.toggleAttribute('hidden', open);
      if (!open) keepOnScreen(panel, 'panel');
      return;
    }

    const groupButton = target.closest<HTMLButtonElement>('[data-group-button]');
    if (groupButton) {
      const group = groupButton.closest<HTMLElement>('[data-group]')!;
      const sub = group.querySelector<HTMLElement>('[data-subpanel]')!;
      const open = groupButton.getAttribute('aria-expanded') === 'true';
      // One discipline open at a time, so the flyouts can't stack on each other.
      for (const other of group.parentElement!.querySelectorAll<HTMLElement>('[data-group]')) {
        if (other === group) continue;
        other.querySelector('[data-group-button]')?.setAttribute('aria-expanded', 'false');
        other.querySelector('[data-subpanel]')?.setAttribute('hidden', '');
      }
      groupButton.setAttribute('aria-expanded', String(!open));
      sub.toggleAttribute('hidden', open);
      if (!open) keepOnScreen(sub, 'sub');
      return;
    }

    const option = target.closest<HTMLButtonElement>('[data-filter]');
    if (option) {
      toggle(option.dataset.filter!);
      return;
    }

    if (target.closest('[data-clear-filters]')) {
      active.clear();
      writeUrl();
      apply();
    }
  });

  document.addEventListener('click', (event) => {
    if (!bar.contains(event.target as Node)) closeMenus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // Only when a menu is what's open, so Escape still belongs to the dialogs.
    const open = bar.querySelector<HTMLElement>('[data-menu-button][aria-expanded="true"]');
    if (!open) return;
    closeMenus();
    open.focus();
  });

  /* ------------------------------------------------------------------ search --- */

  let typing: number | undefined;
  searchInput.addEventListener('input', () => {
    // Filtering happens on the keystroke itself: ten cards is nothing to sort through,
    // and any wait at all reads as the box ignoring you. Only the address bar is held
    // back, and for longer than it takes to type: each address it settles on is
    // counted as a view, so it waits until the typing has stopped, and a search for
    // "war" is recorded once as ?q=war rather than as w, wa and war.
    query = searchInput.value.trim().toLowerCase();
    apply();

    clearTimeout(typing);
    typing = window.setTimeout(() => writeUrl(true), 1000);
  });

  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearTimeout(typing);
    query = searchInput.value.trim().toLowerCase();
    writeUrl();
    apply();
    // Dismisses the keyboard on a phone, where it covers the results it just filtered.
    searchInput.blur();
  });

  /* ------------------------------------------- filters clicked on a card ------- */

  grid.addEventListener('click', (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-card-filter]');
    if (!chip) return;
    event.preventDefault();
    toggle(chip.dataset.cardFilter!);
    // The bar is above the grid and a filtered grid reflows under the reader, so take
    // them to the thing that just changed.
    bar.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  /* --------------------------------------------------------------- start up --- */

  window.addEventListener('popstate', () => {
    readUrl();
    apply();
  });

  readUrl();
  apply();
  bar.removeAttribute('hidden');
}
