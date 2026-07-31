# docs/font-handling.md — solo 字体处理经验手册

> **受众**：接手者 / agent / 未来排查字体问题的任何人。
> **性质**：专题深度文档（不是索引表）。已知问题速查见 [`KNOWN-ISSUES.md`](./KNOWN-ISSUES.md)，本文件是它关于字体条目的「展开版」。
> **写作背景**：2026-07 字体问题前后折腾了一整天多、调动多个 agent 并发仍未彻底解决，最终定位到渲染层 CORS 拦截 + 字体资源错配两层叠加。此问题**敏感、易复发**，故沉淀此手册，下次遇到「字体不显示」先读本文，别从零排查。
> **真理源纪律**：本文以代码为准（[`fontLoader.ts`](../src/services/fontLoader.ts) / [`tauri/font.ts`](../src/services/tauri/font.ts) / [`commands/font.rs`](../src-tauri/src/commands/font.rs) / [`constants/fonts.ts`](../src/constants/fonts.ts) / [`utils/fontStack.ts`](../src/utils/fontStack.ts)）。文档若与代码不符，**以代码为准并更新本文**。

---

## 0. 一句话结论

字体"下载/缓存"通道一直都是通的；真正的雷在**最后一步把字节喂给屏幕**——Tauri 的 `asset://` 协议不返回 CORS 头，而字体是 CORS 保护资源，浏览器**静默拒收**且**不报错**。正确解法是走 IPC 把字体字节取回、用 `new FontFace(family, bytes)` 同源加载。另一条隐藏雷是**字体文件资源错配**（文件名 ≠ 文件内部的真实 family 名）。

---

## 1. 字体系统的正确逻辑（当前正确答案）

### 1.1 四层链路

```
[L1] Rust 下载 / 校验 / 缓存          src-tauri/src/commands/font.rs
        │  (reqwest 下载 → validate_font_bytes 校验 → 落盘 font-cache)
        ▼
[L2] IPC 封装（前端唯一入口）          src/services/tauri/font.ts
        │  (fetchFontData / getCachedFontPath / readFontBytes / saveCachedFont)
        ▼
[L3] 前端加载逻辑                      src/services/fontLoader.ts
        │  (ensureFontLoaded → readCache → downloadAndCache → registerFontFromBytes)
        ▼
[L4] 渲染：字节 → FontFace → 屏幕      WebView2
        (new FontFace(family, bytes) → document.fonts.add → CSS 引用)
```

辅助层（不是加载链路，但必须对齐）：
- **字体清单** [`constants/fonts.ts`](../src/constants/fonts.ts)：`FONT_OPTIONS` 每项含 `value`(CSS/FontFace 注册名) 与 `fileName`(下载文件名)。
- **字体栈生成** [`utils/fontStack.ts`](../src/utils/fontStack.ts)：`buildFontStack(primary, ...)` 把选中字体拼成 CSS `font-family` 回退串。

### 1.2 关键不变量（改字体代码前先背熟）

| # | 不变量 | 说明 |
|---|---|---|
| I1 | **`value` 必须严格等于字体文件内部的真实 family 名** | FontFace 注册名 = 文件内部 name 表里的 family。`value` 配错 → 注册失败 / 显示 fallback。文件名（`fileName`）可随意，与 `value` 解耦。 |
| I2 | `fileName` 用于缓存落盘 + 下载 URL，与 `value` 解耦 | 改 `value`（如对齐 Lite 真名）**不要**动 `fileName`，否则旧缓存 / release 链接全部失效。 |
| I3 | 渲染只走字节通道：`readFontBytes` → `new FontFace(family, bytes)` | **禁止**在渲染层用 `asset://` 的 `@font-face src:url()`（见 §2.1）。 |
| I4 | 下载通道固定为 GitHub release `fonts-v1` tag | `DOWNLOAD_BASE` 写在 `fontLoader.ts`，与 app 版本号解耦——app 升版无需动字体链接。 |
| I5 | 缓存目录 = `app_local_data_dir()/font-cache` | 真实路径 `C:\Users\<user>\AppData\Local\com.solomarkdown\font-cache`。 |
| I6 | 下载/读取必经 `validate_font_bytes` | magic bytes（OTTO/TTF）+ 表目录 offset+length ≤ 文件大小，拒绝截断文件入缓存。 |

