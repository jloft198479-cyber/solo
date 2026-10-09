/**
 * ⚠️ 临时被动探针（验证期专用）—— **验证结束必须删除**（连同 `ime-anchor.ts` 里的引用）。
 *
 * ## 为什么需要它
 * 本项目 IME 候选窗失锚是**概率性**的、**无法按需复现**（简乐 2026-10-09 明确指出：
 * 「你专门测，它不一定问题能暴露出来」）。既然不能让人工刻意测试，就改成
 * **日常使用中被动留痕**：护栏每次触发 / 跳过都写盘，事后直接读文件对账。
 *
 * ## 读法
 * 独立 store 文件：`%APPDATA%\com.solomarkdown\ime-anchor-probe.json`
 * （与 `settings.json` 同目录，**不污染用户设置**）。
 * 出问题时把最后一次「失锚时刻」和文件里最近的记录对一下即可：
 * - 若失锚前**有** `reanchor / blur+focus` 记录 ⇒ 护栏跑了但没用；
 * - 若失锚前**只有** `skip` 或**什么都没有** ⇒ 护栏压根没跑（触发面还不够）。
 *
 * ## 安全性
 * 只在 **dev 构建 + Tauri 运行时**写盘；任何异常一律吞掉，绝不影响编辑器。
 */
import type { LazyStore } from '@tauri-apps/plugin-store';

const STORE_FILE = 'ime-anchor-probe.json';
const EVENTS_KEY = 'events';
const MAX_EVENTS = 400;

interface ProbeEvent {
  /** 毫秒时间戳 */
  t: number;
  /** 事件名 */
  e: string;
  /** 附加信息 */
  d?: Record<string, unknown>;
}

let buffer: ProbeEvent[] | null = null;
let store: LazyStore | null = null;

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 记录一条探针事件（异步、失败静默）。 */
export function probe(event: string, detail?: Record<string, unknown>): void {
  if (!import.meta.env.DEV || !isTauriRuntime()) return;
  void (async () => {
    try {
      if (!store) {
        const { LazyStore: StoreCtor } = await import('@tauri-apps/plugin-store');
        store = new StoreCtor(STORE_FILE);
      }
      if (!buffer) {
        buffer = (await store.get<ProbeEvent[]>(EVENTS_KEY)) ?? [];
      }
      buffer.push({ t: Date.now(), e: event, ...(detail ? { d: detail } : {}) });
      if (buffer.length > MAX_EVENTS) buffer.splice(0, buffer.length - MAX_EVENTS);
      await store.set(EVENTS_KEY, buffer);
    } catch {
      /* 探针失败绝不影响编辑器 */
    }
  })();
}
