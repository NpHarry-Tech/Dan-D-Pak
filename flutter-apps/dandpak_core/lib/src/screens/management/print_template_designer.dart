import 'dart:async';
import 'dart:convert';

import 'package:barcode_widget/barcode_widget.dart';
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../ui/file_pick.dart';
import '../../utils/translation.dart';

part 'print_template_designer_methods.dart';

String _s(dynamic v) => v?.toString() ?? '';

double _d(dynamic v, [double fallback = 0]) {
  if (v is num) return v.toDouble();
  return double.tryParse(_s(v).replaceAll(',', '.')) ?? fallback;
}

bool _b(dynamic v) => v == true || _s(v) == '1' || _s(v) == 'true';

/// KiotViet-style print-template editor: a two-pane layout where the LEFT pane
/// edits the receipt/label content line-by-line (with insertable {token}s and a
/// store-info form) and the RIGHT pane shows a LIVE monospace preview that is
/// faithful to the actual K80 thermal printout (the server renders the same
/// {tokens} → 40-column ASCII, so what you see is what prints).
class PrintTemplateDesigner extends StatefulWidget {
  final ApiService api;
  final Map<String, dynamic> initialConfig;
  final ValueChanged<Map<String, dynamic>>? onSaved;

  PrintTemplateDesigner({
    super.key,
    required this.api,
    required this.initialConfig,
    this.onSaved,
  });

  @override
  State<PrintTemplateDesigner> createState() => _PrintTemplateDesignerState();
}

class _PrintTemplateDesignerState extends State<PrintTemplateDesigner> {
  final _saveDebounce = _Debouncer(Duration(milliseconds: 700));

  late Map<String, dynamic> _printConfig;
  late Map<String, dynamic> _bill;
  late Map<String, dynamic> _labels;
  Map<String, dynamic> _template = {};
  String _kind = 'bill';

  // One controller + focus node per content row (needed for cursor-position
  // token insertion and for a live-updating preview).
  final Map<String, TextEditingController> _rowCtrls = {};
  final Map<String, FocusNode> _rowFocus = {};
  String? _activeRowId; // last-focused row → target for "insert token"

  final TextEditingController _nameCtrl = TextEditingController();
  int _formRevision = 0; // bumps to rebuild store-info fields after a reset

  bool _saving = false;
  String _saveState = '';
  // The parent echoes our saved config back via initialConfig; skip re-hydrating
  // on that echo so we don't dispose row controllers while the user is typing.
  bool _ignoreNextConfigUpdate = false;
  int _rowSeq = 0; // bộ đếm sinh id dòng (dùng trong _tRow/_lineRow/_qrRow…)

  // Cầu nối setState cho các method đã tách sang extension (…_methods.dart).
  // setState là @protected nên extension gọi qua wrapper này (instance member)
  // để giữ nguyên hành vi mà không vướng lint protected-member.
  void _rebuild([VoidCallback? fn]) => setState(fn ?? () {});

  @override
  void initState() {
    super.initState();
    _hydrate(widget.initialConfig);
  }

  @override
  void didUpdateWidget(covariant PrintTemplateDesigner oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialConfig != widget.initialConfig) {
      if (_ignoreNextConfigUpdate) {
        // Our own save echo — keep the reference in sync but don't rebuild.
        _ignoreNextConfigUpdate = false;
        _printConfig = _copyMap(widget.initialConfig);
        return;
      }
      _hydrate(widget.initialConfig); // genuine external reload (e.g. Refresh)
    }
  }

  @override
  void dispose() {
    _saveDebounce.dispose();
    _disposeRowControllers();
    _nameCtrl.dispose();
    super.dispose();
  }
  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DanColors.surface,
        border: Border.all(color: DanColors.border),
        borderRadius: BorderRadius.circular(DanRadius.lg),
        boxShadow: [
          BoxShadow(
              color: Color(0x0A102840), blurRadius: 2, offset: Offset(0, 1)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _topBar(),
          SizedBox(height: 10),
          Divider(height: 1, color: DanColors.border),
          SizedBox(height: 12),
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) {
                if (constraints.maxWidth < 900) {
                  return Column(
                    children: [
                      Expanded(flex: 3, child: _previewPane()),
                      SizedBox(height: 12),
                      Expanded(flex: 4, child: _editorPane()),
                    ],
                  );
                }
                return Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(flex: 6, child: _editorPane()),
                    SizedBox(width: 12),
                    Expanded(flex: 4, child: _previewPane()),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// A thin dashed divider used in the receipt preview (like a real bill).
class _DashedLine extends StatelessWidget {
  _DashedLine();
  @override
  Widget build(BuildContext context) => SizedBox(
        height: 1,
        width: double.infinity,
        child: CustomPaint(painter: _DashedPainter()),
      );
}

class _DashedPainter extends CustomPainter {
  _DashedPainter();
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Color(0x66102840)
      ..strokeWidth = 1;
    final dash = 4.0, gap = 3.0;
    double x = 0;
    while (x < size.width) {
      canvas.drawLine(Offset(x, 0), Offset(x + dash, 0), paint);
      x += dash + gap;
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _Debouncer {
  final Duration delay;
  Timer? _timer;
  _Debouncer(this.delay);

  void run(VoidCallback action) {
    _timer?.cancel();
    _timer = Timer(delay, action);
  }

  void cancel() => _timer?.cancel();
  void dispose() => _timer?.cancel();
}

Map<String, dynamic> _copyMap(dynamic value) {
  if (value is Map) {
    return jsonDecode(jsonEncode(value)) as Map<String, dynamic>;
  }
  return <String, dynamic>{};
}

// Decode a `data:image/...;base64,xxxx` URL to bytes (return type inferred as
// Uint8List from base64Decode, so no extra import is needed).
_dataUrlBytes(String dataUrl) {
  final comma = dataUrl.indexOf(',');
  return base64Decode(comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl);
}
