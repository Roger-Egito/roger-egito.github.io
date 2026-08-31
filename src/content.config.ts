import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { colors } from './config/theme';
import { isTag, knownTags } from './config/tags';

// One markdown file per portfolio entry, with its image sitting next to it.
// Filename becomes the URL, so hotel-77.md is /games/hotel-77/.
//
// Adding a game: drop in `<slug>.md` and `<slug>.png`, give it an order higher than
// the rest, and point `img` at the image. That's it.
//
// `image()` makes Astro process the file, so it gets resized, converted to modern
// formats and hashed. It also fails the build if the path is wrong, instead of
// shipping a broken <img>.
/**
 * Undoes the escaping HTML does to an attribute value.
 *
 * This matters for any embed URL carrying more than one parameter. A snippet written
 * with colours reads
 *
 *     src="https://itch.io/embed/123?bg_color=2A315A&amp;fg_color=CCE2E1"
 *
 * because inside an attribute the separators have to be escaped. Pull that out as-is
 * and Astro escapes it again on the way to the page, so the browser hands itch a
 * parameter named `amp;fg_color` and the colour is quietly ignored — the first one
 * works, the rest don't.
 *
 * One left-to-right pass, so `&amp;lt;` correctly comes back as the text `&lt;`
 * rather than being decoded twice into `<`.
 */
const decodeEntities = (value: string) =>
  value.replace(
    /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos|nbsp));/g,
    (_match, dec: string, hex: string, name: string) => {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[name]!;
    },
  );

/** The value of one attribute on a pasted snippet, decoded. */
const attr = (snippet: string, name: string) => {
  const found = snippet.match(new RegExp(`\\s${name}=["']([^"']+)["']`, 'i'))?.[1];
  return found === undefined ? undefined : decodeEntities(found);
};

/**
 * A playable embed. Paste the whole <iframe> snippet itch.io gives you under
 * "Embed options" and this pulls out what it needs; a bare URL works too.
 *
 * The pixel width/height itch prints are only kept as a ratio. The embed is stretched
 * to fit whatever space the card has, so a 800x468 game and a 640x480 one each render
 * at their own shape without any per-game CSS.
 *
 * The `color` itch puts in the URL is the surround it draws around a build that doesn't
 * fill the frame. Whatever you picked over there is overwritten with the site's own
 * background, so the surround disappears into the page instead of framing the game.
 */
