// Unit tests for the collector's decisions. Run with `npm test` in collector/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE, EVENT, LIMIT, READ_LIMIT, askedAtOf, deviceIdOf, deviceKeyOf, flagOf, isToken, labelOf, linkLive, tokenKeyOf, VISIT_GAP_MS, clientOf, isBot, networkOf, placeOf, propertiesOf, referrerDomainOf, regionOf,
  requesterOf, retryAfterOf, sameSecret, timestampOf, validate, visitFor, visitorOf, networkNameOf, zoneOf,
} from '../src/core.ts';

const SITE = 'roger-egito.github.io';
const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const OPERA_WINDOWS = `${CHROME_WINDOWS} OPR/116.0.0.0`;
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

test('validate keeps what the tracker sends and cuts it to size', () => {
  const ok = validate({ type: 'pageview', url: 'https://roger-egito.github.io/', screen: '1920x1080', language: 'pt-BR', title: 'x'.repeat(999) });
  assert.equal(ok?.type, 'pageview');
  assert.equal(ok?.title?.length, LIMIT.title);
  assert.equal(ok?.screen, '1920x1080');
  assert.equal(ok?.language, 'pt-BR');
});

test('validate drops what the tracker would never send', () => {
  assert.equal(validate(null), null);
  assert.equal(validate({ type: 'hack', url: 'https://roger-egito.github.io/' }), null);
  assert.equal(validate({ type: 'pageview' }), null);
  assert.equal(validate({ type: 'event', url: 'https://roger-egito.github.io/' }), null); // a click needs a name
  const odd = validate({ type: 'pageview', url: 'https://roger-egito.github.io/', screen: '<b>', language: 'en; DROP' });
  assert.deepEqual([odd?.screen, odd?.language], [null, null]);
});

test('click properties: strings and numbers, at most ten', () => {
  const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
  const event = validate({ type: 'event', name: 'store-click', url: 'https://roger-egito.github.io/', data: { game: 'hotel-77', bad: { nested: 1 }, ...many } })!;
  assert.equal(event.data.game, 'hotel-77');
  assert.equal('bad' in event.data, false);
  assert.ok(Object.keys(event.data).length <= LIMIT.properties);
  assert.deepEqual(propertiesOf('e1', { game: 'hotel-77', n: 3 }), [
    { event_id: 'e1', data_key: 'game', string_value: 'hotel-77', number_value: null },
    { event_id: 'e1', data_key: 'n', string_value: null, number_value: 3 },
  ]);
});

test('URLs split the way Umami splits them: the path keeps its hash', () => {
  const place = placeOf('https://www.roger-egito.github.io/games/hotel-77/?f=unity,python&utm_source=linkedin#top', SITE)!;
  assert.deepEqual(place, {
    hostname: SITE,
    urlPath: '/games/hotel-77/#top',
    urlQuery: 'f=unity,python&utm_source=linkedin',
    utmSource: 'linkedin',
    utmMedium: null,
    utmCampaign: null,
  });
  assert.equal(placeOf('https://evil.example/', SITE), null);
  assert.equal(placeOf('not a url', SITE), null);
});

test('referrers: the domain, without www, and never the site itself', () => {
  assert.equal(referrerDomainOf('https://www.linkedin.com/feed/', SITE), 'linkedin.com');
  assert.equal(referrerDomainOf('https://roger-egito.github.io/games/', SITE), null);
  assert.equal(referrerDomainOf('android-app://com.linkedin.android/', SITE), 'com.linkedin.android');
  assert.equal(referrerDomainOf(null, SITE), null);
});

test('browsers and devices named the way Umami names them', () => {
  assert.deepEqual(clientOf(CHROME_WINDOWS, '1920x1080'), { browser: 'chrome', os: 'Windows 10', device: 'laptop' });
  assert.deepEqual(clientOf(OPERA_WINDOWS, '2560x1440'), { browser: 'opera', os: 'Windows 10', device: 'desktop' });
  assert.deepEqual(clientOf(CHROME_ANDROID, '393x873'), { browser: 'chrome', os: 'Android OS', device: 'mobile' });
});

test('bots are known by their user agent', () => {
  assert.equal(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), true);
  assert.equal(isBot('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36'), true);
  assert.equal(isBot(''), true);
  assert.equal(isBot(CHROME_WINDOWS), false);
});

