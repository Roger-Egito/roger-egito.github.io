// Atom feed, linked from Head.astro. The old Jekyll one pointed every entry at "/"
// because posts had permalink: "" and so had no URL of their own. Now that each game
// has a page, the entries link somewhere useful.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { site } from '../config/site';

const escape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const plain = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

export const GET: APIRoute = async () => {
  const games = (await getCollection('games')).sort((a, b) => b.data.order - a.data.order);
  const updated = new Date().toISOString();

  const entries = games
    .map((game) => {
      const url = `${site.url}/games/${game.id}/`;
      return `  <entry>
    <title type="html">${escape(plain(game.data.title))}</title>
    <link href="${url}" rel="alternate" type="text/html" />
    <id>${url}</id>
    <updated>${updated}</updated>
    <summary type="html">${escape(plain(game.data.description ?? ''))}</summary>
  </entry>`;
    })
    .join('\n');

  const body = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="html">${escape(site.title)}</title>
  <subtitle>${escape(site.description)}</subtitle>
  <link href="${site.url}/feed.xml" rel="self" type="application/atom+xml" />
  <link href="${site.url}/" rel="alternate" type="text/html" />
  <updated>${updated}</updated>
  <id>${site.url}/</id>
  <author><name>${escape(site.author)}</name></author>
${entries}
</feed>
`;

  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
