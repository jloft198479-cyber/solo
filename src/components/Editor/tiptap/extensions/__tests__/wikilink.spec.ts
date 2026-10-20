import { describe, expect, it } from 'vitest';
import { resolveWikilinkTarget, splitWikilinkAnchor } from '../wikilink';

describe('splitWikilinkAnchor', () => {
  it('把标题锚点从文件名里剥出来（Obsidian 语法 [[B#小节]]）', () => {
    expect(splitWikilinkAnchor('B#小节')).toEqual({ path: 'B', anchor: '小节' });
    expect(splitWikilinkAnchor('sub/B#小节')).toEqual({ path: 'sub/B', anchor: '小节' });
  });

  it('多级锚点整段都算锚点（只切第一个 #）', () => {
    expect(splitWikilinkAnchor('A#一级#二级')).toEqual({ path: 'A', anchor: '一级#二级' });
  });

  it('没有锚点时原样返回 path', () => {
    expect(splitWikilinkAnchor('B')).toEqual({ path: 'B', anchor: '' });
    expect(splitWikilinkAnchor('  B  ')).toEqual({ path: 'B', anchor: '' });
  });

  it('纯锚点：path 为空（指向本文档）', () => {
    expect(splitWikilinkAnchor('#小节')).toEqual({ path: '', anchor: '小节' });
  });
});

describe('resolveWikilinkTarget', () => {
  it('resolves a bare target to a .md file in the same directory (Windows \\)', () => {
    expect(resolveWikilinkTarget('F:\\notes\\A.md', 'B')).toBe('F:\\notes\\B.md');
  });

  it('resolves a bare target to a .md file in the same directory (POSIX /)', () => {
    expect(resolveWikilinkTarget('/home/user/notes/A.md', 'B')).toBe('/home/user/notes/B.md');
  });

  it('keeps an explicit extension instead of appending .md', () => {
    expect(resolveWikilinkTarget('F:\\notes\\A.md', 'B.markdown')).toBe('F:\\notes\\B.markdown');
  });

  it('resolves a subfolder target and normalizes separators to the current path style', () => {
    expect(resolveWikilinkTarget('F:\\notes\\A.md', 'sub/B')).toBe('F:\\notes\\sub\\B.md');
    expect(resolveWikilinkTarget('/home/user/notes/A.md', 'sub\\B')).toBe('/home/user/notes/sub/B.md');
  });

  it('trims surrounding whitespace from the target', () => {
    expect(resolveWikilinkTarget('F:\\notes\\A.md', '  B  ')).toBe('F:\\notes\\B.md');
  });

  it('ignores the heading anchor when resolving the file ([[B#小节]] → B.md)', () => {
    expect(resolveWikilinkTarget('F:\\notes\\A.md', 'B#小节')).toBe('F:\\notes\\B.md');
    expect(resolveWikilinkTarget('F:\\notes\\A.md', 'sub/B#小节')).toBe('F:\\notes\\sub\\B.md');
    // 锚点里带分隔符也不能影响文件名
    expect(resolveWikilinkTarget('F:\\notes\\A.md', 'B#a/b')).toBe('F:\\notes\\B.md');
  });

  it('returns null when the current document is unsaved (null / empty path)', () => {
    expect(resolveWikilinkTarget(null, 'B')).toBeNull();
    expect(resolveWikilinkTarget(undefined, 'B')).toBeNull();
    expect(resolveWikilinkTarget('', 'B')).toBeNull();
  });

  it('returns null for an empty or whitespace-only target', () => {
    expect(resolveWikilinkTarget('F:\\notes\\A.md', '')).toBeNull();
    expect(resolveWikilinkTarget('F:\\notes\\A.md', '   ')).toBeNull();
  });

  it('returns null for an anchor-only target（指向本文档，没有可打开的文件）', () => {
    expect(resolveWikilinkTarget('F:\\notes\\A.md', '#小节')).toBeNull();
  });

  it('returns null when the current path has no directory separator', () => {
    expect(resolveWikilinkTarget('A.md', 'B')).toBeNull();
  });
});
