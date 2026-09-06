/**
 * 图片扩展
 *
 * 支持本地路径、网络 URL、data URI。
 * Tauri 环境下的 asset:// 协议路径会自动转换。
 */
import Image from '@tiptap/extension-image';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface ImageMarkdownAttrs {
  src: string;
  alt: string;
  title: string | null;
  /** 图片宽度（px），来自 `![alt|WxH](src)` 语法的可选尺寸标注 */
  width: number | null;
  /** 图片高度（px），来自 `![alt|WxH](src)` 语法的可选尺寸标注 */
  height: number | null;
}

/**
 * 从 alt 文本中提取 `|WxH` 尺寸后缀。
 * 支持 `![alt|640x480](src)` 语法——alt 后跟 `|WxH` 表示宽高（px）。
 * 返回 { alt, width, height }；无尺寸后缀时 width/height 为 null。
 * 这是 solo 的扩展语法，不依赖 markdown-it 解析层改动——markdown-it 会把
 * `![alt|WxH](src)` 的 alt 解析为 `alt|WxH`（`|` 非特殊字符），在此提取。
 */
export function extractDimsFromAlt(alt: string): {
  alt: string;
  width: number | null;
  height: number | null;
} {
  const match = alt.match(/^(.*?)\|(\d+)x(\d+)$/);
  if (!match) return { alt, width: null, height: null };
  const width = parseInt(match[2], 10);
  const height = parseInt(match[3], 10);
  if (!width || !height) return { alt, width: null, height: null };
  return { alt: match[1], width, height };
}

export function formatImageMarkdown(attrs: ImageMarkdownAttrs): string {
  const alt = attrs.alt || '';
  const src = attrs.src || '';
  const title = attrs.title?.replace(/"/g, '\\"') ?? '';
  // 有尺寸时输出 `![alt|WxH](src)`，无尺寸时输出 `![alt](src)`
  const altWithDims =
    attrs.width != null && attrs.height != null ? `${alt}|${attrs.width}x${attrs.height}` : alt;

  if (title) {
    return `![${altWithDims}](${src} "${title}")`;
  }

  return `![${altWithDims}](${src})`;
}

export function parseImageMarkdown(markdown: string): ImageMarkdownAttrs | null {
  const value = markdown.trim();
  const match = value.match(/^!\[(?<alt>[^\]]*)\]\((?<body>.*?)\)$/);

  if (!match?.groups) {
    return null;
  }

  const rawAlt = match.groups.alt ?? '';
  const body = match.groups.body.trim();
  const titleMatch = body.match(/^(?<src>.+?)(?:\s+"(?<title>(?:[^"\\]|\\.)*)")?$/);

  if (!titleMatch?.groups?.src) {
    return null;
  }

  const src = titleMatch.groups.src.trim();
  if (!src) {
    return null;
  }

  // 从 alt 提取 `|WxH` 尺寸后缀
  const { alt, width, height } = extractDimsFromAlt(rawAlt);

  return {
    src,
    alt,
    title: titleMatch.groups.title == null ? null : titleMatch.groups.title.replace(/\\"/g, '"'),
    width,
    height,
  };
}

type RemoteImageFetcher = (src: string) => Promise<string>;
type RemoteImageCacheEntry =
  | { status: 'fulfilled'; value: string }
  | { status: 'pending'; promise: Promise<string> }
  | { status: 'failed'; expiresAt: number };

/**
 * 条目级 LRU 兜底。每条缓存只是两个短字符串（原始 URL + asset URL），
 * 500 条也就几十 KB——真正的内存大头（图片字节）在 Rust 侧磁盘缓存，
 * 前端不再持有。此上限只防超长会话里 Map 无界增长。
 * （C8：原 50MB 字节预算依赖 blobUrlRegistry 记账，#4 改 Rust 落盘 +
 * asset URL 后 size 恒为 0、驱逐分支永不触发，属假保险，已删。）
 */
const MAX_REMOTE_IMAGE_CACHE_ENTRIES = 500;
const MAX_CONCURRENT_REMOTE_IMAGE_FETCHES = 4;
const REMOTE_IMAGE_FAILURE_TTL_MS = 5 * 60 * 1000;
const remoteImageCache = new Map<string, RemoteImageCacheEntry>();
const remoteImageQueue: Array<() => void> = [];

