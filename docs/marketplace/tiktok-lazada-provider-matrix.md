# TikTok Shop + Lazada provider evidence matrix

Verified on: 2026-09-13. Target market: Vietnam. `VERIFIED` means the linked
official public documentation supports the contract. `BLOCKED` means the exact
contract must still be captured from the authenticated app console before that
capability can be enabled in production.

| Provider | Capability / contract | Evidence | Status | Runtime decision |
|---|---|---|---|---|
| TikTok Shop | Seller authorization URL (`services.tiktokshop.com/open/authorize`, non-US, `service_id`) | [Authorization guide 202309](https://partner.tiktokshop.com/docv2/page/authorization-guide-202309) | VERIFIED | Shared one-use state flow; ordinary TikTok Login Kit is not used. |
| TikTok Shop | Token create/refresh (`auth.tiktok-shops.com/api/v2/token/get`, `/refresh`) and absolute Unix expiry fields | [Authorization guide 202309](https://partner.tiktokshop.com/docv2/page/authorization-guide-202309) | VERIFIED | Tokens remain server-side, encrypted, rotated atomically and refreshed single-flight. |
| TikTok Shop | Authorized shops (`GET /authorization/202309/shops`) | [Get Authorized Shops](https://partner.tiktokshop.com/docv2/page/call-get-authorized-shops) | VERIFIED | All shops are retained; zero is an error and multiple shops require explicit selection. |
| TikTok Shop | API signing and version-in-path rules | [API versioning](https://partner.tiktokshop.com/docv2/page/api-versioning), [Get Authorized Shops](https://partner.tiktokshop.com/docv2/page/call-get-authorized-shops) | VERIFIED for authorized-shop probe | Other capability paths remain disabled until individually verified. |
| TikTok Shop | Access scopes | [Access scope](https://partner.tiktokshop.com/docv2/page/access-scope) | VERIFIED concept; app grants BLOCKED | Capability rows default to blocked; Partner Console export is owner input. |
| TikTok Shop | Webhook HTTPS/ACK/retry behavior | [Webhook configuration guide](https://partner.tiktokshop.com/docv2/page/configuration-guide) | VERIFIED | Raw body is verified before durable enqueue; ACK path performs no business API call. |
| TikTok Shop | Exact webhook signature canonicalization/headers for the Vietnam app | Partner Console signature page must be exported | BLOCKED | Existing HMAC adapter is sandbox-only evidence; production webhook subscription is not declared ready. |
| TikTok Shop | Orders/products/waybill endpoint paths, pagination, statuses and rate limits | Per-operation Partner Console pages required | BLOCKED | Read sync is shadow-only; all write capability rows remain blocked. |
| Lazada | OAuth URL, callback `code` + returned `state`, one-use code | [Seller authorization introduction](https://open.lazada.com/apps/doc/doc?docId=108260&nodeId=10777) | VERIFIED | Shared callback state is required; legacy branch-query callback is off by default. |
| Lazada | Token create/refresh and relative TTL fields | [Seller authorization introduction](https://open.lazada.com/apps/doc/doc?docId=108260&nodeId=10777) | VERIFIED | Access/refresh deadlines are persisted; refresh token rotation is atomic and single-flight. |
| Lazada | Multi-country `country_user_info` | [Seller authorization introduction](https://open.lazada.com/apps/doc/doc?docId=108260&nodeId=10777) | VERIFIED | Each returned seller/country is stored as an available shop and explicitly mapped. |
| Lazada | Vietnam and regional API hosts | [Official API endpoint table](https://open.lazada.com/apps/doc/api?path=%2Fmedia%2Fvideo%2Fblock%2Fcreate) | VERIFIED | Host is selected from a server allowlist; client `apiBase` is ignored. |
| Lazada | Common signed request parameters | [Calling parameters](https://open.lazada.com/apps/doc/doc?docId=108067&nodeId=10400) | VERIFIED | TOP signing contract stays covered by deterministic tests. |
| Lazada | Exact push signature/envelope/retry contract | Authenticated app push documentation required | BLOCKED | Missing/bad signature fails closed; production push is not declared ready. |
| Lazada | Orders/products/document endpoint permissions, status/reason maps and rate limits | Per-operation Open Platform app documentation required | BLOCKED | Read sync is shadow-only; fulfillment/product/inventory/return/finance writes remain blocked. |
| TikTok Login Kit | TikTok identity login and user tokens | [Login Kit overview](https://developers.tiktok.com/docs/en/login-kit-overview), [Manage user access tokens](https://developers.tiktok.com/docs/en/login-kit-manage-user-access-tokens) | NOT_REQUESTED | Explicitly not used for TikTok Shop seller authorization. |

## Owner evidence still required

- TikTok Shop Vietnam app/service IDs and secrets configured directly in the server secret store.
- Lazada App Key/Secret configured directly in the server secret store.
- Exact allowlisted callback/webhook URLs and the Partner Console/Open Platform exports for granted scopes.
- Development-shop/sandbox seller authorization and sanitized fixtures for every enabled capability.
- Exact webhook signature pages for both providers.
- Owner approval of shop → branch → warehouse mapping, safety stock, and each outbound/write capability.
