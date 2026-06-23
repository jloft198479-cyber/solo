import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useFileStore } from '../file';

describe('useFileStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('初始状态', () => {
    it('默认创建未命名空文件，无脏标记', () => {
      const store = useFileStore();

      expect(store.currentFile.path).toBeNull();
      expect(store.currentFile.content).toBe('');
      expect(store.currentFile.isDirty).toBe(false);
      expect(store.currentFile.lastModifiedTime).toBeNull();
      expect(store.currentFile.displayName).toBe('未命名');
      expect(store.hasUserEdit).toBe(false);
      expect(store.isLoading).toBe(false);
    });
  });

  describe('setContent', () => {
    it('未发生过用户编辑时，setContent 不会标记为脏', () => {
      const store = useFileStore();

      store.setContent('新内容');

      expect(store.currentFile.content).toBe('新内容');
      expect(store.currentFile.isDirty).toBe(false);
      expect(store.hasUserEdit).toBe(false);
    });

    it('用户编辑后，setContent 会同步标记为脏', () => {
      const store = useFileStore();

      store.markUserEdit();
      store.setContent('编辑后内容');

      expect(store.currentFile.content).toBe('编辑后内容');
      expect(store.currentFile.isDirty).toBe(true);
      expect(store.hasUserEdit).toBe(true);
    });
  });

  describe('markUserEdit', () => {
    it('同时设置 hasUserEdit 与 isDirty', () => {
      const store = useFileStore();

      store.markUserEdit();

      expect(store.hasUserEdit).toBe(true);
      expect(store.currentFile.isDirty).toBe(true);
    });
  });

  describe('setFile', () => {
    it('从路径派生 displayName（去除 .md 后缀）', () => {
      const store = useFileStore();

      store.setFile('# 标题', 'C:\\docs\\我的笔记.md', 1700000000);

      expect(store.currentFile.path).toBe('C:\\docs\\我的笔记.md');
      expect(store.currentFile.content).toBe('# 标题');
      expect(store.currentFile.displayName).toBe('我的笔记');
      expect(store.currentFile.lastModifiedTime).toBe(1700000000);
    });

    it('从 Unix 风格路径派生 displayName（去除 .markdown 后缀）', () => {
      const store = useFileStore();

      store.setFile('正文', '/home/user/notes/readme.markdown');

      expect(store.currentFile.displayName).toBe('readme');
    });

    it('从路径派生 displayName（去除 .txt 后缀）', () => {
      const store = useFileStore();

      store.setFile('正文', '/tmp/草稿.txt');

      expect(store.currentFile.displayName).toBe('草稿');
    });

    it('无路径时 displayName 回退为"未命名"', () => {
      const store = useFileStore();

      store.setFile('内容', null);

      expect(store.currentFile.path).toBeNull();
      expect(store.currentFile.displayName).toBe('未命名');
    });

    it('加载新文件后重置脏标记与用户编辑标志', () => {
      const store = useFileStore();
      store.markUserEdit();
      store.setContent('脏内容');
      expect(store.currentFile.isDirty).toBe(true);

      store.setFile('新内容', '/path/file.md');

      expect(store.currentFile.isDirty).toBe(false);
      expect(store.hasUserEdit).toBe(false);
    });

    it('路径仅含文件名时也能正确派生 displayName', () => {
      const store = useFileStore();

      store.setFile('内容', 'plain.md');

      expect(store.currentFile.displayName).toBe('plain');
    });

    it('无后缀的路径原样作为 displayName', () => {
      const store = useFileStore();

      store.setFile('内容', '/docs/无后缀文件');

      expect(store.currentFile.displayName).toBe('无后缀文件');
    });
  });

  describe('setDisplayName', () => {
    it('更新 displayName 并标记为脏', () => {
      const store = useFileStore();

      store.setDisplayName('新标题');

      expect(store.currentFile.displayName).toBe('新标题');
      expect(store.currentFile.isDirty).toBe(true);
      expect(store.hasUserEdit).toBe(true);
    });

    it('空白名称回退为"未命名"', () => {
      const store = useFileStore();

      store.setDisplayName('   ');

      expect(store.currentFile.displayName).toBe('未命名');
    });

    it('空字符串回退为"未命名"', () => {
      const store = useFileStore();

      store.setDisplayName('');

      expect(store.currentFile.displayName).toBe('未命名');
    });

    it('保留名称中的前后空格以外的内部空格', () => {
      const store = useFileStore();

      store.setDisplayName('  我的 文档  ');

      expect(store.currentFile.displayName).toBe('我的 文档');
    });
  });

  describe('markSaved', () => {
    it('清除脏标记与用户编辑标志', () => {
      const store = useFileStore();
      store.markUserEdit();
      expect(store.currentFile.isDirty).toBe(true);

      store.markSaved();

      expect(store.currentFile.isDirty).toBe(false);
      expect(store.hasUserEdit).toBe(false);
    });

    it('可选更新 lastModifiedTime', () => {
      const store = useFileStore();
      store.setFile('内容', '/path/file.md', 1000);

      store.markSaved(2000);

      expect(store.currentFile.lastModifiedTime).toBe(2000);
    });

    it('不传 lastModifiedTime 时保留原值', () => {
      const store = useFileStore();
      store.setFile('内容', '/path/file.md', 1000);

      store.markSaved();

      expect(store.currentFile.lastModifiedTime).toBe(1000);
    });

    it('显式传 null 时保留原值（不清理）', () => {
      const store = useFileStore();
      store.setFile('内容', '/path/file.md', 1000);

      store.markSaved(null);

      expect(store.currentFile.lastModifiedTime).toBe(1000);
    });
  });

  describe('reset', () => {
    it('恢复为初始未命名空文件', () => {
      const store = useFileStore();
      store.setFile('内容', '/path/file.md', 1000);
      store.markUserEdit();
      store.setDisplayName('新名字');

      store.reset();

      expect(store.currentFile.path).toBeNull();
      expect(store.currentFile.content).toBe('');
      expect(store.currentFile.isDirty).toBe(false);
      expect(store.currentFile.lastModifiedTime).toBeNull();
      expect(store.currentFile.displayName).toBe('未命名');
      expect(store.hasUserEdit).toBe(false);
    });
  });

  describe('setLoading', () => {
    it('切换 isLoading 标志', () => {
      const store = useFileStore();

      store.setLoading(true);
      expect(store.isLoading).toBe(true);

      store.setLoading(false);
      expect(store.isLoading).toBe(false);
    });
  });

  describe('dirty 状态机回归测试', () => {
    it('加载文件 → 用户编辑 → 保存 → 再次编辑 的脏状态流转', () => {
      const store = useFileStore();

      // 1. 加载文件，应无脏标记
      store.setFile('初始内容', '/path/file.md', 1000);
      expect(store.currentFile.isDirty).toBe(false);
      expect(store.hasUserEdit).toBe(false);

      // 2. setContent 在未发生用户编辑时不应触发脏（避免加载后 round-trip 误判）
      store.setContent('初始内容');
      expect(store.currentFile.isDirty).toBe(false);

      // 3. 用户编辑触发脏
      store.markUserEdit();
      store.setContent('修改后内容');
      expect(store.currentFile.isDirty).toBe(true);

      // 4. 保存后清除脏
      store.markSaved(2000);
      expect(store.currentFile.isDirty).toBe(false);
      expect(store.hasUserEdit).toBe(false);

      // 5. 保存后再次 setContent 不应触发脏（除非再次 markUserEdit）
      store.setContent('再次修改');
      expect(store.currentFile.isDirty).toBe(false);
    });

    it('修改 displayName 应触发脏，即使此前刚保存过', () => {
      const store = useFileStore();
      store.setFile('内容', '/path/file.md', 1000);
      store.markSaved();

      store.setDisplayName('新名字');

      expect(store.currentFile.isDirty).toBe(true);
      expect(store.hasUserEdit).toBe(true);
    });
  });
});
