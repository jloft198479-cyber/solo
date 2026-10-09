import type { Ref } from 'vue';
import type { CommandSource } from '../commands/registry';
import { getCommand } from '../commands/registry';
import { revealStartupOpenLog } from '../services/tauri/window';

type ViewMode = 'editor' | 'image';

export interface EditorCommandApi {
  executeCommand?: (commandId: string) => boolean;
  hasFocus?: () => boolean;
  openSearch?: (showReplace?: boolean) => void;
}

export interface CommandDispatcherOptions {
  editorRef: Ref<EditorCommandApi | null>;
  activeViewMode: Ref<ViewMode>;
  handleNew: () => void | Promise<void>;
  handleOpen: () => void | Promise<void>;
  handleSave: () => void | Promise<void> | Promise<boolean> | boolean;
  handleSaveAs: () => void | Promise<void> | Promise<boolean> | boolean;
  openSettings: () => void;
  toggleFocusMode: () => void | Promise<void>;
  showAbout: () => void | Promise<void>;
  toggleFullscreen: () => void | Promise<void>;
  toggleOutline: () => void;
  toggleCommandPalette: () => void;
  handleQuit: () => void | Promise<void>;
}

export function useCommandDispatcher(options: CommandDispatcherOptions) {
  const {
    editorRef,
    activeViewMode,
  } = options;

  function canRunEditorShortcut() {
    if (activeViewMode.value !== 'editor') {
      return false;
    }
    return editorRef.value?.hasFocus?.() ?? false;
  }

  async function executeCommand(commandId: string, source: CommandSource = 'menu'): Promise<boolean> {
    const command = getCommand(commandId);
    if (!command) {
      return false;
    }

    if (command.scope === 'editor') {
      if (source === 'shortcut' && !canRunEditorShortcut()) {
        return false;
      }
      return editorRef.value?.executeCommand?.(commandId) ?? false;
    }

    switch (commandId) {
      case 'file.new':
        await options.handleNew();
        return true;
      case 'file.open':
        await options.handleOpen();
        return true;
      case 'file.save':
        await options.handleSave();
        return true;
      case 'file.saveAs':
        await options.handleSaveAs();
        return true;
      case 'edit.find':
        if (activeViewMode.value === 'editor') {
          editorRef.value?.openSearch?.(false);
          return true;
        }
        return false;
      case 'edit.replace':
        if (activeViewMode.value === 'editor') {
          editorRef.value?.openSearch?.(true);
          return true;
        }
        return false;
      case 'edit.copyAsMarkdown':
        if (activeViewMode.value === 'editor') {
          return editorRef.value?.executeCommand?.('edit.copyAsMarkdown') ?? false;
        }
        return false;
      case 'list.moveItemUp':
      case 'list.moveItemDown':
        // 同 edit.copyAsMarkdown：app 作用域 + 转发给编辑器执行。
        // 快捷键路径额外要求编辑器真的持有焦点（口径同 canRunEditorShortcut）——
        // 否则用户在侧栏 / 大纲里按 Alt+↑ 会「看不见地」挪动正文，属隐蔽副作用。
        // 命令面板是显式动作，不设此门（选中即执行，随后焦点交还编辑器）。
        if (activeViewMode.value !== 'editor') return false;
        if (source === 'shortcut' && !(editorRef.value?.hasFocus?.() ?? false)) return false;
        return editorRef.value?.executeCommand?.(commandId) ?? false;
      case 'view.focusMode':
        await options.toggleFocusMode();
        return true;
      case 'view.fullscreen':
        await options.toggleFullscreen();
        return true;
      case 'view.toggleOutline':
        options.toggleOutline();
        return true;
      case 'view.commandPalette':
        options.toggleCommandPalette();
        return true;
      case 'settings.open':
        options.openSettings();
        return true;
      case 'help.about':
        await options.showAbout();
        return true;
      case 'help.diagnostics':
        await revealStartupOpenLog();
        return true;
      case 'app.quit':
        await options.handleQuit();
        return true;
      default:
        return false;
    }
  }

  return {
    executeCommand,
  };
}
