# 接入 Tauri 自动更新（Auto Updater）

## 目标
用户打开旧版 Solo 时，自动检测 GitHub Releases 上的新版本，一键下载安装。

## 涉及文件

| 文件 | 操作 |
|------|------|
| `src-tauri/Cargo.toml` | 加 `tauri-plugin-updater` 依赖 |
| `package.json` | 加 `@tauri-apps/plugin-updater` |
| `src-tauri/tauri.conf.json` | 加 `updater` 配置段 |
| `src-tauri/capabilities/default.json` | **创建**（缺失）并加 updater 权限 |
| `src-tauri/src/lib.rs` | 注册 updater 插件 |
| 前端代码（推荐） | 加更新检查按钮或自动提示 |
| `.github/workflows/release.yml` | **创建**——自动编译+上传 Release |
| 签名密钥（新生成） | `tauri signer generate` 生成并配置 |

---

## 操作步骤

### 1. 生成签名密钥

在项目根目录执行：

```powershell
cd F:\fzz-Project\md-editor\md-editor
bun run tauri signer generate -w src-tauri/.tauri/updater.key
```

这会生成两个文件：
- `src-tauri/.tauri/updater.key` —— 私钥，**切勿提交到 git**，需在 `.gitignore` 追加一行 `src-tauri/.tauri/`
- `src-tauri/.tauri/updater.key.pub` —— 公钥，需配置到 `tauri.conf.json`，**可以提交到 git**

执行后，把 `.pub` 文件的内容记下来（是一串 base64 字符串），下一步要用。

### 2. 配置 tauri.conf.json

在 `"plugins"` 对象里加 `updater` 配置（已有其他插件，追加即可）：

```jsonc
{
  // ... 保持现有内容不变 ...
  "plugins": {
    "updater": {
      "active": true,
      "dialog": true,                        // 使用 Tauri 内置更新弹窗（推荐）
      "pubkey": "你的公钥内容（从 .pub 文件复制）",
      "endpoints": [
        "https://github.com/jloft198479-cyber/solo/releases/latest/download/latest.json"
      ]
    },
    // ... 保持现有 fs / cli 插件不变 ...
  }
}
```

### 3. 创建 capabilities/default.json

创建 `src-tauri/capabilities/default.json`：

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability set",
  "windows": ["main", "editor-*"],
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:default",
    "clipboard-manager:default",
    "store:default",
    "window-state:default",
    "updater:default",
    "updater:allow-check",
    "updater:allow-download-and-install"
  ]
}
```

### 4. 改 Cargo.toml

在 `[dependencies]` 里追加一行：

```toml
tauri-plugin-updater = "2"
```

### 5. 改 package.json

在 `dependencies` 里追加：

```json
"@tauri-apps/plugin-updater": "^2.11.0"
```

### 6. 改 lib.rs

在 `pub fn run()` 函数中，`tauri::Builder::default()` 的链式调用里注册插件：

```rust
.plugin(tauri_plugin_updater::Builder::new().build())
```

按字母序加到 `.plugin(tauri_plugin_store::...)` 前面或后面都可以，保持一致风格即可。

### 7. 安装依赖 + 编译验证

```powershell
bun install
bun run build:tauri
```

如果能编译通过，说明 Rust 侧和前端侧配置正确。

### 8. 创建 GitHub Actions 自动发布工作流

创建 `.github/workflows/release.yml`：

```yaml
name: Release
on:
  push:
    tags: ["v*"]

jobs:
  release:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: windows-latest
            target: x86_64-pc-windows-msvc
            bundle: nsis

    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - uses: oven-sh/setup-bun@v2

      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}

      - name: Install Windows deps
        if: matrix.platform == 'windows-latest'
        run: |
          choco install webview2-dev -y

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Import signing key
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: echo "KEY_IMPORTED=true"

      - name: Build and upload
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "v__VERSION__"
          releaseBody: "请查看 RELEASE_NOTES.md 了解本次更新内容。"
          releaseDraft: true
          includeDebug: false
          args: --target ${{ matrix.target }}
```

### 9. 配置 GitHub Secrets

在 GitHub 仓库页面，Settings → Secrets and variables → Actions → New repository secret，添加以下内容：

| Secret 名称 | 值 |
|-------------|-----|
| `TAURI_SIGNING_PRIVATE_KEY` | `src-tauri/.tauri/updater.key` 的完整文本内容 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成密钥时输入的密码（如果有） |

### 10. 发布新版本（以后每次发版流程）

```powershell
# 1. 更新版本号（tauri.conf.json + Cargo.toml + package.json 中的 version）
# 2. 提交代码
git add .
git commit -m "v1.2.8: ..."
git tag v1.2.8
git push origin main --tags
```

推送 tag 后 GitHub Actions 会自动编译、签名、生成 `latest.json` 更新清单、上传 Release Draft。去 GitHub Releases 页面检查结果，确认无误后手动发布。

---

## 前端推荐：添加检查更新按钮

在 Solo 的「设置」界面加一个"检查更新"按钮。

在 `src-tauri/src/commands/` 新建 `update.rs`（可选），或在现有组件中直接调用 Tauri API：

```typescript
import { check } from '@tauri-apps/plugin-updater';
import { ask } from '@tauri-apps/plugin-dialog';

async function checkForUpdate() {
  const update = await check();
  if (update?.available) {
    const yes = await ask(`发现新版本 ${update.version}，是否下载更新？`, {
      title: '软件更新',
      kind: 'info',
    });
    if (yes) {
      await update.downloadAndInstall();
    }
  } else {
    // 提示"当前已是最新版本"
  }
}
```

如果 `tauri.conf.json` 中设了 `"dialog": true`，Tauri 会弹出系统原生更新对话框，前端不写这段代码也能用。

---

## 注意事项

1. **私钥安全**：`updater.key` 绝不能提交到 git。GitHub Secrets 是私钥的正式托管位置。
2. **密码**：生成密钥时如果设置了密码，GitHub Secrets 里的 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 要对应。
3. **版本号规范**：必须遵循 semver（`v1.2.8`、`v1.3.0` 等），且所有配置文件中的版本号要一致。
4. **首次发布**：第一个带 updater 的版本（v1.2.8）发布后，用户需要手动下载安装一次。之后的版本（v1.2.9+）才会自动检测更新。
5. **Windows 签名**：NSIS 安装包目前没有代码签名证书（Authenticode）。没有签名不影响自动更新功能，但 Windows SmartScreen 可能会弹警告。这不是自动更新本身的问题，属于可选增强。
