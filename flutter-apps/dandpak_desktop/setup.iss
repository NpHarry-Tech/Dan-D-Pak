[Setup]
AppId={{DANDPAK-POS-DESKTOP-APP}}
AppName=Dan D Pak POS
AppVersion=2026.07.22.2
DefaultDirName={commonpf}\DanDPakPOS
DefaultGroupName=Dan D Pak POS
OutputDir=..\..\artifacts\releases
OutputBaseFilename=dan-d-pak-pos-setup-2026-07-22-2
Compression=lzma
SolidCompression=yes
SetupIconFile=windows\runner\resources\app_icon.ico
UninstallDisplayIcon={app}\dandpak_desktop.exe
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Nhớ thư mục cài lần trước — auto-update cài đè đúng chỗ, không hỏi lại.
UsePreviousAppDir=yes
DisableDirPage=auto
CloseApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "build\windows\x64\runner\Release\dandpak_desktop.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\windows\x64\runner\Release\*.dll"; DestDir: "{app}"; Flags: ignoreversion
; native_assets.json không còn được Flutter mới sinh ra — bỏ qua nếu thiếu.
Source: "build\windows\x64\runner\Release\native_assets.json"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "build\windows\x64\runner\Release\data\*"; DestDir: "{app}\data"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
Type: files; Name: "{app}\dandpak_pos.exe"

[Icons]
Name: "{group}\Dan D Pak POS"; Filename: "{app}\dandpak_desktop.exe"; WorkingDir: "{app}"
Name: "{commondesktop}\Dan D Pak POS"; Filename: "{app}\dandpak_desktop.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
; Không skipifsilent/unchecked: auto-update chạy /VERYSILENT xong TỰ mở lại app.
Filename: "{app}\dandpak_desktop.exe"; Description: "{cm:LaunchProgram,Dan D Pak POS}"; WorkingDir: "{app}"; Flags: nowait postinstall runasoriginaluser
