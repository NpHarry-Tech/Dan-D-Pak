@echo off
REM Build dandpak-hw-agent with MinGW-w64 (g++). No Visual Studio needed.
REM Install MinGW-w64 (e.g. via https://winlibs.com or `choco install mingw`) and
REM make sure g++ is on PATH, then run this file by double-clicking or from cmd.
setlocal
cd /d "%~dp0"
g++ -std=c++17 -O2 -s src\main.cpp -o dandpak-hw-agent.exe -lws2_32 -lwinspool -static -static-libgcc -static-libstdc++
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Build FAILED. Is g++ on PATH? Try: where g++
  exit /b 1
)
echo.
echo Built: %~dp0dandpak-hw-agent.exe
endlocal
