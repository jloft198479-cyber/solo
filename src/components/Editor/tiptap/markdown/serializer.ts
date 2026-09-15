/**
 * ProseMirror Document → Markdown 序列化器
 *
 * 将 ProseMirror 文档树转换为 markdown 字符串。
 * 自定义实现以精确控制输出格式，支持 GFM 表格、任务列表等扩展语法。
 */
import type { Node as PMNode, Mark, Slice } from '@tiptap/pm/model';
import { Fragment } from '@tiptap/pm/model';
import { getPluginNodeSerializers } from './plugins';
import { computeFence } from './plugins/fence';

/**
 * 移除零宽非连接符（U+200C）。
 * 该字符是解析阶段修正 CJK flanking 的临时手段，不应出现在任何输出里。
 * 代码内容（围栏块 / 行内码）不经过 escapeInline，故需单独剥离，
 * 顺带清洗历史上已被污染（解析期误插 ZWNJ）的存量文档。
 */
function stripZwnj(text: string): string {
  return text.includes('\u200C') ? text.replace(/\u200C/g, '') : text;
}

// ── 序列化状态 ──────────────────────────────────────────────────

/** 空段落（无子节点）——常为 parser 为满足 schema 约束补的占位，非用户内容 */
function isEmptyParagraph(node: PMNode): boolean {
  return node.type.name === 'paragraph' && node.childCount === 0;
}

/** 三种列表容器（嵌套紧凑度判定用，见 renderContent） */
const LIST_NODE_NAMES = new Set(['bulletList', 'orderedList', 'taskList']);

export class MarkdownSerializerState {
  /**
   * 输出分片。**刻意不累加字符串**：V8 的 `+=` 只生成惰性 ConsString（绳结），
   * 但只要做一次「需要真实字符」的读操作（`endsWith` / 下标 / `slice`），整条
   * 绳结就被摊平。每块摊平一次 ⇒ O(n²)，10 万字量级要几十秒。
   * 改为分片 push、出口一次性 join ⇒ O(n)。见 KNOWN-ISSUES §二 #18。
   */
  private chunks: string[] = [];
  private closed: PMNode | null = null;
  /**
   * 续行缩进列数（列表项内为项内容列）。
   *
   * 列表项的**续行**必须缩进到项内容列，否则块会脱出列表——
   * 例：`- 项一\n\n  ```\n  代码\n  ``` ` 若不缩进，代码块落到第 0 列，
   * 重开变成「列表 → 代码块 → 列表」三个平级块，且**二次不收敛**（每次保存都在变）。
   * 缩进量取项 marker 的内容列宽（`- ` → 2、`10. ` → 4），与 CommonMark 一致；
   * 实测缩进到内容列即留在项内，无需额外多缩（见 fixtures lists.md）。
   */
  private lineIndent = 0;
  readonly clipboard: boolean;

  constructor(options?: { clipboard?: boolean }) {
    this.clipboard = options?.clipboard ?? false;
  }

  /** 已写出内容（拼接视图）。只在出口与子 state 取用时调用，**切勿放进循环** */
  get output(): string {
    return this.chunks.length > 1 ? this.chunks.join('') : (this.chunks[0] ?? '');
  }

  /** 整体改写输出（保留原 public 字段的赋值语义） */
  set output(value: string) {
    this.chunks = value ? [value] : [];
  }

  /** 取末尾至多 n 个字符——只回溯末尾几个分片，替代对全量字符串做 endsWith */
  private tailOf(n: number): string {
    let out = '';
    for (let i = this.chunks.length - 1; i >= 0 && out.length < n; i--) {
      const c = this.chunks[i];
      if (c) out = c.length >= n ? c.slice(-n) : c + out;
    }
    return out.length > n ? out.slice(-n) : out;
  }

  /** 记录当前输出分片位置，供节点序列化器做**局部**回改（不触全量摊平） */
  markOutput(): number {
    return this.chunks.length;
  }

