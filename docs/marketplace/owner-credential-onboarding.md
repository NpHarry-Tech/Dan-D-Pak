# TikTok Shop + Lazada owner credential onboarding

Updated: 2026-09-14. Execution order: Lazada, then TikTok Shop.

This is a shadow-only onboarding runbook. It does not authorize production
writes, build, publish, or deploy anything. Never paste an App Secret, access
token, refresh token, webhook secret, owner session token, or unredacted seller
payload into chat, tickets, screenshots, terminal history, or logs.

## Audit baseline

- Audited HEAD: `2e8fe7a8c3637a87784ee9d56a0a212fddf03473` on
  `fix/universal-print-validation`.
- Marketplace foundation exists partly in commits `cb26858`, `51f3856`,
  `c62ea5c`, and `2e8fe7a`; additional marketplace hardening and tests remain in
  the working tree. The working tree also contains unrelated owner changes.
  Do not reset, rebase, checkout, or overwrite them.
- The requested
  `docs/TIKTOK_SHOP_LAZADA_INTEGRATION_DEEP_RESEARCH_AND_AGENT_PROMPT.md` is not
  present in this checkout. Its supplied attachment was read as the source
  replacement. The other two marketplace documents and
  `server/marketplace-foundation.test.mjs` were read in full.
- `deploy/company-server/.env` exists; `deploy/review/.env` does not. Only
  presence checks were performed. No secret value was read or printed.
- The current process reports all Lazada/TikTok credential variables as missing.
  Therefore no real seller authorization, capability call, fixture collection,
  webhook validation, or reconciliation was attempted.
- Offline verification on this working tree: marketplace foundation 18/18,
  Lazada connector 5/5, social connectors 6/6, and the full server suite 832/832
  passed.

## URLs to register

Use the review environment first. A callback value must match exactly; do not
add a trailing slash or query string in the console.

| Environment | Provider | Callback URL | Webhook URL |
|---|---|---|---|
| Review/development | Lazada | `https://api-review.dandpakpos.io.vn/auth/lazada/callback` | `https://api-review.dandpakpos.io.vn/webhooks/lazada` |
| Production (register only; do not exercise yet) | Lazada | `https://api.dandpakpos.io.vn/auth/lazada/callback` | `https://api.dandpakpos.io.vn/webhooks/lazada` |
| Review/development | TikTok Shop | `https://api-review.dandpakpos.io.vn/auth/tiktok/callback` | `https://api-review.dandpakpos.io.vn/webhooks/tiktok` |
| Production (register only; do not exercise yet) | TikTok Shop | `https://api.dandpakpos.io.vn/auth/tiktok/callback` | `https://api.dandpakpos.io.vn/webhooks/tiktok` |

## Lazada Open Platform owner checklist

### Console configuration

- [ ] Sign in to **App Console**, choose **Create**, and select the app category
  matching the real distribution model. Use **Self-Developed** for the owner's
  own seller account, or the applicable ISV/ERP commercial category for
  third-party sellers. Do not choose a category merely to bypass review.
- [ ] Set the app market/seller site to **Vietnam (VN)**.
- [ ] In app creation/basic information, fill the exact console fields
  **Application name**, **Callback URL**, and **Application logo**. Use the review
  callback above for the development app.
- [ ] At **Development > App Management > Manage > App Overview**, confirm
  **App Key** and reveal **App Secret** locally only.
- [ ] At **Auth Management**, record **Authorized Policy**, **Access Token
  Duration**, **Refresh Token Duration**, **Authorized Page**, **Authorized
  Agreement**, and **Authorized User Limit**. For an ABA policy, add the
  development seller short code under **Authorized Seller Whitelist**.
- [ ] At **API Permission Group**, request only read permissions whose API names
  are visibly listed for this app: seller/account authorization information,
  order list/detail/items, and product/SKU list/detail. Record the exact group
  and API names granted by the console. Group names vary by app category, so this
  runbook deliberately does not invent them.
- [ ] Do not request or enable product/inventory mutation, fulfillment mutation,
  payment capture, invoice, cancellation, refund, or settlement-write capability.
  Returns/refunds and finance/settlement reads remain blocked until their exact
  console API names, response contracts, and sandbox evidence are captured.
