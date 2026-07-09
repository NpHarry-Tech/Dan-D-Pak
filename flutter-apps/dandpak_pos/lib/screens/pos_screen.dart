import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/pos_models.dart';
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
import 'order_history_dialog.dart';
import 'payment_dialog.dart';
import 'shift_dialog.dart';
import '../services/black_box.dart';

class PosScreen extends StatefulWidget {
  const PosScreen({super.key});

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

  String _vnd(num value) => '${_money.format(value)}đ';

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

  void _toast(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        behavior: SnackBarBehavior.floating,
        backgroundColor: DanColors.text,
      ),
    );
  }

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
      if (mounted) _toast('Không lưu được đơn: ${_cleanError(e)}');
      return false;
    }
  }

  void _openShiftDialog() {
    showDialog(context: context, builder: (_) => const ShiftDialog());
  }

  Future<void> _openPaymentDialog() async {
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
        if (mounted) _toast('Gửi món vào bếp/bar trước khi thanh toán.');
        return;
      }
      if (pos.activeOrderId == null || pos.cartTotal <= 0) {
        if (mounted) {
          _toast(
              'Không tìm thấy bill đang mở để thanh toán. Vui lòng chọn lại bàn.');
        }
        return;
      }
      if (!mounted) return;
      await showDialog(context: context, builder: (_) => const PaymentDialog());
    } catch (e) {
      if (mounted) _toast('Không mở được thanh toán: ${_cleanError(e)}');
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
          side: const BorderSide(color: DanColors.border),
        ),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520, maxHeight: 620),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(title,
                    style: const TextStyle(
                        fontSize: 18, fontWeight: FontWeight.w900)),
                const SizedBox(height: 12),
                Expanded(
                  child: rows.isEmpty
                      ? const Center(
                          child: Text('Không có bàn phù hợp',
                              style: TextStyle(color: DanColors.faint)),
                        )
                      : ListView.separated(
                          itemCount: rows.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 8),
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
                const SizedBox(height: 14),
                FilledButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: const Text('Đóng'),
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
        title: 'Chuyển bàn ${table.code} sang',
        tables:
            pos.tables.where((t) => t.id != table.id && _isFree(t)).toList(),
        showAmount: false,
      );
      if (target == null) return;
      await pos.moveSelectedTable(target.id);
      if (mounted) _toast('Đã chuyển bàn ${table.code} sang ${target.code}.');
    } catch (e) {
      if (mounted) _toast('Không chuyển được bàn: ${_cleanError(e)}');
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
        title: 'Gộp bàn ${table.code} vào',
        tables:
            pos.tables.where((t) => t.id != table.id && !_isFree(t)).toList(),
        showAmount: true,
      );
      if (target == null) return;
      await pos.mergeSelectedTable(target.id);
      if (mounted) _toast('Đã gộp bàn ${table.code} vào ${target.code}.');
    } catch (e) {
      if (mounted) _toast('Không gộp được bàn: ${_cleanError(e)}');
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
      await showDialog(context: context, builder: (_) => const PaymentDialog());
    } catch (e) {
      if (mounted) _toast('Không tách được bill: ${_cleanError(e)}');
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
              side: const BorderSide(color: DanColors.border),
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 620, maxHeight: 620),
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Tách bill bàn ${table.code}',
                        style: const TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w900)),
                    const SizedBox(height: 4),
                    const Text('Chọn các dòng khách muốn thanh toán riêng.',
                        style:
                            TextStyle(color: DanColors.muted, fontSize: 12.5)),
                    const SizedBox(height: 14),
                    Expanded(
                      child: ListView.separated(
                        itemCount: items.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (_, i) {
                          final item = items[i];
                          final on = selected.contains(item.orderItemId);
                          return CheckboxListTile(
                            value: on,
                            dense: true,
                            activeColor: DanColors.brand,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                              side: const BorderSide(color: DanColors.border),
                            ),
                            tileColor: DanColors.surface2,
                            title: Text('${item.qty}× ${item.item.name}',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w800, fontSize: 13)),
                            subtitle: Text(_vnd(item.totalPrice),
                                style: const TextStyle(
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
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: () => Navigator.of(dialogContext).pop(),
                            child: const Text('Hủy'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: FilledButton(
                            onPressed: valid
                                ? () => Navigator.of(dialogContext)
                                    .pop(selected.toList())
                                : null,
                            child: const Text('Tách và thanh toán riêng'),
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
      if (mounted) _toast('Không tải được khách hàng: ${_cleanError(e)}');
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
              side: const BorderSide(color: DanColors.border),
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 720, maxHeight: 560),
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text('Khách hàng',
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w900)),
                    const SizedBox(height: 4),
                    const Text(
                      'Chọn khách đã lưu hoặc tạo mới. Khách có ưu đãi sẽ tự áp giảm giá vào đơn.',
                      style: TextStyle(color: DanColors.muted, fontSize: 12.5),
                    ),
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: search,
                            decoration: const InputDecoration(
                              hintText: 'Tìm theo tên / SĐT / MST',
                              isDense: true,
                            ),
                            onChanged: (v) => setModalState(() => q = v),
                          ),
                        ),
                        const SizedBox(width: 8),
                        OutlinedButton(
                          onPressed: () => Navigator.of(dialogContext)
                              .pop(const _NoCustomerSelection()),
                          child: const Text('Bán cho người tiêu dùng'),
                        ),
                        const SizedBox(width: 8),
                        FilledButton.icon(
                          onPressed: () async {
                            final saved = await _createCustomerDialog();
                            if (saved != null && dialogContext.mounted) {
                              Navigator.of(dialogContext).pop(saved);
                            }
                          },
                          icon: const Icon(Icons.add, size: 16),
                          label: const Text('Khách mới'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Expanded(
                      child: rows.isEmpty
                          ? const Center(
                              child: Text('Chưa có khách phù hợp',
                                  style: TextStyle(color: DanColors.faint)),
                            )
                          : ListView.separated(
                              itemCount: rows.length,
                              separatorBuilder: (_, __) =>
                                  const SizedBox(height: 8),
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
                    const SizedBox(height: 8),
                    OutlinedButton(
                      onPressed: () => Navigator.of(dialogContext).pop(),
                      child: const Text('Đóng'),
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
          title: const Text('Khách mới'),
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                    controller: name,
                    decoration: const InputDecoration(labelText: 'Tên khách')),
                const SizedBox(height: 8),
                TextField(
                    controller: phone,
                    decoration: const InputDecoration(labelText: 'SĐT')),
                const SizedBox(height: 8),
                TextField(
                    controller: tax,
                    decoration: const InputDecoration(labelText: 'MST')),
                const SizedBox(height: 8),
                TextField(
                    controller: company,
                    decoration:
                        const InputDecoration(labelText: 'Tên công ty')),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Hủy'),
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
              child: const Text('Lưu'),
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
      title: 'Giảm giá',
      label: 'Số tiền giảm (VND)',
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
            child: const Text('Hủy'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(controller.text.trim()),
            child: const Text('OK'),
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
      if (mounted) _toast('Đã gửi lệnh in tạm tính.');
    } catch (e) {
      if (mounted) _toast('Không in được tạm tính: ${_cleanError(e)}');
    }
  }

  Future<void> _sendKitchen() async {
    final pos = context.read<PosProvider>();
    try {
      await pos.confirmActiveOrder();
      if (mounted) _toast('Đã gửi món vào bếp/bar.');
    } catch (e) {
      if (mounted) _toast('Không gửi được món: ${_cleanError(e)}');
    }
  }

  Future<void> _cancelItem(CartItem item) async {
    final pos = context.read<PosProvider>();
    final auth = context.read<AuthProvider>();
    String? pin;
    var reason = 'Nhân viên hủy';

    // Món nháp (chưa gửi lên server): xóa tự do, không cần quyền.
    if (!item.persisted) {
      await pos.cancelCartItem(item);
      return;
    }

    // Món chờ khách xác nhận (self-order) — server không đòi quyền; các trạng
    // thái còn lại phân 2 cấp: ĐÃ chế biến cần quyền riêng "void.made", còn lại
    // (đã gửi nhưng chưa làm) cần quyền "void". Admin/owner bỏ qua tất cả.
    if (item.status != 'pending_confirm') {
      final made = const ['preparing', 'ready', 'served'].contains(item.status);
      final needPerm = made ? 'void.made' : 'void';
      final selfHasPerm = auth.hasPermission(needPerm);

      if (!selfHasPerm) {
        pin = await requestManagerPin(
          context,
          made
              ? 'Xóa món ĐÃ chế biến "${item.item.name}". Cần PIN người có quyền "xóa món đã chế biến".'
              : 'Hủy món "${item.item.name}". Cần PIN người có quyền hủy món.',
        );
        if (pin == null) return;
      }

      // Món đã chế biến hoặc phải mượn quyền người khác → ghi lý do để đối soát.
      if (made || pin != null) {
        reason = await _promptText(
              title: 'Lý do hủy món',
              label: 'Lý do',
              initial: reason,
            ) ??
            reason;
      }
    }
    try {
      await pos.cancelCartItem(item, reason: reason, managerPin: pin);
      if (mounted) _toast('Đã hủy món.');
    } catch (e) {
      if (mounted) _toast('Không hủy được món: ${_cleanError(e)}');
    }
  }

  Future<void> _showMenuPicker({required String title, bool isRetail = false}) async {
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
      context.read<PosProvider>().addToCart(item, const [], '');
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
                side: const BorderSide(color: DanColors.border),
              ),
              title: Text(
                item.name,
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
              content: SizedBox(
                width: 420,
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
                    const SizedBox(height: 8),
                    TextField(
                      controller: noteController,
                      decoration:
                          const InputDecoration(hintText: 'Ghi chú món'),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: const Text('Hủy'),
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
                  child: const Text('Thêm món'),
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
        onAddFood: () => _showMenuPicker(title: 'Thêm món FnB', isRetail: false),
        onAddRetail: () => _showMenuPicker(title: 'Thêm retail', isRetail: true),
        onMove: _moveTable,
        onMerge: _mergeTable,
        onSplit: _splitBill,
        onCustomer: _pickCustomer,
        onDiscount: _setDiscount,
        onPrint: _printTempBill,
        onSendKitchen: _sendKitchen,
        onCancelItem: _cancelItem,
        onPayment: _openPaymentDialog,
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
                        ? (width < 1100 ? 'Ca mở' : 'Ca: đang mở')
                        : (width < 1100 ? 'Ca đóng' : 'Ca: chưa mở');
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
                  label: 'Lịch sử',
                  icon: Icons.receipt_long_outlined,
                  onPressed: _openOrderHistoryDialog,
                ),
                // "Màn hình phụ" chuyển vào Cài đặt → Màn hình phụ (dùng chung
                // FnB + Retail): mở/cấu hình màn 2 tại một chỗ duy nhất.
                Selector<PosProvider, int>(
                  selector: (_, p) => _openCount(p.tables),
                  builder: (_, n, __) => DanTopBarCountChip(label: '$n BÀN MỞ'),
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
                    padding: const EdgeInsets.all(10),
                    children: [
                      RepaintBoundary(child: _floorMap()),
                      const SizedBox(height: 12),
                      SizedBox(height: 520, child: RepaintBoundary(child: _billPane())),
                    ],
                  );
                }

                return Padding(
                  padding: const EdgeInsets.all(12),
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

class _FloorMap extends StatelessWidget {
  const _FloorMap({
    required this.tables,
    required this.selectedTable,
    required this.loading,
    required this.onSelect,
    required this.money,
    required this.isFree,
    required this.isPaying,
    required this.isCalling,
  });

  final List<TableModel> tables;
  final TableModel? selectedTable;
  final bool loading;
  final ValueChanged<TableModel> onSelect;
  final String Function(num value) money;
  final bool Function(TableModel table) isFree;
  final bool Function(TableModel table) isPaying;
  final bool Function(TableModel table) isCalling;

  @override
  Widget build(BuildContext context) {
    if (loading && tables.isEmpty) {
      return const Center(
          child: CircularProgressIndicator(color: DanColors.brand));
    }

    final grouped = <String, List<TableModel>>{};
    for (final table in tables) {
      grouped.putIfAbsent(
          table.zoneId.isEmpty ? 'Khu vực' : table.zoneId, () => []);
      grouped[table.zoneId.isEmpty ? 'Khu vực' : table.zoneId]!.add(table);
    }

    final total = tables.length;
    final open = tables.where((table) => !isFree(table)).length;
    final paying = tables.where(isPaying).length;
    final calling = tables.where(isCalling).length;

    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            constraints: const BoxConstraints(minHeight: 64),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: DanColors.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: DanColors.border),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Sơ đồ bàn',
                        style: TextStyle(
                            fontSize: 14, fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '$total bàn · ${math.max(0, total - open)} trống',
                        style: const TextStyle(
                          color: DanColors.muted,
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  alignment: WrapAlignment.end,
                  children: [
                    _StatusPill(
                        label: '$open ĐANG DÙNG', color: DanColors.doing),
                    _StatusPill(label: '$paying CHỜ THU', muted: true),
                    if (calling > 0)
                      _StatusPill(
                          label: '$calling ĐANG GỌI', color: DanColors.late),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (grouped.isEmpty)
            const _EmptyBlock(
              title: 'Chưa có bàn',
              sub: 'Vào Cài đặt để cấu hình sơ đồ bàn.',
              minHeight: 300,
            )
          else
            ...grouped.entries.map(
              (entry) => _ZoneSection(
                name: entry.key,
                tables: entry.value,
                selectedTable: selectedTable,
                onSelect: onSelect,
                money: money,
                isFree: isFree,
                isPaying: isPaying,
                isCalling: isCalling,
              ),
            ),
        ],
      ),
    );
  }
}

class _ZoneSection extends StatelessWidget {
  const _ZoneSection({
    required this.name,
    required this.tables,
    required this.selectedTable,
    required this.onSelect,
    required this.money,
    required this.isFree,
    required this.isPaying,
    required this.isCalling,
  });

  final String name;
  final List<TableModel> tables;
  final TableModel? selectedTable;
  final ValueChanged<TableModel> onSelect;
  final String Function(num value) money;
  final bool Function(TableModel table) isFree;
  final bool Function(TableModel table) isPaying;
  final bool Function(TableModel table) isCalling;

  @override
  Widget build(BuildContext context) {
    final open = tables.where((table) => !isFree(table)).length;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    name.toUpperCase(),
                    style: const TextStyle(
                      color: DanColors.muted,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      letterSpacing: .8,
                    ),
                  ),
                ),
                Text(
                  '${tables.length} bàn · $open đang dùng',
                  style: const TextStyle(
                    color: DanColors.faint,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
          LayoutBuilder(
            builder: (context, constraints) {
              const gap = 9.0;
              final minTileWidth = constraints.maxWidth < 1180 ? 88.0 : 104.0;
              final columns = math.max(
                1,
                ((constraints.maxWidth + gap) / (minTileWidth + gap)).floor(),
              );
              final tileWidth =
                  (constraints.maxWidth - (columns - 1) * gap) / columns;

              return SizedBox(
                width: double.infinity,
                child: Wrap(
                  spacing: gap,
                  runSpacing: gap,
                  alignment: WrapAlignment.start,
                  runAlignment: WrapAlignment.start,
                  children: tables.map((table) {
                    return SizedBox(
                      width: tileWidth,
                      height: constraints.maxWidth < 1180 ? 82 : 90,
                      child: _TableCard(
                        table: table,
                        selected: selectedTable?.id == table.id,
                        onTap: () => onSelect(table),
                        money: money,
                        isFree: isFree(table),
                        isPaying: isPaying(table),
                        isCalling: isCalling(table),
                      ),
                    );
                  }).toList(),
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}

class _TableCard extends StatelessWidget {
  const _TableCard({
    required this.table,
    required this.selected,
    required this.onTap,
    required this.money,
    required this.isFree,
    required this.isPaying,
    required this.isCalling,
  });

  final TableModel table;
  final bool selected;
  final VoidCallback onTap;
  final String Function(num value) money;
  final bool isFree;
  final bool isPaying;
  final bool isCalling;

  @override
  Widget build(BuildContext context) {
    final busy = !isFree && !isPaying && !isCalling;
    final border = selected
        ? DanColors.brand
        : isCalling
            ? DanColors.late
            : isPaying
                ? DanColors.paying.withValues(alpha: .55)
                : busy
                    ? DanColors.doing.withValues(alpha: .48)
                    : DanColors.border;
    final bg = isPaying
        ? DanColors.paying.withValues(alpha: .06)
        : busy
            ? DanColors.doing.withValues(alpha: .05)
            : DanColors.surface;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: border, width: selected ? 2 : 1),
        ),
        child: Stack(
          children: [
            if (isCalling || isPaying)
              Positioned(
                top: 0,
                right: 0,
                child: Icon(
                    isCalling
                        ? Icons.notifications_active
                        : Icons.payments_outlined,
                    size: 13,
                    color: isCalling ? DanColors.late : DanColors.paying),
              ),
            Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    table.code,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontFamily: 'JetBrains Mono',
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    isCalling
                        ? 'Đang gọi'
                        : isFree
                            ? 'Trống'
                            : isPaying
                                ? 'Chờ thu ngân'
                                : 'Đang dùng',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: DanColors.faint,
                      fontSize: 10,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  if ((table.activeOrderTotal ?? 0) > 0) ...[
                    const SizedBox(height: 2),
                    Text(
                      money(table.activeOrderTotal!),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: DanColors.brand,
                        fontFamily: 'JetBrains Mono',
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NoCustomerSelection {
  const _NoCustomerSelection();
}

String _mapText(Map<String, dynamic> map, String key) =>
    (map[key] ?? '').toString().trim();

class _PickTableRow extends StatelessWidget {
  const _PickTableRow({
    required this.table,
    required this.money,
    required this.free,
    required this.showAmount,
    required this.onTap,
  });

  final TableModel table;
  final String Function(num value) money;
  final bool free;
  final bool showAmount;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
        decoration: BoxDecoration(
          color: DanColors.surface2,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: DanColors.border),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Bàn ${table.code}',
                      style: const TextStyle(
                          fontWeight: FontWeight.w900, fontSize: 13)),
                  const SizedBox(height: 2),
                  Text(
                    '${table.zoneId.isEmpty ? 'Khu vực' : table.zoneId} · ${free ? 'Trống' : 'Đang có bill'}'
                    '${showAmount && (table.activeOrderTotal ?? 0) > 0 ? ' · ${money(table.activeOrderTotal!)}' : ''}',
                    style:
                        const TextStyle(color: DanColors.muted, fontSize: 12),
                  ),
                ],
              ),
            ),
            FilledButton(
              onPressed: onTap,
              style: FilledButton.styleFrom(
                minimumSize: const Size(0, 32),
                padding: const EdgeInsets.symmetric(horizontal: 12),
              ),
              child: const Text('Chọn'),
            ),
          ],
        ),
      ),
    );
  }
}

class _CustomerRow extends StatelessWidget {
  const _CustomerRow({
    required this.customer,
    required this.selected,
    required this.onTap,
  });

  final Map<String, dynamic> customer;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final name = _mapText(customer, 'name');
    final company = _mapText(customer, 'company');
    final phone = _mapText(customer, 'phone');
    final tax = _mapText(customer, 'tax_code');
    final title =
        name.isNotEmpty ? name : (company.isEmpty ? 'Khách hàng' : company);
    final sub = [
      if (phone.isNotEmpty) phone,
      if (tax.isNotEmpty) 'MST $tax',
      if (company.isNotEmpty && company != title) company,
    ].join(' · ');
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
        decoration: BoxDecoration(
          color: selected ? DanColors.brandDim : DanColors.surface,
          borderRadius: BorderRadius.circular(10),
          border:
              Border.all(color: selected ? DanColors.brand : DanColors.border),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontWeight: FontWeight.w900, fontSize: 13.5)),
                  const SizedBox(height: 3),
                  Text(sub.isEmpty ? '—' : sub,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: DanColors.muted, fontSize: 12)),
                ],
              ),
            ),
            OutlinedButton(
              onPressed: onTap,
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(0, 32),
                padding: const EdgeInsets.symmetric(horizontal: 12),
              ),
              child: const Text('Sửa'),
            ),
          ],
        ),
      ),
    );
  }
}

