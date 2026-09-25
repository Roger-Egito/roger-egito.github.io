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
 */

export const colors = {
  /* ── the page ──────────────────────────────────────────────────────────────── */

  /** Behind everything. Also the colour of the browser's own bar on a phone. */
  bg: '#151515',
  /** Body text, headings, and most icons. */
  txt: '#dddddd',
  /** Quieter text: dates, captions, labels above the tags. */
  muted: '#969696',

  /* ── cards and panels ──────────────────────────────────────────────────────── */

  /** A portfolio card's body. Slightly lighter than the page so it reads as a panel. */
  raised: '#1d1d1d',
  /**
   * The top of a card, the part you click to open the game: art, name, blurb, roles.
   * A shade darker than `raised`, so the clickable part reads as one block apart from
   * the buttons and details under it.
   */
  raisedDark: '#191919',
  /** The hairline around a card, and the rules above and below the numbers strip. */
  border: '#333333',
  /** Behind a card's artwork while the image is still loading. */
  well: '#101010',

  /* ── buttons and rules ─────────────────────────────────────────────────────── */

  /** Filled buttons, and the footer bar. */
  surface: '#181b1e',
  /** Text sitting on top of `surface`. */
  onSurface: '#ffffff',
  /** The pale fill a button flips to when you point at it. */
  accent: '#f1f3f4',
  /** The decorative star rule under each section heading. */
  rule: '#dddddd',
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
