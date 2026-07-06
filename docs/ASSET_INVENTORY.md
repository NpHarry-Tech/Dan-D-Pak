# Asset Inventory

Last updated: 2026-06-18

| File path | Type | Used by page/module | Purpose | Can delete? | Notes |
| --- | --- | --- | --- | --- | --- |
| `web/assets/logo.png` | brand/logo | Login, templates, receipt designer | Legacy logo | No, check references first | Referenced by admin bill designer |
| `web/assets/DanOnLogo.png` | brand/logo | Shared login/topbar, launcher | Primary brand mark | No | Large file; optimize later |
| `web/assets/befoodlogo.png` | integration brand | Admin/settings/online | beFood channel mark | No, if channel enabled | Move to `brand/icons` later with reference update |
| `web/assets/grabmartlogo.png` | integration brand | Admin/settings/online | GrabMart channel mark | No, if channel enabled | Move later safely |
| `web/assets/grabmerchantlogo.webp` | integration brand | Admin/settings/online | Grab merchant channel mark | No, if channel enabled | Move later safely |
| `web/assets/payoslogo.png` | payment brand | Admin/settings/payment | payOS mark | No, if payment enabled | Move later safely |
| `web/assets/shopeefoodlogo.png` | integration brand | Admin/settings/online | ShopeeFood mark | No, if channel enabled | Move later safely |
| `web/assets/menu-book/*.webp` | product/menu pages | iPad book menu | Active static menu book | No | Product/customer-facing assets |
| `web/assets/menu-book/manifest.json` | menu config | iPad book menu | Page manifest | No | Keep with menu book pages |
| `web/assets/menu-books/book_yschn6ii5f/*.webp` | product/menu pages | Imported book menu | Imported menu book copy | Review only after references | Do not delete without checking book config |
| `web/vendor/interact.min.js` | vendor script | Admin label/bill designer | Drag/resize UI | No | Local fallback for designer |

## Rules

- UI/brand assets belong under `web/assets/brand` or `web/assets/ui`.
- Food/product/menu images belong under `web/assets/product-images` or a documented menu-book folder.
- Customer uploads must not mix with UI assets.
- Do not delete assets without checking references with `rg`.