class _BillPane extends StatelessWidget {
  const _BillPane({
    required this.pos,
    required this.money,
    required this.isFree,
    required this.isPaying,
    required this.isCalling,
    required this.onAddFood,
    required this.onAddRetail,
    required this.onMove,
    required this.onMerge,
    required this.onSplit,
    required this.onCustomer,
    required this.onDiscount,
    required this.onPrint,
    required this.onSendKitchen,
    required this.onCancelItem,
    required this.onPayment,
    required this.openingPayment,
  });

  final PosProvider pos;
  final String Function(num value) money;
  final bool Function(TableModel table) isFree;
  final bool Function(TableModel table) isPaying;
  final bool Function(TableModel table) isCalling;
  final VoidCallback onAddFood;
  final VoidCallback onAddRetail;
  final VoidCallback onMove;
  final VoidCallback onMerge;
  final VoidCallback onSplit;
  final VoidCallback onCustomer;
  final VoidCallback onDiscount;
  final VoidCallback onPrint;
  final VoidCallback onSendKitchen;
  final ValueChanged<CartItem> onCancelItem;
  final VoidCallback onPayment;
  final bool openingPayment;

  @override
  Widget build(BuildContext context) {
    final table = pos.selectedTable;
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: DanColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: DanColors.border),
      ),
      child: table == null
          ? const _BillEmpty()
          : _buildSelectedBill(context, table),
    );
  }

  Widget _buildSelectedBill(BuildContext context, TableModel table) {
    final hasItems = pos.cart.isNotEmpty;
    final hasSavedItems = pos.cart.any((item) => item.persisted);
    final hasPending = pos.cart.any((item) => item.status == 'pending_confirm');
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: DanColors.border)),
          ),
          child: Row(
            children: [
              const Icon(Icons.chair_alt_outlined,
                  size: 17, color: DanColors.late),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Bàn ${table.code}',
                  style: const TextStyle(
                      fontSize: 16, fontWeight: FontWeight.w800),
                ),
              ),
              if (pos.activeBillNo != null) ...[
                _SmallStatus(
                    label: '#${pos.activeBillNo}', color: DanColors.muted),
                const SizedBox(width: 6),
              ],
              _SmallStatus(
                label: isCalling(table)
                    ? 'Đang gọi'
                    : isFree(table)
                        ? 'Trống'
                        : isPaying(table)
                            ? 'Chờ thu'
                            : 'Đang dùng',
                color: isCalling(table)
                    ? DanColors.late
                    : isPaying(table)
                        ? DanColors.paying
                        : isFree(table)
                            ? DanColors.muted
                            : DanColors.doing,
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final half = (constraints.maxWidth - 8) / 2;
              Widget halfButton(_BillOpButton child) =>
                  SizedBox(width: half, child: child);
              return Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  halfButton(_BillOpButton(
                    icon: Icons.add,
                    label: 'Thêm món FnB',
                    onTap: onAddFood,
                  )),
                  halfButton(_BillOpButton(
                    icon: Icons.shopping_cart_outlined,
                    label: 'Thêm retail',
                    onTap: onAddRetail,
                  )),
                  if (hasSavedItems) ...[
                    halfButton(_BillOpButton(
                      icon: Icons.subdirectory_arrow_right,
                      label: 'Chuyển bàn',
                      onTap: onMove,
                    )),
                    halfButton(_BillOpButton(
                      icon: Icons.compare_arrows,
                      label: 'Gộp bàn',
                      onTap: onMerge,
                    )),
                    SizedBox(
                      width: constraints.maxWidth,
                      child: _BillOpButton(
                        icon: Icons.content_cut,
                        label: 'Tách bill / thanh toán riêng',
                        onTap: onSplit,
                      ),
                    ),
                  ],
                ],
              );
            },
          ),
        ),
        if (isCalling(table))
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(
                color: DanColors.late.withValues(alpha: .10),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: DanColors.late.withValues(alpha: .4)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.notifications_active,
                      size: 16, color: DanColors.late),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      table.callReason.isEmpty
                          ? 'Bàn đang gọi nhân viên'
                          : 'Khách bàn ${table.code} đang gọi: ${table.callReason}',
                      style: const TextStyle(
                        color: DanColors.late,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  _ResolveCallButton(
                    onTap: () async {
                      final api = context.read<ApiService>();
                      final pos = context.read<PosProvider>();
                      final messenger = ScaffoldMessenger.of(context);
                      try {
                        await api.resolveStaffCall(table.id);
                        await pos.loadFloor();
                        messenger.showSnackBar(const SnackBar(
                          content:
                              Text('Đã xác nhận xử lý yêu cầu gọi phục vụ'),
                          backgroundColor: DanColors.done,
                        ));
                      } catch (e) {
                        messenger.showSnackBar(SnackBar(
                          content: Text(
                              e.toString().replaceFirst('Exception: ', '')),
                          backgroundColor: DanColors.late,
                        ));
                      }
                    },
                  ),
                ],
              ),
            ),
          ),
        Expanded(
          child: !hasItems
              ? const _BillEmpty(
                  title: 'Bàn chưa có order',
                  sub: 'Thêm món FnB/retail hoặc chờ khách gọi món từ tablet.',
                )
              : ListView.separated(
                  padding: const EdgeInsets.all(12),
                  itemCount: pos.cart.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 7),
                  itemBuilder: (context, index) {
                    final item = pos.cart[index];
                    return _BillItemRow(
                      item: item,
                      money: money,
                      onCancel: () => onCancelItem(item),
                    );
                  },
                ),
        ),
        if (hasItems)
          _BillFooter(
            subtotal: pos.cartSubtotal,
            discount: pos.activeDiscount,
            total: pos.cartTotal,
            saving: pos.isSavingOrder || openingPayment,
            canPay: hasItems && !openingPayment && !hasPending,
            customer: pos.selectedCustomer,
            hasPending: hasPending,
            money: money,
            onCustomer: onCustomer,
            onDiscount: onDiscount,
            onPrint: onPrint,
            onSendKitchen: onSendKitchen,
            onPayment: onPayment,
          ),
      ],
    );
  }
}

