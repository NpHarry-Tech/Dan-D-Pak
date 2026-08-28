import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const screen = fs.readFileSync(
  new URL('../flutter-apps/dandpak_core/lib/src/screens/invoices/invoices_screen.dart', import.meta.url),
  'utf8',
);
const printer = fs.readFileSync(
  new URL('../flutter-apps/dandpak_core/lib/src/services/manual_document_print_service.dart', import.meta.url),
  'utf8',
);
const nativePrinter = fs.readFileSync(
  new URL('../flutter-apps/dandpak_desktop/windows/runner/windows_print_bridge.cpp', import.meta.url),
  'utf8',
);
const windowsManifest = fs.readFileSync(
  new URL('../flutter-apps/dandpak_desktop/windows/runner/runner.exe.manifest', import.meta.url),
  'utf8',
);

test('invoice screen views before printing and keeps manual print isolated', () => {
  assert.match(screen, /label: Text\(t\('Xem bill'\)\)/);
  assert.match(screen, /label: Text\(t\('Xem hóa đơn \(VAT\)'\)\)/);
  assert.doesNotMatch(screen, /reprintReceiptForOrder/);
  assert.match(printer, /MethodChannel\('dandpak\/windows_print'\)/);
  assert.match(nativePrinter, /PrintManager/);
  assert.match(nativePrinter, /PrintDocument/);
  assert.match(nativePrinter, /ShowPrintUIForWindowAsync/);
  assert.match(nativePrinter, /panel\.Measure\(/);
  assert.match(nativePrinter, /panel\.Arrange\(/);
  assert.match(nativePrinter, /panel\.UpdateLayout\(/);
  assert.match(windowsManifest, /<maxversiontested Id="10\.0\.19041\.0"\/>/);
  assert.doesNotMatch(nativePrinter, /PrintDlg(?:Ex)?|Print Setup/);
  assert.doesNotMatch(printer, /Printing\.raster|toPng|renderPageToBitmap|rasterizePdfPages/);
  assert.doesNotMatch(nativePrinter, /WriteableBitmap|IWICBitmap|png_pages|jpeg_pages/i);
  assert.doesNotMatch(nativePrinter, /\.png|\.jpe?g|RenderPageToBitmap/i);
  assert.doesNotMatch(printer, /local_print_agent|printOrderReceipt|K80|SUNMI/i);
  assert.match(printer, /stripReceiptControlTokens\(text\)/);
});

test('invoice presentation does not stringify raw promotion maps', () => {
  assert.match(screen, /promotionPresentation\(it\['promo'\]/);
  assert.doesNotMatch(screen, /\$\{_s\(it\['promo'\]\)\}/);
});
