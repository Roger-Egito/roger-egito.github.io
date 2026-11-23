/**
 * Umami's event rows to sessions and visits, and each session to Me, Bot or Real visitor
 * with the reason why. Pure: rows and rules in, plain objects out, no DOM and no storage,
 * so the rules can be tested and changed without a browser.
 *
 * Two levels, the way Umami counts them:
 *
 *   - A session is a visitor: one device on one network, kept for weeks. It's what gets
 *     classified, since a device is either mine, a bot's, or someone else's.
 *   - A visit is one sitting. Umami starts a new one after 30 minutes without activity,
 *     so a session can hold several visits days apart. Durations, paths and time on page
 *     are measured per visit; per session they'd run across the gaps between sittings.
 */
import type { CsvRecord } from './csv.ts';
import type { DeviceRule, ReportConfig } from './config.ts';

/** One row of website_event.csv, typed. */
export interface UmamiEvent {
  sessionId: string;
  visitId: string;
  eventId: string;
  createdAt: Date;
  /** 1 is a pageview, 2 a custom event. */
  eventType: number;
  eventName: string | null;
  urlPath: string;
  urlQuery: string | null;
  referrerDomain: string | null;
  utmSource: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  screen: string | null;
  language: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  /**
   * Why the collector flagged it (collector/schema.sql), or null for an ordinary
   * visitor and for everything Umami recorded.
   */
  flag: string | null;
}

export type Kind = 'me' | 'bot' | 'real';

/** What each of the collector's flags means here, and how the report says it. */
const flags: Record<string, Verdict> = {
  me: { kind: 'me', reason: 'Flagged by the ?no-track switch in this browser' },
  webdriver: { kind: 'bot', reason: 'Flagged by the tracker: a browser under automation' },
  'no-screen': { kind: 'bot', reason: 'Flagged by the tracker: no screen, a headless browser' },
  'bot-ua': { kind: 'bot', reason: 'Flagged by the collector: a crawler’s user agent' },
};

/** One sitting: from arrival to 30 minutes of nothing. */
export interface Visit {
  id: string;
  sessionId: string;
  start: Date;
  end: Date;
  events: UmamiEvent[];
  pageviews: UmamiEvent[];
  /** The outside site this visit came from, or null for none. */
  referrer: string | null;
  source: string;
}

export interface Session {
  id: string;
  start: Date;
  end: Date;
  events: UmamiEvent[];
  pageviews: UmamiEvent[];
  visits: Visit[];
  browser: string | null;
  os: string | null;
  device: string | null;
  screen: string | null;
  language: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  /**
   * The collector's flag. One per session: the flag is part of the visitor id
   * (collector/src/core.ts visitorOf), so a session's events never disagree.
   */
  flag: string | null;
  /** The first outside site the session ever came from, or null for none. */
  referrer: string | null;
  source: string;
}

export interface Verdict {
  kind: Kind;
  reason: string;
}

export type ClassifiedSession = Session & Verdict & {
  /** What the rules said, kept when a hand override changes the verdict. */
  ruled: Verdict;
};

/** created_at is UTC with no zone written on it: "2026-09-22 14:03:11". */
const utc = (value: string) =>
  new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);

export function readEvents(records: CsvRecord[]): UmamiEvent[] {
  return records
    .filter((row) => row.session_id && row.created_at)
    .map((row) => ({
      sessionId: row.session_id!,
      // Older exports without visits: the whole session counts as one.
      visitId: row.visit_id || row.session_id!,
      eventId: row.event_id ?? '',
      createdAt: utc(row.created_at!),
      eventType: Number(row.event_type ?? 1),
      eventName: row.event_name || null,
      urlPath: row.url_path ?? '/',
      urlQuery: row.url_query || null,
      referrerDomain: row.referrer_domain || null,
      utmSource: row.utm_source || null,
      browser: row.browser,
      os: row.os,
      device: row.device,
      screen: row.screen,
      language: row.language,
      country: row.country,
      region: row.region,
      city: row.city,
      // Umami's exports and the imported rows have none.
      flag: row.flag || null,
    }));
}

const host = (domain: string) => domain.toLowerCase().replace(/^www\./, '');

/** LinkedIn, another site by its host, or Direct. */
export function sourceOf(referrer: string | null, utmSource: string | null, config: ReportConfig) {
  const fromLinkedin = (value: string) =>
    config.linkedinHosts.some((name) => value === name || value.endsWith(`.${name}`));
  if (utmSource?.toLowerCase().includes('linkedin')) return 'LinkedIn';
  if (!referrer) return 'Direct';
  const name = host(referrer);
  return fromLinkedin(name) ? 'LinkedIn' : name;
}

/** Groups events by a key, keeping each group in time order. */
function groupBy(events: UmamiEvent[], key: (event: UmamiEvent) => string) {
  const groups = new Map<string, UmamiEvent[]>();
  for (const event of events) {
    const group = groups.get(key(event));
    if (group) group.push(event);
    else groups.set(key(event), [event]);
  }
  for (const group of groups.values()) group.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return groups;
}

