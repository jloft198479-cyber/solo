import { invoke } from '@tauri-apps/api/core';
import type { TauriCommandName } from './command-names';

export interface TauriAppError {
  code: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function parseJsonError(error: string): TauriAppError | null {
  try {
    const parsed = JSON.parse(error);
    if (isRecord(parsed) && typeof parsed.code === 'string' && typeof parsed.message === 'string') {
      return {
        code: parsed.code,
        message: parsed.message,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function normalizeTauriError(error: unknown): TauriAppError {
  if (typeof error === 'string') {
    return parseJsonError(error) ?? { code: 'unknown_error', message: error };
  }

  if (isRecord(error)) {
    if (typeof error.code === 'string' && typeof error.message === 'string') {
      return {
        code: error.code,
        message: error.message,
      };
    }

    if (typeof error.message === 'string') {
      return { code: 'unknown_error', message: error.message };
    }
  }

  if (error instanceof Error) {
    return { code: 'unknown_error', message: error.message };
  }

  return {
    code: 'unknown_error',
    message: '发生未知错误',
  };
}

export async function invokeCommand<T>(
  command: TauriCommandName,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeTauriError(error);
  }
}

/**
 * 常见 Windows 错误码 → 用户能照着做的中文提示。
 * solo 只发 Windows（`bundle.targets = ["nsis"]`），这里按 Win32 错误码映射，不抄 POSIX 的。
 */
const OS_ERROR_HINTS: Record<number, string> = {
  2: '文件不存在，可能已被移动或删除',
  3: '文件夹不存在',
  5: '没有访问权限，可能被系统或其他程序拒绝',
  32: '文件正被其他程序占用，关掉占用它的程序后重试',
  112: '磁盘空间不足',
  123: '文件名包含非法字符',
  206: '路径过长，请把文件移到更浅的目录',
};

/**
 * 给 Rust / 系统原始错误补一句「该做什么」。原文（含错误码）一律保留在前面：
 * 界面看得懂，排查时也仍能按 `os error N` 搜日志。
 *
 * ⚠️ 只做**展示层**加工，别挪进 `normalizeTauriError` —— 启动路径的
 * 「文件不存在静默跳过」靠匹配原始 `os error 2`（useAppWindowSession）。
 */
export function withErrorHint(messageText: string): string {
  const matched = /\(os error (\d+)\)/i.exec(messageText);
  if (!matched) return messageText;
  const hint = OS_ERROR_HINTS[Number(matched[1])];
  return hint ? `${messageText}（${hint}）` : messageText;
}
