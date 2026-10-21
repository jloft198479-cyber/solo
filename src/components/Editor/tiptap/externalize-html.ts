/**
 * 出站 HTML 归一（CP-20261011-002）——把编辑器 DOMSerializer 的产出改成「对外阅读形态」。
 *
 * 为什么需要它：整篇复制以前由第二个渲染器（`utils/markdown-it`）产出，它不认识 solo 私有
 * 语法，于是 `> [!NOTE]`、`[[互链]]`、`<eq>` 这类**标记本身**被原样带进别人的文档。现在改与
 * Ctrl+C 同一个生产者（`DOMSerializer` 走各扩展 `renderHTML`），私有语法自然变成人话；但那个
 * 生产者是为「粘回 solo」服务的，产出里带着 solo 自己的结构，所以要过这一层。
 *
 * 三条不可动摇的约束（踩过的坑见下，判据在 CP-20261011-002 图纸）：
 *  - **C-1 不换标签名、不删私有属性**：`li[data-type="taskItem"]`、`sup[data-footnote-ref]`、
 *    `span[data-type="math-inline"]`、`span.mk-dim` 等是各扩展 `parseHTML` 的命中面，删了或
 *    换掉，「按钮复制 → 粘回 solo」就降级。
 *  - **C-2 空串属性即选择器**：`footnote.ts` 把 `data-footnote-ref` 等渲染成**空串**，判据只看
 *    「属性在不在」⇒ 除 `class` 外，属性剥空也不许删。
 *  - **C-3 不往内容规格装不下的壳里塞元素**：`FootnoteSection.content = 'footnoteDef+'`、
 *    `MermaidBlock.content = 'text*'`。往里塞 `<ol>`/`<pre>` **不报错**，PM 会把外壳静默闭成
 *    空壳、把塞的东西丢到正文顶层（`findPlace` 上爬 + `closeExtra`）。⇒ 块级私有节点内部一字
 *    不动，对外表现只靠内联样式与类名。
 *
 * 两个档位（`ExternalizeTarget`）共用同一套动作，只有三处按档位分叉，判据都是
 * 「这份 HTML 会不会被 solo 自己读回去」：
 *  - `document`（状态栏复制全文＝整篇出站，不会再回读）：可以删 frontmatter、可以拆
 *    `div.tableWrapper`（顶层节点身份会变，见 `cleanTables`）。
 *  - `selection`（Ctrl+C 选区＝可能粘回 solo）：**不删 frontmatter**（回读要靠它还原元数据）、
 *    **不拆 tableWrapper**（会改变顶层节点身份，`data-pm-slice` 标记会落错对象）。
 *
 * 改写组的其余动作（callout 标题、脚注引用、源码块样式、表格手术）两档都跑——它们要么
 * 对外补上人话、要么对回读零影响（判据见各函数注释）。原文那句「改写组不能挂到 Ctrl+C」
 * 已被 2026-10-21 的实测推翻：真正不能挂的只有上面那两条。
 */
import { resolveMonoFontStack } from '../../../utils/fontStack';
import { stripZwnj } from './zwnj';

/** 幂等标记。只打在承载根节点自身，`innerHTML` 不含它 ⇒ 不会随 HTML 出站 */
const EXTERNALIZED = 'data-solo-externalized';

/**
 * 注入标题段的来源标记（2026-10-21 复审改）。
 *
 * 为什么必须有它：注入段 `<p><strong>注意</strong></p>` 与用户自己写的「加粗且文字等于标题」
 * 的首段在 PM 节点层**完全同形**，靠内容猜来源会把合法正文当标题删掉（静默丢内容）。
 * 打标记后，回读只删带标记的那一个 —— 判据从「长得像」变成「我盖过章」。
 *
 * 出站时外部平台会把这个属性连同 class 一起剥掉（无所谓，它们只看正文）；
 * 若被第三方编辑器洗掉再粘回 solo，标题会以正文段落形式重复一次（**可见降级**，不是丢内容）。
 */
export const INJECTED_TITLE_ATTR = 'data-solo-injected-title';

/**
 * 出站目标：
 * - `document` 整篇（状态栏按钮）
 * - `selection` 选区（Ctrl+C / 右键复制）
 */
