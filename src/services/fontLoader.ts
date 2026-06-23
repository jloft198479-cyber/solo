/**
 * 内嵌字体按需加载器
 *
 * 用户切换到某字体时才加载对应的字体文件，已加载的缓存复用。
 * 字体文件放在 public/fonts/ 下，由 Vite 静态服务直接提供，
 * 无需 Tauri resource 协议或路径 API。
 *
 * 加载策略：
 * - 系统字体（system-ui / Microsoft YaHei UI）直接跳过
 * - 已加载的字体立即返回
 * - 正在加载的字体共享同一个 Promise（去重）
 * - 加载完成后通过 document.fonts.add() 注册，浏览器自动重绘
 */

/** 内嵌字体清单：CSS family name → 文件名 */
const EMBEDDED_FONTS: Readonly<Record<string, string>> = {
  'Noto Serif SC': 'NotoSerifSC-Regular.otf',
  'Zhuque Fangsong': 'ZhuqueFangsong-Regular.ttf',
  'Xiaolai SC': 'XiaolaiSC-Regular.ttf',
  'LXGW WenKai': 'LXGWWenKai-Regular.ttf',
  'Huiwen-mincho': 'Huiwen-mincho-Regular.otf',
};

/** 系统自带字体，不需要加载 */
const SYSTEM_FONTS = new Set(['system-ui', 'Microsoft YaHei UI']);

/** 已加载的字体集合 */
const loadedFonts = new Set<string>();

/** 加载中的字体 Promise（防止重复加载） */
const loadingPromises = new Map<string, Promise<boolean>>();

/**
 * 按需加载指定字体。
 *
 * - 系统字体 / 已加载字体 → 立即返回 true
 * - 正在加载 → 返回同一个 Promise
 * - 加载失败 → 返回 false，浏览器使用 fallback 字体
 *
 * 字体加载完成后浏览器会自动重绘使用该字体的元素，无需额外触发。
 */
export async function ensureFontLoaded(family: string): Promise<boolean> {
  if (SYSTEM_FONTS.has(family)) return true;

  const fileName = EMBEDDED_FONTS[family];
  if (!fileName) return true;

  if (loadedFonts.has(family)) return true;

  const existing = loadingPromises.get(family);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const url = `/fonts/${fileName}`;
      const fontFace = new FontFace(family, `url('${url}')`);
      await fontFace.load();
      document.fonts.add(fontFace);
      loadedFonts.add(family);
      return true;
    } catch {
      console.warn(`[fontLoader] Failed to load font: ${family} (${fileName})`);
      return false;
    } finally {
      loadingPromises.delete(family);
    }
  })();

  loadingPromises.set(family, promise);
  return promise;
}
