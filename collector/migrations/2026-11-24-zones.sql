-- Adds the visitor's time zones and network to a database made before them. Run once per
-- database:
--   npx wrangler d1 execute portfolio-events --remote --file migrations/2026-11-24-zones.sql
-- A database made from schema.sql after this date already has them.
ALTER TABLE events ADD COLUMN time_zone TEXT;
ALTER TABLE events ADD COLUMN ip_time_zone TEXT;
ALTER TABLE events ADD COLUMN network TEXT;
