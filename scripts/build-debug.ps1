# MD编辑器 - Debug 构建脚本
# 在 TRAE 外部的 PowerShell 中运行此脚本

# --- 设置终端编码为 UTF-8 ---
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 > $null

$ErrorActionPreference = "Stop"

# --- Cargo / Rustup 路径 ---
$env:CARGO_HOME  = "M:\rust\.cargo"
$env:RUSTUP_HOME = "M:\rust\.rustup"
$env:PATH        = "$env:CARGO_HOME\bin;$env:PATH"

# --- 清除代理 ---
$env:HTTP_PROXY  = ""
$env:HTTPS_PROXY = ""
$env:http_proxy  = ""
$env:https_proxy = ""
$env:ALL_PROXY   = ""
$env:NO_PROXY    = "*"

$env:CARGO_HTTP_CHECK_REVOKE = "false"

# --- MSVC 环境 ---
$vcvars = "M:\VS\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if (Test-Path $vcvars) {
    Write-Host "加载 MSVC 环境: $vcvars" -ForegroundColor Cyan
    $output = cmd /c "chcp 65001 >nul && `"$vcvars`" >nul 2>&1 && set"
    foreach ($line in $output) {
        if ($line -match "^([^=]+)=(.*)$") {
            Set-Item -Path "env:$($matches[1])" -Value $matches[2]
        }
    }
} else {
    Write-Host "vcvars64.bat 未找到，手动设置 MSVC 环境" -ForegroundColor Yellow
    $msvcPath = "M:\VS\BuildTools\VC\Tools\MSVC\14.44.35207"
    $sdkPath  = "C:\Program Files (x86)\Windows Kits\10"
    $sdkVer   = "10.0.26100.0"
    $env:INCLUDE = "$msvcPath\include;$sdkPath\Include\$sdkVer\ucrt;$sdkPath\Include\$sdkVer\um;$sdkPath\Include\$sdkVer\shared"
    $env:LIB     = "$msvcPath\lib\x64;$sdkPath\Lib\$sdkVer\ucrt\x64;$sdkPath\Lib\$sdkVer\um\x64"
    $env:PATH    = "$msvcPath\bin\Hostx64\x64;$sdkPath\bin\$sdkVer\x64;$env:PATH"
}

# --- 进入项目目录并构建 ---
Set-Location "f:\fzz-Project\md-editor\md-editor"
Write-Host ""
Write-Host "=== MD编辑器 Debug 构建 ===" -ForegroundColor Green
Write-Host "Rust: $(rustc --version)" -ForegroundColor Cyan
Write-Host ""

npx tauri build --debug
