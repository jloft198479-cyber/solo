import { convertFileSrc } from '@tauri-apps/api/core';
import { fetchFontData, getCachedFontPath, saveCachedFont } from './tauri/document';
import { FONT_OPTIONS } from '../constants/fonts';

// 字体资源固定在独立 tag `fonts-v1` 的 release 下，与 app 版本号解耦：
// 以后 app 升版无需同步字体链接，且 Rust fallback（fetch_font_data）复用同一地址。
const DOWNLOAD_BASE = 'https://github.com/jloft198479-cyber/solo/releases/download/fonts-v1';

const REMOTE_FONTS: Readonly<Record<string, string>> = Object.fromEntries(
  FONT_OPTIONS.filter((opt) => opt.fileName).map((opt) => [opt.value, opt.fileName!]),
);

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

async function registerFont(family: string, url: string): Promise<boolean> {
  try {
    // display:'swap'：字体加载期间用系统同族字体先顶上，到位无感替换。
    // 对应 Web Vitals 的「消灭 FOUT（字体切换闪烁）」目标。
    const fontFace = new FontFace(family, `url('${url}')`, { display: 'swap' });
    await fontFace.load();
    document.fonts.add(fontFace);
    return true;
  } catch (e) {
    console.warn(`[fontLoader] FontFace.register failed: ${family}`, e);
    return false;
  }
}

async function downloadWithProgress(
  url: string,
  family: string,
): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const len = Number(res.headers.get('content-length') ?? 0);
  const reader = res.body!.getReader();

  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastNotifyTime = 0;
  const THROTTLE_MS = 200;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (len > 0) {
      const now = Date.now();
      if (now - lastNotifyTime >= THROTTLE_MS) {
        lastNotifyTime = now;
        notifyProgress(family, Math.round((received / len) * 100));
      }
    }
  }

  if (len > 0) {
    notifyProgress(family, Math.round((received / len) * 100));
  }

  // 从 URL 推断字体 MIME（.otf→font/otf, .ttf→font/ttf），让 FontFace.load() 能识别格式
  const mime = url.endsWith('.otf') ? 'font/otf' : url.endsWith('.ttf') ? 'font/ttf' : '';
  return new Blob(chunks as BlobPart[], { type: mime });
}

async function readCache(family: string): Promise<boolean> {
  try {
    const fileName = REMOTE_FONTS[family];
    if (!fileName) return false;
    const cachedPath = await getCachedFontPath(family, fileName);
    if (!cachedPath) return false;

    const assetUrl = convertFileSrc(cachedPath);
    const ok = await registerFont(family, assetUrl);
    if (ok) loadedFonts.add(family);
    else console.warn(`[fontLoader] readCache: ${family} font face rejected`);
    return ok;
  } catch (e) {
    console.warn(`[fontLoader] readCache failed: ${family}`, e);
    return false;
  }
}

async function downloadAndCache(family: string, fileName: string): Promise<boolean> {
  const remoteUrl = `${DOWNLOAD_BASE}/${fileName}`;

  notifyProgress(family, 0);

  let blob: Blob;
  try {
    blob = await downloadWithProgress(remoteUrl, family);
  } catch {
    // fallback：Rust 下载并直接落盘，返回缓存路径。
    // 避免二进制走 IPC JSON number[] 往返（与 get_cached_font_path 路径统一）。
    const cachedPath = await fetchFontData(remoteUrl, family);
    const assetUrl = convertFileSrc(cachedPath);
    const ok = await registerFont(family, assetUrl);
    if (ok) loadedFonts.add(family);
    notifyProgress(family, -1);
    return ok;
  }

  // 主路径成功后保存缓存（Rust 已落盘的 fallback 路径无需再保存）
  saveCachedFont(family, fileName, [...new Uint8Array(await blob.arrayBuffer())]).catch(() => {});

  const blobUrl = URL.createObjectURL(blob);
  const ok = await registerFont(family, blobUrl);
  URL.revokeObjectURL(blobUrl);
  if (ok) loadedFonts.add(family);

  notifyProgress(family, -1);
  return ok;
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

      if (await readCache(family)) return true;

      return await downloadAndCache(family, fileName);
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
  const fileName = REMOTE_FONTS[family];
  if (!fileName) return true; // 非下载型字体，视为可用
  const cachedPath = await getCachedFontPath(family, fileName);
  return cachedPath !== null;
}

export function isFontFailed(family: string): boolean {
  return downloadFailures.has(family);
}
