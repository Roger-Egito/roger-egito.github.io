// Unit tests for the report's parsing, classification and numbers.
// Run with `npm test` (Node's own test runner, which reads TypeScript as it is).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseRecords } from './csv.ts';
import { buildSessions, classifyAll, readEvents, sourceOf } from './sessions.ts';
import {
  applyFilters, breakdown, classificationSummary, durations, events, filterUsage, filtersIn,
  eventProperties, heatmap, mondayOf, noFilters, pages, personPages, searchUsage, timeline, totals,
  visitRows, visitors,
  type Filters,
} from './explore.ts';
import { readExport } from './archive.ts';
import { reportConfig } from './config.ts';
import { eventDataCsv, websiteEventCsv } from './fixtures.ts';

const zone = reportConfig.timeZone;
const sessionsFrom = (csv: string, overrides = {}) =>
  classifyAll(buildSessions(readEvents(parseRecords(csv)), reportConfig), reportConfig, overrides);
const sessions = sessionsFrom(websiteEventCsv);
const rows = visitRows(sessions, zone);
const only = (change: Partial<Filters>) => applyFilters(rows, { ...noFilters(), ...change });
const real = only({ kinds: ['real'] });

const kindOf = (id: string) => sessions.find((session) => session.id === id)?.kind;

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
  const byId = Object.fromEntries(sessions.map((s) => [s.id, s.reason]));
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

test('sources: LinkedIn by referrer, app or utm, other sites by host, else direct', () => {
  assert.equal(sourceOf('www.linkedin.com', null, reportConfig), 'LinkedIn');
  assert.equal(sourceOf('lnkd.in', null, reportConfig), 'LinkedIn');
  assert.equal(sourceOf('com.linkedin.android', null, reportConfig), 'LinkedIn');
  assert.equal(sourceOf(null, 'linkedin', reportConfig), 'LinkedIn');
  assert.equal(sourceOf('www.google.com', null, reportConfig), 'google.com');
  assert.equal(sourceOf(null, null, reportConfig), 'Direct');
});

/* --- visits ---------------------------------------------------------------------- */

test('a session splits into its visits, each with its own source and duration', () => {
  const linkedin = sessions.find((s) => s.id === 'real-linkedin')!;
  assert.equal(linkedin.visits.length, 2);
  assert.deepEqual(linkedin.visits.map((v) => v.source), ['LinkedIn', 'Direct']);
  const second = rows.find((r) => r.visit.id === 'real-linkedin-visit-2')!;
  assert.equal(second.duration, 20_000);
  assert.equal(linkedin.source, 'LinkedIn'); // the visitor still arrived from LinkedIn first
});

test('time on page runs to the next view; the last page of a visit has none', () => {
  const dulles = rows.find((r) => r.session.id === 'real-dulles')!;
  assert.deepEqual(dulles.steps.map((s) => s.timeOnPage), [40_000, 80_000, null]);
  const linkedin = rows.find((r) => r.visit.id === 'real-linkedin-visit')!;
  assert.deepEqual(linkedin.steps[1].events.map((e) => e.eventName), ['store']);
});

/* --- numbers --------------------------------------------------------------------- */

test('the five headline numbers, for the whole export', () => {
  assert.deepEqual(classificationSummary(sessions), {
    pageviews: 17, // the store click is an event, not a pageview
    myPageviews: 6,
    myShare: 6 / 17,
    botSessions: 3,
    realSessions: 3,
    realPageviews: 8,
  });
});

test('totals for real visitors', () => {
  const t = totals(real);
  assert.equal(t.views, 8);
  assert.equal(t.visits, 4);
  assert.equal(t.visitors, 3);
  assert.equal(t.bounceRate, 0.25);
  assert.equal(t.viewsPerVisit, 2);
  // Only the three visits past one page: 20s, 120s, 120s.
  assert.equal(t.longerVisits, 3);
  assert.equal(t.medianDuration, 120_000);
  assert.equal(t.averageDuration, 260_000 / 3);
  // Timed views: 40s, 80s, 90s, 20s.
  assert.equal(t.timedViews, 4);
  assert.equal(t.medianTimeOnPage, 60_000);
  assert.equal(t.averageTimeOnPage, 57_500);
  assert.equal(t.measuredTime, 230_000);
  assert.deepEqual(totals(rows).byKind.bot, { views: 3, visits: 3, visitors: 3 });
});

test('filters: within a dimension any value, across dimensions all', () => {
  assert.equal(only({ values: { page: ['/games/hotel-77/'] } }).length, 2);
  assert.equal(only({ values: { page: ['/games/hotel-77/'] }, kinds: ['real'] }).length, 1);
  assert.equal(only({ values: { country: ['US', 'SG'] } }).length, 4);
  assert.equal(only({ values: { country: ['US'], source: ['Direct'] } }).length, 2);
});

