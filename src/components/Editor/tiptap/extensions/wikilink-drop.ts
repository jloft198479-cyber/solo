/**
 * 拖入文档 → 互链 的路由决策（纯函数，可单测）
 *
 * 口径与 `[[` 补全、标红判定、改名同步**同源**：
 * - 只有「落在正文里 + 当前文档已保存 + 被拖的是**当前文档所在目录树内**的 .md/.markdown
 *   且不是自身」才转为插入互链；
 * - 相对路径深度受 `WIKILINK_SCAN_DEPTH` 限制，超范围一律回落 fallback；
 * - 其余一律回落 fallback（= 现状），失败 / 不确定都是安全默认（非破坏性、可撤销）。
 * - 不做绝对路径、不做 `../` 出界（出界扫不到，见方案文档「二期」）。
 *
 * DOM 命中测试（落点是否在编辑器内、落在文档哪个位置）在调用方做，本模块只吃布尔量，保持纯。
 */

const DOC_EXT = /\.(md|markdown|txt)$/i; // 可打开的文档后缀（窗口层打开逻辑 / 图片拖入让路逻辑共用，勿各处内联）
/**
 * 互链里**算「已经写了后缀」**的只有 `.md` / `.markdown`（大小写不敏感）——与 Obsidian 同口径。
 *
 * 其余一律当裸名、解析时补 `.md`：`.env`（文件其实是 `.env.md`）、`周报.终稿`
 * （文件其实是 `周报.终稿.md`）都能点开，而不是去开一个不存在的 `.env` / `周报.终稿`。
 * 解析、补全、标红三处共用本判定，别再各自内联正则。
 */
const MARKDOWN_EXT = /\.(md|markdown)$/i; // 可成链的文档后缀（.txt 维持「打开」）

/** 名字是否已是 markdown 文件（`.md` / `.markdown`）。 */
export function hasMarkdownExtension(name: string): boolean {
  return MARKDOWN_EXT.test(name);
}
/**
 * target 里**可以省略**的后缀：只有 `.md`。
 *
 * 解析器只给「不带后缀的目标」补 `.md`（`wikilink.ts::resolveWikilinkTarget`），
 * 带后缀的原样拼路径。所以 `.markdown` 必须把后缀留在 target 里：一起去掉就得到
 * 一条指向「`sub/B.md`」的死链 —— 拖完当场标红，点开还会建出一个同名的空 `B.md`
 * 与原文件并存（2026-10-20 审核 R-3）。留着后缀两侧都自洽：解析能打开，
 * 标红遇非 `.md` 扩展名一律不判。
 */
const STRIPPABLE_EXT = /\.md$/i;

/**
 * 互链作用域的**目录递归深度**：当前文档所在目录算第 0 层，向下最多这么多层。
 *
 * 这里是前端的唯一真理源 —— 拖入判深度、`wikilink-existence` 判标红都用它；
 * Rust 侧 `document.rs::WIKILINK_SCAN_DEPTH` 必须同值（spec 读源码校验）。
 * 放在这个**无框架依赖**的纯函数模块，避免 composables 层为了一个常量把 tiptap 拖进来。
 */
export const WIKILINK_SCAN_DEPTH = 2;

/** 是否「可打开的文档」。窗口层 openDocument 与图片拖入让路共用此判定（避免同一事实写多处）。 */
export function isDocumentPath(path: string): boolean {
  return DOC_EXT.test(path);
}

/** 路径归一：统一分隔符 + 折叠重复分隔符 + 去尾分隔符。比较用（不做大小写折叠，宁可漏判回落 fallback）。 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
}

function dirOf(path: string): string {
  const p = normalizePath(path);
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

export function basename(path: string): string {
  const p = normalizePath(path);
  return p.slice(p.lastIndexOf('/') + 1);
}

/**
 * 把绝对路径算成「相对 `baseDir`」的分段（不含 baseDir 本身）；不在其下返回 null。
 *
 * 逐段比较而不是 `startsWith`：`D:/a/bc` 会被 `D:/a/b` 前缀误判成「在里面」。
 * 大小写保持严格（宁可漏判回落「打开」，也不把别处的文件误连进来）。
 */
function relativeSegments(baseDir: string, target: string): string[] | null {
  const base = normalizePath(baseDir).split('/');
  const segs = normalizePath(target).split('/');
  // 必须比 baseDir 更深（同层文件 = 1 段，子目录文件 = 2 段起）
  if (segs.length <= base.length) return null;
  for (let i = 0; i < base.length; i += 1) {
    if (base[i] !== segs[i]) return null;
  }
  return segs.slice(base.length);
}

/** 互链 target：相对路径去 `.md` 后缀（`sub/B.md` → `sub/B`），其他后缀保留原样。 */
export function wikilinkTargetFromRelative(relativePath: string): string {
  return normalizePath(relativePath).replace(STRIPPABLE_EXT, '');
}

/**
 * 产出侧字符闸门：含这些字符的文件名**不允许**由补全 / 拖入产出互链。
 *
 * 判定侧、解析侧都按既定语义办事，唯独产出侧不检查就会造出自相矛盾的死链：
 * - `#`：解析时按 Obsidian 锚点语义剥掉 ⇒ `[[C#笔记]]` 解析成 `C.md`（真实文件是 `C#笔记.md`），
 *   点它还会在磁盘造出一个空 `C.md`；
 * - `[` `]`：落盘正则的 target 段是 `[^\]|]+`，`]` 无法被表达 ⇒ 回读时 target 被截断、
 *   正文多出一个裸 `]`（保真链路静默损坏，重则整条退化成纯文本）；
 * - `|`：别名分隔符（Windows 文件名非法，macOS / Linux 可达）。
 *
 * 挡在产出侧而不是 serializer：一条规则同时堵住两个入口，且不碰 parser / serializer。
 */
export function isLinkableTarget(target: string): boolean {
  return !/[#[\]|]/.test(target);
}

export type DropDecision =
  | { kind: 'fallback' } // 编辑器不接住：文档交窗口层「打开」，图片等交既有 drop 逻辑
  | { kind: 'insert'; targets: string[] }; // 在落点处插入这些互链

/**
 * 依据「被拖路径集合 + 当前保存路径 + 是否落在正文」决定这次拖入编辑器是否接住。
 * 决策保守：只有「正文内 + 已保存 + 目录树内 + 深度内 + .md/.markdown + 非自身」才 insert，
 * 其余一律 fallback —— 回落只是「打开」，非破坏性且可撤销。
 */
export function decideDocumentDrop(
  paths: string[],
  currentDocPath: string | null | undefined,
  isInsideEditor: boolean,
): DropDecision {
  const self = currentDocPath ? normalizePath(currentDocPath) : '';
  if (!isInsideEditor || !self) return { kind: 'fallback' };
  const selfDir = dirOf(self);

  const targets: string[] = [];
  for (const p of paths) {
    if (!hasMarkdownExtension(p)) continue;
    if (normalizePath(p) === self) continue; // 拖当前文档自身不生成自链接（与 [[ 补全排除自身口径一致）
    const segs = relativeSegments(selfDir, p);
    if (!segs) continue;
    // 深度上限与补全/标红同口径：范围外的目标不生成链接
    if (segs.length - 1 > WIKILINK_SCAN_DEPTH) continue;
    const target = wikilinkTargetFromRelative(segs.join('/'));
    // 解析器读不回来的字符不产出（否则成链即死链，见 isLinkableTarget）
    if (target && isLinkableTarget(target)) targets.push(target);
  }

  return targets.length > 0 ? { kind: 'insert', targets } : { kind: 'fallback' };
}
