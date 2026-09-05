import 'dart:io';
import 'dart:convert';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:excel/excel.dart' as xl;
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../services/api_service.dart';
import '../../ui/app_theme.dart';
import '../../utils/translation.dart';
import 'kv_shared.dart';

/// Đọc/ghi Excel cho các phiếu Kho (Kiểm kho / Nhập hàng / Xuất hàng):
///   - [kvPickSpreadsheetRows]  : nút "Chọn file dữ liệu" — đọc .xlsx thành
///     bảng chuỗi (sheet đầu), ô ngày trả về dd/MM/yyyy.
///   - [kvSaveTemplate]         : link "Tải về file mẫu" — sinh .xlsx mẫu.
///
/// LƯU Ý số: giá trị số đọc ra dùng toString() thuần (không phân cách nghìn)
/// để parse lại bằng kvParseNum — xem gotcha Fmt.int0 trong kv_shared.dart.

String _cellText(xl.Data? cell) {
  final v = cell?.value;
  if (v == null) return '';
  if (v is xl.DateCellValue) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(v.day)}/${two(v.month)}/${v.year}';
  }
  if (v is xl.DateTimeCellValue) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(v.day)}/${two(v.month)}/${v.year}';
  }
  if (v is xl.DoubleCellValue) {
    final d = v.value;
    return d == d.roundToDouble()
        ? _formattedInteger(cell!, d.round())
        : d.toString();
  }
  if (v is xl.IntCellValue) return _formattedInteger(cell!, v.value);
  if (v is xl.FormulaCellValue) {
    final formula = v.formula.trim().replaceFirst(RegExp(r'^='), '');
    final quoted = RegExp(r'^"(.*)"$').firstMatch(formula);
    if (quoted != null) return quoted.group(1)!;
    if (num.tryParse(formula) != null) return formula;
    return '=$formula';
  }
  return v.toString().trim();
}

String _formattedInteger(xl.Data cell, int value) {
  final format = cell.cellStyle?.numberFormat.formatCode ?? '';
  if (RegExp(r'^0+$').hasMatch(format)) {
    return value.toString().padLeft(format.length, '0');
  }
  return value.toString();
}

/// Microsoft Excel đôi khi ghi một custom numFmt với ID built-in (ví dụ 43).
/// excel ^4.0.6 ném lỗi dù workbook vẫn hợp lệ với Excel. Chỉ khi gặp đúng lỗi
/// này ta ánh xạ các declaration đó sang vùng custom >=164 và cập nhật mọi
/// reference trong styles.xml; dữ liệu/sheet/công thức không bị thay đổi.
Uint8List _repairLegacyNumberFormats(Uint8List bytes) {
  final zip = ZipDecoder().decodeBytes(bytes, verify: true);
  final styles = zip.findFile('xl/styles.xml');
  if (styles == null) return bytes;
  var xml = utf8.decode(styles.content as List<int>);
  final declarations = RegExp(r'<numFmt\b[^>]*\bnumFmtId="(\d+)"[^>]*/?>')
      .allMatches(xml)
      .map((m) => int.tryParse(m.group(1)!))
      .whereType<int>()
      .where((id) => id < 164)
      .toSet()
      .toList()
    ..sort();
  if (declarations.isEmpty) return bytes;
  var next = 164;
  final used = RegExp(r'numFmtId="(\d+)"')
      .allMatches(xml)
      .map((m) => int.tryParse(m.group(1)!))
      .whereType<int>()
      .toSet();
  for (final old in declarations) {
    while (used.contains(next)) next++;
    xml = xml.replaceAll('numFmtId="$old"', 'numFmtId="$next"');
    used.add(next++);
  }
  final repaired = Uint8List.fromList(utf8.encode(xml));
  zip.addFile(ArchiveFile('xl/styles.xml', repaired.length, repaired));
  return Uint8List.fromList(ZipEncoder().encode(zip)!);
}