export function buildSessions(events: UmamiEvent[], config: ReportConfig): Session[] {
  const ownHost = (domain: string) =>
    config.siteHosts.some((name) => host(domain) === host(name));

  /** The first outside referrer and utm source in a run of events, and what they add up to. */
  const arrivalOf = (sorted: UmamiEvent[]) => {
    const referrer =
      sorted.find((event) => event.referrerDomain && !ownHost(event.referrerDomain))?.referrerDomain ?? null;
    const utmSource = sorted.find((event) => event.utmSource)?.utmSource ?? null;
    return { referrer, source: sourceOf(referrer, utmSource, config) };
  };

  return [...groupBy(events, (event) => event.sessionId).entries()]
    .map(([id, sorted]) => {
      const first = sorted[0];
      const visits: Visit[] = [...groupBy(sorted, (event) => event.visitId).entries()]
        .map(([visitId, inVisit]) => ({
          id: visitId,
          sessionId: id,
          start: inVisit[0].createdAt,
          end: inVisit[inVisit.length - 1].createdAt,
          events: inVisit,
          pageviews: inVisit.filter((event) => event.eventType === 1),
          ...arrivalOf(inVisit),
        }))
        .sort((a, b) => a.start.getTime() - b.start.getTime());
      return {
        id,
        start: first.createdAt,
        end: sorted[sorted.length - 1].createdAt,
        events: sorted,
        pageviews: sorted.filter((event) => event.eventType === 1),
        visits,
        browser: first.browser,
        os: first.os,
        device: first.device,
        screen: first.screen,
        language: first.language,
        country: first.country,
        region: first.region,
        city: first.city,
        flag: first.flag,
        ...arrivalOf(sorted),
      };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Lowercase and without accents, so "Niteroi" from one source matches "Niterói" from
 * another: Umami and Cloudflare don't always write a city the same way.
 */
const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const same = (value: string | null, list: string[]) =>
  value !== null && list.some((entry) => fold(entry) === fold(value));

/** Whether a session matches every field a device rule lists. */
function matchesDevice(session: Session, rule: DeviceRule) {
  const checks: [string | null, string[] | undefined][] = [
    [session.browser, rule.browsers],
    [session.os, rule.os],
    [session.device, rule.devices],
    [session.screen, rule.screens],
    [session.language, rule.languages],
    [session.city, rule.cities],
  ];
  return checks.every(([value, list]) => !list || same(value, list));
}

const describe = (session: Session) =>
  [session.browser, session.os, session.screen, session.language, session.city]
    .map((value) => value ?? '?')
    .join(' · ');

/**
 * The rules' verdict on one session. The collector's flag first, since it's what the
 * browser or the collector knew rather than a guess. Then my devices, for Umami's
 * visits only. Then the bot rules, which still catch a bot with an ordinary browser
 * and screen, in either era. Then real visitor.
 */
export function classify(session: Session, config: ReportConfig): Verdict {
  const flagged = session.flag ? flags[session.flag] : undefined;
  if (flagged) return flagged;

  const umamiEra = session.start < new Date(config.collectorSince);
  const mine = umamiEra ? config.me.find((rule) => matchesDevice(session, rule)) : undefined;
  if (mine) return { kind: 'me', reason: `${mine.name}: ${describe(session)}` };

  const views = `${session.pageviews.length} pageview${session.pageviews.length === 1 ? '' : 's'}`;
  const { datacenter, screens } = config.bots;
  const where = same(session.country, datacenter.countries)
    ? `datacenter country ${session.country}`
    : same(session.city, datacenter.cities)
      ? `datacenter city ${session.city}`
      : null;
  const few = session.pageviews.length <= datacenter.maxPageviews;
  const quiet = !datacenter.requireNoReferrer || !session.referrer;
  if (where && few && quiet) {
    return { kind: 'bot', reason: `${views}, ${session.referrer ? `from ${session.referrer}` : 'no referrer'}, ${where}` };
  }

  if (same(session.screen, screens)) {
    return { kind: 'bot', reason: `Headless screen ${session.screen}, ${views}` };
  }

  return { kind: 'real', reason: `No rule matched: ${describe(session)}` };
}

const labels: Record<Kind, string> = { me: 'Me', bot: 'Bot', real: 'Real visitor' };
export const kindLabel = (kind: Kind) => labels[kind];

/**
 * Classifies every session, then applies the hand overrides on top. An override keeps
 * what the rules said in its reason, so a session I moved still shows why the rules
 * disagreed.
 */
export function classifyAll(
  sessions: Session[],
  config: ReportConfig,
  overrides: Record<string, Kind> = {}
): ClassifiedSession[] {
  return sessions.map((session) => {
    const ruled = classify(session, config);
    const forced = overrides[session.id];
    if (!forced || forced === ruled.kind) return { ...session, ...ruled, ruled };
    return {
      ...session,
      ruled,
      kind: forced,
      reason: `Set by hand. The rules said ${kindLabel(ruled.kind)}: ${ruled.reason}`,
    };
  });
}
