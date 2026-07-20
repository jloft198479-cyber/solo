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
10. [附录](#10-附录)

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
[ ] 11. 在已安装版本上验证自动更新
[ ] 12. 更新项目文档（PROFILE.md 版本历史）
```

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

在 `PROFILE.md` 的「版本历史」章节追加新版本记录：

```markdown
| 1.x.x | **简要描述**：主要变更摘要 |
```

同时更新 `BUILD_GUIDE.md` 中的版本号示例（如果有硬编码）。

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
