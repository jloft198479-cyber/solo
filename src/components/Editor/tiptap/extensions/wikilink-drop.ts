/**
 * 拖入文档 → 互链 的路由决策（纯函数，可单测）
 *
 * 一期口径（对齐 solo 单文件定位，见 docs/solo互链方案）：
 * - 只有「落在正文里 + 当前文档已保存 + 被拖的是同目录 .md/.markdown 且不是自身」才转为插入互链；
 * - 其余一律回落 fallback（= 现状），失败 / 不确定都是安全默认（非破坏性、可撤销）。
 * - 不做跨目录 / 绝对路径 / 递归（推二期）。
 *
 * DOM 命中测试（落点是否在编辑器内、落在文档哪个位置）在调用方做，本模块只吃布尔量，保持纯。
 */

const DOC_EXT = /\.(md|markdown|txt)$/i; // 可打开的文档后缀（窗口层打开逻辑 / 图片拖入让路逻辑共用，勿各处内联）
const LINKABLE_EXT = /\.(md|markdown)$/i; // 一期仅 .md/.markdown 可成链（.txt 维持「打开」）

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

function basename(path: string): string {
  const p = normalizePath(path);
  return p.slice(p.lastIndexOf('/') + 1);
}

export function isSameDirectory(a: string, b: string): boolean {
  return dirOf(a) === dirOf(b);
}

/** 互链 target：同目录文件的去后缀裸名（与 [[ 补全产出一致，resolveWikilinkTarget 会补回 .md）。 */
export function wikilinkTargetFromPath(path: string): string {
  return basename(path).replace(LINKABLE_EXT, '');
}

export type DropDecision =
  | { kind: 'fallback' } // 编辑器不接住：文档交窗口层「打开」，图片等交既有 drop 逻辑
  | { kind: 'insert'; targets: string[] }; // 在落点处插入这些互链

/**
 * 依据「被拖路径集合 + 当前保存路径 + 是否落在正文」决定这次拖入编辑器是否接住。
 * 决策保守：只有「正文内 + 已保存 + 同目录 .md/.markdown + 非自身」才 insert，其余一律 fallback。
 */
export function decideDocumentDrop(
  paths: string[],
  currentDocPath: string | null | undefined,
  isInsideEditor: boolean,
): DropDecision {
  const self = currentDocPath ? normalizePath(currentDocPath) : '';
  if (!isInsideEditor || !self) return { kind: 'fallback' };

  const targets = paths
    .filter(
      (p) =>
        LINKABLE_EXT.test(p) &&
        isSameDirectory(self, p) &&
        normalizePath(p) !== self, // 拖当前文档自身不生成自链接（与 [[ 补全排除自身口径一致）
    )
    .map(wikilinkTargetFromPath)
    .filter((t) => t.length > 0);

  return targets.length > 0 ? { kind: 'insert', targets } : { kind: 'fallback' };
}