let activeRemoteImageFetches = 0;
let remoteImageFetcher: RemoteImageFetcher | null = null;

function isRemoteImageSrc(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

function touchRemoteImageCacheEntry(src: string, entry: RemoteImageCacheEntry) {
  remoteImageCache.delete(src);
  remoteImageCache.set(src, entry);
}

/** 按条目数 LRU 淘汰。Map 迭代序 = 插入序，touch 时 delete+set 把命中项移到最新端。 */
function trimRemoteImageCache() {
  while (remoteImageCache.size > MAX_REMOTE_IMAGE_CACHE_ENTRIES) {
    let removableKey: string | null = null;
    for (const [src, entry] of remoteImageCache) {
      if (entry.status !== 'pending') {
        removableKey = src;
        break;
      }
    }
    if (!removableKey) break;
    remoteImageCache.delete(removableKey);
  }
}

/** 清空远程图片内存缓存（编辑器卸载时调用，重置 LRU 状态）。 */
export function releaseRemoteImageCache() {
  remoteImageCache.clear();
  remoteImageQueue.length = 0;
  activeRemoteImageFetches = 0;
}

function runWithRemoteImageConcurrency<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeRemoteImageFetches += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeRemoteImageFetches -= 1;
          remoteImageQueue.shift()?.();
        });
    };

    if (activeRemoteImageFetches < MAX_CONCURRENT_REMOTE_IMAGE_FETCHES) {
      run();
    } else {
      remoteImageQueue.push(run);
    }
  });
}

function getRemoteImageFetcher(): RemoteImageFetcher {
  remoteImageFetcher ??= async (src: string) => {
    const { fetchRemoteImageData } = await import('../../../../services/tauri/document');
    const { toAssetUrl } = await import('../../../../services/tauri/asset');
    // Rust 侧落盘后返回文件路径，前端转成 asset URL 直接显示
    const filePath = await fetchRemoteImageData(src);
    return toAssetUrl(filePath);
  };
  return remoteImageFetcher;
}

export async function getRemoteImageDisplaySrc(src: string): Promise<string> {
  if (!isRemoteImageSrc(src)) {
    return src;
  }

  const now = Date.now();
  const cached = remoteImageCache.get(src);
  if (cached) {
    if (cached.status === 'fulfilled') {
      touchRemoteImageCacheEntry(src, cached);
      return cached.value;
    }
    if (cached.status === 'pending') {
      touchRemoteImageCacheEntry(src, cached);
      return cached.promise;
    }
    if (cached.expiresAt > now) {
      touchRemoteImageCacheEntry(src, cached);
      return src;
    }
    remoteImageCache.delete(src);
  }

  const promise = runWithRemoteImageConcurrency(() => getRemoteImageFetcher()(src))
    .then((displaySrc) => {
      // #4 之后 fetcher 返回 asset URL（Rust 已落盘），直接缓存字符串，
      // 前端不再持有图片字节，无需 Blob URL 转换（C8 已删该路径）
      touchRemoteImageCacheEntry(src, { status: 'fulfilled', value: displaySrc });
      trimRemoteImageCache();
      return displaySrc;
    })
    .catch(() => {
      touchRemoteImageCacheEntry(src, {
        status: 'failed',
        expiresAt: Date.now() + REMOTE_IMAGE_FAILURE_TTL_MS,
      });
      trimRemoteImageCache();
      return src;
    });

  remoteImageCache.set(src, { status: 'pending', promise });
  trimRemoteImageCache();
  return promise;
}

export function __setRemoteImageFetcherForTests(fetcher: RemoteImageFetcher | null) {
  remoteImageFetcher = fetcher;
}

export function __resetRemoteImageCacheForTests() {
  remoteImageCache.clear();
  remoteImageQueue.splice(0, remoteImageQueue.length);
  activeRemoteImageFetches = 0;
  remoteImageFetcher = null;
}

/** 从 Tauri asset:// URL 中反解文件路径 */
function extractPathFromAssetUrl(assetUrl: string): string | null {
  try {
    const url = new URL(assetUrl);
    if (url.hostname !== 'asset.localhost') return null;
    let path = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
    return path || null;
  } catch {
    return null;
  }
}

