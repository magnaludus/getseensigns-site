-- Reorder requests from /reorder/ (POST /api/reorder-request).
-- Same statements the Pages Function runs on first use (functions/_lib/db.js); safe to run more than once.
CREATE TABLE IF NOT EXISTS reorder_requests (ref TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', org_name TEXT NOT NULL, customer_name TEXT NOT NULL DEFAULT '', customer_email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', previous_order TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', shop_email TEXT NOT NULL DEFAULT 'pending', customer_email_status TEXT NOT NULL DEFAULT 'pending', email_error TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS reorder_requests_created ON reorder_requests (created_at);
