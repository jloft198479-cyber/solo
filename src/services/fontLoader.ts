import { fetchFontData, getCachedFontPath } from './tauri/document';
import { toAssetUrl } from './tauri/asset';
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

/**
 * 用 CSS @font-face 注入 <style> 标签加载字体。
 *
 * 关键：CSS @font-face 的 url() 不走 CORS（和 <img src> 一样），
 * 而 JavaScript FontFace API 强制走 CORS——Tauri asset protocol 不返回
 * Access-Control-Allow-Origin 头，所以 FontFace.load() 必然失败。
 *
 * 用 @font-face 注入 + convertFileSrc（asset URL）完全绕过 CORS。
 * document.fonts.load() 触发加载并检测是否成功。
 */
async function registerFont(family: string, filePath: string): Promise<boolean> {
  const assetUrl = toAssetUrl(filePath);
  const format = filePath.endsWith('.otf') ? 'opentype' : 'truetype';
  const styleId = `mk-font-${family.replace(/\s+/g, '-')}`;

  let style = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = `@font-face { font-family: "${family}"; src: url("${assetUrl}") format("${format}"); font-display: swap; }`;

  // 触发加载并等待完成——document.fonts.load() 走 CSS @font-face 机制，不走 CORS
  try {
    await document.fonts.load(`16px "${family}"`);
    // check() 返回 true 仅当字体已加载且可用
    return document.fonts.check(`16px "${family}"`);
  } catch {
    return false;
  }
}

async function readCache(family: string): Promise<boolean> {
  try {
    const fileName = REMOTE_FONTS[family];
    if (!fileName) return false;
    const cachedPath = await getCachedFontPath(family, fileName);
    if (!cachedPath) return false;

    const ok = await registerFont(family, cachedPath);
    if (ok) loadedFonts.add(family);
    return ok;
  } catch (e) {
    console.warn(`[fontLoader] readCache failed: ${family}`, e);
    return false;
  }
}

async function downloadAndCache(family: string, fileName: string): Promise<boolean> {
  const remoteUrl = `${DOWNLOAD_BASE}/${fileName}`;
  notifyProgress(family, 0);

  try {
    // 直接用 Rust 下载——前端 fetch 会被 GitHub CDN 的 CORS 拦截
    // （GitHub release 不返回 Access-Control-Allow-Origin 头）
    await fetchFontData(remoteUrl, family);
    notifyProgress(family, 100);

    // 下载落盘后，走 readCache 路径用 CSS @font-face 加载
    const ok = await readCache(family);
    if (!ok) downloadFailures.add(family);
    notifyProgress(family, -1);
    return ok;
  } catch (e) {
    console.warn(`[fontLoader] download failed: ${family}`, e);
    downloadFailures.add(family);
    notifyProgress(family, -1);
    return false;
  }
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
