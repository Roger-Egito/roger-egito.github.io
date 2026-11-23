/**
 * The collector's decisions, kept apart from the Worker so they can be tested in plain
 * Node: what a valid event looks like, how a URL is split, what a browser is called,
 * who a visitor is, and where one visit ends and the next begins.
 *
 * Where Umami already made a choice, this follows it (read from Umami's source on
 * GitHub, November 2026), so the numbers carry on from the Umami era without a seam:
 *
 *   - browser and OS names from detect-browser, device from ua-parser-js, and a desktop
 *     no wider than 1920px called a "laptop" (umami src/lib/detect.ts)
 *   - the path keeps its #hash, the query is split off, utm_* are read out of it, and a
 *     referrer from the site itself is dropped (src/app/api/send/route.ts)
 *   - a visitor is a hash of IP and browser with a salt that changes every month
 *     (src/lib/crypto.ts getSalt, src/lib/collection-session.ts)
 *
 * One place it doesn't: Umami ends a visit 30 minutes after it started, or at the turn
 * of the clock hour across page loads. Here a visit ends after 30 minutes with nothing
 * from that visitor, which is what "a visit" means to anyone reading the numbers.
 */
import { browserName, detectOS } from 'detect-browser';
import { isbot } from 'isbot';
import UAParser from 'ua-parser-js';

/** Event types, matching Umami's for the two it shares. 9 is ours. */
export const EVENT = { pageview: 1, click: 2, leave: 9 } as const;

/** A visit ends after this long with nothing from the visitor. */
export const VISIT_GAP_MS = 30 * 60 * 1000;

/** The longest anything sent is kept, so one request can't fill the database. */
export const LIMIT = {
  body: 4096,
  url: 1000,
  title: 300,
  referrer: 500,
  name: 50,
  key: 50,
  value: 300,
  properties: 10,
} as const;

/**
 * What the tracker may say about its own browser: me (switched with ?no-track),
 * webdriver (under automation) or no-screen (a headless browser).
 */
export const CLIENT_FLAGS = ['me', 'webdriver', 'no-screen'] as const;
export type ClientFlag = (typeof CLIENT_FLAGS)[number];
/** A stored flag: the tracker's, or bot-ua, which only the collector decides. */
export type Flag = ClientFlag | 'bot-ua';

export interface Payload {
  type: 'pageview' | 'event' | 'leave';
  url: string;
  referrer: string | null;
  title: string | null;
  screen: string | null;
  language: string | null;
  /** Only for type "event": the click's name, and its properties. */
  name: string | null;
  data: Record<string, string | number>;
  flag: ClientFlag | null;
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

/**
 * Checks what the tracker sent and keeps only what's expected, cut to size. Anything
 * malformed is null, and the Worker drops it without a word.
 */
export function validate(body: unknown): Payload | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;
  const type = raw.type;
  if (type !== 'pageview' && type !== 'event' && type !== 'leave') return null;
  const url = text(raw.url, LIMIT.url);
  if (!url) return null;
  const name = type === 'event' ? text(raw.name, LIMIT.name) : null;
  if (type === 'event' && !name) return null;

  const data: Record<string, string | number> = {};
  if (type === 'event' && raw.data && typeof raw.data === 'object') {
    for (const [key, value] of Object.entries(raw.data as Record<string, unknown>).slice(0, LIMIT.properties)) {
      const k = text(key, LIMIT.key);
      if (!k) continue;
      if (typeof value === 'number' && Number.isFinite(value)) data[k] = value;
      else {
        const v = text(value, LIMIT.value);
        if (v) data[k] = v;
      }
    }
  }

  const screen = typeof raw.screen === 'string' && /^\d{1,5}x\d{1,5}$/.test(raw.screen) ? raw.screen : null;
  const language = typeof raw.language === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(raw.language) ? raw.language.slice(0, 35) : null;
  // An unknown flag is no flag, not a reason to drop the event: a bad value can only
  // make a visit look ordinary, which is what it would have looked like anyway.
  const flag = CLIENT_FLAGS.find((known) => known === raw.flag) ?? null;
  return { type, url, referrer: text(raw.referrer, LIMIT.referrer), title: text(raw.title, LIMIT.title), screen, language, name, data, flag };
}

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, '');