export type ExternalizeTarget = 'document' | 'selection';

export function externalizeHtml(root: HTMLElement, target: ExternalizeTarget = 'document'): void {
  if (root.hasAttribute(EXTERNALIZED)) return;
  rewriteForExternal(root, target);
  stripInvisibleChars(root);
  root.setAttribute(EXTERNALIZED, '');
}

// ── 改写组（仅对外，会动语义）──────────────────────────────────

function rewriteForExternal(root: HTMLElement, target: ExternalizeTarget): void {
  // frontmatter 是「只在 solo 内部有语义」的元数据，两档都要让它别出现在对外正文里，
  // 但做法不同（判据都是「这份 HTML 会不会被 solo 自己读回去」）：
  //  - 整篇出站：全删。
  //  - 选区出站：**只删第一个顶层元素**。用户复制整篇去公众号的动作是 Ctrl+A → Ctrl+C，
  //    frontmatter 必然被选中，不删就会在文章顶部显示一段 YAML；而从中间选一段时它本就
  //    不在选区里，这条规则不会误伤。代价：从文档开头整篇复制再粘回 solo 会丢元数据——
  //    该场景有更合适的出口（状态栏按钮 / text/plain 槽始终带完整 Markdown 源码）。
  if (target === 'document') dropFrontmatter(root);
  else dropLeadingFrontmatter(root);
  surfaceCalloutTitle(root);
  rewriteFootnoteRefs(root);
  stylePlainSourceBlocks(root);
  cleanTables(root, target);
}

/** 元数据不出站：与回落管道 `sanitizeForExternal` 的 `FRONTMATTER_RE` 剥离语义一致 */
function dropFrontmatter(root: HTMLElement): void {
  root.querySelectorAll('div[data-type="frontmatter"]').forEach((el) => el.remove());
}

/** 选区档位：只处理「选区第一个块就是 frontmatter」的情况（见 rewriteForExternal 的注释） */
function dropLeadingFrontmatter(root: HTMLElement): void {
  const first = root.firstElementChild;
  if (first?.matches('div[data-type="frontmatter"]')) first.remove();
}

/**
 * callout 的标题活在 `data-title` 属性里，DOMSerializer 的产出正文没有它（可见标题是 NodeView
 * 现算的）。⇒ 把标题提成正文首个段落。
 *
 * **`data-title` 保留不删**（2026-10-21 改）：这条属性是 solo→solo 的标题载体，删掉就等于
 * 把「框标题」降级成「正文第一段」。保留后「属性 + 正文两份」并存，去重交给**读的那一侧**
 * ——`markdown-paste.ts` 的 `stripInjectedCalloutTitles`：只删**带 `data-solo-injected-title`
 * 标记**的那一段。这样同一份 HTML 两头都对：外部消费者只认正文（看到标题），solo 只认属性
 * （标题回到原位）。
 *
 * 标记是这套方案的关键（复审推翻过「靠内容猜」的写法）：注入段与用户自己写的同名加粗段在
 * PM 节点层完全同形，只有来源标记能把两者分开。
 *
 * `Callout.content = 'block+'` ⇒ 注入段落是内容规格允许的，这是全案唯一的结构注入点。
 * 没标题时**什么都不加**：编一个类型词（`note`/`warning`）等于往用户文档里塞我方造的字。
 */
function surfaceCalloutTitle(root: HTMLElement): void {
  root.querySelectorAll('div.mk-callout').forEach((el) => {
    const title = stripZwnj((el as HTMLElement).getAttribute('data-title') ?? '').trim();
    if (!title) return;
    // 幂等：首段已经是「带标记的同名标题段」就不再插第二遍。
    // 保留 data-title 之后，幂等不能再靠「删属性」实现——产物被重新解析再出站
    // （用户粘回 solo 再复制、或对外 HTML 二次处理）会重复注入标题。
    if (isInjectedTitleParagraph(el.firstElementChild, title)) return;
    const p = el.ownerDocument.createElement('p');
    p.setAttribute(INJECTED_TITLE_ATTR, '');
    const strong = el.ownerDocument.createElement('strong');
    strong.textContent = title;
    p.appendChild(strong);
    el.insertBefore(p, el.firstChild);
  });
}

