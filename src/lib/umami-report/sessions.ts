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
  /** The device's time zone, the IP's, and who runs the IP's network (zones.ts). */
  timeZone: string | null;
  ipTimeZone: string | null;
  network: string | null;
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
  /** The collector's visitor ids this visit's events came under. More than one when ids were joined. */
  ids: string[];
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
  /**
   * The collector's visitor ids joined into this person, earliest first, so ids[0] is id.
   * More than one means the same device showed up under several ids (see mergedIds), and
   * the dashboard notes that it may be more than one person.
   */
  ids: string[];
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
  /** Fixed for a session, which is one device on one IP. */
  timeZone: string | null;
  ipTimeZone: string | null;
  network: string | null;
  /** The first outside site the session ever came from, or null for none. */
  referrer: string | null;
  /**
   * Every way this visitor arrived, in the order each first showed up: "LinkedIn,
   * github.com" for someone who came both ways. Direct only when there's nothing else,
   * since it means no place was recorded, not a place of its own.
   */
  sources: string[];
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
      // Collected since Nov 24, 2026: older rows have none.
      timeZone: row.time_zone || null,
      ipTimeZone: row.ip_time_zone || null,
      network: row.network || null,
    }));
}

const host = (domain: string) => domain.toLowerCase().replace(/^www\./, '');

/**
 * LinkedIn, another site by its host, the link's utm_source, or Direct.
 *
 * The referrer wins over utm_source when there's both: it's where the click actually
 * happened, while the tag is only what the link was labeled with when it was made.
 * Without a referrer the tag is all there is, and it's often there on purpose: ChatGPT
 * sends no referrer but tags the links in its answers utm_source=chatgpt.com.
 */
export function sourceOf(referrer: string | null, utmSource: string | null, config: ReportConfig) {
  const fromLinkedin = (value: string) =>
    config.linkedinHosts.some((name) => value === name || value.endsWith(`.${name}`));
  if (utmSource?.toLowerCase().includes('linkedin')) return 'LinkedIn';
  if (referrer) {
    const name = host(referrer);
    return fromLinkedin(name) ? 'LinkedIn' : name;
  }
  const tag = utmSource?.trim();
  return tag ? host(tag) : 'Direct';
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

/** Event types beyond Umami's pageview (1) and click (2): leaving the page's view, and coming back. */
export const LEAVE = 9;
export const BACK = 10;

/** A visit ends after this long with nothing from the visitor, as the collector counts it (collector/src/core.ts). */
const VISIT_GAP_MS = 30 * 60 * 1000;

/**
 * Everything a visitor id says about the device, which two ids must share in full to be
 * taken for one person. Null when something's missing: too little to go on.
 */
const deviceOf = (event: UmamiEvent) => {
  const parts = [event.browser, event.os, event.device, event.screen, event.language, event.city, event.flag ?? ''];
  return parts.some((part) => part === null) ? null : parts.join('|');
};

/** The shortest time between any event of one sorted list and any of the other. */
function closest(a: UmamiEvent[], b: UmamiEvent[]) {
  let best = Infinity;
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    const gap = a[i].createdAt.getTime() - b[j].createdAt.getTime();
    best = Math.min(best, Math.abs(gap));
    if (gap < 0) i++;
    else j++;
  }
  return best;
}

/**
 * Visitor ids that are almost certainly one person, joined. The collector's id is a hash
 * of the IP and the browser, so a person whose IP changes mid-visit (a phone between
 * networks, a router handing out a new address) becomes two ids, one of them sometimes
 * holding nothing but a click. Two ids are joined when the device matches in full and
 * they were active within a visit's 30 minutes of each other. That can also join two
 * people on one network with identical setups, which is why the dashboard says so
 * wherever it shows a joined person.
 *
 * The earliest id names the joined person, so a person who was never joined keeps the id
 * they always had.
 */
function mergedIds(byId: Map<string, UmamiEvent[]>) {
  const ids = [...byId.keys()];
  const parent = new Map(ids.map((id) => [id, id]));
  const root = (id: string): string => (parent.get(id) === id ? id : root(parent.get(id)!));

  const byDevice = groupBy(ids.map((id) => byId.get(id)![0]), (event) => deviceOf(event) ?? `alone:${event.sessionId}`);
  for (const firsts of byDevice.values()) {
    for (let i = 0; i < firsts.length; i++) {
      for (let j = i + 1; j < firsts.length; j++) {
        const a = firsts[i].sessionId;
        const b = firsts[j].sessionId;
        if (closest(byId.get(a)!, byId.get(b)!) <= VISIT_GAP_MS) parent.set(root(b), root(a));
      }
    }
  }

  const joined = groupBy(
    ids.flatMap((id) => byId.get(id)!),
    (event) => root(event.sessionId),
  );
  return [...joined.values()].map((sorted) => {
    const members = [...new Set(sorted.map((event) => event.sessionId))];
    return { id: members[0], ids: members, sorted };
  });
}

