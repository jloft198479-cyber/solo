import { describe, expect, it, vi } from 'vitest';
import {
  COMMANDS,
  formatShortcutDisplay,
  getMenuShortcuts,
  getShortcut,
  getShortcutGroups,
  getCommand,
} from '../registry';
import { isMac } from '../../utils/platform';

vi.mock('../../utils/platform', () => ({
  isMac: false,
}));

describe('command registry', () => {
  it('resolves custom shortcuts over defaults', () => {
    const command = getCommand('file.save');
    expect(command).toBeDefined();
    expect(getShortcut(command!, { 'file.save': 'Mod-Alt-s' })).toBe('Mod-Alt-s');
  });

  it('groups shortcut commands by registry group', () => {
    const groups = getShortcutGroups();
    expect(groups.some((group) => group.group === 'format')).toBe(true);
    expect(groups.some((group) => group.group === 'file')).toBe(true);
  });

  it('builds tauri menu accelerators from effective shortcuts', () => {
    const shortcuts = getMenuShortcuts({ 'view.focusMode': 'Mod-Shift-f' });
    expect(shortcuts['view.focusMode']).toBe('CmdOrCtrl+Shift+F');
    expect(shortcuts['file.save']).toBe('CmdOrCtrl+S');
  });

  it('keeps command ids unique and lookupable', () => {
    const ids = COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const id of ids) {
      expect(getCommand(id)?.id).toBe(id);
    }
  });

  it('keeps menu shortcuts limited to registered menu commands', () => {
    const menuCommandIds = new Set(
      COMMANDS.filter((command) => command.menuSection).map((command) => command.id),
    );
    const shortcutIds = Object.keys(getMenuShortcuts());

    expect(shortcutIds.length).toBeGreaterThan(0);
    for (const id of shortcutIds) {
      expect(menuCommandIds.has(id)).toBe(true);
    }
  });
});

describe('formatShortcutDisplay', () => {
  it('uppercases the final key on win/linux', () => {
    expect(isMac).toBe(false);
    expect(formatShortcutDisplay('Mod-s')).toBe('Ctrl+S');
    expect(formatShortcutDisplay('Mod-Shift-f')).toBe('Ctrl+Shift+F');
    expect(formatShortcutDisplay('Mod-Alt-F')).toBe('Ctrl+Alt+F');
    expect(formatShortcutDisplay('F11')).toBe('F11');
    expect(formatShortcutDisplay('Mod-Shift-7')).toBe('Ctrl+Shift+7');
  });
});