### 1.3 数据流时序（以「切到思源宋体」为例）

1. 用户在设置选「思源宋体」→ 前端存 `value = "Noto Serif SC"`。
2. 编辑器渲染时调用 `ensureFontLoaded("Noto Serif SC")`。
3. `readCache` → `getCachedFontPath(family, fileName)` 问 Rust 缓存路径。
4. 命中 → `readFontBytes(family, fileName)` 经 IPC 取回字节数组（同源，绕 CORS）。
5. `registerFontFromBytes`：`new FontFace("Noto Serif SC", bytes)` → `await face.load()` → `document.fonts.add(face)`。
6. `document.fonts.check('16px "Noto Serif SC"')` 应返回 `true`，正文即显示该字体。
7. 未命中缓存 → `downloadAndCache`：Rust `fetch_font_data`（reqwest 走系统代理）→ 落盘 → 回到 3。

**Console 正确信号**：`[fontLoader] registerFontFromBytes: family="Noto Serif SC", status="loaded", check=true`。

---

## 2. 致命错误路径（踩过的坑，下次别再走）

> 每条都带「为什么错 / 表现 / 正确做法」。这些都是真金白银试出来的。

### 2.1 asset:// 协议 CORS 静默拦截（最阴，核心元凶）

- **错误做法**：`@font-face { src: url("asset://...") }` + `document.fonts.load()`。
- **为什么错**：Tauri 的 asset protocol **不返回 `Access-Control-Allow-Origin` 头**；而 CSS 字体是 CORS 保护资源，浏览器据此**静默拒收**，且 `fontFace.load()` **不抛异常**、`document.fonts.check()` 只悄悄返回 `false`。
- **表现**：缓存文件大小完整、magic 正确（字节好好躺在磁盘），但字体**死活显示不出来**；没有任何报错可追。这就是「下载完成却显示不出来」的真身。
- **正确做法**：`readFontBytes`（IPC 取字节）→ `new FontFace(family, bytes)` 同源加载（见 §1.3）。
- **历史教训**：`read_font_bytes` 这个 Rust 命令 + IPC 封装早在 v1.2.33 就写好了（基础设施齐备），但**渲染层一直没接上**，长期是死代码。下次看到「有现成正确通道却没人用」，优先怀疑渲染层是不是还走老路。

### 2.2 字体文件资源错配（霞鹜文楷 = Lite 轻便版）

- **现象**：其他 4 个下载字体都正常，独独「霞鹜文楷」字形不对。
- **根因**：备份源 `LXGWWenKai-Regular.ttf` 文件名写着 `Regular`，但文件内部真实 family 名是 **`LXGW WenKai Lite`**（霞鹜文楷轻便版）。代码 `value='LXGW WenKai'` 与文件内部名不符 → FontFace 注册的字体和磁盘实际字体对不上。
- **为什么排查绕了远路**：所有 agent（包括早期 Buddy）都在查「下载通道 / CORS / 代码逻辑」，没人第一步去**验证字体文件内部到底是不是它声称的那个字体**。
- **正确做法**：改字体前，用工具解析字体文件 name 表确认真实 family 名（node 读 ttf/otf 的 name 表，或 fonttools）。对齐时同步改 `fonts.ts` 的 `value` + `fontStack.ts` 的匹配分支（见 §4.2）。
- **判定信号**：用 `FontFace` 注册后 `status` 是 `loaded` 但字形明显异于预期（笔画更细/更粗），优先怀疑资源错配而非通道问题。

### 2.3 单元测试假绿（happy-dom 不模拟真实 WebView2）

- **现象**：改了好几版字体逻辑，Vitest 全过，发版/本地跑还是不显示。
- **根因**：solo 测试是 Vitest + happy-dom（**模拟**浏览器），它**不模拟真实 WebView2 的 CORS 行为**，也**不真渲染字体**。测了假的层，拿到虚假安全感。
- **教训**：字体修复**必须真窗口验证**（见 §3）。单元测试只能保「没把别的逻辑改坏」，保不了「字体真显示」。这是「改了好多版还不行」的隐藏原因之一。

### 2.4 缓存 key 回归（v1.2.27 → v1.2.28）

