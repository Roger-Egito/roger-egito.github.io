/**
 * The visitor's own clock, and what it hints about how they connect. Pure: dates and
 * names in, numbers and sentences out, so it's tested in plain Node.
 *
 * The collector keeps two zones for each visitor: the one their device is set to, and
 * the one Cloudflare places their IP in. The device's zone is their actual clock, so
 * it's what "their time" means here. When the two disagree, the device is somewhere
 * the IP isn't, which is what a VPN or a proxy looks like. So is a traveler who kept
 * their home clock, or a bad IP lookup. Hence "hints", never a verdict.
 *
 * Zones are compared by their offset at the moment, not by name: America/Bahia and
 * America/Sao_Paulo are different names for the same clock.
 */
import type { ReportConfig } from './config.ts';

/** What zones.ts reads from a session. */
export interface Clocked {
  start: Date;
  timeZone: string | null;
  ipTimeZone: string | null;
  network: string | null;
}

const offsetFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * Minutes ahead of UTC that a zone's clocks were at a moment: -360 for Chicago in
 * winter. Null for a zone Intl doesn't know.
 */
export function offsetOf(moment: Date, zone: string): number | null {
  let format = offsetFormats.get(zone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
    } catch {
      return null;
    }
    offsetFormats.set(zone, format);
  }
  // "GMT-06:00", or plain "GMT" for UTC itself.
  const name = format.formatToParts(moment).find((part) => part.type === 'timeZoneName')?.value ?? '';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return name === 'GMT' ? 0 : null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

/** "UTC−06:00", "UTC+05:30", "UTC". */
export function offsetLabel(minutes: number) {
  if (minutes === 0) return 'UTC';
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** The visitor's own zone: the device's, or the IP's when the device sent none. */
export const localZoneOf = (session: Clocked) => session.timeZone ?? session.ipTimeZone;

/**
 * The visitor's zone when their clock showed a different time than mine at that
 * moment, or null when it showed the same or isn't known. Only then is "their time"
 * worth showing.
 */
export function otherClock(moment: Date, session: Clocked, mine: string) {
  const theirs = localZoneOf(session);
  if (!theirs) return null;
  const a = offsetOf(moment, theirs);
  const b = offsetOf(moment, mine);
  return a !== null && b !== null && a !== b ? theirs : null;
}

const fold = (value: string) => value.toLowerCase();

/** Why this visitor might be on a VPN or a proxy, in sentences. Empty when nothing hints at it. */
export function vpnHints(session: Clocked, config: ReportConfig): string[] {
  const hints: string[] = [];
  const { timeZone, ipTimeZone, network, start } = session;
  if (timeZone && ipTimeZone) {
    const device = offsetOf(start, timeZone);
    const ip = offsetOf(start, ipTimeZone);
    if (device !== null && ip !== null && device !== ip) {
      hints.push(`The device's clock is set to ${timeZone} (${offsetLabel(device)}), but the IP is placed in ${ipTimeZone} (${offsetLabel(ip)}).`);
    }
  }
  if (network && config.hostingNetworks.some((name) => fold(network).includes(fold(name)))) {
    hints.push(`The network is ${network}, a hosting company, not a home or mobile provider.`);
  }
  return hints;
}
