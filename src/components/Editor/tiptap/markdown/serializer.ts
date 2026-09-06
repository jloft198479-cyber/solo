/**
 * ProseMirror Document → Markdown 序列化器
 *
 * 将 ProseMirror 文档树转换为 markdown 字符串。
 * 自定义实现以精确控制输出格式，支持 GFM 表格、任务列表等扩展语法。
 */
import type { Node as PMNode, Mark, Slice } from '@tiptap/pm/model';
import { getPluginNodeSerializers } from './plugins';
import { computeFence } from './plugins/fence';

// ── 序列化状态 ────────────────────────────────────���─────────────

export class MarkdownSerializerState {
  output = '';
  private closed: PMNode | null = null;
  private inTightList = false;
  /** 嵌套列表每层项的缩进贡献栈（替代固定 3 空格计数，见 renderList） */
  private listIndentStack: number[] = [];
  readonly clipboard: boolean;

  constructor(options?: { clipboard?: boolean }) {
    this.clipboard = options?.clipboard ?? false;
  }

  /**
   * 创建共享配置的子 state（用于先渲染内层再整体加前缀的节点，如 blockquote/callout）。
   * 子 state 继承 clipboard 模式，保证内层转义策略与整体一致。
   * 做成实例方法而非直接 new，避免插件模块运行时 import 本类造成循环依赖。
   */
  createChild(): MarkdownSerializerState {
    return new MarkdownSerializerState({ clipboard: this.clipboard });
  }

  /** 写入文本 */
  write(text: string) {
    this.flushClose();
    this.output += text;
  }

  /** 写入一行（末尾加换行） */
  writeLine(text: string) {
    this.write(text + '\n');
  }

  /** 确保输出以换行结尾 */
  ensureNewline() {
    if (this.output.length && !this.output.endsWith('\n')) {
      this.output += '\n';
    }
  }

  /** 关闭段落（延迟写入换行，用于列表紧凑模式判断） */
  closeBlock(node: PMNode) {
    this.closed = node;
  }

  flushClose(extra = 0) {
    if (!this.closed) return;
    this.closed = null;
    this.ensureNewline();
    for (let i = 0; i < extra; i++) this.output += '\n';
  }

  /** 增加空行分隔 */
  blankLine() {
    this.flushClose();
    this.ensureNewline();
    if (!this.output.endsWith('\n\n')) {
      this.output += '\n';
    }
  }

  /** 序列化 inline 内容 */
  renderInline(parent: PMNode) {
    const codeDelims = this._precomputeCodeDelims(parent);
    parent.forEach((child, _offset, index) => {
      if (child.isText) {
        this.renderMarks(child, parent, index, true, codeDelims);
        const hasCodeMark = child.marks.some((mark) => mark.type.name === 'code');
        this.write(hasCodeMark ? (child.text ?? '') : this.escapeInline(child.text ?? ''));
        this.renderMarks(child, parent, index, false, codeDelims);
      } else {
        this.renderMarks(child, parent, index, true, codeDelims);
        this.renderNode(child);
        this.renderMarks(child, parent, index, false, codeDelims);
      }
    });
  }

  private activeMarks: readonly Mark[] = [];

  /** 开启/关闭 marks */
  private renderMarks(node: PMNode, parent: PMNode, index: number, opening: boolean, codeDelims?: Map<number, { open: string; close: string }>) {
    const marks = node.marks;
    if (opening) {
      for (const mark of marks) {
        if (!mark.isInSet(this.activeMarks)) {
          this.activeMarks = mark.addToSet(this.activeMarks);
          if (mark.type.name === 'code') {
            this.write(codeDelims?.get(index)?.open ?? this._codeSpanDelims(node, parent, index).open);
          } else {
            this.write(this.markDelimiter(mark, true));
          }
        }
      }
    } else {
      const next = this.findNextNonToken(parent, index);
      for (let i = marks.length - 1; i >= 0; i--) {
        const mark = marks[i];
        if (!next || !mark.isInSet(next.marks)) {
          this.activeMarks = mark.removeFromSet(this.activeMarks);
          if (mark.type.name === 'code') {
            this.write(codeDelims?.get(index)?.close ?? this._codeSpanDelims(node, parent, index).close);
          } else {
            this.write(this.markDelimiter(mark, false));
          }
        }
      }
    }
  }

