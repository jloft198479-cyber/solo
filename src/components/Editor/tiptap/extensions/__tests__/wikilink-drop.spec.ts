/**
 * 拖入文档 → 互链 决策的回归测试（一期口径）。
 * 锁住不变量：
 * - 只有「落在正文 + 已保存 + 同目录 .md/.markdown + 非自身」才 insert；否则 fallback。
 * - .txt 只打开不成链；跨目录 / 未保存 / 正文外 / 拖自身 → fallback。
 */
import { describe, expect, it } from 'vitest';

import {
  decideDocumentDrop,
  isDocumentPath,
  isSameDirectory,
  wikilinkTargetFromPath,
} from '../wikilink-drop';

describe('isSameDirectory', () => {
  it('同目录（Windows 反斜杠）判定为真', () => {
    expect(isSameDirectory('C:\\docs\\a.md', 'C:\\docs\\b.md')).toBe(true);
  });
  it('子目录不算同目录', () => {
    expect(isSameDirectory('C:\\docs\\a.md', 'C:\\docs\\sub\\b.md')).toBe(false);
  });
  it('父级/兄弟目录不算同目录', () => {
    expect(isSameDirectory('C:\\docs\\a.md', 'C:\\other\\b.md')).toBe(false);
  });
  it('重复 / 混合分隔符不影响判定（归一化分支）', () => {
    expect(isSameDirectory('C:/docs//a.md', 'C:\\docs\\\\b.md')).toBe(true);
  });
});

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

describe('wikilinkTargetFromPath', () => {
  it('取裸名去 .md 后缀', () => {
    expect(wikilinkTargetFromPath('C:\\docs\\笔记.md')).toBe('笔记');
    expect(wikilinkTargetFromPath('/x/y/Readme.markdown')).toBe('Readme');
  });
});

describe('decideDocumentDrop', () => {
  it('正文内 + 已保存 + 同目录 .md → insert（target 为裸名）', () => {
    expect(
      decideDocumentDrop(['C:\\docs\\b.md'], 'C:\\docs\\a.md', true),
    ).toEqual({ kind: 'insert', targets: ['b'] });
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

  it('跨目录 .md → fallback（一期不做跨目录链接）', () => {
    expect(decideDocumentDrop(['C:\\other\\b.md'], 'C:\\d\\a.md', true)).toEqual({
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
