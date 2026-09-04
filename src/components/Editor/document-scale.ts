import { shallowRef } from 'vue';

/**
 * 文档规模档位。度量口径统一为「剔除 base64 内嵌图片后的字符数」——
 * 内嵌图片渲染成独立节点，不参与编辑期的全文遍历，不该把它算进「会让编辑器变慢的规模」。
 */
export type DocumentTier = 'normal' | 'heavy' | 'extreme';

/** heavy：自动降级三项高开销编辑特性（代码块自动语言检测 / 焦点模式装饰 / 实时字数） */
export const HEAVY_DOC_CHARS = 500_000;
/** extreme：打开前必须用户确认才进可编辑模式 */
export const EXTREME_DOC_CHARS = 2_000_000;

export function resolveDocumentTier(charCount: number): DocumentTier {
  if (charCount >= EXTREME_DOC_CHARS) return 'extreme';
  if (charCount >= HEAVY_DOC_CHARS) return 'heavy';
  return 'normal';
}

/**
 * 本窗口当前档位。每个 WebviewWindow 是独立的页面与 JS 上下文，
 * 模块级状态天然按窗口隔离，与 `document.documentElement.classList` 上的 focus-mode 同一套作用域。
 */
export const documentTier = shallowRef<DocumentTier>('normal');

/** 高开销特性是否该让路。extreme 是 heavy 的超集，因此两档都降级。 */
export function isHeavyDocument(): boolean {
  return documentTier.value !== 'normal';
}

/** 打开文件后由 `loadDocumentFromPath` 调用；新建文档时复位为 normal。 */
export function setDocumentTier(tier: DocumentTier) {
  documentTier.value = tier;
  // 映射到 <html> class（与 focus-mode 同一套作用域），供 CSS 门控渲染优化：
  // content-visibility 会干扰 WebView2/TSF 组字光标矩形（IME 候选窗失锚变形），
  // 故仅大文档（doc-heavy）启用，普通文档关闭以保证输入法正确。
  // node 环境（部分单测）无 document，守卫跳过。
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('doc-heavy', tier !== 'normal');
  }
}

/** 档位度量口径：剔除 base64 内嵌图片后的源文本长度。 */
export function countVisibleChars(markdown: string): number {
  const stripped =
    markdown.indexOf('data:image') >= 0
      ? markdown.replace(/!\[.*?\]\(data:image\/[^;]+;base64,[^)]+\)/g, '')
      : markdown;
  return stripped.length;
}