- [ ] Prepare a Vietnam development/test seller with representative products,
  variants, seller SKUs, paid/unpaid/cancelled orders, discounts, shipping,
  refund/return, VAT, commission, transaction fee, and settlement examples.
- [ ] At the app **Message Service** tab, enter the review **Callback address**,
  use **Verify**, then select only the required message types and **Save**. The
  endpoint must use a CA-issued HTTPS certificate and return promptly.
- [ ] If outbound IP restriction is enabled, at **Manage > IP Whitelist** add the
  review server actual public IP. Never guess the IP or enter a CIDR range.

### Credentials stored only on the server

Enter these directly in `deploy/review/.env` for development and
`deploy/company-server/.env` for production:

- `LAZADA_APP_KEY` — platform identifier; still keep server-side.
- `LAZADA_APP_SECRET` — secret; never send through chat/log.
- `LAZADA_ENV` — `sandbox` for review evidence, `production` only in production.
- `LAZADA_WEBHOOK_SECRET` — leave empty unless Lazada explicitly provides a
  distinct signing secret. The connector otherwise uses `LAZADA_APP_SECRET`.
- `DATA_ENCRYPTION_KEY` and `DATA_ENCRYPTION_ACTIVE_KEY_ID` — required for the
  encrypted seller-token vault; never copy a key between review and production.

Do not manually enter seller access/refresh tokens. The one-use callback stores
them encrypted after seller authorization.

### Lazada verification gate

1. Recreate only the review app container after privately saving the variables.
2. Confirm readiness without printing secrets.
3. In POS **Liên kết > Lazada**, start **Kết nối**. Confirm the authorization
   redirect returns both the server-generated `state` and Lazada `code`.
4. Confirm the token response yielded every `country_user_info` entry. If there
   is more than one seller/account, the UI must show all of them and the owner
   must explicitly select one; callback success alone is not “connected.”
5. Select an explicit `shop -> current branch -> active warehouse` mapping. No
   shop may fall back to `sala`.
6. Keep `sync_mode=shadow` and every write capability blocked. Run initial sync;
   a successful provider call is the current read capability probe for
   `orders_read` and `products_read`. Other capabilities remain blocked.
7. Save sanitized raw fixtures outside logs. Preserve field names/types and
   provider IDs needed for replay; redact names, phones, addresses, emails,
   tokens, signatures, authorization codes, tax IDs, and free-form notes.
8. Audit monetary normalization against real fixtures: original price, sale
   price, seller item discount, seller voucher, platform discount/subsidy,
   buyer shipping, shipping subsidy, VAT/tax, commission, transaction fee,
   refund, seller receivable, settlement/payout, currency, and provider rounding.
   Missing or ambiguous fields keep `finance_read` PARTIAL/BLOCKED.
9. Run reconciliation twice with the built-in overlap window. The second run
   must not create duplicate orders, lines, evidence, mappings, or payments.
10. Send a real console **Verify** event and a real subscribed event. Confirm the
    signature is calculated from raw bytes before parsing/routing; missing/bad
    signatures fail closed; duplicates dedupe; unknown sellers quarantine; a
    leased event is recovered after worker failure; reconciliation restores a
    deliberately omitted event.
11. Disconnect, verify encrypted tokens are cleared while mappings/cursors stay,
    then reconnect. Reconnect must require explicit mapping/probe/initial sync
    again and must not become active merely because OAuth succeeded. Exercise one
    refresh rotation and verify atomic/single-flight behavior without logging
    either token.

### Lazada report

- Console configuration: pending owner input.
- Granted scopes/groups: not available; record exact console output after grant.
- Authorized shops/accounts: not available.
- Selected mapping: not available.
- Sanitized fixtures: not available.
- Capability: authorization BLOCKED; orders/products BLOCKED; finance BLOCKED;
  all writes BLOCKED.
- Owner input missing: development App Key/App Secret stored privately, callback
  allowlist, auth policy/whitelist, exact read permissions, development seller,
  webhook subscription, selected branch/warehouse.
- Verdict: **READY_FOR_OWNER_INPUT**.

## TikTok Shop Partner Center owner checklist

Begin only after Lazada reaches `READY_FOR_SANDBOX_VERIFIED`.

### Console configuration

