import 'dart:io';
import 'dart:typed_data';

import 'package:excel/excel.dart' as xl;
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../../ui/app_theme.dart';
import '../../utils/translation.dart';

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
    return d == d.roundToDouble() ? d.round().toString() : d.toString();
  }
  if (v is xl.IntCellValue) return v.value.toString();
  return v.toString().trim();
}

/// Mở hộp thoại chọn file .xlsx và trả về các dòng (bỏ dòng tiêu đề nếu
/// [skipHeader]). Trả null nếu người dùng hủy; ném Exception nếu file hỏng.
Future<List<List<String>>?> kvPickSpreadsheetRows({
  bool skipHeader = true,
}) async {
  final picked = await FilePicker.platform.pickFiles(
    type: FileType.custom,
    allowedExtensions: ['xlsx'],
    withData: true,
  );
  if (picked == null || picked.files.isEmpty) return null;
  final f = picked.files.first;
  final bytes = f.bytes ?? await File(f.path!).readAsBytes();
  final book = xl.Excel.decodeBytes(bytes);
  if (book.tables.isEmpty) throw Exception(t('File không có sheet nào'));
  final sheet = book.tables[book.tables.keys.first]!;
  final rows = <List<String>>[];
  for (var r = skipHeader ? 1 : 0; r < sheet.maxRows; r++) {
    final cells = sheet.row(r).map(_cellText).toList();
    if (cells.every((c) => c.isEmpty)) continue;
    rows.add(cells);
  }
  return rows;
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
  switch (kind) {
    case KvTemplateKind.stocktake:
      fileName = 'MauFileKiemKho.xlsx';
      header = [
        'Mã hàng', 'Số lượng',
        'Lô 1', 'Hạn sử dụng 1', 'Số lượng 1',
        'Lô 2', 'Hạn sử dụng 2', 'Số lượng 2',
      ];
      examples = [
        ['00060', '', 'L001', '15/10/2026', '1', 'L002', '15/10/2027', '10'],
        ['00483', '5', '', '', '', '', '', ''],
      ];
      break;
    case KvTemplateKind.purchaseIn:
      fileName = 'MauFileNhapHang.xlsx';
      header = ['Mã hàng', 'Số lượng', 'Đơn giá', 'Lô', 'Hạn sử dụng'];
      examples = [
        ['00060', '24', '15000', 'L001', '15/10/2027'],
        ['00483', '10', '92000', '', ''],
      ];
      break;
    case KvTemplateKind.issue:
      fileName = 'MauFileXuatHang.xlsx';
      header = ['Mã hàng', 'Số lượng', 'Lô'];
      examples = [
        ['00060', '2', 'L001'],
        ['00483', '1', ''],
      ];
      break;
  }

  for (var c = 0; c < header.length; c++) {
    final cell = sheet.cell(
        xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: 0));
    cell.value = xl.TextCellValue(header[c]);
    cell.cellStyle = xl.CellStyle(bold: true);
  }
  for (var r = 0; r < examples.length; r++) {
    for (var c = 0; c < examples[r].length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(
              columnIndex: c, rowIndex: r + 1))
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
  final path = savePath.toLowerCase().endsWith('.xlsx')
      ? savePath
      : '$savePath.xlsx';
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
                  style:
                      TextStyle(fontSize: 12.5, color: DanColors.muted)),
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
                  style:
                      TextStyle(fontSize: 12.5, color: DanColors.muted)),
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
    final cell = sheet.cell(
        xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: 0));
    cell.value = xl.TextCellValue(header[c]);
    cell.cellStyle = xl.CellStyle(bold: true);
  }
  for (var r = 0; r < rows.length; r++) {
    for (var c = 0; c < rows[r].length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(
              columnIndex: c, rowIndex: r + 1))
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
  final path = savePath.toLowerCase().endsWith('.xlsx')
      ? savePath
      : '$savePath.xlsx';
  await File(path).writeAsBytes(bytes, flush: true);
  return true;
}