/**
 * 首段是否为「已注入的标题段」：带来源标记、唯一元素是 `<strong>`、整段文本等于标题。
 *
 * 三个条件都要（标记单独不够：产物被第三方改过内容后，标记还在但文本变了，此时宁可
 * 再插一段让人看见重复，也不要留下一个内容不对的标题）。
 */
function isInjectedTitleParagraph(el: Element | null, title: string): boolean {
  if (!el || el.nodeName !== 'P' || !el.hasAttribute(INJECTED_TITLE_ATTR)) return false;
  if (el.children.length !== 1 || el.firstElementChild?.nodeName !== 'STRONG') return false;
  return (el.textContent ?? '').trim() === title;
}

/** `<sup data-footnote-ref label="1">[^1]</sup>` → 文本改成 `[1]`；标签与属性一个不动（C-1） */
function rewriteFootnoteRefs(root: HTMLElement): void {
  root.querySelectorAll('sup[data-footnote-ref]').forEach((el) => {
    const label = stripZwnj((el as HTMLElement).getAttribute('label') ?? '').trim();
    if (!label) return;
    el.textContent = `[${label}]`;
  });
}

/**
 * 块公式 / mermaid / 代码块：外壳与内部一字不动，只加内联样式保住换行与等宽。
 *
 * 为什么不是 `<pre>`：见 C-3。为什么样式仍必要：回到 solo 时 `code: true` 让 PM 按 `pre`
 * 处理空白，本来就不塌；**会塌的是浏览器 / Word / 公众号这些按 HTML 规则折叠空白的外部消费者**。
 *
 * 代码块（2026-10-21 复审补）：`<pre>` 的「默认等宽」根本靠不住——公众号会给它自己的
 * 样式，实测粘过去是「带边框的普通字体」，代码看起来像散文。与 math/mermaid 用同一套
 * 内联，只加 `white-space` 与 `font-family`：
 * **不碰颜色**是刻意的——跟主题走会让深色主题的代码块在白底文章里变成一块黑，写死又违反
 * 「不硬编码颜色」，两头都不该做；等宽 + 保换行已经足以让它「看起来像代码」。
 */
function stylePlainSourceBlocks(root: HTMLElement): void {
  // 等宽字体与编辑器同源：运行时读 `--font-mono`（真理源在 main.css），不在此硬编码
  const monoStack = resolveMonoFontStack();
  root.querySelectorAll('div[data-type="mermaid-block"]').forEach((el) => {
    (el as HTMLElement).classList.add('language-mermaid');
    applyPreStyle(el as HTMLElement, monoStack);
  });
  root.querySelectorAll('div[data-type="math-block"]').forEach((el) => applyPreStyle(el as HTMLElement, monoStack));
  root.querySelectorAll('pre').forEach((el) => applyPreStyle(el as HTMLElement, monoStack));
  // 行内代码只补等宽（`pre code` 继承外层，不重复设）
  root.querySelectorAll('code').forEach((el) => {
    if (el.closest('pre')) return;
    (el as HTMLElement).style.setProperty('font-family', monoStack);
  });
}

function applyPreStyle(el: HTMLElement, monoStack: string): void {
  el.style.setProperty('white-space', 'pre-wrap');
  el.style.setProperty('font-family', monoStack);
}

/**
 * 表格去死宽。两个宽度载体要分开处理（判据见 CP-20261011-002「现状」）：
 *  - `<colgroup>` 与 `style` 里的 `min-width`/`width` 是**布局壳**，Word 会照做 ⇒ 删；
 *  - `colwidth` 是 solo 的非标准属性，Word 忽略、`parseHTML` 认 ⇒ **留**（拖过列宽的文档靠它还原）。
 * `text-align` 也必须留：GFM 的 `:---:` 对齐就住在这个声明里（`parser.ts` 读进 `align` attrs）。
 *
 * 两个例外只对 `document` 生效：
 *  - **拆 `div.tableWrapper`** —— 拆完顶层节点从 `div` 变成 `table`，而 PM 是在本层返回 HTML
 *    **之后**才把 `data-pm-slice` 打在「第一个顶层元素」上（`serializeForClipboard`）⇒ 标记
 *    会落到 table 上、打开深度对不上，粘回 solo 的 slice 还原会错位。选区路径不拆。
 *  - 其余（colgroup / 宽度 / thead 提升）在 table **内部**动手，顶层节点身份不变，两档都跑。
 */
