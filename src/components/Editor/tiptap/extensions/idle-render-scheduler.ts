/**
 * NodeView 渲染空闲调度器（P5-03）
 *
 * 问题：大文档打开时 50+ Mermaid/math NodeView 同时创建，各自调 async render()。
 * 这些 async render 的 microtask 在同一 macrotask 中排队，CPU-bound 顺序执行，
 * 阻塞主线程数百毫秒，用户感知到「打开文档卡一下」。
 *
 * 方案：用 requestIdleCallback 将渲染分批调度，每批之间 yield 给浏览器。
 * 浏览器先画出文档结构（文字、段落），再在空闲时间逐步填充图表。
 *
 * 为什么用 requestIdleCallback 而非 requestAnimationFrame：
 * - rAF 回调在帧渲染前执行，回调耗时长会拖延帧渲染
 * - rIC 在浏览器空闲时执行，不阻塞帧渲染
 * - 大文档打开时，浏览器先完成首帧渲染，然后在空闲时间逐步渲染图表
 * - rIC 有 timeout 选项，确保不会无限延迟（默认 50ms 内必执行）
 *
 * 兼容性：Chromium 47+ 完全支持，Tauri WebView2 基于现代 Chromium 完全兼容。
 * 测试环境（happy-dom）可能无 requestIdleCallback，降级到 setTimeout(0)。
 */

type IdleTask = () => void;

// 每批最多执行的任务数。太多 → 阻塞 idle 时段；太少 → 渲染拖延。
// 实测 mermaid.render 单次 ~5–20ms，math ~1–5ms，4 个一批约 20–80ms，
// 在浏览器 16ms 帧预算外但不阻塞帧渲染（rIC 在空闲时段执行）。
const BATCH_SIZE = 4;

// 全局待渲染队列（mermaid + math 共享，因为都走 rIC 调度）
let pendingQueue: IdleTask[] = [];
let scheduled = false;

function flushQueue(_deadline?: IdleDeadline) {
  scheduled = false;
  const batch = pendingQueue.splice(0, BATCH_SIZE);
  for (const task of batch) {
    try {
      task();
    } catch {
      // 单个任务失败不影响后续
    }
  }
  if (pendingQueue.length > 0) {
    scheduleFlush();
  }
}

function scheduleFlush() {
  if (scheduled) return;
  scheduled = true;
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(flushQueue, { timeout: 50 });
  } else {
    // 测试环境降级：setTimeout(0) 不阻塞主线程，但无空闲调度
    setTimeout(() => flushQueue(), 0);
  }
}

/**
 * 将 NodeView 渲染任务排入空闲队列。
 * 调用方在 NodeView 创建时调用 scheduleIdleRender(() => renderXxx())，
 * 渲染会在浏览器空闲时执行，不阻塞文档打开的首帧渲染。
 */
export function scheduleIdleRender(task: IdleTask): void {
  pendingQueue.push(task);
  scheduleFlush();
}

/**
 * 取消排队中的渲染任务（NodeView destroy 时调用，防止对已销毁实例渲染）。
 * 由于 task 是闭包，无法精确移除——调用方在 task 内部检查 destroyed flag 即可。
 * 本函数主要用于测试场景清空队列。
 */
export function clearIdleRenderQueue(): void {
  pendingQueue = [];
  scheduled = false;
}