xl.Excel kvDecodeSpreadsheet(Uint8List bytes) {
  try {
    return xl.Excel.decodeBytes(bytes);
  } catch (error) {
    if (!error.toString().contains('custom numFmtId starts at 164')) rethrow;
    return xl.Excel.decodeBytes(_repairLegacyNumberFormats(bytes));
  }
}

class KvSpreadsheetData {
  final List<String> headers;
  final List<List<String>> rows;
  // File GỐC được chọn — giữ lại để LƯU vào kho Tài liệu (không bỏ đi sau khi parse).
  final String fileName;
  final Uint8List? bytes;
  const KvSpreadsheetData(this.headers, this.rows,
      {this.fileName = '', this.bytes});

  int column(List<String> aliases) {
    final wanted = aliases.map(kvNormalizeHeader).toSet();
    return headers.indexWhere((h) => wanted.contains(kvNormalizeHeader(h)));
  }

  List<int> columns(List<String> aliases) {
    final wanted = aliases.map(kvNormalizeHeader).toSet();
    return [
      for (var i = 0; i < headers.length; i++)
        if (wanted.contains(kvNormalizeHeader(headers[i]))) i,
    ];
  }

  void validateHeaders() {
    final seen = <String, int>{};
    for (var index = 0; index < headers.length; index++) {
      final normalized = kvNormalizeHeader(headers[index]);
      if (normalized.isEmpty) continue;
      final previous = seen[normalized];
      if (previous != null) {
        throw KvImportException(
            'Trùng tiêu đề cột "${headers[index]}" tại cột ${previous + 1} và ${index + 1}.');
      }
      seen[normalized] = index;
    }
  }

  int requireColumn(List<String> aliases, {required String target}) {
    final matches = columns(aliases);
    if (matches.isEmpty) {
      throw KvImportException(
          'Thiếu cột bắt buộc "$target" (chấp nhận: ${aliases.join(', ')}).');
    }
    if (matches.length > 1) {
      throw KvImportException(
          'Nhiều cột cùng ánh xạ vào "$target": ${matches.map((i) => '${headers[i]} [cột ${i + 1}]').join(', ')}.');
    }
    return matches.single;
  }

  void requireAny(List<List<String>> groups, {required String target}) {
    for (final aliases in groups) {
      final matches = columns(aliases);
      if (matches.length > 1) {
        throw KvImportException(
            'Nhiều cột cùng ánh xạ vào "$target": ${matches.map((i) => '${headers[i]} [cột ${i + 1}]').join(', ')}.');
      }
    }
    if (!groups.any((aliases) => columns(aliases).isNotEmpty)) {
      throw KvImportException(
          'Thiếu định danh "$target"; cần ít nhất một cột mã sản phẩm hoặc mã vạch.');
    }
  }

  String cell(List<String> row, List<String> aliases, {int fallback = -1}) {
    final index = column(aliases);
    final resolved = index >= 0 ? index : fallback;
    return resolved >= 0 && resolved < row.length ? row[resolved].trim() : '';
  }

  num numberCell(List<String> row, int rowIndex, List<String> aliases,
      {required String target, bool required = true}) {
    final columnIndex = requireColumn(aliases, target: target);
    final raw = columnIndex < row.length ? row[columnIndex].trim() : '';
    final parsed = kvParseNum(raw);
    if (parsed == null) {
      if (!required && raw.isEmpty) return 0;
      throw KvImportException(
          'Dòng ${rowIndex + 2}, cột ${columnIndex + 1} (${headers[columnIndex]}), giá trị "$raw": không phải số hợp lệ.');
    }
    return parsed;
  }

  List<Map<String, Object>> previewMapping(Map<String, List<String>> schema) =>
      [
        for (final entry in schema.entries)
          {
            'target': entry.key,
            'source_column':
                column(entry.value) < 0 ? '' : headers[column(entry.value)],
            'source_index':
                column(entry.value) < 0 ? -1 : column(entry.value) + 1,
          }
      ];
}

