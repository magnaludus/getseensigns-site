# getseensigns-site
Get Seen Signs website - custom signs, banners &amp; branded products (getseensignsco.com)

Site build notes are in [`src/README.md`](src/README.md). The store checkout is described below.

## Store checkout (Phase 1)

Customers still ask for a quote or order through the existing forms. After that, the order runs on Cloudflare
Pages Functions (`functions/`) with one D1 database for records, Stripe for payment and Brevo for email.

```
admin creates order + proof ──► proof email ──► /proof/<token> ──► approve (evidence saved)
                                                      │                    │
                                       revision request (3 free)           ▼
                                                                 Stripe Checkout (tax + shipping + terms)
                                                                          │ webhook
          tracking email ◄── admin adds tracking ◄── paid email ◄─────────┘
                                   /order/<token> shows status at every step
```

| URL | What it is |
|---|---|
| `/proof/<token>` | Proof approval page: proof image(s), order summary and price, name field, required Terms checkbox, Approve button, and a revision form (3 free). |
| `/order/<token>` | Order status page: progress, pay button for approved orders, tracking once shipped. |
| `/admin/` | Private page for the owner (asks for `ADMIN_TOKEN`): create an order + proof, send a new proof, add tracking. |
| `POST /api/admin/orders` | Create an order and proof, email the proof link. Returns the proof link. |
| `GET /api/admin/orders`, `GET /api/admin/orders/<id>` | List orders; full detail with the evidence record and a dispute evidence packet. |
| `POST /api/admin/orders/<id>/proof` | Add a new proof version (after a revision request) and email it. |
| `POST /api/admin/orders/<id>/tracking` | Add carrier + tracking number (paid orders), mark shipped, email the customer. |
| `POST /api/stripe-webhook` | Stripe webhook (signature verified). |

The token in `/proof/<token>` and `/order/<token>` is 256 random bits per order. The pages are `noindex`,
never cached, and the admin endpoints answer 401 without the bearer token (and 503 if `ADMIN_TOKEN` is unset or shorter than 16 characters).

### One-time setup in Cloudflare

1. **D1 database.** Workers & Pages → D1 → *Create database* named `getseensigns-orders`. Then Pages project → Settings → *Bindings* → *Add* → *D1 database*, variable name **`DB`**, for Production (and Preview if you use it). The tables are created automatically on first use; the same SQL is in `migrations/0001_orders.sql` if you prefer `wrangler d1 execute`.
2. **Environment variables** (Pages → Settings → Environment variables → add as *Secret*):

   | Name | Value |
   |---|---|
   | `STRIPE_SECRET_KEY` | Secret key (`sk_live_...` for Production, `sk_test_...` for Preview) from the **Get Seen Signs** Stripe account |
   | `STRIPE_WEBHOOK_SECRET` | The `whsec_...` signing secret of the webhook endpoint below (live and test endpoints have different ones) |
   | `BREVO_API_KEY` | Brevo API key (SMTP & API → API keys) |
   | `ADMIN_TOKEN` | A long random string you choose (at least 16 characters; 32+ recommended). Anyone with it can create orders and add tracking. |

   Optional: `SITE_URL` (`https://getseensignsco.com`) overrides the host used in links. Redeploy after changing variables.
3. **Stripe** (Get Seen Signs account):
   - Developers → Webhooks → *Add endpoint*: **`https://getseensignsco.com/api/stripe-webhook`**
   - Events: **`checkout.session.completed`**, **`checkout.session.async_payment_succeeded`**, **`charge.dispute.created`**. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
   - Settings → Public details → *Terms of service* = `https://getseensignsco.com/terms` (and Privacy `https://getseensignsco.com/privacy`). Checkout is created with the "agree to terms" box required, and Stripe refuses to create it until a Terms URL is saved.
   - Stripe Tax stays on (Alabama registration). Checkout is created with `automatic_tax` on, US-only shipping address, and automatic capture.
4. **Brevo.** Verify the sender `sales@getseensignsco.com` (or the whole domain with DKIM/DMARC) under Senders, Domains & Dedicated IPs. Mail is sent as **Get Seen Signs <sales@getseensignsco.com>**.

