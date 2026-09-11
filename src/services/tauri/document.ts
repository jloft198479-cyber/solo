import { invokeCommand } from './client';
import { TAURI_COMMANDS } from './command-names';

export interface DocumentOpenResult {
  path: string;
  content: string;
  lastModifiedMs: number;
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

/**
 * 互链 `[[` 补全候选：当前文档同目录下的 .md 文件名列表
 * （Rust 侧已排序、截断 500；排除当前文档自身由前端过滤）。
 */
export async function listMarkdownFiles(path: string) {
  return invokeCommand<string[]>(TAURI_COMMANDS.listMarkdownFiles, { path });
}

export async function saveDocument(
  path: string,
  content: string,
  expectedLastModifiedMs?: number | null,
  force = false,
) {
  return invokeCommand<DocumentSaveResult>(TAURI_COMMANDS.saveDocument, {
    path,
    content,
    expectedLastModifiedMs,
    force,
  });
}

export async function renameFile(oldPath: string, newName: string) {
  return invokeCommand<DocumentRenameResult>(TAURI_COMMANDS.renameFile, { oldPath, newName });
}

/**
 * 改名后同步「指向本文档」的互链。
 * dryRun=true 只读预览、返回将被改动的同目录文件名（供先列清单让用户确认）；
 * dryRun=false 真正原子改写并返回已改动的文件名。路径解析全在 Rust 侧，前端只递旧/新路径。
 */
export async function syncWikilinksOnRename(oldPath: string, newPath: string, dryRun: boolean) {
  return invokeCommand<string[]>(TAURI_COMMANDS.syncWikilinksOnRename, {
    oldPath,
    newPath,
    dryRun,
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

