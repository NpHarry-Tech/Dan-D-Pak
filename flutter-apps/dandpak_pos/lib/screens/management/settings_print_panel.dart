import 'package:flutter/material.dart';

import '../../services/api_service.dart';
import 'print_template_designer.dart';
import 'settings_tab.dart';

/// Bill & Tem nhãn settings → a dedicated, single-page template designer.
///
/// Printer configuration, test prints and print-job history already live in the
/// "Máy in" module (and the Kết nối panel), so this page focuses solely on
/// designing the bill / label template — all tools and the design canvas fit on
/// one page with no up/down scrolling.
class PrintSettingsPanel extends StatefulWidget {
  final ApiService api;
  const PrintSettingsPanel({super.key, required this.api});

  @override
  State<PrintSettingsPanel> createState() => _PrintSettingsPanelState();
}

class _PrintSettingsPanelState extends State<PrintSettingsPanel> {
  Map<String, dynamic> _printConfig = {};
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final settings = await widget.api.getAppSettings();
      if (!mounted) return;
      setState(() {
        _printConfig = settings['print_config'] is Map
            ? Map<String, dynamic>.from(settings['print_config'] as Map)
            : <String, dynamic>{};
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPanelScaffold(
      title: 'Bill & Tem nhãn',
      onRefresh: _load,
      child: settingsState(
        loading: _loading,
        error: _error,
        onRetry: _load,
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: PrintTemplateDesigner(
            api: widget.api,
            initialConfig: _printConfig,
            onSaved: (config) => setState(() => _printConfig = config),
          ),
        ),
      ),
    );
  }
}
