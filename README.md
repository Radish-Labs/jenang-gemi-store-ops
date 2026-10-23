# Jenang Gemi Store Ops

Website order ingestion starts disabled. The Executive Dashboard Hard Set activation webhook enables `zero_website` and `jenang_gemi_website` together. Configure `JG_STORE_OPS_WEBSITE_TOKEN` / `store_ops_website_token` to the same high-entropy value on both applications, or let both deployments derive it from their existing shared marketplace setup credential. Set `JG_EXECUTIVE_DASHBOARD_URL` / `executive_dashboard_url` when the dashboard is not at `https://admin.jenanggemi.com`. After the permanent cutover, the authenticated `action=automation` projection can pause or resume only future automatic marketplace arrangements; it does not disable website ingestion or undo arranged shipments.
Big Set readiness also requires an explicit `JG_MARKETPLACE_SOURCES` / `marketplace_sources` queue list. It may contain manual-only accounts, but it must include every API Ingest `MARKETPLACE_AUTO_SHIP_SOURCES` entry. An unqualified shop such as ZFIT Shopee should stay out of the list until it is authorized and tested; it is not required unless it is explicitly placed in the API Ingest automatic scope. Store Ops freezes the dashboard-provided automatic subset with the permanent cutover timestamp; those exact sources require a validated stored label even if later remote metadata or environment edits disagree. Store Ops uses `JG_SHOPEE_INGEST_SETUP_TOKEN` for Shopee and `JG_TIKTOK_INGEST_SETUP_TOKEN` for TikTok (falling back to the Shopee token only when they are intentionally shared); each credential is verified through the read-only `/fulfillment/access` contract before Store Ops accepts activation. Order-status callbacks send those credentials in authorization headers rather than query strings. An idempotent retry for an already-stored cutover remains accepted even if a later readiness check is degraded, while the first activation still fails closed.
While Big Set is OFF, Store Ops keeps a read-only pre-arrangement queue: Shopee `READY_TO_SHIP` and TikTok `AWAITING_SHIPMENT` / `SHIPMENT_PENDING`, plus any cancellation-request alert that staff must resolve in the marketplace. Marketplace print, claim, scan, and completion actions remain blocked. If the local Big Set state is unavailable, the marketplace feed fails closed. After irreversible activation, new regular Shopee orders covered by the API fail-safe boundary stay visible from discovery through label storage; historical fulfillment rows are excluded. Their action shows automatic progress or enables the guarded `Manual arrange` fallback, including while automation is paused; picking remains blocked until the label is ready. Instant cards keep their separate explicit user-requested action and always pulse red. Unrelated Partner and in-store workflows remain available throughout.
Keep new deployment credentials outside Git by placing them in the ignored
`.env` or `config.runtime.php`; `/public_html/config.runtime.php` is also
loaded. The legacy Hostinger deployment still reads `config.local.php`, so do
not remove it until the live server has been migrated to an ignored runtime
file with the same values. Use `config.local.example.php` only as a template for
new deployments.

Store Ops persists website orders idempotently, re-verifies every order against the token-authenticated executive feed and cutover timestamp, resolves item SKUs through the existing SKU DB, and proxies the executive-uploaded PDF through authenticated endpoints. Executive-built WhatsApp orders use the same authenticated transport but remain available independently of Big Set; their shipping cost stays in Executive and is never copied into Store Ops. Inventory is universal: fulfillment for every website, WhatsApp, Partner, Shopee, and TikTok account, walk-in completion, manual Stock Adjust, and supplier-invoice imports all update the same ASTRA base-stock row and synchronize every linked selling SKU in the same transaction. This applies to every catalog product with ASTRA metadata. For example, one Bubur 30 with ASTRA 15 consumes two Bubur 15 base units, and its displayed sellable stock remains half of Bubur 15. Account-scoped order keys make retries idempotent, while shortages or unmapped SKUs block completion instead of silently skipping or clamping stock.

Operational backend for `store.jenanggemi.com`.

## Scope

- SKU database and master catalog
- Inventory and stock thresholds
- Fulfillment, walk-in, WhatsApp, and invoice-record workflows
- Read-only processed order records with source, customer username/name, operator, scan totals, completion time, and event timelines
- Universal invoice printing by Order ID
- COGS history and operational pricing inputs
- Webhook and API integrations to external systems

## Current routes

- `/dashboard/`
- `/sku-db/`
- `/sku-db/new/`
- `/inventory/`
- `/inventory/` is the production-receiving queue for Executive purchase orders.
  Checked full or partial line quantities are recorded as receipts and added
  through the ASTRA-aware stock engine in one database transaction.
- `/returns/` records full or partial product returns from a verified original
  order. Direct-to-stock reports add inventory immediately; production returns
  require a total quote and create a confirmed PO tagged `Returned damaged
  goods`, which follows the normal Executive payment and Inventory receiving
  flow. Drafts remain resumable. Partner is shown but disabled until its
  separate returns integration is available.
