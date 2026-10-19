import { describe, expect, it } from 'vitest';
import { normalizeTauriError, withErrorHint } from '../client';

describe('tauri client helpers', () => {
  it('normalizes structured tauri errors', () => {
    expect(
      normalizeTauriError({
        code: 'document_conflict',
        message: 'conflict',
      }),
    ).toEqual({
      code: 'document_conflict',
      message: 'conflict',
    });
  });

  it('parses serialized structured errors', () => {
    expect(normalizeTauriError('{"code":"document_conflict","message":"conflict"}')).toEqual({
      code: 'document_conflict',
      message: 'conflict',
    });
  });
});

describe('withErrorHint（错误提示人话化）', () => {
  it('已知错误码追加可操作提示，原文与错误码保留', () => {
    expect(withErrorHint('Access is denied. (os error 5)')).toBe(
      'Access is denied. (os error 5)（没有访问权限，可能被系统或其他程序拒绝）',
    );
  });

  it('未知错误码原样返回（不猜、不乱加话）', () => {
    expect(withErrorHint('weird failure (os error 999)')).toBe('weird failure (os error 999)');
  });

  it('不含 os error 的消息原样返回', () => {
    expect(withErrorHint('文件已被移动或删除，是否在此位置重新创建？')).toBe(
      '文件已被移动或删除，是否在此位置重新创建？',
    );
  });
});
