@echo off
REM ============================================================
REM Dan D Pak - Hardware Agent (chay TAI MAY POS trong cua hang)
REM
REM May nay giu may in / ket tien / A920 cam truc tiep. Agent nhan
REM lenh in tu server VPS roi in that tai cho.
REM
REM Cach dung:
REM   1. Copy deploy\company-server\agent.env.example -> server\.env.agent va sua
REM   2. Chay file nay. De agent tu chay khi mo may: cho shortcut
REM      cua file nay vao thu muc Startup (shell:startup).
REM ============================================================
setlocal
cd /d "%~dp0..\..\.."

where node >nul 2>nul
if errorlevel 1 (
  echo [agent] KHONG tim thay Node.js. Cai Node 18+ roi chay lai.
  pause
  exit /b 1
)

:loop
echo [agent] Dang chay Hardware Agent... (Ctrl+C de dung)
node server\agent.js
echo [agent] Agent thoat. Khoi dong lai sau 3 giay...
timeout /t 3 /nobreak >nul
goto loop
