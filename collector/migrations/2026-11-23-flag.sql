-- Adds events.flag to a database made before it existed. Run once per database:
--   npx wrangler d1 execute portfolio-events --remote --file migrations/2026-11-23-flag.sql
-- A database made from schema.sql after this date already has it.
ALTER TABLE events ADD COLUMN flag TEXT;
