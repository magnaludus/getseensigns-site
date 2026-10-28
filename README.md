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
| `/shop/` | Every product with its "from" price and a "Start my order" link. In the main nav (desktop and phone header). |
| `/<product>/#order` | The "Start my order" panel on every product page: options, quantity, price, then design online, upload artwork, or "rather have us design it". |
| `POST /api/order-request` | Where the order panel posts. Creates the order in D1 as `awaiting_proof`, stores the files, emails sales@ and the customer. |
| `POST /api/quote-request` | Where the home page "Get a quote" form posts (`src/site-src-index.tpl.html`, `assets/site.js`). Validates name, email and product (optional quantity, size, needed-by date, details), keeps the `_gotcha` honeypot, a 3 second minimum and 8 requests an hour per IP, saves the request in D1 (`quote_requests`, `migrations/0003_quote_requests.sql`, created automatically on first use), emails sales@ through Brevo with Reply-To the customer, and emails the customer a confirmation with a `QR-XXXXXXXX` reference. Same on/off rule as the designer proof form (`DB` + `BREVO_API_KEY`, `DESIGN_PROOF_ENABLED=false` switches it off). The page opens its pre-filled email only for a server error, a 503 or a request that was saved but not emailed. |
| `/admin/` | Private page for the owner (asks for `ADMIN_TOKEN`): create an order + proof, send a new proof, add tracking. |
| `POST /api/admin/orders` | Create an order and proof, email the proof link. Returns the proof link. |
| `GET /api/admin/orders`, `GET /api/admin/orders/<id>` | List orders; full detail with the evidence record and a dispute evidence packet. |
| `POST /api/admin/orders/<id>/proof` | Add a new proof version (after a revision request) and email it. |
| `POST /api/admin/orders/<id>/tracking` | Add carrier + tracking number (paid orders), mark shipped, email the customer. |
| `POST /api/stripe-webhook` | Stripe webhook (signature verified). |

The token in `/proof/<token>` and `/order/<token>` is 256 random bits per order. The pages are `noindex`,
never cached, and the admin endpoints answer 401 without the bearer token (and 503 if `ADMIN_TOKEN` is unset or shorter than 16 characters).

### Self-serve orders: proof first, then pay

A customer can start an order from any product page (or from the Shop page): they pick the options and quantity from the prices already on the page, choose how the artwork happens (open the designer with those options, upload a logo, or "rather have us design it"), and give their name, email, phone, date and notes. Nothing is charged.

