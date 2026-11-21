import { invokeCommand } from './client';
import { TAURI_COMMANDS } from './command-names';

/**
 * 原文件的编码族。三分而非「有没有 BOM」：Rust 侧会把 UTF-16 解码成普通字符串，
 * 只按 bool 回写 UTF-8 BOM 会让 UTF-16 另存的 .md 静默换族。
 */
export type TextEncoding = 'utf8' | 'utf8Bom' | 'utf16';

/** 换行方式（`lineEnding` 与 Rust 的 `LineEnding` 一一对应）。 */
export type LineEnding = 'lf' | 'crlf' | 'cr';

/**
 * 磁盘原文的「排版习惯」。编辑器内部恒为 `\n` 无 BOM，这些信息只能靠它保存时还原。
 * 见 docs/PROPOSAL-file-fidelity.md §2.1。
 */
export interface DocumentLayout {
  encoding: TextEncoding;
  /** 主导换行；混合换行文件保存时统一为它 */
  ending: LineEnding;
  /** 两种及以上换行并存（仅作诊断，保存时不逐行保留） */
  mixed: boolean;
}

export interface DocumentOpenResult {
  path: string;
  content: string;
  lastModifiedMs: number;
  layout: DocumentLayout;
}

export interface DocumentSaveResult {
  path: string;
  lastModifiedMs: number;
}

export interface DocumentRenameResult {
  path: string;
}

export interface DocumentImageImportResult {
  relativePath: string;
  absolutePath: string;
}

export interface ImageAssetAuthorizationResult {
  path: string;
}

export async function openDocument(path: string) {
  return invokeCommand<DocumentOpenResult>(TAURI_COMMANDS.openDocument, { path });
}

export async function getFileMtime(path: string) {
  return invokeCommand<number>(TAURI_COMMANDS.getFileMtime, { path });
}

export interface MarkdownFileList {
  /** 相对当前文档所在目录的路径（`/` 分隔，如 `sub/B.md`），浅层优先 */
  files: string[];
  /**
   * 清单是否可能不完整（凑满文件上限 / 触到目录预算）。
   * **正确性必需**：清单不完整时前端不能断言「某个链接指向的文件不存在」——
   * 那会误标红（实测 602 文件的目录里 `[[zzz]]` 曾被误标成死链）。
   */
  truncated: boolean;
}

/**
 * 互链 `[[` 补全候选：当前文档所在目录**及其下若干层子目录**的 .md，返回**相对路径**。
 * Rust 侧已按「浅层优先 + 名字」排序、凑满上限即停；排除当前文档自身由前端过滤。
 */
export async function listMarkdownFiles(path: string) {
  return invokeCommand<MarkdownFileList>(TAURI_COMMANDS.listMarkdownFiles, { path });
}

/**
 * 保存文档。`layout` 是打开时记下的排版习惯（BOM / 换行）——
 * 不传 = 历史行为（UTF-8 无 BOM、LF），新建文档与不理解布局的调用方走这条。
 */
export async function saveDocument(
  path: string,
  content: string,
  expectedLastModifiedMs?: number | null,
  force = false,
  layout?: DocumentLayout | null,
) {
  return invokeCommand<DocumentSaveResult>(TAURI_COMMANDS.saveDocument, {
    path,
    content,
    expectedLastModifiedMs,
    force,
    layout: layout ?? null,
  });
}

/**
 * 在系统文件管理器中定位当前文档（选中该文件）。
 * 未保存的新文档没有路径，调用方应先置灰按钮，不要拿空串调这里。
 */
export async function revealDocumentInFolder(path: string) {
  return invokeCommand<void>(TAURI_COMMANDS.revealDocumentInFolder, { path });
}

export async function renameFile(oldPath: string, newName: string) {
  return invokeCommand<DocumentRenameResult>(TAURI_COMMANDS.renameFile, { oldPath, newName });
}

/**
 * 改名后同步「指向本文档」的互链：原子改写**引用方所在目录**（改名文档的本层 + 向上两层，
 * 与 `[[` 补全同一深度）里指向本篇的目标段，返回**被改动文件的绝对路径**。
 * 路径解析全在 Rust 侧，前端只递旧/新路径。**没有预览模式**——改名即同步，不再询问
 * （问一次用户错过/答「先不动」就永久不同步，界面还不提示，2026-10-20 实测踩过）。
 */
export async function syncWikilinksOnRename(oldPath: string, newPath: string) {
  return invokeCommand<string[]>(TAURI_COMMANDS.syncWikilinksOnRename, {
    oldPath,
    newPath,
  });
}

export async function importDocumentImage(sourcePath: string, documentPath: string, storageDir?: string) {
  return invokeCommand<DocumentImageImportResult>(TAURI_COMMANDS.importDocumentImage, {
    sourcePath,
    documentPath,
    storageDir: storageDir ?? null,
  });
}

export async function saveClipboardImage(dataUrl: string, documentPath?: string, storageDir?: string) {
  return invokeCommand<DocumentImageImportResult>(TAURI_COMMANDS.saveClipboardImage, {
    dataUrl,
    documentPath: documentPath ?? null,
    storageDir: storageDir ?? null,
  });
}

export async function authorizeImageAsset(path: string, documentPath?: string) {
  return invokeCommand<ImageAssetAuthorizationResult>(TAURI_COMMANDS.authorizeImageAsset, {
    path,
    documentPath: documentPath ?? null,
  });
}

/**
 * 合并版本：传入 src（相对/绝对/storage 下文件名）+ 可选 documentPath / storageDir，
 * Rust 侧统一判别路径 + authorize，返回 canonical path。
 * 前端再调 `toAssetUrl()` 转为 `asset://` URL。
 */
export async function resolveImageDisplay(
  src: string,
  documentPath?: string | null,
  storageDir?: string | null,
) {
  return invokeCommand<ImageAssetAuthorizationResult>(TAURI_COMMANDS.resolveImageDisplay, {
    src,
    documentPath: documentPath ?? null,
    storageDir: storageDir ?? null,
  });
}

export async function fetchRemoteImageData(url: string) {
  return invokeCommand<string>(TAURI_COMMANDS.fetchRemoteImage, { url });
}

