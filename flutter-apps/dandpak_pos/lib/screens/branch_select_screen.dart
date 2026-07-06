import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/pos_models.dart';
import '../providers/auth_provider.dart';
import '../ui/app_theme.dart';
import '../widgets/window_controls.dart';

/// Màn hình đầu tiên khi mở app: chọn cơ sở / chi nhánh (giống KiotViet),
/// sau đó mới sang màn đăng nhập nhân viên.
class BranchSelectScreen extends StatefulWidget {
  const BranchSelectScreen({super.key});

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
          title: const Text(
            'Cấu hình Máy chủ (Server)',
            style: TextStyle(color: DanColors.text, fontWeight: FontWeight.bold),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Nhập địa chỉ API của máy chủ trung tâm:',
                style: TextStyle(color: DanColors.muted, fontSize: 13),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: controller,
                style: const TextStyle(color: DanColors.text),
                decoration: const InputDecoration(
                  labelText: 'Địa chỉ Server',
                  hintText: 'http://192.168.1.50:3000',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'Mặc định là http://127.0.0.1:3000. Nếu đây là máy POS phụ, hãy nhập IP LAN của máy chủ chính.',
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
              child: const Text('Hủy'),
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
              child: const Text('Lưu & Kết nối'),
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
                  padding: const EdgeInsets.all(24),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 720),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Image.asset(
                          'assets/web/assets/logo.png',
                          width: 300,
                          fit: BoxFit.contain,
                        ),
                        const SizedBox(height: 20),
                        const Text(
                          'Chọn cơ sở',
                          style: TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w900,
                            color: DanColors.text,
                          ),
                        ),
                        const SizedBox(height: 6),
                        const Text(
                          'Chọn cơ sở / chi nhánh để bắt đầu ca làm',
                          style: TextStyle(
                            color: DanColors.muted,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 26),
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
              child: const DragToMoveArea(
                child: SizedBox.expand(),
              ),
            ),
            Positioned(
              top: 10,
              right: 156,
              child: IconButton(
                icon: const Icon(Icons.settings, color: DanColors.muted),
                tooltip: 'Cấu hình Server',
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
    if (_loading && branches.isEmpty) return const _BranchSkeleton();
    if (_error != null) {
      return _InlineError(
        message: _error!,
        onRetry: _load,
        onEditServer: () => _showServerConfigDialog(context),
      );
    }
    if (branches.isEmpty) {
      return _InlineError(
        message: 'Chưa tải được danh sách cơ sở.',
        onEditServer: () => _showServerConfigDialog(context),
      );
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final columns = width >= 640
            ? 3
            : width >= 420
                ? 2
                : 1;
        return GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: branches.length,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            crossAxisSpacing: 14,
            mainAxisSpacing: 14,
            mainAxisExtent: 132,
          ),
          itemBuilder: (context, index) {
            final branch = branches[index];
            return _BranchCard(
              branch: branch,
              selected: branch.id == auth.selectedBranchId,
              onTap: () => _choose(branch),
            );
          },
        );
      },
    );
  }
}

class _BranchCard extends StatelessWidget {
  final Branch branch;
  final bool selected;
  final VoidCallback onTap;

  const _BranchCard({
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
        padding: const EdgeInsets.all(18),
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
                  child: const Icon(Icons.storefront_outlined,
                      color: DanColors.brand, size: 21),
                ),
                const Spacer(),
                if (selected)
                  const Icon(Icons.check_circle,
                      color: DanColors.brand, size: 20),
              ],
            ),
            const Spacer(),
            Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w900,
                color: DanColors.text,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              subtitle.isNotEmpty ? subtitle : branch.id,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
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
  const _BranchSkeleton();

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: 3,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        crossAxisSpacing: 14,
        mainAxisSpacing: 14,
        mainAxisExtent: 132,
      ),
      itemBuilder: (_, __) => DecoratedBox(
        decoration: BoxDecoration(
          color: DanColors.surface2,
          borderRadius: BorderRadius.circular(DanRadius.lg),
          border: Border.all(color: DanColors.border),
        ),
      ),
    );
  }
}

class _InlineError extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;
  final VoidCallback? onEditServer;

  const _InlineError({
    required this.message,
    this.onRetry,
    this.onEditServer,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF5F5),
        border: Border.all(color: const Color(0x33FF6B6B)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: DanColors.late,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (onRetry != null || onEditServer != null) ...[
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (onEditServer != null) ...[
                  OutlinedButton(
                    onPressed: onEditServer,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: DanColors.brand,
                      side: const BorderSide(color: DanColors.brand),
                    ),
                    child: const Text('Đổi địa chỉ Server'),
                  ),
                  if (onRetry != null) const SizedBox(width: 12),
                ],
                if (onRetry != null)
                  FilledButton(
                    onPressed: onRetry,
                    child: const Text('Tải lại'),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