class _BillEmpty extends StatelessWidget {
  const _BillEmpty({
    this.title = 'Chọn một bàn để xem bill',
    this.sub = 'Bàn đang trống sẽ hiện thao tác thêm món sau khi chọn',
  });

  final String title;
  final String sub;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 260),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Image.asset(
              'assets/web/assets/DanOnLogo.png',
              width: 110,
              fit: BoxFit.contain,
              errorBuilder: (_, __, ___) =>
                  const SizedBox(width: 110, height: 62),
            ),
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
              decoration: BoxDecoration(
                color: DanColors.surface2,
                borderRadius: BorderRadius.circular(99),
                border: Border.all(
                    color: DanColors.border2, style: BorderStyle.solid),
              ),
              child: Text(
                title,
                style: const TextStyle(
                  color: DanColors.muted,
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18),
              child: Text(
                sub,
                textAlign: TextAlign.center,
                style: const TextStyle(color: DanColors.faint, fontSize: 12),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BillItemRow extends StatelessWidget {
  const _BillItemRow({
    required this.item,
    required this.money,
    required this.onCancel,
  });

  final CartItem item;
  final String Function(num value) money;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final meta = [
      if (item.selectedModifiers.isNotEmpty)
        item.selectedModifiers.map((m) => '+${m.name}').join(', '),
      if (item.notes.isNotEmpty) item.notes,
    ].join(' · ');
    return Container(
      padding: const EdgeInsets.fromLTRB(11, 9, 7, 9),
      decoration: BoxDecoration(
        color: DanColors.surface2,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: DanColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${item.qty}× ${item.item.name}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 13, fontWeight: FontWeight.w800),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      money(item.totalPrice),
                      style: const TextStyle(
                        color: DanColors.muted,
                        fontFamily: 'JetBrains Mono',
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 5),
                Wrap(
                  spacing: 5,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    _ItemStatusChip(status: item.status),
                    if (meta.isNotEmpty)
                      Text(meta,
                          style: const TextStyle(
                              color: DanColors.muted, fontSize: 11)),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          IconButton(
            onPressed: onCancel,
            tooltip: item.persisted ? 'Hủy món' : 'Xóa món nháp',
            icon: const Icon(Icons.close, size: 18),
            color: DanColors.faint,
            constraints: const BoxConstraints.tightFor(width: 32, height: 32),
            padding: EdgeInsets.zero,
          ),
        ],
      ),
    );
  }
}

