/**
 * The rules the analytics report sorts sessions by. Edit these, not the logic: the
 * classifier in sessions.ts only reads what's here.
 *
 * Every value is compared to the export's own spelling, ignoring case. Umami writes
 * browsers in lowercase ("chrome", "opera"), operating systems the way it detects them
 * ("Windows 10", "Android OS"), screens as WIDTHxHEIGHT, and countries as two-letter
 * codes ("SG", "US").
 */

/** One of my devices. A session is mine when every field listed here matches. */
export interface DeviceRule {
  /** Shown as the reason in the report. */
  name: string;
  browsers?: string[];
  os?: string[];
  devices?: string[];
  screens?: string[];
  languages?: string[];
  cities?: string[];
}

export interface ReportConfig {
  /** Every time in the report is shown in this zone, weeks included. */
  timeZone: string;
  /** Referrers from these hosts are the site itself, not a source. */
  siteHosts: string[];
  /**
   * When the site's own collector took over from Umami. From then on, my browsers say
   * so themselves (the ?no-track switch flags every event they send), so a session
   * that starts after it is mine only by its flag.
   */
  collectorSince: string;
  /**
   * My devices, for the visits Umami recorded, which carry no flag. Only sessions that
   * started before collectorSince are checked: after it, a look-alike device is
   * someone else's, the way a guest on my Wi-Fi with the same Chrome would be. Checked
   * before the bot rules, so a match here is never called a bot.
   */
  me: DeviceRule[];
  bots: {
    /**
     * A visit from a datacenter is a bot when it also stayed this short and came with
     * no referrer. A person on a work VPN can look like a datacenter, and the length
     * of the visit is what tells them apart.
     */
    datacenter: {
      countries: string[];
      cities: string[];
      maxPageviews: number;
      requireNoReferrer: boolean;
    };
    /**
     * Screens only a headless browser reports. Enough on their own, whatever the
     * visit looked like: 800x600 is headless Chrome's default, and no monitor anyone
     * browses on today is that size.
     */
    screens: string[];
  };
  /**
   * Referrer hosts that count as LinkedIn. utm_source=linkedin counts too.
   * com.linkedin.android is the Android app, which sends its package name instead.
   */
  linkedinHosts: string[];
  /**
   * Parts of the network names Cloudflare gives hosting companies, matched anywhere in
   * the name, ignoring case. People browse from home and mobile providers, so a visit
   * from one of these is a VPN, a relay or a server (zones.ts vpnHints).
   */
  hostingNetworks: string[];
}

export const reportConfig: ReportConfig = {
  timeZone: 'America/Sao_Paulo',
  siteHosts: ['roger-egito.github.io'],
  // The day the collector went live (commit e8e49af). Umami's last visit is Nov 18,
  // the collector's first is Nov 22, so the boundary falls between them.
  collectorSince: '2026-11-22T00:00:00-03:00',

  me: [
    {
      name: 'My desktop',
      browsers: ['opera', 'chrome'],
      os: ['Windows 10'],
      screens: ['1920x1080'],
      languages: ['en-US'],
      cities: ['Niterói'],
    },
    {
      name: 'My phone',
      browsers: ['chrome'],
      os: ['Android OS'],
      screens: ['393x873'],
      languages: ['pt-BR'],
      // Mobile IPs geolocate loosely, so the city next door counts too.
      cities: ['Niterói', 'Rio de Janeiro'],
    },
    {
      // The desktop's screen, language and city with a phone's browser: Chrome
      // DevTools' device emulation, which changes the browser it reports but not the
      // screen. Delete this if it ever catches someone who isn't me.
      name: 'My desktop, emulating a phone',
      os: ['Android OS'],
      screens: ['1920x1080'],
      languages: ['en-US'],
      cities: ['Niterói'],
    },
    {
      name: 'Blank screen from home',
      screens: ['0x0'],
      cities: ['Niterói'],
    },
  ],

  bots: {
    datacenter: {
      countries: ['SG'],
      cities: ['Council Bluffs', 'Dulles', 'San Jose', 'Charleston', 'Morganton'],
      maxPageviews: 1,
      requireNoReferrer: true,
    },
    screens: ['0x0', '800x600'],
  },

  linkedinHosts: ['linkedin.com', 'lnkd.in', 'com.linkedin.android'],

  // Clouds, server hosts, and the networks commercial VPNs rent from (M247 and
  // Datacamp carry a lot of them). Akamai and Cloudflare also run Apple's iCloud
  // Private Relay and Cloudflare's WARP, which are relays rather than servers, but hide
  // where someone is all the same. A judgment list: add to it as new names show up.
  hostingNetworks: [
    'Amazon', 'Google Cloud', 'Google LLC', 'Microsoft', 'Oracle', 'Alibaba', 'Tencent',
    'DigitalOcean', 'Linode', 'Akamai', 'Vultr', 'Choopa', 'Hetzner', 'OVH', 'Contabo',
    'Leaseweb', 'Hostinger', 'M247', 'Datacamp', 'Cloudflare',
  ],
};
