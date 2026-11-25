/**
 * The site's analytics collector, as a Cloudflare Worker.
 *
 *   POST /e           the tracker on the site sends one event (a pageview, a click, or the
 *                     visitor leaving a page). Answers 204 whether it kept it or not.
 *                     Bots and Roger's own browsers are kept with a flag, not dropped.
 *                     What's dropped is what isn't the tracker at all: another origin,
 *                     a malformed body, a page that isn't on the site.
 *   GET  /v1/export   the dashboard reads events back, with the read key. Rows use
 *                     Umami's column names, so the dashboard reads them like an export.
 *   GET  /v1/health   is it up.
 *   GET/POST /v1/device   where the approval email's links lead: approve or deny a new
 *                     browser. Every browser that reads must be approved once.
 *
 * Location, the IP's time zone and who runs its network all come from Cloudflare
 * itself (request.cf), so there's no IP database to keep, and no IP address is ever
 * stored: the visitor id is a one-way hash (core.ts).
 */
import {
  DEVICE, EVENT, LIMIT, READ_LIMIT, askedAtOf, clientOf, deviceIdOf, deviceKeyOf, flagOf, isToken, labelOf, linkLive, placeOf,
  networkNameOf, propertiesOf, referrerDomainOf, regionOf, requesterOf, retryAfterOf, sameSecret, timestampOf, tokenKeyOf, validate,
  visitFor, visitorOf, zoneOf,
} from './core.ts';

export interface Env {
  DB: D1Database;
  /** The dashboard's key for reading. A secret. */
  READ_KEY: string;
  /** Mixed into every visitor id so ids can't be worked out from an IP. A secret. */
  SALT_SECRET: string;
  SITE_ORIGIN: string;
  /** Resend API key (sending access only), for the approval emails. A secret. */
  RESEND_KEY?: string;
  /** Where approval emails go: the Resend account's own address. A secret. */
  ALERT_EMAIL?: string;
  /** "1" in .dev.vars only: approval emails are written to the console instead of sent. */
  EMAIL_LOG?: string;
}

const cors = (env: Env, extra: Record<string, string> = {}) => ({
  'Access-Control-Allow-Origin': env.SITE_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Device',
  'Access-Control-Max-Age': '86400',
  // So the dashboard can say how long a refused network has to wait.
  'Access-Control-Expose-Headers': 'Retry-After',
  Vary: 'Origin',
  ...extra,
});

const json = (env: Env, body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: cors(env, { 'Content-Type': 'application/json', ...extra }) });

/** Nothing to say back: the tracker never reads the answer. */
const done = (env: Env) => new Response(null, { status: 204, headers: cors(env) });

