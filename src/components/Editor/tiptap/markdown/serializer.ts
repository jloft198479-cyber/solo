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
      // 开启新 marks
      for (const mark of marks) {
        if (!mark.isInSet(this.activeMarks)) {
          this.activeMarks = mark.addToSet(this.activeMarks);
          this.write(this.markDelimiter(mark, true));
        }
      }
    } else {
      const next = this.findNextNonToken(parent, index);
      for (let i = marks.length - 1; i >= 0; i--) {
        const mark = marks[i];
        if (!next || !mark.isInSet(next.marks)) {
          this.activeMarks = mark.removeFromSet(this.activeMarks);
          this.write(this.markDelimiter(mark, false));
        }
      }
    }
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
      case 'link':
        if (_opening) return '[';
        return `](${mark.attrs.href}${mark.attrs.title ? ` "${escapeLinkTitle(mark.attrs.title as string)}"` : ''})`;
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
      result = result.replace(/([`[\]()*~^=!?|$<>{}])/g, '\\$1');
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
    parent.forEach((child, _offset, index) => {
      if (index > 0) {
        if (child.isBlock) {
          if (this.inTightList) {
            this.ensureNewline();
          } else {
            this.blankLine();
          }
        }
      }
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
    state.write('#'.repeat(node.attrs.level) + ' ');
    state.renderInline(node);
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
    state.writeLine('```' + lang);
    state.writeLine(node.textContent);
    state.writeLine('```');
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
