/**
 * Everything the report page shows, worked out from classified sessions and the current
 * filters. Pure, like sessions.ts: plain data in, plain data out, nothing here knows
 * there's a page, so every number can be tested without a browser.
 *
 * The unit everything counts is the visit (one sitting). A visit passes the filters
 * when its own facts match (date, hour, source, pages) and its visitor's facts match
 * (type, country, device). Inside one dimension, any listed value matches; across
 * dimensions, all of them must, the same way the portfolio's own filters work.
 */
import type { CsvRecord } from './csv.ts';
import { BACK, LEAVE, type ClassifiedSession, type Kind, type UmamiEvent, type Visit } from './sessions.ts';

export const kinds: Kind[] = ['real', 'me', 'bot'];

/** Everything a visit can be filtered or broken down by. */
export type Dimension =
  | 'visitor'
  | 'country'
  | 'region'
  | 'city'
  | 'device'
  | 'browser'
  | 'os'
  | 'screen'
  | 'language'
  | 'source'
  | 'referrer'
  | 'entry'
  | 'exit'
  | 'page'
  | 'event'
  | 'weekday'
  | 'hour';

export const dimensionLabels: Record<Dimension, string> = {
  visitor: 'Visitor',
  country: 'Country',
  region: 'Region',
  city: 'City',
  device: 'Device',
  browser: 'Browser',
  os: 'OS',
  screen: 'Screen',
  language: 'Language',
  source: 'Source',
  referrer: 'Referrer',
  entry: 'Entry page',
  exit: 'Exit page',
  page: 'Viewed page',
  event: 'Click event',
  weekday: 'Weekday',
  hour: 'Hour',
};

export interface Filters {
  kinds: Kind[];
  /** YYYY-MM-DD in the report's zone, inclusive. */
  from: string | null;
  to: string | null;
  values: Partial<Record<Dimension, string[]>>;
  /** Free text, matched against the visitor, places, pages and referrer. */
  search: string;
}

export const noFilters = (): Filters => ({ kinds: [...kinds], from: null, to: null, values: {}, search: '' });

/** A visit with what the report needs from its visitor and its clock, worked out once. */
export interface VisitRow {
  visit: Visit;
  session: ClassifiedSession;
  kind: Kind;
  /** YYYY-MM-DD, weekday (Mon..Sun) and hour (00..23) of the visit's start, in the zone. */
  date: string;
  weekday: string;
  hour: string;
  /** Milliseconds from the first event to the last: how long the page stayed open. */
  duration: number;
  /** How long it was actually in view (inViewOf), or null when that wasn't recorded. */
  inView: InView | null;
  steps: Step[];
}

export interface InView {
  time: number;
  /** False when some of it went unrecorded, so time is a floor: "at least". */
  exact: boolean;
}

/**
 * How long a visit's page was in view, as opposed to open in a background tab. Counted
 * from each page load or return to the page going out of view again.
 *
 * Exact when every return was recorded and the visit ends by leaving. Before the tracker
 * sent returns (Nov 25, 2026), a visit shows the page leaving, then more activity with no
 * return in between: the visitor came back at some unknown moment, so that stretch isn't
 * counted and the total is a floor. The same goes for a visit whose last event isn't a
 * leave. Null for a visit with no leave at all, which is every visit from the Umami era.
 */
export function inViewOf(visit: Visit): InView | null {
  const { events } = visit;
  if (!events.some((event) => event.eventType === LEAVE)) return null;
  let time = 0;
  let exact = true;
  let since: number | null = events[0].createdAt.getTime();
  for (const event of events) {
    const at = event.createdAt.getTime();
    if (event.eventType === LEAVE) {
      if (since === null) exact = false; // out of view again, with no return recorded
      else time += at - since;
      since = null;
    } else if (event.eventType === BACK) {
      since ??= at;
    } else if (since === null) {
      // A page or a click while out of view: they came back, but when wasn't recorded.
      exact = false;
      since = at;
    }
  }
  if (since !== null) {
    exact = false;
    time += events[events.length - 1].createdAt.getTime() - since;
  }
  return { time, exact };
}

