@echo off
REM Build Dan D Pak POS Windows release and compile the Inno Setup installer.
REM Requires Inno Setup 6 (ISCC.exe).

setlocal enabledelayedexpansion
cd /d "%~dp0.."

call "tool\build_release.bat"
if errorlevel 1 exit /b 1

set "ISCC="
for %%P in (
  "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
  "%ProgramFiles%\Inno Setup 6\ISCC.exe"
  "D:\Antigravity\resources\app\node_modules\innosetup\bin\ISCC.exe"
) do (
  if exist "%%~P" set "ISCC=%%~P"
)


if not defined ISCC (
  for /f "tokens=*" %%i in ('where ISCC.exe 2^>nul') do (
    set "ISCC=%%i"
    goto found_iscc
  )
)

:found_iscc
if not defined ISCC (
  echo [installer] KHONG tim thay ISCC.exe.
  echo [installer] Cai Inno Setup 6 roi chay lai file nay.
  echo [installer] File cau hinh: %CD%\setup.iss
  exit /b 1
)

REM Ten file cai dat co ngay build de phan biet cac ban giao cho cua hang.
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "BUILD_DATE=%%d"

"%ISCC%" /F"dan-d-pak-pos-setup-%BUILD_DATE%" setup.iss
if errorlevel 1 exit /b 1

echo.
echo [installer] XONG: %CD%\..\..\dan-d-pak-pos-setup-%BUILD_DATE%.exe
