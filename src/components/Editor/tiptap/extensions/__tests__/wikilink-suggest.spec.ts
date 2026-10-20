/**
 * 互链 [[ 补全：候选过滤与缓存语义测试。
 *
 * 锁住的不变量：
 * - target 为文件名去 .md 后缀；恰好名为 ".md" 的文件跳过
 * - 排除当前文档自身；query 大小写不敏感子串匹配；菜单上限 50
 * - 缓存按 docPath 单槽隔离：切换文档后未刷新前过滤结果为空
 * - 刷新失败退化为空列表（不抛错打断输入）；并发去重只发一次 IPC
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listMarkdownFilesMock = vi.fn();
vi.mock('../../../../../services/tauri/document', () => ({
  listMarkdownFiles: (...args: unknown[]) => listMarkdownFilesMock(...args),
}));

import {
  filterWikilinkCandidates,
  refreshWikilinkCandidates,
  getWikilinkCandidates,
  isWikilinkSuggestAllowed,
} from '../wikilink-suggest';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('filterWikilinkCandidates', () => {
  it('无文档路径 / 缓存未命中时返回空列表', async () => {
    expect(filterWikilinkCandidates('', null)).toEqual([]);
    // 已刷新 a 目录后，b 目录路径的过滤在刷新前应为空（单槽缓存 key 隔离）
    listMarkdownFilesMock.mockResolvedValue({ files: ['a.md'], truncated: false });
    await refreshWikilinkCandidates('C:\\docs\\a.md');
    expect(filterWikilinkCandidates('', 'C:\\docs\\b.md')).toEqual([]);
  });

  it('去 .md 后缀、排除自身、大小写不敏感匹配', async () => {
    listMarkdownFilesMock.mockResolvedValue({
      files: ['笔记.md', 'README.md', 'temp.md', '.md'],
      truncated: false,
    });
    await refreshWikilinkCandidates('C:\\docs\\笔记.md');

    // 排除自身「笔记.md」；".md"（target 为空）跳过
    expect(filterWikilinkCandidates('', 'C:\\docs\\笔记.md').map((i) => i.target)).toEqual([
      'README',
      'temp',
    ]);
    // 大小写不敏感子串匹配
    expect(filterWikilinkCandidates('read', 'C:\\docs\\笔记.md').map((i) => i.target)).toEqual([
      'README',
    ]);
    expect(filterWikilinkCandidates('笔记', 'C:\\docs\\笔记.md')).toEqual([]);
  });

  it('跨目录候选：相对路径直接当 target（与手打写法、跳转拼接三者一致）', async () => {
    listMarkdownFilesMock.mockResolvedValue({
      files: ['B.md', 'sub/C.md'],
      truncated: false,
    });
    await refreshWikilinkCandidates('C:\\docs\\A.md');
    expect(filterWikilinkCandidates('', 'C:\\docs\\A.md').map((i) => i.target)).toEqual([
      'B',
      'sub/C',
    ]);
    // 子目录里的同名文件不算「自身」（自身只按同层文件名排除）
    await refreshWikilinkCandidates('C:\\docs\\sub\\A.md');
    expect(filterWikilinkCandidates('', 'C:\\docs\\sub\\A.md').map((i) => i.target)).toEqual([
      'B',
      'sub/C',
    ]);
  });

  it('菜单上限 50 条', async () => {
    listMarkdownFilesMock.mockResolvedValue({
      files: Array.from({ length: 60 }, (_, i) => `f${String(i).padStart(2, '0')}.md`),
      truncated: false,
    });
    await refreshWikilinkCandidates('D:\\notes\\index.md');
    expect(filterWikilinkCandidates('', 'D:\\notes\\index.md')).toHaveLength(50);
  });
});

describe('refreshWikilinkCandidates', () => {
  it('失败退化为空清单，不抛错', async () => {
    listMarkdownFilesMock.mockRejectedValue(new Error('io'));
    await expect(refreshWikilinkCandidates('E:\\x\\a.md')).resolves.toBeUndefined();
    // truncated=false 配空 files：标红侧走「索引为空 → 不标」，语义安全
    expect(getWikilinkCandidates('E:\\x\\a.md')).toEqual({
      files: [],
      truncated: false,
    });
  });

  it('原样透传 truncated（清单不完整 → 标红侧放弃判定）', async () => {
    listMarkdownFilesMock.mockResolvedValue({ files: ['a.md'], truncated: true });
    await refreshWikilinkCandidates('E:\\x\\a.md');
    expect(getWikilinkCandidates('E:\\x\\a.md').truncated).toBe(true);
  });

  it('并发去重：同路径同时刷新只发一次 IPC', async () => {
    let resolveFn: (v: { files: string[]; truncated: boolean }) => void = () => {};
    listMarkdownFilesMock.mockReturnValue(
      new Promise<{ files: string[]; truncated: boolean }>((resolve) => {
        resolveFn = resolve;
      }),
    );
    const p1 = refreshWikilinkCandidates('F:\\y\\a.md');
    const p2 = refreshWikilinkCandidates('F:\\y\\a.md');
    resolveFn({ files: ['a.md'], truncated: false });
    await Promise.all([p1, p2]);
    expect(listMarkdownFilesMock).toHaveBeenCalledTimes(1);
    expect(getWikilinkCandidates('F:\\y\\a.md').files).toEqual(['a.md']);
  });

  it('无路径时为 no-op（无目录可扫；菜单照常弹，空态给引导）', async () => {
    await expect(refreshWikilinkCandidates(null)).resolves.toBeUndefined();
    expect(listMarkdownFilesMock).not.toHaveBeenCalled();
  });
});

describe('isWikilinkSuggestAllowed', () => {
  const ed = (...active: string[]) =>
    ({ isActive: (name: string) => active.includes(name) }) as unknown as Parameters<
      typeof isWikilinkSuggestAllowed
    >[0];

  it('未保存文档（无路径）照常可唤出：空态给引导，不静默禁用', () => {
    // 回归锁：曾在此叠加 `!!getDocumentPath()`——敲 [[ 毫无反应，
    // 与「补全坏了」无法区分，只能靠这条断言拦住。
    expect(isWikilinkSuggestAllowed(ed())).toBe(true);
  });

  it('代码块 / 行内代码内不唤出（Slash、Emoji 同款守卫）', () => {
    expect(isWikilinkSuggestAllowed(ed('codeBlock'))).toBe(false);
    expect(isWikilinkSuggestAllowed(ed('code'))).toBe(false);
  });
});
