/**
 * 字体加载器
 *
 * 支持本地已安装字体、IndexedDB 缓存字体、远程下载三种来源。
 * 用户选中字体后按需加载，已加载的缓存复用。
 *
 * 加载优先级：系统已安装 → IndexedDB 缓存 → 远程下载（并写入缓存）
 *
 * TODO: 打包上传 GitHub 后替换 DOWNLOAD_BASE URL 为实际 Release asset 地址。
 */

/** 字体下载基址（本仓库的 GitHub Release asset 目录） */
const DOWNLOAD_BASE = 'https://github.com/{owner}/{repo}/releases/download/fonts-v1';

/** 可远程下载的字体：CSS family → 文件名 */
const REMOTE_FONTS: Readonly<Record<string, string>> = {
  'Noto Serif SC': 'NotoSerifSC-Regular.otf',
  'Zhuque Fangsong': 'ZhuqueFangsong-Regular.ttf',
  'Xiaolai SC': 'XiaolaiSC-Regular.ttf',
  'LXGW WenKai': 'LXGWWenKai-Regular.ttf',
  'Huiwen-mincho': 'Huiwen-mincho-Regular.otf',
};

/** 系统自带字体，不需要加载 */
const SYSTEM_FONTS = new Set(['system-ui', 'Microsoft YaHei UI']);

/** 已加载的字体集合（内存缓存） */
const loadedFonts = new Set<string>();

/** 加载中的字体 Promise（防止重复加载） */
const loadingPromises = new Map<string, Promise<boolean>>();

/** IndexedDB 数据库名 */
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
  } catch {
    /* 静默 */
  }
}

async function loadAndRegister(family: string, blob: Blob): Promise<boolean> {
  try {
    const fontFace = new FontFace(family, `url('${URL.createObjectURL(blob)}')`);
    await fontFace.load();
    document.fonts.add(fontFace);
    return true;
  } catch {
    return false;
  }
}

/**
 * 按需加载指定字体。
 *
 * - 系统字体 / 已加载字体 → 立即返回 true
 * - 正在加载 → 返回同一个 Promise
 * - 需要远程下载 → 从 DOWNLOAD_BASE 下载并缓存到 IDB
 * - 所有路径失败 → 返回 false，浏览器使用 fallback 字体
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
        // 未知字体，标记已加载但不报错
        loadedFonts.add(family);
        return true;
      }

      // 1) 查 IDB 缓存
      const cached = await getCachedBlob(family);
      if (cached) {
        const ok = await loadAndRegister(family, cached);
        if (ok) loadedFonts.add(family);
        return ok;
      }

      // 2) 远程下载
      const url = `${DOWNLOAD_BASE}/${fileName}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();

      // 写入缓存（异步，不阻塞）
      saveBlobCache(family, blob);

      const ok = await loadAndRegister(family, blob);
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

/**
 * 检查字体是否已下载到本地缓存（UI 展示用）。
 * 系统字体和已加载字体也算"可用"。
 */
export async function isFontAvailable(family: string): Promise<boolean> {
  if (SYSTEM_FONTS.has(family)) return true;
  if (loadedFonts.has(family)) return true;
  const cached = await getCachedBlob(family);
  return cached !== null;
}