- [ ] In **Partner Center > App & Service > Create app & service**, choose the
  actual partner model: **Custom app** only for designated sellers, or **Public
  app** for a distributable ERP/connector. Public apps require review; Connector
  custom apps and larger seller counts can also trigger review.
- [ ] Set **Service category**, **Market = Vietnam**, seller type, and
  **Enable API** according to the real application. Fill the exact fields
  **Redirect URL** and **Webhook URL** with the review URLs above.
- [ ] At **App & Service > [app] > App credentials / Developing**, confirm
  **App Key**, **App Secret**, and **Service ID** locally.
- [ ] At **Partner Console > App & Service > Manage > Manage API**, request the
  least-privilege scopes for shadow onboarding: **Shop Authorized Information**,
  **Product Basic (430148)**, and **Order Information (430276)**. Request
  **Return & Refund Basic** and **Finance Information (430596)** only when the
  corresponding exact API contracts will be captured and tested.
- [ ] Do not request/enable **Product Modify (431492)**, **Product Delete &
  Recover (431428)**, **Fulfillment Basic (430340)**, delivery-status mutation,
  inventory mutation, cancellation/refund mutation, or settlement write for this
  gate. A granted scope never overrides the runtime write block.
- [ ] Prepare a Vietnam **Development Shop** and its Seller Center test account,
  with the same representative catalog/order/financial cases listed for Lazada.
- [ ] Configure subscriptions under the app **Developing** tab. The webhook
  must be HTTPS/TLS 1.2+, use a domain rather than an IP, use no custom port, and
  meet TikTok Shop response deadline. Inspect delivery at **Development Kits >
  Webhook Log**.

Use TikTok Shop seller/partner authorization only. TikTok Login Kit is a separate
consumer identity product and is not valid for this integration.

### Credentials stored only on the server

Enter directly in the same private environment files:

- `TIKTOK_SHOP_APP_KEY`
- `TIKTOK_SHOP_APP_SECRET` — never send through chat/log.
- `TIKTOK_SHOP_SERVICE_ID`
- `TIKTOK_SHOP_ENV` — `sandbox` in review; `production` only in production.
- `TIKTOK_SHOP_WEBHOOK_SECRET` — leave empty unless the console/documentation
  explicitly issues a distinct signing secret; otherwise App Secret is used.

Access token, refresh token, authorization code, and each shop `shop_cipher`
must come from authorization/discovery and remain in the encrypted server vault.
Never type them into Flutter configuration or chat.

### TikTok Shop verification gate

Follow the Lazada verification sequence with provider `tiktokshop`. Retrieve all
authorized shops through the official authorized-shops capability; never pick
the first result. The owner selects a shop, branch, and warehouse, and the exact
`shop_cipher` stays associated with that shop. Run read probes and initial sync
in shadow mode, validate webhook signatures from raw bytes using a real event,
run overlap/watermark reconciliation twice, test disconnect/reconnect and atomic
refresh rotation, and leave all writes blocked.

### TikTok Shop report

- Console configuration: pending Lazada verification and owner input.
- Granted scopes: not available.
- Authorized shops: not available.
- Selected mapping: not available.
- Sanitized fixtures: not available.
- Capability: authorization BLOCKED; orders/products BLOCKED; returns/finance
  BLOCKED; all writes BLOCKED.
- Owner input missing: Partner app/model, development App Key/App Secret/Service
  ID stored privately, exact granted scopes, Development Shop, webhook
  subscriptions, selected branch/warehouse.
- Verdict: **READY_FOR_OWNER_INPUT**.

## Safe operational commands

Run from the applicable deployment directory. These commands never print a
credential value.

```sh
docker compose config --services
docker compose run --rm --no-deps app node -e 'for (const k of ["LAZADA_APP_KEY","LAZADA_APP_SECRET","LAZADA_WEBHOOK_SECRET","LAZADA_ENV","TIKTOK_SHOP_APP_KEY","TIKTOK_SHOP_APP_SECRET","TIKTOK_SHOP_SERVICE_ID","TIKTOK_SHOP_WEBHOOK_SECRET","TIKTOK_SHOP_ENV","API_BASE_URL","DATA_ENCRYPTION_KEY"]) console.log(k+"="+(process.env[k]?"SET":"MISSING"))'
```

Only after the owner has saved the relevant private `.env`, recreate the app
container (do not run this merely to inspect configuration):

