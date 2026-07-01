import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  message: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  convertFileSrc: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: mocks.confirm,
  message: mocks.message,
  open: mocks.open,
  save: mocks.save,
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: mocks.convertFileSrc,
}));

describe('tauri plugin service wrappers', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('routes dialog calls through the dialog plugin', async () => {
    mocks.confirm.mockResolvedValueOnce(true);
    mocks.message.mockResolvedValueOnce(undefined);
    mocks.open.mockResolvedValueOnce('/tmp/demo.md');
    mocks.save.mockResolvedValueOnce('/tmp/export.html');

    const dialog = await import('../dialog');

    await expect(dialog.confirm('Discard?', { title: 'Confirm' })).resolves.toBe(true);
    await dialog.message('Done', { title: 'Status' });
    await expect(dialog.open({ multiple: false })).resolves.toBe('/tmp/demo.md');
    await expect(dialog.save({ defaultPath: 'export.html' })).resolves.toBe('/tmp/export.html');

    expect(mocks.confirm).toHaveBeenCalledWith('Discard?', { title: 'Confirm' });
    expect(mocks.message).toHaveBeenCalledWith('Done', { title: 'Status' });
    expect(mocks.open).toHaveBeenCalledWith({ multiple: false });
    expect(mocks.save).toHaveBeenCalledWith({ defaultPath: 'export.html' });
  });

  it('converts file paths through the asset helper', async () => {
    mocks.convertFileSrc.mockReturnValueOnce('asset://localhost/demo.png');

    const { toAssetUrl } = await import('../asset');

    expect(toAssetUrl('/tmp/demo.png')).toBe('asset://localhost/demo.png');
    expect(mocks.convertFileSrc).toHaveBeenCalledWith('/tmp/demo.png');
  });
});