class _ItemStatusChip extends StatelessWidget {
  const _ItemStatusChip({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final label = switch (status) {
      'pending_confirm' => 'Chờ xác nhận',
      'new' => 'Chờ bếp',
      'accepted' => 'Đã nhận',
      'preparing' => 'Đang làm',
      'ready' => 'Sẵn sàng',
      'served' => 'Đã phục vụ',
      _ => 'Mới',
    };
    final color = switch (status) {
      'pending_confirm' => DanColors.doing,
      'new' => DanColors.newState,
      'accepted' || 'preparing' => DanColors.doing,
      'ready' => DanColors.done,
      'served' => DanColors.muted,
      _ => DanColors.brand,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .13),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10.5,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _BillFooter extends StatelessWidget {
  const _BillFooter({
    required this.subtotal,
    required this.discount,
    required this.total,
    required this.saving,
    required this.canPay,
    required this.customer,
    required this.hasPending,
    required this.money,
    required this.onCustomer,
    required this.onDiscount,
    required this.onPrint,
    required this.onSendKitchen,
    required this.onPayment,
  });

  final double subtotal;
  final double discount;
  final double total;
  final bool saving;
  final bool canPay;
  final Map<String, dynamic>? customer;
  final bool hasPending;
  final String Function(num value) money;
  final VoidCallback onCustomer;
  final VoidCallback onDiscount;
  final VoidCallback onPrint;
  final VoidCallback onSendKitchen;
  final VoidCallback onPayment;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: DanColors.border)),
      ),
      child: Column(
        children: [
          _CustomerLine(customer: customer, onTap: onCustomer),
          const SizedBox(height: 8),
          _BillTotalLine(label: 'Tạm tính', value: money(subtotal)),
          if (discount > 0)
            _BillTotalLine(label: 'Giảm giá', value: '-${money(discount)}'),
          const SizedBox(height: 5),
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Tổng cộng',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
                ),
              ),
              Text(
                money(total),
                style: const TextStyle(
                  color: DanColors.brand,
                  fontFamily: 'JetBrains Mono',
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (hasPending) ...[
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: saving ? null : onSendKitchen,
                icon:
                    const Icon(Icons.local_fire_department_outlined, size: 17),
                label: const Text('Gửi món vào bếp'),
              ),
            ),
            const SizedBox(height: 8),
          ],
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: saving ? null : onDiscount,
                  child: const Text('% Giảm giá'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton(
                  onPressed: saving ? null : onPrint,
                  child: const Text('In tạm tính'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: canPay ? onPayment : null,
              child: saving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : Text('Thanh toán · ${money(total)}'),
            ),
          ),
        ],
      ),
    );
  }
}