async function collect(request: Request, env: Env) {
  // Browsers always send Origin on a cross-site POST. Something without it, or from
  // another site, isn't the tracker.
  if (request.headers.get('Origin') !== env.SITE_ORIGIN) return done(env);

  const raw = await request.text();
  if (raw.length > LIMIT.body) return done(env);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return done(env);
  }
  const payload = validate(body);
  const siteHost = new URL(env.SITE_ORIGIN).hostname;
  const place = payload && placeOf(payload.url, siteHost);
  if (!payload || !place) return done(env);

  const now = new Date();
  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  const userAgent = request.headers.get('User-Agent') ?? '';
  // Bots and Roger's own browsers are kept, flagged, for the dashboard to filter.
  const flag = flagOf(payload.flag, userAgent);
  const visitor = await visitorOf(env.SALT_SECRET, now, ip, userAgent, flag);
  const last = await env.DB.prepare('SELECT visit_id, created_at FROM events WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(visitor)
    .first<{ visit_id: string; created_at: string }>();
  const visit = visitFor(last, now, () => crypto.randomUUID());

  const client = clientOf(userAgent, payload.screen);
  const cf = (request.cf ?? {}) as { country?: string; regionCode?: string; city?: string; timezone?: string; asOrganization?: string };
  const country = cf.country && cf.country !== 'XX' ? cf.country : null;
  const id = crypto.randomUUID();
  // The tracker calls a click an "event"; every other type has the same name here.
  const type = EVENT[payload.type === 'event' ? 'click' : payload.type];

  const insert = env.DB.prepare(
    `INSERT INTO events (id, session_id, visit_id, created_at, event_type, event_name, hostname, url_path, url_query,
       referrer_domain, page_title, utm_source, utm_medium, utm_campaign, browser, os, device, screen, language,
       country, region, city, flag, time_zone, ip_time_zone, network)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, visitor, visit, timestampOf(now), type, payload.name, place.hostname, place.urlPath, place.urlQuery,
    referrerDomainOf(payload.referrer, siteHost), payload.title, place.utmSource, place.utmMedium, place.utmCampaign,
    client.browser, client.os, client.device, payload.screen, payload.language,
    country, regionOf(country, cf.regionCode ?? null), cf.city ?? null, flag,
    payload.timeZone, zoneOf(cf.timezone), networkNameOf(cf.asOrganization)
  );
  const properties = propertiesOf(id, payload.data).map((row) =>
    env.DB.prepare('INSERT INTO event_data (event_id, data_key, string_value, number_value) VALUES (?, ?, ?, ?)').bind(
      row.event_id, row.data_key, row.string_value, row.number_value
    )
  );
  await env.DB.batch([insert, ...properties]);
  return done(env);
}

/** Pages of this many events at most, oldest first, so a big read never times out. */
const PAGE = 5000;

/**
 * The read key's door: three wrong keys from one network in an hour, and that network
 * is refused, right key or not, until the oldest of them is an hour old. Checked before
 * the key, so a guesser learns nothing once refused. A right key clears the count.
 */
async function admit(request: Request, env: Env): Promise<Response | null> {
  const now = new Date();
  const requester = await requesterOf(env.SALT_SECRET, request.headers.get('CF-Connecting-IP') ?? '');
  const windowStart = timestampOf(new Date(now.getTime() - READ_LIMIT.windowMs));
  const recent = await env.DB.prepare('SELECT COUNT(*) AS failures, MIN(at) AS oldest FROM read_failures WHERE requester = ? AND at > ?')
    .bind(requester, windowStart)
    .first<{ failures: number; oldest: string | null }>();
  const failures = recent?.failures ?? 0;
  if (failures >= READ_LIMIT.failures && recent?.oldest) {
    return json(env, { error: 'Too many wrong keys from this network.' }, 429, { 'Retry-After': String(retryAfterOf(recent.oldest, now)) });
  }

  const key = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!(await sameSecret(key, env.READ_KEY))) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO read_failures (requester, at) VALUES (?, ?)').bind(requester, timestampOf(now)),
      // Failures older than the window no longer count for anyone.
      env.DB.prepare('DELETE FROM read_failures WHERE at <= ?').bind(windowStart),
    ]);
    return json(env, { error: 'Wrong or missing key.' }, 401);
  }
  if (failures > 0) await env.DB.prepare('DELETE FROM read_failures WHERE requester = ?').bind(requester).run();
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The second door, after the key: the browser itself must be one Roger approved. The
 * dashboard sends its device id with every read. An unknown one gets refused, and an
 * email goes to Roger with a link to approve or deny it. The browser waits until then.
 */
async function approved(request: Request, env: Env): Promise<Response | null> {
  const id = deviceIdOf(request.headers.get('X-Device'));
  if (!id) return json(env, { status: 'no-device', error: 'This browser sent no device id.' }, 403);
  const device = await deviceKeyOf(env.SALT_SECRET, id);
  const row = await env.DB.prepare('SELECT status, requested_at FROM devices WHERE device = ?')
    .bind(device)
    .first<{ status: string; requested_at: string }>();
  if (row?.status === 'approved') return null;
  if (row?.status === 'denied') return json(env, { status: 'denied', error: 'This browser was denied.' }, 403);

  const pending = () => json(env, { status: 'pending', error: 'This browser is waiting for approval by email.' }, 403);
  const now = new Date();
  // Still waiting on a link that works: no second email.
  if (row && linkLive(row.requested_at, now)) return pending();

  const dayAgo = timestampOf(new Date(now.getTime() - DAY_MS));
  const sent = await env.DB.prepare('SELECT COUNT(*) AS emails FROM device_emails WHERE at > ?').bind(dayAgo).first<{ emails: number }>();
  if ((sent?.emails ?? 0) >= DEVICE.emailsPerDay) {
    return json(env, { status: 'capped', error: 'Too many approval emails today.' }, 403);
  }

  const token = randomToken();
  const cf = (request.cf ?? {}) as { country?: string; city?: string };
  const label = labelOf(request.headers.get('User-Agent') ?? '', null, cf);
  if (!(await sendApproval(env, new URL(request.url).origin, token, label, askedAtOf(now)))) {
    return json(env, { status: 'email-failed', error: 'The approval email couldn’t be sent.' }, 502);
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO devices (device, status, label, token, requested_at) VALUES (?, 'pending', ?, ?, ?)
       ON CONFLICT (device) DO UPDATE SET status = 'pending', label = excluded.label, token = excluded.token,
         requested_at = excluded.requested_at`
    ).bind(device, label, await tokenKeyOf(token), timestampOf(now)),
    env.DB.prepare('INSERT INTO device_emails (at) VALUES (?)').bind(timestampOf(now)),
    env.DB.prepare('DELETE FROM device_emails WHERE at <= ?').bind(dayAgo),
  ]);
  return pending();
}

