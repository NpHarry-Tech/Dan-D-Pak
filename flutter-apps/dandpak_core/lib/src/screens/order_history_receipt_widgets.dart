// GENERATED SPLIT of order_history_dialog.dart — tờ bill + bảng món + meta/badge (part of, cùng library).
part of 'order_history_dialog.dart';

/// Tờ bill t("giấy"): hiển thị NGUYÊN VĂN nội dung server render theo mẫu in đã
/// cấu hình (monospace = khớp từng cột với tờ in nhiệt).
class _ReceiptPaper extends StatelessWidget {
  final String text;
  _ReceiptPaper({required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 16, vertical: 18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(DanRadius.md),
        border: Border.all(color: DanColors.border2),
        boxShadow: [
          BoxShadow(
            color: Color(0x12102840),
            blurRadius: 20,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: SelectableText(
          text,
          style: TextStyle(
            fontFamily: 'JetBrains Mono',
            fontSize: 12,
            height: 1.45,
            color: DanColors.text,
          ),
        ),
      ),
    );
  }
}

class _ReceiptCard extends StatelessWidget {
  final Map<String, dynamic> receipt;

  _ReceiptCard({required this.receipt});

  @override
  Widget build(BuildContext context) {
    final company = _map(receipt['company']);
    final customer = _map(receipt['customer']);
    final invoice = _map(receipt['invoice']);
    final items = _list(receipt['items']);
    final lines = _list(receipt['lines']);
    return Center(
      child: Container(
        constraints: BoxConstraints(maxWidth: 620),
        padding: EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(DanRadius.md),
          border: Border.all(color: DanColors.border2),
          boxShadow: [
            BoxShadow(
              color: Color(0x12102840),
              blurRadius: 20,
              offset: Offset(0, 8),
            ),
          ],
        ),
        child: DefaultTextStyle(
          style: TextStyle(color: DanColors.text, fontSize: 12.5),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Column(
                  children: [
                    Text(
                      _s(company['name']).isEmpty
                          ? 'DAN D PAK'
                          : _s(company['name']),
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    if (_s(company['address']).isNotEmpty)
                      Text(
                        _s(company['address']),
                        textAlign: TextAlign.center,
                        style: TextStyle(color: DanColors.muted, fontSize: 11),
                      ),
                    Text(
                      [
                        if (_s(company['tax_code']).isNotEmpty)
                          'MST: ${_s(company['tax_code'])}',
                        if (_s(company['phone']).isNotEmpty)
                          'ĐT: ${_s(company['phone'])}',
                      ].join(' · '),
                      textAlign: TextAlign.center,
                      style: TextStyle(color: DanColors.muted, fontSize: 11),
                    ),
                  ],
                ),
              ),
              Divider(height: 24, color: DanColors.border2),
              Text(
                t('HÓA ĐƠN BÁN HÀNG'),
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
              ),
              SizedBox(height: 2),
              Text(
                t('(Khởi tạo từ máy tính tiền)'),
                textAlign: TextAlign.center,
                style: TextStyle(color: DanColors.muted, fontSize: 11),
              ),
              SizedBox(height: 14),
              Wrap(
                spacing: 10,
                runSpacing: 8,
                children: [
                  _Meta(
                    label: t('Số Bill nội bộ'),
                    value: _s(receipt['bill_no'] ?? receipt['number']),
                  ),
                  _Meta(
                    label: 'Transaction ID',
                    value: _s(receipt['id']),
                  ),
                  if (invoice.isNotEmpty &&
                      _s(invoice['invoice_no']).isNotEmpty)
                    _Meta(
                        label: t('Số HĐĐT'), value: _s(invoice['invoice_no'])),
                  if (invoice.isNotEmpty &&
                      _s(invoice['invoice_series']).isNotEmpty)
                    _Meta(
                        label: t('Ký hiệu HĐ'),
                        value: _s(invoice['invoice_series'])),
                  _Meta(
                    label: t('Ngày lập'),
                    value: _date(receipt['paid_at'] ?? receipt['created_at']),
                  ),
                  _Meta(
                    label: t('Thu ngân'),
                    value: _s(receipt['cashier']).isEmpty
                        ? '-'
                        : _s(receipt['cashier']),
                  ),
                  _Meta(label: t('Quầy / Bàn'), value: _placeLabel(receipt)),
                  if (_s(customer['name']).isNotEmpty)
                    _Meta(label: t('Khách hàng'), value: _s(customer['name'])),
                  if (_s(customer['tax_code']).isNotEmpty)
                    _Meta(
                        label: t('MST khách'), value: _s(customer['tax_code'])),
                ],
              ),
              SizedBox(height: 16),
              _ItemsTable(items: items),
              Divider(height: 22, color: DanColors.border2),
              _sumLine(t('Cộng tiền hàng'),
                  receipt['goods_amount'] ?? receipt['subtotal']),
              if (_n(receipt['discount']) > 0)
                _sumLine(t('Giảm giá'), -_n(receipt['discount'])),
              _sumLine('Thuế GTGT (${_n(receipt['vat_rate']).round()}%)',
                  receipt['vat_amount']),
              _sumLine(t('TỔNG THANH TOÁN'), receipt['total'], grand: true),
              if (_s(receipt['total_words']).isNotEmpty) ...[
                SizedBox(height: 8),
                Text(
                  'Bằng chữ: ${_s(receipt['total_words'])}',
                  style: TextStyle(
                    color: DanColors.muted,
                    fontSize: 11.5,
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ],
              SizedBox(height: 12),
              _sumLine(t('Hình thức TT'), _paymentMethods(lines), money: false),
              _sumLine(t('Trạng thái'), _statusLabel(_s(receipt['status'])),
                  money: false),
              if (_n(receipt['change']) > 0)
                _sumLine(t('Tiền thối'), receipt['change']),
              if (invoice.isNotEmpty) ...[
                Divider(height: 22, color: DanColors.border2),
                Text(
                  'MÃ CỦA CƠ QUAN THUẾ:\n${_s(invoice['lookup_code'])}',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: 'JetBrains Mono',
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
              Divider(height: 22, color: DanColors.border2),
              Text(
                t('HÓA ĐƠN ĐIỆN TỬ KHỞI TẠO TỪ MÁY TÍNH TIỀN\nCẢM ƠN QUÝ KHÁCH - HẸN GẶP LẠI!'),
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _sumLine(
    String label,
    dynamic value, {
    bool grand = false,
    bool money = true,
  }) {
    final text = money
        ? Fmt.money(value is num ? value : _n(value))
        : (value is String ? value : _s(value));
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontWeight: grand ? FontWeight.w900 : FontWeight.w600,
              ),
            ),
          ),
          SizedBox(width: 12),
          Text(
            text,
            textAlign: TextAlign.right,
            style: TextStyle(
              fontSize: grand ? 16 : 12.5,
              fontWeight: FontWeight.w900,
              color: grand ? DanColors.brand : DanColors.text,
            ),
          ),
        ],
      ),
    );
  }
}

class _ItemsTable extends StatelessWidget {
  final List<Map<String, dynamic>> items;

  _ItemsTable({required this.items});

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return Padding(
        padding: EdgeInsets.symmetric(vertical: 18),
        child: Center(
          child:
              Text(t('Không có món'), style: TextStyle(color: DanColors.faint)),
        ),
      );
    }
    return Column(
      children: [
        Container(
          padding: EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(color: DanColors.border2),
              top: BorderSide(color: DanColors.border2),
            ),
          ),
          child: Row(
            children: [
              SizedBox(width: 34, child: Text('STT')),
              Expanded(child: Text(t('Mặt hàng'))),
              SizedBox(
                  width: 96,
                  child: Text(t('Thành tiền'), textAlign: TextAlign.right)),
            ],
          ),
        ),
        for (var i = 0; i < items.length; i++)
          Container(
            padding: EdgeInsets.symmetric(vertical: 8),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: DanColors.border)),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 34,
                  child: Text((i + 1).toString().padLeft(2, '0')),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _s(items[i]['name']),
                        style: TextStyle(fontWeight: FontWeight.w800),
                      ),
                      if (_modsText(items[i]).isNotEmpty)
                        Text(
                          '+ ${_modsText(items[i])}',
                          style: TextStyle(
                            color: DanColors.muted,
                            fontSize: 11,
                          ),
                        ),
                      if (_promoText(items[i]).isNotEmpty)
                        Text(
                          'KM: ${_promoText(items[i])}',
                          style: TextStyle(
                            color: DanColors.brand,
                            fontSize: 11,
                            fontStyle: FontStyle.italic,
                          ),
                        ),
                      Text(
                        '${_n(items[i]['qty'])} x ${Fmt.money(_n(items[i]['unit_price']))}',
                        style: TextStyle(
                          color: DanColors.faint,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
                SizedBox(
                  width: 96,
                  child: Text(
                    Fmt.money(items[i]['line_total'] is num
                        ? items[i]['line_total']
                        : _n(items[i]['qty']) * _n(items[i]['unit_price'])),
                    textAlign: TextAlign.right,
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _Meta extends StatelessWidget {
  final String label;
  final String value;

  _Meta({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 180,
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: DanColors.surface2,
          borderRadius: BorderRadius.circular(DanRadius.sm),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: TextStyle(color: DanColors.muted, fontSize: 10.5),
            ),
            SizedBox(height: 2),
            Text(
              value.isEmpty ? '-' : value,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontWeight: FontWeight.w900),
            ),
          ],
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String text;
  final Color color;

  _Badge(this.text, this.color);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

String _date(dynamic value) {
  final d = DateTime.tryParse(_s(value))?.toLocal();
  return d == null ? '-' : Fmt.dmyHm(d);
}

String _paymentMethods(dynamic value) {
  final rows = _list(value);
  if (rows.isEmpty) return '';
  return rows
      .map((row) => _methodLabels[_s(row['method'])] ?? _s(row['method']))
      .where((label) => label.isNotEmpty)
      .join(', ');
}

String _placeLabel(Map<String, dynamic> receipt) {
  final online = _s(receipt['online_channel']);
  if (online.isNotEmpty) return online;
  final channel = _s(receipt['channel']);
  if (channel == 'retail') return t('Bán lẻ');
  if (channel == 'takeaway') return t('Mang đi');
  final table = _s(receipt['table_code']);
  return table.isEmpty ? t('Tại quầy') : t('Bàn $table');
}

String _statusLabel(String status) {
  switch (status) {
    case 'paid':
      return t('Đã thanh toán');
    case 'void':
      return t('Đã hủy');
    case 'open':
      return t('Đang mở');
    default:
      return status.isEmpty ? '-' : status;
  }
}

Color _statusColor(Map<String, dynamic> receipt) {
  return _s(receipt['status']) == 'void' ? DanColors.late : DanColors.done;
}

String _modsText(Map<String, dynamic> item) {
  final mods = item['mods'];
  if (mods is! List) return '';
  return mods
      .map((mod) {
        if (mod is Map) return _s(mod['label'] ?? mod['name']);
        return _s(mod);
      })
      .where((text) => text.isNotEmpty)
      .join(', ');
}

String _promoText(Map<String, dynamic> item) {
  final promo = _map(item['promo']);
  if (promo.isEmpty) return '';
  final name = _s(promo['name'] ?? promo['code']);
  final amount = _n(promo['amount']);
  final free = _n(promo['free_units']);
  final parts = <String>[
    if (amount > 0) t('giảm ${Fmt.money(amount)}'),
    if (free > 0)
      'tặng ${free.round()} ${_s(promo['free_product_name']).isEmpty ? 'sản phẩm' : _s(promo['free_product_name'])}',
  ];
  if (parts.isEmpty && _s(promo['description']).isNotEmpty) {
    return _s(promo['description']);
  }
  if (name.isEmpty) return parts.join(', ');
  return parts.isEmpty ? name : '$name: ${parts.join(', ')}';
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map) return Map<String, dynamic>.from(value);
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _list(dynamic value) {
  if (value is! List) return [];
  return value
      .whereType<Map>()
      .map((row) => Map<String, dynamic>.from(row))
      .toList();
}

String _receiptText(Map<String, dynamic> r) {
  final items = _list(r['items']);
  final lines = _list(r['lines']);
  final buffer = StringBuffer()
    ..writeln('HOA DON BAN HANG')
    ..writeln('Bill: ${_s(r['bill_no'] ?? r['number'])}')
    ..writeln('Ngay: ${_date(r['paid_at'] ?? r['created_at'])}')
    ..writeln('Thu ngan: ${_s(r['cashier'])}')
    ..writeln('Ban/Kenh: ${_placeLabel(r)}')
    ..writeln('------------------------------');
  for (final item in items) {
    buffer.writeln(
      '${_n(item['qty'])} x ${_s(item['name'])} = ${Fmt.money(item['line_total'] is num ? item['line_total'] : _n(item['qty']) * _n(item['unit_price']))}',
    );
    final promo = _promoText(item);
    if (promo.isNotEmpty) buffer.writeln('  KM: $promo');
  }
  buffer
    ..writeln('------------------------------')
    ..writeln('Tong: ${Fmt.money(_n(r['total']))}')
    ..writeln('Thanh toan: ${_paymentMethods(lines)}')
    ..writeln('Trang thai: ${_statusLabel(_s(r['status']))}');
  return buffer.toString();
}
