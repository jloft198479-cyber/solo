import { fetchFontData, getCachedFontPath, readFontBytes } from './tauri/font';
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
 * 用字体字节直接构造 FontFace 加载（缓存字节或安装包内置字节均可）。
 * 同源构造，绕开 asset protocol 的 CORS 拦截。
 */
async function registerFontFromBytes(family: string, bytes: BufferSource): Promise<boolean> {
  try {
    const face = new FontFace(family, bytes);
    await face.load();
    document.fonts.add(face);
    const ok = document.fonts.check(`16px "${family}"`);
    console.log(
      `[fontLoader] registerFontFromBytes: family="${family}", status="${face.status}", check=${ok}`,
    );
    return ok;
  } catch (err) {
    console.error(`[fontLoader] registerFontFromBytes failed: ${family}`, err);
    return false;
  }
}

/**
 * 通过 CSS @font-face 注入字体，让浏览器内核直接从磁盘读取。
 * CSS @font-face 的 url() 不走 CORS（W3C 标准），绕开 FontFace API 的 CORS 限制。
 * IPC 只传路径（几十字节），不传字体字节（几 MB）。
 */
async function registerFontViaCss(family: string, cachedPath: string): Promise<boolean> {
  try {
    const assetUrl = toAssetUrl(cachedPath);
    const style = document.createElement('style');
    style.textContent = `@font-face {
  font-family: "${family}";
  src: url("${assetUrl}");
  font-display: swap;
}`;
    document.head.appendChild(style);
    await document.fonts.load(`16px "${family}"`);
    const ok = document.fonts.check(`16px "${family}"`);
    console.log(
      `[fontLoader] registerFontViaCss: family="${family}", assetUrl="${assetUrl}", check=${ok}`,
    );
    return ok;
  } catch (err) {
    console.error(`[fontLoader] registerFontViaCss failed: ${family}`, err);
    return false;
  }
}

async function readCache(family: string): Promise<boolean> {
  try {
    const fileName = REMOTE_FONTS[family];
    if (!fileName) return false;
    const cachedPath = await getCachedFontPath(family, fileName);
    if (!cachedPath) {
      console.log(`[fontLoader] readCache: no cached file for "${family}" (${fileName})`);
      return false;
    }

    console.log(`[fontLoader] readCache: family="${family}", cachedPath="${cachedPath}"`);

    // 优先走 CSS @font-face（IPC 零字节传输，浏览器内核直接读盘）
    if (await registerFontViaCss(family, cachedPath)) {
      loadedFonts.add(family);
      return true;
    }

    // fallback: 走 IPC 取字节 → new FontFace(family, bytes) 同源加载
    console.warn(
      `[fontLoader] readCache: CSS @font-face failed, falling back to bytes for "${family}"`,
    );
    const bytes = await readFontBytes(family, fileName);
    if (!bytes || bytes.length === 0) {
      console.warn(`[fontLoader] readCache: readFontBytes empty for "${family}"`);
      return false;
    }
    const ok = await registerFontFromBytes(family, new Uint8Array(bytes));
    if (ok) loadedFonts.add(family);
    else
      console.warn(`[fontLoader] readCache: registerFontFromBytes returned false for "${family}"`);
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

    // 下载落盘后，走 readCache 加载（优先 CSS @font-face，失败回退字节通道）
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
      if (!fileName) {
        loadedFonts.add(family);
        return true;
      }

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
  // 兜底：缓存 / 下载链路
  const cachedPath = await getCachedFontPath(family, fileName);
  return cachedPath !== null;
}

export function isFontFailed(family: string): boolean {
  return downloadFailures.has(family);
}
