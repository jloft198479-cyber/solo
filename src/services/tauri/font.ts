import { invokeCommand } from './client';
import { TAURI_COMMANDS } from './command-names';

export async function fetchFontData(url: string, family: string) {
  return invokeCommand<string>(TAURI_COMMANDS.fetchFontData, { url, family });
}

export async function getCachedFontPath(family: string, fileName: string) {
  return invokeCommand<string | null>(TAURI_COMMANDS.getCachedFontPath, { family, fileName });
}

/** 读取字体缓存字节，前端用 new FontFace(family, bytes) 同源加载，绕过 asset 协议 CORS 限制 */
export async function readFontBytes(family: string, fileName: string) {
  return invokeCommand<number[]>(TAURI_COMMANDS.readFontBytes, { family, fileName });
}

export async function saveCachedFont(family: string, fileName: string, data: number[]) {
  return invokeCommand<void>(TAURI_COMMANDS.saveCachedFont, { family, fileName, data });
}
