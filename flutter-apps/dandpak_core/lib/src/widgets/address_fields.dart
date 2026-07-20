import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../utils/translation.dart';

class VnProvince {
  final String code;
  final String name;
  final List<VnWard> wards;
  VnProvince(this.code, this.name, this.wards);
}

class VnWard {
  final String code;
  final String name;
  VnWard(this.code, this.name);
}

class VnAddressParts {
  final String detail;
  final VnProvince? province;
  final VnWard? ward;
  VnAddressParts({this.detail = '', this.province, this.ward});
}

class VnAddressBook {
  final List<VnProvince> provinces;
  VnAddressBook(this.provinces);

  static Future<VnAddressBook> load() async {
    final raw =
        await rootBundle.loadString('assets/data/vn_admin_units_2026.json');
    final json = jsonDecode(raw) as Map<String, dynamic>;
    final provinces = (json['provinces'] as List? ?? [])
        .whereType<Map>()
        .map((p) => VnProvince(
              '${p['code']}',
              '${p['name']}',
              (p['wards'] as List? ?? [])
                  .whereType<Map>()
                  .map((w) => VnWard('${w['code']}', '${w['name']}'))
                  .toList(),
            ))
        .toList();
    return VnAddressBook(provinces);
  }

  VnProvince? provinceByCode(String code) =>
      provinces.where((p) => p.code == code).firstOrNull;

  VnWard? wardByCode(VnProvince? p, String code) =>
      p?.wards.where((w) => w.code == code).firstOrNull;

  VnAddressParts parse(String input, {VnProvince? preferredProvince}) {
    final text = input.trim();
    if (text.isEmpty) return VnAddressParts();
    final tokens = text
        .split(',')
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList();
    final haystack = _fold(text);
    final province = preferredProvince ??
        provinces.lastWhereOrNull(
            (p) => _unitNeedles(p.name).any(haystack.contains));
    final ward = province?.wards
        .lastWhereOrNull((w) => _unitNeedles(w.name).any(haystack.contains));
    final provinceNeedles =
        province == null ? <String>[] : _unitNeedles(province.name);
    final wardNeedles = ward == null ? <String>[] : _unitNeedles(ward.name);
    final detailTokens = tokens.where((t) {
      final f = _fold(t);
      return !provinceNeedles.contains(f) && !wardNeedles.contains(f);
    }).toList();
    final detail = detailTokens.length == tokens.length
        ? _stripKnownUnits(text, [
            if (ward != null) ..._unitDisplayVariants(ward.name),
            if (province != null) ..._unitDisplayVariants(province.name),
          ])
        : detailTokens.join(', ');
    return VnAddressParts(detail: detail, province: province, ward: ward);
  }
}

extension _FirstOrNull<E> on Iterable<E> {
  E? get firstOrNull => isEmpty ? null : first;
  E? lastWhereOrNull(bool Function(E) test) {
    E? out;
    for (final e in this) {
      if (test(e)) out = e;
    }
    return out;
  }
}

String _fold(String input) {
  final from =
      t('àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ');
  final to =
      'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd';
  var s = input.toLowerCase();
  for (var i = 0; i < from.length; i++) {
    s = s.replaceAll(from[i], to[i]);
  }
  return s.replaceAll(RegExp(r'\s+'), ' ').trim();
}

List<String> _unitNeedles(String name) {
  final full = _fold(name);
  final short = full
      .replaceFirst(RegExp(r'^(tinh|thanh pho|tp|phuong|xa|thi tran) '), '')
      .trim();
  return {full, if (short.isNotEmpty) short}.toList();
}

List<String> _unitDisplayVariants(String name) {
  final short = name
      .replaceFirst(
          RegExp(r'^(Tỉnh|Thành phố|TP\.?|Phường|Xã|Thị trấn)\s+',
              caseSensitive: false),
          '')
      .trim();
  final folded = _fold(name);
  final foldedShort = _fold(short);
  return {
    name,
    if (short.isNotEmpty) short,
    folded,
    if (foldedShort.isNotEmpty) foldedShort,
  }.toList();
}

String _stripKnownUnits(String text, List<String> unitNames) {
  var out = text.trim();
  for (final name in unitNames) {
    out = out.replaceAll(RegExp(RegExp.escape(name), caseSensitive: false), '');
  }
  return out
      .replaceAll(RegExp(r'\s*,\s*,+'), ', ')
      .replaceAll(RegExp(r'\s{2,}'), ' ')
      .replaceAll(RegExp(r'^[,\s]+|[,\s]+$'), '')
      .trim();
}

String composeVietnamAddress({
  required String detail,
  required String ward,
  required String province,
}) {
  return [
    detail.trim(),
    ward.trim(),
    province.trim(),
  ].where((x) => x.isNotEmpty).join(', ');
}

class AddressFields extends StatefulWidget {
  final TextEditingController address;
  final TextEditingController? detail;
  final TextEditingController? ward;
  final TextEditingController? province;
  final TextEditingController? wardCode;
  final TextEditingController? provinceCode;
  final bool locked;
  final String label;

  AddressFields({
    super.key,
    required this.address,
    this.detail,
    this.ward,
    this.province,
    this.wardCode,
    this.provinceCode,
    this.locked = false,
    this.label = 'Địa chỉ',
  });

  @override
  State<AddressFields> createState() => _AddressFieldsState();
}

