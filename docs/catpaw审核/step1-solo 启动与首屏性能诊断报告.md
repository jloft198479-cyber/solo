# **solo 启动与首屏性能诊断报告**

## **维度 1：窗口显示时序链路**

### **完整调用链**

!\[\]\(data:image/svg+xml;charset\=utf-8,%3Csvg%20viewBox%3D%220%200%2024%2024%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20style%3D%22width%3A100%25%3Bheight%3A100%25%22%3E%3Cpath%20d%3D%22M13%209h5.5L13%203.5V9M6%202h8l6%206v12a2%202%200%200%201-2%202H6a2%202%200%200%201-2-2V4c0-1.11.89-2%202-2m9%2016v-2H6v2h9m3-4v-2H6v2h12z%22%20fill%3D%22%2342a5f5%22%2F%3E%3C%2Fsvg%3E\)

plaintext

```plaintext
【Rust】tauri::Builder::default()
  ├─ 注册 7 插件（opener/dialog/clipboard/cli/store/updater/window-state）── 同步，Builder 链
  ├─ setup():
  │    ├─ manage 4 个 state ──────────── 同步，trivial
  │    ├─ env::args + open_paths_from_args ── 同步，内存操作
  │    ├─ app.cli().matches() ────────── 同步，CLI 解析
  │    ├─ menu::setup_menu() ─────────── ⚠️ 同步 FFI 密集（5 子菜单 ~20 MenuItem）
  │    ├─ attach_menu_events() ───────── 同步
  │    ├─ main_window.set_decorations(false) + attach_window_events() ── 同步
  │    └─ flush_startup_log() ────────── 同步文件 I/O（create_dir_all + 写盘）
  │
  ├─ WebView 加载 index.html（主窗口在 setup 前由 tauri.conf 创建，visible:false + transparent:true）
  │
  ▼ Vue mount → App.vue onMounted
【前端】await settingsStore.initThemeOnly()     ── ① 读 settings.json（IPC + 磁盘，串行）
  │      await windowSession.setup()
  │        ├─ title watcher（sync）
  │        ├─ await listenWindowCloseRequested()  ── ② IPC listener 注册（串行）
  │        ├─ await startupReady() ──────────────── ③ IPC → Rust window.show()  ← ★窗口可见
  │        ├─ handleOpenPayload() ── 打开启动文件（磁盘读，show 之后）
  │        └─ setupDragDrop() / registerShellNew()
  ▼ 窗口可见后
        Promise.all([settingsStore.init(), syncMenuShortcuts()]) + autoCheckForUpdate()

```

### **同步阻塞点与预估耗时**

| **位置**                         | **类型**                                          | **预估**         |
| ------------------------------ | ----------------------------------------------- | -------------- |
| Rust 菜单构建 `build_menu`         | 同步 FFI（\~20 项 × 多次调用）                           | 低（\<5ms）       |
| `flush_startup_log`            | 同步文件写                                           | 低（\<1ms）       |
| 前端 ①initThemeOnly              | 串行 IPC + 磁盘读（**全量读 settings.json**，虽只取主题字段）     | 中（几 ms\~十几 ms） |
| 前端 ②listenWindowCloseRequested | 串行 IPC roundtrip，**与 startupReady 无依赖却先 await** | 中（几 ms）        |
| 前端 ③startupReady               | 串行 IPC → show                                   | 中（几 ms）        |

### **关键观察**

- `window.show()` 位于 `startup_ready` 命令**第 33 行、返回 payload 之前**——窗口显示不等待文件打开，设计正确。✅
- 但 show\(\) 之前存在 **3\~4 个串行 IPC roundtrip**（store 读 → close listener → startupReady），每个 WebView2 IPC 往返几 ms，累计是 show 延迟的一部分。
- `listenWindowCloseRequested` 与 `startupReady` 无数据依赖，串行 await 不必要（可并行）。不过防"窗口极早关闭"竞态需保持 listener 先注册，属安全考量。

---

## **维度 2：前端初始化两阶段划分**

### **职责边界**

- **initThemeOnly**：只读 `activeThemeId` 字段 + `applyCurrentTheme`。职责清晰，无 watcher、无回写。✅
- **initFull**（`init()` 内部）：并行读全量设置 + focusMode → normalize → 版本不符时回写 → `isLoaded=true` → startWatchers → initTheme → initFocusMode → initAlwaysOnTop。✅

### **onMounted 串行等待**

