@echo off
title Solo Dev

set CARGO_HOME=M:\rust\.cargo
set RUSTUP_HOME=M:\rust\.rustup
set PATH=%CARGO_HOME%\bin;%PATH%

set HTTP_PROXY=
set HTTPS_PROXY=
set CARGO_HTTP_CHECK_REVOKE=false

set VCVARS=M:\VS\BuildTools\VC\Auxiliary\Build\vcvars64.bat
if exist "%VCVARS%" (
    call "%VCVARS%" >nul
)

cd /d "F:\fzz-Project\md-editor"

echo.
echo === Solo Dev ===
rustc --version

npx tauri dev

pause
