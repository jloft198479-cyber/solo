import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type { Schema } from '@tiptap/pm/model';
import type { MarkdownParseState, TokenHandler } from '../parser';
import type { MarkdownSerializerState, NodeSerializer } from '../serializer';
import type { FenceHandler, MarkdownSyntaxPlugin } from './index';
import { computeFence } from './fence';
// 解析期插入的 ZWNJ 不该留在「字面内容」里 —— 见 ../../zwnj 与敏感区 #23
import { stripZwnj } from '../../zwnj';

/**
 * ⚠️ 为什么数学内容在**入口**就要剥 ZWNJ（而不是在序列化器兜底）：
 * `$$…$$` / `$…$` **不在** `protectCodeRegions` 的覆盖范围内，所以 ZWNJ 预处理
 * 会把 U+200C 插进数学源里（实测 `$$a**——b$$` 会中招）——`mathBlock` 落进
 * `textContent`、`mathInline` 落进 `attrs.latex`，**输出时会被原样写进文件**
 * （污染用户文件），同时脏 LaTeX 还会进 KaTeX 渲染。
 *
 * 数学内容**经解析期带入 ZWNJ 的唯一入口**就是这里（其余创建路径——`markdown-input`
 * / `slash-commands` 手工插入——建的是空节点，不经解析期预处理，无 ZWNJ 可带）
 * ⇒ 在入口剥一次，内存 / 渲染 / 落盘 / 剪贴板
 * 全部自动干净（也顺带清洗存量脏文件）。**故序列化侧不再重复剥**——那会变成
 * 同一件事两处做。
 */
/**
 * `$$…$$` 在**自己那一行里是否没有别的正文**（＝真正独占一行）。
 *
 * texmath 对 `$$…$$` 一律产出行内 token（`math_inline_double`），**块 / 行内只能由
 * 位置决定**：前后都是换行（或段落边界）⇒ 用户要的是**行间公式**（落 mathBlock）；
 * 只要**同一行里还有别的正文**（`正文 $$a$$ 续文`、`正文\n$$a$$ 续`）⇒ 是**行内公式**
 * （落 mathInline）。判错方向的代价（实测）：落成块级会把段落**从中切断** ⇒ R1≠R2
 * 首轮漂移（台账 §二 #48）。
 *
 * ⚠️ **必须同时看前后两侧**（2026-10-11 补，引自第三方第三轮 R1）：
 * 只看**前一个**兄弟 token 会漏判「`$$` 前面是换行、但同一行后面还有正文」这种形态
 * （`正文\n$$a$$ 续`）——`prev` 确实是 `softbreak`，可 `next` 紧跟着 `text`，仍是行内
 * 公式；漏看 `next` 会把段落切成「正文 / 公式 / 续」**三段**，且第二轮才稳定
 * ⇒ 首轮改文件、且「续」的前导空格被吃掉（台账 §二 #50 的 R1 族）。
 *
 * 无兄弟信息（非 inline 上下文）时返回 true（按行间公式处理）——保守偏向
 * 「原文就是这么写的」。
 */
function standsAloneOnLine(tokens: Token[] | undefined, index: number | undefined): boolean {
  if (!tokens || index === undefined) return true;
  const isBoundary = (t?: Token): boolean =>
    t === undefined || t.type === 'softbreak' || t.type === 'hardbreak';
  return isBoundary(tokens[index - 1]) && isBoundary(tokens[index + 1]);
}

/**
 * 「块起点出现的 `$$…$$` 是否真的独占整行」——块级公式的**准入判据**。
 *
 * 与 texmath 自己的块级正则**同源**（同一条 rex），只是多判一个**行尾锚点**。
 * 返回 false ⇒ 该规则不生效 ⇒ 这一行退回**行内**解析（内容一个字符都不会丢）。
 */
function blockMathOwnsLine(state: BlockMathState, begLine: number): boolean {
  const start = state.bMarks[begLine] + state.tShift[begLine];
  const str = state.src;
  // 不是块起点 `$$` ⇒ 与守卫无关，放行（原规则本就会 return false）
  if (!str.startsWith('$$', start)) return true;

  BLOCK_MATH_REX.lastIndex = start;
  if (!BLOCK_MATH_REX.exec(str)) return true;
  // texmath 自己算的闭合位置：匹配末尾的前一个字符 = 闭合 `$$` 的最后一个 `$`
  const endpos = BLOCK_MATH_REX.lastIndex - 1;

  // endpos 落在哪一行（块公式可以跨行，闭合在后面某行）
  let closeLine = begLine;
  for (let line = begLine; line < state.lineMax; line++) {
    if (endpos >= state.bMarks[line] + state.tShift[line] && endpos <= state.eMarks[line]) {
      closeLine = line;
      break;
    }
  }
  // ★ 业界标准：闭合 `$$` 之后到行尾只能有空白
  return str.slice(endpos + 1, state.eMarks[closeLine]).trim() === '';
}

