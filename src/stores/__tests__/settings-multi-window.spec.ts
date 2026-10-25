// @vitest-environment happy-dom
/**
 * 设置持久化的多窗口合并写锁（审计 P2-3，2026-10-25 第二轮审核确认仍未修）。
 *
 * 我防的事故：solo 一窗一文档、多窗口共享 settings.json；本窗内存快照在启动
 * 加载后冻结，任何一次设置变更都把**整份快照**写回磁盘——他窗已落盘的改动被
 * 本窗的旧值静默覆盖（窗 A 改主题、窗 B 改字号 → 磁盘上主题回到旧值，重启后
 * A 的改动消失，全程无提示）。
 *
 * 修法：落盘前先 reload 重读磁盘，只把**本窗口真正改过的字段**合并上去——
 * 「与载入基线的逐字段 diff」∪「显式脏标记（customThemes 是原地 push/splice，
 * 引用不变 diff 抓不住）」。保存路径直接调 saveSettingsToStore / flush（不经
 * watcher 接线——那是既有机制，与本修无关）。
 *
 * 反向校准（准入②，执行时已做）：persistMerged 退回整快照写 ⇒ 前两条转红。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const disk: { settings?: Record<string, unknown> } = {};

vi.mock('../../services/tauri/store', () => ({
  readStoredSettings: vi.fn(async () => (disk.settings ? { ...disk.settings } : undefined)),
  writeStoredSettings: vi.fn(async (s: unknown) => {
    disk.settings = { ...(s as Record<string, unknown>) };
  }),
  // mock 层没有缓存，get 本就直读 disk；真实 LazyStore 靠 reload 丢缓存重读磁盘
  reloadStoredSettings: vi.fn(async () => {}),
  readStoredFocusMode: vi.fn(async () => undefined),
  writeStoredFocusMode: vi.fn(async () => {}),
}));

vi.mock('../../services/tauri/window', () => ({
  setCurrentWindowAlwaysOnTop: vi.fn(async () => {}),
}));

import { useSettingsStore, type Settings } from '../settings';

/** 一份完整的 v12 配置基线（模拟磁盘上的既有内容） */
const BASE: Settings = {
  activeThemeId: 'scholar-light',
  customThemes: [],
  fontSize: 16,
  fontFamily: 'Microsoft YaHei UI',
  autoSave: false,
  autoSaveInterval: 30,
  titlebarAutoHide: false,
  lineHeight: null,
  customShortcuts: {},
  alwaysOnTop: false,
  imageStoragePath: '',
  shellIntegration: false,
  enableAutoUpdateCheck: false,
  configVersion: 12,
};

/** 走完 300ms 防抖窗口，让挂起的保存真正落盘 */
async function flushDebounce() {
  await vi.advanceTimersByTimeAsync(400);
}

describe('设置持久化：多窗口合并写（P2-3）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    disk.settings = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('他窗先落盘的字段不被本窗整快照覆盖', async () => {
    disk.settings = { ...BASE };
    const store = useSettingsStore();
    await store.initFull();

    // 他窗（另一 WebView / 进程）把字号改到 20 并已落盘
    disk.settings = { ...disk.settings!, fontSize: 20 };

    // 本窗切换主题 → 防抖保存
    store.setColorTheme('scholar-dark');
    await store.saveSettingsToStore(store.settings);
    await flushDebounce();

    expect(disk.settings!.activeThemeId, '本窗的改动要落盘').toBe('scholar-dark');
    expect(disk.settings!.fontSize, '他窗的改动不得被旧值洗掉').toBe(20);
  });

  it('customThemes 原地增删走显式脏标记，同时不覆盖他窗字段', async () => {
    disk.settings = { ...BASE };
    const store = useSettingsStore();
    await store.initFull();
    disk.settings = { ...disk.settings!, fontSize: 20 };

    store.addCustomTheme({ id: 'c1', name: '自定义', type: 'custom' } as never);
    await flushDebounce();

    expect((disk.settings!.customThemes as unknown[]).length, '新增主题要落盘').toBe(1);
    expect(disk.settings!.fontSize, '他窗的改动不得被旧值洗掉').toBe(20);
  });

  it('单窗口行为不变：自己的改动照常落盘', async () => {
    disk.settings = { ...BASE };
    const store = useSettingsStore();
    await store.initFull();

    store.updateSetting('fontSize', 18);
    await store.saveSettingsToStore(store.settings);
    await flushDebounce();

    expect(disk.settings!.fontSize).toBe(18);
  });
});