```sh
docker compose up -d --no-deps --force-recreate app
docker compose ps app
curl --fail --silent --show-error https://api-review.dandpakpos.io.vn/health/live
curl --fail --silent --show-error https://api-review.dandpakpos.io.vn/health/ready
```

For the protected, secret-free connection/capability response, enter the owner
session token interactively. Do not put it on a command line or in shell history:

```sh
read -r -s -p 'Owner session token: ' DANDPAK_OWNER_TOKEN; echo
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${DANDPAK_OWNER_TOKEN}" \
  'https://api-review.dandpakpos.io.vn/api/marketplace/connections?provider=lazada'
unset DANDPAK_OWNER_TOKEN
```

The returned public connection object contains status, shops, mappings, granted
scopes, capabilities, and sync/reconciliation timestamps; the API intentionally omits
access/refresh tokens and encrypted token columns.

Offline regression commands used for this handoff:

```sh
node --test server/marketplace-foundation.test.mjs
node --test server/lazada-connector.test.mjs
node --test server/social-connectors.test.mjs
# Full suite (PowerShell from repository root):
$tests = @(Get-ChildItem -LiteralPath server -Filter '*.test.mjs' -File | ForEach-Object { $_.FullName })
node --test $tests
```

Recorded result on 2026-09-14: marketplace foundation 18/18, Lazada connector
5/5, social connectors 6/6, and full server suite 832/832 passed. These are
offline gates, not sandbox evidence.

## Evidence report template (one copy per provider)

- Provider / environment / execution timestamp:
- Console app type, market, auth policy, callback, webhook:
- Official docs used (URL + accessed date):
- Exact granted scope/group/API names:
- Authorized account and complete shop list (non-sensitive IDs only):
- Owner-selected shop -> branch -> warehouse mapping:
- Sanitized fixture paths and redaction review:
- Initial shadow sync result:
- Monetary reconciliation result and unexplained delta:
- Reconciliation run 1 / run 2 and duplicate counts:
- Real webhook signature, dedupe, quarantine, lease recovery, lost-event result:
- Disconnect/reconnect and refresh-rotation result:
- Capability table: COMPLETE / PARTIAL / BLOCKED, with evidence:
- Remaining owner input:
- Verdict: exactly one of `READY_FOR_OWNER_INPUT`, `READY_FOR_SANDBOX`,
  `READY_FOR_SANDBOX_VERIFIED`, or `NO_GO`.

## Official documentation

Lazada Open Platform:

- Seller authorization: https://open.lazada.com/apps/doc/doc?docId=108260&nodeId=10777
- Create/register an application: https://open.lazada.com/apps/doc/doc?docId=108002&nodeId=10398
- Retrieve App Key and App Secret: https://open.lazada.com/apps/doc/doc?docId=108055&nodeId=10433
- Configure seller authorization: https://open.lazada.com/apps/doc/doc?docId=108056&nodeId=10434
- API Permission Group: https://open.lazada.com/apps/doc/doc?docId=108131&nodeId=10535
- Message Service/webhook: https://open.lazada.com/apps/doc/doc?docId=120168&nodeId=29524
- IP whitelist: https://open.lazada.com/apps/doc/doc?docId=118115&nodeId=26200
- Common request parameters/signing: https://open.lazada.com/apps/doc/doc?docId=108067&nodeId=10400

TikTok Shop Partner Center:

- Create an app: https://partner.tiktokshop.com/docv2/page/create-your-app
- Seller authorization: https://partner.tiktokshop.com/docv2/page/seller-authorization-guide
- Authorization guide: https://partner.tiktokshop.com/docv2/page/authorization-guide-202309
- Get Authorized Shops: https://partner.tiktokshop.com/docv2/page/call-get-authorized-shops
- Access scopes: https://partner.tiktokshop.com/docv2/page/access-scope
- ERP requirements/scope identifiers: https://partner.tiktokshop.com/docv2/page/enterprise-resource-planning-erp
- Webhook configuration: https://partner.tiktokshop.com/docv2/page/configuration-guide
- API signing: https://partner.tiktokshop.com/docv2/page/create-hash-to-sign-your-test-api-call
- API versioning: https://partner.tiktokshop.com/docv2/page/api-versioning
- TikTok Login Kit (not used): https://developers.tiktok.com/docs/en/login-kit-overview
