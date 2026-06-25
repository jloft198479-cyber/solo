export const TAURI_COMMANDS = {
  authorizeImageAsset: 'authorize_image_asset',
  consumeStartupOpenRequest: 'consume_startup_open_request',
  fetchFontData: 'fetch_font_data',
  fetchRemoteImage: 'fetch_remote_image',
  importDocumentImage: 'import_document_image',
  notifyFrontendReady: 'notify_frontend_ready',
  openDocument: 'open_document',
  printDocument: 'print_document',
  refreshNativeMenuShortcuts: 'refresh_native_menu_shortcuts',
  registerShellNew: 'register_shell_new',
  resolveDocumentImagePath: 'resolve_document_image_path',
  revealInFinder: 'reveal_in_finder',
  revealStartupOpenLog: 'reveal_startup_open_log',
  saveDocument: 'save_document',
  setWindowBackgroundColor: 'set_window_background_color',
  unregisterShellNew: 'unregister_shell_new',
} as const;

export type TauriCommandName = (typeof TAURI_COMMANDS)[keyof typeof TAURI_COMMANDS];
