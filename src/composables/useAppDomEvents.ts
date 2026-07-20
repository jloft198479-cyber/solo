import type { Ref } from 'vue';
import { onMounted, onUnmounted } from 'vue';
import type { CommandDefinition } from '../commands/registry';
import { eventToKeyString } from '../commands/registry';

export interface AppDomEventsOptions {
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
  toggleOutline: () => void;
  toggleCommandPalette: () => void;
  showImagePasteWarning: (message: string) => void;
  resetViewMode?: () => void;
}

export function useAppDomEvents(options: AppDomEventsOptions) {
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

    // 大纲开合：Ctrl+/（Mod-/）。独立于命令注册表，固定快捷键。
    if (eventToKeyString(event) === 'Mod-/') {
      event.preventDefault();
      options.toggleOutline();
      return;
    }

    // 命令面板唤起：Ctrl+K（Mod-k）。固定快捷键。
    if (eventToKeyString(event) === 'Mod-k') {
      event.preventDefault();
      options.toggleCommandPalette();
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
        event.preventDefault();
        options.clearFullscreenPreview();
      } else if (options.activeViewMode.value === 'image' && options.resetViewMode) {
        event.preventDefault();
        options.resetViewMode();
      } else if (options.isFocusMode()) {
        event.preventDefault();
        await options.toggleFocusMode();
      }
    }
  }

  onMounted(() => {
    document.addEventListener('paste', onPaste);
    window.addEventListener('image-paste-warning', handleImagePasteWarning as EventListener);
    window.addEventListener('keydown', handleKeyDown);
  });

  onUnmounted(() => {
    document.removeEventListener('paste', onPaste);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('image-paste-warning', handleImagePasteWarning as EventListener);
  });

  return {
    handleKeyDown,
  };
}
