// @vitest-environment happy-dom
/**
 * 出站 HTML 归一的回归锁（CP-20261011-002 验收 #1 / #2 / #3）。
 *
 * 三组判据各自要挡的东西：
 *  - **#1**  对外的失真有没有真的消失，以及「归一有没有顺手改坏通用元素」。
 *  - **#2**  唯一出口的边界（无 doc → null；不许带 PM 自己的粘贴标记；幂等）。
 *  - **#3**  **归一后粘回 solo 会不会静默变形** —— 这是唯一能抓住「PM 把塞不下的壳闭成空壳、
 *    内容掉到正文顶层」的锁。`节点存在` 这类半截判据抓不住（空壳也算存在），所以比的是
 *    **类型路径签名**；比对前两侧先施同一套清洗，否则「删 frontmatter」「剥 ZWNJ」这些
 *    设计目的本身会被当成回归，测试红得没有信息量（详见 signatureOf 的注释）。
 */
import { describe, expect, it } from 'vitest';
import { DOMParser as PMDOMParser, DOMSerializer } from '@tiptap/pm/model';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';

import { parseMarkdown } from '../markdown/parser';
import { serializeMarkdown } from '../markdown/serializer';
import { createTestSchema } from '../markdown/__tests__/test-utils';
import { externalizeHtml } from '../externalize-html';
import { serializeDocumentHtml } from '../clipboard-html';
import { stripInjectedCalloutTitles } from '../extensions/markdown-paste';
import { resolveMonoFontStack } from '../../../../utils/fontStack';

/**
 * 对照文档 —— **必须逐字这样写**，不许改写成空格分隔的摘要。
 *
 * 两处刻意设计：
 *  1. `**粗**、` `*斜*、` `==高亮==、` 这类「强调闭合符紧跟中文顿号」的形态，是
 *     `parser.ts` §1.5 插入 ZWNJ 的触发条件（`\p{P}\p{S}` flanking）。写成空格分隔就一个
 *     隐形字符都产不出来，#1-D 的正向对照会退化成永远绿灯的空判据。
 *  2. `![**图，**注A|200x100]` 与 `[带标题链接](… "**标题，**副")` 把 ZWNJ 送进 **alt / title
 *     属性通道**（不经过 escapeInline，台账 §二 #32 正是为此立的）——而归一恰恰要保留这两个
 *     属性，所以必须专门覆盖。
 */
const MD = [
  '---',
  'title: 出站归一对照',
  'tags: [a, b]',
  '---',
  '',
  '# 一级标题',
  '',
  '段落含 **粗**、*斜*、`码`、==高亮==、~~删线~~、H~2~O、x^2^、[外部链接](https://example.com)、',
  '[带标题链接](https://example.com/b "**标题，**副")、互链 [[我的页面|别名]]、脚注引用[^1]、',
  '行内公式 $E=mc^2$、变浅 <span class="mk-dim">变浅文字</span>、图片 ![图注|200x100](./assets/a.png)、',
  '带强调的图片 ![**图，**注A|200x100](./assets/b.png)。',
  '',
  '> [!NOTE] 我的标题',
  '> 提示块正文**带粗**。',
  '',
  '> [!WARNING]',
  '> 没标题的提示块。',
  '',
  '- 无序项',
  '- [x] 已完成',
  '- [ ] 未完成',
  '',
  '1. 有序一',
  '2. 有序二',
  '',
  '| 应用 | 评分 | 说明 |',
  '| :--- | :---: | ---: |',
  '| 剪映 | 5 | 好用 |',
  '',
  '```js',
  'const a = 1;',
  '```',
  '',
  '$$',
  '\\int_0^1 x^2\\,dx',
  '$$',
  '',
  '```mermaid',
  'flowchart TD',
  '  A --> B',
  '```',
  '',
  '> 独立引用块',
  '',
  '结尾段落。',
  '',
  '[^1]: 定义含**粗体**。',
].join('\n');

const schema: Schema = createTestSchema();

/** 归一前的 DOMSerializer 产出（与 Ctrl+C 同一生产者，未归一） */
function rawHtmlOf(doc: PMNode): string {
  const wrap = document.createElement('div');
  wrap.appendChild(DOMSerializer.fromSchema(doc.type.schema).serializeFragment(doc.content) as Node);
  return wrap.innerHTML;
}

