import type { Ref } from 'vue';
import { onMounted, onUnmounted } from 'vue';
import type { CommandDefinition } from '../commands/registry';

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
        options.showImagePasteWarning('暂不支持直接粘贴图片，请将图片拖入编辑器插入。');
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

    // 全局快捷键统一查命令注册表（键位真理源：registry.ts）。
    // 不在此处硬编码键位——硬编码会与注册表形成「改一处漏一处」的漂移。
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