- `/walk-ins/`
- `/whatsapp-orders/`
- `/order-records/`
- `/invoice-printer/`
- `/invoice-records/`
- `/orders/` redirects to `/invoice-records/`
- `/integrations/`
- `/logout/`
- Store Ops login sessions last seven days. Starting an order first confirms the active server session and employee profile; an expired session returns to login before the pick/scan workflow opens.
- Post-cutover TikTok/Tokopedia orders that exhaust automatic shipment-arrangement retries remain visible in Listed as blocked alert cards. Operators can retry arrangement from the card; picking stays disabled until API Ingest confirms arrangement and stores a valid label. New regular Shopee orders covered by the API fail-safe boundary are visible before arrangement; historical fulfillment rows are not imported. Healthy queued or delayed-retry work shows `Auto-arranging…`. If automatic work is missing, paused, failed, or stale, the card pulses cyan and enables `Manual arrange`; that action opens a visual chooser for Shopee's live Pickup, Drop-off, and pickup-time choices and submits exactly what the operator selects. An in-flight marketplace submission remains locked against a racing click. After arrangement the same card loses its cyan manual state, shows `Preparing label…` if necessary, and becomes a normal `Start` card as soon as the stored label is ready. A terminal label failure enables `Retry label`. Picking stays disabled until its valid label is stored. Instant-order behavior is unchanged.
- Durable browser completions now require an actual live Store Ops claim, including for admin profiles. Opening `Manual arrange` also removes any stale queued completion for that order. This prevents a successful shipment arrangement from being mistaken for fulfillment before the operator presses `Start` and completes the pick/print flow.
- `/api/orders-v2/` (active fulfillment dashboard endpoint)
- Confirmed marketplace cancellations leave Listed even when the order is delayed with no shipping deadline, retains manual-arrangement flags, or has a stored label. Pending cancellation requests remain visible as blocked alerts until the marketplace confirms the outcome.
- `/api/orders/` (compatible legacy endpoint)
- `/api/order-lookup/`
- `/api/returns/`
- `/api/walk-ins/`
- `/api/invoice-records/`
- `/api/profile-settings/`

## Notes