1. `POST /api/order-request` (or a designer proof request, `POST /api/design-proof`, when the design maps to a priced option) saves the request and the files (see `src/README.md`, "Turn on the Pages Function"), creates the order in D1 with status `awaiting_proof` (the order number is the `GS-XXXXXXXX` reference the customer was given), emails `sales@getseensignsco.com` through Brevo, and emails the customer a confirmation: reference, the free proof within 12 hours (7 days a week, 3 revisions), and that nothing is charged or printed until they approve the proof and pay from their proof link. Their `/order/<token>` page says "We are making your proof".
2. In `/admin/` the order shows as **needs proof**. Click it, paste the link to the proof image and send. The customer gets the proof email, approves on `/proof/<token>` and pays through Stripe Checkout, exactly as for orders created by hand. `GET /api/admin/orders/<id>` also returns what the customer sent (phone, date, notes, files).
3. **Prices.** The browser sends only a SKU and a quantity. The server looks every SKU up in `functions/_lib/catalog.js` (the saved Stripe prices) and ignores any amount, name or total in the request. Only the SKUs in `assets/order/catalog.json` can be ordered; the shipping line cannot. Every other SKU in `catalog.js` is on the site. Canopy tents start at the $599 Standard tier, which is the frame, printed top and valance (`tent-standard`), then $849 with a back wall and $1,459 for the full kit.
4. **Where the choices come from.** `src/order_catalog.py` maps each product page's options to a SKU. The build reads each price from `seo_products.py` and **stops** if a SKU's amount in `catalog.js` differs, an offer string is missing, a priced offer on a page has no SKU, or a designer price row has no SKU. It writes `assets/order/catalog.json`, which the panel and the endpoint both read. To add or change a priced option: change Etsy, then `seo_products.py`, then `order_catalog.py` and `catalog.js`, then rebuild.
5. **Upload only.** Challenge coins, Custom Patches and the Trade Show Booth Kit have no designer, so they offer upload or "rather have us design it". The designer's table throw has a third style, the fitted closed-back cover (6 ft $159, 8 ft $179); it reuses the 3-sided front panel size and 3D shape and its print spec rows are marked `UX_DEFAULT` until the printer's fitted template is added.
6. **Custom Patches (`/custom-patches/`).** The page sells through the order panel only: it has no Etsy listing (no `etsy=` id in `seo_products.py`), so it has no "Order on Etsy" button or Etsy links, and its structured-data Offers point at its own page. Prices: 50 PVC patches (3 in) $329 (`patch-pvc-3in-50`), 50 embroidered $239 (`patch-emb-50`), 100 embroidered $309 (`patch-emb-100`), free shipping in the lower 48. Production is about 11 to 15 business days after proof approval (handling 11-15 plus 2-5 transit in the structured data), not the standard 3-8 days. All three SKUs use saved live Stripe Prices in `functions/_lib/catalog.js`. A SKU with an empty `priceId` is billed as `price_data` and must be listed in `PLACEHOLDER_PRICE_IDS` (exported next to `CATALOG`; it is empty today and a unit test checks that it matches the empty `priceId`s). The patch images (`assets/img/p-19-custom-patches.*`, `g-19-custom-patches-2.*`) are plain brand-color graphics made by `src/tools/make_patch_placeholders.py`; replace them with real photos under the same names.
7. **Metal Business Cards (`/metal-business-cards/`, Stripe product `prod_VWQgTGfyDiNrDy`).** Same setup as Custom Patches: no Etsy listing, upload or "rather have us design it" only, Offers point at the page. 0.5 mm, 1 color plus laser etch on both sides; production 2 to 3 weeks after proof approval (handling 10-15 plus 2-5 transit in the structured data), never the standard 3-8 days. Seven saved prices in `catalog.js`: `card-ss-50` $249, `card-ss-100` $299, `card-ss-250` $499 (stainless steel), `card-blk-50` $359, `card-blk-100` $449 (black), `card-gold-100` $329, `card-rosegold-100` $329. The images (`p-20-metal-business-cards.*`, `g-20-metal-business-cards-2.*`) are plain graphics made by `src/tools/make_card_placeholders.py`; replace them with real photos.

**Env vars and D1.** No new variables: it uses `DB`, `BREVO_API_KEY` and `ADMIN_TOKEN`, and turns on with the same rule as the designer proof form (`DESIGN_PROOF_ENABLED=false` switches it off). No new SQL: the order tables from `migrations/0001_orders.sql` and the request tables from `migrations/0002_design_proof_requests.sql` are all it needs; `awaiting_proof` is just a new status value.

### Response headers (`_headers`)

`_headers` at the repo root is hand-written (the Python build never touches it) and Cloudflare Pages applies it to static files: `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` plus `Content-Security-Policy: frame-ancestors 'none'` (frame-ancestors only, no full CSP, so the 3D designer and the Stripe redirect cannot break), a minimal `Permissions-Policy`, `Strict-Transport-Security: max-age=300` (5 minutes, no includeSubDomains, no preload; raise it later once the site has run on HTTPS for a while), and `Cache-Control: no-store` on `/proof/*`, `/order/*` and `/admin*`. The proof and order pages come from Functions, which set their own frame, CSP and no-store headers (`functions/_lib/util.js`), because `_headers` does not apply to Function responses.

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

**Approval evidence** (`approvals`, one row per order, cannot be updated or deleted): order id, token, evidence id (`EV-...`), proof version, proof file URLs and hashes, name typed by the customer, customer email, approval time (UTC), IP (`CF-Connecting-IP`), browser user agent, the Terms URL, the Terms "last updated" label and the SHA-256 of the exact Terms text shown, the exact agreement sentence ticked ("I approve this proof and agree to the Terms of Service", with "Terms of Service" linking to /terms, shown above the button that continues to payment), the line items and subtotal, and a hash of the whole record. The Terms text behind each hash is kept in `terms_versions`. If the Terms change while a customer has the page open, the approval is refused and they are asked to read again.

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