- **错误**：早期用 `family`（如 `"Noto Serif SC"`，无扩展名）作缓存文件名；v1.2.28 改 `fileName`（含扩展名）后，旧缓存无法被新代码识别（key 不匹配），被迫重新下载。
- **当前状态**：已用 `fileName` 落盘，并保留对旧 `family` 名的兼容迁移（`get_cached_font_path` / `read_font_bytes` 都先查新名再查旧名）。新增字体务必保证 `fileName` 字段对齐，别再引入二次映射。

### 2.5 GitHub release 字体被截断（四版修复无效的历史）

- **现象（历史）**：上传到 `fonts-v1` 的字体文件本身被截断，导致连续四版修复都无效。
- **防线**：`validate_font_bytes` 现在在下载后、读取时都拦一道——文件过小 / magic 不对 / 表目录越界（offset+length > 文件大小）一律拒绝入缓存。
- **排查习惯**：用户报「下载失败」时，第一动作是看 `font-cache` 里对应文件的**大小与 magic**，而不是先改代码。截断文件大小会明显小于真身（如汇文 912KB vs 真身 16.6MB）。

### 2.6 80MB 内置方案（方向性错误，已否）

- **曾想**：把字体打包进 `src-tauri/resources/fonts/`（73MB），随安装包分发、彻底绕开下载。
- **被否**：solo 定位轻量级，安装包 80MB 绝对不行；且「下载 vs 内置」在字节层面无区别——下载通道本来就是通的，问题不在「能不能下下来」，在「下下来怎么喂给屏幕」。
- **结论**：修渲染层（§2.1）即可，无需内置。这条弯路说明：定位不清时容易把「加资源」当解药，实则南辕北辙。

### 2.7 失败不报警的链路段

- **本质**：字体四层（下载 / 缓存 / 读取 / 渲染）任一层断，**用户看到的现象完全相同**——「字体没显示」。无法靠肉眼区分是下载失败、缓存 miss、还是渲染被 CORS 拦。
- **对策**：每层都打 `[fontLoader]` 前缀日志（已实施），排查时一眼看出走到底哪一层。不要凭「感觉是下载问题」就改下载层。

---

## 3. 验证方法论（字体修复的唯一真相）

> **单测全绿 ≠ 字体真能显示。** 只有真窗口肉眼 + Console 才算数。

### 3.1 真窗口验证步骤

```powershell
# 配齐 Rust + MSVC 环境（普通 PowerShell 默认缺，Trae 终端通常自带，可跳过）
$env:PATH="M:\rust\.cargo\bin;M:\VS\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64;C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64;"+$env:PATH

cd F:\fzz-Project\md-editor
bun run dev:tauri:inspect   # :inspect 会设 SOLO_OPEN_DEVTOOLS=1 自动开开发者工具
```

1. 窗口起来 → 设置 → 外观 → 字体选一个**下载型**字体（思源宋体 / 汇文明朝 / 霞鹜文楷 Lite / 朱雀仿宋 / 小赖字体）。**别选「系统默认 / 微软雅黑 UI」**（系统字体不走加载逻辑）。
2. 看正文是否真的变成对应字形。
3. Console 筛 `fontLoader`，应见：
   ```
   [fontLoader] registerFontFromBytes: family="...", status="loaded", check=true
   ```
   - `status="loaded"` 且 `check=true` → ✅ 修复生效。
   - 出现旧的 `registerFont:` / `asset://` 字样，或 `check=false` → ❌ 没生效，贴完整日志。

