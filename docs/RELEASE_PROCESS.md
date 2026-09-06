---
title: solo 正式发布流程
type: core
audience: maintainer
status: active
tags: [核心文档, 发布, CI]
summary: 发版流程真理源：Phase 定义/回滚/故障处理
updates: [docs/PLAYBOOK.md, docs/PUBLISH_GUIDE.md, docs/发布流程科普（从写完代码到用户下载）.md, .github/workflows/release.yml, docs/KNOWN-ISSUES.md]
---

# solo 正式发布流程

> **目标**：从功能开发完成到用户收到更新的全链路标准操作程序。
> **适用范围**：所有 solo v1.x.x 版本发布。
> **原则**：先检查，后执行。每个步骤完成后才能进入下一步。

---

## 目录

1. [快速卡片——一站式核对表](#1-快速卡片一站式核对表)
2. [Phase 0：功能开发](#2-phase-0功能开发)
3. [Phase 1：版本号同步](#3-phase-1版本号同步)
4. [Phase 2：本地验证](#4-phase-2本地验证)
5. [Phase 3：CI 发布](#5-phase-3-ci-发布)
6. [Phase 4：发布后验证](#6-phase-4发布后验证)
7. [Phase 5：发布正式版](#7-phase-5发布正式版)
8. [回滚流程](#8-回滚流程)
9. [常见故障](#9-常见故障)
10. [Agent 执行环境踩坑速查（WorkBuddy 托管 shell / 自动发版必读）](#11-agent-执行环境踩坑速查)
11. [附录](#10-附录)

---

## 1. 快速卡片——一站式核对表

```text
[ ] 1. 确认所有功能开发完成、测试通过
[ ] 2. 确认版本号四源一致并升高（package.json / Cargo.toml / tauri.conf.json / Cargo.lock）
[ ] 3. 确认没有 replaceAll / replaceAllAsync（TS target ES2020）
[ ] 4. 提交版本号变更 → git push
[ ] 5. 本地全量测试：bun run test ✅
[ ] 6. 本地前端构建：bun run build ✅
[ ] 7. 创建并推送 tag：git tag v1.x.x && git push origin v1.x.x
[ ] 8. 等待 CI 完成（~15min，Rust 编译）
[ ] 9. 验证 release assets：版本号正确、3 个资产齐全
[ ] 10. 发布 release（draft → published）
[ ] 11. 改写 release notes 为中文用户摘要（CI 只生成 commit 列表：`gh release edit v1.x.x --notes-file <file>`）
[ ] 12. 在已安装版本上验证自动更新
[ ] 13. 更新项目文档（CHANGELOG.md 版本历史；**SECURITY.md 当前版本字段同步**；PROFILE.md 版本历史已于 2026-07-21 去重，统一以 CHANGELOG.md 为真理源）
```

> ⚠️ **Agent 在 WorkBuddy 托管 shell 自动发版**：`bun` / `gh` 命令需按 **§11** 调整（GH_TOKEN 污染、bun segfault、draft 下载卡死等）。一遍成功清单见 **§11.7**。

---

## 2. Phase 0：功能开发

### 2.1 完成所有功能

- 所有 feature 代码已合并到 `master`
- 测试覆盖：`bun run test` 全量通过（测试数量以命令实际输出为准，必须 0 失败）
- 类型检查：`vue-tsc --noEmit` 无错误
- 前端构建：`bun run build` 通过
- **构建检查**：每次代码变更后、commit **前**，必须先跑 `bun run build` 通过（`vue-tsc --noEmit` 会捕获未使用变量、类型错误等低级问题，防止流入 CI）

### 2.2 类型兼容性检查（🚨 重要）

**项目 TypeScript target 为 ES2020**，以下 ES2021+ API **不能使用**：

| 禁止的 API | 替代方案 |
|---|---|
| `String.prototype.replaceAll` | `.split(search).join(replacement)` |
| `Promise.any` | 改用 `Promise.race` + 逻辑 |
| `WeakRef` / `FinalizationRegistry` | 未使用 |

**检查命令**：
```bash
rg "replaceAll|replaceAllAsync" src/
```

---

## 3. Phase 1：版本号同步

### 3.1 必须修改的三个文件（缺一不可）

| # | 文件 | 字段 |
|---|---|---|
| 1 | `package.json` | `"version": "1.x.x"` |
| 2 | `src-tauri/Cargo.toml` | `version = "1.x.x"` |
| 3 | `src-tauri/tauri.conf.json` | `"version": "1.x.x"` |

### 3.2 版本号规则

- 使用**语义化版本**：`主版本.次版本.修订号`
- 新增功能/改进（非破坏性）→ 升**次版本号**（如 1.2.8 → 1.2.9）
- 修复 bug（无功能变化）→ 升**修订号**（如 1.2.9 → 1.2.10）
- 破坏性变更 → 升**主版本号**
- tag 名 = `v` + 版本号，如 `v1.2.9`

### 3.3 验证版本一致

```bash
Select-String -Path package.json,src-tauri\Cargo.toml,src-tauri\tauri.conf.json -Pattern '"version"|version = "'
```

输出中三个文件的版本号必须一致（**这是防止版本乱标的强制关卡**：任一不一致都不得打 tag）。`Cargo.lock` 中 solo 条目版本由 `cargo` 在构建时同步，也须与三处相同。

### 3.4 提交版本变更

```bash
git add -A
git commit -m "bump version to 1.x.x"
git push origin master
```

---

## 4. Phase 2：本地验证

### 4.1 全量测试

```bash
bun run test
```

预期：`ALL TESTS PASS`（测试数量以 `bun run test` 实际输出为准，必须 0 失败）。

### 4.2 前端构建

```bash
bun run build
```

等价于 `vue-tsc --noEmit && vite build`。不报错即通过。

### 4.3 （可选）本地完整打包验证

如果 Rust 代码有变更，建议本地打一次包确保 NSIS 安装器正常：

```batch
call M:\VS\BuildTools\VC\Auxiliary\Build\vcvars64.bat
set CARGO_HOME=M:\rust\.cargo
set RUSTUP_HOME=M:\rust\.rustup
set PATH=M:\rust\.cargo\bin;%PATH%
bunx tauri build
```

---

## 5. Phase 3：CI 发布

### 5.1 创建 tag

```bash
git tag v1.x.x
git push origin v1.x.x
```

### 5.2 Tag 名必须与前一步版本号完全相同

- `tag` vs `package.json` version 必须一致
- 例如版本号是 `1.2.9`，tag 必须是 `v1.2.9`（不是 `v1.2.9-beta` 也不是 `v1.2.9`）
- CI 通过 `git tag --sort=-v:refname | Select-Object -Index 1` 获取上一个 tag 来生成 changelog

### 5.3 CI 工作流做什么

`.github/workflows/release.yml` 在 tag push 后自动执行：

```
1. Checkout 代码
2. 安装 Node.js 22 + Bun + Rust stable
3. bun install（安装 JS 依赖）
4. Rust cache（加速编译）
5. bun run tauri build --target x86_64-pc-windows-msvc
   ├─ vue-tsc --noEmit（类型检查）
   ├─ vite build（前端构建）
   ├─ cargo build --release（Rust 编译）
   └─ makensis（NSIS 打包）
6. 生成 changelog（git log prevTag..currentTag --oneline）
7. 签名安装包 + 生成 .sig 文件
8. 生成 latest.json（updater 元数据）
9. 创建 Draft Release
10. 上传 3 个资产：.exe / .sig / latest.json
```

### 5.4 监控 CI 状态

```bash
# 查看最近一次 CI 运行状态
gh run list --workflow=release.yml --limit 1 --json status,conclusion,createdAt

# 查看具体 job 日志
gh run view --job=<job-id>
```

**CI 耗时参考**：
| 阶段 | 首次（无缓存） | 增量（有缓存） |
|---|---|---|
| Rust 编译 | ~10-15min | ~3-5min |
| 全过程 | ~12-18min | ~5-8min |

### 5.5 处理 tag 冲突

如果远程已有同名 tag（例如此前失败过）：

```bash
# 1. 删除远程 tag
git push origin --delete v1.x.x

# 2. 删除本地 tag
git tag -d v1.x.x

# 3. 重新创建
git tag v1.x.x && git push origin v1.x.x
```

---

## 6. Phase 4：发布后验证

### 6.1 确认 CI 成功

```bash
gh run list --workflow=release.yml --limit 1 --json status,conclusion,createdAt
```

`status` 必须为 `"completed"`，`conclusion` 必须为 `"success"`。

### 6.2 检查 Release 资产

```bash
gh release view v1.x.x
```

必须确认：
- **`draft: true`**（正常，CI 创建时默认 draft）
- **asset 版本号正确**：`solo_{版本号}_x64-setup.exe`（如 `solo_1.2.9_x64-setup.exe`）
- **3 个资产齐全**：`.exe` + `.sig` + `latest.json`

### 6.3 检查 latest.json

```bash
gh release download v1.x.x -p "latest.json" -O - 2>$null | ConvertFrom-Json | Select-Object version, pub_date
```

`version` 必须等于 tag 中的版本号（不含 `v` 前缀）。

---

## 7. Phase 5：发布正式版

### 7.1 从 draft 转为 published

```bash
gh release edit v1.x.x --draft=false
```

**为什么必须做这一步**：
- CI 创建的 release 默认是 **draft** 状态
- draft release 对用户**不可见**
- `tauri-plugin-updater` 在检查更新时只能看到**非 draft** 的 release
- 不发布 → 用户永远收不到更新

### 7.2 验证 release 已发布

```bash
gh release view v1.x.x
```

确认 `draft: false` 且 `published` 字段有值。

### 7.3 在已安装版本上验证自动更新

1. 打开已安装的 solo（任意旧版本，如 v1.2.8）
2. 设置 → 通用 → 检查更新（或等待启动时自动检查）
3. 确认弹出更新提示（版本号为刚发布的新版）
4. 点击更新，确认下载、安装、重启成功

### 7.4 更新项目文档

在 `CHANGELOG.md` 顶部追加新版本记录（以真实 `git log` 整理，不要硬编码测试数）：

```markdown
## [1.x.x] - YYYY-MM-DD

- 主要变更摘要
```

> 注：`.opencode/PROFILE.md` 的版本历史已于 2026-07-21 去重，统一以 `CHANGELOG.md` 为版本史真理源。

同时更新 `BUILD_GUIDE.md` 中的版本号示例（如果有硬编码）。

### 7.5 同步 CNB 国内镜像（每次发版）

CNB (cnb.cool) 只作**国内手动下载渠道**——软件 updater 端点写死 GitHub，CNB 那份**不参与自动更新**（改这条见 [KNOWN-ISSUES §二 #7](./KNOWN-ISSUES.md)）。

> ⚠️ **Agent 环境坑（必读）**：CNB 写操作必须走**个人令牌**（`cnb login` 的 OAuth token 只读，写全 403）；CNB 默认分支是 **`main`**（不是 GitHub 的 `master`），`--target-commitish` 必填。完整踩坑与命令见 **§11.5**。

```bash
# 1. 从 GitHub 取 3 个资产到沙盒目录（exe / .sig / latest.json）
gh release download v1.x.x -D .sandbox-cnb/assets --clobber

# 2. 上传到 CNB（令牌已存本机，勿入库）
export CNB_TOKEN=$(cat ~/.cnb/personal-token)
node "C:/Users/<user>/.workbuddy/skills/cnb-publish/scripts/upload-assets.mjs" \
  --repo fzz198479/solo --tag v1.x.x \
  --assets-dir "F:/fzz-Project/md-editor/.sandbox-cnb/assets" \
  --body-file "F:/fzz-Project/md-editor/.sandbox-cnb/body.md" --target-commitish main

# 3. 完整性校验：自算 sha256 与从 CNB 下载回来的文件比对，必须一致
```

> ⚠️ **脚本路径必须给 node 用 Windows 绝对路径**（`C:/Users/...`、`F:/...`）。`~` 展开的
> `/c/...` 会被 node 解析成 `F:\c\...` 而 MODULE_NOT_FOUND；curl 的 `-T` / `-o` 同理。
>
> ⚠️ **第 1 步下载 GitHub 很慢且会断**（本机实测 2-7KB/s，5.7MB 要 25-35 分钟，常在 60-70% 处
> `stream error: PROTOCOL_ERROR` 断掉，而 `gh release download` 不支持断点续传）。断了别重头跑，
> 用 Range 请求接上：**必须用 REST 数字 asset id**，`gh release view` 给的 `RA_xxx` 是 GraphQL
> node id，走 REST 会 404。
> ```bash
> # 取数字 id
> gh api "repos/<owner>/<repo>/releases/tags/v1.x.x" --jq '.assets[]|select(.name|test("exe$"))|.id'
> # 续传剩余部分（N = 已下载的字节数），再 cat 拼回去
> gh api -H "Accept: application/octet-stream" -H "Range: bytes=N-" \
>   repos/<owner>/<repo>/releases/assets/<数字id> > part2.bin
> cat part2.bin >> solo_x.x.x_x64-setup.exe   # 拼完校验总字节数
> ```

- 完整流程、令牌权限、13 条踩坑经验：技能 `~/.workbuddy/skills/cnb-publish/`；跨项目通用版 `F:\Agent\公用经验\CNB发版分发-全流程与踩坑经验.md`。
- **源码隔离**：CNB 仓库只放 release 附件 + 一个说明性 README，**永不推源码**。

---

## 8. 回滚流程

### 8.1 CI 失败回滚

CI 失败时 **不要重新打 tag**。先排查原因，修完代码后再重新打 tag：
1. 删除远程 tag：`git push origin --delete v1.x.x`
2. 删除本地 tag：`git tag -d v1.x.x`
3. 本地修代码 → `bun run build` 确认通过 → 提交 → push（版本号不变）
4. 重新 tag：`git tag v1.x.x && git push origin v1.x.x`

### 8.2 Release 已发布但发现 Bug

1. **不删除已发布的 release**（用户正在使用）
2. 修复 Bug → 升**修订号**（如 1.2.10）→ 走完整发布流程
3. 旧版 release 保留，用户下次检查更新时会拿到新版

### 8.3 错误版本号已发布

如果发现 release 中的 exe 版本号不对（如版本号还是 1.2.8 但 tag 是 v1.2.9）：

```bash
# 1. 删除远程 tag（必须先删）
git push origin --delete v1.2.9

# 2. 删除本地 tag
git tag -d v1.2.9

# 3. 删除 draft release（清理 GitHub 上的残留）
gh release delete v1.2.9 --yes

# 4. 修版本号 → 提交 → push
# 5. 重新打 tag
git tag v1.2.9 && git push origin v1.2.9
```

---

## 9. 常见故障

### 9.1 🔴 Build 步骤失败：`replaceAll` is not a function

**原因**：TypeScript target 为 ES2020（`tsconfig.json`），`replaceAll` 是 ES2021 API。

**排查**：
```bash
rg "replaceAll|replaceAllAsync" src/
```

**修复**：替换为 `.split(X).join(Y)`。

### 9.2 🔴 Create Release 步骤失败：No installer found

**现象**：
```
Get-Item: ... No installer found
```

**原因**：`release.yml` 寻找安装器的路径用了 `src-tauri/target/release/bundle/nsis/`，但 Tauri 构建指定了自定义 target triple `x86_64-pc-windows-msvc`，实际路径为 `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`。

**修复**：确认 `release.yml` 第 65 行使用 `${{ matrix.target }}` 变量。

### 9.3 🔴 生成 latest.json 中 version 字段错误

**现象**：`latest.json` 中 `version` 是上一个版本号（如 `1.2.8`），但 tag 是 `v1.2.9`。

**根因**：`package.json` / `Cargo.toml` / `tauri.conf.json` 三处的版本号没有升到新版本。Tauri 构建时使用 `Cargo.toml` 中的版本号，所以生成的 exe 文件名和 `latest.json` 都用的是旧版本号。

**预防**：必须在打 tag **前**完成版本号同步（见 Phase 1）。

### 9.4 🔴 用户收不到更新通知

| 场景 | 原因 | 解决 |
|---|---|---|
| Release 是 draft | updater 只查 published release | `gh release edit v1.x.x --draft=false` |
| `latest.json` version 错误 | 构建时版本号未同步 | 回滚修复后重新发版 |
| 签名不匹配 | signing key 未配置或无效 | 检查 `TAURI_SIGNING_PRIVATE_KEY` |
| `latest.json` 中 `pub_date` 格式错误 | 日期格式不符合 RFC 3339 | 确保 `Get-Date` 输出正确格式 |

### 9.5 🔴 CI 卡在 Rust 编译超过 20 分钟

**原因**：Rust cache miss（首次构建或 cache 过期）。

**处理**：耐心等待。首次构建约 10-15 分钟是正常范围。如果超过 25 分钟仍无进展，取消任务检查 Cargo.toml 或 Rust 版本配置。

### 9.6 🔴 `git push origin v1.x.x` 被拒绝

**现象**：
```
! [rejected]        v1.2.9 -> v1.2.9 (already exists)
```

**原因**：远程已有该 tag（例如此前 tag 成功后 CI 失败，重新创建 tag 时未清理远程）。

**解决**：
```bash
git push origin --delete v1.x.x
git tag -d v1.x.x
git tag v1.x.x && git push origin v1.x.x
```

### 9.7 🔴 `vue-tsc --noEmit` 报未使用变量或类型错误

**现象**：
```
error: 'xxx' is declared but its value is never read.
error: Type 'X' is not assignable to type 'Y'.
```

**原因**：Tauri 构建（`bun run build`）第一步就是 `vue-tsc --noEmit`。任何 TS 类型错误或未使用变量都会直接终止构建，不会进入 vite 和 cargo 阶段。

**根因**：代码变更后没有在本地跑 `vue-tsc --noEmit` 或 `bun run build`，直接 push 了。

**预防**：**代码变更后、commit 前必须跑 `bun run build`**（见 Phase 0 构建检查）。

### 9.8 🟡 本地 `bun run build` 被 safe-delete 守卫拦截（仅 WorkBuddy 托管 shell）

**现象**：
```
[vite:prepare-out-dir] [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]
{"count":121,"threshold":50,"scope":"turn","targets":["...\dist\assets"]}
```

**原因**：vite 构建前会 `emptyDir(dist/assets)`，文件数超阈值触发批量删除守卫。**只发生在 WorkBuddy 托管 shell，真实终端与 CI 不受影响**，不是代码/配置问题。

**处理**：跳过清空目录，覆盖写入即可（类型检查仍要单独跑）：
```bash
bunx vue-tsc --noEmit && bunx vite build --emptyOutDir=false
```

### 9.9 🟡 draft release 的 URL 显示 `untagged-<hash>`、by-tag API 404

**现象**：`gh release view v1.x.x` 输出 `releases/tag/untagged-e1913dcf...`，且 `gh api repos/<owner>/<repo>/releases/tags/v1.x.x` 返回 404。

**判断**：这是 **draft 状态的通用表现**（对比任一历史 draft release 即可确认），**不是 tag 关联失败**。发布后（`--draft=false`）URL 恢复为 `releases/tag/v1.x.x`，by-tag 端点、`releases/latest` 全部正常。

**正确验证方式**：查 API 原始字段而非 URL：
```bash
gh api "repos/<owner>/<repo>/releases?per_page=1" --jq '.[0].tag_name'
```

---

## 9.10 🔴 `gh release download` 对 draft release 卡死

见 **§11.4**（Agent 环境必读）。一句话：draft 态下载会挂 4 分钟以上不出，先 `gh release edit v1.x.x --draft=false` 发布，再 download 核对。

---

## 11. Agent 执行环境踩坑速查（WorkBuddy 托管 shell / 自动发版必读）

> **适用场景**：在 WorkBuddy 托管 shell（CodeBuddy / WorkBuddy 自动化会话）里跑发版流程时。
> 真实终端 / CI 不受影响，可直接用 `bun` / `gh`。
> 下列 7 条是 2026-08~09 两轮自动发版（v1.2.42 / v1.2.50）实测踩出、并验证可用的对策。其他 Agent 照做即可一遍成功，不必重蹈覆辙。

### 11.1 🔴 `git push` / `gh` 报 invalid token（不是你凭据过期）

**现象**：`gh` / `git push` 突然 `invalid token` / `401`，但 keyring 里的 token 明明有效。
**根因**：会话环境被注入了**过期**的 `GH_TOKEN` / `GITHUB_TOKEN` 环境变量，credential helper 优先吃它，盖住 keyring 里的有效 token。
**对策**：所有 git / gh 命令前加 `env -u GH_TOKEN -u GITHUB_TOKEN` 清掉污染变量：
```bash
env -u GH_TOKEN -u GITHUB_TOKEN git push origin master
env -u GH_TOKEN -u GITHUB_TOKEN gh release edit v1.x.x --draft=false
```
**不要**去刷新 token、不要改 remote——那是白费功夫，根因在环境变量不在凭据。

### 11.2 🔴 `bun` / `bunx` 在本机会话 segfault 或卡死

**现象**：`bun run test` / `bunx vue-tsc` / `bun x vite build` 直接 segfault，或 `bun x vite build` 卡死不动。
**根因**：本机 bun 在托管 shell 下不稳定（已知坑，非代码问题）。
**对策**：改用 Node 直跑 `node_modules` 下的 bin（用仓库管理的 node 绝对路径）：
```bash
node node_modules/vitest/vitest.mjs run
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit
node node_modules/vite/bin/vite.js build --outDir .sandbox-build --emptyOutDir
```
（vite 指定 `.sandbox-build` 输出目录，绕开 dist 的 safe-delete 守卫，见 11.3；跑完 `git clean -fd -- .sandbox-build` 清理。）

### 11.3 🟡 `vite build` 清 `dist/` 触发 safe-delete 批量删除守卫

**现象**：`[vite:prepare-out-dir] [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`，构建被拦。
**根因**：vite 构建前 `emptyDir(dist/assets)`，文件数超阈值触发批量删除守卫。仅 WorkBuddy 托管 shell 有，CI / 真实终端无。
**对策**：11.2 已用 `--outDir .sandbox-build --emptyOutDir` 规避；如必须用 dist，则：
```bash
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit && node node_modules/vite/bin/vite.js build --emptyOutDir=false
```

### 11.4 🔴 `gh release download` 对 **draft** release 会卡死（4min+ 不出）

**现象**：release 还是 draft 时就 `gh release download`，命令挂 4 分钟以上不出结果。
**根因**：draft 资产的 URL 是 `untagged-<hash>` 临时路径，下载器一直重试挂死。
**对策**：**先 `gh release edit v1.x.x --draft=false` 发布，再 download**。核对 latest.json、CNB 同步都放在 undraft 之后做。
> 注意 §9.9 的 `untagged-<hash>` URL / by-tag 404 是 draft 的**正常表现**，别误判成 tag 关联失败；但「下载卡死」是另一回事，必须 undraft 后才下。

### 11.5 🔴 CNB 国内镜像：分支是 `main` + OAuth token 只读

**现象**：`cnb` 写操作（建 release / 传附件）报 `403 Forbidden` 或 `409`。
**根因**：① `cnb login` 的 OAuth token 只能**读**，写全 403 → 必须用**个人令牌**；② CNB 仓库默认分支是 **`main`**（GitHub 是 `master`），`--target-commitish` 填错会失败；③ 空仓库建 Release **必填** `--target-commitish`（help 标可选，实际必填）。
**对策**：
```bash
export CNB_TOKEN=$(cat ~/.cnb/personal-token)   # 个人令牌，勿入库
node "C:/Users/<user>/.workbuddy/skills/cnb-publish/scripts/upload-assets.mjs" \
  --repo fzz198479/solo --tag v1.x.x \
  --assets-dir "F:/fzz-Project/md-editor/.sandbox-cnb/assets" \
  --body-file "F:/fzz-Project/md-editor/.sandbox-cnb/body.md" --target-commitish main
```
- **完整性校验**：CNB 上传确认里**没有 sha256**，自算 `sha256sum` 与从 CNB 下载回来的文件比对，三方一致才算妥（本地原文件 = CNB 下载 = `get-release-by-tag` 返回的 `hash_value`）。
- 令牌权限探针：403 = 无写权限（换个人令牌）；409 = 权限正常仅 tag 重复。
- 完整 CNB 踩坑：技能 `~/.workbuddy/skills/cnb-publish/`。

### 11.6 🟡 `release-gate.ps1` 本机会话跑不了

**现象**：`pwsh scripts/release-gate.ps1 -Stage PreTag` 报错（harness 注入的 `$Stage` 与脚本 `param([ValidateSet]$Stage)` 冲突）。
**根因**：自动化会话注入的环境变量与脚本 param 同名冲突。
**对策**：退化为手写命令（即本文件各 Phase 的等价命令），用 11.1~11.4 的 node / env 前置方式逐条执行，效果等同闸门脚本。

### 11.7 ✅ 一遍成功清单（Agent 自动发版最小必做）

照此顺序，无回退：
1. 版本号四源一致并升高（§3）+ 检查无 `replaceAll`（§2.2）
2. `env -u GH_TOKEN -u GITHUB_TOKEN git add/commit/push`
3. 本地三连验证（用 11.2 的 node 命令，非 bun）：`vitest run` ✅ + `vue-tsc --noEmit` ✅ + `vite build` ✅
4. `git tag v1.x.x && env -u GH_TOKEN -u GITHUB_TOKEN git push origin v1.x.x`（tag 指向 bump commit）
5. `gh run watch <id> --exit-status` 等 CI 双绿
6. **先 undraft**：`gh release edit v1.x.x --draft=false`（11.4）
7. 发布后 `gh release download`（不再卡）核 latest.json
8. CNB 同步（11.5，`--target-commitish main` + 个人令牌）+ sha256 三方校验
9. **SECURITY.md 当前版本字段**同步到新版本（易漏项，见 §7.4）—— 别只改三处版本号
10. `git clean -fdx -- .sandbox-*` 清掉沙盒目录，工作树留干净

---

## 10. 附录

### 10.1 常用命令速查

```bash
# 版本号同步验证
Select-String -Path package.json,src-tauri\Cargo.toml,src-tauri\tauri.conf.json -Pattern '"version"|version = "'

# 本地测试
bun run test && bun run build

# 打 tag + 推送
git tag v1.x.x && git push origin v1.x.x

# 删除 tag（本地 + 远程）
git tag -d v1.x.x && git push origin --delete v1.x.x

# 查看 CI 状态
gh run list --workflow=release.yml --limit 1 --json status,conclusion,createdAt

# 查看 release
gh release view v1.x.x

# 发布 draft
gh release edit v1.x.x --draft=false

# 验证 latest.json
gh release download v1.x.x -p "latest.json" -O - 2>$null | ConvertFrom-Json

# 检查 replaceAll 用法
rg "replaceAll|replaceAllAsync" src/
```

### 10.2 CI 工作流文件

`.github/workflows/release.yml` — 触发方式：`git push --tags "v*"`。

关键路径要点：
- 安装器搜索路径：`src-tauri/target/${{ matrix.target }}/release/bundle/nsis/*.exe`
- 签名：`bunx tauri signer sign` + 提取 signature
- Release 创建：`gh release create --draft`（CI 不发布，留给人工确认）

### 10.3 架构决策参考

- **updater 配置**：`tauri.conf.json` → `plugins.updater`
- **签名密钥**：`TAURI_SIGNING_PRIVATE_KEY`（GitHub Secrets）
- **更新检测**：启动时 + 设置页面手动触发
- **UI 模式**：`dialog: true`（Tauri 原生对话框）

详见 `ARCHITECTURE.md` + `BUILD_GUIDE.md`。

### 10.4 发版前手动回归清单（功能验证）

> 原 `RELEASE-CHECKLIST.md` 已并入此处（2026-07-21 文档规范化），避免发版清单与流程脱节。在 `bun run test && bun run build` 通过后，发版前逐项手动过一遍，约 5 分钟，堵住 80% 的漏网 Bug。

**基础**

- [ ] 测试：`bun run test` 全绿
- [ ] 编译：`vue-tsc --noEmit` → `vite build` → `cargo check` 全过

**功能回归（修什么测什么 + 关联面）**

- [ ] **新建空白文档** — 打开即写，无报错
- [ ] **新建文档 → 贴图 → 保存 → 关闭 → 重新打开** → 图片正常显示
- [ ] **打开已有文档（含 base64 旧图）** → 旧图不裂
- [ ] **打开已有文档（含 assets/ 相对路径新图）** → 新图不裂
- [ ] **跨文件切换** → 图片正常切换

**路径/存储**

- [ ] **未保存文档** 拖图/贴图 → 提示先保存
- [ ] **已保存文档** 拖图 → 存到 `assets/` → 相对路径写入
- [ ] **已保存文档** 贴截图 → 存到 `assets/` → 相对路径写入
- [ ] **自定义存储路径** 贴图 → 走 `asset://` 协议 → 正常显示
- [ ] **重命名文档** → `assets/` 目录下的图片引用是否同步（不要求自动迁移，检查是否有预期行为）

**边界**

- [ ] **超长文档** 打开/保存/滚动 — 不卡死
- [ ] **图片文件缺失**（手动删了 assets/xxx.png） → 显示裂图而不是崩溃
- [ ] **特殊字符路径**（文档名含中文/空格/括号） → 图片正常解析

**升级/安装**

- [ ] **通过自动更新安装**（打 tag 走 CI Release）→ 功能正常
- [ ] **NSIS 全新安装** → 首次启动无异常
