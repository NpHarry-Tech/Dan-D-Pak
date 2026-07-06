import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/api_service.dart';
import '../ui/app_theme.dart';

/// Company-info-by-MST lookup, shared by EVERY form that asks for a tax code
/// (retail checkout, VAT invoice from history, customer edit, contacts...).
///
/// Rule (user-mandated): data FETCHED from the tax directory (company name,
/// address) is locked read-only — it cannot be edited or deleted. The only way
/// to change it is to clear/replace the MST, which unlocks and clears those
/// fields so the new MST must be looked up (re-verified) again. Manually typed
/// data stays freely editable.
class TaxLookupController extends ChangeNotifier {
  final ApiService api;
  final TextEditingController mst;
  final TextEditingController company;
  final TextEditingController address;

  bool _locked = false;
  bool _addressFetched = false;
  bool loading = false;
  String _lockedMst = '';

  /// Raw payload of the last successful lookup (name/shortName... ) for forms
  /// that want to prefill extra fields beyond company + address.
  Map<String, dynamic>? lastResult;

  TaxLookupController({
    required this.api,
    required this.mst,
    required this.company,
    required this.address,
  }) {
    mst.addListener(_onMstChanged);
  }

  bool get locked => _locked;
  bool get companyLocked => _locked;
  // A directory hit with no address keeps the address field editable.
  bool get addressLocked => _locked && _addressFetched;

  void _onMstChanged() {
    if (_locked && mst.text.trim() != _lockedMst) {
      _locked = false;
      _addressFetched = false;
      _lockedMst = '';
      company.clear();
      address.clear();
      notifyListeners();
    }
  }

  /// Drop the lock WITHOUT clearing the fields — for when the parent form is
  /// re-seeded with a different record (e.g. selecting another bill).
  void resetLock() {
    if (!_locked) return;
    _locked = false;
    _addressFetched = false;
    _lockedMst = '';
    notifyListeners();
  }

  /// Fetch company info for the current MST. Returns an error message, or
  /// null on success (fields filled + locked).
  Future<String?> lookup() async {
    final tc = mst.text.replaceAll(RegExp(r'\s+'), '');
    if (tc.isEmpty) return 'Nhập mã số thuế trước khi truy xuất';
    loading = true;
    notifyListeners();
    try {
      final res = await api.lookupTaxCode(tc);
      loading = false;
      if (res['ok'] == true) {
        lastResult = res;
        final fetchedCompany = (res['company'] ?? '').toString().trim();
        final fetchedAddress = (res['address'] ?? '').toString().trim();
        company.text = fetchedCompany;
        address.text = fetchedAddress;
        mst.text = (res['tax_code'] ?? tc).toString();
        _lockedMst = mst.text.trim();
        _addressFetched = fetchedAddress.isNotEmpty;
        _locked = true;
        notifyListeners();
        return null;
      }
      notifyListeners();
      return (res['message'] ?? 'Không tra cứu được thông tin theo MST này.')
          .toString();
    } catch (e) {
      loading = false;
      notifyListeners();
      return e.toString().replaceFirst('Exception: ', '');
    }
  }

  @override
  void dispose() {
    mst.removeListener(_onMstChanged);
    super.dispose();
  }
}

/// The MST input with the "Truy xuất Cục Thuế" button baked in. Drop this in
/// wherever a plain MST TextField used to be.
class MstField extends StatelessWidget {
  final TaxLookupController lookup;
  final String label;
  final String? hint;
  final bool isDense;
  final void Function(String message, {bool error}) onMessage;

  const MstField({
    super.key,
    required this.lookup,
    required this.onMessage,
    this.label = 'Mã số thuế',
    this.hint,
    this.isDense = true,
  });

  Future<void> _run() async {
    final err = await lookup.lookup();
    if (err != null) {
      onMessage(err, error: true);
    } else {
      onMessage('Đã điền thông tin công ty từ dữ liệu Cục Thuế',
          error: false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: lookup,
      builder: (context, _) => TextField(
        controller: lookup.mst,
        keyboardType: TextInputType.number,
        inputFormatters: [
          FilteringTextInputFormatter.digitsOnly,
          LengthLimitingTextInputFormatter(13),
        ],
        onSubmitted: (_) => _run(),
        decoration: InputDecoration(
          labelText: label.isEmpty ? null : label,
          hintText: hint,
          isDense: isDense,
          helperText: lookup.locked
              ? 'Đã xác thực Cục Thuế — xóa MST để nhập/kiểm tra lại'
              : null,
          helperStyle: const TextStyle(fontSize: 10.5, color: DanColors.done),
          suffixIcon: lookup.loading
              ? const Padding(
                  padding: EdgeInsets.all(10),
                  child: SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              : lookup.locked
                  ? const Icon(Icons.verified_outlined,
                      size: 19, color: DanColors.done)
                  : IconButton(
                      tooltip: 'Truy xuất thông tin công ty từ Cục Thuế',
                      icon: const Icon(Icons.travel_explore, size: 19),
                      color: DanColors.brand,
                      onPressed: _run,
                    ),
        ),
      ),
    );
  }
}

/// Decoration for fields whose value came from the tax directory / is
/// auto-detected: KHÔNG icon khóa — chỉ tối nền ô một chút (user-mandated).
/// Pair with `readOnly: locked` on the TextField.
InputDecoration taxLockedDecoration({
  required String label,
  required bool locked,
  bool isDense = true,
}) {
  return InputDecoration(
    labelText: label,
    isDense: isDense,
    filled: locked,
    fillColor: locked ? DanColors.surface3 : null,
  );
}
