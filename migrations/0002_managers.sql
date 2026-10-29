-- People allowed to sign in (besides ADMIN_EMAILS). Replaces the Cloudflare Access email policy.
CREATE TABLE IF NOT EXISTS managers (
  email TEXT PRIMARY KEY,
  added_by TEXT,
  added_at TEXT NOT NULL
);
-- Everyone who already had page permissions keeps access.
INSERT OR IGNORE INTO managers (email, added_by, added_at)
  SELECT email, 'migration', strftime('%Y-%m-%dT%H:%M:%SZ', 'now') FROM dashboard_permissions;
