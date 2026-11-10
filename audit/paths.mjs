// 官网审计脚本共用的路径真理源。
// 一律从本文件位置推导仓库根：项目文件夹改名 / 换盘 / 从任意 cwd 运行都不用改这里。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const AUDIT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(AUDIT_DIR, '..');
export const SITE_ROOT = path.resolve(REPO_ROOT, 'solo-web-v2');
export const SHOTS_DIR = path.resolve(AUDIT_DIR, 'shots');
export const INDEX_HTML = path.resolve(SITE_ROOT, 'index.html');
export const INDEX_URL = pathToFileURL(INDEX_HTML).href;
export const OG_PNG = path.resolve(SITE_ROOT, 'og.png');

// Chrome 是外部程序，无法从项目推导：优先环境变量，再试常见安装位置。
// 保留原默认路径作兜底，换机器时设 SOLO_CHROME 即可，不必改脚本。
const chromeCandidates = [
  process.env.SOLO_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA &&
    path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
].filter(Boolean);

export const CHROME =
  chromeCandidates.find((candidate) => fs.existsSync(candidate)) || chromeCandidates[0];
