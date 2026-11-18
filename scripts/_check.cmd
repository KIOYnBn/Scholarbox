@echo off
cd /d "%~dp0..\src-tauri"
call "%~dp0cargo-env.cmd" check --release --message-format=short
