# Solo Release Gate —— 发布两道闸门
#
# 用法：
#   打 tag 前全闸门（版本一致 + replaceAll 扫描 + test/build）：
#     pwsh scripts/release-gate.ps1 -Stage PreTag
#   仅快速校验版本号（迭代版本号时循环用，跳过 test/build）：
#     pwsh scripts/release-gate.ps1 -Stage PreTag -Fast
#   CI 完成后校验（等 CI + 资产 + latest.json）：
#     pwsh scripts/release-gate.ps1 -Stage PostCI
#   CI 完成后校验并翻转 draft -> published（易忘步骤，显式开关）：
#     pwsh scripts/release-gate.ps1 -Stage PostCI -Publish
#
# 设计：只做「判断结果的执行 + 机械校验」，不做任何产品决策。
#       -Publish 默认关闭，避免误发。

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("PreTag", "PostCI")]
    [string]$Stage,

    [switch]$Fast,     # PreTag 仅做版本一致 + replaceAll 扫描，跳过 bun test/build
    [switch]$Publish,  # PostCI 翻转 draft -> published
    [int]$CiTimeoutMin = 25
)

# --- 仓库根：由脚本位置推导，绝不硬编码 ---
$repo = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $repo "package.json"))) {
    Write-Error "未在预期位置找到 package.json，脚本路径异常：$repo"
    exit 1
}

function Write-Step($msg)  { Write-Host "`n▶ $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "  ✅ $msg" -ForegroundColor Green }
function Write-Fail($msg)  { Write-Host "  ❌ $msg" -ForegroundColor Red }
function Write-Warn($msg)  { Write-Host "  ⚠️  $msg" -ForegroundColor Yellow }

# --- 读取三处版本号 ---
function Get-FileVersion($relPath, $pattern) {
    $p = Join-Path $repo $relPath
    if (-not (Test-Path $p)) { throw "文件不存在：$p" }
    $txt = Get-Content $p -Raw
    if ($txt -match $pattern) { return $matches[1] }
    throw "无法在 $relPath 中解析版本号（模式：$pattern）"
}

$versions = @{}
try {
    $versions["package.json"]        = Get-FileVersion "package.json" '"version"\s*:\s*"([^"]+)"'
    $versions["src-tauri/Cargo.toml"] = Get-FileVersion "src-tauri/Cargo.toml" '(?ms)\[package\][^\[]*?^version\s*=\s*"([^"]+)"'
    $versions["src-tauri/tauri.conf.json"] = Get-FileVersion "src-tauri/tauri.conf.json" '"version"\s*:\s*"([^"]+)"'
}
catch {
    Write-Fail $_.Exception.Message
    exit 1
}

# ============================ PreTag ============================
if ($Stage -eq "PreTag") {
    Write-Step "PreTag 闸门：打 tag 前校验"

    Write-Step "1/3 版本三处一致性"
    $first = $versions["package.json"]
    $allEqual = $true
    foreach ($k in $versions.Keys) {
        if ($versions[$k] -ne $first) {
            Write-Fail "$k = $($versions[$k])  ≠  $first"
            $allEqual = $false
        }
        else {
            Write-Ok "$k = $($versions[$k])"
        }
    }
    if (-not $allEqual) {
        Write-Fail "版本号不一致，禁止打 tag。先统一三处再到 Phase D bump 提交。"
        exit 1
    }
    $version = $first
    Write-Ok "三处版本一致：$version"

    Write-Step "2/3 replaceAll 扫描（TS target ES2020 禁用）"
    $hits = Get-ChildItem -Path (Join-Path $repo "src") -Recurse -File |
        Select-String -Pattern 'replaceAll|replaceAllAsync' -ErrorAction SilentlyContinue
    if ($hits) {
        Write-Fail "发现 replaceAll 用法（ES2021 API，ES2020 运行时会炸）："
        $hits | ForEach-Object { Write-Host "    $($_.Path):$($_.LineNumber)" -ForegroundColor Red }
        Write-Host "    改用 .split(X).join(Y) 替代。" -ForegroundColor Yellow
        exit 1
    }
    Write-Ok "无 replaceAll / replaceAllAsync 用法"

    if ($Fast) {
        Write-Step "3/3 -Fast 模式：跳过 bun test/build"
        Write-Ok "PreTag 快速校验通过（版本一致 + 无 replaceAll）。"
        exit 0
    }

    Write-Step "3/3 bun run test + bun run build 门禁"
    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
        Write-Fail "未找到 bun。请先安装 bun 并加入 PATH（项目用 bun 1.3.14）。"
        exit 1
    }
    Write-Host "  运行 bun run test ..." -ForegroundColor Cyan
    bun run test
    if ($LASTEXITCODE -ne 0) { Write-Fail "bun run test 失败"; exit 1 }
    Write-Ok "bun run test 通过"

    Write-Host "  运行 bun run build ..." -ForegroundColor Cyan
    bun run build
    if ($LASTEXITCODE -ne 0) { Write-Fail "bun run build 失败"; exit 1 }
    Write-Ok "bun run build 通过"

    Write-Host "`n✅ PreTag 闸门全绿。可打 tag：git tag v$version && git push origin v$version" -ForegroundColor Green
    exit 0
}

