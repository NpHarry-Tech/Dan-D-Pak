# AUDIT — DB, Security, Idempotency (mission #10/#11/#48/#49)

> Kết quả audit 2026-08-14. Evidence-based: dựa trên test hiện có (59/59 pass) +
> đọc code. Kết luận: hệ thống ĐÃ production-grade ở phần lớn các mục — KHÔNG churn.

## Đã đạt (có test làm bằng chứng)
| Mục | Trạng thái | Test |
|---|---|---|
| Idempotency chống trùng đơn/payment/invoice (#11) | ✅ | `idempotency-chong-trung-don`, `so-bill-cap-khi-thanh-toan` |
| Stock transaction-safe / không âm kho (#9/#10) | ✅ | `inventory-transaction` |
| Branch isolation | ✅ | `branch-isolation-regression`, `handy-device-routing-isolation` |
| Login hardening + session-device binding (#48) | ✅ | `login-hardening`, `session-device-binding` |
| Sync outbox restart-safe (#12/#51) | ✅ | `sync-outbox-safety`, `offline-edge-wan-cut` |
| DB query plan / hot path (#10/#49) | ✅ | `database-hot-query-plan` |
| Backup / restore / migration (#52) | ✅ | `production-backup-rehearsal`, `database-online-backup`, `database-legacy-migration` |
| Security regression | ✅ | `security-regression` |

## Findings cụ thể
- **SQL injection**: KHÔNG có. Các query dùng `${...}` đều là: (a) whitelist hardcode
  (`modules/database/routes.js` configTables/transactionTables), (b) identifier escape
  `quoted()` (`edgeSync.js`), (c) placeholders động `IN (${placeholders})` + `.run(...args)`,
  (d) baseSql nội bộ (`invoices.js`). Không có input người dùng nối thẳng vào SQL.
- **Encryption key** (`config/env.js:131`): production **throw** nếu thiếu
  `DATA_ENCRYPTION_KEY` → không có default yếu ở prod. Test dùng key cố định (chấp nhận).
- **Rate limit / brute force**: bảng `login_failures` + auth hardening (test pass).
- **Health** (#54): đã thêm `/health/live` + `/health/ready` (integration ngoài down
  không làm readiness fail).

## Khuyến nghị
- KHÔNG re-architect DB/security/idempotency đang chạy tốt (rủi ro > lợi ích, trái mission #3).
- Gap thật còn lại: **Notification taxonomy unification (#14-17)**, **Navision greenfield
  (#18, chờ thông tin môi trường)**, **Sunmi native text backend**.
- Việc nên làm dần khi đụng tới: chuẩn hoá error contract (#46), correlation_id xuyên suốt (#53).
