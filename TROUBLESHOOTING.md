# solo 运行故障排查指南

> 面向**用户**的运行时问题排查，非编译问题（编译问题见 `BUILD_GUIDE.md`）。

## 安装后问题

### 1. 右键「新建」菜单出现两个 Markdown 项

**原因**：旧版本（v1.2.2 及之前）注册了 `.markdown` 和 `.md` 两个 ShellNew。
**解决**：
1. 打开注册表编辑器 `regedit`
2. 删除 `HKCU\Software\Classes\.markdown\ShellNew`（如果有）
3. 确认 `HKCU\Software\Classes\.md\ShellNew` 存在且包含 `NullFile` 键（空值）
4. 重启 Explorer 或重启电脑

**根治**：v1.2.3+ 已在安装时自动清理 `.markdown\ShellNew`，只需**卸载旧版 → 重启 → 安装新版**。

### 2. `.md` 文件图标显示为空白/默认图标

**原因**：Tauri 默认不写入 DefaultIcon 的 `,0` 索引后缀。
**解决**：
1. 重新运行最新安装包（v1.2.3+）
2. 或者手动检查注册表：
   - `HKCU\Software\Classes\solo.markdown\DefaultIcon\`(默认) 值应为 `C:\path\to\solo.exe,0`
   - 如果缺少 `,0`，手动添加

**根治**：安装包在 `NSIS_HOOK_POSTINSTALL` 中自动追加 `,0`。

### 3. 安装后 `.md` 文件关联不生效（双击不打开）

**原因**：Windows 文件关联优先级：`UserChoice` > `OpenWith` > `ProgID`。Tauri 写入的关联可能被其他程序覆盖。
**解决**：
1. 右键 `.md` 文件 → 打开方式 → 选择 solo
2. 勾选「始终使用此应用打开 .md 文件」
3. 重启 solo，启动时会调用 `register_shell_new` 刷新关联

## 编辑器问题

### 4. 编辑器一直空白/不显示内容

**原因**：编辑器懒加载机制——`MarkdownEditor.vue` 只有在窗口获得焦点时才会创建 TipTap 实例。
**触发条件**：窗口已显示但一直未激活（如被 Windows 前景锁压制）。
**解决**：单击编辑器区域空白处即可触发 `lazyInitEditor`。

### 5. 编辑器工具栏「导出 PDF」按钮名称成了「打印」

**设计如此**：v1.2.0+ 已将名称修改为「打印」，因为实际调用的是浏览器打印功能而非真正的 PDF 生成。

## 窗口/进程问题

### 6. 关闭所有窗口后进程不退出

**原因**：solo 使用单实例（`tauri-plugin-single-instance`），主进程不会自动退出。
**解决**：从菜单选择「退出」→ 会调用 `app.exit(0)` 强制退出。如果菜单点了没反应，检查：
- 版本是否 v1.2.0+（旧版缺少 `exit_app` 命令）
- 任务管理器中有没有残留 `solo.exe` 进程

### 7. 编辑器内容丢失/未保存

solo 有自动保存机制（文档修改后 2s 自动保存）。如果遇到内容丢失：
1. 检查 `%APPDATA%\solo\documents\` 目录下是否存在 `.md` 文件
2. 检查 `%APPDATA%\solo\settings.json` 中 `documents` 字段是否包含最近的文档路径
3. 自动保存文件与编辑文件为同一路径（原地保存），非临时副本

崩溃时 `.tmp` 文件的清理尚未实现。

## 注册表参考

| 路径 | 作用 |
|---|---|
| `HKCU\Software\Classes\.md` | .md 扩展名关联 |
| `HKCU\Software\Classes\.md\ShellNew` | 右键新建菜单（NullFile） |
| `HKCU\Software\Classes\.markdown` | .markdown 扩展名关联（建议删除 ShellNew） |
| `HKCU\Software\Classes\solo.markdown` | 自定义 ProgID |
| `HKCU\Software\Classes\solo.markdown\DefaultIcon` | 文件图标路径（必须 `,0` 结尾） |
| `HKCU\Software\Classes\solo.markdown\shell\open\command` | 双击打开命令 |
| `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\solo` | 卸载信息 |
