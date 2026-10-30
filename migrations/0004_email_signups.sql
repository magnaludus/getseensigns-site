-- Email list signups from the site footer (POST /api/email-signup).
-- Same statements the Pages Function runs on first use (functions/_lib/db.js); safe to run more than once.
CREATE TABLE IF NOT EXISTS email_signups (email TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'subscribed', source TEXT NOT NULL DEFAULT '', brevo_status TEXT NOT NULL DEFAULT 'pending', welcome_status TEXT NOT NULL DEFAULT 'pending', promo_code TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS email_signups_created ON email_signups (created_at);