!\[\]\(data:image/svg+xml;charset\=utf-8,%3Csvg%20viewBox%3D%220%200%2024%2024%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20style%3D%22width%3A100%25%3Bheight%3A100%25%22%3E%3Cpath%20d%3D%22M13%209h5.5L13%203.5V9M6%202h8l6%206v12a2%202%200%200%201-2%202H6a2%202%200%200%201-2-2V4c0-1.11.89-2%202-2m9%2016v-2H6v2h9m3-4v-2H6v2h12z%22%20fill%3D%22%2342a5f5%22%2F%3E%3C%2Fsvg%3E\)

plaintext

```plaintext
await initThemeOnly()              // 串行
await windowSession.setup()        // 串行（内部又含 3 个串行 IPC）
await Promise.all([init(), syncMenuShortcuts()])  // 窗口可见后，✅ 正确
autoCheckForUpdate()

```

### **评估**

- **"主题先行、功能后置"意图已真实实现**：show\(\) 之前只做主题 + 窗口会话必需项，完整配置在可见后并行加载。✅
- 首屏非必需、但被串行 await 住的操作：`listenWindowCloseRequested`（见 D1）。
- 风险点：`initThemeOnly` 用 `readStoredSettings` 读取的是**完整 settings.json**（不只主题），文件虽小（KB 级）影响低，但语义上可以只读主题键。

---

## **维度 3：编辑器实例创建时机**

### **触发条件与实际行为**

!\[\]\(data:image/svg+xml;charset\=utf-8,%3Csvg%20viewBox%3D%220%200%2024%2024%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20style%3D%22width%3A100%25%3Bheight%3A100%25%22%3E%3Cpath%20d%3D%22M3%203h18v18H3V3m4.73%2015.04c.4.85%201.19%201.55%202.54%201.55%201.5%200%202.53-.8%202.53-2.55v-5.78h-1.7V17c0%20.86-.35%201.08-.9%201.08-.58%200-.82-.4-1.09-.87l-1.38.83m5.98-.18c.5.98%201.51%201.73%203.09%201.73%201.6%200%202.8-.83%202.8-2.36%200-1.41-.81-2.04-2.25-2.66l-.42-.18c-.73-.31-1.04-.52-1.04-1.02%200-.41.31-.73.81-.73.48%200%20.8.21%201.09.73l1.31-.87c-.55-.96-1.33-1.33-2.4-1.33-1.51%200-2.48.96-2.48%202.23%200%201.38.81%202.03%202.03%202.55l.42.18c.78.34%201.24.55%201.24%201.13%200%20.48-.45.83-1.15.83-.83%200-1.31-.43-1.67-1.03l-1.38.8z%22%20fill%3D%22%23ffca28%22%2F%3E%3C%2Fsvg%3E\)

javascript

```javascript
// MarkdownEditor.vue onMounted
if (document.hasFocus()) {
  createEditor(props.initialContent || '');   // 快速路径：立即同步创建
} else {
  setTimeout(() => lazyInitEditor(), 50);      // 兜底：50ms 后强行创建
}

```

**关键发现**：主窗口启动场景下 `document.hasFocus()` 几乎恒为 true（窗口刚创建即获焦），**懒初始化实际上极少生效**——编辑器在 async chunk 加载完成后立即同步创建，而非等到用户首次点击/聚焦。

### **createEditor 的同步重操作**

1. `createEditorExtensions()`：实例化 **32 个扩展**，其中 `CustomCodeBlock` **静态 import lowlight + 17 个 highlight.js 语言**（js/ts/python/bash/json/markdown/xml/yaml/sql/css/rust/go/java/cpp/php/ruby…）——这是编辑器里最大的静态重依赖
2. `new TiptapEditor()`：schema 构建 + 全部插件初始化
3. `parseMarkdown()`：markdown-it 分词 + 构建 PM Doc（大文档时开销显著）
4. `e.commands.focus('start')` + `emitImmediateStats`（立即全量遍历提取大纲/字数）

### **与显示链路的竞争**

MarkdownEditor 是 `defineAsyncComponent`，**App 首帧渲染即触发 chunk 加载**（activeViewMode 默认 'editor'）。chunk 到达后其模块求值（lowlight 注册 17 语言、markdown-it、TipTap）与 createEditor 全部在主线程同步执行——**与 onMounted 的 IPC await 链（initThemeOnly → startupReady）争抢同一主线程**。若 chunk 求值耗时数百 ms，会直接延迟 `startupReady` 续体 → 延迟 `window.show()`。

