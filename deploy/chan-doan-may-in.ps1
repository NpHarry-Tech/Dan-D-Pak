# ============================================================
# CHẨN ĐOÁN MÁY IN NHIỆT — chạy trên MÁY POS đang bị lỗi in.
#
# Vì sao cần script này: khi phiếu ra mờ và hẹp, có đúng HAI khả năng và không
# nhìn tờ giấy mà đoán được là cái nào:
#   (A) App vẫn in qua DRIVER Windows (Out-Printer). Driver vẽ chữ thành ảnh xám
#       khử răng cưa rồi máy in rải hạt ảnh đó ra -> chữ to, mờ, co thành cột hẹp.
#   (B) Bản thân MÁY IN đang ở chế độ phóng to / khổ giấy sai trong firmware.
#
# Script này gửi NGUYÊN BYTE ESC/POS thẳng xuống spooler (datatype RAW), không
# qua driver. Nên:
#   - Nếu tờ giấy ra ĐẸP (chữ nhỏ, đen, trải hết bề ngang) -> lỗi là (A):
#     máy POS vẫn chạy agent CŨ, cần cài lại và tắt agent cũ trước.
#   - Nếu tờ giấy vẫn MỜ/HẸP -> lỗi là (B): phải chỉnh DIP switch hoặc chạy
#     tiện ích cấu hình của hãng máy in, phần mềm không sửa được.
#
# Dùng:
#   powershell -ExecutionPolicy Bypass -File deploy\chan-doan-may-in.ps1
#   powershell -ExecutionPolicy Bypass -File deploy\chan-doan-may-in.ps1 -Printer "POS-80C"
# ============================================================
param([string]$Printer = '')

$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host '=== 1. AGENT DANG CHAY LA BAN NAO ===' -ForegroundColor Cyan
$agent = Get-Process -Name 'dandpak-agent' -ErrorAction SilentlyContinue
if ($agent) {
  foreach ($a in $agent) {
    $path = try { $a.Path } catch { '(khong doc duoc duong dan)' }
    Write-Host ("  PID {0}  {1}" -f $a.Id, $path)
    if ($path -and (Test-Path $path)) {
      $f = Get-Item $path
      Write-Host ("  Ngay file : {0}   Kich thuoc: {1} MB" -f $f.LastWriteTime, [math]::Round($f.Length/1MB,1))
      Write-Host '  >> Ngay file PHAI la ngay ban vua cai. Neu la ngay cu => agent CHUA duoc thay,' -ForegroundColor Yellow
      Write-Host '     file bi khoa luc cai. Tat agent roi cai lai (xem muc 4 cuoi script).' -ForegroundColor Yellow
    }
  }
} else {
  Write-Host '  Khong thay tien trinh dandpak-agent nao dang chay.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '=== 2. MAY IN CO TREN MAY NAY ===' -ForegroundColor Cyan
$all = Get-CimInstance Win32_Printer | Select-Object Name, DriverName, PortName, Default
$all | Format-Table -AutoSize | Out-String | Write-Host

if (-not $Printer) {
  $def = $all | Where-Object { $_.Default } | Select-Object -First 1
  if ($def) { $Printer = $def.Name }
}
if (-not $Printer) { throw 'Khong xac dinh duoc may in. Chay lai kem -Printer "<ten may in>".' }
Write-Host ("  May in se in thu: {0}" -f $Printer) -ForegroundColor Green

# ── Dung phieu chan doan bang ESC/POS thuan ────────────────────────────────
$ESC = [char]27; $GS = [char]29
$sb = New-Object System.Text.StringBuilder

# Reset triet de: khoi tao + font A + co chu 1x1 + canh trai + gian dong mac dinh
[void]$sb.Append("$ESC@")            # ESC @  khoi tao
[void]$sb.Append("$ESC!" + [char]0)  # ESC !  0 = font A, khong nhan doi
[void]$sb.Append("$GS!"  + [char]0)  # GS  !  0 = co ky tu 1x1  <-- go phong to
[void]$sb.Append("${ESC}a" + [char]0)# ESC a  0 = canh trai
[void]$sb.Append("${ESC}G" + [char]1)# ESC G  1 = in dam (double-strike)

[void]$sb.Append("CHAN DOAN MAY IN - DAN D PAK`n")
[void]$sb.Append(("-" * 48) + "`n")
[void]$sb.Append("May in: $Printer`n")
[void]$sb.Append("Luc   : " + (Get-Date -Format 'HH:mm:ss dd/MM/yyyy') + "`n")
[void]$sb.Append(("-" * 48) + "`n")
[void]$sb.Append("Thuoc do 48 ky tu (kho K80 = 576 dot = 48 ky tu):`n")
[void]$sb.Append("123456789012345678901234567890123456789012345678`n")
[void]$sb.Append("....|....1....|....2....|....3....|....4....|...`n")
[void]$sb.Append(("=" * 48) + "`n")
[void]$sb.Append("DOC KET QUA:`n")
[void]$sb.Append("- Hai dong so tren VUA KHIT be ngang giay = DUNG.`n")
[void]$sb.Append("- Bi xuong dong = may in dang phong to chu.`n")
[void]$sb.Append("- Chu mo/xam = dang in qua driver, khong phai RAW.`n")
[void]$sb.Append("`n`n`n")
[void]$sb.Append("$GS" + "VB" + [char]0)   # GS V B 0 = cat giay

$bytes = [System.Text.Encoding]::ASCII.GetBytes($sb.ToString())

Write-Host ''
Write-Host '=== 3. GUI NGUYEN BYTE ESC/POS (datatype RAW) ===' -ForegroundColor Cyan

$src = @'
using System;
using System.Runtime.InteropServices;
public class DanDPakRaw {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool OpenPrinter(string src, out IntPtr h, IntPtr pd);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);
}
'@
if (-not ('DanDPakRaw' -as [type])) { Add-Type -TypeDefinition $src -Language CSharp }

