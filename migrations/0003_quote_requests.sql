-- Quote requests from the home page form (POST /api/quote-request).
-- Same statements the Pages Function runs on first use (functions/_lib/db.js); safe to run more than once.
CREATE TABLE IF NOT EXISTS quote_requests (ref TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', customer_name TEXT NOT NULL, customer_email TEXT NOT NULL, product TEXT NOT NULL, quantity TEXT NOT NULL DEFAULT '', size TEXT NOT NULL DEFAULT '', needed_by TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', shop_email TEXT NOT NULL DEFAULT 'pending', customer_email_status TEXT NOT NULL DEFAULT 'pending', email_error TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS quote_requests_created ON quote_requests (created_at);