class _CustomerLine extends StatelessWidget {
  const _CustomerLine({required this.customer, required this.onTap});

  final Map<String, dynamic>? customer;
  final VoidCallback onTap;

  String _label() {
    final c = customer;
    if (c == null) return 'Khách không xuất hóa đơn';
    final name = (c['name'] ?? '').toString().trim();
    final company = (c['company'] ?? '').toString().trim();
    return name.isNotEmpty
        ? name
        : (company.isNotEmpty ? company : 'Khách hàng');
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: DanColors.surface2,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: DanColors.border),
        ),
        child: Row(
          children: [
            const Icon(Icons.person, size: 16, color: DanColors.paying),
            const SizedBox(width: 7),
            Expanded(
              child: Text(
                _label(),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style:
                    const TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
              ),
            ),
            const SizedBox(width: 8),
            OutlinedButton(
              onPressed: onTap,
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(0, 34),
                padding: const EdgeInsets.symmetric(horizontal: 10),
              ),
              child: const Text('Chọn khách'),
            ),
          ],
        ),
      ),
    );
  }
}

class _BillTotalLine extends StatelessWidget {
  const _BillTotalLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(color: DanColors.muted, fontSize: 12),
            ),
          ),
          Text(
            value,
            style: const TextStyle(
              color: DanColors.muted,
              fontFamily: 'JetBrains Mono',
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

class _BillOpButton extends StatelessWidget {
  const _BillOpButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        height: 38,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: DanColors.surface2,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: DanColors.border2),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 16, color: DanColors.paying),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style:
                    const TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SmallStatus extends StatelessWidget {
  const _SmallStatus({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color == DanColors.muted ? DanColors.muted : color,
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, this.color, this.muted = false});

  final String label;
  final Color? color;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final activeColor = muted ? DanColors.muted : color ?? DanColors.brand;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: muted ? DanColors.surface3 : activeColor.withValues(alpha: .14),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: activeColor,
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _PickerChip extends StatelessWidget {
  const _PickerChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            color: selected ? DanColors.brand : DanColors.surface2,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: selected ? DanColors.brand : DanColors.border2,
            ),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: TextStyle(
              color: selected ? Colors.white : DanColors.text,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ),
    );
  }
}

