import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TAURI_COMMANDS } from '../command-names';

const invokeCommandMock = vi.hoisted(() => vi.fn());

vi.mock('../client', () => ({
  invokeCommand: invokeCommandMock,
}));

describe('tauri document service', () => {
  beforeEach(() => {
    invokeCommandMock.mockReset();
  });

  it('opens documents through the typed command wrapper', async () => {
    const result = {
      path: '/tmp/demo.md',
      content: '# Demo',
      lastModifiedMs: 42,
      contentHash: 'open-hash',
      layout: { encoding: 'utf8', ending: 'lf', mixed: false },
    };
    invokeCommandMock.mockResolvedValueOnce(result);

    const { openDocument } = await import('../document');

    await expect(openDocument('/tmp/demo.md')).resolves.toBe(result);
    expect(invokeCommandMock).toHaveBeenCalledWith(TAURI_COMMANDS.openDocument, {
      path: '/tmp/demo.md',
    });
  });

  it('saves documents with conflict metadata and force flag', async () => {
    const result = {
      path: '/tmp/demo.md',
      lastModifiedMs: 100,
      contentHash: 'saved-hash',
    };
    invokeCommandMock.mockResolvedValueOnce(result);

    const { saveDocument } = await import('../document');

    await expect(saveDocument('/tmp/demo.md', '# Updated', 'a'.repeat(64), true)).resolves.toBe(
      result,
    );
    expect(invokeCommandMock).toHaveBeenCalledWith(TAURI_COMMANDS.saveDocument, {
      path: '/tmp/demo.md',
      content: '# Updated',
      expectedContentHash: 'a'.repeat(64),
      force: true,
      // 不传布局 = 新文档历史行为（UTF-8 无 BOM、LF）
      layout: null,
    });
  });

  it('uses safe save defaults when conflict metadata is omitted', async () => {
    const { saveDocument } = await import('../document');

    await saveDocument('/tmp/demo.md', '# Updated');

    expect(invokeCommandMock).toHaveBeenCalledWith(TAURI_COMMANDS.saveDocument, {
      path: '/tmp/demo.md',
      content: '# Updated',
      expectedContentHash: undefined,
      force: false,
      layout: null,
    });
  });

  it('互链创建文档始终使用只创建语义，竞态下也不强覆盖', () => {
    const editor = readFileSync(
      resolve(__dirname, '../../../components/Editor/MarkdownEditor.vue'),
      'utf8',
    );

    expect(editor).not.toContain('saveDocument(resolved, initialContent, 0, false)');
    expect(editor.match(/saveDocument\(resolved, initialContent, null, false\)/g)).toHaveLength(2);
  });

  it('routes document image operations through their native commands', async () => {
    const { authorizeImageAsset, importDocumentImage } = await import(
      '../document'
    );

    await importDocumentImage('/tmp/image.png', '/tmp/demo.md');
    await authorizeImageAsset('/tmp/image.png', '/tmp/demo.md');

    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      1,
      TAURI_COMMANDS.importDocumentImage,
      {
        sourcePath: '/tmp/image.png',
        documentPath: '/tmp/demo.md',
        storageDir: null,
      },
    );
    expect(invokeCommandMock).toHaveBeenNthCalledWith(
      2,
      TAURI_COMMANDS.authorizeImageAsset,
      {
        path: '/tmp/image.png',
        documentPath: '/tmp/demo.md',
      },
    );
  });

  it('fetches remote images through the native image command', async () => {
    const { fetchRemoteImageData } = await import('../document');

    await fetchRemoteImageData('https://example.com/image.png');

    expect(invokeCommandMock).toHaveBeenCalledWith(TAURI_COMMANDS.fetchRemoteImage, {
      url: 'https://example.com/image.png',
    });
  });
});