/** One pageview inside a visit, with how long the next one took to come. */
export interface Step {
  view: UmamiEvent;
  /**
   * Until the next page, or for the last page of a visit, until the visitor left it (a
   * leave event, which the site's own collector sends and Umami never did). Null when
   * there's neither: an Umami-era visit's last page.
   */
  timeOnPage: number | null;
  /** Custom events fired on this page before the next one. */
  events: UmamiEvent[];
}

export const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const clockCache = new Map<string, Intl.DateTimeFormat>();
/** Date, weekday and hour of a moment, as a clock in the zone reads them. */
export function clock(moment: Date, timeZone: string) {
  let format = clockCache.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    clockCache.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(moment).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday, hour: parts.hour };
}

export const pathOf = (view: UmamiEvent) => view.urlPath;

/** Every visit, with its visitor and clock attached. Built once per export. */
export function visitRows(sessions: ClassifiedSession[], timeZone: string): VisitRow[] {
  const rows: VisitRow[] = [];
  for (const session of sessions) {
    for (const visit of session.visits) {
      // The visitor's last leave, if they left after the visit's last page opened.
      const lastView = visit.pageviews.at(-1);
      const leftAt = lastView
        ? visit.events.filter((e) => e.eventType === LEAVE && e.createdAt >= lastView.createdAt).at(-1)?.createdAt
        : undefined;
      const steps: Step[] = visit.pageviews.map((view, i) => {
        const next = visit.pageviews[i + 1];
        const until = next?.createdAt.getTime() ?? Infinity;
        const end = next?.createdAt ?? leftAt;
        return {
          view,
          timeOnPage: end ? end.getTime() - view.createdAt.getTime() : null,
          events: visit.events.filter(
            (event) =>
              event.eventType === 2 &&
              event.createdAt.getTime() >= view.createdAt.getTime() &&
              event.createdAt.getTime() < until
          ),
        };
      });
      rows.push({
        visit,
        session,
        kind: session.kind,
        ...clock(visit.start, timeZone),
        duration: visit.end.getTime() - visit.start.getTime(),
        inView: inViewOf(visit),
        steps,
      });
    }
  }
  return rows.sort((a, b) => a.visit.start.getTime() - b.visit.start.getTime());
}

/** A short, readable name for a visitor: its device and place, and the id's first characters. */
export function visitorLabel(session: ClassifiedSession) {
  const place = session.city || session.country || '?';
  return `${session.browser ?? '?'} · ${session.os ?? '?'} · ${place} · ${session.id.slice(0, 6)}`;
}

/** The values a visit has for a dimension. Most have one; viewed pages and events can have many. */
export function valuesOf(row: VisitRow, dimension: Dimension): string[] {
  const { visit, session } = row;
  const one = (value: string | null | undefined) => [value || '(none)'];
  switch (dimension) {
    case 'visitor': return [session.id];
    case 'country': return one(session.country);
    case 'region': return one(session.region);
    case 'city': return one(session.city);
    case 'device': return one(session.device);
    case 'browser': return one(session.browser);
    case 'os': return one(session.os);
    case 'screen': return one(session.screen);
    case 'language': return one(session.language);
    case 'source': return [visit.source];
    case 'referrer': return one(visit.referrer);
    case 'entry': return one(visit.pageviews[0] && pathOf(visit.pageviews[0]));
    case 'exit': return one(visit.pageviews.at(-1) && pathOf(visit.pageviews.at(-1)!));
    case 'page': return [...new Set(visit.pageviews.map(pathOf))];
    case 'event': return [...new Set(visit.events.filter((e) => e.eventType === 2 && e.eventName).map((e) => e.eventName!))];
    case 'weekday': return [row.weekday];
    case 'hour': return [row.hour];
  }
}

