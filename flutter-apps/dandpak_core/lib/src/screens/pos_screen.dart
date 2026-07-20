import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/pos_models.dart';
import '../models/retail_models.dart';
import '../providers/auth_provider.dart';
import '../providers/customer_display_controller.dart';
import '../providers/pos_provider.dart';
import '../services/api_service.dart';
import '../services/app_log.dart';
import '../services/socket_service.dart';
import '../ui/app_theme.dart';
import '../ui/debouncer.dart';
import '../widgets/dan_top_bar.dart';
import '../widgets/manager_pin_dialog.dart';
import '../widgets/resizable_pane.dart';
import '../widgets/scan_button.dart';
import 'order_history_dialog.dart';
import 'retail/checkout_dialog.dart';
import 'shift_dialog.dart';
import '../services/black_box.dart';
import '../utils/translation.dart';

part 'pos_floor_widgets.dart';
part 'pos_bill_widgets.dart';
part 'pos_shared_widgets.dart';
part 'pos_dialogs.dart';

class PosScreen extends StatefulWidget {
  PosScreen({super.key});

  @override
  State<PosScreen> createState() => _PosScreenState();
}

class _PosScreenState extends State<PosScreen> {
  final SocketService _socketService = SocketService();
  final _money = NumberFormat.decimalPattern('vi_VN');
  // One order can emit 10+ socket events in a burst; coalesce the reloads.
  final Debouncer _socketRefresh = Debouncer();
  // Cờ tích lũy qua các event trong cùng cửa sổ debounce (callback bị thay
  // thế mỗi lần gọi nên không được nhét cờ vào closure).
  bool _menuDirty = false;
  bool _configDirty = false;
  int _pendingCount = 0;
  bool _openingPayment = false;

