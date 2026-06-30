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
import { escapeAttribute } from '../utils/export/utils';

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
    fontSize: number;
  };
};

function isLocalPath(src: string): boolean {
  return !/^(https?:\/\/|data:|blob:|asset:\/\/)/i.test(src);
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
    const html = await renderEditorDocToHtmlDocument(doc, {
      // HTML 导出使用当前编辑器主题，而非微信主题
      themeId: settingsStore.settings.activeThemeId,
      fontFamily: settingsStore.settings.fontFamily,
      fontSize: settingsStore.settings.fontSize,
      fileName:
        fileStore.currentFile.path?.split(/[/\\]/).pop()?.replace(/\.md$/i, '') ?? 'document',
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
    if (activeViewMode.value !== 'editor') return;
    try {
      await printDocument();
    } catch (error) {
      await message(`PDF 导出失败: ${error}`, { title: '错误', kind: 'error' });
    }
  }

  async function copyToWechat() {
    if (!editorRef.value || activeViewMode.value !== 'editor') return;
    const doc = getEditorDoc();
    if (!doc) return;

    const docPath = fileStore.currentFile.path;

    // 扫描本地图片 → 转 base64
    const localSrcs = findImageSrcs(doc).filter(isLocalPath);
    const urlMap = new Map<string, string>();
    if (localSrcs.length > 0) {
      const results = await Promise.allSettled(
        localSrcs.map((src) => localImageToBase64(src, docPath).then((b64) => ({ src, b64 }))),
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.b64) {
          urlMap.set(r.value.src, r.value.b64);
        }
      }
    }

    const result = renderEditorDocToWechatFragment(doc, {
      tokens: getExportThemeTokensFromAppTheme(settingsStore.settings.activeThemeId),
      fontFamily: settingsStore.settings.fontFamily,
      fontSize: settingsStore.settings.fontSize,
    });

    let html = result.html;
    if (urlMap.size > 0) {
      for (const [oldSrc, newSrc] of urlMap) {
        html = html.split(`src="${escapeAttribute(oldSrc)}"`).join(`src="${newSrc}"`);
      }
    }

    try {
      await writeHtml(html, result.text || getMarkdown());
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
