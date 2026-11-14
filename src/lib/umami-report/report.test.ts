// Unit tests for the report's parsing, classification and numbers.
// Run with `npm test` (Node's own test runner, which reads TypeScript as it is).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseRecords } from './csv.ts';
import { buildSessions, classifyAll, readEvents, sourceOf } from './sessions.ts';
import { buildReport, filtersIn, weekOf } from './report.ts';
import { readExport } from './archive.ts';
import { reportConfig } from './config.ts';
import { eventDataCsv, websiteEventCsv } from './fixtures.ts';

const sessionsFrom = (csv: string, overrides = {}) =>
  classifyAll(buildSessions(readEvents(parseRecords(csv)), reportConfig), reportConfig, overrides);

const kindOf = (id: string) => sessionsFrom(websiteEventCsv).find((session) => session.id === id)?.kind;

/* --- csv ------------------------------------------------------------------------- */

test('csv: quoted fields keep their commas, quotes and line breaks', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi""\nthere"\r\n'), [
    ['a', 'b'],
    ['x, y', 'say "hi"\nthere'],
  ]);
});

test('csv: \\N is null, an empty field stays empty', () => {
  assert.deepEqual(parseRecords('a,b,c\n\\N,,z'), [{ a: null, b: '', c: 'z' }]);
});

/* --- classification -------------------------------------------------------------- */

test('my desktop, phone, phone emulation and blank screen from home are me', () => {
  assert.equal(kindOf('me-desktop'), 'me');
  assert.equal(kindOf('me-phone'), 'me');
  assert.equal(kindOf('me-emulating'), 'me');
  assert.equal(kindOf('me-blank'), 'me');
});

test('one page, no referrer, from a datacenter is a bot', () => {
  assert.equal(kindOf('bot-sg'), 'bot');
  assert.equal(kindOf('bot-iowa'), 'bot');
});

test('a datacenter city with more than one page is a real visitor', () => {
  assert.equal(kindOf('real-dulles'), 'real');
});

test('a headless screen is a bot on its own, referrer or not', () => {
  assert.equal(kindOf('bot-bing'), 'bot');
});

test('everyone else is a real visitor', () => {
  assert.equal(kindOf('real-linkedin'), 'real');
  assert.equal(kindOf('real-home'), 'real');
});

test('every verdict says why', () => {
  const byId = Object.fromEntries(sessionsFrom(websiteEventCsv).map((s) => [s.id, s.reason]));
  assert.match(byId['me-phone'], /^My phone: chrome · Android OS · 393x873 · pt-BR · Rio de Janeiro$/);
  assert.match(byId['bot-sg'], /^1 pageview, no referrer, datacenter country SG$/);
  assert.match(byId['bot-iowa'], /datacenter city Council Bluffs/);
  assert.match(byId['bot-bing'], /^Headless screen 800x600, 1 pageview$/);
  assert.match(byId['real-home'], /^No rule matched/);
});

test('a hand override wins and keeps what the rules said', () => {
  const moved = sessionsFrom(websiteEventCsv, { 'bot-iowa': 'real' }).find((s) => s.id === 'bot-iowa')!;
  assert.equal(moved.kind, 'real');
  assert.equal(moved.ruled.kind, 'bot');
  assert.match(moved.reason, /^Set by hand\. The rules said Bot: /);
});

test('sources: LinkedIn by referrer or utm, other sites by host, else direct', () => {
  assert.equal(sourceOf('www.linkedin.com', null, reportConfig), 'LinkedIn');
  assert.equal(sourceOf('lnkd.in', null, reportConfig), 'LinkedIn');
  assert.equal(sourceOf('com.linkedin.android', null, reportConfig), 'LinkedIn');
  assert.equal(sourceOf(null, 'linkedin', reportConfig), 'LinkedIn');
  assert.equal(sourceOf('www.google.com', null, reportConfig), 'google.com');
  assert.equal(sourceOf(null, null, reportConfig), 'Direct');
});

/* --- report ---------------------------------------------------------------------- */

