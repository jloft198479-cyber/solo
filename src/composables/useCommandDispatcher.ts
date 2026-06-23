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
  isSourceMode: Ref<boolean>;
  handleNew: () => void | Promise<void>;
  handleOpen: () => void | Promise<void>;
  handleSave: () => void | Promise<void> | Promise<boolean> | boolean;
  handleSaveAs: () => void | Promise<void> | Promise<boolean> | boolean;
  exportHtml: () => void | Promise<void>;
  exportPdf: () => void | Promise<void>;
  copyToWechat: () => void | Promise<void>;
  openSettings: () => void;
  openShortcuts: () => void;
  toggleFocusMode: () => void | Promise<void>;
  showAbout: () => void | Promise<void>;
  toggleFullscreen: () => void | Promise<void>;
  handleQuit: () => void | Promise<void>;
}

export function useCommandDispatcher(options: CommandDispatcherOptions) {
  const {
    editorRef,
    activeViewMode,
    isSourceMode,
  } = options;

  function canRunEditorShortcut() {
    if (activeViewMode.value !== 'editor' || isSourceMode.value) {
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
      case 'export.html':
        await options.exportHtml();
        return true;
      case 'export.pdf':
        await options.exportPdf();
        return true;
      case 'export.wechat':
        await options.copyToWechat();
        return true;
      case 'edit.find':
        if (activeViewMode.value === 'editor' && !isSourceMode.value) {
          editorRef.value?.openSearch?.(false);
          return true;
        }
        return false;
      case 'edit.replace':
        if (activeViewMode.value === 'editor' && !isSourceMode.value) {
          editorRef.value?.openSearch?.(true);
          return true;
        }
        return false;
      case 'view.focusMode':
        await options.toggleFocusMode();
        return true;
      case 'view.fullscreen':
        await options.toggleFullscreen();
        return true;
      case 'settings.open':
        options.openSettings();
        return true;
      case 'help.shortcuts':
        options.openShortcuts();
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
