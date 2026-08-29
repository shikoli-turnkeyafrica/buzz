-- Per-channel minute-book latch: once a channel is marked as the minute
-- book, it can never be un-marked. `minute_book IS TRUE` is a permanent,
-- one-way commitment enforced at the database layer (not just app logic).
ALTER TABLE channels ADD COLUMN minute_book BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION forbid_minute_book_unlatch() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'minute_book is a one-way latch and cannot be disabled';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_forbid_minute_book_unlatch
    BEFORE UPDATE ON channels
    FOR EACH ROW
    WHEN (OLD.minute_book IS TRUE AND NEW.minute_book IS FALSE)
    EXECUTE FUNCTION forbid_minute_book_unlatch();