  @override
  void initState() {
    super.initState();
    BlackBox.screen = 'pos';
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final pos = context.read<PosProvider>();
      final auth = context.read<AuthProvider>();
      context.read<CustomerDisplayController>().resumeSalesMirror();

      pos.loadFloor();
      pos.loadMenu();
      pos.loadShift();
      pos.loadOperationsConfig();

      _socketService.connect(
        baseUrl: auth.serverUrl,
        branch: auth.selectedBranchId,
        token: auth.token ?? '',
      );
      _socketService.addListener(_onSocketEvent);
      _loadPendingCount();
    });
  }

  void _onSocketEvent(String event, dynamic payload) {
    if (!mounted) return;
    // Sửa món / tắt món / đổi giá từ máy khác giữa giờ → menu tươi ngay.
    if (event == 'menu:updated' || event == kSyncReconnected) {
      _menuDirty = true;
    }
    // Đổi settings (phương thức thanh toán, ca...) từ máy khác.
    if (event == 'settings:updated' || event == kSyncReconnected) {
      _configDirty = true;
    }
    if (event == 'order:pending' ||
        event == 'staff:call' ||
        event == 'order:new' ||
        event == 'order:updated' ||
        event == 'order:item' ||
        event == 'table:updated' ||
        event == 'payment:done' ||
        event == 'shift:updated' ||
        _menuDirty ||
        _configDirty) {
      _socketRefresh(() {
        if (!mounted) return;
        final pos = context.read<PosProvider>();
        pos.loadFloor();
        pos.loadShift();
        if (_menuDirty) pos.loadMenu();
        if (_configDirty) pos.loadOperationsConfig();
        _menuDirty = false;
        _configDirty = false;
        _loadPendingCount();
      });
    }
  }

  Future<void> _loadPendingCount() async {
    try {
      final api = context.read<ApiService>();
      final list = await api.getPendingConfirmations();
      if (mounted) {
        setState(() {
          _pendingCount = list.length;
        });
      }
    } catch (e) {
      dlog('Failed to load pending confirmations count: $e');
    }
  }

  Future<void> _openPendingConfirmDialog() async {
    final pos = context.read<PosProvider>();
    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) =>
          _PendingConfirmDialog(api: context.read<ApiService>()),
    );
    if (result == true || result == null) {
      pos.loadFloor();
      _loadPendingCount();
    }
  }

  @override
  void dispose() {
    _socketRefresh.dispose();
    _socketService.removeListener(_onSocketEvent);
    super.dispose();
  }

  String _vnd(num value) => t('${_money.format(value)}đ');

  bool _isFree(TableModel table) {
    final status = table.status.toLowerCase();
    if (table.activeOrderId != null) return false;
    return status == 'free' || status == 'empty' || status.isEmpty;
  }

  bool _isPaying(TableModel table) {
    final status = table.status.toLowerCase();
    return status == 'paying' || status == 'checking_out';
  }

  bool _isCalling(TableModel table) =>
      table.status.toLowerCase() == 'calling' || table.callReason.isNotEmpty;

  int _openCount(List<TableModel> tables) =>
      tables.where((table) => !_isFree(table)).length;

  void _toast(String message) => appToast(context, message);

  Future<void> _selectTable(TableModel table) async {
    final pos = context.read<PosProvider>();
    await pos.selectTable(table);
  }

  Future<bool> _saveDraftOrder() async {
    final pos = context.read<PosProvider>();
    try {
      await pos.submitOrder();
      return true;
    } catch (e) {
      if (mounted) _toast(t('Không lưu được đơn: ${_cleanError(e)}'));
      return false;
    }
  }

  void _openShiftDialog() {
    showDialog(context: context, builder: (_) => ShiftDialog());
  }

  RetailCustomer? _checkoutCustomer(Map<String, dynamic>? raw) {
    if (raw == null) return null;
    return RetailCustomer.fromJson(raw);
  }

  Future<Map<String, dynamic>?> _showCheckoutDialog(PosProvider pos) {
    return showDialog<Map<String, dynamic>>(
      context: context,
      builder: (_) => CheckoutDialog(
        api: context.read<ApiService>(),
        cart: [],
        operationsConfig: pos.operationsConfig ?? {},
        invoiceLabel: pos.activeBillNo ?? pos.activeOrderId ?? 'POS',
        customer: _checkoutCustomer(pos.selectedCustomer),
        voucher: null,
        subtotal: pos.cartSubtotal,
        productDiscount: 0,
        orderDiscount: pos.activeDiscount,
        customerDiscount: 0,
        manualDiscount: 0,
        total: pos.cartTotal,
        orderId: pos.activeOrderId,
        itemCount: pos.cart.length,
        channelLabel: 'Checkout',
      ),
    );
  }

  Future<void> _afterCheckout(
      PosProvider pos, Map<String, dynamic>? receipt) async {
    if (receipt == null) return;
    await pos.selectTable(null);
    await pos.loadFloor();
    await pos.loadShift();
    if (!mounted) return;
    _toast('Đã thanh toán ${_vnd(receipt['total'] ?? 0)}');
    final printError = '${receipt['print_error'] ?? ''}'.trim();
    if (printError.isNotEmpty) {
      _toast(t('Đã thanh toán, nhưng chưa in được: $printError'));
    }
  }

  Future<void> _openCheckoutDialog() async {
    if (_openingPayment) return;
    final pos = context.read<PosProvider>();
    if (pos.cart.isEmpty) return;
    setState(() => _openingPayment = true);
    try {
      await pos.submitOrder();
      final selected = pos.selectedTable;
      if ((pos.activeOrderId == null || pos.cartTotal <= 0) &&
          selected?.activeOrderId != null) {
        await pos.selectTable(selected);
      }
      if (pos.cart.any((item) => item.status == 'pending_confirm')) {
        if (mounted) _toast(t('Gửi món vào bếp/bar trước khi thanh toán.'));
        return;
      }
      if (pos.activeOrderId == null || pos.cartTotal <= 0) {
        if (mounted) {
          _toast(t(
              'Không tìm thấy bill đang mở để thanh toán. Vui lòng chọn lại bàn.'));
        }
        return;
      }
      if (!mounted) return;
      await _afterCheckout(pos, await _showCheckoutDialog(pos));
    } catch (e) {
      if (mounted) _toast(t('Không mở được thanh toán: ${_cleanError(e)}'));
    } finally {
      if (mounted) setState(() => _openingPayment = false);
    }
  }

  void _openOrderHistoryDialog() {
    final api = context.read<ApiService>();
    showDialog<void>(
      context: context,
      builder: (_) => OrderHistoryDialog(api: api),
    );
  }

  String _cleanError(Object e) => e.toString().replaceFirst('Exception: ', '');

  Future<TableModel?> _pickTable({
    required String title,
    required List<TableModel> tables,
    required bool showAmount,
  }) {
    final rows = [...tables]..sort((a, b) => a.code.compareTo(b.code));
    return showDialog<TableModel>(
      context: context,
      builder: (dialogContext) => Dialog(
        backgroundColor: DanColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: DanColors.border),
        ),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: 520, maxHeight: 620),
          child: Padding(
            padding: EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(title,
                    style:
                        TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
                SizedBox(height: 12),
                Expanded(
                  child: rows.isEmpty
                      ? Center(
                          child: Text(t('Không có bàn phù hợp'),
                              style: TextStyle(color: DanColors.faint)),
                        )
                      : ListView.separated(
                          itemCount: rows.length,
                          separatorBuilder: (_, __) => SizedBox(height: 8),
                          itemBuilder: (_, i) {
                            final table = rows[i];
                            return _PickTableRow(
                              table: table,
                              money: _vnd,
                              free: _isFree(table),
                              showAmount: showAmount,
                              onTap: () =>
                                  Navigator.of(dialogContext).pop(table),
                            );
                          },
                        ),
                ),
                SizedBox(height: 14),
                FilledButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: Text(t('Đóng')),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _moveTable() async {
    final pos = context.read<PosProvider>();
    final table = pos.selectedTable;
    if (table == null || pos.cart.isEmpty) return;
    try {
      await pos.submitOrder();
      if (!mounted) return;
      final target = await _pickTable(
        title: t('Chuyển bàn ${table.code} sang'),
        tables:
            pos.tables.where((t) => t.id != table.id && _isFree(t)).toList(),
        showAmount: false,
      );
      if (target == null) return;
      await pos.moveSelectedTable(target.id);
      if (mounted)
        _toast(t('Đã chuyển bàn ${table.code} sang ${target.code}.'));
    } catch (e) {
      if (mounted) _toast(t('Không chuyển được bàn: ${_cleanError(e)}'));
    }
  }

  Future<void> _mergeTable() async {
    final pos = context.read<PosProvider>();
    final table = pos.selectedTable;
    if (table == null || pos.cart.isEmpty) return;
    try {
      await pos.submitOrder();
      if (!mounted) return;
      final target = await _pickTable(
        title: t('Gộp bàn ${table.code} vào'),
        tables:
            pos.tables.where((t) => t.id != table.id && !_isFree(t)).toList(),
        showAmount: true,
      );
      if (target == null) return;
      await pos.mergeSelectedTable(target.id);
      if (mounted) _toast(t('Đã gộp bàn ${table.code} vào ${target.code}.'));
    } catch (e) {
      if (mounted) _toast(t('Không gộp được bàn: ${_cleanError(e)}'));
    }
  }

  Future<void> _splitBill() async {
    final pos = context.read<PosProvider>();
    final table = pos.selectedTable;
    if (table == null || pos.cart.length < 2) return;
    try {
      await pos.submitOrder();
      final items = pos.cart.where((i) => i.persisted).toList();
      if (!mounted || items.length < 2) return;
      final selected = await _pickSplitItems(table, items);
      if (selected == null || selected.isEmpty) return;
      await pos.splitActiveOrder(selected);
      if (!mounted) return;
      await _afterCheckout(pos, await _showCheckoutDialog(pos));
    } catch (e) {
      if (mounted) _toast(t('Không tách được bill: ${_cleanError(e)}'));
    }
  }

  Future<List<String>?> _pickSplitItems(
    TableModel table,
    List<CartItem> items,
  ) {
    final selected = <String>{};
    return showDialog<List<String>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setModalState) {
          final valid = selected.isNotEmpty && selected.length < items.length;
          return Dialog(
            backgroundColor: DanColors.surface,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
              side: BorderSide(color: DanColors.border),
            ),
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: 620, maxHeight: 620),
              child: Padding(
                padding: EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(t('Tách bill bàn ${table.code}'),
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w900)),
                    SizedBox(height: 4),
                    Text(t('Chọn các dòng khách muốn thanh toán riêng.'),
                        style:
                            TextStyle(color: DanColors.muted, fontSize: 12.5)),
                    SizedBox(height: 14),
                    Expanded(
                      child: ListView.separated(
                        itemCount: items.length,
                        separatorBuilder: (_, __) => SizedBox(height: 8),
                        itemBuilder: (_, i) {
                          final item = items[i];
                          final on = selected.contains(item.orderItemId);
                          return CheckboxListTile(
                            value: on,
                            dense: true,
                            activeColor: DanColors.brand,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                              side: BorderSide(color: DanColors.border),
                            ),
                            tileColor: DanColors.surface2,
                            title: Text('${item.qty}× ${item.item.name}',
                                style: TextStyle(
                                    fontWeight: FontWeight.w800, fontSize: 13)),
                            subtitle: Text(_vnd(item.totalPrice),
                                style: TextStyle(
                                    color: DanColors.brand,
                                    fontFamily: 'JetBrains Mono')),
                            onChanged: (v) => setModalState(() {
                              if (v == true) {
                                selected.add(item.orderItemId);
                              } else {
                                selected.remove(item.orderItemId);
                              }
                            }),
                          );
                        },
                      ),
                    ),
                    SizedBox(height: 14),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: () => Navigator.of(dialogContext).pop(),
                            child: Text(t('Hủy')),
                          ),
                        ),
                        SizedBox(width: 8),
                        Expanded(
                          child: FilledButton(
                            onPressed: valid
                                ? () => Navigator.of(dialogContext)
                                    .pop(selected.toList())
                                : null,
                            child: Text(t('Tách và thanh toán riêng')),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Future<void> _pickCustomer() async {
    final pos = context.read<PosProvider>();
    try {
      final customers = (await context.read<ApiService>().getCustomers())
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      if (!mounted) return;
      final picked = await _customerDialog(customers, pos.selectedCustomer);
      if (picked == null) return;
      if (picked is _NoCustomerSelection) {
        pos.setCustomer(null);
        pos.setDiscount(0);
        return;
      }
      final customer = Map<String, dynamic>.from(picked as Map);
      pos.setCustomer(customer);
      final discount = _customerDiscount(customer, pos.cartSubtotal);
      if (discount > 0) pos.setDiscount(discount);
    } catch (e) {
      if (mounted) _toast(t('Không tải được khách hàng: ${_cleanError(e)}'));
    }
  }

  num _num(dynamic value) {
    if (value is num) return value;
    return num.tryParse(value?.toString() ?? '') ?? 0;
  }

  double _customerDiscount(Map<String, dynamic> customer, double subtotal) {
    final type = customer['perk_type']?.toString() ?? 'none';
    final value = _num(customer['perk_value']).toDouble();
    if (type == 'free') return subtotal;
    if (type == 'pct') return math.min(subtotal, subtotal * value / 100);
    if (type == 'amount') return math.min(subtotal, value);
    return 0;
  }

  Future<Object?> _customerDialog(
    List<Map<String, dynamic>> customers,
    Map<String, dynamic>? selected,
  ) {
    final search = TextEditingController();
    String q = '';
    return showDialog<Object>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setModalState) {
          final needle = q.trim().toLowerCase();
          final rows = needle.isEmpty
              ? customers
              : customers.where((c) {
                  final haystack = [
                    c['name'],
                    c['phone'],
                    c['tax_code'],
                    c['company'],
                  ].join(' ').toLowerCase();
                  return haystack.contains(needle);
                }).toList();
          return Dialog(
            backgroundColor: DanColors.surface,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
              side: BorderSide(color: DanColors.border),
            ),
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: 720, maxHeight: 560),
              child: Padding(
                padding: EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(t('Khách hàng'),
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w900)),
                    SizedBox(height: 4),
                    Text(
                      t('Chọn khách đã lưu hoặc tạo mới. Khách có ưu đãi sẽ tự áp giảm giá vào đơn.'),
                      style: TextStyle(color: DanColors.muted, fontSize: 12.5),
                    ),
                    SizedBox(height: 14),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: search,
                            decoration: InputDecoration(
                              hintText: t('Tìm theo tên / SĐT / MST'),
                              isDense: true,
                            ),
                            onChanged: (v) => setModalState(() => q = v),
                          ),
                        ),
                        SizedBox(width: 8),
                        OutlinedButton(
                          onPressed: () => Navigator.of(dialogContext)
                              .pop(_NoCustomerSelection()),
                          child: Text(t('Bán cho người tiêu dùng')),
                        ),
                        SizedBox(width: 8),
                        FilledButton.icon(
                          onPressed: () async {
                            final saved = await _createCustomerDialog();
                            if (saved != null && dialogContext.mounted) {
                              Navigator.of(dialogContext).pop(saved);
                            }
                          },
                          icon: Icon(Icons.add, size: 16),
                          label: Text(t('Khách mới')),
                        ),
                      ],
                    ),
                    SizedBox(height: 8),
                    Expanded(
                      child: rows.isEmpty
                          ? Center(
                              child: Text(t('Chưa có khách phù hợp'),
                                  style: TextStyle(color: DanColors.faint)),
                            )
                          : ListView.separated(
                              itemCount: rows.length,
                              separatorBuilder: (_, __) => SizedBox(height: 8),
                              itemBuilder: (_, i) {
                                final c = rows[i];
                                final on = c['id']?.toString() ==
                                    selected?['id']?.toString();
                                return _CustomerRow(
                                  customer: c,
                                  selected: on,
                                  onTap: () =>
                                      Navigator.of(dialogContext).pop(c),
                                );
                              },
                            ),
                    ),
                    SizedBox(height: 8),
                    OutlinedButton(
                      onPressed: () => Navigator.of(dialogContext).pop(),
                      child: Text(t('Đóng')),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    ).whenComplete(search.dispose);
  }

  Future<Map<String, dynamic>?> _createCustomerDialog() async {
    final name = TextEditingController();
    final phone = TextEditingController();
    final tax = TextEditingController();
    final company = TextEditingController();
    try {
      return showDialog<Map<String, dynamic>>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          backgroundColor: DanColors.surface,
          title: Text(t('Khách mới')),
          content: SizedBox(
            width: dialogWidth(context, 420),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                    controller: name,
                    decoration: InputDecoration(labelText: t('Tên khách'))),
                SizedBox(height: 8),
                TextField(
                    controller: phone,
                    decoration: InputDecoration(labelText: t('SĐT'))),
                SizedBox(height: 8),
                TextField(
                    controller: tax,
                    decoration: InputDecoration(labelText: 'MST')),
                SizedBox(height: 8),
                TextField(
                    controller: company,
                    decoration: InputDecoration(labelText: t('Tên công ty'))),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: Text(t('Hủy')),
            ),
            FilledButton(
              onPressed: () async {
                final body = {
                  'name': name.text.trim(),
                  'phone': phone.text.trim(),
                  'tax_code': tax.text.trim(),
                  'company': company.text.trim(),
                  'partner_type': 'customer',
                };
                if (body.values.every((v) => v.toString().isEmpty)) return;
                try {
                  final saved =
                      await context.read<ApiService>().upsertCustomer(body);
                  if (dialogContext.mounted) {
                    Navigator.of(dialogContext).pop(saved);
                  }
                } catch (e) {
                  if (dialogContext.mounted) {
                    ScaffoldMessenger.of(dialogContext).showSnackBar(SnackBar(
                      content: Text(_cleanError(e)),
                      backgroundColor: DanColors.late,
                    ));
                  }
                }
              },
              child: Text(t('Lưu')),
            ),
          ],
        ),
      );
    } finally {
      name.dispose();
      phone.dispose();
      tax.dispose();
      company.dispose();
    }
  }

  Future<void> _setDiscount() async {
    final pos = context.read<PosProvider>();
    final value = await _promptText(
      title: t('Giảm giá'),
      label: t('Số tiền giảm (VND)'),
      initial: pos.activeDiscount.round().toString(),
      keyboardType: TextInputType.number,
    );
    if (value == null) return;
    final amount =
        math.min(pos.cartSubtotal, _num(value.replaceAll('.', '')).toDouble());
    pos.setDiscount(math.max(0, amount));
  }

  Future<String?> _promptText({
    required String title,
    required String label,
    String initial = '',
    TextInputType keyboardType = TextInputType.text,
  }) {
    final controller = TextEditingController(text: initial);
    return showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: DanColors.surface,
        title: Text(title),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: keyboardType,
          decoration: InputDecoration(labelText: label),
          onSubmitted: (v) => Navigator.of(dialogContext).pop(v),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(t('Hủy')),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(controller.text.trim()),
            child: Text('OK'),
          ),
        ],
      ),
    ).whenComplete(controller.dispose);
  }

  Future<void> _printTempBill() async {
    final pos = context.read<PosProvider>();
    final api = context.read<ApiService>();
    try {
      await pos.submitOrder();
      final orderId = pos.activeOrderId;
      if (orderId == null) return;
      await api.printOrderReceipt(orderId);
      if (mounted) _toast(t('Đã gửi lệnh in tạm tính.'));
    } catch (e) {
      if (mounted) _toast(t('Không in được tạm tính: ${_cleanError(e)}'));
    }
  }

  Future<void> _sendKitchen() async {
    final pos = context.read<PosProvider>();
    try {
      await pos.confirmActiveOrder();
      if (mounted) _toast(t('Đã gửi món vào bếp/bar.'));
    } catch (e) {
      if (mounted) _toast(t('Không gửi được món: ${_cleanError(e)}'));
    }
  }

  Future<void> _cancelItem(CartItem item) async {
    final pos = context.read<PosProvider>();
    final auth = context.read<AuthProvider>();
    String? pin;
    var reason = t('Nhân viên hủy');

    // Món nháp (chưa gửi lên server): xóa tự do, không cần quyền.
    if (!item.persisted) {
      await pos.cancelCartItem(item);
      return;
    }

    // Món chờ khách xác nhận (self-order) — server không đòi quyền; các trạng
    // thái còn lại phân 2 cấp: ĐÃ chế biến cần quyền riêng "void.made", còn lại
    // (đã gửi nhưng chưa làm) cần quyền "void". Admin/owner bỏ qua tất cả.
    if (item.status != 'pending_confirm') {
      final made = ['preparing', 'ready', 'served'].contains(item.status);
      final needPerm = made ? 'void.made' : 'void';
      final selfHasPerm = auth.hasPermission(needPerm);

      if (!selfHasPerm) {
        pin = await requestManagerPin(
          context,
          made
              ? t('Xóa món ĐÃ chế biến "${item.item.name}". Cần PIN người có quyền "xóa món đã chế biến".')
              : t('Hủy món "${item.item.name}". Cần PIN người có quyền hủy món.'),
        );
        if (pin == null) return;
      }

      // Món đã chế biến hoặc phải mượn quyền người khác → ghi lý do để đối soát.
      if (made || pin != null) {
        reason = await _promptText(
              title: t('Lý do hủy món'),
              label: t('Lý do'),
              initial: reason,
            ) ??
            reason;
      }
    }
    try {
      await pos.cancelCartItem(item, reason: reason, managerPin: pin);
      if (mounted) _toast(t('Đã hủy món.'));
    } catch (e) {
      if (mounted) _toast(t('Không hủy được món: ${_cleanError(e)}'));
    }
  }

  Future<void> _showMenuPicker(
      {required String title, bool isRetail = false}) async {
    final pos = context.read<PosProvider>();
    final api = context.read<ApiService>();

    await showDialog<void>(
      context: context,
      builder: (dialogContext) {
        return _MenuPickerDialog(
          title: title,
          pos: pos,
          api: api,
          onAdd: _addMenuItem,
          isRetail: isRetail,
        );
      },
    );
  }

  Future<bool> _addMenuItem(MenuItem item) async {
    if (item.modifiers.isEmpty) {
      context.read<PosProvider>().addToCart(item, [], '');
      return _saveDraftOrder();
    }

    final selected = <Modifier>[];
    final noteController = TextEditingController();

    final added = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return AlertDialog(
              backgroundColor: DanColors.surface,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
                side: BorderSide(color: DanColors.border),
              ),
              title: Text(
                item.name,
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
              content: SizedBox(
                width: dialogWidth(context, 420),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ...item.modifiers.map((modifier) {
                      final on = selected.any((m) => m.name == modifier.name);
                      return CheckboxListTile(
                        value: on,
                        activeColor: DanColors.brand,
                        title: Text(modifier.name),
                        subtitle: Text('+${_vnd(modifier.price)}'),
                        onChanged: (checked) {
                          setModalState(() {
                            if (checked == true) {
                              selected.add(modifier);
                            } else {
                              selected
                                  .removeWhere((m) => m.name == modifier.name);
                            }
                          });
                        },
                      );
                    }),
                    SizedBox(height: 8),
                    TextField(
                      controller: noteController,
                      decoration: InputDecoration(hintText: t('Ghi chú món')),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: Text(t('Hủy')),
                ),
                FilledButton(
                  onPressed: () async {
                    context.read<PosProvider>().addToCart(
                          item,
                          List<Modifier>.from(selected),
                          noteController.text.trim(),
                        );
                    final saved = await _saveDraftOrder();
                    if (saved && dialogContext.mounted) {
                      Navigator.of(dialogContext).pop(true);
                    }
                  },
                  child: Text(t('Thêm món')),
                ),
              ],
            );
          },
        );
      },
    );
    return added == true;
  }

  /// Floor map — rebuilds ONLY when the table list, selection or floor-loading
  /// flag change. Cart edits (qty, add/remove) leave these identical, so the
  /// (potentially large) grid of table cards is not re-laid-out on every tap.
  Widget _floorMap() {
    return Selector<PosProvider, (List<TableModel>, TableModel?, bool)>(
      selector: (_, p) => (p.tables, p.selectedTable, p.isLoadingFloor),
      builder: (_, sel, __) => _FloorMap(
        tables: sel.$1,
        selectedTable: sel.$2,
        loading: sel.$3,
        onSelect: _selectTable,
        money: _vnd,
        isFree: _isFree,
        isPaying: _isPaying,
        isCalling: _isCalling,
      ),
    );
  }

  /// Bill pane — Consumer (not Selector) because the cart is mutated in place
  /// (qty++), so it must rebuild on every notify; that's cheap (a short list).
  Widget _billPane() {
    return Consumer<PosProvider>(
      builder: (_, pos, __) => _BillPane(
        pos: pos,
        money: _vnd,
        isFree: _isFree,
        isPaying: _isPaying,
        isCalling: _isCalling,
        onAddFood: () =>
            _showMenuPicker(title: t('Thêm món FnB'), isRetail: false),
        onAddRetail: () =>
            _showMenuPicker(title: t('Thêm retail'), isRetail: true),
        onMove: _moveTable,
        onMerge: _mergeTable,
        onSplit: _splitBill,
        onCustomer: _pickCustomer,
        onDiscount: _setDiscount,
        onPrint: _printTempBill,
        onSendKitchen: _sendKitchen,
        onCancelItem: _cancelItem,
        onPayment: _openCheckoutDialog,
        openingPayment: _openingPayment,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // NOTE: we intentionally do NOT watch PosProvider at this top level — that
    // rebuilt the whole screen (floor + bill) on every cart tap. Instead each
    // panel subscribes to just its slice via Selector/Consumer below, so an
    // order edit only rebuilds the bill, not the floor map.
    final auth = context.watch<AuthProvider>();

    return Scaffold(
      backgroundColor: DanColors.bg,
      body: Column(
        children: [
          RepaintBoundary(
            child: DanModuleTopBar(
              brandName: auth.selectedBranch.name,
              title: 'POS Cashier',
              subtitle: '',
              titleIcon: Icons.credit_card,
              userName:
                  auth.currentUser?.name ?? auth.currentUser?.username ?? '',
              userRole: roleLabel(auth.currentUser?.role ?? ''),
              online: true,
              onBack: () => Navigator.of(context).maybePop(),
              onLogout: () => auth.logout(),
              actions: [
                Badge(
                  isLabelVisible: _pendingCount > 0,
                  label: Text('$_pendingCount'),
                  backgroundColor: DanColors.late,
                  textColor: Colors.white,
                  child: DanTopBarIconButton(
                    icon: Icons.notifications_none,
                    onPressed: _openPendingConfirmDialog,
                  ),
                ),
                Selector<PosProvider, bool>(
                  selector: (_, p) => p.currentShift != null,
                  builder: (context, shiftOpen, __) {
                    final width = MediaQuery.of(context).size.width;
                    final label = shiftOpen
                        ? (width < 1100 ? t('Ca mở') : t('Ca: đang mở'))
                        : (width < 1100 ? t('Ca đóng') : t('Ca: chưa mở'));
                    return DanTopBarButton(
                      label: label,
                      danger: !shiftOpen,
                      success: shiftOpen,
                      minWidth: width < 1100 ? 0 : 132,
                      onPressed: _openShiftDialog,
                    );
                  },
                ),
                DanTopBarButton(
                  label: t('Lịch sử'),
                  icon: Icons.receipt_long_outlined,
                  onPressed: _openOrderHistoryDialog,
                ),
                // t("Màn hình phụ") chuyển vào Cài đặt → Màn hình phụ (dùng chung
                // FnB + Retail): mở/cấu hình màn 2 tại một chỗ duy nhất.
                Selector<PosProvider, int>(
                  selector: (_, p) => _openCount(p.tables),
                  builder: (_, n, __) =>
                      DanTopBarCountChip(label: '$n ${t('BÀN MỞ')}'),
                ),
              ],
            ),
          ),
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) {
                final compact = constraints.maxWidth < 980;
                if (compact) {
                  return ListView(
                    padding: EdgeInsets.all(10),
                    children: [
                      RepaintBoundary(child: _floorMap()),
                      SizedBox(height: 12),
                      SizedBox(
                          height: 520,
                          child: RepaintBoundary(child: _billPane())),
                    ],
                  );
                }

                return Padding(
                  padding: EdgeInsets.all(12),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Expanded(child: RepaintBoundary(child: _floorMap())),
                      ResizablePane(
                        storageKey: 'fnb',
                        maxAvailable: constraints.maxWidth,
                        minWidth: 360,
                        maxWidth: 720,
                        defaultWidth: math.min(
                          632.0,
                          math.max(380.0, constraints.maxWidth * 0.335),
                        ),
                        child: RepaintBoundary(child: _billPane()),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

