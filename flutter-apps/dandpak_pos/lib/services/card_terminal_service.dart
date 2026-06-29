import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

class CardTerminalService {
  static const _channel = MethodChannel('com.dandpak.pos/card_terminal');

  /// Requests card terminal payment.
  /// Returns a map of response fields mapping to `CONTRACT.md`.
  static Future<Map<String, dynamic>> charge({
    required double amount,
    required String reference,
    required String billNo,
    required String terminalName,
    required String mode, // 'auto', 'manual', 'mock', 'off'
  }) async {
    if (mode == 'mock') {
      await Future.delayed(const Duration(seconds: 1));
      return {
        'approved': true,
        'mode': 'mock',
        'txnId': 'MOCK${DateTime.now().millisecondsSinceEpoch}',
        'rrn': DateTime.now().millisecondsSinceEpoch.toString().substring(0, 12),
        'approval': (100000 + (DateTime.now().millisecond * 9)).toString(),
        'mask': '**** **** **** 9999',
        'scheme': 'VISA',
        'terminal': terminalName.isNotEmpty ? terminalName : 'MOCK-POS',
      };
    }

    if (mode == 'auto') {
      if (!kIsWeb && Platform.isAndroid) {
        try {
          final String resultJson = await _channel.invokeMethod('charge', {
            'amount': amount.toInt(),
            'reference': reference,
            'billNo': billNo,
            'terminalName': terminalName,
          });
          return jsonDecode(resultJson);
        } catch (e) {
          return {
            'approved': false,
            'error': 'Lỗi gọi POS-Link native: $e',
          };
        }
      } else {
        return {
          'approved': false,
          'error': 'Chế độ Tự động chỉ hỗ trợ trên thiết bị Android POS (A920). Vui lòng chuyển sang chế độ Thủ công.',
        };
      }
    }

    // manual / off
    return {
      'approved': false,
      'manual': true,
    };
  }
}