class _MenuPickCard extends StatelessWidget {
  const _MenuPickCard({
    required this.item,
    required this.price,
    required this.onTap,
  });

  final MenuItem item;
  final String price;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: DanColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: DanColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Center(
                // Món chưa có ảnh: ô trống phẳng, không icon placeholder.
                child: item.imageUrl.isEmpty
                    ? const SizedBox.shrink()
                    : Image.network(
                        item.imageUrl,
                        fit: BoxFit.contain,
                        // Decode at thumbnail size (not full-res) so a big menu
                        // doesn't exhaust RAM/CPU on weak POS hardware.
                        cacheWidth: 240,
                        filterQuality: FilterQuality.low,
                        gaplessPlayback: true,
                        errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                      ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              item.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 3),
            Text(
              price,
              style: const TextStyle(
                color: DanColors.brand,
                fontFamily: 'JetBrains Mono',
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyBlock extends StatelessWidget {
  const _EmptyBlock({
    required this.title,
    required this.sub,
    required this.minHeight,
  });

  final String title;
  final String sub;
  final double minHeight;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(minHeight: minHeight),
      decoration: BoxDecoration(
        color: DanColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: DanColors.border),
      ),
      alignment: Alignment.center,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 5),
          Text(sub, style: const TextStyle(color: DanColors.faint)),
        ],
      ),
    );
  }
}

class _ResolveCallButton extends StatelessWidget {
  final VoidCallback onTap;
  const _ResolveCallButton({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: onTap,
      style: TextButton.styleFrom(
        visualDensity: VisualDensity.compact,
        foregroundColor: Colors.white,
        backgroundColor: DanColors.late,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
      ),
      child: const Text('Đã xử lý',
          style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
    );
  }
}

class _PendingConfirmDialog extends StatefulWidget {
  final ApiService api;
  const _PendingConfirmDialog({required this.api});

