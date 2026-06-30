import type { Ref } from 'vue';
import type { Node as PMNode } from '@tiptap/pm/model';
import { writeHtml } from '../services/tauri/clipboard';
import { message, save } from '../services/tauri/dialog';
import { saveDocument, resolveDocumentImagePath } from '../services/tauri/document';
import { printDocument } from '../services/tauri/window';
import { toAssetUrl } from '../services/tauri/asset';
import {
  renderEditorDocToHtmlDocument,
  renderEditorDocToWechatFragment,
} from '../utils/export-renderer';
import { getExportThemeTokensFromAppTheme } from '../utils/export/theme';

type EditorRefValue = {
  getContent?: () => string;
  getDoc?: () => PMNode | null;
};
type EditorRef = Ref<EditorRefValue | null>;
type ViewModeRef = Ref<'editor' | 'image'>;

type FileStoreLike = {
  currentFile: {
    path: string | null;
    content: string;
  };
};

type SettingsStoreLike = {
  settings: {
    activeThemeId: string;
    fontFamily: string;
    fontSize: number | null;
  };
};

function isLocalPath(src: string): boolean {
  // asset:// 也是本地图片，需要转 base64（否则导出后不可用）
  return !/^(https?:\/\/|data:|blob:)/i.test(src);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function findImageSrcs(doc: PMNode): string[] {
  const srcs: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'image') srcs.push(node.attrs.src as string);
  });
  return srcs;
}

async function localImageToBase64(src: string, docPath: string | null): Promise<string | null> {
  try {
    // asset:// 协议可直接 fetch，无需路径解析
    if (src.startsWith('asset://')) {
      const resp = await fetch(src);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return `data:${blob.type};base64,${await blobToBase64(blob)}`;
    }

    let absolutePath = src;
    if (!/^file:/i.test(src) && !/^[A-Z]:\\/i.test(src) && docPath) {
      const resolved = await resolveDocumentImagePath(docPath, src);
      absolutePath = resolved.absolutePath;
    }
    const assetUrl = toAssetUrl(absolutePath);
    const resp = await fetch(assetUrl);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const b64 = await blobToBase64(blob);
    return `data:${blob.type};base64,${b64}`;
  } catch {
    return null;
  }
}

/**
 * 扫描文档中的本地图片并转换为 base64 data URL。
 * 返回 src → base64 的映射表。HTML/微信/PDF 三条导出链路共享此逻辑。
 * 映射表通过 imageMap 参数传入渲染器，在 IR 渲染阶段直接替换 src，
 * 避免 HTML 字符串后替换的子串匹配风险（C2）。
 */
async function resolveLocalImages(
  doc: PMNode,
  docPath: string | null,
): Promise<Map<string, string>> {
  const localSrcs = findImageSrcs(doc).filter(isLocalPath);
  if (localSrcs.length === 0) return new Map();

  const urlMap = new Map<string, string>();
  const results = await Promise.allSettled(
    localSrcs.map((src) => localImageToBase64(src, docPath).then((b64) => ({ src, b64 }))),
  );
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.b64) {
      urlMap.set(r.value.src, r.value.b64);
    }
  }
  return urlMap;
}

