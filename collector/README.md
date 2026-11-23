# Collector

The site's own visit counter: a Cloudflare Worker (`src/index.ts`) that stores events in
a D1 database (`schema.sql`). The tracker on the site (`src/scripts/tracker.ts`) sends to
it, and the `/umami` page reads from it with a key. It replaced Umami Cloud, and follows
Umami's choices wherever there was one to follow (see the top of `src/core.ts`).

Nothing personal is stored: no IP address, no cookie, nothing on the visitor's device.
A visitor is a one-way hash of IP, browser, the month and a secret.

Bots and my own browsers are kept, not dropped, with a `flag` saying why: `me` (switched
with `?no-track`), `webdriver` or `no-screen` (what the tracker saw), `bot-ua` (a
crawler's user agent, seen here). The dashboard hides them by default. What's still
dropped is what isn't the tracker at all: another origin, a malformed body, a page that
isn't on the site.

Reading the data takes two things: the `READ_KEY`, and a browser approved by email. The
first read from a new browser sends an email (through Resend) with Approve and Deny
links, and the browser waits until one is pressed. Three wrong keys from one network in
an hour lock that network out for the rest of the hour.

## Setting it up (once)

From this folder:

```sh
npm install
npx wrangler login                         # opens the browser to sign in to Cloudflare
npx wrangler d1 create portfolio-events    # prints a database_id: paste it into wrangler.toml
npm run schema:remote                      # creates the tables
npx wrangler secret put READ_KEY           # the dashboard's key
npx wrangler secret put SALT_SECRET        # a long random string, never needed again
npx wrangler secret put RESEND_KEY         # Resend API key, sending access only
npx wrangler secret put ALERT_EMAIL        # the Resend account's address: approvals go there
npm run deploy                             # prints the Worker's address
```

Then put the Worker's address (no slash at the end) in `src/config/site.ts`, under
`analytics.collector`, and deploy the site. On `/umami`, connect with the same address
and the `READ_KEY`.

A random string for each secret: `node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"`.

## Changing an existing database

`schema.sql` makes a new database whole. A change to a database that already exists goes
in `migrations/`, one file per change, run once with `--remote` (and `--local` for the dev
database), before deploying the Worker that needs it:

```sh
npx wrangler d1 execute portfolio-events --remote --file migrations/2026-11-23-flag.sql
```

## Working on it

```sh
printf 'READ_KEY=dev-read-key\nSALT_SECRET=dev-salt\nEMAIL_LOG=1\n' > .dev.vars   # EMAIL_LOG: approval emails go to the log
npm run schema:local
npm run dev                      # http://127.0.0.1:8787
npm test                         # the pure logic in src/core.ts
node test/worker.e2e.mjs         # against the running dev Worker
```

## Free plan limits

Workers: 100,000 requests a day. D1: storage and daily row reads and writes are capped,
and on the free plan going over makes requests fail rather than cost money. The site's
traffic is a few hundred events a month, far under all of it.