  @override
  State<_PendingConfirmDialog> createState() => _PendingConfirmDialogState();
}

class _PendingConfirmDialogState extends State<_PendingConfirmDialog> {
  List<dynamic> _orders = [];
  bool _loading = true;
  String? _error;
  String? _selectedOrderId;
  final Set<String> _selectedItemIds = {};
  final TextEditingController _reasonController = TextEditingController();
  bool _processing = false;
  final _money = NumberFormat.decimalPattern('vi_VN');

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await widget.api.getPendingConfirmations();
      if (!mounted) return;
      setState(() {
        _orders = rows;
        _loading = false;
        if (_orders.isNotEmpty) {
          _selectOrder(_orders.first['order_id']);
        } else {
          _selectedOrderId = null;
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  void _selectOrder(String orderId) {
    _selectedOrderId = orderId;
    _selectedItemIds.clear();
    _reasonController.clear();
    final active =
        _orders.firstWhere((g) => g['order_id'] == orderId, orElse: () => null);
    if (active != null && active['items'] is List) {
      for (final item in active['items']) {
        _selectedItemIds.add(item['id'].toString());
      }
    }
  }

  String _lineMeta(dynamic item) {
    final List<dynamic> modsList = item['mods'] ?? [];
    final mods = modsList.map((m) {
      final group = m['group'] != null ? '${m['group']}: ' : '';
      final price = (m['price'] != null && m['price'] > 0)
          ? ' (+${_money.format(m['price'])}đ)'
          : '';
      return '$group${m['name']}$price';
    }).join(', ');

    final List<String> bits = [];
    if (mods.isNotEmpty) bits.add('Topping: $mods');
    if (item['note'] != null && item['note'].toString().isNotEmpty) {
      bits.add('Ghi chú: ${item['note']}');
    }
    final stationName = {
          'kitchen': 'Bếp',
          'bar': 'Bar',
          'salad': 'Salad/Lạnh',
          'beverage': 'Quầy nước',
          'retail': 'Retail',
        }[item['station']] ??
        item['station'] ??
        'Không rõ';
    bits.add('Chuyển tới: $stationName');
    return bits.join(' · ');
  }

  Future<void> _handleConfirm(String orderId) async {
    final itemIds = _selectedItemIds.toList();
    if (itemIds.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Vui lòng chọn ít nhất một món để xác nhận.'),
        backgroundColor: DanColors.late,
      ));
      return;
    }
    setState(() => _processing = true);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      await widget.api.confirmPendingOrder(orderId, itemIds);
      if (!mounted) return;
      messenger.showSnackBar(const SnackBar(
        content: Text('Đã xác nhận món ăn và gửi xuống bếp/bar.'),
        backgroundColor: DanColors.done,
      ));
      await _load();
      if (_orders.isEmpty) {
        navigator.pop(true);
      }
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
        backgroundColor: DanColors.late,
      ));
    } finally {
      if (mounted) setState(() => _processing = false);
    }
  }

  Future<void> _handleReject(String orderId) async {
    final itemIds = _selectedItemIds.toList();
    if (itemIds.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Vui lòng chọn ít nhất một món để từ chối.'),
        backgroundColor: DanColors.late,
      ));
      return;
    }
    final reason = _reasonController.text.trim();
    if (reason.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Vui lòng nhập lý do từ chối để đối soát.'),
        backgroundColor: DanColors.late,
      ));
      return;
    }
    setState(() => _processing = true);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      await widget.api.rejectPendingOrder(orderId, itemIds, reason);
      if (!mounted) return;
      messenger.showSnackBar(const SnackBar(
        content: Text('Đã từ chối các món ăn đã chọn.'),
        backgroundColor: DanColors.done,
      ));
      await _load();
      if (_orders.isEmpty) {
        navigator.pop(true);
      }
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
        backgroundColor: DanColors.late,
      ));
    } finally {
      if (mounted) setState(() => _processing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    Widget content;
    if (_loading) {
      content = const SizedBox(
        height: 300,
        child: Center(child: CircularProgressIndicator()),
      );
    } else if (_error != null) {
      content = SizedBox(
        height: 300,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Lỗi: $_error',
                  style: const TextStyle(color: DanColors.late)),
              const SizedBox(height: 12),
              FilledButton(onPressed: _load, child: const Text('Thử lại')),
            ],
          ),
        ),
      );
    } else if (_orders.isEmpty) {
      content = const SizedBox(
        height: 300,
        child: Center(
          child: Text(
            'Không có món nào chờ xác nhận.',
            style: TextStyle(
                color: DanColors.faint,
                fontSize: 16,
                fontWeight: FontWeight.bold),
          ),
        ),
      );
    } else {
      final active = _orders.firstWhere(
          (g) => g['order_id'] == _selectedOrderId,
          orElse: () => _orders.first);
      final List<dynamic> items = active['items'] ?? [];
      final activeTableCode =
          active['table_code'] != null && active['table_code'] != '—'
              ? 'Bàn ${active['table_code']}'
              : 'Đơn khách';

      content = SizedBox(
        height: 440,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Left list of tables
            Container(
              width: 260,
              decoration: const BoxDecoration(
                border: Border(right: BorderSide(color: DanColors.border)),
              ),
              child: ListView.separated(
                padding: const EdgeInsets.only(right: 8),
                itemCount: _orders.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (context, idx) {
                  final g = _orders[idx];
                  final orderId = g['order_id'].toString();
                  final isSelected = orderId == _selectedOrderId;
                  final tableCode =
                      g['table_code'] != null && g['table_code'] != '—'
                          ? 'Bàn ${g['table_code']}'
                          : 'Đơn khách';

                  return InkWell(
                    onTap: () => setState(() => _selectOrder(orderId)),
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: isSelected
                            ? DanColors.brand.withValues(alpha: .08)
                            : DanColors.surface2,
                        border: Border.all(
                            color: isSelected
                                ? DanColors.brand
                                : DanColors.border),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text(tableCode,
                                  style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 13.5)),
                              const Spacer(),
                              Text('${_money.format(g['total'])}đ',
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w800,
                                      color: DanColors.brand,
                                      fontSize: 12.5)),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                              '${g['line_count']} dòng · ${g['item_count']} món cần duyệt',
                              style: const TextStyle(
                                  color: DanColors.muted, fontSize: 11)),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
            // Right detail pane
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(left: 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Text(activeTableCode,
                            style: const TextStyle(
                                fontWeight: FontWeight.bold, fontSize: 16)),
                        const Spacer(),
                        Text('${_money.format(active['total'])}đ',
                            style: const TextStyle(
                                fontWeight: FontWeight.bold,
                                color: DanColors.brand,
                                fontSize: 16)),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                        '${active['line_count']} dòng · ${active['item_count']} món · Kiểm tra trước khi duyệt',
                        style: const TextStyle(
                            color: DanColors.muted, fontSize: 12)),
                    const SizedBox(height: 12),
                    Expanded(
                      child: Container(
                        decoration: BoxDecoration(
                          color: DanColors.surface2,
                          border: Border.all(color: DanColors.border),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: ListView.separated(
                          padding: const EdgeInsets.all(8),
                          itemCount: items.length,
                          separatorBuilder: (_, __) =>
                              const Divider(height: 1, color: DanColors.border),
                          itemBuilder: (context, idx) {
                            final item = items[idx];
                            final itemId = item['id'].toString();
                            final checked = _selectedItemIds.contains(itemId);
                            return CheckboxListTile(
                              value: checked,
                              onChanged: (val) {
                                setState(() {
                                  if (val == true) {
                                    _selectedItemIds.add(itemId);
                                  } else {
                                    _selectedItemIds.remove(itemId);
                                  }
                                });
                              },
                              dense: true,
                              contentPadding: EdgeInsets.zero,
                              controlAffinity: ListTileControlAffinity.leading,
                              title: Row(
                                children: [
                                  Text('${item['qty']}× ',
                                      style: const TextStyle(
                                          fontWeight: FontWeight.w800,
                                          color: DanColors.brand)),
                                  Expanded(
                                      child: Text(item['name'],
                                          style: const TextStyle(
                                              fontWeight: FontWeight.bold))),
                                  Text(
                                      '${_money.format(item['qty'] * item['unit_price'])}đ',
                                      style: const TextStyle(
                                          fontSize: 12,
                                          color: DanColors.muted)),
                                ],
                              ),
                              subtitle: Padding(
                                padding: const EdgeInsets.only(top: 2),
                                child: Text(_lineMeta(item),
                                    style: const TextStyle(
                                        color: DanColors.muted, fontSize: 11)),
                              ),
                            );
                          },
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _reasonController,
                      decoration: const InputDecoration(
                        isDense: true,
                        labelText: 'Lý do từ chối',
                        hintText: 'Nhập lý do nếu từ chối (ví dụ: hết món...)',
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        OutlinedButton(
                          onPressed: _processing
                              ? null
                              : () => _handleReject(active['order_id']),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: DanColors.late,
                            side: const BorderSide(color: DanColors.late),
                          ),
                          child: _processing
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child:
                                      CircularProgressIndicator(strokeWidth: 2))
                              : const Text('Từ chối (Reject)'),
                        ),
                        const SizedBox(width: 12),
                        FilledButton(
                          onPressed: _processing
                              ? null
                              : () => _handleConfirm(active['order_id']),
                          style: FilledButton.styleFrom(
                              backgroundColor: DanColors.done),
                          child: _processing
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white))
                              : const Text('Xác nhận (Accept)'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      );
    }

    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Container(
        width: 850,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: DanColors.bg,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Row(
              children: [
                Icon(Icons.notifications_active_outlined,
                    size: 22, color: DanColors.late),
                SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Món khách vừa gọi',
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.bold),
                      ),
                      SizedBox(height: 2),
                      Text(
                        'Nhân viên cần đọc lại với khách, kiểm tra topping/ghi chú trước khi duyệt chuyển xuống bếp.',
                        style:
                            TextStyle(color: DanColors.muted, fontSize: 12.5),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            content,
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  child: const Text('Đóng'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _MenuPickerDialog extends StatefulWidget {
  final String title;
  final PosProvider pos;
  final ApiService api;
  final Future<bool> Function(MenuItem) onAdd;
  final bool isRetail;

  const _MenuPickerDialog({
    required this.title,
    required this.pos,
    required this.api,
    required this.onAdd,
    this.isRetail = false,
  });

  @override
  State<_MenuPickerDialog> createState() => _MenuPickerDialogState();
}

class _MenuPickerDialogState extends State<_MenuPickerDialog> {
  final _searchCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  final _debouncer = Debouncer(delay: const Duration(milliseconds: 300));

  String _search = '';
  String? _selectedCategoryId;
  List<MenuItem> _loadedItems = [];
  int _currentPage = 1;
  bool _hasMore = true;
  bool _loadingPage = false;

  @override
  void initState() {
    super.initState();
    _scrollCtrl.addListener(_onScroll);
    _loadNextPage(isRefresh: true);
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    _scrollCtrl.removeListener(_onScroll);
    _scrollCtrl.dispose();
    _debouncer.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollCtrl.position.pixels >= _scrollCtrl.position.maxScrollExtent - 200) {
      _loadNextPage();
    }
  }

  Future<void> _loadNextPage({bool isRefresh = false}) async {
    if (_loadingPage) return;
    if (!isRefresh && !_hasMore) return;

    setState(() {
      _loadingPage = true;
      if (isRefresh) {
        _currentPage = 1;
        _loadedItems = [];
        _hasMore = true;
      }
    });

    try {
      final List<MenuItem> items;
      final int total;

      if (widget.isRetail) {
        final result = await widget.api.getSkusPaginated(
          page: _currentPage,
          limit: 40,
          q: _search,
        );
        final itemsData = result['items'] as List? ?? [];
        total = result['total'] as int? ?? 0;
        items = itemsData.map((e) {
          final m = Map<String, dynamic>.from(e);
          return MenuItem(
            id: m['id']?.toString() ?? '',
            code: m['barcode']?.toString() ?? '',
            name: m['name']?.toString() ?? '',
            price: (m['price'] as num?)?.toDouble() ?? 0.0,
            categoryId: m['category']?.toString() ?? '',
            imageUrl: m['image']?.toString() ?? '',
            modifiers: [],
            isRetail: true,
          );
        }).toList();
      } else {
        final result = await widget.api.getMenuPaginated(
          page: _currentPage,
          limit: 40,
          q: _search,
          categoryId: _selectedCategoryId ?? '',
        );
        final itemsData = result['items'] as List? ?? [];
        total = result['total'] as int? ?? 0;
        items = itemsData
            .map((e) => MenuItem.fromJson(Map<String, dynamic>.from(e)))
            .toList();
      }

      if (!mounted) return;
      setState(() {
        _loadedItems.addAll(items);
        _hasMore = _loadedItems.length < total;
        if (items.isNotEmpty) {
          _currentPage++;
        }
        _loadingPage = false;
      });
    } catch (e) {
      debugPrint("Error loading paginated menu: $e");
      if (mounted) {
        setState(() {
          _loadingPage = false;
        });
      }
    }
  }

  String _vnd(num value) {
    final money = NumberFormat.decimalPattern('vi_VN');
    return '${money.format(value)}đ';
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: DanColors.surface,
      insetPadding: const EdgeInsets.all(24),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: DanColors.border),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 980, maxHeight: 720),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 16, 14, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      widget.title,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close),
                    color: DanColors.muted,
                    tooltip: 'Đóng',
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18),
              child: TextField(
                controller: _searchCtrl,
                autofocus: true,
                decoration: const InputDecoration(
                  hintText: 'Tìm món, mã món...',
                  prefixIcon: Icon(Icons.search),
                ),
                onChanged: (value) {
                  _search = value;
                  _debouncer(() {
                    _loadNextPage(isRefresh: true);
                  });
                },
              ),
            ),
            if (!widget.isRetail)
              SizedBox(
                height: 58,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.fromLTRB(18, 12, 18, 8),
                  children: [
                    _PickerChip(
                      label: 'Tất cả',
                      selected: _selectedCategoryId == null,
                      onTap: () {
                        setState(() {
                          _selectedCategoryId = null;
                        });
                        _loadNextPage(isRefresh: true);
                      },
                    ),
                    ...widget.pos.categories.map(
                      (category) => _PickerChip(
                        label: category.name,
                        selected: _selectedCategoryId == category.id,
                        onTap: () {
                          setState(() {
                            _selectedCategoryId = category.id;
                          });
                          _loadNextPage(isRefresh: true);
                        },
                      ),
                    ),
                  ],
                ),
              ),
            Expanded(
              child: _loadedItems.isEmpty && !_loadingPage
                  ? const Center(
                      child: Text(
                        'Không tìm thấy món',
                        style: TextStyle(color: DanColors.faint),
                      ),
                    )
                  : GridView.builder(
                      controller: _scrollCtrl,
                      padding: const EdgeInsets.fromLTRB(18, 8, 18, 18),
                      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                        maxCrossAxisExtent: 220,
                        mainAxisExtent: 128,
                        crossAxisSpacing: 10,
                        mainAxisSpacing: 10,
                      ),
                      itemCount: _loadedItems.length + (_loadingPage ? 1 : 0),
                      itemBuilder: (context, index) {
                        if (index >= _loadedItems.length) {
                          return const Center(
                            child: CircularProgressIndicator(),
                          );
                        }
                        final item = _loadedItems[index];
                        return _MenuPickCard(
                          item: item,
                          price: _vnd(item.price),
                          onTap: () async {
                            final added = await widget.onAdd(item);
                            if (added && context.mounted) {
                              Navigator.of(context).pop();
                            }
                          },
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
