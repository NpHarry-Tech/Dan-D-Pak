# Inventory Workflow

Last updated: 2026-06-20

Inventory is **ledger-based**. Stock quantity is never edited directly — every
change is a movement record.

## Tables

- `warehouses`, `stock_locations`
- `suppliers`
- `purchase_orders`, `purchase_order_items`
- `goods_receipts`, `goods_receipt_items`
- `inventory_movements`, `inventory_movement_items`
- `stocktake_sessions`, `stocktake_items`
- `stock_adjustments`
- `stock_transfers`, `stock_transfer_items`
- `inventory_snapshots`
- `inventory_cost_layers`

## Movement types

```text
PURCHASE_IN          goods receipt from supplier
SALE_OUT             sold via order
TRANSFER_OUT         leaving a warehouse/location
TRANSFER_IN          arriving at a warehouse/location
STOCKTAKE_ADJUSTMENT count difference correction
WASTE                spoilage
DAMAGE               damaged goods
RETURN_IN            customer/return inbound
RETURN_OUT           supplier return outbound
MANUAL_ADJUSTMENT    explicit manual correction (reason required)
RECIPE_CONSUMPTION   ingredients consumed by a sold dish (BOM)
```

## Every movement records

- movement type
- reason
- staff / device
- branch / warehouse / location
- timestamp
- reference document (PO, order, transfer, stocktake)
- before/after snapshot where needed
- cost layer (for cost history / FIFO)

## Inventory In

1. Create a purchase order / goods receipt against a supplier.
2. Receiving creates `PURCHASE_IN` movements and a cost layer.
3. Stock is increased **via the ledger**, never by direct edit.
4. Audited.

## Inventory Out

- Sales create `SALE_OUT` (and `RECIPE_CONSUMPTION` for prepared items).
- Waste/damage/transfers create their respective movement types.
- No destructive quantity edit; the ledger is the truth.

## Stocktake

1. Open a `stocktake_session`.
2. Record counted quantities per item.
3. System computes differences.
4. Differences become `STOCKTAKE_ADJUSTMENT` movements.
5. Close the session; closing is audited.

## Current implementation

`server/services/inventory.js` + `server/db.js` already implement
`inventory_documents`, `inventory_document_lines`, `stock_movements`,
`stock_lots`, `stocktake_sessions`, and `stocktake_lines`. The planned schema in
[DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) generalizes these into the table set above
additively.