test('filters: dates are the visit day in São Paulo, inclusive', () => {
  assert.deepEqual(
    only({ from: '2026-10-06', to: '2026-10-07' }).map((r) => r.session.id),
    ['real-linkedin', 'real-home']
  );
});

test('filters: search looks through places, pages and queries', () => {
  assert.deepEqual(only({ search: 'war' }).map((r) => r.visit.id), ['real-linkedin-visit-2']);
});

test('a breakdown can leave its own dimension out of the filter', () => {
  const filters = { ...noFilters(), values: { country: ['US'] } };
  const countries = breakdown(applyFilters(rows, filters, 'country'), 'country', 'visits').map((r) => r.value);
  assert.deepEqual(countries.sort(), ['BR', 'PT', 'SG', 'US']);
});

test('breakdowns by source, and by viewed page counting only that page', () => {
  assert.deepEqual(
    breakdown(real, 'source', 'visits').map((r) => [r.value, r.visits]),
    [['Direct', 3], ['LinkedIn', 1]]
  );
  const home = breakdown(real, 'page', 'time').find((r) => r.value === '/')!;
  assert.deepEqual([home.views, home.time, home.visitors], [4, 150_000, 3]);
});

test('weeks start on Monday, São Paulo time, with empty buckets filled', () => {
  assert.equal(mondayOf('2026-09-27'), '2026-09-21'); // a Sunday
  assert.deepEqual(
    timeline(rows, 'week', zone).map((b) => [b.key, b.views.me, b.views.bot, b.views.real]),
    [
      ['2026-09-21', 5, 1, 0],
      ['2026-09-28', 0, 1, 3],
      ['2026-10-05', 1, 1, 5],
    ]
  );
  // The returning recruiter is one visitor in the week of Oct 5, with two visits.
  const week = timeline(real, 'week', zone).find((b) => b.key === '2026-10-05')!;
  assert.deepEqual([week.visits.real, week.visitors.real], [3, 2]);
  const days = timeline(real, 'day', zone);
  assert.equal(days.length, 7); // Oct 2 to Oct 8, the quiet days included
  assert.deepEqual([days[0].key, days[0].views.real, days[1].views.real], ['2026-10-02', 3, 0]);
});

test('heatmap places views by weekday and hour in São Paulo', () => {
  const grid = heatmap(real, zone);
  assert.equal(grid[4][12], 3); // Friday, 12:00 (15:00 UTC)
  assert.equal(grid[1][9], 2); // Tuesday, 09:00
  assert.equal(grid.flat().reduce((a, b) => a + b, 0), 8);
});

test('pages: entries, exits, bounces and time on page', () => {
  const table = pages(real);
  const home = table.find((p) => p.path === '/')!;
  // Timed views of /: 40s, 90s, 20s. The median is the middle one, the average their mean.
  assert.deepEqual(
    [home.views, home.visits, home.entries, home.exits, home.bounces, home.time, home.averageTime, home.medianTime],
    [4, 4, 4, 1, 1, 150_000, 50_000, 40_000]
  );
  const hotel = table.find((p) => p.path === '/games/hotel-77/')!;
  assert.deepEqual([hotel.exits, hotel.timedViews, hotel.averageTime, hotel.medianTime], [1, 0, null, null]);
});

test('visitors and visit durations', () => {
  const linkedin = visitors(real).find((v) => v.session.id === 'real-linkedin')!;
  assert.deepEqual([linkedin.visits, linkedin.views], [2, 4]);
  const buckets = Object.fromEntries(durations(real).map((b) => [b.label, b.byKind.real]));
  assert.deepEqual([buckets['One page'], buckets['10–30s'], buckets['1–3m']], [1, 1, 2]);
});

test('portfolio filters, searches and click events', () => {
  assert.deepEqual(filtersIn('f=unity,python&q=war'), ['unity', 'python']);
  assert.deepEqual(
    filterUsage(rows).map((r) => [r.value, r.byKind.real, r.byKind.me]),
    [['unity', 1, 1], ['python', 0, 1]]
  );
  assert.deepEqual(searchUsage(rows).map((r) => [r.value, r.byKind.real]), [['war', 1]]);
  assert.deepEqual(events(rows, parseRecords(eventDataCsv)), [
    {
      name: 'store',
      byKind: { real: 1, me: 0, bot: 0 },
      total: 1,
      details: [
        { label: 'game: hotel-77', count: 1 },
        { label: 'store: steam', count: 1 },
      ],
    },
  ]);
});

test('one person: pages over all their visits, with time and clicks', () => {
  const person = rows.filter((r) => r.session.id === 'real-linkedin');
  assert.deepEqual(
    personPages(person).map((p) => [p.path, p.views, p.time, p.clicks]),
    [
      ['/', 2, 110_000, 0],
      ['/games/hotel-77/', 1, 0, 1],
      ['/games/memories-of-war/', 1, 0, 0],
    ]
  );
  assert.deepEqual(eventProperties(parseRecords(eventDataCsv)).get('store-click'), ['game: hotel-77', 'store: steam']);
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
