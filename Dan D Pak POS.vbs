Set WshShell = CreateObject("WScript.Shell")
Dim exePath
exePath = Replace(WScript.ScriptFullName, "Dan D Pak POS.vbs", "") & "flutter-apps\dandpak_desktop\build\windows\x64\runner\Release\dandpak_desktop.exe"
WshShell.Run Chr(34) & exePath & Chr(34), 1, False