class KvImportException implements Exception {
  final String message;
  const KvImportException(this.message);
  @override
  String toString() => message;
}

String kvNormalizeHeader(String value) => value
    .toLowerCase()
    .trim()
    .replaceAll(RegExp(r'[^a-z0-9à-ỹ]+', unicode: true), ' ')
    .replaceAll(RegExp(r'\s+'), ' ');

List<List<String>> _parseDelimited(String text) {
  final first = text
      .split(RegExp(r'\r?\n'))
      .firstWhere((line) => line.trim().isNotEmpty, orElse: () => '');
  final delimiter = first.contains('\t')
      ? '\t'
      : (','.allMatches(first).length >= ';'.allMatches(first).length
          ? ','
          : ';');
  final rows = <List<String>>[];
  var row = <String>[];
  var field = StringBuffer();
  var quoted = false;
  for (var i = 0; i < text.length; i++) {
    final char = text[i];
    if (char == '"') {
      if (quoted && i + 1 < text.length && text[i + 1] == '"') {
        field.write('"');
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && char == delimiter) {
      row.add(field.toString());
      field = StringBuffer();
    } else if (!quoted && (char == '\n' || char == '\r')) {
      if (char == '\r' && i + 1 < text.length && text[i + 1] == '\n') i++;
      row.add(field.toString());
      field = StringBuffer();
      if (row.any((value) => value.trim().isNotEmpty)) rows.add(row);
      row = <String>[];
    } else {
      field.write(char);
    }
  }
  if (quoted) throw const KvImportException('CSV có dấu nháy kép chưa đóng.');
  row.add(field.toString());
  if (row.any((value) => value.trim().isNotEmpty)) rows.add(row);
  return rows;
}

KvSpreadsheetData kvSpreadsheetDataFromBytes(Uint8List bytes, String fileName) {
  if (fileName.toLowerCase().endsWith('.csv')) {
    final table = _parseDelimited(utf8.decode(bytes, allowMalformed: false));
    if (table.isEmpty) {
      throw const KvImportException('File CSV không có dữ liệu.');
    }
    return KvSpreadsheetData(
      table.first.map((value) => value.trim()).toList(),
      table
          .skip(1)
          .map((row) => row.map((value) => value.trim()).toList())
          .toList(),
      fileName: fileName,
      bytes: bytes,
    );
  }
  final book = kvDecodeSpreadsheet(bytes);
  if (book.tables.isEmpty) {
    throw KvImportException(t('File không có sheet nào'));
  }
  final sheet = book.tables[book.tables.keys.first]!;
  final headers =
      sheet.maxRows == 0 ? <String>[] : sheet.row(0).map(_cellText).toList();
  final rows = <List<String>>[];
  for (var r = 1; r < sheet.maxRows; r++) {
    final cells = sheet.row(r).map(_cellText).toList();
    if (!cells.every((cell) => cell.isEmpty)) rows.add(cells);
  }
  return KvSpreadsheetData(headers, rows, fileName: fileName, bytes: bytes);
}

Future<KvSpreadsheetData?> kvPickSpreadsheetData() async {
  final picked = await FilePicker.platform.pickFiles(
    type: FileType.custom,
    allowedExtensions: ['xlsx', 'csv'],
    withData: true,
  );
  if (picked == null || picked.files.isEmpty) return null;
  final f = picked.files.first;
  final bytes = f.bytes ?? await File(f.path!).readAsBytes();
  final raw = Uint8List.fromList(bytes);
  final data = kvSpreadsheetDataFromBytes(raw, f.name);
  data.validateHeaders();
  return data;
}

/// LƯU file import GỐC vào kho Tài liệu (DMS) bằng quyền tối thiểu của nhân viên
/// Kho — BẮT BUỘC thành công thì luồng import mới được chạy. NÉM lỗi khi không đọc
/// được bytes hoặc upload thất bại (caller PHẢI dừng import, không đổi dữ liệu Kho).
/// Idempotent theo nội dung: gửi lại cùng file trả bản ghi cũ (không tạo trùng).
Future<Map<String, dynamic>> kvArchiveImportFile(
  ApiService api,
  KvSpreadsheetData data, {
  required String sourceScreen,
}) async {
  final raw = data.bytes;
  if (raw == null || raw.isEmpty) {
    throw Exception(t('Không đọc được file để lưu vào Tài liệu'));
  }
  final xlsxMime = data.fileName.toLowerCase().endsWith('.csv')
      ? 'text/csv'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return api.importUploadDocument(
    dataBase64: base64Encode(raw),
    originalName: data.fileName.isEmpty ? 'import.xlsx' : data.fileName,
    mimeType: xlsxMime,
    sourceScreen: sourceScreen,
  );
}

/// Orchestration BẮT BUỘC: lưu file gốc TRƯỚC, chỉ khi thành công mới chạy
/// [runImport] (thao tác đổi dữ liệu Kho). Archive lỗi → NÉM và [runImport] TUYỆT
/// ĐỐI KHÔNG được gọi (dữ liệu Kho không đổi). Đây là chốt fail-closed dùng chung
/// cho cả ba màn nhập (kiểm kho / nhập hàng / xuất kho).
Future<void> kvArchiveThenImport(
  ApiService api,
  KvSpreadsheetData data, {
  required String sourceScreen,
  required Future<void> Function() runImport,
  Set<String>? completedArchiveIds,
}) async {
  final archived = await kvArchiveImportFile(api, data,
      sourceScreen: sourceScreen); // throws => runImport skipped
  final archiveId = '${archived['id'] ?? archived['document_id'] ?? ''}';
  if (archiveId.isNotEmpty &&
      completedArchiveIds?.contains(archiveId) == true) {
    return;
  }
  await runImport();
  if (archiveId.isNotEmpty) completedArchiveIds?.add(archiveId);
}

/// Mở hộp thoại chọn file .xlsx và trả về các dòng (bỏ dòng tiêu đề nếu
/// [skipHeader]). Trả null nếu người dùng hủy; ném Exception nếu file hỏng.
Future<List<List<String>>?> kvPickSpreadsheetRows({
  bool skipHeader = true,
}) async {
  final data = await kvPickSpreadsheetData();
  if (data == null) return null;
  return skipHeader ? data.rows : [data.headers, ...data.rows];
}

/// Loại file mẫu — cùng khung "Mã hàng + Số lượng", khác cột phụ.
enum KvTemplateKind { stocktake, purchaseIn, issue }

/// Sinh file mẫu .xlsx và cho người dùng lưu (desktop: hộp thoại Save;
/// Android/iOS: chia sẻ qua share sheet vì không có Save dialog).
Future<bool> kvSaveTemplate(BuildContext context, KvTemplateKind kind) async {
  final book = xl.Excel.createExcel();
  final sheet = book[book.getDefaultSheet()!];

  List<String> header;
  List<List<String>> examples;
  String fileName;
  var dynamicPriceBooks = <Map<String, dynamic>>[];
  if (kind == KvTemplateKind.purchaseIn) {
    try {
      dynamicPriceBooks = (await context.read<ApiService>().getPriceBooks())
          .whereType<Map>()
          .map((x) => Map<String, dynamic>.from(x))
          .where((x) => '${x['id']}' != 'default')
          .toList();
    } catch (_) {
      // Mẫu vẫn tải được offline; giá chung luôn có mặt.
    }
  }
  switch (kind) {
    case KvTemplateKind.stocktake:
      fileName = 'MauFileKiemKho.xlsx';
      header = [
        'Mã sản phẩm',
        'Mã vạch',
        'Tên sản phẩm',
        'Thương hiệu',
        'Phân loại',
        'ĐVT',
        'Số lượng thực tế',
        'Lô 1',
        'Hạn sử dụng 1',
        'Số lượng 1',
        'Lô 2',
        'Hạn sử dụng 2',
        'Số lượng 2',
      ];
      examples = [
        [
          '00060',
          '8930000000060',
          'Tên sản phẩm mẫu',
          'Dan-D Pak',
          'Hạt',
          'Gói',
          '',
          'L001',
          '15/10/2026',
          '1',
          'L002',
          '15/10/2027',
          '10'
        ],
        [
          '00483',
          '',
          'Sản phẩm không theo lô',
          '',
          'Khác',
          'Cái',
          '5',
          '',
          '',
          '',
          '',
          '',
          ''
        ],
      ];
      break;
    case KvTemplateKind.purchaseIn:
      fileName = 'MauFileNhapHang.xlsx';
      header = [
        'Mã sản phẩm',
        'Mã vạch',
        'Tên sản phẩm',
        'Thương hiệu',
        'Phân loại',
        'ĐVT',
        'Số lượng',
        'Đơn giá nhập',
        'Giá bán mặc định',
        'Giá bán trước VAT',
        'VAT (%)',
        // Đây là giá riêng của một BẢNG GIÁ, không phải giá mặc định thứ hai.
        // Ghi rõ để tên bảng giá kiểu "Giá bán" hoặc trùng tên chi nhánh không
        // tạo ra cột mơ hồ cạnh "Giá bán mặc định".
        for (final book in dynamicPriceBooks)
          'Giá theo bảng giá — ${book['name']}',
        'Lô',
        'Ngày sản xuất',
        'Hạn sử dụng',
      ];
      examples = [
        [
          '00060',
          '8930000000060',
          'Tên sản phẩm mẫu',
          'Dan-D Pak',
          'Hạt dinh dưỡng',
          'Gói',
          '24',
          '15000',
          '30000',
          '27778',
          '8',
          for (final _ in dynamicPriceBooks) '30000',
          'L001',
          '15/10/2026',
          '15/10/2027'
        ],
        [
          '00483',
          '',
          'Sản phẩm không theo lô',
          '',
          'Khác',
          'Cái',
          '10',
          '92000',
          '120000',
          '111111',
          '8',
          for (final _ in dynamicPriceBooks) '120000',
          '',
          '',
          ''
        ],
      ];
      break;
    case KvTemplateKind.issue:
      fileName = 'MauFileXuatHang.xlsx';
      header = [
        'Mã sản phẩm',
        'Mã vạch',
        'Tên sản phẩm',
        'Thương hiệu',
        'Phân loại',
        'ĐVT',
        'Số lượng',
        'Lô',
        'Hạn sử dụng'
      ];
      examples = [
        [
          '00060',
          '8930000000060',
          'Tên sản phẩm mẫu',
          'Dan-D Pak',
          'Hạt',
          'Gói',
          '2',
          'L001',
          '15/10/2027'
        ],
        ['00483', '', 'Sản phẩm không theo lô', '', 'Khác', 'Cái', '1', '', ''],
      ];
      break;
  }

  for (var c = 0; c < header.length; c++) {
    final cell =
        sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: 0));
    cell.value = xl.TextCellValue(header[c]);
    cell.cellStyle = xl.CellStyle(bold: true);
  }
  for (var r = 0; r < examples.length; r++) {
    for (var c = 0; c < examples[r].length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: r + 1))
          .value = xl.TextCellValue(examples[r][c]);
    }
  }

  final bytes = Uint8List.fromList(book.encode()!);
  if (Platform.isAndroid || Platform.isIOS) {
    final dir = Directory.systemTemp;
    final f = File('${dir.path}/$fileName');
    await f.writeAsBytes(bytes, flush: true);
    await Share.shareXFiles([XFile(f.path)], text: fileName);
    return true;
  }
  final savePath = await FilePicker.platform.saveFile(
    dialogTitle: t('Lưu file mẫu'),
    fileName: fileName,
    type: FileType.custom,
    allowedExtensions: ['xlsx'],
  );
  if (savePath == null) return false;
  final path =
      savePath.toLowerCase().endsWith('.xlsx') ? savePath : '$savePath.xlsx';
  await File(path).writeAsBytes(bytes, flush: true);
  return true;
}

