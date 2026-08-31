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
