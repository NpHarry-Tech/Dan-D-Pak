@echo off
set "PATH=%PATH:C:\Program Files\LLVM\bin;=%"
set "PATH=%PATH:;C:\Program Files\LLVM\bin=%"
set "PATH=%PATH%;C:\Users\PC\AppData\Local"
if not exist "build\native_assets\windows" mkdir "build\native_assets\windows"
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
"C:\Users\PC\flutter-sdk\flutter\bin\flutter.bat" run -d windows
