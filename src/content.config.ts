import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { pageBackground } from './config/theme';

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

  const src = raw.match(/\ssrc=["']([^"']+)["']/i)?.[1];
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

/** Points an itch embed at our background color. Anything else is left alone. */
function restyle(src: string) {
  try {
    const url = new URL(src);
    if (!/(^|\.)itch\.io$/.test(url.hostname)) return src;
    url.searchParams.set('color', pageBackground.replace('#', ''));
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
      projectDate: z.union([z.string(), z.number()]).optional(),
      client: z.string().optional(),
      category: z.string().optional(),
      /**
       * What you did on it, as the part before "for <title>" — so 'Sole Developer'
       * reads "Sole Developer for DESTRUA" in the hero. Every game sets this; leave it
       * off a new one and the roles in `category` stand in until you write it.
       */
      roles: z.string().optional(),
      /** Can contain <br><br>. */
      description: z.string().optional(),
      urlSteam: z.string().optional(),
      urlItchIo: z.string().optional(),
      urlGooglePlay: z.string().optional(),
      /** Shown instead of a store link for private or NDA'd projects. */
      private: z.string().optional(),
    }),
});

export const collections = { games };
