import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 性能诊断（T0）行为契约：
 * - 关闭态：任何 API 都不产生 performance 条目、不挂监听、不注册插件；
 * - 启用态：mark/measure 成对，p95 用排序取位算准；
 * - p95 单测用构造样本断言精确值（防止「拿下界/上界凑数」）。
 *
 * 模块用 `localStorage['solo-perf']` 做开关，且读一次即缓存，所以每个用例
 * 都要 resetModules 后重新 import，才能拿到干净的开关状态。
 */

type PerfModule = typeof import('../perf-diagnostics');

function stubLocalStorage(enabled: boolean): void {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'solo-perf' && enabled ? '1' : null),
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  });
}

async function loadModule(enabled: boolean): Promise<PerfModule> {
  vi.resetModules();
  stubLocalStorage(enabled);
  return await import('../perf-diagnostics');
}

beforeEach(() => {
  performance.clearMarks();
  performance.clearMeasures();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('perf-diagnostics 关闭态（默认）', () => {
  it('所有 API 都是空操作，不产生 performance 条目也不挂监听', async () => {
    const perf = await loadModule(false);
    const markSpy = vi.spyOn(performance, 'mark');
    const measureSpy = vi.spyOn(performance, 'measure');
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const listener = { addEventListener, removeEventListener } as unknown as HTMLElement;

    expect(perf.isPerfEnabled()).toBe(false);
    expect(perf.createPerfProbePlugin()).toBeNull();

    perf.initPerfDiagnostics();
    perf.markAppBoot();
    perf.markOpenBegin();
    perf.markInputReady();
    expect(perf.measureSerialize(() => 42)).toBe(42);
    const dispose = perf.installScrollFpsProbe(listener);
    dispose();

    expect(markSpy).not.toHaveBeenCalled();
    expect(measureSpy).not.toHaveBeenCalled();
    expect(performance.getEntriesByType('mark')).toHaveLength(0);
    expect(performance.getEntriesByType('measure')).toHaveLength(0);
    expect(addEventListener).not.toHaveBeenCalled();
    expect(perf.getPerfReport().coldStartMs).toBeNull();
  });
});

describe('perf-diagnostics 启用态', () => {
  it('冷启动 / 打开文件两步的 mark 与 measure 成对出现', async () => {
    const perf = await loadModule(true);
    expect(perf.isPerfEnabled()).toBe(true);

    perf.markAppBoot();
    perf.markInputReady();
    perf.markOpenBegin();
    // 给打开链路一点真实耗时，避免 same-tick 造成 0 值断言歧义
    await new Promise((resolve) => setTimeout(resolve, 1));
    perf.markInputReady();

    const report = perf.getPerfReport();
    expect(report.coldStartMs).not.toBeNull();
    expect(report.openToInputMs).not.toBeNull();

    expect(performance.getEntriesByName('solo-perf:cold-start', 'mark')).toHaveLength(1);
    expect(performance.getEntriesByName('solo-perf:cold-start->ready', 'measure')).toHaveLength(1);
    expect(performance.getEntriesByName('solo-perf:open', 'mark')).toHaveLength(1);
    expect(performance.getEntriesByName('solo-perf:open->ready', 'measure')).toHaveLength(1);
  });

  it('启用态注册真实 PM 插件；序列化耗时进样本', async () => {
    const perf = await loadModule(true);
    const plugin = perf.createPerfProbePlugin();
    expect(plugin).not.toBeNull();
    expect(typeof (plugin as { spec: unknown }).spec).toBe('object');

    perf.measureSerialize(() => 'x');
    expect(perf.getPerfReport().serialization.count).toBe(1);
  });
});

describe('percentile（最近秩取位）', () => {
  it('已知样本的 p50/p95 取精确值，不用区间上界冒充', async () => {
    const { percentile } = await loadModule(true);
    const asc = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(asc, 95)).toBe(95);
    expect(percentile(asc, 50)).toBe(50);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([], 95)).toBeNull();
  });
});
