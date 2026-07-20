import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/pos_models.dart';
import '../providers/auth_provider.dart';
import '../ui/app_theme.dart';
import '../widgets/dan_tile_grid.dart';
import '../widgets/window_controls.dart';
import '../utils/translation.dart';

/// Màn hình đầu tiên khi mở app: chọn cơ sở / chi nhánh (giống KiotViet),
/// sau đó mới sang màn đăng nhập nhân viên.
class BranchSelectScreen extends StatefulWidget {
  BranchSelectScreen({super.key});

  @override
  State<BranchSelectScreen> createState() => _BranchSelectScreenState();
}

class _BranchSelectScreenState extends State<BranchSelectScreen> {
  String? _error;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await context.read<AuthProvider>().loadBranches();
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _choose(Branch branch) async {
    final auth = context.read<AuthProvider>();
    // selectBranch lưu lựa chọn + tải danh sách nhân viên của cơ sở.
    try {
      await auth.selectBranch(branch.id);
    } catch (_) {
      // Nếu tải nhân viên lỗi, màn đăng nhập sẽ tự thử lại và báo lỗi.
    }
    if (mounted) auth.confirmBranch();
  }

  void _showServerConfigDialog(BuildContext context) {
    final auth = context.read<AuthProvider>();
    final controller = TextEditingController(text: auth.serverUrl);

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: DanColors.surface,
          title: Text(
            t('Cấu hình Máy chủ (Server)'),
            style:
                TextStyle(color: DanColors.text, fontWeight: FontWeight.bold),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                t('Nhập địa chỉ API của máy chủ trung tâm:'),
                style: TextStyle(color: DanColors.muted, fontSize: 13),
              ),
              SizedBox(height: 12),
              TextField(
                controller: controller,
                style: TextStyle(color: DanColors.text),
                decoration: InputDecoration(
                  labelText: t('Địa chỉ Server'),
                  hintText: 'http://192.168.1.50:3000',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
              SizedBox(height: 12),
              Text(
                t('Mặc định là http://127.0.0.1:3000. Nếu đây là máy POS phụ, hãy nhập IP LAN của máy chủ chính.'),
                style: TextStyle(
                  color: DanColors.muted,
                  fontSize: 11,
                  fontStyle: FontStyle.italic,
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(t('Hủy')),
            ),
            FilledButton(
              onPressed: () async {
                final url = controller.text.trim();
                if (url.isNotEmpty) {
                  await auth.updateServerUrl(url);
                  if (context.mounted) {
                    Navigator.pop(context);
                    _load();
                  }
                }
              },
              child: Text(t('Lưu & Kết nối')),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();

    return Scaffold(
      backgroundColor: DanColors.bg,
      body: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(
              child: Center(
                child: SingleChildScrollView(
                  padding: EdgeInsets.all(24),
                  child: ConstrainedBox(
                    constraints: BoxConstraints(maxWidth: 720),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Image.asset(
                          'assets/brand/logo.png',
                          width: 300,
                          fit: BoxFit.contain,
                        ),
                        SizedBox(height: 20),
                        Text(
                          t('Chọn cơ sở'),
                          style: TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w900,
                            color: DanColors.text,
                          ),
                        ),
                        SizedBox(height: 6),
                        Text(
                          t('Chọn cơ sở / chi nhánh để bắt đầu ca làm'),
                          style: TextStyle(
                            color: DanColors.muted,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        SizedBox(height: 26),
                        _body(auth),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            Positioned(
              top: 0,
              left: 0,
              right: 146,
              height: 62,
              child: DragToMoveArea(
                child: SizedBox.expand(),
              ),
            ),
            Positioned(
              top: 10,
              right: 156,
              child: IconButton(
                icon: Icon(Icons.settings, color: DanColors.muted),
                tooltip: t('Cấu hình Server'),
                onPressed: () => _showServerConfigDialog(context),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _body(AuthProvider auth) {
    final branches = auth.branches;
    if (_loading && branches.isEmpty) return _BranchSkeleton();
    if (_error != null) {
      return _InlineError(
        message: _error!,
        onRetry: _load,
        onEditServer: () => _showServerConfigDialog(context),
      );
    }
    if (branches.isEmpty) {
      return _InlineError(
        message: t('Chưa tải được danh sách cơ sở.'),
        onEditServer: () => _showServerConfigDialog(context),
      );
    }
    // QUY TẮC LƯỚI CHUNG: thẻ chi nhánh có kích thước CỐ ĐỊNH; thêm/bớt chi nhánh
    // thì các thẻ sau tự dịch trái – lùi lên, KHÔNG giãn thẻ cho vừa hàng.
    return DanTileGrid(
      tileWidth: 260,
      tileHeight: 132,
      spacing: 14,
      runSpacing: 14,
      children: [
        for (final branch in branches)
          _BranchCard(
            branch: branch,
            selected: branch.id == auth.selectedBranchId,
            onTap: () => _choose(branch),
          ),
      ],
    );
  }
}

class _BranchCard extends StatelessWidget {
  final Branch branch;
  final bool selected;
  final VoidCallback onTap;

  _BranchCard({
    required this.branch,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final name = branch.name.isNotEmpty ? branch.name : branch.id;
    final subtitle = branch.address.isNotEmpty ? branch.address : branch.code;
    return InkWell(
      borderRadius: BorderRadius.circular(DanRadius.lg),
      onTap: onTap,
      child: Container(
        padding: EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: selected ? DanColors.brandDim : DanColors.surface,
          border: Border.all(
            color: selected ? DanColors.brand : DanColors.border2,
            width: selected ? 1.6 : 1,
          ),
          borderRadius: BorderRadius.circular(DanRadius.lg),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: DanColors.brandDim,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(Icons.storefront_outlined,
                      color: DanColors.brand, size: 21),
                ),
                Spacer(),
                if (selected)
                  Icon(Icons.check_circle, color: DanColors.brand, size: 20),
              ],
            ),
            Spacer(),
            Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w900,
                color: DanColors.text,
              ),
            ),
            SizedBox(height: 3),
            Text(
              subtitle.isNotEmpty ? subtitle : branch.id,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: DanColors.muted,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BranchSkeleton extends StatelessWidget {
  _BranchSkeleton();

  @override
  Widget build(BuildContext context) {
    // Skeleton dùng ĐÚNG kích thước ô như lưới thật → tải xong không bị "nhảy" layout.
    return DanTileGrid(
      tileWidth: 260,
      tileHeight: 132,
      spacing: 14,
      runSpacing: 14,
      children: List.generate(
        3,
        (_) => DecoratedBox(
          decoration: BoxDecoration(
            color: DanColors.surface2,
            borderRadius: BorderRadius.circular(DanRadius.lg),
            border: Border.all(color: DanColors.border),
          ),
        ),
      ),
    );
  }
}

class _InlineError extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;
  final VoidCallback? onEditServer;

  _InlineError({
    required this.message,
    this.onRetry,
    this.onEditServer,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Color(0xFFFFF5F5),
        border: Border.all(color: Color(0x33FF6B6B)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            message,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: DanColors.late,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (onRetry != null || onEditServer != null) ...[
            SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (onEditServer != null) ...[
                  OutlinedButton(
                    onPressed: onEditServer,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: DanColors.brand,
                      side: BorderSide(color: DanColors.brand),
                    ),
                    child: Text(t('Đổi địa chỉ Server')),
                  ),
                  if (onRetry != null) SizedBox(width: 12),
                ],
                if (onRetry != null)
                  FilledButton(
                    onPressed: onRetry,
                    child: Text(t('Tải lại')),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
