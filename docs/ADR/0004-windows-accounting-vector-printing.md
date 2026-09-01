# ADR 0004: Windows accounting printing must preserve text and vector content

Status: Decision required before VAT print implementation

## Context

Dan D Pak is a Flutter Windows desktop application. Manual accounting printing
must use the modern Windows print experience while keeping receipt text and the
canonical VAT PDF at document quality. A page-sized bitmap is not an acceptable
print source. WebView2 and the legacy Win32 `PrintDlg` family are also excluded.

## Audited Windows contracts

- `PrintManagerInterop.GetForWindow(HWND)` and
  `ShowPrintUIForWindowAsync(HWND)` provide the modern Windows print UI.
- `Windows.UI.Xaml.Printing.PrintDocument` implements `IPrintDocumentSource`.
  Its `Paginate`, `GetPreviewPage`, and `AddPages` lifecycle serializes XAML text
  and vector elements into the Windows print package.
- `Windows.Data.Pdf.PdfDocument` is a display renderer. Its page API renders to
  a stream/surface; it does not expose the canonical PDF as a printable
  `IPrintDocumentSource`.
- `IPrintDocumentPackageTarget` accepts XPS/OpenXPS package targets for general
  Windows printers. It is not a general raw-PDF package target.
- PDF PDL passthrough exists only for compatible IPP printers on newer Windows
  releases. It cannot be the sole implementation for the installed-printer
  fleet.
- The bundled PDFium API can render a PDF page to a printer HDC, but that is a
  different GDI submission path and does not provide the required general
  `PrintManager` document-source pipeline.

## Accepted Bill representation

- Source document: semantic receipt model (text, rules, spacing, optional
  barcode/QR asset only where the asset is intrinsically raster).
- Preview representation: XAML text/vector page elements owned by the native
  print bridge.
- Print submission: the same text/vector `PrintDocument` pages, serialized by
  Windows to its print package. No page bitmap.
- Printer pipeline: `PrintManagerInterop` -> `PrintDocument` -> Windows print
  package -> selected printer.

## VAT decision boundary

The VAT source remains the exact canonical PDF bytes. Screen preview may use a
display renderer, but its bitmap output must never be reused for submission.

To support the complete installed-printer fleet through the same modern UI, a
backend must convert PDF page operators, fonts, and paths into XPS/OpenXPS (or
implement an equivalent vector `IPrintDocumentSource`). Windows does not ship a
general PDF-to-XPS conversion API. Selecting a third-party converter changes
licensing and distribution obligations:

- MuPDF/Ghostscript: AGPL unless a suitable commercial licence is obtained.
- Commercial PDF SDK: requires owner selection, licence, and redistribution
  approval.
- PDF PDL passthrough: valid optional fast path only after capability detection;
  not a general fallback.

No raster fallback is permitted. VAT printing remains blocked until a
redistributable vector PDF backend is selected and licensed.

## Enforced non-decisions

- No `Printing.raster`, page `toPng`, WIC page bitmap, PNG/JPEG intermediary, or
  PDF page screenshot may feed print submission.
- No WebView2 print workaround.
- No `PrintDlg`/`PrintDlgEx` primary flow.
- Preview representation must remain independent from submission quality.

