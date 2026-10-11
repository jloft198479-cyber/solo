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
 * 清洗组（本文件最后一步）与改写组分开的意义：清洗组不改语义，将来可单独挂到 Ctrl+C 的
 * `editorProps.clipboardSerializer` 上；改写组不行——那条 HTML 正是 solo→solo 的语义载体。
 */
import { stripZwnj } from './zwnj';

/** 幂等标记。只打在承载根节点自身，`innerHTML` 不含它 ⇒ 不会随 HTML 出站 */
const EXTERNALIZED = 'data-solo-externalized';

export function externalizeHtml(root: HTMLElement): void {
  if (root.hasAttribute(EXTERNALIZED)) return;
  rewriteForExternal(root);
  stripInvisibleChars(root);
  root.setAttribute(EXTERNALIZED, '');
}

// ── 改写组（仅对外，会动语义）──────────────────────────────────

function rewriteForExternal(root: HTMLElement): void {
  dropFrontmatter(root);
  surfaceCalloutTitle(root);
  rewriteFootnoteRefs(root);
  stylePlainSourceBlocks(root);
  cleanTables(root);
}

/** 元数据不出站：与回落管道 `sanitizeForExternal` 的 `FRONTMATTER_RE` 剥离语义一致 */
function dropFrontmatter(root: HTMLElement): void {
  root.querySelectorAll('div[data-type="frontmatter"]').forEach((el) => el.remove());
}

/**
 * callout 的标题活在 `data-title` 属性里，DOMSerializer 的产出正文没有它（可见标题是 NodeView
 * 现算的）。⇒ 把标题提成正文首个段落；同时删掉 `data-title`，否则粘回 solo 时「属性 + 正文」
 * 两份标题并存。
 *
 * `Callout.content = 'block+'` ⇒ 注入段落是内容规格允许的，这是全案唯一的结构注入点。
 * 没标题时**什么都不加**：编一个类型词（`note`/`warning`）等于往用户文档里塞我方造的字。
 */
function surfaceCalloutTitle(root: HTMLElement): void {
  root.querySelectorAll('div.mk-callout').forEach((el) => {
    const title = stripZwnj((el as HTMLElement).getAttribute('data-title') ?? '').trim();
    if (!title) return;
    el.removeAttribute('data-title');
    const p = el.ownerDocument.createElement('p');
    const strong = el.ownerDocument.createElement('strong');
    strong.textContent = title;
    p.appendChild(strong);
    el.insertBefore(p, el.firstChild);
  });
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
 * 块公式 / mermaid：外壳与内部一字不动，只加内联样式保住换行与等宽。
 *
 * 为什么不是 `<pre>`：见 C-3。为什么样式仍必要：回到 solo 时 `code: true` 让 PM 按 `pre`
 * 处理空白，本来就不塌；**会塌的是浏览器 / Word 这些按 HTML 规则折叠空白的外部消费者**。
 */
function stylePlainSourceBlocks(root: HTMLElement): void {
  root.querySelectorAll('div[data-type="mermaid-block"]').forEach((el) => {
    (el as HTMLElement).classList.add('language-mermaid');
    applyPreStyle(el as HTMLElement);
  });
  root.querySelectorAll('div[data-type="math-block"]').forEach((el) => applyPreStyle(el as HTMLElement));
}

function applyPreStyle(el: HTMLElement): void {
  el.style.setProperty('white-space', 'pre-wrap');
  el.style.setProperty('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace');
}

/**
 * 表格去死宽。两个宽度载体要分开处理（判据见 CP-20261011-002「现状」）：
 *  - `<colgroup>` 与 `style` 里的 `min-width`/`width` 是**布局壳**，Word 会照做 ⇒ 删；
 *  - `colwidth` 是 solo 的非标准属性，Word 忽略、`parseHTML` 认 ⇒ **留**（拖过列宽的文档靠它还原）。
 * `text-align` 也必须留：GFM 的 `:---:` 对齐就住在这个声明里（`parser.ts` 读进 `align` attrs）。
 */
function cleanTables(root: HTMLElement): void {
  root.querySelectorAll('colgroup').forEach((el) => el.remove());
  root.querySelectorAll('div.tableWrapper').forEach(unwrap);

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
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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