  /**
   * 转义标题行内末尾「空格 + 连续 #」的第一个 `#`（避免被 re-parse 当成 ATX
   * closing marker 吃掉）。只拼接 `[anchor, end)` 段——即本标题的行内内容，
   * 长度有限，不触碰已累积的全量输出。
   */
  escapeTrailingHashes(anchor: number) {
    const seg = this.chunks.length > anchor ? this.chunks.slice(anchor).join('') : '';
    let hashStart = seg.length - 1;
    while (hashStart >= 0 && seg[hashStart] === '#') hashStart--;
    // 末字符非 #（停在末位）/ 全段皆 # / 井号串前无空格 ⇒ 均无需转义
    if (hashStart < 0 || hashStart === seg.length - 1 || seg[hashStart] !== ' ') return;
    const fixed = seg.slice(0, hashStart + 1) + '\\' + seg.slice(hashStart + 1);
    this.chunks.length = anchor;
    this.chunks.push(fixed);
  }

  /**
   * 创建共享配置的子 state（用于先渲染内层再整体加前缀的节点，如 blockquote/callout）。
   * 子 state 继承 clipboard 模式，保证内层转义策略与整体一致。
   * 做成实例方法而非直接 new，避免插件模块运行时 import 本类造成循环依赖。
   */
  createChild(): MarkdownSerializerState {
    return new MarkdownSerializerState({ clipboard: this.clipboard });
  }

  /** 是否处于行首（供续行缩进判定；只看末尾一个字符，O(1)） */
  private atLineStart(): boolean {
    const tail = this.tailOf(1);
    return tail === '' || tail === '\n';
  }

