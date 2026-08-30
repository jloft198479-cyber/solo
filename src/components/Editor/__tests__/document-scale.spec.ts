import { afterEach, describe, expect, it } from 'vitest';

import {
  EXTREME_DOC_CHARS,
  HEAVY_DOC_CHARS,
  countVisibleChars,
  documentTier,
  isHeavyDocument,
  resolveDocumentTier,
  setDocumentTier,
} from '../document-scale';

afterEach(() => setDocumentTier('normal'));

describe('resolveDocumentTier 档位边界', () => {
  it('阈值以下都是 normal', () => {
    expect(resolveDocumentTier(0)).toBe('normal');
    expect(resolveDocumentTier(HEAVY_DOC_CHARS - 1)).toBe('normal');
  });

  it('heavy 区间：含下界，不含上界', () => {
    expect(resolveDocumentTier(HEAVY_DOC_CHARS)).toBe('heavy');
    expect(resolveDocumentTier(EXTREME_DOC_CHARS - 1)).toBe('heavy');
  });

  it('extreme 含下界', () => {
    expect(resolveDocumentTier(EXTREME_DOC_CHARS)).toBe('extreme');
    expect(resolveDocumentTier(EXTREME_DOC_CHARS * 10)).toBe('extreme');
  });

  it('extreme 也属于降级档（heavy 是 extreme 的子集判定）', () => {
    setDocumentTier('extreme');
    expect(isHeavyDocument()).toBe(true);
    setDocumentTier('heavy');
    expect(isHeavyDocument()).toBe(true);
    setDocumentTier('normal');
    expect(isHeavyDocument()).toBe(false);
  });
});

describe('countVisibleChars 度量口径', () => {
  it('无 base64 图片时就是源文本长度', () => {
    const md = '# 标题\n\n正文一段\n';
    expect(countVisibleChars(md)).toBe(md.length);
  });

  it('base64 内嵌图片不计入规模（渲染成独立节点，不参与编辑期全文遍历）', () => {
    const b64 = 'A'.repeat(300_000);
    const md = `前文\n\n![图](data:image/png;base64,${b64})\n\n后文`;
    expect(countVisibleChars(md)).toBe(
      md.length - b64.length - '![图](data:image/png;base64,)'.length,
    );
    // 剔除后不该越过 heavy 阈值——这正是「一张大图就把文档判成降级档」的误伤
    expect(resolveDocumentTier(countVisibleChars(md))).toBe('normal');
  });

  it('多图逐个剔除', () => {
    const b64 = 'B'.repeat(1000);
    const one = `![a](data:image/jpeg;base64,${b64})`;
    const md = `${one}\n${one}\n文字`;
    // 两张图各自被整段删掉，只剩两个换行 + "文字"
    expect(countVisibleChars(md)).toBe('\n\n文字'.length);
  });

  it('含 data:image 但不是图片语法的文本不被误删', () => {
    const md = '说明：data:image 开头的字符串可以出现在正文里';
    expect(countVisibleChars(md)).toBe(md.length);
  });

  it('档位随剔除后的长度变化', () => {
    const filler = 'x'.repeat(HEAVY_DOC_CHARS);
    const hugeImage = `![p](data:image/png;base64,${'C'.repeat(2_000_000)})`;
    expect(resolveDocumentTier(countVisibleChars(`${hugeImage}\n${filler}`))).toBe('heavy');
    expect(resolveDocumentTier(`${hugeImage}\n${filler}`.length)).toBe('extreme');
  });
});

describe('documentTier 本窗口状态', () => {
  it('默认 normal', () => {
    expect(documentTier.value).toBe('normal');
  });

  it('setDocumentTier 发布后立即可读（插件在同一任务内就要看到）', () => {
    setDocumentTier('heavy');
    expect(documentTier.value).toBe('heavy');
  });
});
