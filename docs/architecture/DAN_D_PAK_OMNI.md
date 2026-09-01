# Dan D Pak Omni backend

## Boundary

Dan D Pak Omni is the native conversation and online-operations module. Haravan,
Facebook, Instagram, Zalo OA, Shopee and TikTok are connectors. A connector may
translate and transport data, but it must not create a second customer, product,
inventory, payment, report or invoice domain.

```
provider webhook -> signature check -> durable/idempotent event -> adapter
                 -> Omni conversation OR canonical POS order
                 -> payment boundary -> inventory movement + sale snapshot
                 -> reports + e-invoice outbox
```

## Sources of truth

- `omni_*`: channels, external identities, conversations, messages, assignment,
  labels, canned replies and links.
- `customers`: customer master. `omni_identities.customer_id` only links it.
- `orders` / `order_items`: order and immutable line snapshots at checkout.
- `skus`, `stock_lots`, `stock_movements`: current inventory and its ledger.
- `payments`, `payment_lines`, `sale_snapshots`: settled financial evidence.
- `e_invoices`: legal output-invoice state and provider outbox.
- `external_*`: provider ID mapping; never a replacement business domain.

## Connector contract

Every adapter must:

1. Verify the provider signature against the exact raw request bytes.
2. Acknowledge within the provider deadline and enqueue work when network calls
   or large payloads are involved.
3. Build a stable event key from provider + account/shop + event/message/order ID.
4. Reject the same key with a different payload; accept exact retries once.
5. Resolve product mappings before confirmation. Unmapped/ambiguous items remain
   in `product_attention` and must never silently create a duplicate SKU.
6. Settle prepaid orders only through `payOrder(... external_settlement=true)`.
   This atomically assigns a bill number, records payment, deducts inventory,
   writes a sale snapshot and creates the e-invoice record.
7. Never send an inbound provider order back to the same provider.

## Capability and activation policy

The capability endpoint reports implemented transport separately from granted
provider access. A connector is only `active` after credentials, webhook
verification, required scopes and a live health test all pass. UI must display
`pending_provider_approval` instead of pretending chat/send is available.

- Haravan: web orders/catalog/inventory through public Omni API. Harasocial chat
  requires its separate partner/private API grant.
- Meta: Facebook Page Messenger and Instagram Professional messaging use signed
  Meta webhooks; production customers require the applicable Advanced Access.
- Zalo OA: OA OpenAPI/webhook and approved OA application/token.
- Shopee/TikTok Shop: order, fulfillment, product and inventory through approved
  partner applications. Messaging is a distinct scope/product.

## Invoice and inventory invariant

`orders.status='paid'` is not an import operation. It is the result of the
canonical payment transaction. A committed paid order must have payment evidence,
a bill number, a sale snapshot, stock movements for mapped inventory lines and an
`e_invoices` record. Provider retries cannot create any of them twice.

The e-invoice record is created at sale finalization. If buyer tax information is
available it is snapshotted; otherwise the configured consumer/walk-in mode is
used. Provider/MISA network delivery runs from an outbox so a temporary provider
failure cannot undo a completed sale.

## Failure model

- Invalid signature: reject with 401/403 and do not persist business data.
- Duplicate event: return success with `duplicate=true`.
- Unknown product: quarantine for operator mapping; no stock mutation.
- Insufficient stock: reject settlement and keep order actionable.
- Invoice provider unavailable: retain `PENDING_PROVIDER` and retry; do not lose
  the legal invoice record.
- Refund/cancellation after payment: use canonical refund and inventory return,
  never change `paid` directly to `void` without reversal evidence.

