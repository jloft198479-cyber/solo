@echo off
title Solo Dev

REM Toolchain locations: defaults below, but any pre-set env var wins (so moving them needs no edit).
if not defined CARGO_HOME set CARGO_HOME=M:\rust\.cargo
if not defined RUSTUP_HOME set RUSTUP_HOME=M:\rust\.rustup
set PATH=%CARGO_HOME%\bin;%PATH%

set HTTP_PROXY=
set HTTPS_PROXY=
set CARGO_HTTP_CHECK_REVOKE=false

if not defined VCVARS set VCVARS=M:\VS\BuildTools\VC\Auxiliary\Build\vcvars64.bat
if exist "%VCVARS%" (
    call "%VCVARS%" >nul
) else (
    echo [warn] vcvars64.bat not found: "%VCVARS%"
    echo [warn] set VCVARS env var to its real path, otherwise cl.exe will be missing.
)

REM Resolve project root from this script's own location (survives folder renames / moves).
cd /d "%~dp0"

echo.
echo === Solo Dev ===
rustc --version

npx tauri dev

pause
