-- Designer proof requests (POST /api/design-proof) and the files that did not fit in the email.
-- Same statements the Pages Function runs on first use (functions/_lib/db.js); safe to run more than once.
CREATE TABLE IF NOT EXISTS design_proof_requests (ref TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, mode TEXT NOT NULL, customer_name TEXT NOT NULL, customer_email TEXT NOT NULL, request_json TEXT NOT NULL, design_json TEXT, files_json TEXT NOT NULL, shop_email TEXT NOT NULL DEFAULT 'pending', customer_email_status TEXT NOT NULL DEFAULT 'pending', email_error TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS design_proof_requests_created ON design_proof_requests (created_at);
CREATE TABLE IF NOT EXISTS design_proof_files (ref TEXT NOT NULL, name TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, bytes INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (ref, name, seq));