**结论：编辑器创建是"异步 chunk、同步执行"，且与窗口显示竞争主线程——首屏最大的黑盒环节。**

---

## **维度 4：Rust 侧 setup 耗时分布**

### **注册操作清单**

| **操作**            | **类型** | **是否 I/O/网络**                                               | **主线程同步？** |
| ----------------- | ------ | ----------------------------------------------------------- | ---------- |
| 7 个插件注册           | 构造器链   | window-state 在窗口创建时同步读状态文件（setup 前）；updater 仅构造 builder，无网络 | 是          |
| 4 个 managed state | 内存     | 否                                                           | 是          |
| CLI args 解析       | 内存     | 否                                                           | 是          |
| 菜单构建 + 事件挂接       | FFI 密集 | 否                                                           | 是          |
| 主窗口装饰/事件挂接        | FFI    | 否                                                           | 是          |
| flush_startup_log | 文件写    | 小文件一次写                                                      | 是          |

### **评估**

- **无网络请求**（updater 插件 `Builder::new()` 不发起网络）。✅
- 唯一磁盘 I/O 是 `flush_startup_log`（KB 级）与 window-state 插件状态文件（窗口构建阶段）。
- 菜单构建是最重的同步操作（约 20 个 MenuItem 的 FFI），但绝对量级小。
- **Rust setup 整体不是首屏瓶颈**；真正瓶颈在 WebView 加载 + JS 执行。可延迟项存在（日志 flush 可后台、菜单构建可后置），但收益低。

---

## **维度 5：首屏资源加载策略**

### **⚠️ 关键发现：markdown-it 被静态打入首屏加载路径**

!\[\]\(data:image/svg+xml;charset\=utf-8,%3Csvg%20viewBox%3D%220%200%2024%2024%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20style%3D%22width%3A100%25%3Bheight%3A100%25%22%3E%3Cpath%20d%3D%22M13%209h5.5L13%203.5V9M6%202h8l6%206v12a2%202%200%200%201-2%202H6a2%202%200%200%201-2-2V4c0-1.11.89-2%202-2m9%2016v-2H6v2h9m3-4v-2H6v2h12z%22%20fill%3D%22%2342a5f5%22%2F%3E%3C%2Fsvg%3E\)

plaintext

```plaintext
StatusbarQuickActions.vue（入口静态组件）
  └→ utils/markdown-to-html.ts
       └→ import markdown-it + 6 插件（task-lists/mark/sub/sup/texmath/footnote）

```

虽然 `vite.config.ts` 的 `manualChunks` 把 markdown-it 拆成独立 chunk，但它是**入口 chunk 的静态依赖**——首屏必须 fetch + 执行，仅服务于"复制为 HTML"按钮。预估 markdown-it 全量（含 6 插件）gzip 后 100\~200KB，是首屏里唯一"非必需"的重库。

### **做对了的按需加载 ✅**

| **依赖**            | **加载方式**                                    | **是否真懒**                                                     |
| ----------------- | ------------------------------------------- | ------------------------------------------------------------ |
| KaTeX             | `math-block.ts` 动态 import（含 CSS）            | ✅ 真懒加载（遇数学块才加载）                                              |
| Mermaid           | `mermaid-block.ts` 动态 import（且不手动分包，保护内部链路） | ✅ 真懒加载                                                       |
| MarkdownEditor 整块 | `defineAsyncComponent`                      | ⚠️ 代码分割了，但首帧即触发，非延迟到交互                                       |
| 字体                | CSS @font-face + `font-display: swap`       | ✅ 非阻塞；默认字体是系统字体（Microsoft YaHei UI 在 SYSTEM_FONTS 白名单），不触发下载 |

### **静态资源**

- `index.html` 无阻塞外部资源；内联 theme-paint 脚本 + `html { background-color: var(--bg-color) }` 防黑闪。✅
- 编辑器 chunk（tiptap + lowlight + 17 语言 highlight.js）体积大头，虽不阻塞首帧渲染，但**首帧即开始加载并执行**，与显示链路竞争主线程（见 D3）。

---

## **维度 6：启动可观测性**

### **现有手段**

| **手段**                                                     | **覆盖范围**                                                              | **局限**                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| Rust `startup-open.log`（`append_startup_log`，epoch ms 时间戳） | setup args / 启动路径 / cli file / created window / startup_ready payload | **只有事件时间点，无区间耗时计算**；不覆盖 WebView 创建、window-state 恢复、菜单构建 |
| `reveal_startup_open_log` 命令                               | 前端可一键打开日志                                                             | 同上                                                      |
| 前端                                                         | **零打点**（grep `performance.now/mark/measure` 无任何匹配）                    | —                                                       |