Nothing is stored in this repo except code: keys live only in Cloudflare. `wrangler.example.toml` shows the binding for local runs; it is not named `wrangler.toml` on purpose, because a real one would take over the Pages project's dashboard settings (including the designer's `PROOFS` bucket).

### What is saved for each order

`orders`, `proofs` (each version, with the SHA-256 of every proof image taken when the proof is created), `revisions`, `approvals` (below), `shipments`, `emails` (every send, with failures), `disputes`, and `terms_versions`.

**Approval evidence** (`approvals`, one row per order, cannot be updated or deleted): order id, token, evidence id (`EV-...`), proof version, proof file URLs and hashes, name typed by the customer, customer email, approval time (UTC), IP (`CF-Connecting-IP`), browser user agent, the Terms URL, the Terms "last updated" label and the SHA-256 of the exact Terms text shown, the exact agreement sentence ticked, the line items and subtotal, and a hash of the whole record. The Terms text behind each hash is kept in `terms_versions`. If the Terms change while a customer has the page open, the approval is refused and they are asked to read again.

The evidence id, approval time, order id, proof hash and Terms hash are also put in the Stripe Checkout Session `metadata` and in `payment_intent_data.metadata`, so they appear on the payment and charge in Stripe.

**Disputes.** On `charge.dispute.created` the dispute is saved, logged with its evidence record, and emailed to `sales@getseensignsco.com`. `GET /api/admin/orders/<id>` returns an `evidence_packet` of plain text to paste into Stripe's dispute form.

### Catalog and pricing

Line items are `{ "sku": "banner-13oz-3x6", "quantity": 2 }` for items in the Stripe catalog (`functions/_lib/catalog.js`, taken from the account's catalog map), or `{ "name": "Custom wrap", "quantity": 1, "unit_amount_cents": 14900 }` for a custom price. A line with `"sku": "shipping"` is a shipping charge. Catalog SKUs use the saved live Stripe Price IDs. Those IDs do not exist in test mode, so with an `sk_test_` key the same amounts are sent as `price_data`. Custom lines always use `price_data`. Prices exclude tax; Stripe Tax adds it at checkout.

### Create an order from the command line (instead of `/admin/`)

```bash
curl -X POST https://getseensignsco.com/api/admin/orders \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"customer_email":"customer@example.com","customer_name":"Customer Name",
       "line_items":[{"sku":"banner-13oz-3x6","quantity":1}],
       "proof_image_url":"https://example.com/proof.png"}'
# -> {"ok":true,"order_id":"GS-...","proof_url":"https://getseensignsco.com/proof/<token>", "email":{"sent":true}}

curl -X POST https://getseensignsco.com/api/admin/orders/GS-XXXXXXXX/tracking \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"carrier":"UPS","tracking_number":"1Z999AA10123456784"}'
```

The proof image must be a public `https` link to a png, jpeg, webp or gif (20 MB max). It is downloaded once when the proof is created to fix its hash.

### Run a test order

Use a separate Preview deployment so no live key is involved: set the Preview-environment variables to `sk_test_...` keys and a test-mode webhook endpoint (`https://<branch>.getseensigns.pages.dev/api/stripe-webhook`, same three events, its own `whsec_`), and bind a Preview D1 database as `DB`. Create an order for your own email on `/admin/`, open the proof link, tick the box and approve, pay with card `4242 4242 4242 4242` (any future date, any CVC, any ZIP), and confirm you get the "payment received" email and the order page shows *Paid*. Then add tracking and check the "shipped" email. Emails are real; use your own address.

### Tests

```
cd .design-dev
node --test tests/unit/orders.test.mjs
```

Runs in a second with no network and no keys (needs Node 22+). D1 is `node:sqlite`; Stripe and Brevo are faked.

### Not in Phase 1

Uploading proof files from the admin page (use a link), sales-tax collection outside Alabama (Stripe Tax is only registered there), refunds and cancellations (do those in Stripe), automatic submission of dispute evidence, and per-line shipping rates (shipping is free to the lower 48 or a manual `shipping` line).