  /** 预计算 code span 分隔符组，O(N) 一次扫描替代 _codeSpanDelims 的 O(N²) 扫描 */
  private _precomputeCodeDelims(parent: PMNode): Map<number, { open: string; close: string }> {
    const cache = new Map<number, { open: string; close: string }>();
    let i = 0;
    const count = parent.childCount;
    while (i < count) {
      const child = parent.child(i);
      if (child.isText && child.marks.some(m => m.type.name === 'code')) {
        let start = i;
        while (start > 0) {
          const prev = parent.child(start - 1);
          if (!prev.isText || !prev.marks.some(m => m.type.name === 'code') || !this._hasSameCodeMarkSet(prev, child)) break;
          start--;
        }
        let end = i;
        while (end < count - 1) {
          const next = parent.child(end + 1);
          if (!next.isText || !next.marks.some(m => m.type.name === 'code') || !this._hasSameCodeMarkSet(next, child)) break;
          end++;
        }
        let content = '';
        for (let j = start; j <= end; j++) content += parent.child(j).text ?? '';
        let maxRun = 0, cur = 0;
        for (const ch of content) {
          if (ch === '`') { cur++; maxRun = Math.max(maxRun, cur); } else { cur = 0; }
        }
        const delim = '`'.repeat(maxRun + 1);
        const delims = needsCodePadding(content)
          ? { open: delim + ' ', close: ' ' + delim }
          : { open: delim, close: delim };
        for (let j = start; j <= end; j++) cache.set(j, delims);
        i = end + 1;
      } else {
        i++;
      }
    }
    return cache;
  }

  /** 计算 code span 的开/关分隔符（处理内容含反引号、首尾空白等边界） */
  private _codeSpanDelims(node: PMNode, parent: PMNode, index: number): { open: string; close: string } {
    let startIdx = index;
    while (startIdx > 0) {
      const prev = parent.child(startIdx - 1);
      if (!prev.isText) break;
      if (!prev.marks.some(m => m.type.name === 'code')) break;
      if (!this._hasSameCodeMarkSet(prev, node)) break;
      startIdx--;
    }
    let endIdx = index;
    while (endIdx < parent.childCount - 1) {
      const next = parent.child(endIdx + 1);
      if (!next.isText) break;
      if (!next.marks.some(m => m.type.name === 'code')) break;
      if (!this._hasSameCodeMarkSet(next, node)) break;
      endIdx++;
    }
    let content = '';
    for (let i = startIdx; i <= endIdx; i++) {
      content += parent.child(i).text ?? '';
    }
    let maxRun = 0;
    let cur = 0;
    for (const ch of content) {
      if (ch === '`') { cur++; maxRun = Math.max(maxRun, cur); }
      else { cur = 0; }
    }
    const delim = '`'.repeat(maxRun + 1);
    if (needsCodePadding(content)) {
      return { open: delim + ' ', close: ' ' + delim };
    }
    return { open: delim, close: delim };
  }

  private _hasSameCodeMarkSet(a: PMNode, b: PMNode): boolean {
    const aCode = a.marks.filter(m => m.type.name === 'code');
    const bCode = b.marks.filter(m => m.type.name === 'code');
    if (aCode.length !== bCode.length) return false;
    for (let i = 0; i < aCode.length; i++) {
      if (!aCode[i].eq(bCode[i])) return false;
    }
    return true;
  }