const haystack = (row: VisitRow) =>
  [
    row.session.id,
    row.session.city,
    row.session.region,
    row.session.country,
    row.session.browser,
    row.session.os,
    row.session.language,
    row.visit.referrer,
    row.visit.source,
    row.session.reason,
    ...row.visit.pageviews.map((view) => view.urlPath + (view.urlQuery ? `?${view.urlQuery}` : '')),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

/**
 * The visits that pass. `except` leaves one dimension's own filter out, which is how a
 * breakdown can show every value of that dimension while the rest stay filtered: pick a
 * country and the country list still lists the others to add.
 */
export function applyFilters(rows: VisitRow[], filters: Filters, except?: Dimension): VisitRow[] {
  const search = filters.search.trim().toLowerCase();
  const active = (Object.entries(filters.values) as [Dimension, string[]][]).filter(
    ([dimension, values]) => values.length > 0 && dimension !== except
  );
  return rows.filter((row) => {
    if (!filters.kinds.includes(row.kind)) return false;
    if (filters.from && row.date < filters.from) return false;
    if (filters.to && row.date > filters.to) return false;
    for (const [dimension, wanted] of active) {
      const have = valuesOf(row, dimension);
      if (!wanted.some((value) => have.includes(value))) return false;
    }
    return !search || haystack(row).includes(search);
  });
}

/** The middle value: half above, half below, so one huge outlier barely moves it. */
const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const viewsIn = (rows: VisitRow[]) => rows.reduce((sum, row) => sum + row.visit.pageviews.length, 0);
const timeIn = (rows: VisitRow[]) =>
  rows.reduce((sum, row) => sum + row.steps.reduce((s, step) => s + (step.timeOnPage ?? 0), 0), 0);
const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
/** Every time on a page that could be measured: all views but each visit's last. */
const timedSteps = (rows: VisitRow[]) =>
  rows.flatMap((row) => row.steps.map((step) => step.timeOnPage).filter((time): time is number => time !== null));

export interface Totals {
  views: number;
  visits: number;
  visitors: number;
  bounces: number;
  bounceRate: number;
  viewsPerVisit: number;
  /**
   * How long visits that went past one page lasted. One-page visits are left out: they
   * last 0s by definition, and with most visits bouncing they'd pull the median to 0s.
   * The bounce rate already counts them.
   */
  longerVisits: number;
  medianDuration: number | null;
  averageDuration: number | null;
  /** Time on a page, over every view that could be timed. */
  timedViews: number;
  medianTimeOnPage: number | null;
  averageTimeOnPage: number | null;
  /** Time on every page that could be timed, summed. An Umami-era visit's last page can't be. */
  measuredTime: number;
  byKind: Record<Kind, { views: number; visits: number; visitors: number }>;
}

export function totals(rows: VisitRow[]): Totals {
  const visitors = new Set(rows.map((row) => row.session.id));
  const bounces = rows.filter((row) => row.visit.pageviews.length <= 1).length;
  const byKind = Object.fromEntries(
    kinds.map((kind) => {
      const of = rows.filter((row) => row.kind === kind);
      return [kind, { views: viewsIn(of), visits: of.length, visitors: new Set(of.map((r) => r.session.id)).size }];
    })
  ) as Totals['byKind'];
  const longer = rows.filter((row) => row.visit.pageviews.length > 1).map((row) => row.duration);
  const timed = timedSteps(rows);
  return {
    views: viewsIn(rows),
    visits: rows.length,
    visitors: visitors.size,
    bounces,
    bounceRate: rows.length ? bounces / rows.length : 0,
    viewsPerVisit: rows.length ? viewsIn(rows) / rows.length : 0,
    longerVisits: longer.length,
    medianDuration: median(longer),
    averageDuration: average(longer),
    timedViews: timed.length,
    medianTimeOnPage: median(timed),
    averageTimeOnPage: average(timed),
    measuredTime: timeIn(rows),
    byKind,
  };
}

/** The five headline numbers for the whole export, whatever the filters say. */
export function classificationSummary(sessions: ClassifiedSession[]) {
  const views = (kind?: Kind) =>
    sessions.filter((s) => !kind || s.kind === kind).reduce((sum, s) => sum + s.pageviews.length, 0);
  const all = views();
  return {
    pageviews: all,
    myPageviews: views('me'),
    myShare: all ? views('me') / all : 0,
    botSessions: sessions.filter((s) => s.kind === 'bot').length,
    realSessions: sessions.filter((s) => s.kind === 'real').length,
    realPageviews: views('real'),
  };
}

/* --- over time -------------------------------------------------------------------- */

export type Granularity = 'hour' | 'day' | 'week' | 'month';

export interface Bucket {
  /** The bucket's first day (YYYY-MM-DD), or day and hour for hourly ("2026-10-07 14"). */
  key: string;
  /** First and last day it covers, for filtering by it. */
  from: string;
  to: string;
  views: Record<Kind, number>;
  visits: Record<Kind, number>;
  /** Distinct visitors with a visit starting in the bucket. */
  visitors: Record<Kind, number>;
}

export const addDays = (date: string, days: number) => {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
};

/** The Monday that starts a date's week. */
export const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

const lastOfMonth = (date: string) => {
  const day = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  day.setUTCMonth(day.getUTCMonth() + 1);
  day.setUTCDate(0);
  return day.toISOString().slice(0, 10);
};

function bucketOf(date: string, hour: string, granularity: Granularity) {
  switch (granularity) {
    case 'hour': return { key: `${date} ${hour}`, from: date, to: date };
    case 'day': return { key: date, from: date, to: date };
    case 'week': { const from = mondayOf(date); return { key: from, from, to: addDays(from, 6) }; }
    case 'month': { const from = `${date.slice(0, 7)}-01`; return { key: from, from, to: lastOfMonth(from) }; }
  }
}

const zero = (): Record<Kind, number> => ({ real: 0, me: 0, bot: 0 });

/**
 * Views and visits per bucket, by type, from the first bucket with anything in it to the
 * last, quiet ones included, so a gap in traffic shows as a gap rather than vanishing.
 * With a span, it runs across the whole span instead: "last 7 days" is 7 days wide even
 * when only two of them had visits. Views are placed by when each page was opened,
 * visits by when they started.
 */
export function timeline(rows: VisitRow[], granularity: Granularity, timeZone: string, span: Span = { from: null, to: null }): Bucket[] {
  const buckets = new Map<string, Bucket>();
  const seen = new Map<string, Set<string>>();
  const at = (date: string, hour: string) => {
    const shape = bucketOf(date, hour, granularity);
    let bucket = buckets.get(shape.key);
    if (!bucket) buckets.set(shape.key, (bucket = { ...shape, views: zero(), visits: zero(), visitors: zero() }));
    return bucket;
  };
  for (const row of rows) {
    const bucket = at(row.date, row.hour);
    bucket.visits[row.kind]++;
    const ids = seen.get(bucket.key) ?? new Set<string>();
    if (!ids.has(row.session.id)) {
      ids.add(row.session.id);
      bucket.visitors[row.kind]++;
    }
    seen.set(bucket.key, ids);
    for (const view of row.visit.pageviews) {
      const c = clock(view.createdAt, timeZone);
      at(c.date, c.hour).views[row.kind]++;
    }
  }
  if (buckets.size === 0) return [];
  if (span.from) at(span.from, '00');
  if (span.to) at(span.to, '23');

  // Fill the gaps between the first bucket and the last.
  const keys = [...buckets.keys()].sort();
  const [first, last] = [keys[0], keys[keys.length - 1]];
  if (granularity === 'hour') {
    let [date, hour] = first.split(' ');
    for (let guard = 0; `${date} ${hour}` < last && guard < 24 * 400; guard++) {
      let next = Number(hour) + 1;
      if (next === 24) { next = 0; date = addDays(date, 1); }
      hour = String(next).padStart(2, '0');
      at(date, hour);
    }
  } else {
    let date = first;
    for (let guard = 0; date < last && guard < 2000; guard++) {
      date = addDays(bucketOf(date, '00', granularity).to, 1);
      if (date <= last) at(date, '00');
    }
  }
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** The start of a YYYY-MM-DD day, in milliseconds. */
const dayStart = (date: string) => new Date(`${date}T00:00:00Z`).getTime();

/** The days a chart covers (YYYY-MM-DD, both included). null on a side: as far as the data goes. */
export interface Span {
  from: string | null;
  to: string | null;
}

/**
 * A sensible bucket size, so bars stay countable: from the period picked when there is
 * one, otherwise from how far the data itself goes.
 */
export function autoGranularity(rows: VisitRow[], span: Span = { from: null, to: null }): Granularity {
  const start = span.from ? dayStart(span.from) : rows[0]?.visit.start.getTime();
  const end = span.to ? dayStart(span.to) + 86_400_000 : rows.at(-1)?.visit.start.getTime();
  if (start === undefined || end === undefined) return 'day';
  const days = (end - start) / 86_400_000;
  return days <= 3 ? 'hour' : days <= 75 ? 'day' : days <= 400 ? 'week' : 'month';
}

/** Views by weekday and hour, in the zone: [weekday index Mon=0][hour]. */
export function heatmap(rows: VisitRow[], timeZone: string): number[][] {
  const grid = weekdays.map(() => new Array<number>(24).fill(0));
  for (const row of rows) {
    for (const view of row.visit.pageviews) {
      const c = clock(view.createdAt, timeZone);
      grid[weekdays.indexOf(c.weekday)][Number(c.hour)]++;
    }
  }
  return grid;
}

/* --- breakdowns ------------------------------------------------------------------- */

export interface BreakdownRow {
  value: string;
  visits: number;
  visitors: number;
  views: number;
  time: number;
  byKind: Record<Kind, number>;
}

export type Metric = 'visits' | 'visitors' | 'views' | 'time';
export const metricLabels: Record<Metric, string> = {
  visits: 'Visits',
  visitors: 'Visitors',
  views: 'Views',
  time: 'Time',
};

/**
 * One row per value of a dimension. For "Viewed page" the views and time are that
 * page's own, not the whole visit's; for everything else a visit counts in full.
 */
export function breakdown(rows: VisitRow[], dimension: Dimension, metric: Metric): BreakdownRow[] {
  type Entry = BreakdownRow & { ids: Set<string>; idsByKind: Record<Kind, Set<string>>; perKind: Record<Kind, Record<Metric, number>> };
  const table = new Map<string, Entry>();
  const get = (value: string) => {
    let row = table.get(value);
    if (!row) {
      const perKind = Object.fromEntries(kinds.map((k) => [k, { visits: 0, visitors: 0, views: 0, time: 0 }])) as Entry['perKind'];
      const idsByKind = Object.fromEntries(kinds.map((k) => [k, new Set<string>()])) as Entry['idsByKind'];
      table.set(value, (row = { value, visits: 0, visitors: 0, views: 0, time: 0, byKind: zero(), ids: new Set(), idsByKind, perKind }));
    }
    return row;
  };
  for (const row of rows) {
    for (const value of valuesOf(row, dimension)) {
      const entry = get(value);
      const steps = dimension === 'page' ? row.steps.filter((s) => pathOf(s.view) === value) : row.steps;
      const time = steps.reduce((sum, s) => sum + (s.timeOnPage ?? 0), 0);
      entry.visits++;
      entry.views += steps.length;
      entry.time += time;
      entry.ids.add(row.session.id);
      entry.idsByKind[row.kind].add(row.session.id);
      const mine = entry.perKind[row.kind];
      mine.visits++;
      mine.views += steps.length;
      mine.time += time;
    }
  }
  return [...table.values()]
    .map(({ ids, idsByKind, perKind, ...rest }) => {
      for (const kind of kinds) perKind[kind].visitors = idsByKind[kind].size;
      return {
        ...rest,
        visitors: ids.size,
        byKind: Object.fromEntries(kinds.map((k) => [k, perKind[k][metric]])) as Record<Kind, number>,
      };
    })
    .sort((a, b) => b[metric] - a[metric] || b.visits - a.visits || a.value.localeCompare(b.value));
}

/* --- tables ----------------------------------------------------------------------- */

export interface PageRow {
  path: string;
  views: number;
  visits: number;
  visitors: number;
  entries: number;
  exits: number;
  /** Visits that saw only this page. */
  bounces: number;
  /** Measured time on this page, summed, in ms. */
  time: number;
  /** Average and median over the views that could be timed. */
  averageTime: number | null;
  medianTime: number | null;
  timedViews: number;
  /**
   * Engaged visitors: people who spent at least ENGAGED_MS on the page, all their views of
   * it added up. Each person counts once, so reloading doesn't inflate it, and a tab left
   * open counts once too, however long. The fairest single answer to "which game do
   * people actually read".
   */
  engaged: number;
  engagedByKind: Record<Kind, number>;
}

/** How long someone has to spend on a page to count as engaged with it. */
export const ENGAGED_MS = 30_000;

export function pages(rows: VisitRow[]): PageRow[] {
  const table = new Map<string, PageRow & { visitIds: Set<string>; visitorIds: Set<string>; times: number[]; spent: Map<string, { kind: Kind; ms: number }> }>();
  for (const row of rows) {
    row.steps.forEach((step, i) => {
      const path = pathOf(step.view);
      let page = table.get(path);
      if (!page) {
        table.set(path, (page = {
          path, views: 0, visits: 0, visitors: 0, entries: 0, exits: 0, bounces: 0, time: 0,
          averageTime: null, medianTime: null, timedViews: 0, engaged: 0, engagedByKind: zero(),
          visitIds: new Set(), visitorIds: new Set(), times: [], spent: new Map(),
        }));
      }
      page.views++;
      page.visitIds.add(row.visit.id);
      page.visitorIds.add(row.session.id);
      if (i === 0) page.entries++;
      if (i === row.steps.length - 1) page.exits++;
      if (row.steps.length === 1) page.bounces++;
      if (step.timeOnPage !== null) {
        page.time += step.timeOnPage;
        page.timedViews++;
        page.times.push(step.timeOnPage);
        const person = page.spent.get(row.session.id) ?? { kind: row.kind, ms: 0 };
        person.ms += step.timeOnPage;
        page.spent.set(row.session.id, person);
      }
    });
  }
  return [...table.values()]
    .map(({ visitIds, visitorIds, times, spent, ...page }) => {
      const engagedByKind = zero();
      for (const person of spent.values()) if (person.ms >= ENGAGED_MS) engagedByKind[person.kind]++;
      return {
        ...page,
        visits: visitIds.size,
        visitors: visitorIds.size,
        averageTime: average(times),
        medianTime: median(times),
        engaged: engagedByKind.real + engagedByKind.me + engagedByKind.bot,
        engagedByKind,
      };
    })
    .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path));
}