export interface Place {
  hostname: string;
  /** The path with its #hash, as Umami keeps it: "/#portfolio". */
  urlPath: string;
  /** Without the "?". Empty becomes null. */
  urlQuery: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

/** Splits the page's URL. Null when it isn't a URL on the site itself. */
export function placeOf(url: string, siteHost: string): Place | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (bareHost(parsed.hostname) !== bareHost(siteHost)) return null;
  const get = (key: string) => parsed.searchParams.get(key)?.slice(0, 100) || null;
  let path = parsed.pathname + parsed.hash;
  try {
    path = decodeURI(path);
  } catch {
    // Keep it as sent if it isn't valid percent-encoding.
  }
  return {
    hostname: bareHost(parsed.hostname),
    urlPath: path.slice(0, LIMIT.url),
    urlQuery: parsed.search.slice(1, LIMIT.url + 1) || null,
    utmSource: get('utm_source'),
    utmMedium: get('utm_medium'),
    utmCampaign: get('utm_campaign'),
  };
}

/** The referrer's domain, or null for none and for the site referring to itself. */
export function referrerDomainOf(referrer: string | null, siteHost: string) {
  if (!referrer) return null;
  try {
    const host = bareHost(new URL(referrer).hostname);
    return host && host !== bareHost(siteHost) ? host : null;
  } catch {
    return null;
  }
}

export interface Client {
  browser: string | null;
  os: string | null;
  device: string;
}

/** Browser, OS and device the way Umami names them. */
export function clientOf(userAgent: string, screen: string | null): Client {
  const type = new UAParser(userAgent).getDevice().type || 'desktop';
  const width = screen ? Number(screen.split('x')[0]) : NaN;
  return {
    browser: browserName(userAgent) ?? null,
    os: (detectOS(userAgent) as string | null) ?? null,
    device: type === 'desktop' && width <= 1920 ? 'laptop' : type,
  };
}

/** Crawlers and other automated agents, by their user agent. */
export const isBot = (userAgent: string) => !userAgent || isbot(userAgent);

/**
 * The flag an event is stored with. The user agent comes first: it's seen here, so a
 * page can't talk its way out of it, while the tracker's flag is only its own word.
 */
export const flagOf = (clientFlag: ClientFlag | null, userAgent: string): Flag | null =>
  isBot(userAgent) ? 'bot-ua' : clientFlag;

/** "BR-RJ" from "BR" and "RJ", the way Umami writes a region. */
export function regionOf(country: string | null, region: string | null) {
  if (!country || !region) return null;
  return region.includes('-') ? region : `${country}-${region}`;
}

/** The first day of a moment's month, in UTC: the salt changes when this does. */
export const monthOf = (moment: Date) => moment.toISOString().slice(0, 7);

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

const sha256 = async (parts: string[]) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\n'))));

/**
 * Who a visitor is, without cookies or anything kept on their device: a SHA-256 of a
 * secret, the month, their IP and their browser. The same device on the same network
 * is the same visitor all month, and a new one the next. The secret means nobody who
 * knows an IP can work out its visitor id, and the IP itself is never stored.
 *
 * The flag is part of who they are. Roger's flagged browser and a guest's identical
 * Chrome on the same Wi-Fi would otherwise be one visitor, half flagged. With it, a
 * visitor's events always share one flag, so the dashboard can classify a whole
 * visitor by it. An unflagged id is the same as before flags existed.
 */
