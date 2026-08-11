import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// One markdown file per portfolio entry, with its image sitting next to it.
// Filename becomes the URL, so hotel-77.md is /games/hotel-77/.
//
// Adding a game: drop in `<slug>.md` and `<slug>.png`, give it an order higher than
// the rest, and point `img` at the image. That's it.
//
// `image()` makes Astro process the file, so it gets resized, converted to modern
// formats and hashed. It also fails the build if the path is wrong, instead of
// shipping a broken <img>.
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
      projectDate: z.union([z.string(), z.number()]).optional(),
      client: z.string().optional(),
      category: z.string().optional(),
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
