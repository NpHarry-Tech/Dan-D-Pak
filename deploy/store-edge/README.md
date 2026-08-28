# Dan D Pak Store Edge

Store Edge là authority duy nhất của một chi nhánh khi WAN mất. Nó là service
độc lập trên máy có IP LAN cố định và UPS; Flutter không tự khởi động hay sở hữu
process này.

## Điều kiện trước khi bật

1. VPS receiver đã cấu hình cùng `EDGE_SYNC_SHARED_SECRET` và map duy nhất:
   `{"store-sala-edge-01":["sala"]}`.
2. Có bản backup production đã kiểm tra giải mã/restore và `quick_check=ok`.
3. DB khởi tạo Edge là bản sao nhất quán của production; không khởi động DB trống,
   không seed demo và không đổi `EDGE_HUB_ID` sau lần đầu.
4. Máy Edge có IP/DNS LAN cố định, firewall không public cổng 3000, UPS và lịch
   backup ra thiết bị/máy khác.
5. Chỉ một Edge được ghi cho một branch. Không chạy hai container Edge cùng DB
   hoặc hai hub khác nhau cho cùng branch.

## Chuẩn bị (chưa phải lệnh deploy production tự động)

```powershell
Copy-Item deploy/store-edge/.env.example deploy/store-edge/.env
$env:EDGE_ENV_FILE='.env.example'
docker compose -f deploy/store-edge/docker-compose.yml config
Remove-Item Env:EDGE_ENV_FILE
docker compose -f deploy/store-edge/docker-compose.yml build
```

Nạp bản sao DB đã xác minh vào volume **trước** lần start. Tên volume thực tế phụ
thuộc compose project; dùng `docker volume ls` và kiểm tra chính xác thay vì đoán.
Không copy file SQLite đang mở bằng lệnh filesystem; tạo bằng SQLite Online Backup
API hoặc từ backup đã restore.

Sau khi start canary:

```powershell
docker compose -f deploy/store-edge/docker-compose.yml up -d
docker compose -f deploy/store-edge/docker-compose.yml ps
Invoke-RestMethod http://<EDGE_LAN_IP>:3000/health
```

Mọi POS/tablet/KDS của branch phải trỏ tới cùng URL Edge. Có thể build canary với
`--dart-define=STORE_EDGE_URL=http://<EDGE_LAN_IP>:3000` hoặc lưu URL tại màn chọn
cơ sở. Không cấu hình tự failover sang VPS vì sẽ tạo hai writer/split-brain.

## Canary bắt buộc

- WAN on: tạo một bill tiền mặt, đối chiếu đúng một order/payment/snapshot/stock
  movement trên Edge và VPS.
- Cắt WAN: đăng nhập, bán tiền mặt, in bill và chuyển giỏ giữa hai thiết bị vẫn
  hoạt động qua LAN; QR/bank/wallet phải bị từ chối trung thực.
- Nối WAN: outbox về 0 sau ACK; không trùng tiền, kho, bill, HĐĐT hay inbox.
- Restart Edge và rút/cắm mạng lặp lại; `PRAGMA quick_check=ok` và pending không mất.
- Mất Edge: dừng bán hoặc restore Edge; tuyệt đối không cho một số máy viết VPS
  trong khi số khác vẫn viết Edge.

Chỉ sau canary mới chuyển toàn bộ thiết bị branch. Xem
`docs/production-hardening/12-adr-offline-edge.md` cho protocol và rollback gate.
