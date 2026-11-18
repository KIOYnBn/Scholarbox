@echo off
REM Run cargo inside the MSVC developer environment.
REM  1) VS lives at F:\IDE\vs studio, so rustc cannot find MSVC LIB/INCLUDE.
REM  2) The sandbox denies writes to %TEMP%, which link.exe needs for .tmp files.
REM  3) The Rust toolchain is installed per-project (.cargo / .rustup), not in %USERPROFILE%.
setlocal
call "F:\IDE\vs studio\VC\Auxiliary\Build\vcvars64.bat" > NUL
if errorlevel 1 (
  echo [cargo-env] vcvars64 failed
  exit /b 1
)
set "ROOT=%~dp0.."
set "CARGO_HOME=%ROOT%\.cargo"
set "RUSTUP_HOME=%ROOT%\.rustup"
set "PATH=%CARGO_HOME%\bin;%PATH%"
set "SCRATCH=%ROOT%\.tmp\tmp"
if not exist "%SCRATCH%" mkdir "%SCRATCH%" > NUL 2>&1
set "TEMP=%SCRATCH%"
set "TMP=%SCRATCH%"
cargo %*
