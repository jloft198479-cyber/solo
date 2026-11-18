/**
 * 性能诊断（T0 测量基建）：默认**完全惰性**，仅当 `localStorage['solo-perf'] === '1'`
 * 时启用。关闭态所有导出函数在读开关后立刻 return —— 零计时器、零监听、零 performance 条目。
 *
 * 启用后采集五个数（+ 序列化耗时），全部只留在内存：
 * ① 冷启动→可输入 ② 打开文件→可输入 ③ 按键→事务落地 p95 ④ 按键→上屏 p95 ⑤ 滚动帧率。
 *
 * **不写文件、不发 IPC、不改任何渲染行为**；唯一副作用是诊断模式下多挂一个
 * `window.__soloPerf()` 用于在 devtools 里回读数字。
 *
 * ④ 的口径与回退见 `createPerfProbePlugin()` / `getPerfReport()`：
 * 主路径是双 rAF；连续输入导致采样率 <80% 时改用 PerformanceObserver('event') 的
 * `duration`（事件到下一次绘制）；两者都不可用时**只报 ③** 并注明「上屏指标不可用」，
 * 严禁拿 ③ 冒充 ④。
 */

import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/** 启用开关的 localStorage 键：`localStorage.setItem('solo-perf','1')` 后重载窗口生效。 */
export const PERF_FLAG_KEY = 'solo-perf';

/** 环形缓冲保留的样本数：够算 p95，又不至于长跑后吃内存。 */
const RING_BUFFER_SIZE = 200;
/** ④ 双 rAF 采样率低于该比例时视为「被连续输入合并」，切换到 event-timing 回退。 */
const PAINT_SAMPLE_RATIO_MIN = 0.8;
/** 按键与它触发的事务允许的最大间隔：超过说明这个事务不是该按键造成的，丢弃配对。 */
const KEYDOWN_PAIR_WINDOW_MS = 100;
/** 滚动停下多久算一轮结束，用这一轮的帧数算 fps。 */
const SCROLL_IDLE_MS = 250;

const COLD_START_MARK = 'solo-perf:cold-start';
const COLD_START_MEASURE = 'solo-perf:cold-start->ready';
const OPEN_MARK = 'solo-perf:open';
const OPEN_MEASURE = 'solo-perf:open->ready';

/** 最近 200 个样本的环形缓冲（超出即丢最旧）。 */
class SampleBuffer {
  private readonly values: number[] = [];

  push(value: number): void {
    this.values.push(value);
    if (this.values.length > RING_BUFFER_SIZE) this.values.shift();
  }

  toArray(): number[] {
    return [...this.values];
  }

  get length(): number {
    return this.values.length;
  }
}