# ============================ PostCI ============================
if ($Stage -eq "PostCI") {
    $version = $versions["package.json"]
    $tag = "v$version"
    Write-Step "PostCI 闸门：CI 后校验 ($tag)"

    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Write-Fail "未找到 gh（GitHub CLI）。请先安装并登录（gh auth login）。"
        exit 1
    }

    Write-Step "1/4 等待 CI 完成（超时 ${CiTimeoutMin}min）"
    $deadline = (Get-Date).AddMinutes($CiTimeoutMin)
    $run = $null
    while ($true) {
        $runs = gh run list --workflow=release.yml --limit 1 --json status,conclusion,createdAt,databaseId 2>$null | ConvertFrom-Json
        if ($runs -and $runs.Count -gt 0) {
            $run = $runs[0]
            Write-Host "  CI 状态：$($run.status) / 结论：$($run.conclusion) ($($run.createdAt))" -ForegroundColor Cyan
            if ($run.status -eq "completed") { break }
        }
        else {
            Write-Host "  尚未查到 CI run，继续等待..." -ForegroundColor Cyan
        }
        if ((Get-Date) -gt $deadline) {
            Write-Fail "等待 CI 超时（>${CiTimeoutMin}min）。可加 -CiTimeoutMin 调大，或 gh run list 手动排查。"
            exit 1
        }
        Start-Sleep -Seconds 30
    }
    if ($run.conclusion -ne "success") {
        Write-Fail "CI 结论为 $($run.conclusion)，未成功。先排查 CI 日志（gh run view $($run.databaseId)）再处理。"
        exit 1
    }
    Write-Ok "CI 成功"

    Write-Step "2/4 资产三件套核对（.exe / .sig / latest.json）"
    $rel = gh release view $tag --json assets,isDraft 2>$null | ConvertFrom-Json
    if (-not $rel) {
        Write-Fail "未找到 release：$tag。确认 tag 已推送且 CI 已创建 release。"
        exit 1
    }
    $names = $rel.assets | ForEach-Object { $_.name }
    $need = @(".exe", ".sig", "latest.json")
    $missing = $need | Where-Object { -not ($names -match [regex]::Escape($_)) }
    if ($missing) {
        Write-Fail "缺少资产：$($missing -join ', ')"
        Write-Host "    现有：$($names -join ', ')" -ForegroundColor Yellow
        exit 1
    }
    Write-Ok "资产三件套齐全：$($names -join ', ')"
    if ($rel.isDraft) {
        Write-Warn "release 当前为 draft（用户不可见，updater 查不到）。用 -Publish 翻转。"
    }
    else {
        Write-Ok "release 已 published"
    }

    Write-Step "3/4 latest.json 版本校验"
    $tmpDir = Join-Path $repo ".reltmp"
    if (-not (Test-Path $tmpDir)) { New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null }
    try {
        gh release download $tag -p "latest.json" -D $tmpDir 2>$null
        $lj = Get-Content (Join-Path $tmpDir "latest.json") -Raw | ConvertFrom-Json
        if ($lj.version -ne $version) {
            Write-Fail "latest.json version = $($lj.version) ，期望 $version（版本号未同步，见 RELEASE_PROCESS.md §9.3）"
            exit 1
        }
        Write-Ok "latest.json version = $($lj.version) 匹配"
    }
    finally {
        Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Step "4/4 发布（如需要）"
    if ($Publish) {
        if (-not $rel.isDraft) {
            Write-Warn "release 已非 draft，无需翻转。"
        }
        else {
            gh release edit $tag --draft=false 2>$null
            $rel2 = gh release view $tag --json isDraft 2>$null | ConvertFrom-Json
            if ($rel2.isDraft) {
                Write-Fail "翻转 draft->published 失败，请手动 gh release edit $tag --draft=false"
                exit 1
            }
            Write-Ok "已翻转 draft -> published，用户可收到更新"
        }
    }
    else {
        Write-Warn "未传 -Publish，保持现状。确认无误后加 -Publish 翻转发布。"
    }

    Write-Host "`n✅ PostCI 闸门完成。$(if ($Publish) { '已发布。' } else { '校验通过，待 -Publish。' })" -ForegroundColor Green
    exit 0
}
