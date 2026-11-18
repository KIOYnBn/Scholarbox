@echo off
REM Run `tauri build` with the MSVC + TEMP fixes this machine needs.
REM release/*.exe linking fails with LNK1104 unless TEMP points at a writable dir.
setlocal
call "F:\IDE\vs studio\VC\Auxiliary\Build\vcvars64.bat" >nul
set "TEMP=%~dp0..\.tmp\tmp"
set "TMP=%TEMP%"
if not exist "%TEMP%" mkdir "%TEMP%"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
node "%~dp0..\node_modules\@tauri-apps\cli\tauri.js" build %*
