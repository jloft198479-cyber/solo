# Solo Build Script
$ErrorActionPreference = "Stop"

$env:CARGO_HOME = "M:\rust\.cargo"
$env:RUSTUP_HOME = "M:\rust\.rustup"
$env:PATH = "M:\rust\.cargo\bin;$env:PATH"
$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:CARGO_HTTP_CHECK_REVOKE = "false"

$vcvars = "M:\VS\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if (Test-Path $vcvars) {
    Write-Host "Loading MSVC environment..." -ForegroundColor Cyan
    $output = cmd /c "chcp 65001 >nul && `"$vcvars`" >nul 2>&1 && set"
    foreach ($line in $output) {
        if ($line -match "^([^=]+)=(.*)$") {
            Set-Item -Path "env:$($matches[1])" -Value $matches[2]
        }
    }
}

Set-Location "F:\fzz-Project\md-editor\md-editor"
Write-Host ""
Write-Host "=== Solo Build ===" -ForegroundColor Green
Write-Host "Rust: $(rustc --version)" -ForegroundColor Cyan
Write-Host ""

npx tauri build
