@echo off
echo ========================================
echo   Dan D Pak POS - Build Release
echo ========================================
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
echo.
echo Building release...
"C:\Users\PC\flutter-sdk\flutter\bin\flutter.bat" build windows --release
echo.
if %errorlevel%==0 (
    echo ✓ Build thanh cong!
    echo EXE: build\windows\x64\runner\Release\dandpak_desktop.exe
) else (
    echo ✗ Build that bai!
)
pause
