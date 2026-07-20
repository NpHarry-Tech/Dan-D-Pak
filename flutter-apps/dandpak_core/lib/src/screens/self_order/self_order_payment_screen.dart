import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import 'self_order_models.dart';
import 'self_order_staff_exit.dart';
import 'self_order_strings.dart';
import '../../utils/translation.dart';

enum _PayStep { pick, staffWait, qr, invoiceAsk, invoiceForm, thanks }

/// Màn THANH TOÁN của khách sau bữa ăn.
/// - Tiền mặt / Quẹt thẻ → gọi nhân viên tới bàn (bill do POS xử lý), chờ đến
///   khi bill được đóng thì hiện màn cảm ơn.
/// - Chuyển khoản → hiện QR đúng theo hóa đơn; server tự khớp khi tiền về
///   (webhook), tự in hóa đơn + báo máy POS; app thấy bill 'paid' thì hỏi
///   xuất hóa đơn công ty (nhập MST có nút truy xuất) rồi cảm ơn.
class SelfOrderPaymentScreen extends StatefulWidget {
  final String serverUrl;
  final String? branchId;
  final String? staffToken;
  final SoTableModel table;
  final SelfOrderLang lang;
  final String orderId;
  final String customerPhone;

  SelfOrderPaymentScreen({
    super.key,
    required this.serverUrl,
    this.branchId,
    this.staffToken,
    required this.table,
    required this.lang,
    required this.orderId,
    this.customerPhone = '',
  });

  @override
  State<SelfOrderPaymentScreen> createState() => _SelfOrderPaymentScreenState();
}

class _SelfOrderPaymentScreenState extends State<SelfOrderPaymentScreen> {
  late final ApiService _api;
  _PayStep _step = _PayStep.pick;
  int _total = 0;
  String? _error;
  bool _busy = false;
  bool _paidByQr = false;

  // QR
  Map<String, dynamic>? _qr;
  Timer? _poll;

  // Hóa đơn điện tử
  final _mstCtrl = TextEditingController();
  final _companyCtrl = TextEditingController();
  final _addressCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  bool _lookedUp = false;

  SelfOrderLang get L => widget.lang;

  @override
  void initState() {
    super.initState();
    _api = ApiService(
      baseUrl: widget.serverUrl,
      token: widget.staffToken,
      branchId: widget.branchId,
    );
    _phoneCtrl.text = widget.customerPhone;
    _loadTotal();
  }

