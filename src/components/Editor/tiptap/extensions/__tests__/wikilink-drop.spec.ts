/**
 * 拖入文档 → 互链 决策的回归测试。
 * 锁住不变量：
 * - 只有「落在正文 + 已保存 + 目录树内 + 深度内 + .md/.markdown + 非自身」才 insert；
 *   否则 fallback（回落「打开」，非破坏性、可撤销）。
 * - .txt 只打开不成链；兄弟目录 / 出界 / 未保存 / 正文外 / 拖自身 → fallback。
 * - 子目录成链时 target 是**相对路径**，与 `[[` 补全插入的写法一致。
 */
import { describe, expect, it } from 'vitest';

import {
  decideDocumentDrop,
  isDocumentPath,
  wikilinkTargetFromRelative,
} from '../wikilink-drop';
import { resolveWikilinkTarget } from '../wikilink';

describe('isDocumentPath', () => {
  it('识别可打开文档后缀（大小写不敏感）', () => {
    expect(isDocumentPath('C:\\d\\a.md')).toBe(true);
    expect(isDocumentPath('C:\\d\\a.MARKDOWN')).toBe(true);
    expect(isDocumentPath('C:\\d\\note.txt')).toBe(true);
  });
  it('图片等非文档为假', () => {
    expect(isDocumentPath('C:\\d\\p.png')).toBe(false);
  });
});

describe('wikilinkTargetFromRelative', () => {
  it('.md 去后缀、其他后缀保留（解析器只补 .md，去重后缀会造死链）', () => {
    expect(wikilinkTargetFromRelative('笔记.md')).toBe('笔记');
    expect(wikilinkTargetFromRelative('sub\\Readme.markdown')).toBe('sub/Readme.markdown');
    // 大小写不敏感：`.MD` 也是可省略的 .md
    expect(wikilinkTargetFromRelative('sub/Note.MD')).toBe('sub/Note');
  });
});

describe('decideDocumentDrop', () => {
  it('正文内 + 已保存 + 同目录 .md → insert（target 为裸名）', () => {
    expect(
      decideDocumentDrop(['C:\\docs\\b.md'], 'C:\\docs\\a.md', true),
    ).toEqual({ kind: 'insert', targets: ['b'] });
  });

  it('子目录 .md → insert，target 为相对路径（与 [[ 补全同写法）', () => {
    expect(
      decideDocumentDrop(['C:\\docs\\sub\\b.md'], 'C:\\docs\\a.md', true),
    ).toEqual({ kind: 'insert', targets: ['sub/b'] });
  });

  it('两级子目录 .md → insert（深度上限内）', () => {
    expect(
      decideDocumentDrop(['C:\\docs\\sub\\deep\\c.md'], 'C:\\docs\\a.md', true),
    ).toEqual({ kind: 'insert', targets: ['sub/deep/c'] });
  });

  it('超出深度上限 → fallback（范围外不生成链接）', () => {
    expect(
      decideDocumentDrop(['C:\\docs\\l1\\l2\\l3\\d.md'], 'C:\\docs\\a.md', true),
    ).toEqual({ kind: 'fallback' });
  });

  it('拖入 .markdown → target 保留后缀（后缀一去就指向不存在的 b.md）', () => {
    const decision = decideDocumentDrop(['C:\\docs\\sub\\b.markdown'], 'C:\\docs\\a.md', true);
    expect(decision).toEqual({ kind: 'insert', targets: ['sub/b.markdown'] });
    // 与解析器口径对齐（审核 R-3）：这样拼出来的路径正是被拖进来的那篇，
    // 点开能打开、标红也不判（非 .md 扩展名一律不标）
    expect(resolveWikilinkTarget('C:\\docs\\a.md', 'sub/b.markdown')).toBe(
      'C:\\docs\\sub\\b.markdown',
    );
    // 反面对照：把后缀一起去掉，得到的就是指向不存在文件的死链
    expect(resolveWikilinkTarget('C:\\docs\\a.md', 'sub/b')).toBe('C:\\docs\\sub\\b.md');
  });

  it('重复 / 混合分隔符不影响判定（归一化分支）', () => {
    expect(
      decideDocumentDrop(['C:/docs//sub\\\\b.md'], 'C:\\docs\\a.md', true),
    ).toEqual({ kind: 'insert', targets: ['sub/b'] });
  });

  it('一次拖入多个同目录 .md → 全部成链', () => {
    expect(
      decideDocumentDrop(['C:\\d\\b.md', 'C:\\d\\c.md'], 'C:\\d\\a.md', true),
    ).toEqual({ kind: 'insert', targets: ['b', 'c'] });
  });

  it('正文外 → fallback（交回窗口层打开）', () => {
    expect(decideDocumentDrop(['C:\\d\\b.md'], 'C:\\d\\a.md', false)).toEqual({
      kind: 'fallback',
    });
  });

  it('未保存文档（无路径）→ fallback', () => {
    expect(decideDocumentDrop(['C:\\d\\b.md'], null, true)).toEqual({ kind: 'fallback' });
  });

  it('兄弟目录 .md → fallback（只处理当前目录树内的文件）', () => {
    expect(decideDocumentDrop(['C:\\other\\b.md'], 'C:\\d\\a.md', true)).toEqual({
      kind: 'fallback',
    });
  });

  it('前缀相同的兄弟目录不算在内（D:/a/bc 不在 D:/a/b 下）', () => {
    expect(decideDocumentDrop(['C:\\docs2\\b.md'], 'C:\\docs\\a.md', true)).toEqual({
      kind: 'fallback',
    });
  });

  it('.txt → fallback（不成链）', () => {
    expect(decideDocumentDrop(['C:\\d\\note.txt'], 'C:\\d\\a.md', true)).toEqual({
      kind: 'fallback',
    });
  });

  it('无文档文件（纯图片）→ fallback', () => {
    expect(decideDocumentDrop(['C:\\d\\p.png'], 'C:\\d\\a.md', true)).toEqual({
      kind: 'fallback',
    });
  });

  it('拖当前文档自身 → fallback（不生成自链接）', () => {
    expect(decideDocumentDrop(['C:\\d\\a.md'], 'C:\\d\\a.md', true)).toEqual({
      kind: 'fallback',
    });
  });

  it('混拖自身 + 同目录他篇 → 只对他篇成链', () => {
    expect(
      decideDocumentDrop(['C:\\d\\a.md', 'C:\\d\\b.md'], 'C:\\d\\a.md', true),
    ).toEqual({ kind: 'insert', targets: ['b'] });
  });

  it('混拖：.md 同目录 + 图片 → 只插链，图片交回原逻辑（决策只看文档集）', () => {
    expect(
      decideDocumentDrop(['C:\\d\\p.png', 'C:\\d\\b.md'], 'C:\\d\\a.md', true),
    ).toEqual({ kind: 'insert', targets: ['b'] });
  });
});
