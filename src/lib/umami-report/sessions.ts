/**
 * Umami's event rows to sessions, and each session to Me, Bot or Real visitor with the
 * reason why. Pure: rows and rules in, plain objects out, no DOM and no storage, so the
 * rules can be tested and changed without a browser.
 */
import type { CsvRecord } from './csv.ts';
import type { DeviceRule, ReportConfig } from './config.ts';

/** One row of website_event.csv, typed. */
export interface UmamiEvent {
  sessionId: string;
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
}

export type Kind = 'me' | 'bot' | 'real';

export interface Session {
  id: string;
  start: Date;
  end: Date;
  events: UmamiEvent[];
  pageviews: UmamiEvent[];
  browser: string | null;
  os: string | null;
  device: string | null;
  screen: string | null;
  language: string | null;
  country: string | null;
  city: string | null;
  /** The first outside site the session came from, or null for none. */
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

export function buildSessions(events: UmamiEvent[], config: ReportConfig): Session[] {
  const groups = new Map<string, UmamiEvent[]>();
  for (const event of events) {
    const group = groups.get(event.sessionId);
    if (group) group.push(event);
    else groups.set(event.sessionId, [event]);
  }

  const ownHost = (domain: string) =>
    config.siteHosts.some((name) => host(domain) === host(name));

  return [...groups.entries()]
    .map(([id, group]) => {
      const sorted = group.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const first = sorted[0];
      const arrival = sorted.find((event) => event.referrerDomain && !ownHost(event.referrerDomain));
      const referrer = arrival?.referrerDomain ?? null;
      const utmSource = sorted.find((event) => event.utmSource)?.utmSource ?? null;
      return {
        id,
        start: first.createdAt,
        end: sorted[sorted.length - 1].createdAt,
        events: sorted,
        pageviews: sorted.filter((event) => event.eventType === 1),
        browser: first.browser,
        os: first.os,
        device: first.device,
        screen: first.screen,
        language: first.language,
        country: first.country,
        city: first.city,
        referrer,
        source: sourceOf(referrer, utmSource, config),
      };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

const same = (value: string | null, list: string[]) =>
  value !== null && list.some((entry) => entry.toLowerCase() === value.toLowerCase());

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

/** The rules' verdict on one session: me first, then bot, then real visitor. */
export function classify(session: Session, config: ReportConfig): Verdict {
  const mine = config.me.find((rule) => matchesDevice(session, rule));
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
