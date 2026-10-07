/**
 * Every colour on the site, in one place.
 *
 * ── Editing this file ──────────────────────────────────────────────────────────
 *
 * Change a value between the quotes and save. That's the whole job — nothing else
 * needs touching, and the colour updates everywhere it's used.
 *
 *     bg: '#151515',
 *            ↑ this part is the colour
 *
 * Any CSS colour works: '#151515', 'white', 'rgb(0 0 0 / 0.5)'. Keep the quotes and
 * keep the comma at the end of the line.
 *
 * Don't rename the words on the left (`bg`, `txt`, …) — those are how the rest of
 * the site asks for each colour, so renaming one stops it being found.
 *
 * The `rgb(0 0 0 / 0.5)` ones are see-through blacks; the last number is how solid
 * it is, from 0 (invisible) to 1 (fully opaque).
 *
 * The palette is Steam's. Each value below was read off store.steampowered.com's own
 * computed styles (the search page and a game page, October 2026), so where a comment
 * names a Steam element, that's where the number came from.
 */

export const colors = {
  /* ── the page ──────────────────────────────────────────────────────────────── */

  /** Behind everything. Also the colour of the browser's own bar on a phone. Steam's body. */
  bg: '#1b2838',
  /** Body text and most icons. Steam's body text. */
  txt: '#c6d4df',
  /** Headings and anything that has to stand out from the body text. */
  heading: '#ffffff',
  /** Quieter text: dates, captions, labels above the tags. Steam's release date. */
  muted: '#8f98a0',

  /* ── the bars ──────────────────────────────────────────────────────────────── */

  /** The navbar. Steam's global header. */
  header: '#171d25',
  /** The filter bar over the grid, darkest at its edges. Steam's store menu bar. */
  menuBar: '#182535',
  menuBarEdge: '#192330',
  /** Behind the search box in the filter bar. */
  searchFill: 'rgb(255 255 255 / 0.125)',
  /** The search button, and the navbar link you're pointing at. Steam's search button. */
  action: '#1a9fff',

  /* ── links and buttons ─────────────────────────────────────────────────────── */

  /** Links, and the text on a plain button. Steam's blue button and its tags. */
  link: '#67c1f5',
  /** A plain button's fill, and a tag's. */
  linkFill: 'rgb(103 193 245 / 0.2)',
  /** The store button: Steam's green "Add to Cart", left to right. */
  buy: '#75b022',
  buyEnd: '#588a1b',
  /** Text on the store button. */
  onBuy: '#d2efa9',

  /* ── cards and panels ──────────────────────────────────────────────────────── */

  /**
   * The strip under a card's artwork, menus and panels. A step darker than the page,
   * the way Steam's search rows are (20% black over the page).
   */
  raised: '#16202d',
  /** Darker again: Steam's highlighted row (40% black over the page). */
  raisedDark: '#101822',
  /** Hairlines between things. Steam's 10% white panel border. */
  border: 'rgb(255 255 255 / 0.1)',
  /** Behind a card's artwork while the image is still loading. */
  well: '#0e141c',

  /* ── the hover popup ───────────────────────────────────────────────────────── */

  /** The info panel beside a hovered card, top to bottom. Steam's game hover box. */
  popup: '#e3eaef',
  popupEnd: '#c7d5e0',
  /** Text in it, and its title. */
  popupInk: '#30455a',
  popupTitle: '#222d3d',
  /** Its tags. Steam's hover tag. */
  popupTag: 'rgb(38 54 69 / 0.6)',

  /**
   * A featured card turned over, from the bottom-left corner out. Steam draws this
   * panel as a three-stop radial gradient starting from `header`'s dark; the shape is
   * measured, but its colours follow whichever sale skin is up (brown, in October 2026).
   * These two are the store's own blues instead: `capsuleLight` is Steam's classic
   * #2a475e, from memory rather than measured, and `capsule` sits between it and the page.
   */
  capsule: '#1f3349',
  capsuleLight: '#2a475e',

  /* ── buttons and rules ─────────────────────────────────────────────────────── */

  /** The footer bar. Steam's footer. */
  surface: '#0f1924',
  /** Text sitting on top of `surface`. */
  onSurface: '#ffffff',
  /** What a link or an icon button turns when you point at it. */
  accent: '#ffffff',
  /** The rule under each section heading, fading out to the right. */
  rule: '#3b6e8c',
  /** The line under each contact-form field. */
  field: '#eeeeee',

  /* ── responsibility tags ─────────────────────────────────────────── */

  /**
   * One per discipline, on the tag line at the bottom of a card. The colour is what
   * separates the disciplines now that the labels are gone.
   *
   * These come from IBM Carbon's dark theme, a set built for near-black backgrounds.
   * Measured against the chip's own tinted fill, each one reads at 6.1:1 to 6.5:1,
   * well past the 4.5:1 the accessibility guidelines ask for at this text size, and
   * short of the 10:1 and up a fully bright colour would hit, which glares against
   * this much black.
   */

  /** Design tags: level design, systems design, narrative design. */
  design: '#78a9ff',
  /** Programming tags: gameplay, AI, UI, network. */
  programming: '#42be65',
  /** Art tags: 2D, 3D, art direction. */
  art: '#be95ff',
  /** Audio tags: editing, implementation, sound design. */
  audio: '#ff832b',
  /** Production tags: project management, QA, localization. */
  production: '#08bdba',

  /* ── storefronts ─────────────────────────────────────────────── */

  /**
   * Each store's button, in that store's own colour, so the button is recognizable
   * before the label is read. These are the brands' own values, or the lighter end of
   * their palette where the brand colour is too dark to carry black text on a dark
   * card. The label sits on top in near-black, which reads at 5.9:1 on the itch red
   * and around 9:1 on the other two.
   */

  /** itch.io's red. */
  itch: '#fa5c5c',
  /** Steam's light blue, the one from its own dark interface. */
  steam: '#66c0f4',
  /** Android's green, for the Google Play button. */
  googlePlay: '#3ddc84',

  /* ── states ────────────────────────────────────────────────────────────────── */

  /** A contact-form field filled in wrongly. */
  error: '#e74c3c',

  /* ── shadows and overlays ──────────────────────────────────────────────────── */

  /** Dims the page behind an open dialog. */
  backdrop: 'rgb(0 0 0 / 0.5)',
  /** Dims it further behind the "Close the game?" question, which sits on top of one. */
  backdropDeep: 'rgb(0 0 0 / 0.6)',
  /** The drop shadow under a dialog. */
  dropShadow: 'rgb(0 0 0 / 0.31)',
  /** Sits behind the name and titles on the banner, so they stay readable over video. */
  textShadow: 'rgb(0 0 0 / 0.6)',
} as const satisfies Record<string, string>;

export type ColorName = keyof typeof colors;

/* ─────────────────────────────────────────────────────────────────────────────── */
/* Below here is plumbing. Nothing to edit.                                        */
/* ─────────────────────────────────────────────────────────────────────────────── */

/** `backdropDeep` -> `backdrop-deep`, so CSS gets the dashed names it expects. */
const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * The colours above as CSS custom properties. Head.astro drops this into every page,
 * which is what makes `var(--color-bg)` work in the stylesheets — so the object above
 * really is the only place a colour is written down.
 */
export const colorVariables = `:root {\n${Object.entries(colors)
  .map(([name, value]) => `  --color-${kebab(name)}: ${value};`)
  .join('\n')}\n}`;
