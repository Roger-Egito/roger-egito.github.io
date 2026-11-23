// End-to-end check of a running collector (`npm run dev`, local D1 with schema.sql applied,
// .dev.vars with READ_KEY=dev-read-key). Not part of `npm test`, since it needs the Worker up.
//   node test/worker.e2e.mjs [http://127.0.0.1:8787]
//
// Reads need an approved browser. This one approves its own device straight in the local
// database, the way pressing Approve in the email would.
import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
const SITE = 'https://roger-egito.github.io';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const KEY = 'dev-read-key';
const marker = `e2e-${Date.now()}`;
const DEVICE = randomBytes(32).toString('hex');
const salt = /^SALT_SECRET=(.*)$/m.exec(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'))[1].trim();
const deviceKey = createHash('sha256').update(['device', salt, DEVICE].join('\n')).digest('hex');
// One string through the shell, since npx is a script on Windows. The SQL has only single
// quotes and hex, so double quotes hold it whole.
execSync(
  `npx wrangler d1 execute portfolio-events --local --command "INSERT INTO devices (device, status, requested_at) VALUES ('${deviceKey}', 'approved', '2026-01-01 00:00:00.000')"`,
  { cwd: new URL('..', import.meta.url), stdio: 'ignore' }
);

const post = (body, headers = {}) =>
  fetch(`${BASE}/e`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { Origin: SITE, 'User-Agent': CHROME, 'Content-Type': 'text/plain', ...headers } });
const read = (key = KEY) =>
  fetch(`${BASE}/v1/export?since=`, { headers: { 'X-Device': DEVICE, ...(key === null ? {} : { Authorization: `Bearer ${key}` }) } });

const results = {};
const statuses = [];
statuses.push((await post({ type: 'pageview', url: `${SITE}/?f=unity&utm_source=linkedin#portfolio`, referrer: 'https://www.linkedin.com/feed/', title: marker, screen: '1920x1080', language: 'pt-BR' })).status);
statuses.push((await post({ type: 'pageview', url: `${SITE}/games/hotel-77/`, referrer: `${SITE}/`, title: marker, screen: '1920x1080', language: 'pt-BR' })).status);
statuses.push((await post({ type: 'event', name: 'store-click', url: `${SITE}/games/hotel-77/`, title: marker, data: { game: 'hotel-77', store: 'steam' }, screen: '1920x1080', language: 'pt-BR' })).status);
statuses.push((await post({ type: 'leave', url: `${SITE}/games/hotel-77/`, title: marker, screen: '1920x1080', language: 'pt-BR' })).status);
results.statuses = statuses;

// Kept, flagged: a crawler, and the same browser switched with ?no-track.
await post({ type: 'pageview', url: `${SITE}/bot`, title: marker }, { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' });
await post({ type: 'pageview', url: `${SITE}/mine`, title: marker, flag: 'me', screen: '1920x1080', language: 'pt-BR' });
await post({ type: 'pageview', url: `${SITE}/claims-bot`, title: marker, flag: 'bot-ua', screen: '1920x1080', language: 'pt-BR' });

// Things that must not be stored.
await post({ type: 'pageview', url: `${SITE}/other-origin`, title: marker }, { Origin: 'https://evil.example' });
await post({ type: 'pageview', url: 'https://evil.example/', title: marker });
await post('x'.repeat(5000));
await post('{not json');

results.noKey = (await read(null)).status;
results.wrongKey = (await read('nope')).status;
const response = await read();
results.rightKey = response.status;
results.cors = response.headers.get('access-control-allow-origin');
const body = await response.json();
const all = body.website_event.filter((e) => e.page_title === marker);
const at = (path) => all.find((e) => e.url_path === path);
const mine = all.filter((e) => !['/bot', '/mine', '/claims-bot'].includes(e.url_path));
results.stored = mine.map((e) => [e.event_type, e.event_name, e.url_path, e.url_query, e.referrer_domain, e.utm_source, e.browser, e.os, e.device, e.screen, e.language].join(' | '));
results.oneVisitor = new Set(mine.map((e) => e.session_id)).size === 1;
results.oneVisit = new Set(mine.map((e) => e.visit_id)).size === 1;
results.properties = body.event_data.filter((d) => mine.some((e) => e.event_id === d.website_event_id)).map((d) => `${d.data_key}=${d.string_value}`);
results.noIpAnywhere = !JSON.stringify(mine).includes('127.0.0.1');
results.flags = mine.map((e) => e.flag);
results.botKeptAs = at('/bot')?.flag;
results.meKeptAs = at('/mine')?.flag;
results.meIsAnotherVisitor = at('/mine')?.session_id !== mine[0].session_id;
results.clientCantClaimBotUa = at('/claims-bot')?.flag ?? null;
results.blockedOnesStored = all.filter((e) => e.url_path === '/other-origin').length;
console.log(JSON.stringify(results, null, 1));
