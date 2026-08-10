import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// One file per portfolio entry. Filename becomes the URL, so hotel-77.md is
// /games/hotel-77/.
//
// Adding a game: copy an existing file, give it an order higher than the rest, and
// put the image in public/img/portfolio/. Highest order shows first.
const games = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/games' }),
  schema: z.object({
    /** Position in the grid, highest shows first. */
    order: z.number(),
    /** Can contain <br>. */
    title: z.string(),
    /** Filename inside public/img/portfolio/ */
    img: z.string(),
    alt: z.string().default('image-alt'),
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
