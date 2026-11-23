-- The collector's tables. Column names match Umami's website_event.csv and
-- event_data.csv, so the dashboard reads both through the same code.
--
-- No IP address is stored anywhere: session_id is a one-way hash (see src/core.ts).

CREATE TABLE IF NOT EXISTS events (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  visit_id        TEXT NOT NULL,
  -- UTC, "YYYY-MM-DD HH:MM:SS.sss", which sorts as text in time order.
  created_at      TEXT NOT NULL,
  -- 1 pageview, 2 click (a named event), 9 page leave. Umami uses 3 to 5 for things
  -- this site doesn't send, so ours skips past them.
  event_type      INTEGER NOT NULL,
  event_name      TEXT,
  hostname        TEXT,
  url_path        TEXT NOT NULL,
  url_query       TEXT,
  referrer_domain TEXT,
  page_title      TEXT,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  browser         TEXT,
  os              TEXT,
  device          TEXT,
  screen          TEXT,
  language        TEXT,
  country         TEXT,
  region          TEXT,
  city            TEXT,
  -- Why the visitor isn't an ordinary one, or null when they are: me (a browser of
  -- Roger's, switched with ?no-track), webdriver or no-screen (what the tracker saw),
  -- bot-ua (a crawler's user agent, seen here). Kept rather than dropped, so the
  -- dashboard filters them out and a wrong call can still be undone.
  flag            TEXT
);

-- The visitor's last event, looked up on every new one to decide the visit.
CREATE INDEX IF NOT EXISTS events_session ON events (session_id, created_at);
-- Reading everything since a moment, for the dashboard.
CREATE INDEX IF NOT EXISTS events_created ON events (created_at);

-- A click's properties: game = hotel-77, store = steam.
CREATE TABLE IF NOT EXISTS event_data (
  event_id     TEXT NOT NULL REFERENCES events (id),
  data_key     TEXT NOT NULL,
  string_value TEXT,
  number_value REAL
);

CREATE INDEX IF NOT EXISTS event_data_event ON event_data (event_id);

-- Wrong read keys, by the network they came from, for the read limit in src/index.ts.
-- requester is a hash like session_id, so no IP is kept here either.
CREATE TABLE IF NOT EXISTS read_failures (
  requester TEXT NOT NULL,
  at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS read_failures_requester ON read_failures (requester, at);

-- Browsers allowed to read the data. Each new one is approved by email once (src/index.ts).
-- device and token are hashes of the id the browser keeps and the link the email holds.
CREATE TABLE IF NOT EXISTS devices (
  device       TEXT PRIMARY KEY,
  -- pending, approved or denied
  status       TEXT NOT NULL,
  -- "Chrome on Windows 10 (laptop), Niterói, BR", as the email described it
  label        TEXT,
  -- only while pending
  token        TEXT,
  -- when the last approval email for it went out
  requested_at TEXT NOT NULL,
  decided_at   TEXT
);

CREATE INDEX IF NOT EXISTS devices_token ON devices (token);

-- When approval emails went out, for the daily cap.
CREATE TABLE IF NOT EXISTS device_emails (
  at TEXT NOT NULL
);
