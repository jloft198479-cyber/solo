// @vitest-environment happy-dom
/**
 * 单元格内容守卫的回归锁（2026-10-12，台账 §二 #60 / `PROPOSAL-cell-fidelity.md` §10）。
 *
 * 锁两件事：
 *  ① **格内造不出块级结构**（schema 收紧为 `paragraph` ⇒ 块级命令 `can()` 为 false）；
 *  ② **入站路径也破坏不了表格**（`insertContent` / 粘贴带块级结构时被守卫拦下 ——
 *     收紧 schema 本身不够：实测 `insertContent({type:'mathBlock'})` 会把格子顶出去、
 *     给表格**多出一格**；粘贴 `<ul>` 会把**表格切开**、列表跑到表格外面）。
 *
 * ⚠️ 反向校准：把 `cell-content-guard.ts` 里 `if (stepInsertsBlockIntoCell(...)) return false;`
 * 这行注掉 ⇒ ② 的两条必须转红；把 `table.ts` 的 `content: 'paragraph'` 改回 `block+`
 * ⇒ ① 转红。
 */
import { Editor } from '@tiptap/vue-3';
import { describe, expect, it } from 'vitest';

import { createEditorExtensions } from '../../editor-extensions';
import { parseMarkdown } from '../../markdown/parser';
import { serializeMarkdown } from '../../markdown/serializer';

const MD = '| 甲 | 乙 |\n| --- | --- |\n| 一 | 二 |\n';

function mkEditor(): Editor {
  const e = new Editor({ extensions: createEditorExtensions({} as never), content: '' });
  e.commands.setContent(parseMarkdown(e.schema, MD).toJSON());
  return e;
}

/** 光标放进含 `needle` 的单元格 */
function caretInCell(e: Editor, needle: string): void {
  let pos = -1;
  e.state.doc.descendants((n, p) => {
    if (pos < 0 && n.isText && n.text === needle) pos = p;
    return true;
  });
  e.commands.setTextSelection(pos);
}

/** 表格结构摘要：顶层节点名 + 每个格子的直接子节点名 */
function shape(e: Editor): string {
  const chains: string[] = [];
  e.state.doc.descendants((n) => {
    if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') {
      const inner: string[] = [];
      n.forEach((c) => inner.push(c.type.name));
      chains.push(`${n.type.name}[${inner.join(',')}]`);
    }
    return true;
  });
  return `顶=${e.state.doc.child(0).type.name} 格数=${chains.length} ${chains.join(' ')}`;
}

describe('单元格内容守卫 · ① 格内造不出块级结构（schema 已收紧）', () => {
  const BLOCK_CMDS = [
    'toggleBulletList',
    'toggleOrderedList',
    'toggleTaskList',
    'toggleBlockquote',
    'toggleCodeBlock',
  ] as const;

  for (const cmd of BLOCK_CMDS) {
    it(`${cmd} 在格内 ${'`can()`'} 为 false、执行不改结构`, () => {
      const e = mkEditor();
      caretInCell(e, '二');
      const before = shape(e);
      expect(e.can().chain().focus()[cmd]().run(), 'can() 必须为 false（菜单可据此禁用）').toBe(false);
      e.chain().focus()[cmd]().run();
      expect(shape(e), '结构一个字节都不许动').toBe(before);
      e.destroy();
    });
  }
});

describe('单元格内容守卫 · ② 入站路径破坏不了表格', () => {
  it('格内 `insertContent(mathBlock)` 被拦下：表格不多格、内容不挪位', () => {
    // 反向校准：注掉 filterTransaction 里的步骤判据 ⇒ 本条转红（实测会多出一个空格子）
    const e = mkEditor();
    caretInCell(e, '二');
    const before = shape(e);
    e.chain().focus().insertContent({ type: 'mathBlock' }).run();
    expect(shape(e), '表格结构必须原样').toBe(before);
    expect(serializeMarkdown(e.state.doc), '两个单元格的文字都要在').toContain('二');
    e.destroy();
  });

  it('格内 `insertContent` 一个列表：同样被拦下（表格不被切开）', () => {
    const e = mkEditor();
    caretInCell(e, '二');
    const before = shape(e);
    e.chain().focus().insertContent('<ul><li>第一项</li><li>第二项</li></ul>').run();
    expect(shape(e), '表格结构必须原样（此前会被切开）').toBe(before);
    e.destroy();
  });

  it('对照：**格外**插入列表完全不受影响（守卫只认格子）', () => {
    // 该文档必须以「表格之外的段落」开头，否则 position 1 已经落在表格第一个格子里
    const e = new Editor({ extensions: createEditorExtensions({} as never), content: '' });
    e.commands.setContent(parseMarkdown(e.schema, `前文\n\n${MD}`).toJSON());
    e.commands.setTextSelection(2); // 段落里
    expect(e.chain().focus().toggleBulletList().run(), '格外照常建列表').toBe(true);
    expect(e.state.doc.textContent, '表格内容原样还在').toContain('甲乙一二');
    e.destroy();
  });

  it('对照：格内插入纯行内内容（文本）不受影响', () => {
    const e = mkEditor();
    caretInCell(e, '二');
    expect(e.chain().focus().insertContent('追加').run()).toBe(true);
    // 光标停在 `二` 上 ⇒ 插在它前面（`insertContent` 是插入到当前选区处）
    expect(e.state.doc.textContent, '文字确实落进了格子').toContain('一追加二');
    expect(shape(e), '结构不变').toBe('顶=table 格数=4 tableHeader[paragraph] tableHeader[paragraph] tableCell[paragraph] tableCell[paragraph]');
    e.destroy();
  });
});