function docFromHtml(html: string): PMNode {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  // 不带任何 option：ParseOptions 无 schema / fromPaste；preserveWhitespace:true 的语义是
  // 「把换行归一成空格」，与「保换行」相反，且与生产粘贴路径不一致 ⇒ 一律用默认
  return PMDOMParser.fromSchema(schema).parse(wrap);
}

/**
 * 回读后的文档 = 真实粘贴链路（HTML 字符串层剥掉注入标题段，再由 PM 解析）。
 *
 * 为什么不能只 `docFromHtml`：出站时标题被同时写进属性与正文，去重**故意**放在读的那一侧
 * （见 `stripInjectedCalloutTitles` 的理由）。不模拟这一层，就会把「设计内的两份」当回归。
 */
function pasteParse(html: string): PMNode {
  return docFromHtml(stripInjectedCalloutTitles(html));
}

const countTag = (html: string, tag: string) => (html.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length;
const ZWNJ_COUNT = (s: string) => (s.match(/\u200C/g) ?? []).length;

// ── 验收 #3：类型路径签名 ────────────────────────────────────

/**
 * 签名 = 每行 `深度:节点名{关键 attrs}`，文本节点为 `深度:#text{内容}`。
 *
 * 比对清洗（**两侧同施**，缺一条 #3 就会「红得没有信息量」）：
 *  ① 跳过 `frontmatter` 整个子树 —— 规则 1 有意删掉它；
 *  ② 文本与属性值都过 `stripZwnj` —— ZWNJ 由 markdown 解析期插入，HTML 解析**不会插回来**，
 *     所以「源有、回读必无」恒成立，而规则 8 正是为了把它清干净；
 *  ③ 丢掉空值属性（''/null/undefined）—— 空串与缺省在 schema 层同义，否则「DOM 上删掉一个
 *     `class=""`」这类无害变化会被算成回归；
 *  ④ callout 的 `title` 属性不计入、且**不进入 callout 子树** —— 规则 2 会删 title 并注入一个
 *     标题段落，这是全案唯一的结构注入，由下面的 callout 专项断言单独锁，不许借此放宽签名。
 */
function signatureOf(doc: PMNode): string[] {
  const out: string[] = [];
  const walk = (node: PMNode, depth: number) => {
    const name = node.type.name;
    if (name === 'frontmatter' || name === 'callout') return;
    if (node.isText) {
      out.push(`${depth}:#text{${stripText(node.text)}}`);
      return;
    }
    const attrs = Object.entries(node.attrs)
      .filter(([, v]) => v !== '' && v !== null && v !== undefined)
      .map(([k, v]) => [k, typeof v === 'string' ? stripText(v) : v] as [string, unknown])
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(',');
    out.push(`${depth}:${name}{${attrs}}`);
    node.forEach((child) => walk(child, depth + 1));
  };
  doc.forEach((child) => walk(child, 0));
  return out;
}

// stripZwnj 的等价实现（测试侧独立一遍，避免「实现和测试共用一个函数一起错」）
const stripText = (s: string) => s.split('\u200C').join('');

describe('出站 HTML 归一（CP-20261011-002）', () => {
  const doc = parseMarkdown(schema, MD);
  const raw = rawHtmlOf(doc);
  const out = serializeDocumentHtml(doc)!;

  // ── #1-D：ZWNJ 正反向对照（先立正向锁，否则整条断言恒绿）──
  it('1-D 归一前有隐形字符（正向对照），归一后归零（含属性通道）', () => {
    expect(ZWNJ_COUNT(raw)).toBeGreaterThan(0);
    expect(ZWNJ_COUNT(out)).toBe(0);
    // 属性通道单独验：alt / title 里那批必须一起干净（值里也含 ZWNJ，整串计数已覆盖）
    expect(out).not.toMatch(/alt="[^"]*\u200C/);
    expect(out).not.toMatch(/title="[^"]*\u200C/);
  });

  // ── #1-A：失真消失 ──
  it('1-A 私有语法裸标记与假标签都不再出站', () => {
    expect(out).not.toContain('[[');
    expect(out).not.toContain('[!NOTE]');
    expect(out).not.toContain('[!WARNING]');
    expect(out).not.toContain('<eq');
    expect(out).not.toContain('<eqn');
    expect(out).not.toMatch(/mk-frontmatter|title: 出站归一对照/);
    expect(out).not.toContain('colgroup');
    expect(out).not.toMatch(/min-width/);
    expect(out).not.toContain('tableWrapper');
    expect(out).not.toMatch(/class=""/);
    expect(out).not.toContain('[^1]');
    // 标题同时写进属性与正文：属性给 solo 回读，正文给只认正文的外部消费者（公众号 / Word）。
    // 去重放在读的那一侧（dropInjectedCalloutTitle），不牺牲任何一头。
    expect(out).toContain('data-title="我的标题"');
    // 幂等标记只存在于承载 div 自身，不许随 HTML 出站
    expect(out).not.toContain('data-solo-externalized');
  });

  // ── #1-B：结构守恒 ──
  it('1-B 通用元素计数与私有载体属性守恒', () => {
    // 1-B 的判据是「归一前后计数相等」（不硬写数字：数字会随 fixture 正常增删而漂移）
    for (const tag of ['h1', 'em', 'code', 'mark', 's', 'sub', 'sup', 'a', 'table', 'td', 'th',
      'ul', 'ol', 'li', 'blockquote', 'input', 'img', 'pre', 'hr']) {
      expect(countTag(out, tag), `${tag} 归一前后应相等`).toBe(countTag(raw, tag));
    }
    expect(out).toMatch(/width="200"/);
    expect(out).toMatch(/height="100"/);
    expect(out).toContain('href="https://example.com"');
    expect(out).toMatch(/text-align: *center/);
    expect(out).toMatch(/text-align: *right/);
    // C-1：私有载体属性的存在性一个都不能掉（空串值也是选择器，C-2）
    for (const sel of ['data-footnote-ref', 'data-footnote-def', 'data-footnote-section',
      'data-type="taskItem"', 'data-type="math-inline"', 'class="mk-dim"', 'class="mk-callout"',
      'data-wikilink']) {
      expect(out, `缺 ${sel}`).toContain(sel);
    }
    expect(out).toContain('data-checked="true"');
  });

  // ── #1-C：预期变化（写死期望，不许说「相等」）──
  it('1-C 只发生声明过的结构变化，块级私有节点内部一字不动', () => {
    expect(out.match(/<div/g)!.length).toBeLessThan(raw.match(/<div/g)!.length);
    // C-3：没建列表、没插横线、没新增 pre
    expect(countTag(out, 'hr')).toBe(countTag(raw, 'hr'));
    expect(countTag(out, 'pre')).toBe(countTag(raw, 'pre'));
    expect(countTag(out, 'ol')).toBe(countTag(raw, 'ol'));
    expect(countTag(out, 'li')).toBe(countTag(raw, 'li'));
    // 唯一结构注入：有标题的那个 callout 多一个 p>strong；没标题的那个零增加
    expect(countTag(out, 'p')).toBe(countTag(raw, 'p') + 1);
    expect(countTag(out, 'strong')).toBe(countTag(raw, 'strong') + 1);
    expect(out).not.toMatch(/<strong>warning<\/strong>/i);
    expect(out).not.toMatch(/<strong>note<\/strong>/i);
    // 数学/图表：外壳保留，只加样式与类名；不再是 <pre> 但换行信息不丢
    expect(out).toMatch(/class="[^"]*language-mermaid/);
    expect(out).toContain('white-space: pre-wrap');
    expect(out).toContain('flowchart TD');
    expect(out).toContain('\\int_0^1 x^2\\,dx');
    expect(out).not.toMatch(/<eq|<code class="language-mermaid"/);
    // 脚注引用：文本换成 [1]，标签与属性不动
    expect(out).toMatch(/<sup[^>]*data-footnote-ref[^>]*>\[1\]<\/sup>/);
  });

  it('1-C+ 图表 / 数学 / 代码块的等宽字体与编辑器同源（--font-mono，台账 §二 #67）', () => {
    // 曾硬编码 'ui-monospace, SFMono-Regular, Menlo, monospace'，与 --font-mono 漂移；
    // 现统一走 resolveMonoFontStack()（运行时读 CSS 变量，读不到回落常量）。
    // 比对前归一引号形态：happy-dom 序列化会把 ' 写成 &quot;
    const unquote = (s: string) => s.replace(/&quot;/g, "'").replace(/"/g, "'");
    expect(unquote(out)).toContain(unquote(resolveMonoFontStack()));
    // math / mermaid / pre / 行内 code 都要带上（缺一类即半截修复）
    expect((out.match(/font-family:/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  /**
   * 代码块的「默认等宽」靠不住（2026-10-21 实测）。
   *
   * 公众号会给 `<pre>` 它自己的样式，粘过去是「带边框的普通字体」，代码看起来像散文；
   * 行内的 `<code>` 更像普通文字。所以两者都必须自带等宽 + 换行 + **浅底**——底色是唯一
   * 能让读者一眼分出「这是代码」的东西（对照 doocs/md 的产物：每个代码块都带
   * `background-color`）。
   *
   * **颜色只能来自 `EXTERNAL_TINT` 那套中性灰**：出站 HTML 不许出现 `var(--…)`（微信会丢弃
   * CSS 变量，等于没设），也不许把主题色带出去（深色主题的黑底粘进白底文章比不设颜色更糟）。
   */
  it('1-C+ 代码块：pre 与行内 code 都自带等宽、换行与浅底，且颜色不跟主题', () => {
    expect(out).toMatch(/<pre[^>]*style="[^"]*white-space: pre-wrap/);
    expect(out).toMatch(/<pre[^>]*style="[^"]*font-family/);
    expect(out).toMatch(/<pre[^>]*style="[^"]*background-color/);
    // 行内 code（不在 pre 里的那些）也要等宽 + 底色
    const inlineCode = out.match(/<code style="[^"]*"[^>]*>/g) ?? [];
    expect(inlineCode.length).toBeGreaterThan(0);
    for (const tag of inlineCode) {
      expect(tag).toContain('font-family');
      expect(tag).toContain('background-color');
    }
    // 硬约束：微信不支持 CSS 变量（var() 会被丢弃 ⇒ 样式等于没写）
    expect(out).not.toContain('var(--');
  });

  // ── #2：唯一出口的边界 ──
  it('#2 无 doc 返回 null；产出不含 PM 粘贴标记；归一幂等', () => {
    expect(serializeDocumentHtml(null)).toBeNull();
    expect(out).not.toContain('data-pm-slice');
    const wrap = document.createElement('div');
    wrap.innerHTML = out;
    const once = wrap.innerHTML;
    externalizeHtml(wrap);
    expect(wrap.innerHTML).toBe(once);
  });

  // ── #3：归一后粘回 solo 的静默变形锁 ──
  it('#3 归一没有改变回读后的类型路径签名（与未归一 HTML 同基线比）', () => {
    // 基线取「**未归一**的同一份 HTML 回读」，而不是源 doc：HTML 解析自身会把换行折叠成空格、
    // 会做空白归一（与归一无关），拿源 doc 直接比会红得没有信息量。两侧同基线 ⇒ 差异只可能
    // 来自归一层的动作。
    const before = signatureOf(docFromHtml(raw));
    const after = signatureOf(docFromHtml(out));
    // 失败时要能直接看出是哪一行变了 —— 只 toEqual 两串长数组没法读
    const diff =
      before.length === after.length
        ? before
            .map((line, i) => (line === after[i] ? null : `第 ${i} 行：${JSON.stringify(line)} → ${JSON.stringify(after[i])}`))
            .filter((x): x is string => x !== null)
        : [`行数不同：${before.length} / ${after.length}`, ...before, '—— ——', ...after];
    expect(diff, `签名差异（两侧已同施比对清洗）:\n${diff.join('\n')}`).toEqual([]);
  });

  it('#3 callout 专项：出站带两份标题，回读去重后只剩 attrs 一份', () => {
    // 出站侧：属性 + 正文两份 —— 外部消费者不认 data-title，只能靠正文看见标题；
    // 正文那段必须带 `data-solo-injected-title` 来源标记，回读才敢删（判据不是「长得像」）
    expect(out).toContain('data-title="我的标题"');
    expect(out).toMatch(/<p data-solo-injected-title=""[^>]*><strong>我的标题<\/strong><\/p>/);

    // 回读侧：过粘贴去重后，正文首段被剥掉，标题回到 attrs（不回退成「正文第一段」）
    const back = pasteParse(out);
    const titles: string[] = [];
    back.descendants((n) => {
      if (n.type.name === 'callout') {
        titles.push(String(n.attrs.title ?? ''));
        const firstText = n.firstChild ? n.firstChild.textContent : '';
        expect(firstText).not.toBe('我的标题');
      }
      return true;
    });
    expect(titles).toEqual(['我的标题', '']);
  });

  it('#3 关键属性守恒：图片尺寸 / 任务勾选 / 脚注 label', () => {
    const back = docFromHtml(out);
    const imgs: PMNode[] = [];
    const items: boolean[] = [];
    const defs: string[] = [];
    back.descendants((n) => {
      if (n.type.name === 'image') imgs.push(n);
      if (n.type.name === 'taskItem') items.push(Boolean(n.attrs.checked));
      if (n.type.name === 'footnoteDef') defs.push(String(n.attrs.label ?? ''));
      return true;
    });
    expect(imgs.map((n) => [n.attrs.width, n.attrs.height])).toEqual([[200, 100], [200, 100]]);
    expect(items).toEqual([true, false]);
    expect(defs).toEqual(['1']);
    expect(serializeMarkdown(back)).toContain('![图注|200x100]');
  });

  it('#3 落盘语法都回来了', () => {
    const text = serializeMarkdown(pasteParse(out));
    expect(text).toMatch(/- \[ \] 未完成/);
    expect(text).toMatch(/- \[x\] 已完成/);
    expect(text).toContain('[^1]:');
    expect(text).toContain('$E=mc^2$');
    expect(text).toContain('```mermaid');
    expect(text).toContain('[[我的页面|别名]]');
    // callout 标题经「出站注入 + 回读去重」后仍是 attrs 里的标题，落盘回到 `> [!NOTE] 我的标题`
    // 一行；标题文字全文只许出现一次（注入段已被剥掉）
    expect(text).toContain('> [!NOTE] 我的标题');
    expect(text.split('我的标题').length - 1).toBe(1);
    expect(text).toContain('> [!WARNING]');
  });

  // ── 规则 6 的表格手术单独打靶（含「拖过列宽才有」的 colwidth）──
  it('规则 6 死宽清掉、对齐与 colwidth 留下、表头提进 thead', () => {
    const wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="tableWrapper"><table class="mk-table" style="min-width: 100px;">' +
      '<colgroup><col style="min-width: 50px;"><col style="min-width: 50px;"></colgroup>' +
      '<tbody><tr><th colspan="1" rowspan="1" style="min-width: 50px; text-align: center;">甲</th>' +
      '<th colspan="1" rowspan="1" style="min-width: 50px;">乙</th></tr>' +
      '<tr><td colspan="1" rowspan="2" colwidth="50,60">丙</td><td>丁</td></tr></tbody></table></div>';
    externalizeHtml(wrap);
    const html = wrap.innerHTML;

    expect(html).not.toContain('colgroup');
    expect(html).not.toContain('tableWrapper');
    expect(html).not.toMatch(/min-width/);
    expect(html).toContain('text-align: center');
    expect(html).toContain('colwidth="50,60"');
    expect(html).toContain('rowspan="2"');
    expect(html).not.toMatch(/colspan="1"|rowspan="1"/);
    expect(html).toMatch(/<thead><tr><th[^>]*>甲<\/th>/);
    expect(wrap.querySelector('tbody tr')).toBeTruthy();
  });

  it('没标题的 callout 不许被编造出标题（防「造字」回归）', () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div data-callout-type="note" class="mk-callout"><p>正文</p></div>';
    externalizeHtml(wrap);
    // 除样式外结构一字不动：不许凭空插一个 <strong>note</strong>（「造字」）
    expect(wrap.innerHTML).not.toContain('data-solo-injected-title');
    expect(wrap.querySelectorAll('strong').length).toBe(0);
    expect(wrap.textContent).toBe('正文');
  });
});
