/**
 * 字体加载器
 *
 * 支持本地已安装字体、远程下载两种来源。
 * 下载进度通过 onProgress 回调通知 UI 组件。
 */

import { fetchFontData } from '../services/tauri/document';

const DOWNLOAD_BASE = 'https://github.com/jloft198479-cyber/solo/releases/download/v1.1.6';

const REMOTE_FONTS: Readonly<Record<string, string>> = {
  'Noto Serif SC': 'NotoSerifSC-Regular.otf',
  'Zhuque Fangsong': 'ZhuqueFangsong-Regular.ttf',
  'Xiaolai SC': 'XiaolaiSC-Regular.ttf',
  'LXGW WenKai': 'LXGWWenKai-Regular.ttf',
  'Huiwen-mincho': 'Huiwen-mincho-Regular.otf',
};

const FONT_MIME: Record<string, string> = {
  otf: 'font/otf',
  ttf: 'font/ttf',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

function mimeFromFileName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return FONT_MIME[ext] || 'font/otf';
}

const SYSTEM_FONTS = new Set(['system-ui', 'Microsoft YaHei UI']);

const loadedFonts = new Set<string>();
const downloadFailures = new Set<string>();
const loadingPromises = new Map<string, Promise<boolean>>();

/** 下载进度 0–100，-1 表示未开始/已完成 */
const downloadProgress = new Map<string, number>();

/** 进度监听器 */
type ProgressListener = (family: string, progress: number) => void;
const progressListeners = new Set<ProgressListener>();

export function onProgress(cb: ProgressListener): () => void {
  progressListeners.add(cb);
  return () => progressListeners.delete(cb);
}

function notifyProgress(family: string, progress: number) {
  downloadProgress.set(family, progress);
  for (const cb of progressListeners) cb(family, progress);
}

export function getDownloadProgress(family: string): number {
  return downloadProgress.get(family) ?? -1;
}

/** IndexedDB 缓存 */
const DB_NAME = 'solo-font-cache';
const DB_VERSION = 1;
const STORE_NAME = 'fonts';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function getCachedBlob(family: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(family);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function saveBlobCache(family: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, family);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* 静默 */ }
}

async function registerFont(family: string, url: string): Promise<boolean> {
  try {
    const fontFace = new FontFace(family, `url('${url}')`);
    await fontFace.load();
    document.fonts.add(fontFace);
    return true;
  } catch (e) {
    console.warn(`[fontLoader] FontFace.register failed: ${family}`, e);
    return false;
  }
}

/**
 * 通过前端 fetch API 下载，支持进度回调。
 * CSP 已配置 font-src: blob: https:，此路径应当正常工作。
 */
async function downloadWithProgress(
  url: string,
  mime: string,
  family: string,
): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const len = Number(res.headers.get('content-length') ?? 0);
  const reader = res.body!.getReader();

  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (len > 0) {
      notifyProgress(family, Math.round((received / len) * 100));
    }
  }

  return new Blob(chunks as BlobPart[], { type: mime });
}

export async function ensureFontLoaded(family: string): Promise<boolean> {
  if (SYSTEM_FONTS.has(family)) return true;
  if (loadedFonts.has(family)) return true;

  const existing = loadingPromises.get(family);
  if (existing) return existing;

  const promise = (async () => {
    try {
      downloadFailures.delete(family);
      const fileName = REMOTE_FONTS[family];
      if (!fileName) { loadedFonts.add(family); return true; }

      // 查 IDB 缓存
      const cached = await getCachedBlob(family);
      if (cached) {
        const url = URL.createObjectURL(cached);
        const ok = await registerFont(family, url);
        URL.revokeObjectURL(url);
        if (ok) loadedFonts.add(family);
        return ok;
      }

      // 下载（优先前端 fetch 以支持进度；后端 Rust 兜底）
      const remoteUrl = `${DOWNLOAD_BASE}/${fileName}`;
      const mime = mimeFromFileName(fileName);

      notifyProgress(family, 0);

      let blob: Blob;
      try {
        blob = await downloadWithProgress(remoteUrl, mime, family);
      } catch {
        // 兜底：走 Rust reqwest（无进度）
        const rawBytes: number[] = await fetchFontData(remoteUrl);
        blob = new Blob([new Uint8Array(rawBytes)], { type: mime });
        notifyProgress(family, 100);
      }

      saveBlobCache(family, blob);

      const blobUrl = URL.createObjectURL(blob);
      const ok = await registerFont(family, blobUrl);
      URL.revokeObjectURL(blobUrl);
      if (ok) loadedFonts.add(family);

      notifyProgress(family, -1);
      return ok;
    } catch (e) {
      console.warn(`[fontLoader] Failed to load font: ${family}`, e);
      downloadFailures.add(family);
      notifyProgress(family, -1);
      return false;
    } finally {
      loadingPromises.delete(family);
    }
  })();

  loadingPromises.set(family, promise);
  return promise;
}

export async function isFontAvailable(family: string): Promise<boolean> {
  if (SYSTEM_FONTS.has(family)) return true;
  if (loadedFonts.has(family)) return true;
  const cached = await getCachedBlob(family);
  return cached !== null;
}

export function isFontFailed(family: string): boolean {
  return downloadFailures.has(family);
}