$h = [IntPtr]::Zero
if (-not [DanDPakRaw]::OpenPrinter($Printer, [ref]$h, [IntPtr]::Zero)) {
  throw "Khong mo duoc may in '$Printer' (ma loi $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
}
try {
  $di = New-Object DanDPakRaw+DOCINFO
  $di.pDocName = 'Dan-D Pak - chan doan may in'
  $di.pDataType = 'RAW'
  if (-not [DanDPakRaw]::StartDocPrinter($h, 1, $di)) { throw 'StartDocPrinter that bai' }
  [void][DanDPakRaw]::StartPagePrinter($h)
  $written = 0
  if (-not [DanDPakRaw]::WritePrinter($h, $bytes, $bytes.Length, [ref]$written)) { throw 'WritePrinter that bai' }
  [void][DanDPakRaw]::EndPagePrinter($h)
  [void][DanDPakRaw]::EndDocPrinter($h)
  Write-Host ("  Da gui {0}/{1} byte thang xuong may in." -f $written, $bytes.Length) -ForegroundColor Green
} finally {
  [void][DanDPakRaw]::ClosePrinter($h)
}

Write-Host ''
Write-Host '=== 4. DOC TO GIAY VUA RA ===' -ForegroundColor Cyan
Write-Host '  Hai dong so vua khit be ngang, chu nho va DEN' -ForegroundColor Green
Write-Host '     -> May in va duong RAW deu TOT. Loi nam o agent cu chua duoc thay.'
Write-Host '        Sua: dong app POS, roi chay trong PowerShell quyen Admin:'
Write-Host '          Stop-Process -Name dandpak-agent -Force'
Write-Host '        Sau do cai lai bo cai desktop, mo lai app.'
Write-Host ''
Write-Host '  Van MO hoac HEP, chu bi xuong dong' -ForegroundColor Yellow
Write-Host '     -> Loi o CHINH MAY IN, phan mem khong sua duoc.'
Write-Host '        Kiem tra DIP switch mat duoi may in (kho giay 58mm/80mm),'
Write-Host '        hoac chay tien ich cau hinh cua hang de dat lai kho 80mm.'
Write-Host ''