/**
 * A visitor's events as sittings. One id keeps the collector's visits. Joined ids can't,
 * since each id's visits were cut on its own, so their events are cut again the same way
 * the collector does it: a new sitting after 30 quiet minutes.
 *
 * Either way, a sitting that opens by coming back to the page, or by leaving it, is the
 * same page load as the sitting before it: the tab sat in the background past the 30
 * minutes, and the visitor returned to it. It joins that sitting instead of counting as a
 * visit of its own with no page in it.
 */
function sittingsOf(sorted: UmamiEvent[], joined: boolean) {
  const cut: UmamiEvent[][] = [];
  if (joined) {
    for (const event of sorted) {
      const current = cut.at(-1);
      const last = current?.at(-1);
      if (current && last && event.createdAt.getTime() - last.createdAt.getTime() <= VISIT_GAP_MS) current.push(event);
      else cut.push([event]);
    }
  } else {
    cut.push(...groupBy(sorted, (event) => event.visitId).values());
    cut.sort((a, b) => a[0].createdAt.getTime() - b[0].createdAt.getTime());
  }

  const sittings: UmamiEvent[][] = [];
  for (const part of cut) {
    const opensMidPage = part[0].eventType === BACK || part[0].eventType === LEAVE;
    const previous = sittings.at(-1);
    if (opensMidPage && previous) previous.push(...part);
    else sittings.push([...part]);
  }
  return sittings;
}

export function buildSessions(events: UmamiEvent[], config: ReportConfig): Session[] {
  const ownHost = (domain: string) =>
    config.siteHosts.some((name) => host(domain) === host(name));

  const outside = (event: UmamiEvent) =>
    event.referrerDomain && !ownHost(event.referrerDomain) ? event.referrerDomain : null;

  /**
   * Where one event says it came from, or null when it says nothing: a page reached from
   * within the site has no outside referrer and no tag. The referrer and the tag are read
   * off the same event, so one arrival's referrer is never paired with another's tag.
   */
  const arrivalOf = (event: UmamiEvent) => {
    const referrer = outside(event);
    const utm = event.utmSource?.trim() || null;
    if (!referrer && !utm) return null;
    return { referrer, utm, source: sourceOf(referrer, utm, config) };
  };

  /**
   * The collector's visit, cut wherever someone arrives again from somewhere else. The
   * collector only ends a visit after 30 quiet minutes, so coming in from GitHub ten
   * minutes after a LinkedIn visit used to vanish into the LinkedIn one.
   *
   * Not every event that carries a tag is a new arrival, though. Closing a dialog puts
   * the page's own address back, tag included, with no outside referrer, so a tag-only
   * event repeating the tag this stretch arrived with just continues it.
   */
  const stretchesOf = (inVisit: UmamiEvent[]) => {
    const stretches: { events: UmamiEvent[]; source: string | null; utm: string | null }[] = [];
    for (const event of inVisit) {
      const arrival = arrivalOf(event);
      const current = stretches.at(-1);
      const repeatsTag = arrival && current && !arrival.referrer && arrival.utm === current.utm;
      if (current && (!arrival || arrival.source === current.source || repeatsTag)) {
        current.events.push(event);
      } else {
        stretches.push({ events: [event], source: arrival?.source ?? null, utm: arrival?.utm ?? null });
      }
    }
    return stretches;
  };

  return mergedIds(groupBy(events, (event) => event.sessionId))
    .map(({ id, ids, sorted }) => {
      const first = sorted[0];
      const visits: Visit[] = sittingsOf(sorted, ids.length > 1)
        .flatMap((inVisit) =>
          // The first stretch keeps the collector's id, so a visit that wasn't cut is
          // exactly what it was before.
          stretchesOf(inVisit).map(({ events: part, source }, index) => ({
            id: index === 0 ? inVisit[0].visitId : `${inVisit[0].visitId}~${index + 1}`,
            sessionId: id,
            ids: [...new Set(part.map((event) => event.sessionId))],
            start: part[0].createdAt,
            end: part[part.length - 1].createdAt,
            events: part,
            pageviews: part.filter((event) => event.eventType === 1),
            referrer: part.map(outside).find(Boolean) ?? null,
            source: source ?? 'Direct',
          })),
        )
        .sort((a, b) => a.start.getTime() - b.start.getTime());
      const places = [...new Set(visits.map((visit) => visit.source))].filter((source) => source !== 'Direct');
      return {
        id,
        ids,
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
        timeZone: first.timeZone,
        ipTimeZone: first.ipTimeZone,
        network: first.network,
        referrer: sorted.map(outside).find(Boolean) ?? null,
        sources: places.length > 0 ? places : ['Direct'],
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
    // An override set on any of the joined ids still applies to the person.
    const forced = session.ids.map((id) => overrides[id]).find(Boolean);
    if (!forced || forced === ruled.kind) return { ...session, ...ruled, ruled };
    return {
      ...session,
      ruled,
      kind: forced,
      reason: `Set by hand. The rules said ${kindLabel(ruled.kind)}: ${ruled.reason}`,
    };
  });
}
