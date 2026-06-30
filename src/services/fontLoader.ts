import { fetchFontData, getCachedFontData, saveCachedFont } from './tauri/document';

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

async function registerFont(family: string, data: ArrayBuffer, mime: string): Promise<boolean> {
  try {
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const fontFace = new FontFace(family, `url('${url}')`);
    await fontFace.load();
    document.fonts.add(fontFace);
    URL.revokeObjectURL(url);
    return true;
  } catch (e) {
    console.warn(`[fontLoader] FontFace.register failed: ${family}`, e);
    return false;
  }
}

async function downloadWithProgress(
  url: string,
  family: string,
): Promise<ArrayBuffer> {
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

  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return merged.buffer as ArrayBuffer;
}

async function readCache(family: string, mime: string): Promise<boolean> {
  try {
    const rawBytes = await getCachedFontData(family);
    if (!rawBytes) return false;

    const buf = new Uint8Array(rawBytes).buffer;
    const ok = await registerFont(family, buf, mime);
    if (ok) loadedFonts.add(family);
    return ok;
  } catch (e) {
    console.warn(`[fontLoader] readCache failed: ${family}`, e);
    return false;
  }
}

async function downloadAndCache(family: string, fileName: string): Promise<boolean> {
  const remoteUrl = `${DOWNLOAD_BASE}/${fileName}`;
  const mime = mimeFromFileName(fileName);

  notifyProgress(family, 0);

  let buf: ArrayBuffer;
  try {
    buf = await downloadWithProgress(remoteUrl, family);
  } catch {
    const rawBytes: number[] = await fetchFontData(remoteUrl);
    buf = new Uint8Array(rawBytes).buffer;
    notifyProgress(family, 100);
  }

  const ok = await registerFont(family, buf, mime);
  if (ok) {
    loadedFonts.add(family);
    try {
      await saveCachedFont(family, [...new Uint8Array(buf)]);
    } catch (e) {
      console.warn(`[fontLoader] saveCache failed: ${family}`, e);
    }
  }

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
      const mime = mimeFromFileName(fileName);

      if (await readCache(family, mime)) return true;

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
  const rawBytes = await getCachedFontData(family);
  return rawBytes !== null;
}

export function isFontFailed(family: string): boolean {
  return downloadFailures.has(family);
}