/// Empty-state kiểu KiotViet giữa bảng dòng hàng: "Thêm sản phẩm từ file
/// excel" + link tải file mẫu + nút [Chọn file dữ liệu].
class KvExcelEmptyImport extends StatelessWidget {
  final String message;
  final KvTemplateKind templateKind;
  final VoidCallback onPick;
  const KvExcelEmptyImport({
    super.key,
    required this.message,
    required this.templateKind,
    required this.onPick,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message,
              style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  color: DanColors.text)),
          SizedBox(height: 6),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('(${t('Tải về file mẫu')}: ',
                  style: TextStyle(fontSize: 12.5, color: DanColors.muted)),
              InkWell(
                onTap: () async {
                  final saved = await kvSaveTemplate(context, templateKind);
                  if (saved && context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                        content: Text(t('Đã lưu file mẫu')),
                        backgroundColor: DanColors.text));
                  }
                },
                child: Text('Excel file',
                    style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w800,
                        color: DanColors.brand,
                        decoration: TextDecoration.underline,
                        decorationColor: DanColors.brand)),
              ),
              Text(')',
                  style: TextStyle(fontSize: 12.5, color: DanColors.muted)),
            ],
          ),
          SizedBox(height: 16),
          FilledButton.icon(
            onPressed: onPick,
            icon: Icon(Icons.file_copy_outlined, size: 18),
            label: Text(t('Chọn file dữ liệu')),
            style: FilledButton.styleFrom(
                minimumSize: Size(0, 44),
                padding: EdgeInsets.symmetric(horizontal: 22)),
          ),
          SizedBox(height: 10),
          Text(t('Hoặc tìm hàng hóa phía trên để thêm từng dòng'),
              style: TextStyle(fontSize: 12, color: DanColors.faint)),
        ],
      ),
    );
  }
}

