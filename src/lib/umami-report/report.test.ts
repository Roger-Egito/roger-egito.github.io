// Unit tests for the report's parsing, classification and numbers.
// Run with `npm test` (Node's own test runner, which reads TypeScript as it is).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseRecords } from './csv.ts';
import { buildSessions, classifyAll, readEvents, sourceOf } from './sessions.ts';
import {
  applyFilters, autoGranularity, breakdown, classificationSummary, durations, events, filterUsage, filtersIn,
  eventProperties, heatmap, mondayOf, noFilters, pages, personPages, searchUsage, timeline, totals,
  visitRows, visitors,
  type Filters,
} from './explore.ts';
import { reportConfig } from './config.ts';
import { collectorEventCsv, eventDataCsv, websiteEventCsv } from './fixtures.ts';
import { offsetLabel, offsetOf, otherClock, vpnHints } from './zones.ts';

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

test('a city written without its accent still matches the rules', () => {
  assert.equal(kindOf('me-collector'), 'me');
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

test('after the collector took over, a look-alike of my device is someone else', () => {
  const after = Object.fromEntries(sessionsFrom(collectorEventCsv).map((s) => [s.id, s]));
  assert.equal(after['real-lookalike'].kind, 'real');
  assert.match(after['real-lookalike'].reason, /^No rule matched/);
});

test('the collector’s flag decides, whatever the device looks like', () => {
  const after = Object.fromEntries(sessionsFrom(collectorEventCsv).map((s) => [s.id, s]));
  assert.deepEqual(
    ['me-flagged', 'bot-webdriver', 'bot-blank', 'bot-ua'].map((id) => [id, after[id].kind]),
    [['me-flagged', 'me'], ['bot-webdriver', 'bot'], ['bot-blank', 'bot'], ['bot-ua', 'bot']]
  );
  assert.match(after['me-flagged'].reason, /no-track/);
  assert.match(after['bot-ua'].reason, /user agent/);
});

test('the bot rules still apply to unflagged visits, and an unknown flag counts as none', () => {
  const after = Object.fromEntries(sessionsFrom(collectorEventCsv).map((s) => [s.id, s]));
  assert.equal(after['bot-datacenter'].kind, 'bot');
  assert.equal(after['real-odd-flag'].kind, 'real');
});

test('a flagged session can still be moved by hand', () => {
  const moved = sessionsFrom(collectorEventCsv, { 'bot-ua': 'real' }).find((s) => s.id === 'bot-ua')!;
  assert.equal(moved.kind, 'real');
  assert.match(moved.reason, /^Set by hand\. The rules said Bot: Flagged by the collector/);
});

/* --- the visitor's clock ---------------------------------------------------------- */

const afterCollector = () => Object.fromEntries(sessionsFrom(collectorEventCsv).map((s) => [s.id, s]));

test('offsets come from the zone at that moment, daylight saving included', () => {
  assert.equal(offsetOf(new Date('2026-11-24T05:44:04Z'), 'America/Chicago'), -360);
  assert.equal(offsetOf(new Date('2026-07-01T12:00:00Z'), 'America/Chicago'), -300);
  assert.equal(offsetOf(new Date('2026-11-24T12:00:00Z'), 'Asia/Kolkata'), 330);
  assert.equal(offsetOf(new Date('2026-11-24T12:00:00Z'), 'UTC'), 0);
  assert.equal(offsetOf(new Date('2026-11-24T12:00:00Z'), 'Mars/Olympus_Mons'), null);
  assert.deepEqual([offsetLabel(-360), offsetLabel(330), offsetLabel(0)], ['UTC−06:00', 'UTC+05:30', 'UTC']);
});

test('their time is shown only when their clock reads differently from mine', () => {
  const s = afterCollector();
  assert.equal(otherClock(s['real-texas'].start, s['real-texas'], zone), 'America/Chicago');
  assert.equal(otherClock(s['real-bahia'].start, s['real-bahia'], zone), null); // another name, same clock
  assert.equal(otherClock(s['real-lookalike'].start, s['real-lookalike'], zone), null); // no zone recorded
  // The device's zone is their clock, not the IP's.
  assert.equal(otherClock(s['real-vpn'].start, s['real-vpn'], zone), null);
});

test('a VPN shows as a device clock the IP disagrees with, and a hosting network', () => {
  const s = afterCollector();
  assert.deepEqual(vpnHints(s['real-vpn'], reportConfig), [
    "The device's clock is set to America/Sao_Paulo (UTC−03:00), but the IP is placed in Europe/Amsterdam (UTC+01:00).",
    'The network is M247 Europe SRL, a hosting company, not a home or mobile provider.',
  ]);
  assert.deepEqual(vpnHints(s['real-texas'], reportConfig), []);
  assert.deepEqual(vpnHints(s['real-bahia'], reportConfig), []);
  assert.deepEqual(vpnHints(s['real-lookalike'], reportConfig), []);
});

test('the Texas visit from ChatGPT is sourced to chatgpt.com, not Direct', () => {
  assert.deepEqual(afterCollector()['real-texas'].sources, ['chatgpt.com']);
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

test('sources: with no referrer the utm_source tag names it, and a referrer beats a tag', () => {
  assert.equal(sourceOf(null, 'chatgpt.com', reportConfig), 'chatgpt.com');
  assert.equal(sourceOf(null, 'www.ChatGPT.com', reportConfig), 'chatgpt.com');
  assert.equal(sourceOf(null, '  ', reportConfig), 'Direct');
  assert.equal(sourceOf('mail.google.com', 'newsletter', reportConfig), 'mail.google.com');
});

/* --- visits ---------------------------------------------------------------------- */

test('a session splits into its visits, each with its own source and duration', () => {
  const linkedin = sessions.find((s) => s.id === 'real-linkedin')!;
  assert.equal(linkedin.visits.length, 2);
  assert.deepEqual(linkedin.visits.map((v) => v.source), ['LinkedIn', 'Direct']);
  const second = rows.find((r) => r.visit.id === 'real-linkedin-visit-2')!;
  assert.equal(second.duration, 20_000);
  // The direct return visit names no place, so it adds nothing to the list.
  assert.deepEqual(linkedin.sources, ['LinkedIn']);
});

/** One event of one collector visit, on Nov 24 at 12:<minute> UTC. */
const arrival = (minute: number, referrerDomain: string | null, utmSource: string | null, urlPath = '/') =>
  ({
    sessionId: 'roger', visitId: 'v1', eventId: `e${minute}`, createdAt: new Date(Date.UTC(2026, 10, 24, 12, minute)),
    eventType: 1, eventName: null, urlPath, urlQuery: null, referrerDomain, utmSource, browser: 'Chrome', os: 'Windows 10',
    device: 'desktop', screen: '1920x1080', language: 'en', country: 'BR', region: 'RJ', city: null, flag: 'me',
    timeZone: null, ipTimeZone: null, network: null,
  }) satisfies Parameters<typeof buildSessions>[0][number];

test('arriving from somewhere else mid-visit starts a new visit with its own source', () => {
  const [roger] = buildSessions(
    [arrival(0, 'linkedin.com', 'linkedin'), arrival(2, null, null, '/games/hotel-77/'), arrival(10, 'github.com', 'github')],
    reportConfig,
  );
  assert.deepEqual(roger.visits.map((v) => [v.id, v.source, v.pageviews.length]), [['v1', 'LinkedIn', 2], ['v1~2', 'github.com', 1]]);
  assert.deepEqual(roger.sources, ['LinkedIn', 'github.com']);
});

test('a direct start followed by an outside arrival is two visits', () => {
  const [roger] = buildSessions([arrival(0, null, null), arrival(5, 'github.com', 'github')], reportConfig);
  assert.deepEqual(roger.visits.map((v) => v.source), ['Direct', 'github.com']);
  assert.deepEqual(roger.sources, ['github.com']);
});

test('the same tag coming back without a referrer, as when a dialog closes, continues the visit', () => {
  const [roger] = buildSessions(
    [arrival(0, 'github.com', 'github'), arrival(1, null, null, '/games/hotel-77/'), arrival(2, null, 'github'), arrival(3, 'github.com', 'github')],
    reportConfig,
  );
  assert.deepEqual(roger.visits.map((v) => [v.source, v.pageviews.length]), [['github.com', 4]]);
});

/* --- joined ids, returns and time in view ----------------------------------------- */

const PAGEVIEW = 1, CLICK = 2, LEAVE = 9, BACK = 10;

/** One event from a visitor in Dubai on a Mac, on Nov 25 at 05:<minute> UTC, from ChatGPT. */
const dubai = (sessionId: string, visitId: string, minute: number, eventType: number, change: Partial<Parameters<typeof buildSessions>[0][number]> = {}) =>
  ({
    sessionId, visitId, eventId: `${sessionId}-${minute}-${eventType}`, createdAt: new Date(Date.UTC(2026, 10, 25, 5, minute)),
    eventType, eventName: eventType === CLICK ? 'play-build' : null, urlPath: '/games/covid-35/', urlQuery: 'utm_source=chatgpt.com',
    referrerDomain: null, utmSource: 'chatgpt.com', browser: 'chrome', os: 'Mac OS', device: 'laptop', screen: '1470x956',
    language: 'en-US', country: 'AE', region: 'AE-DU', city: 'Dubai', flag: null, timeZone: null, ipTimeZone: null, network: null,
    ...change,
  }) satisfies Parameters<typeof buildSessions>[0][number];

test('the same device under two ids within half an hour is one person, in one visit', () => {
  // The real Nov 25 visit: the click arrived under a second id, mid-visit.
  const people = buildSessions(
    [dubai('A', 'a1', 43, PAGEVIEW), dubai('B', 'b1', 57, CLICK), dubai('A', 'a1', 60, LEAVE), dubai('A', 'a1', 84, LEAVE)],
    reportConfig,
  );
  assert.equal(people.length, 1);
  assert.deepEqual(people[0].ids, ['A', 'B']);
  assert.equal(people[0].visits.length, 1);
  assert.deepEqual(people[0].visits[0].ids, ['A', 'B']);
  assert.deepEqual(people[0].visits[0].events.map((e) => e.eventType), [PAGEVIEW, CLICK, LEAVE, LEAVE]);
});

test('ids stay apart when the device differs or they were active far apart', () => {
  const language = buildSessions([dubai('A', 'a1', 0, PAGEVIEW), dubai('B', 'b1', 5, PAGEVIEW, { language: 'en-GB' })], reportConfig);
  assert.equal(language.length, 2);
  const later = buildSessions(
    [dubai('A', 'a1', 0, PAGEVIEW), dubai('B', 'b1', 0, PAGEVIEW, { createdAt: new Date(Date.UTC(2026, 10, 25, 7, 0)) })],
    reportConfig,
  );
  assert.equal(later.length, 2);
  const unknownCity = buildSessions([dubai('A', 'a1', 0, PAGEVIEW, { city: null }), dubai('B', 'b1', 5, PAGEVIEW, { city: null })], reportConfig);
  assert.equal(unknownCity.length, 2);
});

test('a hand override on a joined id still applies to the person', () => {
  const people = buildSessions([dubai('A', 'a1', 43, PAGEVIEW), dubai('B', 'b1', 57, CLICK)], reportConfig);
  assert.equal(classifyAll(people, reportConfig, { B: 'bot' })[0].kind, 'bot');
});

test('coming back to a tab after the visit timed out continues the same visit', () => {
  // Hidden at 05:10, back at 06:00: the collector started a new visit with the return.
  const [person] = buildSessions(
    [
      dubai('A', 'a1', 0, PAGEVIEW),
      dubai('A', 'a1', 10, LEAVE),
      dubai('A', 'a2', 60, BACK),
      dubai('A', 'a2', 70, LEAVE),
    ],
    reportConfig,
  );
  assert.equal(person.visits.length, 1);
  const [row] = visitRows(classifyAll([person], reportConfig), zone);
  assert.equal(row.duration, 70 * 60_000); // open from 05:00 to 06:10
  assert.deepEqual(row.inView, { time: 20 * 60_000, exact: true }); // 10 minutes, then 10 more
});

test('time in view is a floor when a return went unrecorded, and unknown with no leave at all', () => {
  // Before the tracker sent returns: out of view at 05:10, then out of view again at 05:30.
  const [old] = visitRows(
    classifyAll(buildSessions([dubai('A', 'a1', 0, PAGEVIEW), dubai('A', 'a1', 10, LEAVE), dubai('A', 'a1', 30, LEAVE)], reportConfig), reportConfig),
    zone,
  );
  assert.deepEqual(old.inView, { time: 10 * 60_000, exact: false });
  const [umami] = visitRows(classifyAll(buildSessions([dubai('A', 'a1', 0, PAGEVIEW), dubai('A', 'a1', 5, PAGEVIEW)], reportConfig), reportConfig), zone);
  assert.equal(umami.inView, null);
});

test('a leave event gives the last page of a visit its time, and is never a view', () => {
  const row = rows.find((r) => r.session.id === 'me-collector')!;
  assert.deepEqual(row.steps.map((s) => s.timeOnPage), [30_000, 90_000]);
  assert.equal(row.visit.pageviews.length, 2);
  assert.deepEqual(row.steps.flatMap((s) => s.events), []);
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
    pageviews: 19, // the store click and the leave are events, not pageviews
    myPageviews: 8,
    myShare: 8 / 19,
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
      ['2026-10-05', 3, 1, 5],
    ]
  );
  // The returning recruiter is one visitor in the week of Oct 5, with two visits.
  const week = timeline(real, 'week', zone).find((b) => b.key === '2026-10-05')!;
  assert.deepEqual([week.visits.real, week.visitors.real], [3, 2]);
  const days = timeline(real, 'day', zone);
  assert.equal(days.length, 7); // Oct 2 to Oct 8, the quiet days included
  assert.deepEqual([days[0].key, days[0].views.real, days[1].views.real], ['2026-10-02', 3, 0]);
});

test('a period picked runs the chart across all of it, quiet days included', () => {
  const span = { from: '2026-10-01', to: '2026-10-10' };
  const days = timeline(only({ kinds: ['real'], ...span }), 'day', zone, span);
  assert.deepEqual([days.length, days[0].key, days.at(-1)!.key], [10, '2026-10-01', '2026-10-10']);
  // Today only: the day's 24 hours, whatever hour the visits came at.
  const today = { from: '2026-10-02', to: '2026-10-02' };
  const hours = timeline(only({ kinds: ['real'], ...today }), 'hour', zone, today);
  assert.deepEqual([hours.length, hours[0].key, hours.at(-1)!.key], [24, '2026-10-02 00', '2026-10-02 23']);
});

test('the bucket size follows the period picked, or the data when none is', () => {
  assert.equal(autoGranularity(real, { from: '2026-10-02', to: '2026-10-02' }), 'hour');
  assert.equal(autoGranularity(real, { from: '2026-09-25', to: '2026-10-24' }), 'day');
  assert.equal(autoGranularity(real, { from: '2026-01-01', to: '2026-10-24' }), 'week');
  assert.equal(autoGranularity(real), 'day'); // Oct 2 to Oct 8
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

test('engaged visitors: 30 seconds on a page, all of a person’s views added up', () => {
  const table = pages(real);
  const engaged = (path: string) => table.find((p) => p.path === path)?.engaged;
  // / : Dulles stayed 40s. The recruiter stayed 90s, then 20s on a second visit, and
  // counts once. The bounce has no time at all.
  assert.equal(engaged('/'), 2);
  assert.equal(engaged('/games/cursed-blight/'), 1); // 80s
  assert.equal(engaged('/games/hotel-77/'), 0); // the last page of an Umami-era visit: no time
  // A leave event gives the last page its time: my 90s on Destrua, counted as mine.
  const destrua = pages(rows).find((p) => p.path === '/games/destrua/')!;
  assert.deepEqual(destrua.engagedByKind, { real: 0, me: 1, bot: 0 });
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