/** texmath 块规则用到的 markdown-it 块级 state 的**最小**切片（只为类型安全） */
interface BlockMathState {
  src: string;
  bMarks: number[];
  tShift: number[];
  eMarks: number[];
  lineMax: number;
}

/** 与 texmath `dollars.block` 完全相同的正则 —— 只为复算出同一个闭合位置 */
const BLOCK_MATH_REX = /\${2}([^$]*?[^\\])\${2}/gmy;

/**
 * 给 texmath 的**块级**公式规则补「独占整行」守卫 —— **对齐业界标准**，不是自创方言。
 *
 * ⚠️ 背景（台账 §二 #50 / #51）：texmath 的块规则（`texmath.js:41` 注入、
 * `dollars.block` 正则 `\${2}([^$]*?[^\\])\${2}`）**没有行尾锚点**，且命中后
 * `state.line = curline + 1` 直接跳过整行剩余 ⇒ `$$a$$ 正文` 的"正文"**连 token 都不
 * 会产生**、被静默吞掉；`$$a$$ (1)` 走 eqno 分支，整块消失。
 *
 * **业界标准**（micromark-extension-math / remark-math，GitHub 用的就是这套）的 BNF：
 *   `fenceDollarClose ::= sequenceDollarFlow spaceOrTab`
 * 即**闭合 `$$` 之后只能有空白到行尾**；后面还有内容 ⇒ 它不是块级公式，应按行内处理。
 * ⇒ 本函数只是**补回上游缺失的这条约束**，不引入任何新语法。
 *
 * **为什么风险可控**：刻意做成**纯加法守卫** —— 只在判定「不是块级公式」时返回 false
 * 让原规则不生效（随后行内规则接手，`$$…$$` 与尾文**都保住**），其余情况**原样调用
 * texmath 的原有实现**、一行不改。⇒ 受影响面只有「行首 `$$` 且闭合后同行还有字」
 * 这一种形态，其余所有公式（独占行、跨行、引用内、列表内）行为完全不变。
 */
export function installBlockMathGuard(md: MarkdownIt): void {
  // `at()` 是 markdown-it 官方的「按名替换规则」API；读取原 fn 需经 `__rules__`，
  // 这是 markdown-it 插件生态替换规则的事实标准入口（只读，不改结构）
  const ruler = md.block.ruler as unknown as {
    __find__: (name: string) => number;
    __rules__: Array<{ fn: (...args: never[]) => boolean }>;
    at: (name: string, fn: (state: BlockMathState, begLine: number, endLine: number, silent: boolean) => boolean) => void;
  };
  for (const ruleName of ['math_block', 'math_block_eqno']) {
    const index = ruler.__find__(ruleName);
    if (index < 0) continue;
    const original = ruler.__rules__[index].fn;
    ruler.at(ruleName, (state, begLine, endLine, silent) => {
      if (!blockMathOwnsLine(state, begLine)) return false;
      return original(state as never, begLine as never, endLine as never, silent as never);
    });
  }
}

export function mathTokenHandlers(schema: Schema): Record<string, TokenHandler> {
  const handlers: Record<string, TokenHandler> = {};

  if (schema.nodes.mathInline) {
    handlers.math_inline = (state: MarkdownParseState, token: Token) => {
      state.addNode(schema.nodes.mathInline, { latex: stripZwnj(token.content.trim()) });
    };
  }

  if (schema.nodes.mathBlock) {
    handlers.math_block = (state: MarkdownParseState, token: Token) => {
      const latex = stripZwnj(token.content.replace(/^\n|\n$/g, ''));
      state.addNode(schema.nodes.mathBlock, {}, latex ? [schema.text(latex)] : undefined);
    };
    // texmath 的 `$$…$$` 若**紧跟前一段正文**（中间无空行），不会成为块级 `math_block`，
    // 而是被解析进段落 inline 层的 `math_inline_double`（实测 token 流：
    // `正文\n$$\nE=mc^2\n$$\n` → inline[text"正文", softbreak, math_inline_double]）。
    // 此前**没有这个 handler** ⇒ token 被静默跳过 ⇒ **整块公式连同内容消失**，
    // 且不报错（台账 §二 #38）。
    //
    // ⚠️ 落块还是落行内，**看位置**（都是 texmath 的行内 token，不能一律当块）：
    //  ① **单行容器**（表格单元格 / 标题）装不下块级公式 ⇒ 必须行内 —— 否则序列化时
    //     单元格把换行一律换成 `<br>`、再看回来又被当成公式 ⇒ **每存一次多一层 `<br>`、
    //     永不收敛**（台账 §二 #46 的 N1）；标题则被从中切断（#48 的 N3b）。
    //  ② 段落里**同行还有别的正文**的 `$$…$$`（不管在行首还是行中间）
    //     也是行内公式 —— 当块处理会把段落切断并留边缘空格 ⇒ 首轮漂移
    //     （#48 的 N3a/N3c：行中间；#50 的 R1 族：`正文\n$$a$$ 续` 这种「前面换行、
    //     后面却还跟着文字」）。判据必须**前后都看**，见 `standsAloneOnLine`。
    //  ③ 其余（段落里**独占一行**）维持块级 —— 这是 `正文\n$$\nE=mc^2\n$$\n` 的正确归宿。
    handlers.math_inline_double = (
      state: MarkdownParseState,
      token: Token,
      tokens?: Token[],
      index?: number,
    ) => {
      const ownLine = standsAloneOnLine(tokens, index);
      const asInline = schema.nodes.mathInline && (state.inSingleLineContainer || !ownLine);
      if (asInline) {
        handlers.math_inline(state, token, tokens!, index!);
        return;
      }
      handlers.math_block(state, token, tokens!, index!);
    };
  }

  return handlers;
}

