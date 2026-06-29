// lib/screens/ordering_module/modifier_dialog.dart
import 'package:flutter/material.dart';
import '../../models/cart.dart';
import '../../models/tablet_models.dart';

class ModifierDialog extends StatefulWidget {
  final MenuItem item;
  final Function(List<ModifierOption> selectedModifiers, String notes, int qty) onAdd;

  const ModifierDialog({
    super.key,
    required this.item,
    required this.onAdd,
  });

  @override
  State<ModifierDialog> createState() => _ModifierDialogState();
}

class _ModifierDialogState extends State<ModifierDialog> {
  final List<ModifierOption> _selectedModifiers = [];
  final _notesController = TextEditingController();
  int _qty = 1;

  void _toggleModifier(ModifierOption option) {
    setState(() {
      if (_selectedModifiers.any((m) => m.name == option.name)) {
        _selectedModifiers.removeWhere((m) => m.name == option.name);
      } else {
        _selectedModifiers.add(option);
      }
    });
  }

  int get _singlePrice {
    int price = widget.item.price;
    for (var mod in _selectedModifiers) {
      price += mod.price;
    }
    return price;
  }

  int get _totalPrice => _singlePrice * _qty;

  @override
  void dispose() {
    _notesController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Group modifiers options by group if any, else list them directly
    final List<dynamic> modGroups = widget.item.modifiers;
    final List<ModifierOption> options = [];
    
    for (var group in modGroups) {
      if (group is Map && group['options'] is List) {
        for (var opt in group['options']) {
          if (opt is Map) {
            options.add(ModifierOption(
              name: '${group['name'] ?? ''}: ${opt['name'] ?? ''}',
              price: int.tryParse(opt['price']?.toString() ?? '0') ?? 0,
            ));
          }
        }
      } else if (group is Map) {
        options.add(ModifierOption(
          name: (group['name'] ?? '').toString(),
          price: int.tryParse(group['price']?.toString() ?? '0') ?? 0,
        ));
      }
    }

    return Dialog(
      backgroundColor: const Color(0xFF1C2430),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 500, maxHeight: 650),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      widget.item.name,
                      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.extrabold, color: Colors.white),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, color: Colors.white54),
                    onPressed: () => Navigator.of(context).pop(),
                  )
                ],
              ),
              const Divider(color: Colors.white12),
              Expanded(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (options.isNotEmpty) ...[
                        const Text(
                          'TÙY CHỌN & TOPPING',
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Color(0xFF2F7D6B), letterSpacing: 1),
                        ),
                        const SizedBox(height: 10),
                        ListView.builder(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          itemCount: options.length,
                          itemBuilder: (context, index) {
                            final opt = options[index];
                            final isSelected = _selectedModifiers.any((m) => m.name == opt.name);
                            return CheckboxListTile(
                              title: Text(opt.name, style: const TextStyle(color: Colors.white, fontSize: 14)),
                              subtitle: opt.price > 0
                                  ? Text('+đ${opt.price}', style: const TextStyle(color: Color(0xFF2F7D6B), fontWeight: FontWeight.bold))
                                  : null,
                              value: isSelected,
                              activeColor: const Color(0xFF2F7D6B),
                              checkColor: Colors.white,
                              contentPadding: EdgeInsets.zero,
                              onChanged: (_) => _toggleModifier(opt),
                            );
                          },
                        ),
                        const SizedBox(height: 20),
                      ],
                      const Text(
                        'GHI CHÚ MÓN ĂN',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Color(0xFF2F7D6B), letterSpacing: 1),
                      ),
                      const SizedBox(height: 10),
                      TextField(
                        controller: _notesController,
                        style: const TextStyle(color: Colors.white, fontSize: 14),
                        decoration: InputDecoration(
                          hintText: 'Ví dụ: ít đường, không đá, chín kỹ...',
                          hintStyle: const TextStyle(color: Colors.white30),
                          filled: true,
                          fillColor: const Color(0xFF0F151D),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                        ),
                        maxLines: 2,
                      ),
                    ],
                  ),
                ),
              ),
              const Divider(color: Colors.white12),
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      IconButton(
                        style: IconButton.styleFrom(backgroundColor: const Color(0xFF242F3D)),
                        icon: const Icon(Icons.remove, color: Colors.white),
                        onPressed: _qty > 1 ? () => setState(() => _qty--) : null,
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Text(
                          '$_qty',
                          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
                        ),
                      ),
                      IconButton(
                        style: IconButton.styleFrom(backgroundColor: const Color(0xFF242F3D)),
                        icon: const Icon(Icons.add, color: Colors.white),
                        onPressed: () => setState(() => _qty++),
                      ),
                    ],
                  ),
                  Text(
                    'đ$_totalPrice',
                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.extrabold, color: Color(0xFF2F7D6B)),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF2F7D6B),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                onPressed: () {
                  widget.onAdd(_selectedModifiers, _notesController.text.trim(), _qty);
                  Navigator.of(context).pop();
                },
                child: const Text('THÊM VÀO GIỎ HÀNG', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