  /**
   * 写入文本。行首自动补 `lineIndent` 缩进（文本内含换行时**每行**都补）——
   * 这是「列表项内的块留在项内」的唯一机制，块序列化器无需各自关心缩进。
   *
   * 空行不补（避免行尾空格）。`lineIndent === 0`（绝大多数场景）走原路径，零额外开销。
   */
  write(text: string) {
    this.flushClose();
    if (!text) return;
    if (this.lineIndent <= 0) {
      this.chunks.push(text);
      return;
    }
    const atStart = this.atLineStart();
    // 常见路径：不在行首、且文本不含换行 ⇒ 无需补缩进，跳过 split/join
    if (!atStart && !text.includes('\n')) {
      this.chunks.push(text);
      return;
    }
    const pad = ' '.repeat(this.lineIndent);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if ((i === 0 ? atStart : true) && lines[i]) lines[i] = pad + lines[i];
    }
    this.chunks.push(lines.join('\n'));
  }

  /** 写入一行（末尾加换行） */
  writeLine(text: string) {
    this.write(text + '\n');
  }

  /** 确保输出以换行结尾 */
  ensureNewline() {
    const tail = this.tailOf(1);
    if (tail && tail !== '\n') this.chunks.push('\n');
  }

  /** 关闭段落（延迟写入换行，用于列表紧凑模式判断） */
  closeBlock(node: PMNode) {
    this.closed = node;
  }

  flushClose(extra = 0) {
    if (!this.closed) return;
    this.closed = null;
    this.ensureNewline();
    if (extra > 0) this.chunks.push('\n'.repeat(extra));
  }

  /** 增加空行分隔 */
  blankLine() {
    this.flushClose();
    this.ensureNewline();
    if (this.tailOf(2) !== '\n\n') this.chunks.push('\n');
  }

  /** 序列化 inline 内容 */
  renderInline(parent: PMNode) {
    const codeDelims = this._precomputeCodeDelims(parent);
    parent.forEach((child, _offset, index) => {
      if (child.isText) {
        this.renderMarks(child, parent, index, true, codeDelims);
        const hasCodeMark = child.marks.some((mark) => mark.type.name === 'code');
        // 行内 code 不属于 flanking 处理对象，一并剥离 ZWNJ（顺带清洗存量脏数据）
        this.write(hasCodeMark ? stripZwnj(child.text ?? '') : this.escapeInline(child.text ?? ''));
        this.renderMarks(child, parent, index, false, codeDelims);
      } else {
        this.renderMarks(child, parent, index, true, codeDelims);
        this.renderNode(child);
        this.renderMarks(child, parent, index, false, codeDelims);
      }
    });
  }

  /**
   * 已开启的 marks，**按打开时间排序**（不是 schema 的 rank 序）。
   *
   * 关闭时必须逆此序（后开先关），定界符才会落在正确的嵌套层。
   * 反例：`*foo [bar](/url)*` 的 doc 是 `T"foo"[italic] T"bar"[link,italic]`，
   * 两个 mark 的打开顺序为 italic → link，但数组序（schema rank）为 link → italic
   * （`link` rank 0 < `italic` rank 3）。若照数组逆序关，link 的收尾 `](…)` 会写在
   * italic 的 `*` **之前**，输出 `*foo [bar*](/url)` —— 语法当场损坏。
   * 见 `KNOWN-ISSUES.md` §二 #11-A。
   */
  private activeMarks: Mark[] = [];

  /** 写入单个 mark 的定界符：code 走反引号围栏（含内容含反引号时的加长计算），其余走 markDelimiter */
  private writeMarkDelim(
    mark: Mark,
    opening: boolean,
    node: PMNode,
    parent: PMNode,
    index: number,
    codeDelims?: Map<number, { open: string; close: string }>,
  ) {
    if (mark.type.name !== 'code') {
      this.write(this.markDelimiter(mark, opening));
      return;
    }
    const delims = codeDelims?.get(index) ?? this._codeSpanDelims(node, parent, index);
    this.write(opening ? delims.open : delims.close);
  }

  /** 开启/关闭 marks（关闭按「打开顺序」逆序，理由见 activeMarks） */
  private renderMarks(node: PMNode, parent: PMNode, index: number, opening: boolean, codeDelims?: Map<number, { open: string; close: string }>) {
    const marks = node.marks;

    if (opening) {
      for (const mark of marks) {
        if (mark.isInSet(this.activeMarks)) continue;
        // 追加而非 addToSet：数组即「打开时间栈」，关闭时要靠它定序
        this.activeMarks = [...this.activeMarks, mark];
        this.writeMarkDelim(mark, true, node, parent, index, codeDelims);
      }
      return;
    }

    const next = this.findNextNonToken(parent, index);
    for (let i = this.activeMarks.length - 1; i >= 0; i--) {
      const mark = this.activeMarks[i];
      if (!mark.isInSet(marks)) continue; // 本节点不含此 mark（防御）
      if (next && mark.isInSet(next.marks)) continue; // 下一节点延续，不关
      this.activeMarks = this.activeMarks.filter((m) => !m.eq(mark));
      this.writeMarkDelim(mark, false, node, parent, index, codeDelims);
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
    // 末字符取分片尾部（O(1)），不读全量 output —— 本函数每个文本节点都跑，是头号热点
    const tail = this.tailOf(1);
    const atLineStart = this.closed !== null || tail === '' || tail === '\n';

    let result = escapeBackslashes(text);

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
    return stripZwnj(result);
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
    // 首块是空段落、且后面还有块 ⇒ 它是**模型补位**而非用户内容，跳过不输出。
    // 例：`- # 标题` 解析后 listItem 首块被补成空 paragraph（为满足 schema 的
    // `paragraph block*` 约束），不跳过就会写出 `-  \n\n# 标题`，把列表拆散。
    // 独块的空段落不跳：那是 `- ` 这类真实的空列表项。
    const skipLeadingEmpty = parent.childCount > 1 && isEmptyParagraph(parent.child(0));
    // 列表项内「文本块 → 子列表」用单换行（紧凑嵌套）。此前一律插空行，后果有两层：
    // ① 列表被读成 loose（外部渲染留白变化）；② 每次保存都把文件重写一遍。
    // CommonMark 实测：子列表缩进到项内容列即留在项内，空行并非必需。
    // 见 fixtures 登记表 lists.md / real-world.md（修好后对应登记须删除）。
    const tightChildList = parent.type.name === 'listItem' || parent.type.name === 'taskItem';
    let prev: PMNode | null = null;
    parent.forEach((child, _offset, index) => {
      if (skipLeadingEmpty && index === 0) return;
      if (prev && child.isBlock) {
        if (prev.type.name === 'horizontalRule' && child.type.name === 'horizontalRule') {
          this.ensureNewline();
        } else if (tightChildList && LIST_NODE_NAMES.has(child.type.name)) {
          this.ensureNewline();
        } else {
          this.blankLine();
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
    node.forEach((child, _offset, index) => {
      if (index > 0) this.ensureNewline();
      const delim = getDelim(index, child);
      // marker 行的缩进由 write 按外层 lineIndent 补（不再自己拼空格串）
      this.write(delim);
      // 本项内容列 = 外层缩进 + marker 宽度。marker 宽度即项内容的起始列：
      // `- ` → 2、`1. ` → 3、`10. ` → 4（有序列表第 10 项起变宽，固定值会让
      // 子列表脱出父项）；task 项的勾选框属内容，由 itemIndentWidth 特判为 2。
      const width = itemIndentWidth ? itemIndentWidth(delim) : delim.length;
      const prevIndent = this.lineIndent;
      this.lineIndent = prevIndent + width;
      this.renderContent(child);
      this.lineIndent = prevIndent;
    });
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
    const anchor = state.markOutput();
    state.renderInline(node);
    // 转义行末 #（前有空格），避免被 re-parse 当成 ATX closing marker 吃掉
    state.escapeTrailingHashes(anchor);
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
    // 容器可同时容纳普通项与待办项（见 editor-extensions 的 content 放开），
    // 故 marker 逐项决定：待办项必须带上勾选框，否则 checked 状态在往返中被抹平。
    state.renderList(
      node,
      (_index, child) => {
        if (child.type.name !== 'taskItem') return '- ';
        return child.attrs.checked ? '- [x] ' : '- [ ] ';
      },
      // 勾选框属于列表项内容，marker 实际是 '- '（宽 2）
      () => 2,
    );
  },

  orderedList(state, node) {
    const start = node.attrs.start ?? 1;
    state.renderList(
      node,
      (index, child) => {
        const marker = `${start + index}. `;
        if (child.type.name !== 'taskItem') return marker;
        return marker + (child.attrs.checked ? '[x] ' : '[ ] ');
      },
      // 缩进宽度只算 marker（勾选框属内容）：有勾选框时取 '[' 之前的长度
      (delim) => {
        const checkboxAt = delim.indexOf('[');
        return checkboxAt >= 0 ? checkboxAt : delim.length;
      },
    );
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
    const content = stripZwnj(node.textContent);
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

    // 计算每列最大宽度（B5：按显示宽度——东亚宽字符记 2，含中文的列视觉对齐）
    const colWidths: number[] = Array(colCount).fill(3); // 最小3（分隔行 ---）
    for (const row of rows) {
      row.forEach((cell, _offset, colIndex) => {
        const text = cellToText(state, cell);
        colWidths[colIndex] = Math.max(colWidths[colIndex], visualWidth(text));
      });
    }

    // 序列化每行
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const cells: string[] = [];
      row.forEach((cell, _offset, colIndex) => {
        const text = cellToText(state, cell);
        cells.push(padEndVisual(text, colWidths[colIndex]));
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
 * 东亚宽字符（East Asian Width W/F，显示宽 2）判定——表格列对齐用（B5）。
 * 覆盖：CJK 统一表意/扩展、假名、谚文、全角 ASCII/标点、CJK 兼容区、
 * 注音/彝文、竖排与小形式变体、扩展 B-F 平面、常见 emoji 区段。
 * 区间为 wcwidth 类实现的常用子集，非完整 Unicode EAW 表——对表格对齐足够。
 */
const WIDE_CHAR_RE =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1f9ff}\u{20000}-\u{3fffd}]/u;

/** 字符串显示宽度（宽字符记 2，其余记 1），按码点迭代防代理对漏判 */
function visualWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    w += WIDE_CHAR_RE.test(ch) ? 2 : 1;
  }
  return w;
}

/** 按显示宽度右侧补空格（padEnd 的东亚宽度版） */
function padEndVisual(str: string, width: number): string {
  return str + ' '.repeat(Math.max(0, width - visualWidth(str)));
}

/**
 * `_` 选择性转义（CommonMark intraword 例外，B1/B2）：
 * - 前后都是字母/数字的 `_`（snake_case、中文_中文）不构成强调定界符，保持原样，
 *   落盘/出站字节干净；
 * - 其余位置（空格/行首/标点包围）的 `_` 会被 CommonMark 解释为斜体，转义为 `\_`。
 * 全局转义虽也正确，但会让代码标识符满屏反斜杠；选择性转义在保真正确性前提下
 * 最小化字节改动。
 */
/** ASCII 可打印标点（CommonMark 转义序列的标点集：0x21-2F / 3A-40 / 5B-60 / 7B-7E） */
const ASCII_PUNCT_RE = /[!-/:-@[-`{-~]/;

/**
 * 行内文本的反斜杠选择性转义（CommonMark 规则，实测 markdown-it）。
 *
 * 只有会构成转义序列、重解析后反斜杠会消失的位置才补一个反斜杠：
 * - 「\ + ASCII 标点」是合法转义，重解析吞掉反斜杠（`\*` → `*`）→ 补成 `\\`
 * - 「\ + 行尾」（换行 / 文本末）转义换行成硬换行，反斜杠本身消失 → 补成 `\\`
 * - 「\ + 其它」（字母 / 数字 / CJK / 空格）不是转义序列，重解析保留字面反斜杠
 *   → 原样输出。Windows 路径 `G:\skills`、LaTeX `\alpha` 保持字节干净。
 *
 * 修复 2026-09-12 用户报障：此前为无条件全转义（`text.replace(/\\/g, '\\\\')`），
 * 把正文里每条路径 / 公式的反斜杠都翻倍，复制到微信 / Word 满屏多余 `\`；
 * 且该行位于 clipboard 分支**之前**，保存与复制两条路一起中招。
 *
 * 逐字符判定而非全局正则——CommonMark 的转义是「\ 与紧跟字符」逐对配对，
 * 必须按每个反斜杠的紧邻字符单独决定，连续反斜杠的奇偶才能自动正确
 * （`\\*` → `\\\\*`：首反斜杠后是 `\`、次反斜杠后是 `*`，两个都补）。
 */
function escapeBackslashes(text: string): string {
  if (!text.includes('\\')) return text;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = text[i + 1];
    // next === undefined → 文本末尾；next === '\n' → 行尾（软换行前）
    out += next === undefined || next === '\n' || ASCII_PUNCT_RE.test(next) ? '\\\\' : '\\';
  }
  return out;
}

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
 * 递归剥掉开口 slice 两端「部分包含」的容器层，只留下完全包含的内容。
 *
 * PM 的 slice 语义：openStart/openEnd 标记的边界节点只被选区「部分包含」，
 * 但 `slice.content` 把它们原样放在 fragment 里——`doc.copy()` 会丢掉开口标记，
 * 序列化器就把容器当闭合节点整段渲染，粘出去变成整张 GFM 表格 / 带标记的
 * 引用块（格内选两个字 → `| 剪映 |`）。
 *
 * 剥层规则：
 * - textblock（paragraph 等）是内容语义层（提供换行），且 inline 不能作为
 *   doc content 顶层（renderContent 对顶层 inline 输出为空）——到此为止；
 * - table 系节点（`nodeSerializers` 注册为空 handler、渲染靠 table 整体处理）
 *   离开 table 上下文无法独立序列化，视为透明容器随时剥掉；
 * - 其余语义容器（blockquote/callout/listItem 等）只按开口计数剥——
 *   闭合选区（整篇、NodeSelection）原样保留，扩展语法标记不丢。
 */
function stripOpenLayers(frag: Fragment, openStart: number, openEnd: number): Fragment {
  if (frag.childCount === 0) return frag;
  if (frag.childCount === 1) {
    const child = frag.firstChild!;
    if (child.isTextblock || child.isInline) return frag;
    // 透明容器随时剥；语义容器仅在开口时剥（闭合选区原样保留，扩展语法不丢）
    if (openStart <= 0 && openEnd <= 0 && !isTableInternal(child)) return frag;
    return stripOpenLayers(child.content, Math.max(openStart - 1, 0), Math.max(openEnd - 1, 0));
  }
  const nodes: PMNode[] = [];
  frag.forEach((child, _offset, index) => {
    const first = index === 0;
    const last = index === frag.childCount - 1;
    const open = first ? openStart : last ? openEnd : 0;
    // 可剥的边界 child：透明容器（无论开口与否，离开 table 无法独立渲染），
    // 或开口的非 textblock 语义容器。textblock 是内容层，整节点保留
    // （选区外的文字已被 slice.content 截断，不存在泄漏）。
    const peel = isTableInternal(child) || (!child.isTextblock && !child.isInline && open > 0);
    if (peel) {
      stripOpenLayers(child.content, first ? Math.max(openStart - 1, 0) : 0, last ? Math.max(openEnd - 1, 0) : 0).forEach((n) => nodes.push(n));
    } else {
      nodes.push(child);
    }
  });
  return Fragment.fromArray(nodes);
}

/** 渲染逻辑挂在父级 table handler 里的节点（nodeSerializers 里是空实现），离开 table 无法独立渲染 */
function isTableInternal(node: PMNode): boolean {
  const name = node.type.name;
  return name === 'table' || name === 'tableRow' || name === 'tableHeader' || name === 'tableCell';
}

/**
 * 出站复制：把选区 Slice 序列化为 Markdown 纯文本（供 `editorProps.clipboardTextSerializer` 使用）。
 *
 * ProseMirror 默认 `clipboardTextSerializer` 只输出 `textContent`（纯文本），
 * 导致 callout / 数学公式 / mermaid / wikilink / frontmatter / 脚注等 solo
 * 扩展语法粘到外部 Markdown 编辑器时标记全丢。这里用文档的 schema 把选区内容
 * 重新序列化为 Markdown，外部编辑器从 `text/plain` 即可拿到完整语法。
 * `text/html` 仍由 ProseMirror 默认生成（标准格式走 HTML 还原，不受影响）。
 *
 * 序列化前先剥开口层（见 `stripOpenLayers`）：选区内完全包含的内容才参与
 * 序列化，边界容器只到 textblock 为止——「格内选两个字」粘出去就是那两个字，
 * 而不是整张表格；闭合 slice（整篇/NodeSelection）原样保留，扩展语法标记不丢。
 */
export function serializeClipboardSlice(doc: PMNode, slice: Slice): string {
  const inner = stripOpenLayers(slice.content, slice.openStart, slice.openEnd);
  const sliced = doc.copy(inner);
  return serializeMarkdownForClipboard(sliced);
}

// ── 剪贴板 text/plain：干净文字 vs Markdown 源码 ────────────────

/**
 * 纯文本能「去掉标记后仍是原文」的节点白名单。
 *
 * 用白名单而非黑名单：将来新增扩展节点默认走 Markdown 回落，
 * 绝不会因为忘了登记而在纯文本槽里静默丢内容（退化安全）。
 */
const PLAIN_TEXT_SAFE_NODES = new Set([
  'doc',
  'paragraph',
  'heading',
  'text',
  'hardBreak',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'codeBlock',
  'horizontalRule',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
]);

/** 无文字内容的叶子在纯文本里的替身：分隔线留 `---`、硬换行留换行 */
const PLAIN_TEXT_LEAF: Record<string, string> = {
  horizontalRule: '---',
  hardBreak: '\n',
};

/** 选区是否含 solo 专有节点（公式 / 图表 / 互链 / 脚注 / frontmatter / callout / 图片） */
function hasProprietaryNode(frag: Fragment): boolean {
  for (let i = 0; i < frag.childCount; i++) {
    const child = frag.child(i);
    if (!PLAIN_TEXT_SAFE_NODES.has(child.type.name)) return true;
    if (child.childCount > 0 && hasProprietaryNode(child.content)) return true;
  }
  return false;
}

/**
 * 剪贴板 text/plain 内容（照 Typora 范式：纯文本槽里放「渲染后的文字」）。
 *
 * - 选区只含文本型内容 → 干净纯文本。`## 标题` 粘到微信/Word/记事本得到
 *   `标题`，不再有 `\*` `\#` `\=` 这类「为 Markdown 目标做的」转义噪音。
 * - 选区含 solo 专有节点 → 回落 Markdown 源码。这些语法在纯文本里没有等价
 *   表达（回落总比静默丢公式强），顺带让「粘到外部 Markdown 编辑器」拿到原文。
 *
 * solo 内部粘贴不依赖这条路径——HTML 槽 + 各扩展的 parseHTML 负责还原。
 * 需要主动拿 Markdown 源码时用「复制为 Markdown 源码」命令。
 */
export function serializeClipboardText(doc: PMNode, slice: Slice): string {
  const inner = stripOpenLayers(slice.content, slice.openStart, slice.openEnd);
  if (hasProprietaryNode(inner)) return serializeMarkdownForClipboard(doc.copy(inner));
  return inner.textBetween(0, inner.size, '\n\n', (node) => PLAIN_TEXT_LEAF[node.type.name] ?? '');
}