export function mathFenceHandler(schema: Schema): FenceHandler | null {
  if (!schema.nodes.mathBlock) {
    return null;
  }

  // fence 形式（```math）的解析入口：内容含 $$ 的 math 块以此形式落盘（见序列化侧）
  return (state, _token, language, content) => {
    // 大小写不敏感：info 串现已按原样保留（不再 toLowerCase），故此处自己比对
    if (language?.toLowerCase() !== 'math') {
      return false;
    }
    // 围栏内容本就被 protectCodeRegions 保护，此处剥 ZWNJ 是为**清洗存量**被污染的
    // 文件（与 serializer 里 code block 那条同源口径）
    const clean = content ? stripZwnj(content) : '';
    state.addNode(schema.nodes.mathBlock, {}, clean ? [schema.text(clean)] : undefined);
    return true;
  };
}

/**
 * 规范化数学块内容：去首尾空行 → 去掉各行**公共**前导空白（dedent）→ 去行尾空白。
 *
 * 为什么必须 dedent：`writeLine()` 会在**行首自动补一次外层 `lineIndent`**（列表项 /
 * 引用块的续行缩进），而块内容里往往**已经带着源文件的前导空格** ⇒ 缩进被加两遍，
 * 且每存一次再加一遍（`- 项\n\n  $$\n  E=mc^2\n  $$\n` R1 加 2、R2 再加 2，
 * **永不收敛**；`> $$…$$` 每轮 +1 并留尾随空格）。dedent 只去掉**公共**前缀，
 * 行与行之间的相对缩进（LaTeX 排版用）保持不动。
 */
function normalizeMathContent(raw: string): string {
  const lines = raw.split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  let common = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    common = Math.min(common, line.length - line.trimStart().length);
  }
  if (!Number.isFinite(common)) common = 0;
  return lines.map((line) => line.slice(common).replace(/\s+$/, '')).join('\n');
}

export const mathNodeSerializers: Record<string, NodeSerializer> = {
  mathInline(state: MarkdownSerializerState, node) {
    // escapeCellPipe：单元格内 latex 的 `|`（如绝对值 `$|x|$`）必须写 `\|`，否则
    // 首存即切列、公式被劈成两半（审计 P1-1；文本/alt/code 通道已有同款转义）
    state.write(`$${state.escapeCellPipe(node.attrs.latex || '')}$`);
  },

  mathBlock(state: MarkdownSerializerState, node) {
    const content = normalizeMathContent(node.textContent);
    // 内容含 $$ 时 $$ 定界形式会被提前闭合（texmath 非贪婪匹配到 $$ 即停）→
    // 落盘即损坏；改用 fence 形式（```math）。无冲突时维持 Obsidian 兼容的 $$ 形式
    if (content.includes('$$')) {
      const fence = computeFence(content);
      state.writeLine(fence + 'math');
      state.writeLine(content);
      state.writeLine(fence);
    } else {
      state.writeLine('$$');
      state.writeLine(content);
      state.writeLine('$$');
    }
    state.closeBlock(node);
  },
};

export const mathMarkdownPlugin: MarkdownSyntaxPlugin = {
  name: 'math',
  tokenHandlers: mathTokenHandlers,
  fenceHandler: mathFenceHandler,
  nodeSerializers: mathNodeSerializers,
};
