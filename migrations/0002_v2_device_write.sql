-- A device a human approved in a browser may write; anything else stays
-- read-only. One bit on the row it already has, read on every push.
ALTER TABLE devices ADD COLUMN can_write INTEGER NOT NULL DEFAULT 0;