- Store ops now treats `/sku-db/` as a read-only mirror of the live shared SKU MySQL database.
- New SKU creation and approvals have moved to the executive dashboard.
- `/sku-db/new/` now redirects back to `/sku-db/`.
- `/invoice-printer/` resolves any supported Order ID across walk-in, WhatsApp, website, partner, Shopee, and TikTok sources, then prints through the same invoice layout used by Invoice Records. It also accepts `?order_id=...&print=1` for authenticated cross-app invoice actions. Invoice printing is read-only and does not update metrics, stock, profiles, order status, or print history.
- `/order-records/` includes a Branch-only history repair for a missing completed record. It requires the exact Order ID, a fresh Branch Login passcode, and verified prior completion from the account-scoped stock ledger, terminal Store Ops state, or API Ingest's exact `IS_PROCESSED` record. The repair is idempotent and only restores the local `fulfill` history event and missing display snapshot; it never changes stock, marketplace state, or the Listed queue.
- The dashboard Reprint popup accepts an exact Order ID or performs live customer-profile search by username, name, phone, email, or marketplace user ID (never address). Search keeps all substring matches while ranking customer identifiers that start with the typed query first. Profile results show dated shipping-label orders across Shopee, TikTok, website, and partner sources, retain the correct platform/account/package routing, and mark currently retrievable labels as Available. Selecting a shipped order whose temporary marketplace label no longer exists shows that explanation without leaving the popup.
- The fulfillment dashboard reads Shopee and TikTok rows through `/api/orders-v2/`, which proxies API Ingest without exposing marketplace tokens. Hard Set automatic arrangement is permanently pause-locked. Unarranged marketplace rows stay visible read-only, while every label-backed order remains in Listed until Store Ops itself records `FULFILLED`; marketplace states such as Shopee `PROCESSED`, `SHIPPED`, or `TO_CONFIRM_RECEIVE` never substitute for Store Ops completion.
- Before TikTok shipment arrangement, the card countdown is labeled `Arrange by` and uses the shipping SLA. Once arrangement and label storage succeed, it becomes `Collection due` and uses the deadline for reaching `IN_TRANSIT`.
- `/api/orders-v2/` also merges Partner orders from the Partner Portal feed. This flow is independent of Big Set and never uses the Big Set token. It uses `store_ops_orders_token` / `JG_STORE_OPS_ORDERS_TOKEN` when explicitly configured, otherwise it derives a scoped Partner feed credential from the configured Partner database name/password. Override the feed URL with `partner_orders_feed_url` / `JG_PARTNER_ORDERS_FEED_URL` if needed. Partner display names are resolved from `partner_registry_url` / `JG_PARTNER_REGISTRY_URL`, which defaults to the executive dashboard public partner registry. Direct Partner database access remains an optional fallback through `partner_db_*` / `JG_PARTNER_DB_*`.
- Partner shipping labels are proxied from the Partner Portal feed or `partner_portal_base_url` / `JG_PARTNER_PORTAL_BASE_URL` when uploaded by the partner portal.
- Partner orders remain visible after acceptance and throughout scanning. Clicking the shipping-label print action opens the system print dialog immediately. Printing alone does not complete the order: the red `Printed successfully` button is the single completion action. Its click saves an idempotent fulfillment action to the browser retry queue when storage is available, waits for the shared server and upstream source to acknowledge it, and only then removes the card and closes the tab. Full or restricted browser storage does not block the server request. Confirmation requests time out after 30 seconds and show any error beside the confirmation button so the operator can retry without printing another label. A failed or interrupted acknowledgement leaves the durable action available to retry; the shared terminal status prevents a locally completed order from reappearing on other devices while the upstream callback catches up. The dashboard retries queued actions on notification, focus, startup, and normal refreshes. Physical completion remains authoritative when recorded inventory is short: available stock stays at zero and the idempotent order ledger records the exact unresolved ASTRA quantity instead of rejecting the completed order or reducing a future RP receipt. The loaded label is explicitly treated as label-backed, so an already printed order can still be finalized while automatic arrangement is paused. Reprinting remains available through the separate Reprint flow. The protected Remove dialog audits the shared stock ledger and requires an explicit inventory choice: manually completed orders can deduct stock through the idempotent ASTRA ledger, while cancellations and duplicates leave stock unchanged. Every order tag is shown against its resolved live SKU; missing or incorrect tags can be manually assigned to the correct SKU before deduction. Quantities remain fixed from the order, selected mappings are validated by the live catalog, the choice and mappings are recorded in the fulfillment audit trail, and a previously deducted order is never deducted twice.
- Automatic label printing is opt-in per Windows packing station. Settings > Label printer downloads `store-ops-print-helper-setup.cmd` from the authenticated `/api/print-helper/` endpoint; running it once installs a per-user helper under `%LOCALAPPDATA%\JGStoreOpsPrint` (no administrator rights) that starts with Windows, listens only on `127.0.0.1:47821`, and answers only the Store Ops origin it was downloaded from. On a station with the helper switched on, the label page sends the label to the printer as soon as scanning finishes, watches the Windows print queue, and sends the usual idempotent fulfillment action only after the printer has taken the label. A printer that is offline or out of labels keeps the order on screen with the reason and a retry; an outcome the helper cannot confirm falls back to the red `Printed successfully` button. After a confirmed print the tab stays for three seconds with `Print again` before closing. Reprints never start by themselves. Stations without the helper, and any station where it is not running, keep the browser print dialog flow described above. The helper source is `print-helper/store-ops-print-helper.ps1`; it prints through SumatraPDF, which the setup downloads and checksum-verifies.
- `Lanjut` saves the selected order's normalized picking snapshot in the authenticated server session before opening scanning. Scan and label tabs load that exact snapshot using an opaque handoff reference, so unavailable browser storage, a partial board refresh, or an older print tab cannot lose the active order or its ASTRA quantities. Snapshots are scoped to the employee/session, expire after 12 hours, and are limited to 32 active entries; expired or released orders show an actionable return-to-board message. Legacy tabs without a handoff reference still use their existing browser cache. Print confirmations merge into the latest account-scoped cache instead of rewriting a tab's old board snapshot.
- Product scanning uses a USB-COM 1D laser scanner on `/dashboard/scan/`. Store Settings uses the browser's native Web Serial picker to select, recheck, and test the station scanner. The fulfillment scan page automatically opens an approved scanner and does not repeat scanner connection controls. It falls back to keyboard-wedge input or the local serial device path `/dev/serial/by-id/usb-SCANNER_cs_SCANNER_YUNEW-if00` or `/dev/ttyACM0` when the web server has permission.
- Platform color coding is stored against the authenticated Store Ops employee profile, so a profile uses the same queue colors across stations and browsers.
- If the local serial fallback reports a permission error, add the web-server user to the Linux `dialout` group or set a udev rule for the IWARE scanner.
- To install the IWARE udev rule on the POS, run `sudo scripts/install-iware-scanner-permissions.sh`, reconnect the scanner, then use Store Settings > Scanner > Recheck / Test Scan.

- Login exposes the stable employee ID as the password-manager username. Profile tiles and autofill select the same server-validated employee; unique legacy display-name logins remain accepted. Switching tiles clears the previous account's password. Password approval dialogs also identify the Branch account.

Instant Store Ops requests have unlimited arrangement retries. A queued retry can be expedited by the operator; an active worker retains its lease to avoid duplicate submissions. Marketplace errors remain visible through reconciliation. The Store Ops button shows `Arranging…` only while its own request is in flight, then offers `Retry arrange` or `Retry label` as needed.