/** Emails Roger the approve and deny links for a new browser, through Resend. */
async function sendApproval(env: Env, origin: string, token: string, label: string, askedAt: string) {
  const link = (action: 'approve' | 'deny') => `${origin}/v1/device?action=${action}&token=${token}`;
  if (env.EMAIL_LOG === '1') {
    console.log(`[approval email] ${label}\n  asked: ${askedAt}\n  approve: ${link('approve')}\n  deny: ${link('deny')}`);
    return true;
  }
  if (!env.RESEND_KEY || !env.ALERT_EMAIL) {
    console.log('Approval email not sent: RESEND_KEY or ALERT_EMAIL is missing.');
    return false;
  }
  const text = [
    'A browser asked to read your portfolio’s visit data, with the right key:',
    '',
    `  ${label}`,
    `  Asked ${askedAt}`,
    '',
    `Approve: ${link('approve')}`,
    `Deny: ${link('deny')}`,
    '',
    'Only approve if you opened the dashboard yourself at that time.',
    'The links work for an hour. If this wasn’t you, deny it and change READ_KEY.',
  ].join('\n');
  const html = `<p>A browser asked to read your portfolio’s visit data, with the right key:</p>
<p><strong>${escapeHtml(label)}</strong><br>Asked ${escapeHtml(askedAt)}</p>
<p><a href="${link('approve')}">Approve</a> &nbsp; <a href="${link('deny')}">Deny</a></p>
<p>Only approve if you opened the dashboard yourself at that time.<br>
The links work for an hour. If this wasn’t you, deny it and change READ_KEY.</p>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Portfolio data <onboarding@resend.dev>', to: [env.ALERT_EMAIL], subject: `Approve a browser? ${label}`, text, html }),
  });
  if (!response.ok) console.log(`Resend answered ${response.status}: ${await response.text()}`);
  return response.ok;
}

/** A small page for the approval links, on the Worker's own address. */
function page(title: string, body: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><style>
body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#1d2433;background:#f6f7f9}
@media (prefers-color-scheme:dark){body{color:#e6e8ec;background:#14171c}}
button{font:inherit;padding:.5rem 1.1rem;border-radius:8px;border:1px solid #888;cursor:pointer}
</style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // The page has the token in its address: nothing else loads, nothing is sent on.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Where the email's links lead. Opening a link only shows what it would do: the choice
 * is made by pressing the button. Mail providers and security scanners open links in
 * emails on their own, and a link that approved on opening would approve for them.
 */
async function decide(request: Request, env: Env) {
  const url = new URL(request.url);
  const form = request.method === 'POST' ? await request.formData() : null;
  const token = String(form?.get('token') ?? url.searchParams.get('token') ?? '');
  const action = String(form?.get('action') ?? url.searchParams.get('action') ?? '');
  if (!isToken(token) || (action !== 'approve' && action !== 'deny')) {
    return page('That link isn’t valid', '<p>Check that the whole link from the email was opened.</p>', 400);
  }
  const row = await env.DB.prepare("SELECT device, label, requested_at FROM devices WHERE token = ? AND status = 'pending'")
    .bind(await tokenKeyOf(token))
    .first<{ device: string; label: string; requested_at: string }>();
  const now = new Date();
  if (!row || !linkLive(row.requested_at, now)) {
    return page(
      'This link no longer works',
      '<p>It was already used, or it’s more than an hour old. Opening the dashboard again in that browser sends a new email.</p>',
      410
    );
  }
  const label = escapeHtml(row.label);
  if (request.method === 'GET') {
    const verb = action === 'approve' ? 'Approve' : 'Deny';
    return page(
      `${verb} this browser?`,
      `<p><strong>${label}</strong><br>Asked ${escapeHtml(askedAtOf(row.requested_at))}</p>
<p>${action === 'approve' ? 'It will be able to read all the visit data.' : 'It won’t be able to read the data, even with the key.'}</p>
<form method="post"><input type="hidden" name="token" value="${token}"><input type="hidden" name="action" value="${action}">
<button type="submit">${verb}</button></form>`
    );
  }
  await env.DB.prepare('UPDATE devices SET status = ?, token = NULL, decided_at = ? WHERE device = ?')
    .bind(action === 'approve' ? 'approved' : 'denied', timestampOf(now), row.device)
    .run();
  return action === 'approve'
    ? page('Approved', `<p><strong>${label}</strong> can read the data now. Reload the dashboard in that browser.</p>`)
    : page('Denied', `<p><strong>${label}</strong> can’t read the data. If that wasn’t you, change READ_KEY.</p>`);
}

async function exportEvents(request: Request, env: Env) {
  const refused = (await admit(request, env)) ?? (await approved(request, env));
  if (refused) return refused;

  const since = new URL(request.url).searchParams.get('since') ?? '';
  const { results: events } = await env.DB.prepare(
    `SELECT id AS event_id, session_id, visit_id, created_at, event_type, event_name, hostname, url_path, url_query,
       referrer_domain, page_title, utm_source, utm_medium, utm_campaign, browser, os, device, screen, language,
       country, region, city, flag, time_zone, ip_time_zone, network
     FROM events WHERE created_at > ? ORDER BY created_at LIMIT ?`
  )
    .bind(since, PAGE)
    .all<Record<string, string | number | null>>();

  const last = events.at(-1)?.created_at as string | undefined;
  const { results: data } = last
    ? await env.DB.prepare(
        `SELECT d.event_id AS website_event_id, d.data_key, d.string_value, d.number_value
         FROM event_data d JOIN events e ON e.id = d.event_id
         WHERE e.created_at > ? AND e.created_at <= ?`
      )
        .bind(since, last)
        .all<Record<string, string | number | null>>()
    : { results: [] };

  // A full page means there may be more: the next read starts after its last event.
  return json(env, { website_event: events, event_data: data, next: events.length === PAGE ? last : null });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
    if (request.method === 'POST' && pathname === '/e') return collect(request, env);
    if (request.method === 'GET' && pathname === '/v1/export') return exportEvents(request, env);
    if (request.method === 'GET' && pathname === '/v1/health') return json(env, { ok: true });
    if ((request.method === 'GET' || request.method === 'POST') && pathname === '/v1/device') return decide(request, env);
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