export interface VisitorRow {
  session: ClassifiedSession;
  label: string;
  visits: number;
  views: number;
  time: number;
  first: Date;
  last: Date;
}

/** One row per visitor with visits in the filtered set. */
export function visitors(rows: VisitRow[]): VisitorRow[] {
  const table = new Map<string, VisitorRow>();
  for (const row of rows) {
    let entry = table.get(row.session.id);
    if (!entry) {
      table.set(row.session.id, (entry = {
        session: row.session, label: visitorLabel(row.session), visits: 0, views: 0, time: 0,
        first: row.visit.start, last: row.visit.end,
      }));
    }
    entry.visits++;
    entry.views += row.visit.pageviews.length;
    entry.time += row.steps.reduce((sum, s) => sum + (s.timeOnPage ?? 0), 0);
    if (row.visit.start < entry.first) entry.first = row.visit.start;
    if (row.visit.end > entry.last) entry.last = row.visit.end;
  }
  return [...table.values()].sort((a, b) => b.last.getTime() - a.last.getTime());
}

/** How long visits lasted, in buckets. A one-page visit lasts 0s by definition. */
export const durationBuckets = [
  { label: 'One page', max: 0 },
  { label: '< 10s', max: 10_000 },
  { label: '10–30s', max: 30_000 },
  { label: '30s–1m', max: 60_000 },
  { label: '1–3m', max: 180_000 },
  { label: '3–10m', max: 600_000 },
  { label: '10–30m', max: 1_800_000 },
  { label: '30m+', max: Infinity },
];