  @override
  void dispose() {
    _poll?.cancel();
    _mstCtrl.dispose();
    _companyCtrl.dispose();
    _addressCtrl.dispose();
    _emailCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadTotal() async {
    try {
      final o = await _api.getOrderById(widget.orderId);
      if (!mounted) return;
      setState(() {
        _total = (o['total'] is num) ? (o['total'] as num).toInt() : 0;
        if ((o['status'] ?? '') == 'paid') _step = _PayStep.thanks;
      });
      if (_step == _PayStep.thanks) _scheduleReturn();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    }
  }

  // ── Poll trạng thái bill (dùng cho cả QR lẫn chờ nhân viên) ────────────────
  void _startPolling({required bool viaQr}) {
    _poll?.cancel();
    _poll = Timer.periodic(Duration(seconds: 3), (_) async {
      try {
        final o = await _api.getOrderById(widget.orderId);
        if (!mounted) return;
        if ((o['status'] ?? '') == 'paid') {
          _poll?.cancel();
          setState(() {
            _paidByQr = viaQr;
            // QR: hỏi xuất hóa đơn; tiền mặt/thẻ: nhân viên lo — cảm ơn luôn.
            _step = viaQr ? _PayStep.invoiceAsk : _PayStep.thanks;
          });
          if (_step == _PayStep.thanks) _scheduleReturn();
        }
      } catch (_) {/* mạng chớp — thử lại vòng sau */}
    });
  }

  // ── Tiền mặt / thẻ: gọi nhân viên ─────────────────────────────────────────
  Future<void> _payViaStaff(String methodLabelVi) async {
    setState(() => _busy = true);
    try {
      await _api.callStaff(widget.table.id,
          t('Thanh toán $methodLabelVi — ${widget.table.name}'));
      if (!mounted) return;
      setState(() {
        _step = _PayStep.staffWait;
        _busy = false;
      });
      _startPolling(viaQr: false);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _busy = false;
      });
    }
  }

  // ── Chuyển khoản: sinh QR theo bill ───────────────────────────────────────
  Future<void> _payViaQr() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final qr = await _api.paymentQr(widget.orderId);
      if (!mounted) return;
      setState(() {
        _qr = qr;
        _step = _PayStep.qr;
        _busy = false;
      });
      _startPolling(viaQr: true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _busy = false;
      });
    }
  }

  // ── Hóa đơn điện tử ───────────────────────────────────────────────────────
  Future<void> _lookupMst() async {
    final mst = _mstCtrl.text.trim();
    if (mst.isEmpty) return;
    setState(() => _busy = true);
    try {
      final r = await _api.taxLookup(mst);
      if (!mounted) return;
      setState(() {
        _companyCtrl.text = (r['name'] ?? r['company'] ?? '').toString();
        _addressCtrl.text = (r['address'] ?? '').toString();
        _lookedUp = _companyCtrl.text.isNotEmpty;
        _busy = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _submitInvoice() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _api.customerInvoice(widget.orderId, issue: true, customer: {
        'tax_code': _mstCtrl.text.trim(),
        'name': _companyCtrl.text.trim(),
        'company': _companyCtrl.text.trim(),
        'address': _addressCtrl.text.trim(),
        'email': _emailCtrl.text.trim(),
        'phone': _phoneCtrl.text.trim(),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(L.invoiceDone), backgroundColor: Color(0xFF49D17F)));
      setState(() {
        _step = _PayStep.thanks;
        _busy = false;
      });
      _scheduleReturn();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _busy = false;
      });
    }
  }

  Future<void> _declineInvoice() async {
    try {
      await _api.customerInvoice(widget.orderId, issue: false);
    } catch (_) {}
    if (!mounted) return;
    setState(() => _step = _PayStep.thanks);
    _scheduleReturn();
  }

  void _scheduleReturn() {
    Timer(Duration(seconds: 8), () {
      if (!mounted) return;
      Navigator.of(context)
          .popUntil((r) => r.settings.name == '/so-table' || r.isFirst);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Color(0xFFF7F8FA),
      appBar: _step == _PayStep.thanks
          ? null
          : AppBar(
              automaticallyImplyLeading: false,
              backgroundColor: Colors.white,
              elevation: 0,
              title: Row(children: [
                SelfOrderStaffLogo(api: _api),
                SizedBox(width: 10),
                Text(L.payTitle,
                    style: TextStyle(
                        fontWeight: FontWeight.bold, color: Color(0xFF1A2230))),
              ]),
              actions: [
                if (_step == _PayStep.pick)
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: Text(L.backBtn,
                        style: TextStyle(color: Color(0xFF677084))),
                  ),
                SizedBox(width: 8),
              ],
            ),
      body: SafeArea(child: _body()),
    );
  }

  Widget _body() {
    switch (_step) {
      case _PayStep.pick:
        return _pickView();
      case _PayStep.staffWait:
        return _centerMessage(
            icon: Icons.support_agent_rounded,
            color: Color(0xFF0891B2),
            title: L.staffComing,
            spinner: true);
      case _PayStep.qr:
        return _qrView();
      case _PayStep.invoiceAsk:
        return _invoiceAskView();
      case _PayStep.invoiceForm:
        return _invoiceFormView();
      case _PayStep.thanks:
        return _thanksView();
    }
  }

  // ── Chọn phương thức ──────────────────────────────────────────────────────
  Widget _pickView() {
    return Center(
      child: SingleChildScrollView(
        padding: EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: 680),
          child: Column(
            children: [
              Text(L.totalDue,
                  style: TextStyle(fontSize: 15, color: Color(0xFF677084))),
              SizedBox(height: 4),
              Text(t('đ$_total'),
                  style: TextStyle(
                      fontSize: 40,
                      fontWeight: FontWeight.w900,
                      color: Color(0xFF0891B2))),
              if (_error != null) ...[
                SizedBox(height: 10),
                Text(_error!, style: TextStyle(color: Color(0xFFFF7A7A))),
              ],
              SizedBox(height: 28),
              Row(
                children: [
                  _methodCard(
                      icon: Icons.payments_rounded,
                      color: Color(0xFF16A34A),
                      label: L.payCash,
                      onTap: _busy ? null : () => _payViaStaff(t('tiền mặt'))),
                  SizedBox(width: 14),
                  _methodCard(
                      icon: Icons.qr_code_2_rounded,
                      color: Color(0xFF0891B2),
                      label: L.payTransfer,
                      onTap: _busy ? null : _payViaQr),
                  SizedBox(width: 14),
                  _methodCard(
                      icon: Icons.credit_card_rounded,
                      color: Color(0xFF8B5CF6),
                      label: L.payCard,
                      onTap: _busy ? null : () => _payViaStaff(t('quẹt thẻ'))),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _methodCard(
      {required IconData icon,
      required Color color,
      required String label,
      VoidCallback? onTap}) {
    return Expanded(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Container(
          padding: EdgeInsets.symmetric(vertical: 34),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: color.withValues(alpha: 0.4), width: 1.5),
          ),
          child: Column(
            children: [
              Icon(icon, size: 52, color: color),
              SizedBox(height: 12),
              Text(label,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      fontSize: 16, fontWeight: FontWeight.w800, color: color)),
            ],
          ),
        ),
      ),
    );
  }

  // ── QR chuyển khoản ───────────────────────────────────────────────────────
  Widget _qrView() {
    final qr = _qr ?? {};
    final img = (qr['imageUrl'] ?? '').toString();
    return Center(
      child: SingleChildScrollView(
        padding: EdgeInsets.all(24),
        child: Column(
          children: [
            Text(L.qrTitle,
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
            SizedBox(height: 6),
            Text(t('đ$_total'),
                style: TextStyle(
                    fontSize: 30,
                    fontWeight: FontWeight.w900,
                    color: Color(0xFF0891B2))),
            SizedBox(height: 16),
            Container(
              padding: EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: Color(0xFFE7EAEE)),
              ),
              child: img.isEmpty
                  ? SizedBox(
                      width: 280,
                      height: 280,
                      child: Center(child: CircularProgressIndicator()))
                  : Image.network(img,
                      width: 300,
                      height: 300,
                      fit: BoxFit.contain,
                      errorBuilder: (_, __, ___) => SizedBox(
                          width: 280,
                          height: 280,
                          child:
                              Center(child: Icon(Icons.qr_code_2, size: 120)))),
            ),
            SizedBox(height: 12),
            Text(
              '${qr['bankName'] ?? ''} · ${qr['bankAccountMasked'] ?? ''}\n${qr['userBankName'] ?? ''}',
              textAlign: TextAlign.center,
              style: TextStyle(color: Color(0xFF677084), fontSize: 13),
            ),
            SizedBox(height: 16),
            Row(mainAxisSize: MainAxisSize.min, children: [
              SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2)),
              SizedBox(width: 10),
              Text(L.qrWaiting,
                  style: TextStyle(
                      color: Color(0xFF677084), fontWeight: FontWeight.w600)),
            ]),
            SizedBox(height: 16),
            TextButton(
              onPressed: () {
                _poll?.cancel();
                setState(() => _step = _PayStep.pick);
              },
              child:
                  Text(L.backBtn, style: TextStyle(color: Color(0xFF677084))),
            ),
          ],
        ),
      ),
    );
  }

  // ── Hỏi xuất hóa đơn ──────────────────────────────────────────────────────
  Widget _invoiceAskView() {
    return Center(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 560),
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.check_circle_rounded,
                  color: Color(0xFF49D17F), size: 76),
              SizedBox(height: 12),
              Text(L.paidOk,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
              SizedBox(height: 30),
              Text(L.askInvoiceTitle,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
              SizedBox(height: 6),
              Text(L.askInvoiceSub,
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Color(0xFF677084), fontSize: 14)),
              SizedBox(height: 22),
              Row(children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _declineInvoice,
                    style: OutlinedButton.styleFrom(
                        padding: EdgeInsets.symmetric(vertical: 16)),
                    child: Text(L.invoiceNo),
                  ),
                ),
                SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    onPressed: () =>
                        setState(() => _step = _PayStep.invoiceForm),
                    style: FilledButton.styleFrom(
                        backgroundColor: Color(0xFF0891B2),
                        padding: EdgeInsets.symmetric(vertical: 16)),
                    child: Text(L.invoiceYes),
                  ),
                ),
              ]),
            ],
          ),
        ),
      ),
    );
  }

  // ── Form MST ─────────────────────────────────────────────────────────────
  Widget _invoiceFormView() {
    final canSubmit = _mstCtrl.text.trim().length >= 10 &&
        _companyCtrl.text.trim().isNotEmpty &&
        _emailCtrl.text.trim().contains('@') &&
        _phoneCtrl.text.trim().length >= 8;
    return Center(
      child: SingleChildScrollView(
        padding: EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: 560),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(L.askInvoiceTitle,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
              SizedBox(height: 20),
              // MST + Truy xuất
              Row(children: [
                Expanded(
                  child: TextField(
                    controller: _mstCtrl,
                    keyboardType: TextInputType.number,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(13),
                    ],
                    decoration: InputDecoration(
                      labelText: L.taxCodeLabel,
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                    onChanged: (_) => setState(() {
                      _lookedUp = false;
                      _companyCtrl.clear();
                      _addressCtrl.clear();
                    }),
                  ),
                ),
                SizedBox(width: 10),
                FilledButton.icon(
                  onPressed: _busy ? null : _lookupMst,
                  style: FilledButton.styleFrom(
                      backgroundColor: Color(0xFF0891B2),
                      padding:
                          EdgeInsets.symmetric(horizontal: 18, vertical: 16)),
                  icon: _busy
                      ? SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : Icon(Icons.search, size: 18),
                  label: Text(L.lookupBtn),
                ),
              ]),
              SizedBox(height: 14),
              TextField(
                controller: _companyCtrl,
                readOnly: _lookedUp,
                decoration: InputDecoration(
                  labelText: L.companyLabel,
                  border: OutlineInputBorder(),
                  isDense: true,
                  suffixIcon:
                      _lookedUp ? Icon(Icons.lock_outline, size: 16) : null,
                ),
                onChanged: (_) => setState(() {}),
              ),
              SizedBox(height: 14),
              TextField(
                controller: _addressCtrl,
                readOnly: _lookedUp,
                decoration: InputDecoration(
                  labelText: L.addressLabel,
                  border: OutlineInputBorder(),
                  isDense: true,
                  suffixIcon:
                      _lookedUp ? Icon(Icons.lock_outline, size: 16) : null,
                ),
              ),
              SizedBox(height: 14),
              TextField(
                controller: _emailCtrl,
                keyboardType: TextInputType.emailAddress,
                decoration: InputDecoration(
                  labelText: L.emailLabel,
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
                onChanged: (_) => setState(() {}),
              ),
              SizedBox(height: 14),
              TextField(
                controller: _phoneCtrl,
                keyboardType: TextInputType.phone,
                decoration: InputDecoration(
                  labelText: L.contactPhoneLabel,
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
                onChanged: (_) => setState(() {}),
              ),
              if (_error != null) ...[
                SizedBox(height: 10),
                Text(_error!, style: TextStyle(color: Color(0xFFFF7A7A))),
              ],
              SizedBox(height: 20),
              Row(children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _busy ? null : _declineInvoice,
                    style: OutlinedButton.styleFrom(
                        padding: EdgeInsets.symmetric(vertical: 16)),
                    child: Text(L.invoiceNo),
                  ),
                ),
                SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: FilledButton(
                    onPressed: (_busy || !canSubmit) ? null : _submitInvoice,
                    style: FilledButton.styleFrom(
                        backgroundColor: Color(0xFF0891B2),
                        padding: EdgeInsets.symmetric(vertical: 16)),
                    child: _busy
                        ? SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white))
                        : Text(L.submitInvoiceBtn,
                            style: TextStyle(fontWeight: FontWeight.bold)),
                  ),
                ),
              ]),
            ],
          ),
        ),
      ),
    );
  }

  // ── Cảm ơn ────────────────────────────────────────────────────────────────
  Widget _thanksView() {
    return Container(
      color: DanColors.bg,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: EdgeInsets.all(22),
              decoration: BoxDecoration(
                color: DanColors.brand.withValues(alpha: 0.10),
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.favorite_rounded,
                  color: DanColors.brand, size: 64),
            ),
            SizedBox(height: 22),
            Text(L.thanksTitle,
                textAlign: TextAlign.center,
                style: TextStyle(
                    color: DanColors.text,
                    fontSize: 34,
                    fontWeight: FontWeight.w900)),
            SizedBox(height: 8),
            Text(L.thanksSub,
                textAlign: TextAlign.center,
                style: TextStyle(color: DanColors.muted, fontSize: 16)),
            if (_paidByQr) ...[
              SizedBox(height: 12),
              Text(L.paidOk,
                  style: TextStyle(color: DanColors.faint, fontSize: 13)),
            ],
          ],
        ),
      ),
    );
  }

  Widget _centerMessage(
      {required IconData icon,
      required Color color,
      required String title,
      bool spinner = false}) {
    return Center(
      child: Padding(
        padding: EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 76, color: color),
            SizedBox(height: 18),
            Text(title,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            if (spinner) ...[
              SizedBox(height: 20),
              SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2)),
            ],
            SizedBox(height: 20),
            TextButton(
              onPressed: () {
                _poll?.cancel();
                setState(() => _step = _PayStep.pick);
              },
              child:
                  Text(L.backBtn, style: TextStyle(color: Color(0xFF677084))),
            ),
          ],
        ),
      ),
    );
  }
}