### **黑盒阶段**

1. Rust setup 完成 → WebView 首字节 JS（WebView2 初始化）
2. 入口 chunk + markdown-it chunk 的 fetch + parse
3. Vue mount → 首帧渲染
4. 编辑器 async chunk 加载 + 模块求值（lowlight 注册 17 语言等）
5. `createEditor` + `parseMarkdown` 耗时
6. `initThemeOnly` store 读 → `startupReady` show 之间的 IPC 往返

**结论：前端侧完全不可观测，startup-visible 的时间构成是黑盒；现有日志只能证明"事件发生了"，无法定位"慢在哪一环"。**

---

## **瓶颈汇总与影响评估**

| **#** | **瓶颈/风险点**                                                                                                                                 | **依据**                                                                                 | **影响**           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------- |
| 1     | 编辑器 async chunk（tiptap + lowlight + 17 语言 highlight.js）首帧即加载并在主线程同步求值 + `createEditor` 同步执行，与 startupReady IPC 链竞争主线程，可能延迟 `window.show()` | `App.vue` L32 async 组件 + `MarkdownEditor.vue` L356-366 快速路径 + `code-block.ts` 静态 17 语言 | **高**            |
| 2     | markdown-it + 6 插件进首屏加载路径（仅服务于"复制为 HTML"）                                                                                                  | `StatusbarQuickActions.vue` → `markdown-to-html.ts` 静态 import                          | **高**（体积）        |
| 3     | show\(\) 前 3\~4 个串行 IPC roundtrip；`listenWindowCloseRequested` 与 startupReady 无依赖却串行 await                                                 | `useAppWindowSession.setup()` L195-199                                                 | 中                |
| 4     | 前端启动零可观测性，无法量化各环节耗时                                                                                                                        | grep 无 performance 打点                                                                  | 中                |
| 5     | 懒初始化因 `document.hasFocus()` 恒真而几乎失效                                                                                                        | `MarkdownEditor.vue` L356                                                              | 中（影响"首屏交互"目标的达成） |
| 6     | Rust setup 菜单构建/日志 flush 同步                                                                                                                | `lib.rs` L325/345                                                                      | 低                |
| 7     | initThemeOnly 全量读 settings.json                                                                                                            | `settings.ts` L149                                                                     | 低                |

## **尚需进一步验证的疑点**

1. **实际 bundle 体积**：当前无 `dist` 目录，无法量化 entry/markdown-it/editor 各 chunk 的真实大小（需跑一次 `bun run build`）。
2. **lowlight 注册 17 语言的实际耗时**：需在 DevTools 实测，决定它是"高影响"还是"可接受"。
3. `document.hasFocus()`\*\* 在启动场景的真实返回值\*\*：决定懒初始化是否完全失效。
4. **WebView2 下各 IPC roundtrip 实测耗时**：量化 show 前串行链的绝对延迟。
5. `startup-open.log`\*\* 实测内容\*\*：确认现有时间点的粒度是否够用。

 

# dumate复核反馈

报告读完，现在对照实际代码逐一核实。先并行读取几个关键文件。

需要进一步核实 markdown-it 的引入链路、`activeViewMode` 默认值，以及 lowlight 的静态注册方式。并行读取相关文件。

三个文件都读完了，信息足够，逐一给出核实结论。

---

## 核实结论

### 问题 1：编辑器创建太早，抢了窗口显示的路 — **部分正确，但因果关系被简化了**

**事实核实：**

- `App.vue:32` 确实用 `defineAsyncComponent` 引入 MarkdownEditor ✅
- `activeViewMode` 默认 `'editor'`（`useImagePreview.ts:10`），`v-if="activeViewMode === 'editor'"` 首帧即为 true ✅
- `code-block.ts:12-29` 确实静态 import 了 lowlight + 17 种 highlight.js 语言 ✅
- `MarkdownEditor.vue:356` 的 `createEditor` 确实在 onMounted 中同步调用（含 `createEditorExtensions` 实例化 32 个扩展 + `parseMarkdown`）✅

**但报告的因果链有一个关键简化：**

`defineAsyncComponent` 的 chunk **网络加载是异步的**，不阻塞 `App.vue.onMounted`。Vue 在 chunk 未到达时渲染占位节点，父组件 onMounted 照常触发。所以不是"编辑器创建抢了 window.show\(\) 的路"这么直接。