test('a visitor is the same all month and new the next, and depends on the secret', async () => {
  const early = await visitorOf('s', new Date('2026-11-01T00:00:01Z'), '1.2.3.4', CHROME_WINDOWS);
  const late = await visitorOf('s', new Date('2026-11-30T23:59:59Z'), '1.2.3.4', CHROME_WINDOWS);
  const next = await visitorOf('s', new Date('2026-12-01T00:00:00Z'), '1.2.3.4', CHROME_WINDOWS);
  const other = await visitorOf('t', new Date('2026-11-15T00:00:00Z'), '1.2.3.4', CHROME_WINDOWS);
  assert.equal(early, late);
  assert.notEqual(early, next);
  assert.notEqual(early, other);
  assert.match(early, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(early.includes('1.2.3.4'), false);
});

test('the tracker may flag its own browser, and anything else it sends as a flag is no flag', () => {
  const event = (flag: unknown) => validate({ type: 'pageview', url: 'https://roger-egito.github.io/', flag })?.flag;
  assert.equal(event('me'), 'me');
  assert.equal(event('webdriver'), 'webdriver');
  assert.equal(event('no-screen'), 'no-screen');
  assert.equal(event('bot-ua'), null); // only the collector decides that one
  assert.equal(event('admin'), null);
  assert.equal(event(undefined), null);
});

test('a time zone is kept only when Intl knows it, and a network name is cut to size', () => {
  const zone = (timeZone: unknown) => validate({ type: 'pageview', url: 'https://roger-egito.github.io/', timeZone })?.timeZone;
  assert.equal(zone('America/Chicago'), 'America/Chicago');
  assert.equal(zone('America/Sao_Paulo'), 'America/Sao_Paulo');
  assert.equal(zone('UTC'), 'UTC');
  assert.equal(zone('Mars/Olympus_Mons'), null);
  assert.equal(zone('<script>'), null);
  assert.equal(zone(42), null);
  assert.equal(zone('A'.repeat(200)), null);
  assert.equal(zoneOf(undefined), null);
  assert.equal(networkNameOf('Claro S.A.'), 'Claro S.A.');
  assert.equal(networkNameOf('x'.repeat(500))?.length, LIMIT.network);
  assert.equal(networkNameOf(undefined), null);
});

test('a bot user agent outranks what the tracker says, and nothing is dropped for it', () => {
  const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
  assert.equal(flagOf(null, GOOGLEBOT), 'bot-ua');
  assert.equal(flagOf('me', GOOGLEBOT), 'bot-ua');
  assert.equal(flagOf(null, ''), 'bot-ua');
  assert.equal(flagOf('me', CHROME_WINDOWS), 'me');
  assert.equal(flagOf(null, CHROME_WINDOWS), null);
});

test('a flag makes a separate visitor, and no flag keeps the id it had before flags', async () => {
  const at = new Date('2026-11-23T12:00:00Z');
  const plain = await visitorOf('s', at, '1.2.3.4', CHROME_WINDOWS);
  assert.equal(await visitorOf('s', at, '1.2.3.4', CHROME_WINDOWS, null), plain);
  // The id this month's unflagged visitors were stored under: the hash without a flag part.
  const { createHash } = await import('node:crypto');
  const before = createHash('sha256').update(['s', '2026-11', '1.2.3.4', CHROME_WINDOWS].join('\n')).digest('hex');
  assert.equal(plain.replaceAll('-', ''), before.slice(0, 32));
  const mine = await visitorOf('s', at, '1.2.3.4', CHROME_WINDOWS, 'me');
  assert.notEqual(mine, plain);
  assert.notEqual(await visitorOf('s', at, '1.2.3.4', CHROME_WINDOWS, 'webdriver'), mine);
});

test('a visit goes on while events keep coming, and ends after 30 quiet minutes', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  const ago = (ms: number) => ({ visit_id: 'v1', created_at: timestampOf(new Date(now.getTime() - ms)) });
  assert.equal(visitFor(ago(VISIT_GAP_MS - 1000), now, () => 'new'), 'v1');
  assert.equal(visitFor(ago(VISIT_GAP_MS + 1000), now, () => 'new'), 'new');
  assert.equal(visitFor(null, now, () => 'new'), 'new');
});

