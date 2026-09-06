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
} from '../wikilink-suggest';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('filterWikilinkCandidates', () => {
  it('无文档路径 / 缓存未命中时返回空列表', async () => {
    expect(filterWikilinkCandidates('', null)).toEqual([]);
    // 已刷新 a 目录后，b 目录路径的过滤在刷新前应为空（单槽缓存 key 隔离）
    listMarkdownFilesMock.mockResolvedValue(['a.md']);
    await refreshWikilinkCandidates('C:\\docs\\a.md');
    expect(filterWikilinkCandidates('', 'C:\\docs\\b.md')).toEqual([]);
  });

  it('去 .md 后缀、排除自身、大小写不敏感匹配', async () => {
    listMarkdownFilesMock.mockResolvedValue(['笔记.md', 'README.md', 'temp.md', '.md']);
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

  it('菜单上限 50 条', async () => {
    listMarkdownFilesMock.mockResolvedValue(
      Array.from({ length: 60 }, (_, i) => `f${String(i).padStart(2, '0')}.md`),
    );
    await refreshWikilinkCandidates('D:\\notes\\index.md');
    expect(filterWikilinkCandidates('', 'D:\\notes\\index.md')).toHaveLength(50);
  });
});

describe('refreshWikilinkCandidates', () => {
  it('失败退化为空列表，不抛错', async () => {
    listMarkdownFilesMock.mockRejectedValue(new Error('io'));
    await expect(refreshWikilinkCandidates('E:\\x\\a.md')).resolves.toBeUndefined();
    expect(getWikilinkCandidates('E:\\x\\a.md')).toEqual([]);
  });

  it('并发去重：同路径同时刷新只发一次 IPC', async () => {
    let resolveFn: (v: string[]) => void = () => {};
    listMarkdownFilesMock.mockReturnValue(
      new Promise<string[]>((resolve) => {
        resolveFn = resolve;
      }),
    );
    const p1 = refreshWikilinkCandidates('F:\\y\\a.md');
    const p2 = refreshWikilinkCandidates('F:\\y\\a.md');
    resolveFn(['a.md']);
    await Promise.all([p1, p2]);
    expect(listMarkdownFilesMock).toHaveBeenCalledTimes(1);
    expect(getWikilinkCandidates('F:\\y\\a.md')).toEqual(['a.md']);
  });

  it('无路径时为 no-op（未保存文档不唤出补全）', async () => {
    await expect(refreshWikilinkCandidates(null)).resolves.toBeUndefined();
    expect(listMarkdownFilesMock).not.toHaveBeenCalled();
  });
});
