@echo off
setlocal enabledelayedexpansion
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VCVARS="
if exist "%VSWHERE%" (
  for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do (
    set "VCVARS=%%i\VC\Auxiliary\Build\vcvars64.bat"
  )
)
if not exist "%VCVARS%" set "VCVARS=%ProgramFiles(x86)%\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
call "%VCVARS%" >nul
set CC=cl
set CXX=cl
cd /d "%~dp0"
flutter run -d windows --release