  private markDelimiter(mark: Mark, _opening: boolean): string {
    switch (mark.type.name) {
      case 'bold': return '**';
      case 'italic': return '*';
      case 'strike': return '~~';
      case 'code': return '`';
      case 'highlight': return '==';
      case 'superscript': return '^';
      case 'subscript': return '~';
      case 'dim': return _opening ? '<span class="mk-dim">' : '</span>';
      case 'link': {
        if (_opening) return '[';
        const href = escapeLinkDestination(mark.attrs.href as string);
        return `](${href}${mark.attrs.title ? ` "${escapeLinkTitle(mark.attrs.title as string)}"` : ''})`;
      }
      default: return '';
    }
  }

  /** 查找下一个非 token 节点（用于判断 mark 是否需要关闭） */
  private findNextNonToken(parent: PMNode, index: number): PMNode | null {
    // ProseMirror 中所有子节点都是真实节点，不存在需要跳过的 token。
    // 直接返回下一个兄弟节点，若无则返回 null。
    const nextIndex = index + 1;
    return nextIndex < parent.childCount ? parent.child(nextIndex) : null;
  }

  private escapeInline(text: string): string {
    // 判断当前是否处于行首位置（需要额外转义行首特殊字符）
    // this.closed 不为 null 表示前一个块已关闭但换行尚未写入，等效于行首
    const atLineStart =
      this.closed !== null ||
      this.output.length === 0 ||
      this.output.endsWith('\n');

    let result = text.replace(/\\/g, '\\\\');

    // `_` 选择性转义（B1/B2）：必须在 `\` 转义**之后**（否则自己产出的 `\_`
    // 会被二次转义成 `\\_`，parse 后还原为 `\` + 未转义 `_`，反而变斜体）；
    // 后续类转义不含 `_` 与 `\`，`\_` 产物可安全穿过
    if (result.includes('_')) result = escapeUnderscores(result);

    if (this.clipboard) {
      // 剪贴板模式：轻量转义。核心语法 + `_~[]<>`（出站粘到 Obsidian/Typora
      // 不被重新解释为斜体/删除线/链接样式/HTML）；`_` 由 escapeUnderscores 处理
      result = result.replace(/([`*~[\]<>])/g, '\\$1');
      if (atLineStart) {
        result = result.replace(/^([#+\-.>=])/, '\\$1');
      }
      result = result.replace(/\n([#+\-.>=])/g, '\n\\$1');
    } else {
      // 文件保存模式：严格转义所有特殊字符，保证 roundtrip fidelity
      //（`_` 不在此列——由 escapeUnderscores 按 intraword 例外选择性转义）
      result = result.replace(/([`[\]()*~^=|$<>{}])/g, '\\$1');
      if (atLineStart) {
        result = result.replace(/^([#+\-.])/, '\\$1');
      }
      result = result.replace(/\n([#+\-.])/g, '\n\\$1');
    }

    // ZWNJ 仅供解析阶段使用，序列化时移除以避免污染输出
    result = result.replace(/\u200C/g, '');

    return result;
  }

  /** 序列化节点 */
  renderNode(node: PMNode) {
    const handler = nodeSerializers[node.type.name];
    if (handler) {
      handler(this, node);
    } else {
      // 未知节点 → 按文本序列化
      if (node.isTextblock) {
        this.renderInline(node);
        this.closeBlock(node);
      } else {
        this.renderContent(node);
      }
    }
  }

  /** 递归序列化子节点 */
  renderContent(parent: PMNode) {
    let prev: PMNode | null = null;
    parent.forEach((child, _offset, index) => {
      if (index > 0) {
        if (child.isBlock) {
          if (prev?.type.name === 'horizontalRule' && child.type.name === 'horizontalRule') {
            this.ensureNewline();
          } else {
            this.blankLine();
          }
        }
      }
      prev = child;
      this.renderNode(child);
    });
  }

  /** 序列化列表 */
  renderList(
    node: PMNode,
    getDelim: (index: number, node: PMNode) => string,
    itemIndentWidth?: (delim: string) => number,
  ) {
    const prevTight = this.inTightList;
    this.inTightList = true;
    // 本层列表项 marker 的基础缩进 = 祖先各层项的缩进贡献之和（B4：
    // 嵌套列表缩进按祖先 marker 实际宽度对齐，有序列表第 10 项起 `10. ` 宽 4，
    // 固定 3 空格会让子列表脱离父项变成文档级列表）
    const baseIndent = this.listIndentStack.reduce((sum, w) => sum + w, 0);
    const indent = ' '.repeat(baseIndent);
    node.forEach((child, _offset, index) => {
      if (index > 0) this.ensureNewline();
      const delim = getDelim(index, child);
      this.write(indent + delim);
      // 本项的缩进贡献：marker 内容列（≥3 维持既有落盘字节不变；task 列表的
      // checkbox 属于内容，marker 实际是 '- '，由 itemIndentWidth 特判）
      const width = itemIndentWidth ? itemIndentWidth(delim) : delim.length;
      this.listIndentStack.push(Math.max(3, width));
      this.renderContent(child);
      this.listIndentStack.pop();
    });
    this.inTightList = prevTight;
  }
}

// ── 节点序列化器 ──────────────────���─────────────────────────────

export type NodeSerializer = (state: MarkdownSerializerState, node: PMNode) => void;

const nodeSerializers: Record<string, NodeSerializer> = {
  doc(state, node) {
    state.renderContent(node);
  },

  paragraph(state, node) {
    if (node.childCount === 0) {
      state.write('\u00a0');
      state.closeBlock(node);
      return;
    }

    state.renderInline(node);
    state.closeBlock(node);
  },

  heading(state, node) {
    const marker = '#'.repeat(node.attrs.level);
    state.write(marker + ' ');
    const start = state.output.length;
    state.renderInline(node);
    // 转义行末 #（前有空格），避免被 re-parse 当成 ATX closing marker 吃掉
    let hashStart = state.output.length - 1;
    while (hashStart >= start && state.output[hashStart] === '#') hashStart--;
    if (state.output.length - 1 - hashStart > 0 && hashStart >= start && state.output[hashStart] === ' ') {
      state.output = state.output.slice(0, hashStart + 1) + '\\' + state.output.slice(hashStart + 1);
    }
    state.closeBlock(node);
  },

  blockquote(state, node) {
    // 序列化引用块：逐行添加 > 前缀
    const inner = state.createChild();
    inner.renderContent(node);
    const text = inner.output.replace(/\n$/, '');
    const lines = text.split('\n');
    for (const line of lines) {
      state.writeLine(`> ${line}`);
    }
    state.closeBlock(node);
  },

  bulletList(state, node) {
    state.renderList(node, () => '- ');
  },

  orderedList(state, node) {
    const start = node.attrs.start ?? 1;
    state.renderList(node, (index) => `${start + index}. `);
  },

  listItem(state, node) {
    state.renderContent(node);
  },

  taskList(state, node) {
    state.renderList(
      node,
      (_index, child) => {
        const checked = child.attrs.checked;
        return checked ? '- [x] ' : '- [ ] ';
      },
      // checkbox 是列表项内容而非 marker，实际 marker 是 '- '（宽 2）
      () => 2,
    );
  },

  taskItem(state, node) {
    state.renderContent(node);
  },

  codeBlock(state, node) {
    const lang = node.attrs.language || '';
    const content = node.textContent;
    // CommonMark: backtick fence 的 info string 不能含反引号,
    // 遇到含反引号的 language 时改用 ~~~ fence
    const hasLangBackticks = lang.includes('`');
    const fenceChar = hasLangBackticks ? '~' : '`';
    const fence = computeFence(content, fenceChar);
    state.writeLine(fence + lang);
    state.writeLine(content);
    state.writeLine(fence);
    state.closeBlock(node);
  },

  horizontalRule(state, node) {
    state.writeLine('---');
    state.closeBlock(node);
  },

  hardBreak(state) {
    state.write('  \n');
  },

  image(state, node) {
    const alt = node.attrs.alt || '';
    const src = escapeLinkDestination(node.attrs.src || '');
    const title = node.attrs.title;
    const width = node.attrs.width;
    const height = node.attrs.height;
    // 有尺寸时输出 `![alt|WxH](src)`，无尺寸时输出 `![alt](src)`
    const altWithDims =
      width != null && height != null
        ? `${alt}|${width}x${height}`
        : alt;
    if (title) {
      state.write(`![${altWithDims}](${src} "${escapeLinkTitle(title as string)}")`);
    } else {
      state.write(`![${altWithDims}](${src})`);
    }
  },

  // ── 表格 ──

  table(state, node) {
    const rows: PMNode[] = [];
    node.forEach((row) => rows.push(row));
    if (rows.length === 0) return;

    // 收集列数
    const colCount = rows[0].childCount;

    // 计算每列最大宽度
    const colWidths: number[] = Array(colCount).fill(3); // 最小3（分隔行 ---）
    for (const row of rows) {
      row.forEach((cell, _offset, colIndex) => {
        const text = cellToText(state, cell);
        colWidths[colIndex] = Math.max(colWidths[colIndex], text.length);
      });
    }

    // 序列化每行
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const cells: string[] = [];
      row.forEach((cell, _offset, colIndex) => {
        const text = cellToText(state, cell);
        cells.push(text.padEnd(colWidths[colIndex]));
      });
      state.writeLine('| ' + cells.join(' | ') + ' |');

      // 在第一行（表头）后插入分隔行
      if (r === 0) {
        const sep = colWidths.map(w => '-'.repeat(w));
        state.writeLine('| ' + sep.join(' | ') + ' |');
      }
    }
    state.closeBlock(node);
  },

  tableRow() { /* handled by table */ },
  tableHeader() { /* handled by table */ },
  tableCell() { /* handled by table */ },

  // ── 插件节点 ──

  ...getPluginNodeSerializers(),

};

/** 将表格单元格节点序列化为纯文本（含 inline 标记） */
function cellToText(state: MarkdownSerializerState, cell: PMNode): string {
  const s = state.createChild();
  cell.forEach((child) => {
    if (child.type.name === 'paragraph') {
      s.renderInline(child);
    } else {
      s.renderNode(child);
    }
  });
  return s.output.trim().replace(/ {2}\n/g, '<br>').replace(/\n/g, '<br>');
}

const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

/**
 * `_` 选择性转义（CommonMark intraword 例外，B1/B2）：
 * - 前后都是字母/数字的 `_`（snake_case、中文_中文）不构成强调定界符，保持原样，
 *   落盘/出站字节干净；
 * - 其余位置（空格/行首/标点包围）的 `_` 会被 CommonMark 解释为斜体，转义为 `\_`。
 * 全局转义虽也正确，但会让代码标识符满屏反斜杠；选择性转义在保真正确性前提下
 * 最小化字节改动。
 */
function escapeUnderscores(text: string): string {
  let out = '';
  let prevIsWord = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '_') {
      const nextIsWord = i + 1 < text.length && WORD_CHAR_RE.test(text[i + 1]);
      out += prevIsWord && nextIsWord ? ch : '\\_';
    } else {
      out += ch;
    }
    prevIsWord = WORD_CHAR_RE.test(ch);
  }
  return out;
}

/**
 * code span 是否需要首尾空格 padding（B6）：
 * - 内容首/尾含反引号：padding 防止与定界符粘连；
 * - 内容首尾**同时**有空格且非全空格：CommonMark 会剥掉首尾各一个空格，
 *   必须 padding 一个空格让剥除后还原（` x ` → `` `  x  ` `` → 剥回 ` x `）；
 * - 全空格内容 CommonMark 不剥，无需 padding。
 */
function needsCodePadding(content: string): boolean {
  return (
    content.startsWith('`') ||
    content.endsWith('`') ||
    (content.startsWith(' ') && content.endsWith(' ') && content.trim() !== '')
  );
}

function escapeLinkTitle(title: string): string {
  return title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 链接 destination 中反斜杠的稳定性转义（CommonMark 规则，实测 markdown-it）：
 * - 「\ + ASCII 标点」是合法转义，重解析会吃掉反斜杠（foo\*bar → foo*bar）→ 补成 \\
 * - 末尾单独的 \ 会转义闭合括号/尖括号，整条链接解析失败（Ex 603）→ 补成 \\
 * - 「\ + 非标点」（\n \a \中文）不是转义，重解析保留字面反斜杠 → 原样输出，
 *   Windows 路径 C:\notes\a.md 保持字节干净（B8）
 */
function escapeDestBackslashes(src: string): string {
  return src.replace(/\\(?=[!-/:-@[-`{-~])|\\$/g, '\\\\');
}

/**
 * 链接/图片地址的落盘转义（CommonMark destination 规则）：
 * - 括号成对时是合法 destination，原样输出（保持既有文档字节不变）
 * - 含空白/尖括号/落单括号时用 `<...>` 包裹形式（实测 markdown-it：
 *   反斜杠转义对括号有效、对空格无效——`\ ` 会让整个图片语法解析失败，
 *   只有尖括号形式能携带空格）
 * 历史 bug：`Pasted image xxx.png`（剪贴板粘贴/带空格截图文件名）原样写入后
 * 重开解析不出 image 节点，整段退化成字面文本——图片「丢失」。
 */
export function escapeLinkDestination(src: string): string {
  let depth = 0;
  let unbalanced = false;
  for (const ch of src) {
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth < 0) {
        unbalanced = true;
        break;
      }
    }
  }
  if (depth !== 0) unbalanced = true;

  if (!unbalanced && !/[\s<>]/.test(src)) {
    return escapeDestBackslashes(src).replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }
  return `<${escapeDestBackslashes(src).replace(/([<>])/g, '\\$1')}>`;
}

// ── 导出 ─────────────────��────────────��───────────────────────

export function serializeMarkdown(doc: PMNode): string {
  const state = new MarkdownSerializerState();
  state.renderNode(doc);
  let output = state.output;
  // 确保文件以单个换行结尾
  output = output.replace(/\n*$/, '\n');
  return output;
}

/** 剪贴板序列化：使用轻量转义，避免 `\=` `\?` `\!` 等多余符号 */
export function serializeMarkdownForClipboard(doc: PMNode): string {
  const state = new MarkdownSerializerState({ clipboard: true });
  state.renderNode(doc);
  let output = state.output;
  output = output.replace(/\n*$/, '\n');
  return output;
}

/**
 * 出站复制：把选区 Slice 序列化为 Markdown 纯文本（供 `editorProps.clipboardTextSerializer` 使用）。
 *
 * ProseMirror 默认 `clipboardTextSerializer` 只输出 `textContent`（纯文本），
 * 导致 callout / 数学公式 / mermaid / wikilink / frontmatter / 脚注等 solo
 * 扩展语法粘到外部 Markdown 编辑器时标记全丢。这里用文档的 schema 把选区内容
 * 重新序列化为 Markdown，外部编辑器从 `text/plain` 即可拿到完整语法。
 * `text/html` 仍由 ProseMirror 默认生成（标准格式走 HTML 还原，不受影响）。
 */
export function serializeClipboardSlice(doc: PMNode, slice: Slice): string {
  const sliced = doc.copy(slice.content);
  return serializeMarkdownForClipboard(sliced);
}
