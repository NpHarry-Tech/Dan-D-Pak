@echo off
REM Build dandpak-hw-agent with MSVC (Visual Studio Build Tools).
REM Run this from a "x64 Native Tools Command Prompt for VS".
setlocal
cd /d "%~dp0"
cl /nologo /EHsc /O2 /std:c++17 src\main.cpp /Fe:dandpak-hw-agent.exe /link ws2_32.lib winspool.lib
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Build FAILED. Open "x64 Native Tools Command Prompt for VS" and retry,
  echo or use build-mingw.bat if you have MinGW-w64 instead.
  exit /b 1
)
del /q main.obj 2>nul
echo.
echo Built: %~dp0dandpak-hw-agent.exe
endlocal