### 3.2 验证「清空后重新下载也通」

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\com.solomarkdown\font-cache"
bun run dev:tauri:inspect
```
再重复 §3.1。下完看 `registerFontFromBytes status="loaded"` 确认下载链路也通。

### 3.3 字体文件自检清单（加/换字体前必做）

- [ ] 解析字体文件 **name 表**，确认内部真实 `family` 名（不要信文件名）。
- [ ] 确认 `value` 与内部 family 名**逐字符一致**（含大小写、空格）。
- [ ] 确认 `fileName` 与 GitHub `fonts-v1` 上的实际文件名一致。
- [ ] 本地 `font-cache` 中该文件大小 ≈ 真身、magic 正确（OTTO / `00 01 00 00`）。

---

## 4. 改字体 / 加字体的正确操作清单

### 4.1 新增一个下载型字体

1. 拿到字体文件 → 解析内部 family 名（见 §3.3）。
2. [`constants/fonts.ts`](../src/constants/fonts.ts)：在 `FONT_OPTIONS` 加一项 `{ value: '<内部真实family名>', label: '<中文展示名>', fileName: '<下载文件名>' }`。
3. [`utils/fontStack.ts`](../src/utils/fontStack.ts)：在 `buildFontStack` 加该 `value` 的匹配分支与回退字体（如楷体类 → 楷体 fallback）。
4. 把字体文件上传到 GitHub `fonts-v1` release（上传后**必须校验字节大小/magic**，防 §2.5 截断）。
5. 真窗口验证（§3.1）+ 清空重下验证（§3.2）。

### 4.2 改名 / 对齐字体（如 Lite 事件）

- 必须**同步**改两处，否则 fallback 链错位：
  - `fonts.ts` 的 `value`（与文件内部名对齐）。
  - `fontStack.ts` 的匹配分支（`if (primary === '...')`）。
- `fileName` **不要动**（牵动缓存 key + release 链接，见 I2）。
- 注意：旧设置里存的是旧 `value`，改后旧值匹配不上 `REMOTE_FONTS` → 不加载。需提示用户去设置**重新选一次**新下拉项（YAGNI：未引入自动迁移代码）。

### 4.3 绝对红线

- **绝不在渲染层用 `asset://` 的 `@font-face src:url()` 加载字体**（§2.1）。
- **绝不在 `value` 里写文件名 / 中文 label**（FontFace 注册名必须是文件内部真实 family 名，I1）。
- **绝不为「字体不显示」盲目加内置 80MB 资源**（§2.6），先查渲染层 CORS。

---

## 5. 排查决策树（下次遇到「字体不显示」）

```
字体不显示
  │
  ├─ 看 font-cache 文件：大小/magic 对吗？
  │     ├─ 不对（过小/截断）→ 下载链路或 release 截断问题（§2.5）→ 清缓存重下 / 重传 release
  │     └─ 对（完整）→ 继续
  │
  ├─ Console 搜 [fontLoader]，看走到底哪层：
  │     ├─ 无日志 → 字体根本没触发加载（设置值/调用问题）
  │     ├─ readCache 无 cachedPath → 缓存 key 不对（§2.4）
  │     ├─ readFontBytes 后 registerFontFromBytes 没出现 → IPC/字节读取断
  │     └─ registerFontFromBytes status≠loaded 或 check=false → 渲染层（§2.1）或资源错配（§2.2）
  │
  └─ 字形变了但「不对」（如变细）→ 资源错配（§2.2），解析文件内部 family 名对齐
```

---

## 6. 为什么这玩意儿这么敏感（反思）

字体问题之所以「史诗级难」，是多层脆弱性**叠加**，而它们**表现完全相同**：

1. **WebView2 CORS**：字体是 CORS 保护资源，跨源加载有硬约束。
2. **Tauri asset 协议不回 CORS 头**：用 `asset://` 喂字体天然被拦，且失败不报警。
3. **失败静默**：`document.fonts.check` 只返回 `false`，不抛错，无从定位。
4. **单测假绿**：happy-dom 不模拟 CORS / 不真渲染，测了假的层。
5. **资源可能错配**：文件名 ≠ 文件内部 family 名，肉眼难辨。
6. **缓存 key 历史包袱**：版本迁移留下 key 不一致，旧缓存 miss。

任何一环断，现象都是「没显示」。所以**排查纪律是：先用文件大小/magic + 分层日志把断点钉死在某一层，再动手**，而不是在下载层反复横跳（这正是前期多 agent 并发低效的根因）。

---

## 7. See also

- [已知问题与技术债（字体条目索引）](./KNOWN-ISSUES.md)
- [调试指南](./debugging.md)
- [bug 易发区地图（ARCHITECTURE §11）](../ARCHITECTURE.md)
- [文档索引与术语表](./INDEX.md)
- 核心代码：[`fontLoader.ts`](../src/services/fontLoader.ts) · [`tauri/font.ts`](../src/services/tauri/font.ts) · [`commands/font.rs`](../src-tauri/src/commands/font.rs) · [`constants/fonts.ts`](../src/constants/fonts.ts) · [`utils/fontStack.ts`](../src/utils/fontStack.ts)