class _AddressFieldsState extends State<AddressFields> {
  static Future<VnAddressBook>? _bookFuture;
  late final TextEditingController _detail;
  late final TextEditingController _ward;
  late final TextEditingController _province;
  bool _updating = false;

  @override
  void initState() {
    super.initState();
    _bookFuture ??= VnAddressBook.load();
    _detail = widget.detail ?? TextEditingController();
    _ward = widget.ward ?? TextEditingController();
    _province = widget.province ?? TextEditingController();
    _detail.addListener(_compose);
    _ward.addListener(_compose);
    _province.addListener(_compose);
    widget.address.addListener(_parseExternal);
    _bookFuture?.then((book) {
      if (!mounted ||
          widget.address.text.trim().isEmpty ||
          _detail.text.trim().isNotEmpty) {
        return;
      }
      _apply(book.parse(widget.address.text), compose: false);
    });
  }

  @override
  void dispose() {
    widget.address.removeListener(_parseExternal);
    _detail.removeListener(_compose);
    _ward.removeListener(_compose);
    _province.removeListener(_compose);
    if (widget.detail == null) _detail.dispose();
    if (widget.ward == null) _ward.dispose();
    if (widget.province == null) _province.dispose();
    super.dispose();
  }

  void _parseExternal() {
    if (_updating || widget.address.text.trim().isEmpty) return;
    _bookFuture?.then((book) {
      if (!mounted) return;
      _apply(book.parse(widget.address.text), compose: false);
    });
  }

  void _compose() {
    if (_updating) return;
    final full = composeVietnamAddress(
      detail: _detail.text,
      ward: _ward.text,
      province: _province.text,
    );
    _updating = true;
    widget.address.text = full;
    _updating = false;
  }

  void _apply(VnAddressParts parts, {bool compose = true}) {
    _updating = true;
    if (parts.detail.isNotEmpty) _detail.text = parts.detail;
    if (parts.province != null) {
      _province.text = parts.province!.name;
      widget.provinceCode?.text = parts.province!.code;
    }
    if (parts.ward != null) {
      _ward.text = parts.ward!.name;
      widget.wardCode?.text = parts.ward!.code;
    }
    _updating = false;
    if (compose) _compose();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<VnAddressBook>(
      future: _bookFuture,
      builder: (context, snap) {
        final book = snap.data;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _detail,
              readOnly: widget.locked,
              minLines: 1,
              maxLines: 2,
              decoration: InputDecoration(
                labelText: widget.label,
                hintText: t('Số nhà, tên đường, ấp/tổ/khu phố'),
                suffixIcon: IconButton(
                  tooltip: t('Tự tách phường/xã, tỉnh/thành'),
                  onPressed: widget.locked || book == null
                      ? null
                      : () => _apply(book.parse(widget.address.text.isEmpty
                          ? _detail.text
                          : widget.address.text)),
                  icon: Icon(Icons.auto_fix_high_outlined),
                ),
              ),
              onEditingComplete:
                  book == null ? null : () => _apply(book.parse(_detail.text)),
            ),
            SizedBox(height: 8),
            Row(
              children: [
                Expanded(child: _provinceBox(book)),
                SizedBox(width: 8),
                Expanded(child: _wardBox(book)),
              ],
            ),
          ],
        );
      },
    );
  }

  Widget _provinceBox(VnAddressBook? book) {
    if (book == null) {
      return TextField(
        controller: _province,
        readOnly: true,
        decoration: InputDecoration(labelText: t('Tỉnh/Thành phố')),
      );
    }
    return Autocomplete<VnProvince>(
      displayStringForOption: (p) => p.name,
      optionsBuilder: (q) {
        final needle = _fold(q.text);
        return book.provinces.where((p) => _fold(p.name).contains(needle));
      },
      onSelected: (p) {
        _province.text = p.name;
        widget.provinceCode?.text = p.code;
        _ward.clear();
        widget.wardCode?.clear();
        _compose();
      },
      fieldViewBuilder: (_, ctrl, focus, submit) {
        if (ctrl.text != _province.text) ctrl.text = _province.text;
        return TextField(
          controller: ctrl,
          focusNode: focus,
          readOnly: widget.locked,
          decoration: InputDecoration(labelText: t('Tỉnh/Thành phố')),
          onChanged: (v) => _province.text = v,
        );
      },
    );
  }

  Widget _wardBox(VnAddressBook? book) {
    final province = book?.provinces
        .where((p) =>
            p.name == _province.text || p.code == widget.provinceCode?.text)
        .firstOrNull;
    final wards = province?.wards ?? <VnWard>[];
    return Autocomplete<VnWard>(
      displayStringForOption: (w) => w.name,
      optionsBuilder: (q) {
        final needle = _fold(q.text);
        return wards.where((w) => _fold(w.name).contains(needle));
      },
      onSelected: (w) {
        _ward.text = w.name;
        widget.wardCode?.text = w.code;
        _compose();
      },
      fieldViewBuilder: (_, ctrl, focus, submit) {
        if (ctrl.text != _ward.text) ctrl.text = _ward.text;
        return TextField(
          controller: ctrl,
          focusNode: focus,
          readOnly: widget.locked || province == null,
          decoration: InputDecoration(labelText: t('Phường/Xã')),
          onChanged: (v) => _ward.text = v,
        );
      },
    );
  }
}
