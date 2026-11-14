/**
 * Pages that are mine rather than the site's. astro.config.mjs keeps them out of the
 * sitemap by reading this list, and each one asks search engines not to index it.
 *
 * None of them holds anything worth hiding: the analytics report only reads files
 * dropped on it, in the browser, so the page itself carries no data. That's why a
 * plain, guessable path is fine.
 */

/** The analytics report: drop an Umami Cloud export on it. */
export const reportSlug = 'umami';

export const privatePaths = [`/${reportSlug}/`];
