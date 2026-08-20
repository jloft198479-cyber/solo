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
      expect(store.isLoading).toBe(false);
    });
  });

  describe('setContent', () => {
    it('仅同步基线，不标脏', () => {
      const store = useFileStore();

      store.setContent('新内容');

      expect(store.currentFile.content).toBe('新内容');
      expect(store.currentFile.isDirty).toBe(false);
    });
  });

  describe('syncEditedContent', () => {
    it('内容相对基线有变化时，更新内容并标脏，返回 true', () => {
      const store = useFileStore();
      store.setContent('基线');
      store.markSaved();

      const changed = store.syncEditedContent('编辑后内容');

      expect(changed).toBe(true);
      expect(store.currentFile.content).toBe('编辑后内容');
      expect(store.currentFile.isDirty).toBe(true);
    });

    it('内容相对基线未变化时，不改动、不标脏，返回 false', () => {
      const store = useFileStore();
      store.setContent('基线');
      store.markSaved();

      const changed = store.syncEditedContent('基线');

      expect(changed).toBe(false);
      expect(store.currentFile.isDirty).toBe(false);
    });

    it('忽略尾部换行差异（序列化器总是追加 \\n）', () => {
      const store = useFileStore();
      store.setContent('基线');
      store.markSaved();

      const changed = store.syncEditedContent('基线\n');

      expect(changed).toBe(false);
      expect(store.currentFile.isDirty).toBe(false);
    });

    it('非键盘交互（如拖入图片）导致内容变化时也能正确标脏', () => {
      const store = useFileStore();
      store.setContent('基线');
      store.markSaved();

      const changed = store.syncEditedContent('拖入图片后的内容');

      expect(changed).toBe(true);
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

    it('加载新文件后重置内容与脏标记', () => {
      const store = useFileStore();
      store.setContent('脏内容');
      store.syncEditedContent('更脏内容');
      expect(store.currentFile.isDirty).toBe(true);

      store.setFile('新内容', '/path/file.md');

      expect(store.currentFile.content).toBe('新内容');
      expect(store.currentFile.isDirty).toBe(false);
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
    it('清除脏标记并重置 displayName 为原始文件名', () => {
      const store = useFileStore();
      store.setFile('内容', '/path/file.md');
      store.syncEditedContent('编辑内容');
      store.setDisplayName('新标题');
      expect(store.currentFile.isDirty).toBe(true);

      store.markSaved();

      expect(store.currentFile.isDirty).toBe(false);
      expect(store.currentFile.displayName).toBe('file');
    });

    it('可选更新 lastModifiedTime', () => {
      const store = useFileStore();
      store.setFile('内容', '/path/file.md', 1000);

      store.markSaved(2000);

      expect(store.currentFile.lastModifiedTime).toBe(2000);
      expect(store.currentFile.isDirty).toBe(false);
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
      store.setDisplayName('新名字');

      store.reset();

      expect(store.currentFile.path).toBeNull();
      expect(store.currentFile.content).toBe('');
      expect(store.currentFile.isDirty).toBe(false);
      expect(store.currentFile.lastModifiedTime).toBeNull();
      expect(store.currentFile.displayName).toBe('未命名');
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
    it('加载文件 → 编辑（内容变化）→ 保存 → 再次编辑 的脏状态流转', () => {
      const store = useFileStore();

      // 1. 加载文件，应无脏标记
      store.setFile('初始内容', '/path/file.md', 1000);
      expect(store.currentFile.isDirty).toBe(false);

      // 2. setContent 仅同步基线，不触发脏（避免加载后 round-trip 误判）
      store.setContent('初始内容');
      expect(store.currentFile.isDirty).toBe(false);

      // 3. syncEditedContent 内容变化触发脏
      const changed = store.syncEditedContent('修改后内容');
      expect(changed).toBe(true);
      expect(store.currentFile.isDirty).toBe(true);

      // 4. 保存后清除脏
      store.markSaved(2000);
      expect(store.currentFile.isDirty).toBe(false);

      // 5. 保存后内容未变时 syncEditedContent 不再触发脏
      const unchanged = store.syncEditedContent('修改后内容');
      expect(unchanged).toBe(false);
      expect(store.currentFile.isDirty).toBe(false);
    });

    it('修改 displayName 应触发脏，即使此前刚保存过', () => {
      const store = useFileStore();
      store.setFile('内容', '/path/file.md', 1000);
      store.markSaved();

      store.setDisplayName('新名字');

      expect(store.currentFile.isDirty).toBe(true);
    });
  });
});