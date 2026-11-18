@echo off
REM Launch "npm run tauri dev" with what this machine needs:
REM  - MSVC dev env (VS is at F:\IDE\vs studio)
REM  - TEMP/TMP inside the repo (sandbox blocks %USERPROFILE%\AppData\Local\Temp)
REM  - APPDATA/LOCALAPPDATA inside the repo (the sandbox also denies %APPDATA%;
REM    tauri-plugin-http fails with os error 5 when it cannot write there)
REM  - the rust toolchain installed into .cargo / .rustup
REM  - WebView2 remote debugging so the UI can be driven from outside
setlocal
call "F:\IDE\vs studio\VC\Auxiliary\Build\vcvars64.bat" > NUL
if errorlevel 1 (
  echo [tauri-dev] vcvars64 failed
  exit /b 1
)

set "ROOT=%~dp0.."
set "SCRATCH=%ROOT%\.tmp\tmp"
if not exist "%SCRATCH%" mkdir "%SCRATCH%" > NUL 2>&1
set "TEMP=%SCRATCH%"
set "TMP=%SCRATCH%"

set "CARGO_HOME=%ROOT%\.cargo"
set "RUSTUP_HOME=%ROOT%\.rustup"
set "PATH=%ROOT%\.cargo\bin;%PATH%"
set "APPDATA=%ROOT%\.tmp\appdata\roaming"
set "LOCALAPPDATA=%ROOT%\.tmp\appdata\local"
if not exist "%APPDATA%" mkdir "%APPDATA%" > NUL 2>&1
if not exist "%LOCALAPPDATA%" mkdir "%LOCALAPPDATA%" > NUL 2>&1
set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222"

cd /d "%ROOT%"
call npm run tauri dev
