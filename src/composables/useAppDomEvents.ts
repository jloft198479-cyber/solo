import type { Ref } from 'vue';
import { onMounted, onUnmounted } from 'vue';
import type { CommandDefinition } from '../commands/registry';

export interface AppDomEditorApi {
  getEditorView?: () => { hasFocus: () => boolean } | null;
  getSelectionMarkdown?: () => string;
}

export interface AppDomEventsOptions {
  editorRef: Ref<AppDomEditorApi | null>;
  activeViewMode: Ref<'editor' | 'image'>;
  isFullscreenPreview: Ref<boolean>;
  isFocusMode: () => boolean;
  customShortcuts: () => Record<string, string>;
  findCommandByShortcut: (
    event: KeyboardEvent,
    customShortcuts: Record<string, string>,
  ) => CommandDefinition | undefined;
  executeCommand: (commandId: string, source: 'shortcut') => Promise<boolean>;
  clearFullscreenPreview: () => void;
  toggleFocusMode: () => void | Promise<void>;
  showImagePasteWarning: (message: string) => void;
  resetViewMode?: () => void;
}

export function useAppDomEvents(options: AppDomEventsOptions) {
  function onCopy(event: ClipboardEvent) {
    if (
      !options.editorRef.value ||
      options.activeViewMode.value !== 'editor'
    ) {
      return;
    }

    const view = options.editorRef.value.getEditorView?.();
    if (!view || !view.hasFocus()) return;
    const markdown = options.editorRef.value.getSelectionMarkdown?.() || '';
    if (!markdown) return;
    event.clipboardData?.setData('text/plain', markdown);
    event.preventDefault();
  }

  function onPaste(event: ClipboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.tiptap-editor')) return;

    const items = event.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        options.showImagePasteWarning('暂不支持直接粘贴图片，请使用拖拽或工具栏插入图片。');
        event.preventDefault();
        return;
      }
    }
  }

  const handleImagePasteWarning = (event: Event) => {
    const detail = (event as CustomEvent).detail as string | undefined;
    if (detail) {
      options.showImagePasteWarning(detail);
    }
  };

  async function handleKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-shortcut-capture="true"]')) {
      return;
    }

    const command = options.findCommandByShortcut(event, options.customShortcuts());
    if (command) {
      // 编辑器内置快捷键由 ProseMirror 处理，跳过避免重复触发
      // 但用户自定义的编辑器快捷键（与默认不同）需要放行
      if (
        target?.closest('.tiptap-editor') &&
        command.scope === 'editor' &&
        !options.customShortcuts()[command.id]
      ) {
        return;
      }

      const handled = await options.executeCommand(command.id, 'shortcut');
      if (handled) {
        event.preventDefault();
        return;
      }
    }

    if (event.key === 'Escape') {
      if (options.isFullscreenPreview.value) {
        options.clearFullscreenPreview();
      } else if (options.activeViewMode.value === 'image' && options.resetViewMode) {
        options.resetViewMode();
      } else if (options.isFocusMode()) {
        await options.toggleFocusMode();
      }
    }
  }

  onMounted(() => {
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    window.addEventListener('image-paste-warning', handleImagePasteWarning as EventListener);
    window.addEventListener('keydown', handleKeyDown);
  });

  onUnmounted(() => {
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('paste', onPaste);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('image-paste-warning', handleImagePasteWarning as EventListener);
  });

  return {
    handleKeyDown,
    onCopy,
  };
}