export function durations(rows: VisitRow[]): { label: string; byKind: Record<Kind, number> }[] {
  const out = durationBuckets.map((bucket) => ({ label: bucket.label, byKind: zero() }));
  for (const row of rows) {
    const i = row.visit.pageviews.length <= 1 ? 0 : durationBuckets.findIndex((b, j) => j > 0 && row.duration < b.max);
    out[i === -1 ? out.length - 1 : i].byKind[row.kind]++;
  }
  return out;
}

/* --- portfolio filters and click events ------------------------------------------- */

/** The portfolio filters a pageview's query asked for: ?f=unity,python -> two. */
export function filtersIn(query: string | null) {
  if (!query) return [];
  const list = new URLSearchParams(query.replace(/^\?/, '')).get('f');
  return list ? list.split(',').map((name) => name.trim()).filter(Boolean) : [];
}

/** Search terms typed into the portfolio's search box (?q=). */
export function searchIn(query: string | null) {
  if (!query) return null;
  return new URLSearchParams(query.replace(/^\?/, '')).get('q')?.trim() || null;
}

export interface UsageRow {
  value: string;
  byKind: Record<Kind, number>;
  total: number;
}

const usage = (rows: VisitRow[], read: (query: string | null) => string[]): UsageRow[] => {
  const table = new Map<string, UsageRow>();
  for (const row of rows) {
    for (const view of row.visit.pageviews) {
      for (const value of read(view.urlQuery)) {
        const entry = table.get(value) ?? { value, byKind: zero(), total: 0 };
        entry.byKind[row.kind]++;
        entry.total++;
        table.set(value, entry);
      }
    }
  }
  return [...table.values()].sort((a, b) => b.total - a.total || a.value.localeCompare(b.value));
};

