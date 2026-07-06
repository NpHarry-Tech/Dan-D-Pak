@echo off
REM Build dandpak_pos Windows PROFILE (do hieu nang bang Flutter DevTools).
REM Chay app profile: build xong mo build\windows\x64\runner\Profile\dandpak_pos.exe
REM hoac dung `flutter run --profile -d windows` (trong Developer Command Prompt)
REM roi bam "v" de mo DevTools -> tab Performance.
REM Xem ghi chu toolchain trong build_release.bat.

setlocal enabledelayedexpansion

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VCVARS="
if exist "%VSWHERE%" (
  for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do (
    set "VCVARS=%%i\VC\Auxiliary\Build\vcvars64.bat"
  )
)
if not defined VCVARS set "VCVARS=%ProgramFiles(x86)%\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" (
  echo [build] KHONG tim thay vcvars64.bat - cai "Desktop development with C++" trong VS Build Tools.
  exit /b 1
)

call "%VCVARS%" >nul
set CC=cl
set CXX=cl
cd /d "%~dp0.."
flutter build windows --profile
