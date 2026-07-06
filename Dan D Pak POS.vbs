Set WshShell = CreateObject("WScript.Shell")
WshShell.Run Chr(34) & WScript.ScriptFullName & Chr(34)
Dim exePath
exePath = Replace(WScript.ScriptFullName, "Dan D Pak POS.vbs", "") & "flutter-apps\dandpak_pos\build\windows\x64\runner\Release\dandpak_pos.exe"
WshShell.Run Chr(34) & exePath & Chr(34), 1, False
