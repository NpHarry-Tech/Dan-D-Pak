import 'dart:async';
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
    String? ip,
    int? port,
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
        // Desktop PC -> Socket TCP/IP over local LAN / USB Network Tethering
        final targetIp = (ip == null || ip.trim().isEmpty) ? '127.0.0.1' : ip.trim();
        final targetPort = port ?? 25000;

        try {
          final socket = await Socket.connect(targetIp, targetPort, timeout: const Duration(seconds: 10));
          
          final requestPayload = jsonEncode({
            'command': 'sale',
            'amount': amount.toInt(),
            'txnRef': reference,
            'billNo': billNo,
            'terminalName': terminalName,
          });
          
          socket.write('$requestPayload\n');
          await socket.flush();

          final completer = Completer<String>();
          final buffer = StringBuffer();
          
          final subscription = socket.listen(
            (data) {
              buffer.write(utf8.decode(data));
              final content = buffer.toString();
              // Check if json message is completed (contains closing bracket and newline)
              if (!completer.isCompleted &&
                  (content.contains('}') || content.contains('\n'))) {
                completer.complete(content);
              }
            },
            onError: (err) {
              if (!completer.isCompleted) completer.completeError(err);
            },
            onDone: () {
              if (!completer.isCompleted) {
                completer.complete(buffer.toString());
              }
            },
            cancelOnError: true,
          );

          final responseStr = await completer.future.timeout(const Duration(minutes: 3));
          await subscription.cancel();
          await socket.close();

          final cleanResponse = responseStr.trim();
          final Map<String, dynamic> respJson = jsonDecode(cleanResponse);

          final isSuccess = respJson['approved'] == true || 
                             respJson['responseCode'] == '00' || 
                             respJson['respCode'] == '00' ||
                             respJson['status'] == 'success';

          if (isSuccess) {
            return {
              'approved': true,
              'txnId': respJson['txnId'] ?? respJson['transactionId'] ?? 'POS${DateTime.now().millisecondsSinceEpoch}',
              'rrn': respJson['rrn'] ?? respJson['referenceNo'] ?? '',
              'approval': respJson['approval'] ?? respJson['approvalCode'] ?? '',
              'mask': respJson['mask'] ?? respJson['cardNo'] ?? respJson['cardNumber'] ?? '**** **** **** ****',
              'scheme': respJson['scheme'] ?? respJson['cardType'] ?? 'CARD',
              'terminal': respJson['terminal'] ?? terminalName,
            };
          } else {
            return {
              'approved': false,
              'error': respJson['error'] ?? respJson['message'] ?? respJson['responseMessage'] ?? 'Giao dịch bị từ chối hoặc thất bại.',
            };
          }
        } catch (e) {
          return {
            'approved': false,
            'error': 'Không thể kết nối đến thiết bị POS ($targetIp:$targetPort) qua USB/LAN. Vui lòng bật "Chia sẻ kết nối Internet qua USB" (USB Tethering) trên máy POS, hoặc kiểm tra địa chỉ IP cấu hình. Chi tiết lỗi: $e',
          };
        }
      }
    }

    // manual / off
    return {
      'approved': false,
      'manual': true,
    };
  }
}
