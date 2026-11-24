CREATE TABLE allowed_emails (
  email TEXT PRIMARY KEY,
  added_at TEXT NOT NULL
);

-- token_hash is the sha256 of the cookie value; the raw token is never stored.
-- No foreign key to allowed_emails: removal deletes sessions explicitly.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX sessions_email ON sessions (email);
