[Setup]
AppId={{DANDPAK-POS-DESKTOP-APP}}
AppName=Dan D Pak POS
AppVersion=0.1.1
DefaultDirName={commonpf}\DanDPakPOS
DefaultGroupName=Dan D Pak POS
OutputDir=..\..
OutputBaseFilename=dan-d-pak-pos-setup
Compression=lzma
SolidCompression=yes
SetupIconFile=windows\runner\resources\app_icon.ico
UninstallDisplayIcon={app}\dandpak_pos.exe
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
UsePreviousAppDir=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "build\windows\x64\runner\Release\dandpak_pos.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\windows\x64\runner\Release\*.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\windows\x64\runner\Release\native_assets.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\windows\x64\runner\Release\data\*"; DestDir: "{app}\data"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Dan D Pak POS"; Filename: "{app}\dandpak_pos.exe"; WorkingDir: "{app}"
Name: "{commondesktop}\Dan D Pak POS"; Filename: "{app}\dandpak_pos.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\dandpak_pos.exe"; Description: "{cm:LaunchProgram,Dan D Pak POS}"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent runasoriginaluser unchecked