/// Xuất danh sách bất kỳ ra .xlsx (nút "Xuất file" trên list phiếu).
Future<bool> kvExportXlsx(
  BuildContext context, {
  required String fileName,
  required List<String> header,
  required List<List<String>> rows,
}) async {
  final book = xl.Excel.createExcel();
  final sheet = book[book.getDefaultSheet()!];
  for (var c = 0; c < header.length; c++) {
    final cell =
        sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: 0));
    cell.value = xl.TextCellValue(header[c]);
    cell.cellStyle = xl.CellStyle(bold: true);
  }
  for (var r = 0; r < rows.length; r++) {
    for (var c = 0; c < rows[r].length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: r + 1))
          .value = xl.TextCellValue(rows[r][c]);
    }
  }
  final bytes = Uint8List.fromList(book.encode()!);
  if (Platform.isAndroid || Platform.isIOS) {
    final f = File('${Directory.systemTemp.path}/$fileName');
    await f.writeAsBytes(bytes, flush: true);
    await Share.shareXFiles([XFile(f.path)], text: fileName);
    return true;
  }
  final savePath = await FilePicker.platform.saveFile(
    dialogTitle: t('Xuất file'),
    fileName: fileName,
    type: FileType.custom,
    allowedExtensions: ['xlsx'],
  );
  if (savePath == null) return false;
  final path =
      savePath.toLowerCase().endsWith('.xlsx') ? savePath : '$savePath.xlsx';
  await File(path).writeAsBytes(bytes, flush: true);
  return true;
}
