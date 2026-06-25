/**
 * 字体加载器
 *
 * 支持本地已安装字体、远程下载两种来源。
 * 系统字体（微软雅黑 UI、system-ui）立即返回。
 * 远程字体通过 Rust 后端下载（reqwest），绕过前端 CSP/CORS 限制。
 * 下载后缓存到 IndexedDB，后续离线可用。
 */

import { fetchFontData } from '../services/tauri/document';

/** 字体下载基址（本仓库的 GitHub Release asset 目录） */
const DOWNLOAD_BASE = 'https://github.com/jloft198479-cyber/solo/releases/download/v1.1.6';

/** 可远程下载的字体：CSS family → 文件名 */
const REMOTE_FONTS: Readonly<Record<string, string>> = {
  'Noto Serif SC': 'NotoSerifSC-Regular.otf',
  'Zhuque Fangsong': 'ZhuqueFangsong-Regular.ttf',
  'Xiaolai SC': 'XiaolaiSC-Regular.ttf',
  'LXGW WenKai': 'LXGWWenKai-Regular.ttf',
  'Huiwen-mincho': 'Huiwen-mincho-Regular.otf',
};

/** 文件名 → MIME 类型映射 */
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

/** 系统自带字体 */
const SYSTEM_FONTS = new Set(['system-ui', 'Microsoft YaHei UI']);

/** 已加载的字体集合 */
const loadedFonts = new Set<string>();

/** 加载中的字体 Promise（防止重复加载） */
const loadingPromises = new Map<string, Promise<boolean>>();

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
  } catch {
    return null;
  }
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

/** 使用 FontFace API 注册字体 */
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
 * 按需加载指定字体。
 */
export async function ensureFontLoaded(family: string): Promise<boolean> {
  if (SYSTEM_FONTS.has(family)) return true;
  if (loadedFonts.has(family)) return true;

  const existing = loadingPromises.get(family);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const fileName = REMOTE_FONTS[family];
      if (!fileName) {
        loadedFonts.add(family);
        return true;
      }

      // 1) 查 IDB 缓存
      const cached = await getCachedBlob(family);
      if (cached) {
        const url = URL.createObjectURL(cached);
        const ok = await registerFont(family, url);
        URL.revokeObjectURL(url);
        if (ok) loadedFonts.add(family);
        return ok;
      }

      // 2) 通过 Rust 后端下载（绕过 CSP/CORS）
      const remoteUrl = `${DOWNLOAD_BASE}/${fileName}`;
      const rawBytes: number[] = await fetchFontData(remoteUrl);

      const mime = mimeFromFileName(fileName);
      const blob = new Blob([new Uint8Array(rawBytes)], { type: mime });

      // 写入缓存
      saveBlobCache(family, blob);

      const blobUrl = URL.createObjectURL(blob);
      const ok = await registerFont(family, blobUrl);
      URL.revokeObjectURL(blobUrl);
      if (ok) loadedFonts.add(family);
      return ok;
    } catch (e) {
      console.warn(`[fontLoader] Failed to load font: ${family}`, e);
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
