@echo off
call "F:\IDE\vs studio\VC\Auxiliary\Build\vcvars64.bat" > NUL
set "SCRATCH=%~dp0..\.tmp\tmp"
if not exist "%SCRATCH%" mkdir "%SCRATCH%" > NUL 2>&1
set "TEMP=%SCRATCH%"
set "TMP=%SCRATCH%"
echo [link-test] LIB=%LIB%
rustc "%~dp0..\.tmp\t.rs" -o "%~dp0..\.tmp\t.exe" --verbose
if errorlevel 1 (
  echo [link-test] rustc FAILED
  exit /b 1
)
"%~dp0..\.tmp\t.exe"