/** 判断是否为本地相对路径（非 http/data/blob/asset/绝对路径） */
function isLocalRelativePath(src: string): boolean {
  if (/^(https?:\/\/|data:|blob:|asset:\/\/)/i.test(src)) return false;
  if (/^[A-Z]:\\/i.test(src)) return false; // Windows 绝对路径
  return true;
}

/** 本地图片路径解析器：相对路径 → 显示用 URL */
let _localSrcResolver: ((src: string) => Promise<string | null>) | null = null;

export function setLocalSrcResolver(fn: (src: string) => Promise<string | null>) {
  _localSrcResolver = fn;
}

export function resetLocalSrcResolver() {
  _localSrcResolver = null;
}

export const CustomImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) =>
          (el as HTMLImageElement).getAttribute('width')
            ? Number((el as HTMLImageElement).getAttribute('width'))
            : null,
        renderHTML: (attrs) => (attrs.width != null ? { width: attrs.width } : {}),
      },
      height: {
        default: null,
        parseHTML: (el) =>
          (el as HTMLImageElement).getAttribute('height')
            ? Number((el as HTMLImageElement).getAttribute('height'))
            : null,
        renderHTML: (attrs) => (attrs.height != null ? { height: attrs.height } : {}),
      },
    };
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('span');
      dom.className = 'mk-image-shell';
      dom.draggable = false;

      // 统一管理事件监听器，destroy 时一次性清理（声明在前，下方监听器可立即引用）
      const eventController = new AbortController();

      const image = document.createElement('img');
      image.className = 'mk-image';
      image.loading = 'lazy';
      image.draggable = false;
      dom.appendChild(image);

      // caption：显示 alt 文字在图片下方，居中 muted 小字号（iA Writer 做法）
      const caption = document.createElement('figcaption');
      caption.className = 'mk-image-caption';
      caption.draggable = false;
      dom.appendChild(caption);

      const sourceText = document.createElement('div');
      sourceText.className = 'mk-image-source-text';
      sourceText.contentEditable = 'plaintext-only';
      sourceText.spellcheck = false;
      sourceText.draggable = false;
      dom.appendChild(sourceText);

      let isEditing = false;

      const getAttrs = (): ImageMarkdownAttrs => ({
        src: (node.attrs.src as string) || '',
        alt: (node.attrs.alt as string) || '',
        title: (node.attrs.title as string | null) ?? null,
        width: (node.attrs.width as number | null) ?? null,
        height: (node.attrs.height as number | null) ?? null,
      });

      let displayRequestId = 0;
      let displaySrc = '';

      function syncView() {
        const attrs = getAttrs();
        const fallbackSrc = attrs.src;

        if (displaySrc !== fallbackSrc) {
          displaySrc = fallbackSrc;
          image.src = fallbackSrc;
        }

        image.alt = attrs.alt;
        image.title = attrs.title ?? '';

        // 有尺寸标注时设置 width/height 属性，浏览器预留空间避免 layout shift
        if (attrs.width != null && attrs.height != null) {
          image.width = attrs.width;
          image.height = attrs.height;
        } else {
          // 无尺寸标注时移除属性，让图片按自然尺寸渲染
          image.removeAttribute('width');
          image.removeAttribute('height');
        }

        // caption：仅在非编辑模式且有 alt 文字时显示
        if (!isEditing && attrs.alt) {
          caption.textContent = attrs.alt;
          caption.style.display = '';
        } else {
          caption.style.display = 'none';
        }

        // loading 占位：图片加载中显示 skeleton 背景，加载完移除
        if (image.src && !image.complete && !image.dataset.loaded) {
          image.classList.add('is-loading');
        }

        if (isRemoteImageSrc(attrs.src)) {
          if (image.dataset.prevRemoteSrc === attrs.src) return;
          image.dataset.prevRemoteSrc = attrs.src;
          const requestId = ++displayRequestId;
          void getRemoteImageDisplaySrc(attrs.src).then((displaySrc) => {
            // 解析是异步的，本块可能已经销毁；此时 requestId 仍然自匹配，必须额外查 aborted
            if (eventController.signal.aborted) return;
            if (requestId === displayRequestId) {
              if (image.src !== displaySrc) {
                image.src = displaySrc;
              }
            }
          });
        }

        // 旧版 asset:// URL 迁移：重新授权文件路径
        if (attrs.src.startsWith('https://asset.localhost/') && !image.dataset.prevAssetSrc) {
          image.dataset.prevAssetSrc = attrs.src;
          const filePath = extractPathFromAssetUrl(attrs.src);
          if (filePath) {
            void import('../../../../services/tauri/document').then(({ authorizeImageAsset }) => {
              authorizeImageAsset(filePath).catch(() => {});
            });
          }
        }

        // 本地相对路径 → 解析为 asset:// URL 显示
        if (isLocalRelativePath(attrs.src) && _localSrcResolver) {
          if (image.dataset.prevLocalSrc === attrs.src) return;
          const requestId = ++displayRequestId;
          void _localSrcResolver(attrs.src).then((displaySrc) => {
            // 解析是异步的，本块可能已经销毁；此时 requestId 仍然自匹配，必须额外查 aborted
            if (eventController.signal.aborted || requestId !== displayRequestId) return;
            if (!displaySrc) {
              // 解析失败 → 清标记，下次 syncView 可重试
              if (image.dataset.prevLocalSrc === attrs.src) {
                delete image.dataset.prevLocalSrc;
              }
              return;
            }
            image.dataset.prevLocalSrc = attrs.src;
            if (image.src !== displaySrc) {
              image.src = displaySrc;
            }
          });
        }

        if (!isEditing) {
          sourceText.textContent = formatImageMarkdown(attrs);
        }
      }

      function commit() {
        const parsed = parseImageMarkdown(sourceText.textContent || '');
        if (!parsed) {
          dom.classList.add('is-invalid');
          requestAnimationFrame(() => {
            sourceText.focus();
          });
          return;
        }

        dom.classList.remove('is-invalid');
        isEditing = false;
        dom.classList.remove('is-editing');

        const current = getAttrs();
        if (
          parsed.src === current.src &&
          parsed.alt === current.alt &&
          parsed.title === current.title
        ) {
          syncView();
          return;
        }

        if (typeof getPos !== 'function') {
          syncView();
          return;
        }

        const pos = getPos();
        if (typeof pos !== 'number') {
          syncView();
          return;
        }
        const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          ...parsed,
        });
        editor.view.dispatch(tr);
      }

      function cancel() {
        isEditing = false;
        dom.classList.remove('is-editing');
        dom.classList.remove('is-invalid');
        syncView();
      }

      dom.addEventListener('dragstart', (event) => {
        event.preventDefault();
      }, { signal: eventController.signal });

      sourceText.addEventListener('mousedown', (event) => {
        event.stopPropagation();
      }, { signal: eventController.signal });

      sourceText.addEventListener('focus', () => {
        isEditing = true;
        dom.classList.add('is-editing');
        dom.classList.remove('is-invalid');
      }, { signal: eventController.signal });

      sourceText.addEventListener('blur', () => {
        commit();
      }, { signal: eventController.signal });

      sourceText.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          commit();
          editor.commands.focus();
          return;
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          cancel();
          editor.commands.focus();
        }
      }, { signal: eventController.signal });

      // 双击图片 → 全屏预览（通过自定义事件冒泡到 MarkdownEditor）
      image.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (image.src) {
          dom.dispatchEvent(
            new CustomEvent('editor:image-dblclick', {
              bubbles: true,
              detail: { src: image.src },
            }),
          );
        }
      }, { signal: eventController.signal });

      // 加载完成移除 skeleton 占位
      image.addEventListener('load', () => {
        image.dataset.loaded = '1';
        image.classList.remove('is-loading');
      }, { signal: eventController.signal });
      image.addEventListener('error', () => {
        image.dataset.loaded = '1';
        image.classList.remove('is-loading');
      }, { signal: eventController.signal });

      syncView();

      return {
        dom,
        update(updatedNode: PMNode) {
          if (updatedNode.type.name !== 'image') {
            return false;
          }

          node = updatedNode;
          syncView();
          return true;
        },
        stopEvent(event: Event) {
          return event.target instanceof Node && sourceText.contains(event.target);
        },
        ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }) {
          return (
            mutation.target instanceof Node &&
            (mutation.target === dom ||
              sourceText.contains(mutation.target) ||
              image.contains(mutation.target))
          );
        },
        destroy() {
          // 清理所有事件监听器，防止内存泄漏
          eventController.abort();
        },
      };
    };
  },
}).configure({
  inline: true,
  allowBase64: true,
  HTMLAttributes: {
    class: 'mk-image',
    loading: 'lazy',
  },
});