test('headline numbers', () => {
  const { totals } = buildReport(sessionsFrom(websiteEventCsv), reportConfig.timeZone);
  assert.deepEqual(totals, {
    pageviews: 15, // the store click is an event, not a pageview
    myPageviews: 6,
    myShare: 6 / 15,
    botSessions: 3,
    realSessions: 3,
    realPageviews: 6,
  });
});

test('weeks start on Monday in São Paulo time, empty weeks included', () => {
  // Sunday 23:30 in São Paulo is already Monday in UTC: it still belongs to the week before.
  assert.equal(weekOf(new Date('2026-09-28T02:30:00Z'), 'America/Sao_Paulo'), '2026-09-21');
  const { weeks } = buildReport(sessionsFrom(websiteEventCsv), reportConfig.timeZone);
  assert.deepEqual(
    weeks.map((w) => [w.week, w.me, w.bot, w.real]),
    [
      ['2026-09-21', 5, 1, 0],
      ['2026-09-28', 0, 1, 3],
      ['2026-10-05', 1, 1, 3],
    ]
  );
});

test('sources, pages, home-only share and filters for real visitors', () => {
  const report = buildReport(sessionsFrom(websiteEventCsv), reportConfig.timeZone);
  assert.deepEqual(report.realSources, [
    { label: 'Direct', count: 2 },
    { label: 'LinkedIn', count: 1 },
  ]);
  assert.deepEqual(report.realPages[0], { label: '/', count: 3 });
  assert.deepEqual(report.homeOnly, { sessions: 1, share: 1 / 3 });
  assert.deepEqual(filtersIn('f=unity,python&q=war'), ['unity', 'python']);
  assert.deepEqual(report.filters, [
    { filter: 'unity', real: 1, me: 1 },
    { filter: 'python', real: 0, me: 1 },
  ]);
});

test('custom events by real visitors, with their properties', () => {
  const report = buildReport(sessionsFrom(websiteEventCsv), reportConfig.timeZone, parseRecords(eventDataCsv));
  assert.deepEqual(report.realEvents, [
    {
      name: 'store',
      count: 1,
      details: [
        { label: 'game: hotel-77', count: 1 },
        { label: 'store: steam', count: 1 },
      ],
    },
  ]);
});

/* --- archive --------------------------------------------------------------------- */

const encoder = new TextEncoder();

/** A one-file tar, the way tar writes it: a 512-byte header, then the data padded to 512. */
function tarOf(name: string, content: string) {
  const data = encoder.encode(content);
  const header = new Uint8Array(512);
  const put = (at: number, value: string) => header.set(encoder.encode(value), at);
  put(0, name);
  put(100, '0000644\0');
  put(124, `${data.length.toString(8).padStart(11, '0')}\0`);
  put(156, '0');
  put(257, 'ustar\0');
  const body = new Uint8Array(Math.ceil(data.length / 512) * 512);
  body.set(data);
  const out = new Uint8Array(512 + body.length + 1024);
  out.set(header);
  out.set(body, 512);
  return out;
}

const gzip = async (bytes: Uint8Array) =>
  new Uint8Array(
    await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
  );

test('archive: a .gz holding a tar of the CSVs', async () => {
  const bytes = await gzip(tarOf('export/website_event.csv', websiteEventCsv));
  const files = await readExport([{ name: 'umami-export.tar.gz', bytes }]);
  assert.equal(files.websiteEvent, websiteEventCsv);
});

test('archive: a .gz holding one CSV, and plain CSVs alongside', async () => {
  const files = await readExport([
    { name: 'website_event.csv.gz', bytes: await gzip(encoder.encode(websiteEventCsv)) },
    { name: 'event_data.csv', bytes: encoder.encode(eventDataCsv) },
    { name: 'notes.txt', bytes: encoder.encode('hi') },
  ]);
  assert.equal(files.websiteEvent, websiteEventCsv);
  assert.equal(files.eventData, eventDataCsv);
  assert.deepEqual(files.ignored, ['notes.txt']);
});