const embed = z.string().transform((value, ctx) => {
  const raw = value.trim();

  if (!raw.startsWith('<')) return { src: restyle(raw), width: 16, height: 9 };

  const src = attr(raw, 'src');
  if (!src) {
    ctx.addIssue({
      code: 'custom',
      message: 'no src="..." found — paste the whole <iframe> snippet, or just the URL',
    });
    return z.NEVER;
  }

  return {
    src: restyle(src),
    width: Number(raw.match(/\swidth=["']?(\d+)/i)?.[1]) || 16,
    height: Number(raw.match(/\sheight=["']?(\d+)/i)?.[1]) || 9,
  };
});

/**
 * The store page a widget belongs to, worked out from the widget's own URL.
 *
 * Only needed for stores whose snippet carries no fallback link. itch puts an <a> inside
 * its iframe for browsers that won't render one, and that anchor is the store page — so
 * itch never reaches here. Steam's snippet is the bare iframe and nothing else:
 *
 *     <iframe src="https://store.steampowered.com/widget/2960360/" ...></iframe>
 *
 * which leaves the app id in the widget path as the only thing to go on.
 */
function storePageFrom(src: string) {
  let url;
  try {
    url = new URL(src);
  } catch {
    return undefined;
  }

  if (/(^|\.)steampowered\.com$/.test(url.hostname)) {
    // /widget/2960360/ -> /app/2960360/. Steam redirects that to the titled URL itself,
    // so there's no need to guess at the game's slug.
    const id = url.pathname.match(/^\/widget\/(\d+)/)?.[1];
    return id && `https://store.steampowered.com/app/${id}/`;
  }

  return undefined;
}

/**
 * A link to a storefront, given either way round:
 *
 *   urlItchIo: https://egito.itch.io/prison-break-escape-big-sister
 *   urlItchIo: <iframe ... src="https://itch.io/embed/2827746" ...>...</iframe>
 *
 * Paste the widget snippet from itch's "Embed options" and the game's own page shows
 * the real widget — cover, price, platforms, a Download button — instead of a line of
 * link text. The plain URL still works and still gets a plain link.
 *
 * The store URL is read back out of the `<a href>` itch leaves inside the snippet as a
 * fallback, because the widget's own src points at the embed rather than the page, and
 * the portfolio card needs somewhere to send a click.
 */
const storeLink = z.string().transform((value, ctx) => {
  const raw = value.trim();

  if (!raw.startsWith('<')) return { url: raw, embed: undefined };

  const src = attr(raw, 'src');
  if (!src) {
    ctx.addIssue({
      code: 'custom',
      message: 'no src="..." found — paste the whole <iframe> snippet, or just the URL',
    });
    return z.NEVER;
  }

  // The fallback link inside the iframe if the store leaves one, otherwise whatever can
  // be read off the widget URL.
  const href = raw.match(/<a\s[^>]*href=["']([^"']+)["']/i)?.[1];
  const url = (href === undefined ? undefined : decodeEntities(href)) ?? storePageFrom(src);
  if (!url) {
    ctx.addIssue({
      code: 'custom',
      message:
        `couldn't work out which store page "${src}" belongs to, and the <iframe> has ` +
        'no fallback <a href="..."> inside it to read one from — so a click on the card ' +
        'would have nowhere to go. Use the plain store URL instead, or add this store to ' +
        'storePageFrom() in src/content.config.ts.',
    });
    return z.NEVER;
  }

  return {
    url,
    // itch's widget is a fixed size and doesn't reflow; these are the numbers it
    // printed, used as a ceiling so it's never stretched past its own artwork.
    embed: {
      src,
      width: Number(raw.match(/\swidth=["']?(\d+)/i)?.[1]) || 552,
      height: Number(raw.match(/\sheight=["']?(\d+)/i)?.[1]) || 167,
    },
  };
});

/** Points an itch embed at our background color. Anything else is left alone. */
function restyle(src: string) {
  try {
    const url = new URL(src);
    if (!/(^|\.)itch\.io$/.test(url.hostname)) return src;
    url.searchParams.set('color', colors.bg.replace('#', ''));
    return url.href;
  } catch {
    return src; // not a URL we can parse; let it through and fail visibly
  }
}

const games = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/games' }),
  schema: ({ image }) =>
    z.object({
      /** Position in the grid, highest shows first. */
      order: z.number(),
      /** Can contain <br>. */
      title: z.string(),
      img: image(),
      /** Defaults to something sensible built from the title. */
      alt: z.string().optional(),
      /** YouTube embed URL (not the watch one). Shows instead of the image if set. */
      video: z.string().optional(),
      /**
       * Playable build. Paste itch.io's whole <iframe> snippet. Adding this is what
       * makes the Game / Video tabs appear; without it nothing changes.
       */
      game: embed.optional(),
      /**
       * Sits under the build and only shows while the Game tab is open — controls,
       * "give it a moment to load", that sort of thing. Can contain <br>.
       */
      gameDescription: z.string().optional(),
      /**
       * Roles, genres, technologies and clients, lowercase, in any order — the site
       * sorts and capitalises them. Every one has to be registered in
       * src/config/tags.ts or the build stops, which is what keeps a typo from
       * shipping as a tag that silently matches no filter.
       */
      tags: z
        .array(z.string())
        .default([])
        .superRefine((list, ctx) => {
          list.forEach((name, index) => {
            if (isTag(name)) return;
            ctx.addIssue({
              code: 'custom',
              path: [index],
              message:
                `unknown tag "${name}". Add it to src/config/tags.ts, or use one of: ` +
                knownTags.join(', '),
            });
          });
        }),
      /**
       * A year (2024) or a full date (2024-03-01) — only the year is ever shown. Fill
       * either, both or neither: the card shows "2024 – 2025", a single year, or
       * nothing at all.
       */
      startDate: z.union([z.string(), z.number()]).optional(),
      endDate: z.union([z.string(), z.number()]).optional(),
      /** Free text under the date, e.g. 'Solo' or '4+ people'. */
      team: z.string().optional(),
      /**
       * One or two lines for the portfolio card. Left off, the card falls back to the
       * first paragraph of `description`.
       */
      blurb: z.string().optional(),
      /**
       * Hard numbers worth putting in front of an employer — downloads, a rating, a
       * review count, a jam placing. Rendered as a strip on the card, and skipped
       * entirely for a game that has none, which is most of them.
       */
      metrics: z
        .array(z.object({ label: z.string(), value: z.string() }))
        .optional(),
      /**
       * What you did on it, as the part before "for <title>" — so 'Sole Developer'
       * reads "Sole Developer for DESTRUA" in the hero. Every game sets this; leave it
       * off a new one and the roles in `category` stand in until you write it.
       */
      roles: z.string().optional(),
      /** Can contain <br><br>. */
      description: z.string().optional(),
      /**
       * Storefronts. A plain URL, or the whole <iframe> snippet from that store's embed
       * options — see `storeLink` above. Each one adds a row to the portfolio card and
       * a link on the game's own page.
       */
      urlSteam: storeLink.optional(),
      urlItchIo: storeLink.optional(),
      urlGooglePlay: storeLink.optional(),
      /** Shown instead of a store link for private or NDA'd projects. */
      private: z.string().optional(),
    }),
});

export const collections = { games };
