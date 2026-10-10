import { invokeCommand } from './client';
import { TAURI_COMMANDS } from './command-names';

/** 单篇文档的阅读位置（滚动比例 0..1）与最后阅读时间 */
export interface ReadingPosition {
  ratio: number;
  updatedMs: number;
}

/** 文档会话记忆：最近文件 + 阅读位置（Rust 侧落盘 app_local_data_dir/session/） */
export interface DocumentSessionState {
  recentFiles: string[];
  readingPositions: Record<string, ReadingPosition>;
}

/**
 * 记录一次文档会话。
 * - 打开文档时传 scrollRatio = null：只记最近文件，不动阅读位置
 * - 切走 / 滚动防抖 / 关窗时带当前滚动比例：顺带更新阅读位置
 * 失败静默（调用方 catch）——这份数据不值得打断用户。
 */
export async function recordDocumentSession(
  path: string,
  scrollRatio: number | null,
): Promise<void> {
  await invokeCommand(TAURI_COMMANDS.recordDocumentSession, {
    path,
    scrollRatio: scrollRatio ?? null,
  });
}

/** 读取会话记忆。命令面板「最近文件」分组与打开后的滚动恢复共用。 */
export async function readDocumentSession(): Promise<DocumentSessionState> {
  return invokeCommand<DocumentSessionState>(TAURI_COMMANDS.readDocumentSession);
}