export const filterUsage = (rows: VisitRow[]) => usage(rows, filtersIn);
export const searchUsage = (rows: VisitRow[]) => usage(rows, (q) => { const term = searchIn(q); return term ? [term] : []; });

export interface EventRow {
  name: string;
  byKind: Record<Kind, number>;
  total: number;
  /** Property values seen with it: "game: hotel-77". */
  details: { label: string; count: number }[];
}

/**
 * Custom events: their names come from website_event, their properties from event_data,
 * joined on the event's id.
 */
export function events(rows: VisitRow[], eventData: CsvRecord[] = []): EventRow[] {
  const properties = eventProperties(eventData);
  const table = new Map<string, EventRow & { seen: Map<string, number> }>();
  for (const row of rows) {
    for (const event of row.visit.events) {
      if (event.eventType !== 2 || !event.eventName) continue;
      let entry = table.get(event.eventName);
      if (!entry) table.set(event.eventName, (entry = { name: event.eventName, byKind: zero(), total: 0, details: [], seen: new Map() }));
      entry.byKind[row.kind]++;
      entry.total++;
      for (const detail of properties.get(event.eventId) ?? []) entry.seen.set(detail, (entry.seen.get(detail) ?? 0) + 1);
    }
  }
  return [...table.values()]
    .map(({ seen, ...entry }) => ({
      ...entry,
      details: [...seen.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/* --- one person ------------------------------------------------------------------- */

/** event_data rows as "key: value" lists by the event they belong to. */
export function eventProperties(eventData: CsvRecord[]): Map<string, string[]> {
  const properties = new Map<string, string[]>();
  for (const row of eventData) {
    const id = row.website_event_id ?? row.event_id;
    const value = row.string_value ?? row.number_value ?? row.date_value;
    if (!id || !row.data_key || value === null || value === undefined) continue;
    const list = properties.get(id) ?? [];
    list.push(`${row.data_key}: ${value}`);
    properties.set(id, list);
  }
  return properties;
}

export interface PersonPage {
  path: string;
  views: number;
  time: number;
  /** Click events fired on this page, by name. */
  clicks: number;
}

/** What one visitor did on each page, over all their visits. */
export function personPages(rows: VisitRow[]): PersonPage[] {
  const table = new Map<string, PersonPage>();
  for (const row of rows) {
    for (const step of row.steps) {
      const path = pathOf(step.view);
      const page = table.get(path) ?? { path, views: 0, time: 0, clicks: 0 };
      page.views++;
      page.time += step.timeOnPage ?? 0;
      page.clicks += step.events.length;
      table.set(path, page);
    }
  }
  return [...table.values()].sort((a, b) => b.time - a.time || b.views - a.views || a.path.localeCompare(b.path));
}
