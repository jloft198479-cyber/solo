/**
 * ProseMirror Document → Markdown 序列化器
 *
 * 将 ProseMirror 文档树转换为 markdown 字符串。
 * 自定义实现以精确控制输出格式，支持 GFM 表格、任务列表等扩展语法。
 */
import type { Node as PMNode, Mark } from '@tiptap/pm/model';
import { getPluginNodeSerializers } from './plugins';

// ── 序列化状态 ────────────────────────────────────���─────────────

export class MarkdownSerializerState {
  output = '';
  private closed: PMNode | null = null;
  private inTightList = false;
  private listDepth = 0;
  private readonly clipboard: boolean;

  constructor(options?: { clipboard?: boolean }) {
    this.clipboard = options?.clipboard ?? false;
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
    parent.forEach((child, _offset, index) => {
      if (child.isText) {
        this.renderMarks(child, parent, index, true);
        const hasCodeMark = child.marks.some((mark) => mark.type.name === 'code');
        this.write(hasCodeMark ? (child.text ?? '') : this.escapeInline(child.text ?? ''));
        this.renderMarks(child, parent, index, false);
      } else {
        this.renderMarks(child, parent, index, true);
        this.renderNode(child);
        this.renderMarks(child, parent, index, false);
      }
    });
  }

  private activeMarks: readonly Mark[] = [];

  /** 开启/关闭 marks */
  private renderMarks(node: PMNode, parent: PMNode, index: number, opening: boolean) {
    const marks = node.marks;
    if (opening) {
      for (const mark of marks) {
        if (!mark.isInSet(this.activeMarks)) {
          this.activeMarks = mark.addToSet(this.activeMarks);
          if (mark.type.name === 'code') {
            this.write(this._codeSpanDelims(node, parent, index).open);
          } else {
            this.write(this.markDelimiter(mark, true));
          }
        }
      }
    } else {
      const next = this.findNextNonToken(parent, index);
      let zwnjInserted = false;
      for (let i = marks.length - 1; i >= 0; i--) {
        const mark = marks[i];
        if (!next || !mark.isInSet(next.marks)) {
          if (!zwnjInserted && (mark.type.name === 'bold' || mark.type.name === 'italic') && next && this._delimiterBoundaryUnsafe(node, next)) {
            this.output += '\u200C';
            zwnjInserted = true;
          }
          this.activeMarks = mark.removeFromSet(this.activeMarks);
          if (mark.type.name === 'code') {
            this.write(this._codeSpanDelims(node, parent, index).close);
          } else {
            this.write(this.markDelimiter(mark, false));
          }
        }
      }
    }
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
    if (content.startsWith('`') || content.endsWith('`')) {
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

  /** 检查 bold/italic 关闭边界是否不安全——前字符为 Unicode 标点且后字符非空白/非标点 */
  private _delimiterBoundaryUnsafe(node: PMNode, next: PMNode): boolean {
    if (!node.isText) return false;
    const text = node.text ?? '';
    if (!text) return false;
    const lastChar = text.charAt(text.length - 1);
    if (!lastChar || !this._isUnicodePunctOrSym(lastChar)) return false;

    const nextText = next.isText ? (next.text ?? '') : '';
    if (!nextText) return false;
    const firstNextChar = nextText.charAt(0);
    const code = firstNextChar.charCodeAt(0);

    // 同 markdown-it isWhiteSpace 逻辑
    if (code >= 0x2000 && code <= 0x200A) return false;
    switch (code) {
      case 0x09: case 0x0A: case 0x0B: case 0x0C: case 0x0D:
      case 0x20: case 0xA0: case 0x1680: case 0x202F:
      case 0x205F: case 0x3000:
        return false;
    }

    if (this._isUnicodePunctOrSym(firstNextChar)) return false;
    return true;
  }

  private _isUnicodePunctOrSym(ch: string): boolean {
    return /\p{P}|\p{S}/u.test(ch);
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
      case 'link': {
        if (_opening) return '[';
        const href = (mark.attrs.href as string).replace(/\(/g, '\\(').replace(/\)/g, '\\)');
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

    if (this.clipboard) {
      // 剪贴板模式：只转义核心 markdown 语法，避免 `\=` `\?` `\!` 等多余符号
      result = result.replace(/([`*])/g, '\\$1');
      if (atLineStart) {
        result = result.replace(/^([#+\-.>=])/, '\\$1');
      }
      result = result.replace(/\n([#+\-.>=])/g, '\n\\$1');
    } else {
      // 文件保存模式：严格转义所有特殊字符，保证 roundtrip fidelity
      result = result.replace(/([`[\]()*~^=|$<>{}])/g, '\\$1');
      if (atLineStart) {
        result = result.replace(/^([#+\-.])/, '\\$1');
      }
      result = result.replace(/\n([#+\-.])/g, '\n\\$1');
    }

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
  renderList(node: PMNode, getDelim: (index: number, node: PMNode) => string) {
    const prevTight = this.inTightList;
    this.inTightList = true;
    const savedDepth = this.listDepth;
    this.listDepth++;
    const indent = '   '.repeat(savedDepth);
    node.forEach((child, _offset, index) => {
      if (index > 0) this.ensureNewline();
      const delim = getDelim(index, child);
      this.write(indent + delim);
      this.renderContent(child);
    });
    this.listDepth = savedDepth;
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
    const inner = new MarkdownSerializerState();
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
    state.renderList(node, (_index, child) => {
      const checked = child.attrs.checked;
      return checked ? '- [x] ' : '- [ ] ';
    });
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
    let fenceLen = Math.max(3, _maxCharRun(content, fenceChar) + 1);
    while (_lineClash(content, fenceChar, fenceLen)) fenceLen++;
    const fence = fenceChar.repeat(fenceLen);
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
    const src = node.attrs.src || '';
    const title = node.attrs.title;
    if (title) {
      state.write(`![${alt}](${src} "${escapeLinkTitle(title as string)}")`);
    } else {
      state.write(`![${alt}](${src})`);
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
        const text = cellToText(cell);
        colWidths[colIndex] = Math.max(colWidths[colIndex], text.length);
      });
    }

    // 序列化每行
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const cells: string[] = [];
      row.forEach((cell, _offset, colIndex) => {
        const text = cellToText(cell);
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
function cellToText(cell: PMNode): string {
  const s = new MarkdownSerializerState();
  cell.forEach((child) => {
    if (child.type.name === 'paragraph') {
      s.renderInline(child);
    } else {
      s.renderNode(child);
    }
  });
  return s.output.trim().replace(/ {2}\n/g, '<br>').replace(/\n/g, '<br>');
}

/** 计算文本中最长的连续字符运行 */
function _maxCharRun(text: string, ch: string): number {
  let max = 0, cur = 0;
  for (const c of text) {
    if (c === ch) { cur++; max = Math.max(max, cur); }
    else { cur = 0; }
  }
  return max;
}

/** 检查内容中是否含整行连续 fenceChar >= fenceLen（会被误判为 closing fence） */
function _lineClash(content: string, fenceChar: string, fenceLen: number): boolean {
  const escaped = fenceChar === '`' ? '\\`' : '\\~';
  const re = new RegExp(`(^|\\n) {0,3}${escaped}{${fenceLen},}[ \\t]*$`, 'm');
  return re.test(content);
}

function escapeLinkTitle(title: string): string {
  return title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
