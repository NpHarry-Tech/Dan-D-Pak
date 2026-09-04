[Setup]
AppId={{DANDPAK-POS-DESKTOP-APP}}
AppName=Dan-D Pak POS
; PH?I d?i k�m kAppBuildNumber/kAppVersionName trong lib/app_version.dart.
; publish-release.ps1 d?c s? build t? app_version.dart r?i d?i chi?u v?i file
; dem l�n � l?ch l� m�y POS roi v�o v�ng l?p c?p nh?t v� t?n.
AppVersion=2026.09.03.01
DefaultDirName={commonpf}\DanDPakPOS
DefaultGroupName=Dan-D Pak POS
OutputDir=..\..\artifacts\releases
OutputBaseFilename=dan-d-pak-pos-setup-b170
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
; Hardware Agent (in bill/mo ket khi server dat tren VPS) - xem hardware_agent_launcher.dart.
Source: "build\windows\x64\runner\Release\dandpak-agent.exe"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
; native_assets.json không còn được Flutter mới sinh ra — bỏ qua nếu thiếu.
Source: "build\windows\x64\runner\Release\native_assets.json"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "build\windows\x64\runner\Release\data\*"; DestDir: "{app}\data"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
Type: files; Name: "{app}\dandpak_pos.exe"

[Icons]
Name: "{group}\Dan-D Pak POS"; Filename: "{app}\dandpak_desktop.exe"; WorkingDir: "{app}"
Name: "{commondesktop}\Dan-D Pak POS"; Filename: "{app}\dandpak_desktop.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
; Không skipifsilent/unchecked: auto-update chạy /VERYSILENT xong TỰ mở lại app.
Filename: "{app}\dandpak_desktop.exe"; Description: "{cm:LaunchProgram,Dan-D Pak POS}"; WorkingDir: "{app}"; Flags: nowait postinstall runasoriginaluser

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  { Agent chay tach khoi app; phai dung truoc khi ghi de file va khoi dong ban moi. }
  Exec(ExpandConstant('{cmd}'), '/C taskkill /F /IM dandpak-agent.exe >NUL 2>&1',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;

