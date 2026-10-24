/**
 * renamePath「路径跟随」语义锁（审计 2026-10-25 P1-4）。
 *
 * 我防的事故：改名只换路径时（跨窗口改名跟随 / 改名保存失败回退两条路径），
 * 编辑器 watch 把它当跨文件切换、用 store 旧基线整体回灌 doc 并
 * `cancelPending()` 作废挂起序列化 —— 防抖窗口（500ms~2.5s）内未落 store 的
 * 编辑被静默清掉。修法：`renamePath` 递增 `pathFollowToken`（与 `setFile` 的
 * `reloadToken` 互斥区分），watch 见到该信号只做路径相关刷新、**绝不替换内容**。
 *
 * 第 3 条是 C 级静态接线锁（与 wikilink-sync-refresh-lock 同款手法）：
 * 编辑器 watch 的源数组必须含 pathFollowToken，且跟随守卫必须早于
 * replaceDocumentWithoutHistory —— 组件 watch 无法在单测里真跑，只能钉接线。
 *
 * 反向校准（准入②，执行时已做）：renamePath 去掉 token 递增 ⇒ 第 1 条转红；
 * watch 源数组去掉第三项 ⇒ 第 3 条转红。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useFileStore } from '../file';

describe('renamePath：路径跟随语义（P1-4）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('只换路径：内容与脏态原样保留，不动 reloadToken，递增 pathFollowToken', () => {
    const store = useFileStore();
    store.setFile('旧基线\n', '/old/a.md', 111);
    store.syncEditedContent('编辑中的内容\n');
    const reloadBefore = store.reloadToken;

    store.renamePath('/old/b.md');

    expect(store.currentFile.path).toBe('/old/b.md');
    expect(store.currentFile.content, '未落盘的编辑必须原样保留').toBe('编辑中的内容\n');
    expect(store.currentFile.isDirty).toBe(true);
    expect(store.reloadToken, '不触发「磁盘载入」型重载').toBe(reloadBefore);
    expect(store.pathFollowToken).toBeGreaterThan(0);
  });

  it('setFile 载入不递增 pathFollowToken（两信号互斥，防误判跟随）', () => {
    const store = useFileStore();
    store.setFile('内容\n', '/x/a.md', 1);
    expect(store.pathFollowToken).toBe(0);
  });

  it('编辑器 watch 接线在位：pathFollowToken 是 watch 源且守卫早于文档替换', () => {
    const vue = readFileSync(
      resolve(__dirname, '../../components/Editor/MarkdownEditor.vue'),
      'utf8',
    );
    expect(vue, 'watch 源数组必须含 pathFollowToken').toContain('fileStore.pathFollowToken');
    const guardPos = vue.indexOf('pathFollowToken > (prev[2]');
    // 找 watch 里的调用形态（首处出现是 :351 的函数定义，不是使用点）
    const replacePos = vue.indexOf('replaceDocumentWithoutHistory(editor.value');
    expect(guardPos).toBeGreaterThan(-1);
    expect(replacePos, '路径跟随守卫必须早于文档替换').toBeGreaterThan(guardPos);
  });
});
