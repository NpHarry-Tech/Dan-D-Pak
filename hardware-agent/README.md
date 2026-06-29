# Dan D Pak â€” Hardware Agent (C++)

Agent C++ **Ä‘á»™c láº­p** cháº¡y trÃªn Ä‘Ãºng mÃ¡y POS/desktop, lo pháº§n giao tiáº¿p pháº§n cá»©ng
**USB / cáº¯m trá»±c tiáº¿p** vá»›i tá»‘c Ä‘á»™ native. NÃ³ **khÃ´ng** Ä‘á»¥ng tá»›i mÃ¡y in LAN â€” mÃ¡y in
LAN do Node server in tháº³ng qua TCP 9100 (Ä‘Ã£ native-fast).

## Pháº¡m vi (Ä‘Ã£ chá»‘t vá»›i mÃ´ hÃ¬nh thiáº¿t bá»‹ cá»§a báº¡n)

| Thiáº¿t bá»‹ | Ai xá»­ lÃ½ |
|---|---|
| MÃ¡y in nhiá»‡t **LAN/Ethernet** | Node server (TCP 9100) â€” KHÃ”NG qua agent |
| MÃ¡y in nhiá»‡t **USB** | **Agent nÃ y** â€” RAW ESC/POS, Ä‘Ãºng lá»‡nh cáº¯t giáº¥y / Ä‘Ã¡ kÃ©t / canh cá»™t |
| **KÃ©t tiá»n** (cáº¯m sau mÃ¡y in USB) | **Agent nÃ y** â€” `/drawer` |
| MÃ¡y quáº¹t tháº» **PAX A920** | Táº§ng Android (Intent) â€” A920 lÃ  mÃ¡y Android, KHÃ”NG qua agent |
| CÃ¢n Ä‘iá»‡n tá»­ | KhÃ´ng dÃ¹ng |

> VÃ¬ sao cáº§n agent cho mÃ¡y in USB: Ä‘Æ°á»ng cÅ© (`connection: system`) in *vÄƒn báº£n* qua
> driver há»‡ Ä‘iá»u hÃ nh â†’ máº¥t lá»‡nh ESC/POS (khÃ´ng cáº¯t giáº¥y, khÃ´ng Ä‘Ã¡ kÃ©t, sai cá»™t).
> Agent gá»­i **Ä‘Ãºng chuá»—i byte ESC/POS** xuá»‘ng mÃ¡y in (datatype `RAW`).

## Build (chá»‰ lÃ m 1 láº§n trÃªn mÃ¡y dev â€” mÃ¡y POS chá»‰ cáº§n file .exe)

**CÃ¡ch A â€” MinGW-w64 (khÃ´ng cáº§n Visual Studio, khuyáº¿n nghá»‹ cho mÃ¡y khÃ´ng cÃ³ build tools):**
1. CÃ i MinGW-w64 (winlibs.com hoáº·c `choco install mingw`), Ä‘áº£m báº£o `g++` trÃªn PATH (`where g++`).
2. Double-click `build-mingw.bat` â†’ ra `dandpak-hw-agent.exe`.

**CÃ¡ch B â€” MSVC (náº¿u Ä‘Ã£ cÃ³ Visual Studio Build Tools):**
1. Má»Ÿ "x64 Native Tools Command Prompt for VS".
2. Cháº¡y `build.bat` â†’ ra `dandpak-hw-agent.exe`.

**CÃ¡ch C â€” clang++/LLVM (mÃ¡y nÃ y Ä‘Ã£ cÃ³ sáºµn, ÄÃƒ build & test OK):**
```bat
clang++ -std=c++17 -O2 src\main.cpp -o dandpak-hw-agent.exe -lws2_32 -lwinspool
```
> ÄÃ£ build thá»­ trÃªn chÃ­nh mÃ¡y cá»§a báº¡n báº±ng clang++: liá»‡t kÃª Ä‘Ãºng mÃ¡y in Windows,
> kiá»ƒm token, in RAW vÃ  `/drawer` Ä‘á»u cháº¡y. File `.exe` hiá»‡n cÃ³ sáºµn trong thÆ° má»¥c nÃ y.

File `.exe` build báº±ng MinGW vá»›i `-static` lÃ  **standalone** â€” copy sang mÃ¡y POS cháº¡y luÃ´n,
khÃ´ng cáº§n cÃ i runtime.

## Cháº¡y

```bat
set HW_AGENT_TOKEN=<chuoi-bi-mat-trung-voi-server>
set HW_AGENT_PORT=39041
dandpak-hw-agent.exe
```

- Chá»‰ láº¯ng nghe trÃªn `127.0.0.1` (loopback) â†’ **khÃ´ng thiáº¿t bá»‹ LAN nÃ o gá»i Ä‘Æ°á»£c**.
- `HW_AGENT_TOKEN`: náº¿u Ä‘áº·t, má»i route (trá»« `/health`) báº¯t buá»™c header `X-HW-Token` khá»›p.
  Äá»ƒ trá»‘ng = chá»‰ dá»±a vÃ o loopback (cháº¥p nháº­n cho thá»­ nghiá»‡m, nÃªn Ä‘áº·t token khi cháº¡y tháº­t).

## Kiá»ƒm thá»­ nhanh (sau khi build, cÃ³ mÃ¡y in USB)

```bat
REM 1) Liveness
curl http://127.0.0.1:39041/health

REM 2) Liá»‡t kÃª mÃ¡y in Windows tháº¥y Ä‘Æ°á»£c (láº¥y Ä‘Ãºng "name" Ä‘á»ƒ cáº¥u hÃ¬nh tuyáº¿n)
curl -H "X-HW-Token: %HW_AGENT_TOKEN%" http://127.0.0.1:39041/printers

REM 3) In thá»­: láº¥y tÃªn mÃ¡y in USB á»Ÿ bÆ°á»›c 2, Ä‘áº·t connection=agent + systemName=<tÃªn Ä‘Ã³>
REM    trong Printer Monitor cá»§a app rá»“i báº¥m "In thá»­".
```

## Giao thá»©c (Node â†” agent)

| Route | Method | Body | Tráº£ vá» |
|---|---|---|---|
| `/health` | GET | â€” | `{ok:true, version}` |
| `/printers` | GET | â€” | `[{name, status}]` |
| `/print` | POST | `{printer, dataBase64}` | `{ok:true, bytes}` |
| `/drawer` | POST | `{printer}` | `{ok:true}` |

`dataBase64` = chuá»—i byte ESC/POS (Ä‘Ã£ gá»“m init/cáº¯t/Ä‘Ã¡-kÃ©t) do Node táº¡o, encode base64.

## Báº£o máº­t

- Bind loopback-only (khÃ´ng bao giá» ra LAN).
- Token shared-secret cho route ghi.
- KhÃ´ng ghi log ná»™i dung bill; chá»‰ log sá»‘ byte + lá»—i.
- Agent chá»‰ biáº¿t in RAW + liá»‡t kÃª mÃ¡y in â€” khÃ´ng cÃ³ quyá»n DB/nghiá»‡p vá»¥.