export interface PerfSummary {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export interface PerfReport {
  coldStartMs: number | null;
  openToInputMs: number | null;
  keyToTransaction: PerfSummary;
  keyToPaint: {
    /** raf = 双 rAF 主路径；event = event-timing 回退；unavailable = 无法测量 */
    source: 'raf' | 'event' | 'unavailable';
    summary: PerfSummary;
  };
  scrollFps: { fps: number | null; samples: number };
  serialization: PerfSummary;
}

const txSamples = new SampleBuffer();
const paintSamples = new SampleBuffer();
const eventPaintSamples = new SampleBuffer();
const scrollFpsSamples = new SampleBuffer();
const serializeSamples = new SampleBuffer();

let enabledCache: boolean | null = null;

let bootAt: number | null = null;
let openAt: number | null = null;
let coldStartMs: number | null = null;
let openToInputMs: number | null = null;

let eventObserver: PerformanceObserver | null = null;

/** 惰性读开关并缓存：热路径（按键）上不再碰 localStorage。 */
export function isPerfEnabled(): boolean {
  if (enabledCache === null) enabledCache = readFlag();
  return enabledCache;
}

function readFlag(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(PERF_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function perfMark(name: string): void {
  try {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
      performance.mark(name);
    }
  } catch {
    // 诊断模式自身不许影响主流程
  }
}

function perfMeasure(name: string, startMark: string): void {
  try {
    if (typeof performance !== 'undefined' && typeof performance.measure === 'function') {
      performance.measure(name, startMark);
    }
  } catch {
    // startMark 缺失等情况直接放弃本条测量
  }
}

/**
 * 取最近秩（nearest-rank）分位值：先升序排序，取第 ceil(p/100 * n) 个。
 * 不使用区间上界冒充——样本 [1..100] 的 p95 必须是 95，不是 100。
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

function summarize(samples: SampleBuffer): PerfSummary {
  const values = samples.toArray();
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: values.length > 0 ? Math.max(...values) : null,
  };
}

/** 启动打点：main.ts 模块顶层调用，越早越能覆盖真实冷启动。 */
export function markAppBoot(): void {
  if (!isPerfEnabled() || bootAt !== null || coldStartMs !== null) return;
  bootAt = now();
  perfMark(COLD_START_MARK);
}

/** 打开文件开始打点：读盘/解析之前调用，与 `markInputReady()` 配对。 */
export function markOpenBegin(): void {
  if (!isPerfEnabled()) return;
  openAt = now();
  perfMark(OPEN_MARK);
}

/** 编辑器「可输入」打点：创建完成 / 切换文档落盘基线之后调用，收口 ①②。 */
export function markInputReady(): void {
  if (!isPerfEnabled()) return;
  const t = now();
  if (bootAt !== null && coldStartMs === null) {
    coldStartMs = t - bootAt;
    perfMeasure(COLD_START_MEASURE, COLD_START_MARK);
  }
  if (openAt !== null) {
    openToInputMs = t - openAt;
    openAt = null;
    perfMeasure(OPEN_MEASURE, OPEN_MARK);
  }
}

/** 包住一次序列化调用，记录耗时样本（关闭态直接执行原函数，无额外条目）。 */
export function measureSerialize<T>(fn: () => T): T {
  if (!isPerfEnabled()) return fn();
  const t0 = now();
  const result = fn();
  serializeSamples.push(now() - t0);
  return result;
}

type DocCarrier = { state: { doc: unknown } };

const keydownAt = new WeakMap<DocCarrier, number>();
const keydownTimers = new WeakMap<DocCarrier, ReturnType<typeof setTimeout>>();

/**
 * ③④ 采集插件：仅诊断模式创建（关闭态返回 null，不注册任何监听）。
 *
 * - `handleDOMEvents.keydown` 记 t0（组字中的按键跳过，组字不产生 1:1 事务）；
 * - 插件的 view.update 遇到 docChanged 时收 ③，并排一次双 rAF 收 ④；
 * - 事务若超出 `KEYDOWN_PAIR_WINDOW_MS` 才落地，视为与按键无关，丢弃配对。
 */
export function createPerfProbePlugin(): Plugin | null {
  if (!isPerfEnabled()) return null;
  ensureEventObserver();
  return new Plugin({
    props: {
      handleDOMEvents: {
        keydown: (view: EditorView, event: KeyboardEvent) => {
          if (event.isComposing) return false;
          const t0 = now();
          keydownAt.set(view, t0);
          const stale = setTimeout(() => {
            if (keydownAt.get(view) === t0) keydownAt.delete(view);
          }, KEYDOWN_PAIR_WINDOW_MS);
          const prev = keydownTimers.get(view);
          if (prev !== undefined) clearTimeout(prev);
          keydownTimers.set(view, stale);
          return false;
        },
      },
    },
    view: () => ({
      update: (view: EditorView, prevState: { doc: unknown }) => {
        if (view.state.doc === prevState.doc) return;
        const t0 = keydownAt.get(view);
        keydownAt.delete(view);
        if (t0 === undefined) return;
        const t1 = now();
        if (t1 - t0 > KEYDOWN_PAIR_WINDOW_MS) return;
        txSamples.push(t1 - t0);
        schedulePaintSample(t0);
      },
    }),
  });
}

/**
 * ④ 主路径：连等两次 rAF。第二帧回调覆盖样式计算/布局/绘制，
 * 差值即「按键 → 用户看到字」的近似时延。
 */
function schedulePaintSample(t0: number): void {
  if (typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      paintSamples.push(now() - t0);
    });
  });
}

/**
 * ④ 回退一：PerformanceObserver('event')。`duration` 从事件时间戳算到下一次绘制，
 * 双 rAF 被合并（采样率不足）时用它补位。WebView2 支持；不支持则静默放弃。
 */
function ensureEventObserver(): void {
  if (eventObserver !== null) return;
  if (typeof PerformanceObserver !== 'function') return;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'keydown' && entry.duration > 0) {
          eventPaintSamples.push(entry.duration);
        }
      }
    });
    observer.observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
    eventObserver = observer;
  } catch {
    eventObserver = null;
  }
}

/**
 * ⑤ 滚动帧率探针：滚动期间逐帧计数，停下 `SCROLL_IDLE_MS` 后按这一轮的帧间隔算 fps。
 * 关闭态返回空清理函数，不挂监听。
 */