真正的竞争机制是：当编辑器 chunk **到达后的 JS 模块求值**（lowlight 注册 17 语言、TipTap schema 构建）是同步的，如果这个求值恰好插入到 `App.vue.onMounted` 的 `await initThemeOnly()` → `await windowSession.setup()` 的间隙中执行，就会延迟 `startupReady` → 延迟 `window.show()`。这是一个**时序竞争**问题，不是"谁先谁后"的确定性阻塞。

报告说的"异步 chunk、同步执行，与窗口显示竞争主线程"方向正确，但"编辑器创建抢了窗口显示的路"表述过于绝对——实际影响取决于 chunk 何时加载完成、模块求值何时插入事件循环。

---

### 问题 2：markdown-it 被绑在首屏加载链上 — **完全正确**

整条静态依赖链已确认：

```
App.vue (入口)
  └ L19: import StatusbarQuickActions.vue        ← 静态
     └ L7: import { renderMarkdown } from '../utils/markdown-to-html'  ← 静态
        └ L1-7: import markdown-it + 6 插件       ← 全部静态
```

`renderMarkdown` 唯一用途是 `StatusbarQuickActions.vue:34` 的 `copyMarkdown()` ——"复制为 HTML"按钮。这个功能完全不是首屏必需的，但 markdown-it + 6 插件被静态打入了入口 chunk 的依赖树。

这是三个问题里**最确定、最该修的一个**。修复方式也直白：把 `markdown-to-html.ts` 的 import 改成 `copyMarkdown` 函数内的动态 `import()`，用到时才加载。

---

### 问题 3：延迟机制没有真正生效 — **结论正确，但"恒为 true"的断言需打折扣**

**代码事实：**

`MarkdownEditor.vue:308-311` 注释写的设计意图：

> 新窗口打开时不立即创建编辑器，首次聚焦或点击时才初始化。

`MarkdownEditor.vue:355-367` 实际逻辑：

```javascript
if (document.hasFocus()) {
  createEditor(props.initialContent || '');  // 有焦点就立即建
} else {
  setTimeout(() => { lazyInitEditor(); }, 50);  // 50ms 兜底
}
```

**设计意图与实际行为确实矛盾** ✅——注释说"首次聚焦或点击时才初始化"，代码却是"有焦点就立即创建"。有焦点 ≠ 首次聚焦。

\*\*但报告说 \*\*`document.hasFocus()` "恒为 true" 过于绝对：

Tauri 主窗口创建时 `visible: false`，通过 `startupReady` 命令调 `window.show()` 才可见。MarkdownEditor 的 onMounted 何时执行取决于 async chunk 何时加载完：

- 如果 chunk 在 `window.show()` **之前**加载完，`document.hasFocus()` 可能返回 false（窗口还没显示）
- 如果 chunk 在 `window.show()` **之后**加载完，`document.hasFocus()` 大概率返回 true

报告自己也在"尚需验证的疑点"（L214）里承认了这一点。所以"恒为 true"应该改为"在主窗口启动场景下大概率返回 true"。

不过结论方向是对的：对于**主窗口**（前台窗口），懒初始化确实形同虚设；对于**后台窗口**（多窗口场景），`document.hasFocus()` 返回 false 时懒初始化才真正生效。这个机制的设计本意更像是"后台窗口省内存"，不是"主窗口延迟到用户交互后"。

---

## 总结

| 问题                  | 报告结论                 | 核实结果                                                                  |
| ------------------- | -------------------- | --------------------------------------------------------------------- |
| 1. 编辑器创建太早          | 抢了窗口显示的路             | **方向正确，因果简化**。不是确定性阻塞，是 chunk 求值插入 await 间隙的时序竞争                      |
| 2. markdown-it 在首屏链 | 非首屏必需却静态加载           | **完全正确**，三个里最确定、最该修                                                   |
| 3. 延迟机制失效           | hasFocus 恒 true 导致失效 | **结论正确但断言过绝对**。设计意图与代码确实矛盾；"恒为 true"取决于 chunk 与 show 的时序竞争，报告自己也列为待验证 |

如果要动手修，**问题 2 收益最明确、风险最低**（改一个静态 import 为动态 import）；问题 1 和 3 需要先在 DevTools 实测量化实际耗时，再决定是否值得动刀——报告自己在"尚需验证的疑点"里也列了这几项。

 