export async function visitorOf(secret: string, moment: Date, ip: string, userAgent: string, flag: Flag | null = null) {
  const h = await sha256([secret, monthOf(moment), ip, userAgent, ...(flag ? [flag] : [])]);
  // Shaped like a UUID, the way Umami's session ids are, so ids look alike in the dashboard.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** "2026-11-21 14:03:11.123", UTC, as Umami's exports write created_at. */
export const timestampOf = (moment: Date) => moment.toISOString().replace('T', ' ').replace('Z', '');

const fromTimestamp = (value: string) => new Date(`${value.replace(' ', 'T')}Z`);

/**
 * The visit an event belongs to: the visitor's last visit if their last event was less
 * than 30 minutes ago, otherwise a new one.
 */
export function visitFor(last: { visit_id: string; created_at: string } | null, now: Date, newId: () => string) {
  if (last && now.getTime() - fromTimestamp(last.created_at).getTime() < VISIT_GAP_MS) return last.visit_id;
  return newId();
}

/** The event_data rows for a click's properties. */
export function propertiesOf(eventId: string, data: Record<string, string | number>) {
  return Object.entries(data).map(([key, value]) => ({
    event_id: eventId,
    data_key: key,
    string_value: typeof value === 'string' ? value : null,
    number_value: typeof value === 'number' ? value : null,
  }));
}

/**
 * How many wrong read keys one network may send in an hour. The fourth try, right key
 * or not, is refused until the oldest of the three is an hour old.
 */
export const READ_LIMIT = { failures: 3, windowMs: 60 * 60 * 1000 } as const;

/**
 * The network a request came from, which is what the read limit counts. An IPv4
 * address is one network. An IPv6 home connection is handed a whole /64 to pick
 * addresses from, so counting single IPv6 addresses would let anyone dodge the limit.
 */
export function networkOf(ip: string) {
  if (!ip.includes(':')) return ip;
  const last = ip.split(':').at(-1) ?? '';
  if (last.includes('.')) return last; // an IPv4 address written as IPv6 (::ffff:1.2.3.4)
  const [head, tail] = ip.split('::');
  const front = head ? head.split(':') : [];
  const back = tail === undefined ? [] : tail ? tail.split(':') : [];
  const groups = [...front, ...Array<string>(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back];
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

/** Who is asking for the data, as the read limit sees it: a hash, so no IP is kept. */
export const requesterOf = (secret: string, ip: string) => sha256(['read', secret, networkOf(ip)]);

/** Seconds until a refused network may try again, from its oldest recent failure. */
export function retryAfterOf(oldestFailure: string, now: Date) {
  return Math.max(1, Math.ceil((fromTimestamp(oldestFailure).getTime() + READ_LIMIT.windowMs - now.getTime()) / 1000));
}

/**
 * Every browser that reads the data is approved by email once. An approval link works
 * for an hour, and at most this many approval emails go out a day, so someone with the
 * key can't flood the inbox.
 */
export const DEVICE = { linkTtlMs: 60 * 60 * 1000, emailsPerDay: 10 } as const;

const HEX_64 = /^[0-9a-f]{64}$/;

/** The dashboard's id for its browser: 64 hex characters, made once and kept there. */
export const deviceIdOf = (value: string | null) => (value && HEX_64.test(value) ? value : null);

/** An approval link's token, or a device id, checked the same way. */
export const isToken = (value: string) => HEX_64.test(value);

/** What the collector keeps of a device id and a link token: hashes, never the values. */
export const deviceKeyOf = (secret: string, id: string) => sha256(['device', secret, id]);
export const tokenKeyOf = (token: string) => sha256(['token', token]);

/** "Chrome on Windows 10 (laptop), Niterói, BR": who is asking, for the approval email. */
export function labelOf(userAgent: string, screen: string | null, place: { city?: string; country?: string }) {
  const client = clientOf(userAgent, screen);
  const where = [place.city, place.country && place.country !== 'XX' ? place.country : null].filter(Boolean).join(', ');
  return `${client.browser ?? 'Unknown browser'} on ${client.os ?? 'an unknown system'} (${client.device})${where ? `, ${where}` : ''}`;
}

/** Times in the approval email and page are Roger's own, not UTC. */
export const TIME_ZONE = 'America/Sao_Paulo';

/**
 * "Sun, Nov 22, 2026, 14:32 (Brasília time)": when a browser asked, so Roger can check
 * it against when he opened the dashboard himself. Takes a Date or a stored timestamp.
 */
export function askedAtOf(moment: Date | string) {
  const date = typeof moment === 'string' ? fromTimestamp(moment) : moment;
  const text = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
  return `${text} (Brasília time)`;
}

/** Whether an approval email sent then still has a working link, so no new one is sent. */
export const linkLive = (requestedAt: string, now: Date) => now.getTime() - fromTimestamp(requestedAt).getTime() < DEVICE.linkTtlMs;

/** Compares two secrets without leaking, through timing, how much of a guess was right. */
export async function sameSecret(a: string, b: string) {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0 && a.length > 0;
}
