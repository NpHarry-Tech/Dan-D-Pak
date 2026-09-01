import 'dart:convert';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:dandpak_core/src/screens/warehouse/kv_excel.dart';
import 'package:excel/excel.dart' as xl;
import 'package:flutter_test/flutter_test.dart';

Uint8List workbookWithLegacyCustomFormat() {
  final book = xl.Excel.createExcel();
  final sheet = book[book.getDefaultSheet()!];
  sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: 0)).value =
      xl.TextCellValue('Mã sản phẩm');
  sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: 1)).value =
      xl.TextCellValue('00060');
  final bytes = Uint8List.fromList(book.encode()!);
  final zip = ZipDecoder().decodeBytes(bytes);
  final styles = zip.findFile('xl/styles.xml')!;
  var xml = utf8.decode(styles.content as List<int>);
  final root = xml.indexOf('>', xml.indexOf('<styleSheet'));
  xml =
      '${xml.substring(0, root + 1)}<numFmts count="1"><numFmt numFmtId="43" formatCode="#,##0"/></numFmts>${xml.substring(root + 1)}';
  final repaired = Uint8List.fromList(utf8.encode(xml));
  zip.addFile(ArchiveFile('xl/styles.xml', repaired.length, repaired));
  return Uint8List.fromList(ZipEncoder().encode(zip)!);
}

void main() {
  test('đọc được XLSX Microsoft có custom numFmtId 43', () {
    final decoded = kvDecodeSpreadsheet(workbookWithLegacyCustomFormat());
    final sheet = decoded.tables.values.first;
    expect(
        sheet
            .cell(xl.CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: 1))
            .value
            .toString(),
        contains('00060'));
  });

  test('header lookup hỗ trợ mẫu mới và alias mẫu cũ', () {
    const data = KvSpreadsheetData(
      ['Mã sản phẩm', 'Mã vạch', 'Tên sản phẩm', 'Số lượng', 'Đơn giá nhập'],
      [],
    );
    expect(data.column(['Mã sản phẩm', 'Mã hàng']), 0);
    expect(data.column(['Số lượng', 'Quantity']), 3);
    expect(data.column(['Đơn giá nhập', 'Đơn giá']), 4);
  });
}
