# 指令：消除编辑器 chunk 模块求值与窗口显示的竞争

## 背景

Phase 2 已用 `requestAnimationFrame` 把 `createEditor()`（最重的操作）延迟到首帧绘制之后，`window.show()` 不再被编辑器构建直接阻塞。

但编辑器 chunk 的**模块求值**仍然可能在 `window.show()` 之前发生——如果 chunk 从 WebView2 缓存秒到，它的顶层代码会在 `await initThemeOnly()` 的 IPC 间隙同步执行，挤占主线程。

## 问题位置

1. **`src/App.vue:32`** — `defineAsyncComponent(() => import('./components/Editor/MarkdownEditor.vue'))`
   - `App.vue:290` 的 `v-if="activeViewMode === 'editor'"` 默认值为 `'editor'`（`src/composables/useImagePreview.ts:10`），Vue 首帧渲染即触发编辑器 chunk 加载。

2. **`src/components/Editor/tiptap/extensions/code-block.ts:36`** — 模块顶层 `createLowlight({ javascript, typescript, ... })` 同步注册 17 种 highlight.js 语言。
   - 该文件被 `editor-extensions.ts:9` 静态 import，后者被 `MarkdownEditor.vue:53` 静态 import → chunk 到达即执行。

3. **`src-tauri/src/lib.rs:33`** — `window.show()` 由前端 `startupReady` IPC 触发（`App.vue:231` → `windowSession.setup()` → `startupReady()`）。

## 竞争时序

```
Vue mount
  ├─ onMounted: await initThemeOnly() (IPC)
  ├─ Vue 渲染首帧 → v-if=editor → 触发 defineAsyncComponent import
  │    └─ chunk 到达 → 模块求值 → code-block.ts 顶层 createLowlight() ← 可能挤占主线程
  ├─ await windowSession.setup() → startupReady IPC → Rust window.show()
  └─ window.show() 返回后窗口才可见
```

如果 chunk 模块求值发生在 `initThemeOnly` 的 IPC 返回之后、`startupReady` 调用之前，会延迟 `window.show()`，用户感知为窗口出现更慢。

## 影响评估

- **实际影响：低**。IPC 链通常比 chunk fetch+parse 更快完成，只有 chunk 缓存命中极快 + IPC 恰好慢的边缘情况才会感知到。
- **理论影响：存在**。lowlight 17 语言注册 + highlight.js 模块求值不是零成本，在低端机器或磁盘繁忙时可能放大。

## 约束

- 不能破坏代码高亮功能——17 种语言必须正常工作。
- 不能引入 FOUC（闪烁）——窗口显示前不能露出空白编辑区或骨架。
- 后台窗口（非活跃）的编辑器仍应延迟创建（现有 `solo:editor-focus` 机制不能丢）。
- 验证三件套全绿：`bun run test` + `npx vue-tsc --noEmit` + `bun run build`。
- 改 `code-block.ts` 后注意 `editor-extensions.ts` 的 `lowlightInstance` 参数传递链（默认值 `= lowlight`）是否受影响。
