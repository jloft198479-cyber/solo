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
}

export function formatImageMarkdown(attrs: ImageMarkdownAttrs): string {
  const alt = attrs.alt || '';
  const src = attrs.src || '';
  const title = attrs.title?.replace(/"/g, '\\"') ?? '';

  if (title) {
    return `![${alt}](${src} "${title}")`;
  }

  return `![${alt}](${src})`;
}

export function parseImageMarkdown(markdown: string): ImageMarkdownAttrs | null {
  const value = markdown.trim();
  const match = value.match(/^!\[(?<alt>[^\]]*)\]\((?<body>.*?)\)$/);

  if (!match?.groups) {
    return null;
  }

  const alt = match.groups.alt ?? '';
  const body = match.groups.body.trim();
  const titleMatch = body.match(/^(?<src>.+?)(?:\s+"(?<title>(?:[^"\\]|\\.)*)")?$/);

  if (!titleMatch?.groups?.src) {
    return null;
  }

  const src = titleMatch.groups.src.trim();
  if (!src) {
    return null;
  }

  return {
    src,
    alt,
    title: titleMatch.groups.title == null ? null : titleMatch.groups.title.replace(/\\"/g, '"'),
  };
}

type RemoteImageFetcher = (src: string) => Promise<string>;
type RemoteImageCacheEntry =
  | { status: 'fulfilled'; value: string }
  | { status: 'pending'; promise: Promise<string> }
  | { status: 'failed'; expiresAt: number };

const MAX_REMOTE_IMAGE_CACHE_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_CONCURRENT_REMOTE_IMAGE_FETCHES = 4;
const REMOTE_IMAGE_FAILURE_TTL_MS = 5 * 60 * 1000;
const remoteImageCache = new Map<string, RemoteImageCacheEntry>();
const remoteImageQueue: Array<() => void> = [];

/** 追踪 fulfilled 条目对应的 Blob URL 及其字节大小，用于缓存淘汰和释放 */
const blobUrlRegistry = new Map<string, { url: string; size: number }>(); // originalSrc → { url, size }

/**
 * 将 base64 data URL 转换为 Blob URL，避免大字符串常驻内存。
 * Blob URL 是轻量引用，浏览器内核管理底层 Blob 内存更高效。
 * 调用方在缓存淘汰时须通过 revokeBlobUrl() 释放。
 */
function dataUrlToBlobUrl(dataUrl: string): { url: string; size: number } {
  // 非 data URL 直接返回原值（如 asset:// 协议）
  if (!dataUrl.startsWith('data:')) return { url: dataUrl, size: 0 };

  try {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return { url: dataUrl, size: 0 };

    const contentType = match[1];
    const base64 = match[2];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: contentType });
    return { url: URL.createObjectURL(blob), size: blob.size };
  } catch {
    return { url: dataUrl, size: 0 };
  }
}

function revokeBlobUrl(originalSrc: string) {
  const entry = blobUrlRegistry.get(originalSrc);
  if (entry) {
    URL.revokeObjectURL(entry.url);
    blobUrlRegistry.delete(originalSrc);
  }
}

let activeRemoteImageFetches = 0;
let remoteImageFetcher: RemoteImageFetcher | null = null;

function isRemoteImageSrc(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

function touchRemoteImageCacheEntry(src: string, entry: RemoteImageCacheEntry) {
  remoteImageCache.delete(src);
  remoteImageCache.set(src, entry);
}

/** 计算当前缓存总字节数 */
function totalCachedBytes(): number {
  let total = 0;
  for (const { size } of blobUrlRegistry.values()) {
    total += size;
  }
  return total;
}

/** 按字节预算 + 后进先出淘汰。pending 条目不计入预算。 */
function trimRemoteImageCache() {
  let budget = totalCachedBytes();
  while (budget > MAX_REMOTE_IMAGE_CACHE_BYTES) {
    let removableKey: string | null = null;
    for (const [src, entry] of remoteImageCache) {
      if (entry.status !== 'pending') {
        removableKey = src;
        break;
      }
    }
    if (!removableKey) break;
    budget -= blobUrlRegistry.get(removableKey)?.size ?? 0;
    remoteImageCache.delete(removableKey);
    revokeBlobUrl(removableKey);
  }
}

/** 释放所有远程图片 Blob 缓存。编辑器销毁时调用，防止残留 Blob 占用内存。 */
export function releaseRemoteImageBlobs() {
  for (const src of remoteImageCache.keys()) {
    revokeBlobUrl(src);
  }
  remoteImageCache.clear();
  remoteImageQueue.length = 0;
  activeRemoteImageFetches = 0;
}

export function releaseRemoteImageBlobsForTests() {
  releaseRemoteImageBlobs();
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
    return fetchRemoteImageData(src);
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
      // 将 base64 data URL 转为 Blob URL，避免大字符串常驻内存
      const { url: blobUrl, size } = dataUrlToBlobUrl(displaySrc);
      if (blobUrl !== displaySrc) {
        blobUrlRegistry.set(src, { url: blobUrl, size });
      }
      touchRemoteImageCacheEntry(src, { status: 'fulfilled', value: blobUrl });
      trimRemoteImageCache();
      return blobUrl;
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
  // 释放所有 Blob URL
  for (const { url } of blobUrlRegistry.values()) {
    URL.revokeObjectURL(url);
  }
  blobUrlRegistry.clear();
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
  } catch { return null; }
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
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('span');
      dom.className = 'mk-image-shell';
      dom.draggable = false;

      const image = document.createElement('img');
      image.className = 'mk-image';
      image.loading = 'lazy';
      image.draggable = false;
      dom.appendChild(image);

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

        if (isRemoteImageSrc(attrs.src)) {
          if (image.dataset.prevRemoteSrc === attrs.src) return;
          image.dataset.prevRemoteSrc = attrs.src;
          const requestId = ++displayRequestId;
          void getRemoteImageDisplaySrc(attrs.src).then((displaySrc) => {
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
            if (requestId !== displayRequestId) return;
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
          parsed.src === current.src
          && parsed.alt === current.alt
          && parsed.title === current.title
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
      });

      sourceText.addEventListener('mousedown', (event) => {
        event.stopPropagation();
      });

      sourceText.addEventListener('focus', () => {
        isEditing = true;
        dom.classList.add('is-editing');
        dom.classList.remove('is-invalid');
      });

      sourceText.addEventListener('blur', () => {
        commit();
      });

      sourceText.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          commit();
          editor.commands.focus();
          return;
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
          editor.commands.focus();
        }
      });

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
      });

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
            mutation.target instanceof Node
            && (
              mutation.target === dom
              || sourceText.contains(mutation.target)
              || image.contains(mutation.target)
            )
          );
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