test('timestamps, regions and event types match the export format', () => {
  assert.equal(timestampOf(new Date('2026-11-21T14:03:11.123Z')), '2026-11-21 14:03:11.123');
  assert.equal(regionOf('BR', 'RJ'), 'BR-RJ');
  assert.equal(regionOf('US', 'US-NC'), 'US-NC');
  assert.equal(regionOf(null, 'RJ'), null);
  assert.deepEqual(EVENT, { pageview: 1, click: 2, leave: 9 });
});

test('the read key compares whole, and an empty key never matches', async () => {
  assert.equal(await sameSecret('key-123', 'key-123'), true);
  assert.equal(await sameSecret('key-124', 'key-123'), false);
  assert.equal(await sameSecret('', ''), false);
});

test('the read limit counts an IPv4 address alone and an IPv6 address by its /64', () => {
  assert.equal(networkOf('203.0.113.7'), '203.0.113.7');
  assert.equal(networkOf('2001:db8:85a3:12:aaaa:bbbb:cccc:dddd'), '2001:db8:85a3:12::/64');
  assert.equal(networkOf('2001:0db8:85a3:0012::1'), '2001:db8:85a3:12::/64');
  assert.equal(networkOf('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(networkOf('::ffff:203.0.113.7'), '203.0.113.7');
});

test('the read limit keeps a hash of the network, never the IP', async () => {
  const a = await requesterOf('salt', '2001:db8:85a3:12::1');
  assert.equal(a, await requesterOf('salt', '2001:db8:85a3:12:ffff::2')); // same /64, same requester
  assert.notEqual(a, await requesterOf('salt', '2001:db8:85a3:13::1'));
  assert.notEqual(a, await requesterOf('other salt', '2001:db8:85a3:12::1'));
  assert.ok(!a.includes('2001'));
});

test('a refused network waits until its oldest failure is an hour old', () => {
  assert.equal(READ_LIMIT.failures, 3);
  const now = new Date('2026-11-22T12:00:00.000Z');
  assert.equal(retryAfterOf('2026-11-22 11:15:00.000', now), 15 * 60);
  assert.equal(retryAfterOf('2026-11-22 10:00:00.000', now), 1); // already free: never less than a second
});

test('a device id is 64 hex characters, and anything else is no id', () => {
  const id = 'ab'.repeat(32);
  assert.equal(deviceIdOf(id), id);
  assert.equal(deviceIdOf(null), null);
  assert.equal(deviceIdOf('AB'.repeat(32)), null);
  assert.equal(deviceIdOf(`${id}0`), null);
  assert.equal(deviceIdOf("' OR 1=1 --"), null);
  assert.ok(isToken(id));
});

test('devices and link tokens are kept as hashes that depend on the secret', async () => {
  const id = 'cd'.repeat(32);
  const device = await deviceKeyOf('salt', id);
  assert.notEqual(device, id);
  assert.notEqual(device, await deviceKeyOf('other salt', id));
  assert.notEqual(await tokenKeyOf(id), id);
});

test('the approval email names the browser, system and place', () => {
  assert.equal(labelOf(CHROME_WINDOWS, null, { city: 'Niterói', country: 'BR' }), 'chrome on Windows 10 (desktop), Niterói, BR');
  assert.equal(labelOf(CHROME_ANDROID, null, {}), 'chrome on Android OS (mobile)');
  assert.equal(labelOf('', null, { country: 'XX' }), 'Unknown browser on an unknown system (desktop)');
});

test('the approval email gives the time in Brasília, from a Date or a stored timestamp', () => {
  assert.equal(askedAtOf(new Date('2026-11-22T17:32:00.000Z')), 'Sun, Nov 22, 2026, 14:32 (Brasília time)');
  assert.equal(askedAtOf('2026-11-23 02:05:00.000'), 'Sun, Nov 22, 2026, 23:05 (Brasília time)'); // still Sunday there
});

test('an approval link works for an hour, and approval emails are capped per day', () => {
  const now = new Date('2026-11-22T12:00:00.000Z');
  assert.equal(linkLive('2026-11-22 11:01:00.000', now), true);
  assert.equal(linkLive('2026-11-22 11:00:00.000', now), false);
  assert.equal(DEVICE.emailsPerDay, 10);
});