export function installScrollFpsProbe(el: HTMLElement | null): () => void {
  if (!isPerfEnabled() || !el || typeof requestAnimationFrame !== 'function') return () => {};

  let active = false;
  let rafId = 0;
  let frames = 0;
  let firstFrameAt = 0;
  let lastScrollAt = 0;

  const tick = (ts: number) => {
    if (!active) return;
    if (firstFrameAt === 0) firstFrameAt = ts;
    frames += 1;
    if (ts - lastScrollAt > SCROLL_IDLE_MS) {
      active = false;
      const elapsed = ts - firstFrameAt;
      // frames 个回调之间有 frames-1 个帧间隔
      if (elapsed > 0 && frames > 1) scrollFpsSamples.push(((frames - 1) * 1000) / elapsed);
      frames = 0;
      firstFrameAt = 0;
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  const onScroll = () => {
    lastScrollAt = now();
    if (active) return;
    active = true;
    frames = 0;
    firstFrameAt = 0;
    rafId = requestAnimationFrame(tick);
  };

  el.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    active = false;
    cancelAnimationFrame(rafId);
    el.removeEventListener('scroll', onScroll);
  };
}

/** 汇总当前所有样本（不打印）。双 rAF 采样率不足时自动切 event-timing。 */
export function getPerfReport(): PerfReport {
  const paintCount = paintSamples.length;
  const txCount = txSamples.length;
  const rafSufficient =
    paintCount > 0 && txCount > 0 && paintCount / txCount >= PAINT_SAMPLE_RATIO_MIN;

  let paintSource: PerfReport['keyToPaint']['source'] = 'unavailable';
  let paintSummary: PerfSummary = summarize(paintSamples);
  if (rafSufficient) {
    paintSource = 'raf';
  } else if (eventPaintSamples.length > 0) {
    paintSource = 'event';
    paintSummary = summarize(eventPaintSamples);
  } else {
    paintSummary = summarize(paintSamples);
  }

  const fpsValues = scrollFpsSamples.toArray();
  return {
    coldStartMs,
    openToInputMs,
    keyToTransaction: summarize(txSamples),
    keyToPaint: { source: paintSource, summary: paintSummary },
    scrollFps: {
      fps: percentile(fpsValues, 50),
      samples: fpsValues.length,
    },
    serialization: summarize(serializeSamples),
  };
}

/** 打印五个数并返回报告（`window.__soloPerf()` 的实现）。 */
export function reportPerf(): PerfReport {
  const report = getPerfReport();
  const ms = (v: number | null) => (v === null ? '未采集' : `${v.toFixed(2)} ms`);
  // eslint-disable-next-line no-console -- 诊断模式的唯一输出通道（仅 solo-perf=1 时执行）
  console.table([
    { 指标: '① 冷启动→可输入', 值: ms(report.coldStartMs) },
    { 指标: '② 打开文件→可输入', 值: ms(report.openToInputMs) },
    {
      指标: `③ 按键→事务落地 p95（n=${report.keyToTransaction.count}）`,
      值: ms(report.keyToTransaction.p95),
    },
    {
      指标: `④ 按键→上屏 p95（n=${report.keyToPaint.summary.count}，来源 ${report.keyToPaint.source}）`,
      值: ms(report.keyToPaint.summary.p95),
    },
    {
      指标: `⑤ 滚动帧率 p50（n=${report.scrollFps.samples}）`,
      值: report.scrollFps.fps === null ? '未采集' : `${report.scrollFps.fps.toFixed(1)} fps`,
    },
    { 指标: `序列化 p95（n=${report.serialization.count}）`, 值: ms(report.serialization.p95) },
  ]);
  if (report.keyToPaint.source === 'unavailable') {
    console.warn(
      '[solo-perf] 上屏指标不可用：双 rAF 采样率不足且 event-timing 无数据。' +
        '此时只可信 ③（按键→事务落地），不要把它当作上屏时延。',
    );
  }
  return report;
}

declare global {
  interface Window {
    /** 诊断模式下的回读入口：devtools 里执行 `__soloPerf()`。 */
    __soloPerf?: () => PerfReport;
  }
}

/**
 * 唯一入口：main.ts 顶层调用。关闭态直接返回（不挂 window 钩子、不打点）。
 * 启用态标记启动时刻并暴露 `window.__soloPerf`。
 */
export function initPerfDiagnostics(): void {
  if (!isPerfEnabled()) return;
  markAppBoot();
  if (typeof window !== 'undefined') {
    window.__soloPerf = reportPerf;
  }
  // eslint-disable-next-line no-console -- 诊断模式启用提示（仅 solo-perf=1 时执行）
  console.info('[solo-perf] 诊断已启用：操作文档后执行 __soloPerf() 回读五个数。');
}
