-- Revocation: a token carries the user's token_version when it is minted and
-- is refused once the user's has moved on (logout bumps it).
--
-- Additive, and safe to run once on a database created from the earlier
-- schema.sql. A database created from the current schema.sql already has the
-- column and must not run this.
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
