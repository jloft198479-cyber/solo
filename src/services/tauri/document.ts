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

export interface DocumentImageResolveResult {
  absolutePath: string;
}

export interface ImageAssetAuthorizationResult {
  path: string;
}

export async function openDocument(path: string) {
  return invokeCommand<DocumentOpenResult>(TAURI_COMMANDS.openDocument, { path });
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

export async function resolveDocumentImagePath(documentPath: string, relativePath: string) {
  return invokeCommand<DocumentImageResolveResult>(TAURI_COMMANDS.resolveDocumentImagePath, {
    documentPath,
    relativePath,
  });
}

export async function authorizeImageAsset(path: string) {
  return invokeCommand<ImageAssetAuthorizationResult>(TAURI_COMMANDS.authorizeImageAsset, { path });
}

export async function resolveStorageImagePath(storageDir: string, filename: string) {
  return invokeCommand<DocumentImageResolveResult>(TAURI_COMMANDS.resolveStorageImagePath, {
    storageDir,
    filename,
  });
}

export async function fetchRemoteImageData(url: string) {
  return invokeCommand<string>(TAURI_COMMANDS.fetchRemoteImage, { url });
}

export async function fetchFontData(url: string, family: string) {
  return invokeCommand<string>(TAURI_COMMANDS.fetchFontData, { url, family });
}

export async function getCachedFontPath(family: string) {
  return invokeCommand<string | null>(TAURI_COMMANDS.getCachedFontPath, { family });
}

export async function saveCachedFont(family: string, data: number[]) {
  return invokeCommand<void>(TAURI_COMMANDS.saveCachedFont, { family, data });
}
