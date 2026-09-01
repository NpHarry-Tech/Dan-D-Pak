@echo off
REM Build dandpak_phone Windows RELEASE.
REM
REM Vi sao can file nay: voi VS Build Tools 2026 (18.x), chay `flutter build
REM windows` tu shell thuong lam CMake chon nham compiler (clang++ trong PATH,
REM hoac cl.exe khong co bien INCLUDE) -> loi C1083 / cac co "/WX" la.
REM Phai build trong moi truong vcvars64 + ep CC/CXX=cl nhu duoi day.
REM Neu truoc do build fail vi sai generator: xoa thu muc build\windows roi chay lai.

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
flutter build windows --release
