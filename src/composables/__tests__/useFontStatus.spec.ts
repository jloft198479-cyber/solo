// @vitest-environment happy-dom
/**
 * useFontStatus 契约锁（台账 §二 #68）。
 *
 * 这段逻辑此前在 FontPopover / SettingsFontSelect 各写一遍且能力不齐，
 * 抽取后补齐了设置页缺失的两项：卸载竞态防护、下载失败态。本锁守三件事：
 *  ① 挂载后全量刷新 available / failed
 *  ② 进度 → 落定 → 状态更新 → onSettled 的时序
 *  ③ 卸载后迟到回调（含在途的落定回查）一律丢弃，不写 ref、不再通知
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent } from 'vue';
import { useFontStatus } from '../useFontStatus';
import { PROGRESS_DONE } from '../../services/fontLoader';

const h = vi.hoisted(() => {
  const listeners = new Set<(family: string, pct: number) => void>();
  const availability = new Map<string, boolean>();
  const failures = new Set<string>();
  return {
    listeners,
    availability,
    failures,
    /** 绕过订阅集直投事件（模拟卸载后仍在路上的迟到回调） */
    captured: undefined as ((family: string, pct: number) => void) | undefined,
    emit: (family: string, pct: number) => {
      for (const cb of [...listeners]) cb(family, pct);
    },
  };
});

vi.mock('../../services/fontLoader', () => ({
  PROGRESS_DONE: -1,
  isFontAvailable: async (family: string) => h.availability.get(family) ?? false,
  isFontFailed: (family: string) => h.failures.has(family),
  onProgress: (cb: (family: string, pct: number) => void) => {
    h.listeners.add(cb);
    h.captured = cb;
    return () => h.listeners.delete(cb);
  },
}));

function mountStatus() {
  let status!: ReturnType<typeof useFontStatus>;
  const app = createApp(
    defineComponent({
      setup() {
        status = useFontStatus();
        return () => null;
      },
    }),
  );
  app.mount(document.createElement('div'));
  return { status, unmount: () => app.unmount() };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('useFontStatus', () => {
  beforeEach(() => {
    h.availability.clear();
    h.failures.clear();
    h.listeners.clear();
    h.captured = undefined;
  });

  it('挂载后全量刷新 available / failed', async () => {
    h.availability.set('Noto Serif SC', true);
    h.failures.add('Zhuque Fangsong');

    const { status, unmount } = mountStatus();
    await flush();

    expect(status.available.value['Noto Serif SC']).toBe(true);
    expect(status.available.value['Zhuque Fangsong']).toBe(false);
    expect(status.failed.value['Zhuque Fangsong']).toBe(true);
    expect(status.failed.value['Noto Serif SC']).toBe(false);
    unmount();
  });

  it('进度事件驱动 downloadPct；落定后更新状态并触发 onSettled', async () => {
    const { status, unmount } = mountStatus();
    await flush();

    const settled: Array<[string, boolean]> = [];
    status.onSettled((family, ok) => settled.push([family, ok]));

    h.emit('Xiaolai SC', 0);
    h.emit('Xiaolai SC', 42);
    expect(status.downloadPct.value['Xiaolai SC']).toBe(42);

    h.availability.set('Xiaolai SC', true);
    h.emit('Xiaolai SC', PROGRESS_DONE);
    // 落定瞬间满格，等消费方决定何时收（弹窗要停留，设置页即清）
    expect(status.downloadPct.value['Xiaolai SC']).toBe(100);

    await flush();
    expect(status.available.value['Xiaolai SC']).toBe(true);
    expect(status.failed.value['Xiaolai SC']).toBeFalsy();
    expect(settled).toEqual([['Xiaolai SC', true]]);

    status.clearDownload('Xiaolai SC');
    expect(status.downloadPct.value['Xiaolai SC']).toBeUndefined();
    unmount();
  });

  it('下载失败：failed 置真，onSettled 报 ok=false', async () => {
    const { status, unmount } = mountStatus();
    await flush();

    const settled = vi.fn();
    status.onSettled(settled);

    h.failures.add('Huiwen-mincho');
    h.emit('Huiwen-mincho', PROGRESS_DONE);
    await flush();

    expect(status.failed.value['Huiwen-mincho']).toBe(true);
    expect(settled).toHaveBeenCalledWith('Huiwen-mincho', false);
    unmount();
  });

  it('卸载后迟到回调一律丢弃：不写 ref、不再通知、订阅已退', async () => {
    const { status, unmount } = mountStatus();
    await flush();

    const settled = vi.fn();
    status.onSettled(settled);

    h.emit('Huiwen-mincho', 30);
    unmount();
    expect(h.listeners.size).toBe(0); // unsub 已执行

    // 直接投给捕获的 listener（模拟绕过订阅表在路上的迟到回调）
    h.availability.set('Huiwen-mincho', true);
    h.captured?.('Huiwen-mincho', 80);
    h.captured?.('Huiwen-mincho', PROGRESS_DONE);
    await flush();

    expect(status.downloadPct.value['Huiwen-mincho']).toBe(30); // 停在卸载前的值
    expect(status.available.value['Huiwen-mincho']).toBe(false); // 未被迟到回查改写
    expect(settled).not.toHaveBeenCalled();
  });

  it('卸载时在途的落定回查被丢弃（迟到 .then 不写 ref）', async () => {
    const { status, unmount } = mountStatus();
    await flush();

    const settled = vi.fn();
    status.onSettled(settled);

    h.availability.set('Noto Serif SC', true);
    h.emit('Noto Serif SC', PROGRESS_DONE); // 落定，回查在途
    unmount(); // 立刻卸载，回查 resolve 于卸载之后
    await flush();

    expect(status.available.value['Noto Serif SC']).toBe(false); // 保持挂载时的刷新值
    expect(settled).not.toHaveBeenCalled();
  });
});