export function useExportActions(options: {
  editorRef: EditorRef;
  activeViewMode: ViewModeRef;
  fileStore: FileStoreLike;
  settingsStore: SettingsStoreLike;
}) {
  const { editorRef, activeViewMode, fileStore, settingsStore } = options;

  function getEditorDoc(): PMNode | null {
    if (!editorRef.value || typeof editorRef.value.getDoc !== 'function') {
      return null;
    }

    return editorRef.value.getDoc();
  }

  function getMarkdown(): string {
    if (!editorRef.value) return fileStore.currentFile.content || '';
    if (typeof editorRef.value.getContent === 'function') {
      return editorRef.value.getContent() || '';
    }
    return fileStore.currentFile.content || '';
  }

  async function exportHtml() {
    if (!editorRef.value || activeViewMode.value !== 'editor') return;
    const doc = getEditorDoc();
    if (!doc) return;

    const docPath = fileStore.currentFile.path;
    const imageMap = await resolveLocalImages(doc, docPath);

    const html = await renderEditorDocToHtmlDocument(doc, {
      themeId: settingsStore.settings.activeThemeId,
      fontFamily: settingsStore.settings.fontFamily,
      fontSize: settingsStore.settings.fontSize ?? undefined,
      fileName:
        fileStore.currentFile.path?.split(/[/\\]/).pop()?.replace(/\.md$/i, '') ?? 'document',
      imageMap,
    });

    const baseName =
      fileStore.currentFile.path?.split(/[/\\]/).pop()?.replace(/\.md$/, '') || 'document';
    const selected = await save({
      title: '导出为 HTML',
      defaultPath: `${baseName}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (!selected) return;
    try {
      await saveDocument(selected, html, null, true);
    } catch (error) {
      await message(`HTML 导出失败: ${error}`, { title: '错误', kind: 'error' });
    }
  }

  async function exportPdf() {
    if (!editorRef.value || activeViewMode.value !== 'editor') return;
    const doc = getEditorDoc();
    if (!doc) return;

    const docPath = fileStore.currentFile.path;
    const imageMap = await resolveLocalImages(doc, docPath);

    const html = await renderEditorDocToHtmlDocument(doc, {
      themeId: settingsStore.settings.activeThemeId,
      fontFamily: settingsStore.settings.fontFamily,
      fontSize: settingsStore.settings.fontSize ?? undefined,
      fileName:
        fileStore.currentFile.path?.split(/[/\\]/).pop()?.replace(/\.md$/i, '') ?? 'document',
      imageMap,
    });

    // 通过隐藏 iframe 加载 HTML 并调用原生打印
    try {
      await printHtmlViaIframe(html);
    } catch {
      // iframe 打印失败时回退到原生 window.print()
      try {
        await printDocument();
      } catch (fallbackError) {
        await message(`PDF 导出失败: ${fallbackError}`, { title: '错误', kind: 'error' });
      }
    }
  }

  async function copyToWechat() {
    if (!editorRef.value || activeViewMode.value !== 'editor') return;
    const doc = getEditorDoc();
    if (!doc) return;

    const docPath = fileStore.currentFile.path;
    const imageMap = await resolveLocalImages(doc, docPath);

    const result = renderEditorDocToWechatFragment(doc, {
      tokens: getExportThemeTokensFromAppTheme(settingsStore.settings.activeThemeId),
      fontFamily: settingsStore.settings.fontFamily,
      fontSize: settingsStore.settings.fontSize ?? undefined,
      imageMap,
    });

    try {
      await writeHtml(result.html, result.text || getMarkdown());
      await message('已转换并复制到剪贴板', { title: '完成', kind: 'info' });
    } catch {
      await message('复制失败', { title: '错误', kind: 'error' });
    }
  }

  return {
    exportHtml,
    exportPdf,
    copyToWechat,
  };
}

/**
 * 通过隐藏 iframe 加载完整 HTML 文档并调用打印。
 * 确保打印的是渲染后的文档（含主题样式、KaTeX、Mermaid），
 * 而非编辑器视图（含工具栏、光标等 UI 元素）。
 */
function printHtmlViaIframe(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.opacity = '0';
    iframe.setAttribute('aria-hidden', 'true');

    let resolved = false;

    const cleanup = () => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    };

    const onTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error('打印超时'));
      }
    }, 30000);

    iframe.onload = () => {
      if (resolved) return;
      try {
        const iframeWindow = iframe.contentWindow;
        if (!iframeWindow) {
          resolved = true;
          clearTimeout(onTimeout);
          cleanup();
          reject(new Error('无法访问 iframe 内容'));
          return;
        }

        const tryPrint = () => {
          if (resolved) return;
          const ready = iframeWindow.document.readyState;
          if (ready === 'complete') {
            resolved = true;
            clearTimeout(onTimeout);
            iframeWindow.focus();
            iframeWindow.print();
            setTimeout(() => {
              cleanup();
              resolve();
            }, 500);
          } else {
            setTimeout(tryPrint, 100);
          }
        };

        setTimeout(tryPrint, 200);
      } catch (err) {
        resolved = true;
        clearTimeout(onTimeout);
        cleanup();
        reject(err);
      }
    };

    iframe.onerror = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(onTimeout);
        cleanup();
        reject(new Error('iframe 加载失败'));
      }
    };

    document.body.appendChild(iframe);
    iframe.srcdoc = html;
  });
}
