import { check } from '@tauri-apps/plugin-updater';
import { invokeCommand } from './client';
import { TAURI_COMMANDS } from './command-names';

/**
 * 统一更新检查入口：先探测代理再查更新。
 * App 启动静默检查与「关于」面板手动检查共用，消除重复。
 * 只负责「检查」，下载/安装由调用方决定；返回 null 表示已是最新。
 */
export async function checkUpdateAvailability() {
  await invokeCommand<string>(TAURI_COMMANDS.detectProxyForUpdate).catch(() => {});
  return check();
}
