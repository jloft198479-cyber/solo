/**
 * 字体下载 / 可用状态（FontPopover 与 SettingsFontSelect 共用）。
 *
 * 抽取背景（台账 §二 #68）：这段逻辑此前在两处各写一遍，且能力不齐 ——
 * 设置页缺竞态防护（卸载后迟到的回调仍写 ref）、也不显示「下载失败」。
 * 收进一处后补齐，两边行为对齐。
 *
 * 状态模型（三键都按 family 索引）：
 *  - `available`：已可用（系统字体 / 已缓存 / 已加载）
 *  - `failed`：上次下载落定失败。下载一开始就会清掉（代表「正在重试」）
 *  - `downloadPct`：键存在 = 正在下载（0–100）；落定瞬间置 100，**由消费方决定
 *    何时 `clearDownload()`** —— 弹窗要让满格进度条停留一瞬，设置页则即清
 *  - `onSettled`：下载落定（available / failed 已更新后）回调，消费方据此收尾
 */
import { onUnmounted, ref } from 'vue';
import { FONT_OPTIONS } from '../constants/fonts';
import { isFontAvailable, isFontFailed, onProgress } from '../services/fontLoader';

type SettledCallback = (family: string, ok: boolean) => void;

export function useFontStatus() {
  const available = ref<Record<string, boolean>>({});
  const failed = ref<Record<string, boolean>>({});
  const downloadPct = ref<Record<string, number>>({});

  // 竞态防护：卸载后丢弃迟到回调（onProgress / promise.then），不再写 ref
  let disposed = false;
  const settledCallbacks = new Set<SettledCallback>();

  async function refreshAll() {
    const results = await Promise.all(FONT_OPTIONS.map((opt) => isFontAvailable(opt.value)));
    if (disposed) return;
    FONT_OPTIONS.forEach((opt, i) => {
      available.value[opt.value] = results[i]!;
      failed.value[opt.value] = isFontFailed(opt.value);
    });
  }
  void refreshAll();

  const unsub = onProgress((family, pct) => {
    if (disposed) return;
    if (pct >= 0) {
      downloadPct.value[family] = pct;
      delete failed.value[family];
      return;
    }
    // 落定：满格 → 回查可用性 → 更新状态 → 通知消费方
    downloadPct.value[family] = 100;
    void isFontAvailable(family).then((ok) => {
      if (disposed) return;
      available.value[family] = ok;
      failed.value[family] = !ok && isFontFailed(family);
      for (const cb of settledCallbacks) cb(family, ok);
    });
  });

  onUnmounted(() => {
    disposed = true;
    unsub();
    settledCallbacks.clear();
  });

  return {
    available,
    failed,
    downloadPct,
    /** 下载落定后收掉进度（消费方自行决定时机，如「当前字体」留满格再收） */
    clearDownload: (family: string) => {
      delete downloadPct.value[family];
    },
    onSettled: (cb: SettledCallback) => {
      settledCallbacks.add(cb);
    },
  };
}