function cleanTables(root: HTMLElement, target: ExternalizeTarget): void {
  root.querySelectorAll('colgroup').forEach((el) => el.remove());
  if (target === 'document') root.querySelectorAll('div.tableWrapper').forEach(unwrap);

  root.querySelectorAll('td, th').forEach((el) => {
    if (el.getAttribute('colspan') === '1') el.removeAttribute('colspan');
    if (el.getAttribute('rowspan') === '1') el.removeAttribute('rowspan');
  });

  root.querySelectorAll('table').forEach((table) => {
    dropWidthStyles(table);
    promoteHeaderRow(table);
  });
}

/**
 * 只摘宽度声明，别的声明（尤其 `text-align`）原样留着。
 *
 * 作用域限定在表格子树内：`colgroup` / `style` 的宽度是 Tiptap 为「拖拽列宽」渲染的布局壳，
 * Word 会照做 ⇒ 死宽；而表格之外也存在合法的 `width` 样式，不该被顺手清掉。
 */
function dropWidthStyles(scope: Element): void {
  const targets: Element[] = [scope, ...Array.from(scope.querySelectorAll('*'))];
  targets.forEach((el) => {
    const styled = el as HTMLElement;
    if (!styled.hasAttribute('style')) return;
    styled.style.removeProperty('min-width');
    styled.style.removeProperty('width');
    if (!styled.getAttribute('style')) styled.removeAttribute('style');
  });
}

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

/**
 * Tiptap 把表头行渲在 `<tbody>` 里（PM 的 `table` content 是 `tableRow+`，没有 row group），
 * Word 因此认不出表头。⇒ 首行若全是 `th`，把它包进 `<thead>` 并挪到 `<tbody>` 前。
 * 实测这一动作对 PM 的类型路径签名透明（`<thead><tr><th>` 与 `<tbody><tr><th>` 解析回同形）。
 */
function promoteHeaderRow(table: Element): void {
  const doc = table.ownerDocument;
  const firstRow = table.querySelector('tr');
  if (!firstRow) return;
  const body = firstRow.parentNode;
  if (!body || body.nodeName.toLowerCase() !== 'tbody') return;

  const cells = Array.from(firstRow.children);
  if (!cells.length || cells.some((c) => c.nodeName.toLowerCase() !== 'th')) return;

  const thead = doc.createElement('thead');
  thead.appendChild(firstRow);
  table.insertBefore(thead, body);
}

// ── 清洗组（不改语义，最后一步做，覆盖改写过程中从属性新写出的文本与全部保留属性值）──

function stripInvisibleChars(root: HTMLElement): void {
  // 用 root.ownerDocument 而非全局 document：Ctrl+C 通道里 PM 传进来的是一个**游离 document**
  // （`serializeForClipboard` 的 detachedDoc），跨 document 建 TreeWalker 在 WebKit/Chromium
  // 上会抛 WrongDocumentError。
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  // walker 只收 SHOW_TEXT，故 nextNode() 的静态类型是 Node，这里按 Text 用
  let current = walker.nextNode() as Text | null;
  while (current) {
    const cleaned = stripZwnj(current.data);
    if (cleaned !== current.data) current.data = cleaned;
    current = walker.nextNode() as Text | null;
  }

  root.querySelectorAll('*').forEach((el) => {
    // 倒序遍历：setAttribute/removeAttribute 都会让 attributes 实时变短
    for (let i = el.attributes.length - 1; i >= 0; i--) {
      const attr = el.attributes[i];
      if (!attr) continue;
      const cleaned = stripZwnj(attr.value);
      // C-2：剥空了也留着（空串属性本身就是 `parseHTML` 的选择器）；唯一例外是 class
      if (attr.name === 'class' && !cleaned.trim()) el.removeAttribute(attr.name);
      else if (cleaned !== attr.value) el.setAttribute(attr.name, cleaned);
    }
  });
}
