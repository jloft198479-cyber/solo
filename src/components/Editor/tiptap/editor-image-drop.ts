import type { Editor as TiptapEditor } from '@tiptap/vue-3';

import { authorizeImageAsset, importDocumentImage } from '../../../services/tauri/document';
import { toAssetUrl } from '../../../services/tauri/asset';
import { confirm } from '../../../services/tauri/dialog';
import {
  subscribeDragDrop,
  type UnlistenFn,
} from '../../../services/tauri/webview';

interface EditorRef {
  value: TiptapEditor | null;
}

interface SetupEditorImageDropOptions {
  editor: EditorRef;
  getDocumentPath: () => string | null;
  getStoragePath: () => string | null;
}

const supportedImageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp']);

function isSupportedImagePath(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return supportedImageExtensions.has(ext);
}

export async function setupEditorImageDrop({
  editor,
  getDocumentPath,
  getStoragePath,
}: SetupEditorImageDropOptions): Promise<UnlistenFn | null> {
  try {
    return await subscribeDragDrop(async (payload) => {
      const paths = payload.paths;
      if (!paths?.length || !editor.value) return;

      const storagePath = getStoragePath();
      const documentPath = getDocumentPath();

      // 没有自定义路径且文档未保存 → 无法确定图片存放位置
      if (!storagePath && !documentPath) {
        await confirm(
          '请先保存文档，或设置图片存储位置，才能拖入图片。',
          { title: '拖入图片', kind: 'warning', okLabel: '我知道了' },
        );
        return;
      }

      for (const imagePath of paths) {
        if (!isSupportedImagePath(imagePath)) continue;

        try {
          const savedImage = await importDocumentImage(
            imagePath,
            documentPath || '',
            storagePath ?? undefined,
          );
          const ed = editor.value;
          if (!ed || ed.isDestroyed) continue;

          // 授权 → asset:// URL（自定义路径直接授权，assets/ 路径需 resolve）
          const imgAbsolutePath = savedImage.absolutePath;
          const authorized = await authorizeImageAsset(imgAbsolutePath);
          const assetUrl = toAssetUrl(authorized.path);

          // 用 ProseMirror API 插入图片（包在自己的段落里，作为独立 Block）
          const imgNode = ed.schema.nodes.image?.create({ src: assetUrl, alt: '' });
          if (!imgNode) continue;

          const paragraph = ed.schema.nodes.paragraph.create(null, imgNode);
          const tr = ed.state.tr.replaceSelectionWith(paragraph);
          ed.view.dispatch(tr);
        } catch (err) {
          console.error('Failed to handle dropped image:', err);
        }
      }
    });
  } catch (err) {
    console.error('Failed to setup drag-drop:', err);
    return null;
  }
}
