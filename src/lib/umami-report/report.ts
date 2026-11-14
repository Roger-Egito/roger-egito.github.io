/**
 * Classified sessions to the numbers the report shows. Pure, like sessions.ts: the page
 * script hands this plain data to the renderer and nothing here knows there's a page.
 */
import type { CsvRecord } from './csv.ts';
import type { ClassifiedSession, Kind } from './sessions.ts';

export interface WeekBar {
  /** Monday of the week, YYYY-MM-DD in the report's time zone. */
  week: string;
  me: number;
  bot: number;
  real: number;
}

export interface Count {
  label: string;
  count: number;
}

export interface FilterCount {
  filter: string;
  real: number;
  me: number;
}

export interface EventCount {
  name: string;
  count: number;
  /** Property values seen with it, such as the game: "game: hotel-77 (3)". */
  details: Count[];
}

export interface Report {
  totals: {
    pageviews: number;
    myPageviews: number;
    myShare: number;
    botSessions: number;
    realSessions: number;
    realPageviews: number;
  };
  weeks: WeekBar[];
  realSources: Count[];
  realPages: Count[];
  homeOnly: { sessions: number; share: number };
  filters: FilterCount[];
  realEvents: EventCount[];
}

/** YYYY-MM-DD of a moment, as the calendar reads in the given zone. */
export function localDate(moment: Date, timeZone: string) {
  // en-CA writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(moment);
}

/** The Monday that starts a moment's week, in the given zone. */
export function weekOf(moment: Date, timeZone: string) {
  const day = new Date(`${localDate(moment, timeZone)}T00:00:00Z`);
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - sinceMonday);
  return day.toISOString().slice(0, 10);
}

/** The portfolio filters a pageview's query asked for: ?f=unity,python -> two. */
export function filtersIn(query: string | null) {
  if (!query) return [];
  const list = new URLSearchParams(query.replace(/^\?/, '')).get('f');
  return list ? list.split(',').map((name) => name.trim()).filter(Boolean) : [];
}

const tally = (values: string[]): Count[] => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
};

const share = (part: number, whole: number) => (whole ? part / whole : 0);

export function buildReport(
  sessions: ClassifiedSession[],
  timeZone: string,
  eventData: CsvRecord[] = []
): Report {
  const of = (kind: Kind) => sessions.filter((session) => session.kind === kind);
  const real = of('real');
  const pageviewsOf = (list: ClassifiedSession[]) =>
    list.reduce((sum, session) => sum + session.pageviews.length, 0);

  const pageviews = pageviewsOf(sessions);
  const myPageviews = pageviewsOf(of('me'));

  // Every week from the first to the last, empty ones included, so a quiet week shows
  // as a gap rather than disappearing from the chart.
  const weeks = new Map<string, WeekBar>();
  for (const session of sessions) {
    for (const view of session.pageviews) {
      const week = weekOf(view.createdAt, timeZone);
      const bar = weeks.get(week) ?? { week, me: 0, bot: 0, real: 0 };
      bar[session.kind]++;
      weeks.set(week, bar);
    }
  }
  const sortedWeeks = [...weeks.keys()].sort();
  if (sortedWeeks.length > 1) {
    const day = new Date(`${sortedWeeks[0]}T00:00:00Z`);
    const last = sortedWeeks[sortedWeeks.length - 1];
    while (day.toISOString().slice(0, 10) < last) {
      day.setUTCDate(day.getUTCDate() + 7);
      const week = day.toISOString().slice(0, 10);
      if (!weeks.has(week)) weeks.set(week, { week, me: 0, bot: 0, real: 0 });
    }
  }

  const homeOnly = real.filter(
    (session) => session.pageviews.length > 0 && session.pageviews.every((view) => view.urlPath === '/')
  ).length;

  const filters = new Map<string, FilterCount>();
  for (const session of sessions) {
    if (session.kind === 'bot') continue;
    for (const view of session.pageviews) {
      for (const filter of filtersIn(view.urlQuery)) {
        const row = filters.get(filter) ?? { filter, real: 0, me: 0 };
        row[session.kind]++;
        filters.set(filter, row);
      }
    }
  }

  // Custom events live in website_event (their names), with their properties in
  // event_data, joined on the event's id.
  const properties = new Map<string, string[]>();
  for (const row of eventData) {
    const id = row.website_event_id ?? row.event_id;
    const key = row.data_key;
    const value = row.string_value ?? row.number_value ?? row.date_value;
    if (!id || !key || value === null || value === undefined) continue;
    const list = properties.get(id) ?? [];
    list.push(`${key}: ${value}`);
    properties.set(id, list);
  }
  const realEvents = new Map<string, string[]>();
  for (const session of real) {
    for (const event of session.events) {
      if (event.eventType !== 2 || !event.eventName) continue;
      const list = realEvents.get(event.eventName) ?? [];
      list.push(...(properties.get(event.eventId) ?? []));
      realEvents.set(event.eventName, list);
    }
  }
  const eventTotals = tally(
    real.flatMap((session) =>
      session.events.filter((event) => event.eventType === 2 && event.eventName).map((event) => event.eventName!)
    )
  );

  return {
    totals: {
      pageviews,
      myPageviews,
      myShare: share(myPageviews, pageviews),
      botSessions: of('bot').length,
      realSessions: real.length,
      realPageviews: pageviewsOf(real),
    },
    weeks: [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)),
    realSources: tally(real.map((session) => session.source)),
    realPages: tally(real.flatMap((session) => session.pageviews.map((view) => view.urlPath))),
    homeOnly: { sessions: homeOnly, share: share(homeOnly, real.length) },
    filters: [...filters.values()].sort((a, b) => b.real + b.me - (a.real + a.me) || a.filter.localeCompare(b.filter)),
    realEvents: eventTotals.map(({ label, count }) => ({
      name: label,
      count,
      details: tally(realEvents.get(label) ?? []),
    })),
  };
}
