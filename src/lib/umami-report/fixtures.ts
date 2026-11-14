/**
 * A small hand-made export for the tests: a few sessions of each kind, written the way
 * Umami writes website_event.csv (full header, \N for nulls, UTC times).
 */

export const columns = [
  'website_id', 'session_id', 'visit_id', 'event_id', 'hostname', 'browser', 'os', 'device',
  'screen', 'language', 'country', 'region', 'city', 'url_path', 'url_query', 'utm_source',
  'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer_path', 'referrer_query',
  'referrer_domain', 'page_title', 'gclid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id', 'twclid',
  'lcp', 'inp', 'cls', 'fcp', 'ttfb', 'event_type', 'event_name', 'tag', 'distinct_id',
  'created_at', 'job_id',
] as const;

type Column = (typeof columns)[number];
type Row = Partial<Record<Column, string>>;

const device = {
  desktop: { browser: 'opera', os: 'Windows 10', device: 'desktop', screen: '1920x1080', language: 'en-US', country: 'BR', region: 'BR-RJ', city: 'Niterói' },
  phone: { browser: 'chrome', os: 'Android OS', device: 'mobile', screen: '393x873', language: 'pt-BR', country: 'BR', region: 'BR-RJ', city: 'Rio de Janeiro' },
  blank: { browser: 'chrome', os: 'Windows 10', device: 'desktop', screen: '0x0', language: 'en-US', country: 'BR', region: 'BR-RJ', city: 'Niterói' },
  singapore: { browser: 'chrome', os: 'Linux', device: 'desktop', screen: '1920x1080', language: 'en-US', country: 'SG', region: 'SG-01', city: 'Singapore' },
  iowa: { browser: 'chrome', os: 'Windows 10', device: 'desktop', screen: '800x600', language: 'en-US', country: 'US', region: 'US-IA', city: 'Council Bluffs' },
  recruiter: { browser: 'chrome', os: 'Mac OS', device: 'laptop', screen: '1440x900', language: 'pt-BR', country: 'BR', region: 'BR-SP', city: 'São Paulo' },
  lisbon: { browser: 'safari', os: 'iOS', device: 'mobile', screen: '390x844', language: 'pt-PT', country: 'PT', region: 'PT-11', city: 'Lisbon' },
} satisfies Record<string, Row>;

let id = 0;
const view = (session: string, profile: Row, at: string, path: string, extra: Row = {}): Row => ({
  website_id: 'site',
  session_id: session,
  visit_id: `${session}-visit`,
  event_id: `event-${++id}`,
  hostname: 'roger-egito.github.io',
  ...profile,
  url_path: path,
  event_type: '1',
  page_title: 'Roger Egito - Portfolio',
  created_at: at,
  ...extra,
});

export const rows: Row[] = [
  // Me, on the desktop, filtering twice.
  view('me-desktop', device.desktop, '2026-09-22 13:00:00', '/'),
  view('me-desktop', device.desktop, '2026-09-22 13:01:00', '/', { url_query: 'f=unity,python' }),
  view('me-desktop', device.desktop, '2026-09-22 13:02:00', '/games/hotel-77/'),
  // Me, on the phone, from the city next door.
  view('me-phone', device.phone, '2026-09-23 22:30:00', '/'),
  // Me, a blank screen from home.
  view('me-blank', device.blank, '2026-09-24 10:00:00', '/'),
  // Bots: one page, no referrer, datacenter.
  view('bot-sg', device.singapore, '2026-09-25 03:00:00', '/'),
  view('bot-iowa', device.iowa, '2026-10-01 04:00:00', '/'),
  // From a datacenter city, but three pages: a person, not a bot.
  view('real-dulles', { ...device.recruiter, city: 'Dulles', country: 'US' }, '2026-10-02 15:00:00', '/'),
  view('real-dulles', { ...device.recruiter, city: 'Dulles', country: 'US' }, '2026-10-02 15:00:40', '/games/cursed-blight/'),
  view('real-dulles', { ...device.recruiter, city: 'Dulles', country: 'US' }, '2026-10-02 15:02:00', '/about'),
  // A recruiter from LinkedIn who opened a store page. The title has a comma in it.
  view('real-linkedin', device.recruiter, '2026-10-06 12:00:00', '/', { referrer_domain: 'www.linkedin.com', page_title: 'Roger Egito, Portfolio' }),
  view('real-linkedin', device.recruiter, '2026-10-06 12:01:30', '/games/hotel-77/', { url_query: 'f=unity' }),
  view('real-linkedin', device.recruiter, '2026-10-06 12:02:00', '/games/hotel-77/', { event_type: '2', event_name: 'store', event_id: 'store-click' }),
  // Someone who only saw the home page, typed in directly.
  view('real-home', device.lisbon, '2026-10-07 20:00:00', '/'),
  // Me again, the desktop in DevTools' phone emulation: a phone's browser, my screen.
  view('me-emulating', { ...device.desktop, browser: 'chrome', os: 'Android OS', device: 'mobile', city: 'Niterói' }, '2026-10-08 18:00:00', '/'),
  // The recruiter again, two days later, typed in directly: a second visit, same visitor.
  view('real-linkedin', device.recruiter, '2026-10-08 13:00:00', '/', { visit_id: 'real-linkedin-visit-2', url_query: 'q=war' }),
  view('real-linkedin', device.recruiter, '2026-10-08 13:00:20', '/games/memories-of-war/', { visit_id: 'real-linkedin-visit-2' }),
  // A crawler with a headless screen, even though it came with a referrer.
  view('bot-bing', { ...device.recruiter, screen: '800x600', country: 'US', city: '' }, '2026-10-08 19:00:00', '/', { referrer_domain: 'bing.com' }),
];

/** A field as CSV writes it: quoted when it holds a comma, a quote or a line break. */
const field = (value: string | undefined) =>
  value === undefined ? '\\N' : /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** The rows as website_event.csv text. A missing value is written \N. */
export const websiteEventCsv = [
  columns.join(','),
  ...rows.map((row) => columns.map((column) => field(row[column])).join(',')),
].join('\n');

export const eventDataCsv = [
  'website_id,website_event_id,data_key,string_value,number_value,date_value,data_type,created_at',
  'site,store-click,game,hotel-77,\\N,\\N,1,2026-10-06 12:02:00',
  'site,store-click,store,steam,\\N,\\N,1,2026-10-06 12:02:00',
].join('\n');
