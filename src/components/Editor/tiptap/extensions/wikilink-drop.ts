/**
 * 拖入文档 → 互链 的路由决策（纯函数，可单测）
 *
 * 一期口径（对齐 solo 单文件定位，见 docs/solo互链方案）：
 * - 只有「落在正文里 + 当前文档已保存 + 被拖的是同目录 .md/.markdown」才转为插入互链；
 * - 其余一律回落「打开」（= 现状），失败 / 不确定都是安全默认（非破坏性、可撤销）。
 * - 不做跨目录 / 绝对路径 / 递归（推二期）。
 *
 * DOM 命中测试（是否落在编辑器内）在调用方做，本模块只吃布尔量，保持纯。
 */

const DOC_EXT = /\.(md|markdown|txt)$/i; // 与窗口 handler 现有「可打开文档」集合一致
const LINKABLE_EXT = /\.(md|markdown)$/i; // 一期仅 .md/.markdown 可成链（.txt 维持「打开」）

function lastSepIndex(path: string): number {
  return Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
}

function basename(path: string): string {
  const i = lastSepIndex(path);
  return i < 0 ? path : path.slice(i + 1);
}

/** 去掉尾部链接符（若有），得到所在目录；用于同目录比较（精确比较，不做大小写折叠，宁可漏判回落「打开」）。 */
function dirOf(path: string): string {
  const i = lastSepIndex(path);
  if (i < 0) return '';
  let dir = path.slice(0, i);
  dir = dir.replace(/[\\/]+$/, ''); // 去尾分隔符，避免 "A/" vs "A" 误判不同目录
  return dir;
}

export function isSameDirectory(a: string, b: string): boolean {
  return dirOf(a) === dirOf(b);
}

/** 互链 target：同目录文件的去后缀裸名（与 [[ 补全产出一致，resolveWikilinkTarget 会补回 .md）。 */
export function wikilinkTargetFromPath(path: string): string {
  return basename(path).replace(LINKABLE_EXT, '');
}

export type DropDecision =
  | { kind: 'none' } // 无文档文件（纯图片等）：交回原逻辑，不 open 也不插链
  | { kind: 'open'; path: string } // 维持现状：打开该文档
  | { kind: 'insert'; targets: string[] }; // 在光标处插入这些互链

/**
 * 依据「可打开文档集合 + 是否落在正文 + 当前保存路径」决定这次拖入怎么处理。
 * 决策保守：任何不满足「正文内 + 已保存 + 同目录 .md/.markdown」的，都走 open。
 */
export function decideDocumentDrop(
  paths: string[],
  currentDocPath: string | null | undefined,
  isInsideEditor: boolean,
): DropDecision {
  const docFiles = paths.filter((p) => DOC_EXT.test(p));
  if (docFiles.length === 0) return { kind: 'none' };

  const first = docFiles[0];
  const canLink =
    isInsideEditor &&
    !!currentDocPath &&
    LINKABLE_EXT.test(first) &&
    isSameDirectory(currentDocPath as string, first);

  if (!canLink) return { kind: 'open', path: first };

  const targets = docFiles
    .filter(
      (p) =>
        LINKABLE_EXT.test(p) && isSameDirectory(currentDocPath as string, p),
    )
    .map(wikilinkTargetFromPath)
    .filter((t) => t.length > 0);

  return targets.length > 0 ? { kind: 'insert', targets } : { kind: 'open', path: first };
}
