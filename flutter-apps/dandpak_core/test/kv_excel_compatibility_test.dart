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

  test('golden XLSX keeps reported SKUs and maps reordered columns by header',
      () {
    final book = xl.Excel.createExcel();
    final sheet = book[book.getDefaultSheet()!];
    const headers = ['Đơn giá nhập', 'Mã sản phẩm', 'Số lượng', 'Mã vạch'];
    for (var c = 0; c < headers.length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: 0))
          .value = xl.TextCellValue(headers[c]);
    }
    for (var r = 0; r < 3; r++) {
      final code = ['91120090', '91080092', '91010579'][r];
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: r + 1))
          .value = xl.IntCellValue(15000 + r);
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: 1, rowIndex: r + 1))
          .value = xl.TextCellValue(code);
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: 2, rowIndex: r + 1))
          .value = const xl.IntCellValue(2);
    }
    final bytes = Uint8List.fromList(book.encode()!);
    final data = kvSpreadsheetDataFromBytes(bytes, 'golden-reported-skus.xlsx');
    data.validateHeaders();
    expect(data.column(['Mã sản phẩm']), 1);
    expect(data.column(['Đơn giá nhập']), 0);
    expect(data.rows.map((row) => data.cell(row, ['Mã sản phẩm'])).toList(),
        ['91120090', '91080092', '91010579']);
    expect(
        data.numberCell(data.rows.first, 0, ['Đơn giá nhập'], target: 'cost'),
        15000);
  });

  test(
      'numeric identifier format preserves leading zero; literal formula is read',
      () {
    final book = xl.Excel.createExcel();
    final sheet = book[book.getDefaultSheet()!];
    sheet
        .cell(xl.CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: 0))
        .value = xl.TextCellValue('Mã sản phẩm');
    final code =
        sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: 1));
    code.value = const xl.IntCellValue(60);
    code.cellStyle = xl.CellStyle(
      numberFormat: const xl.CustomNumericNumFormat(formatCode: '00000'),
    );
    sheet
        .cell(xl.CellIndex.indexByColumnRow(columnIndex: 1, rowIndex: 0))
        .value = xl.TextCellValue('Số lượng');
    sheet
        .cell(xl.CellIndex.indexByColumnRow(columnIndex: 1, rowIndex: 1))
        .value = const xl.FormulaCellValue('2');
    final data = kvSpreadsheetDataFromBytes(
        Uint8List.fromList(book.encode()!), 'typed.xlsx');
    expect(data.rows.single[0], '00060');
    expect(
        data.numberCell(data.rows.single, 0, ['Số lượng'], target: 'qty'), 2);
  });

  test('CSV supports quotes/leading zero/vi-US locale and mapping preview', () {
    final bytes = Uint8List.fromList(utf8.encode(
        'Số lượng;Mã sản phẩm;Đơn giá nhập\r\n"1,5";00060;"1.234,56"\r\n'));
    final data = kvSpreadsheetDataFromBytes(bytes, 'import.csv');
    expect(data.cell(data.rows.single, ['Mã sản phẩm']), '00060');
    expect(
        data.numberCell(data.rows.single, 0, ['Số lượng'], target: 'qty'), 1.5);
    expect(
        data.numberCell(data.rows.single, 0, ['Đơn giá nhập'], target: 'cost'),
        1234.56);
    expect(
        data.previewMapping({
          'sku': ['Mã sản phẩm']
        }).single,
        {'target': 'sku', 'source_column': 'Mã sản phẩm', 'source_index': 2});
  });

  test('duplicate/missing headers and bad cells fail with exact location/value',
      () {
    const duplicate = KvSpreadsheetData([
      'Mã hàng',
      'Mã hàng',
      'Số lượng'
    ], [
      ['A', 'B', 'x']
    ]);
    expect(
        duplicate.validateHeaders,
        throwsA(
            predicate((e) => '$e'.contains('cột 1') && '$e'.contains('và 2'))));
    const missing = KvSpreadsheetData([
      'Tên'
    ], [
      ['A']
    ]);
    expect(() => missing.requireColumn(['Số lượng'], target: 'Số lượng'),
        throwsA(predicate((e) => '$e'.contains('Thiếu cột'))));
    const bad = KvSpreadsheetData([
      'Mã hàng',
      'Số lượng'
    ], [
      ['A', 'not-a-number']
    ]);
    expect(
        () => bad.numberCell(bad.rows.first, 0, ['Số lượng'], target: 'qty'),
        throwsA(predicate((e) =>
            '$e'.contains('Dòng 2') &&
            '$e'.contains('cột 2') &&
            '$e'.contains('not-a-number'))));
  });
}
