// lib/services/discovery_service.dart
import 'dart:async';
import 'dart:io';
import 'package:http/http.dart' as http;

class DiscoveryService {
  /// Scans the local network Class-C subnets for an active server on port 3000.
  /// Fires updates to `onProgress` with the currently scanned IP and notifies when found.
  static Future<String?> discoverServer({
    required Function(String currentIp) onProgress,
    Duration timeout = const Duration(milliseconds: 400),
  }) async {
    // 1. Get local subnets
    final List<String> subnets = [];
    try {
      final interfaces = await NetworkInterface.list(
        type: InternetAddressType.IPv4,
        includeLoopback: false,
        includeLinkLocal: false,
      );
      for (var interface in interfaces) {
        for (var addr in interface.addresses) {
          final ip = addr.address;
          final parts = ip.split('.');
          if (parts.length == 4) {
            subnets.add('${parts[0]}.${parts[1]}.${parts[2]}');
          }
        }
      }
    } catch (_) {}

    // Fallback standard subnets
    if (subnets.isEmpty) {
      subnets.addAll(['192.168.1', '192.168.0', '192.168.100', '10.0.0']);
    }

    final uniqueSubnets = subnets.toSet().toList();

    // 2. Scan each subnet concurrently in batches
    for (final subnet in uniqueSubnets) {
      const batchSize = 30;
      for (int i = 1; i <= 254; i += batchSize) {
        final List<Future<String?>> pingFutures = [];
        final end = (i + batchSize < 255) ? i + batchSize : 255;
        
        for (int host = i; host < end; host++) {
          final targetIp = '$subnet.$host';
          pingFutures.add(_pingIp(targetIp, timeout, onProgress));
        }

        final results = await Future.wait(pingFutures);
        for (final res in results) {
          if (res != null) {
            return res; // Server found!
          }
        }
      }
    }

    // Try localhost fallback
    onProgress('127.0.0.1');
    final localhostResult = await _pingIp('127.0.0.1', const Duration(seconds: 1), onProgress);
    if (localhostResult != null) return localhostResult;

    return null; // Not found
  }

  static Future<String?> _pingIp(
    String ip,
    Duration timeout,
    Function(String currentIp) onProgress,
  ) async {
    onProgress(ip);
    final targetUrl = 'http://$ip:3000';
    try {
      // Connect check using raw socket is faster than HTTP request
      final socket = await Socket.connect(ip, 3000, timeout: timeout);
      socket.destroy();

      // If TCP port is open, double check with a quick HTTP API request
      final res = await http.get(Uri.parse('$targetUrl/api/branches')).timeout(const Duration(seconds: 1));
      if (res.statusCode == 200) {
        return targetUrl;
      }
    } catch (_) {
      // Ignore errors (timeouts, connection refused)
    }
    return null;
  }
}
