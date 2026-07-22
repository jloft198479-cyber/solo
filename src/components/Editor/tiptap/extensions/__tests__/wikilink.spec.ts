import { describe, expect, it } from 'vitest';
import { resolveWikilinkTarget } from '../wikilink';

describe('resolveWikilinkTarget', () => {
  it('resolves a bare target to a .md file in the same directory (Windows \\)', () => {
    expect(resolveWikilinkTarget('F:\\notes\\A.md', 'B')).toBe('F:\\notes\\B.md');
  });

  it('resolves a bare target to a .md file in the same directory (POSIX /)', () => {
    expect(resolveWikilinkTarget('/home/user/notes/A.md', 'B')).toBe('/home/user/notes/B.md');
  });

  it('keeps an explicit extension instead of appending .md', () => {
    expect(resolveWikilinkTarget('F:\\notes\\A.md', 'B.markdown')).toBe('F:\\notes\\B.markdown');
  });

  it('resolves a subfolder target and normalizes separators to the current path style', () => {
    expect(resolveWikilinkTarget('F:\\notes\\A.md', 'sub/B')).toBe('F:\\notes\\sub\\B.md');
    expect(resolveWikilinkTarget('/home/user/notes/A.md', 'sub\\B')).toBe('/home/user/notes/sub/B.md');
  });

  it('trims surrounding whitespace from the target', () => {
    expect(resolveWikilinkTarget('F:\\notes\\A.md', '  B  ')).toBe('F:\\notes\\B.md');
  });

  it('returns null when the current document is unsaved (null / empty path)', () => {
    expect(resolveWikilinkTarget(null, 'B')).toBeNull();
    expect(resolveWikilinkTarget(undefined, 'B')).toBeNull();
    expect(resolveWikilinkTarget('', 'B')).toBeNull();
  });

  it('returns null for an empty or whitespace-only target', () => {
    expect(resolveWikilinkTarget('F:\\notes\\A.md', '')).toBeNull();
    expect(resolveWikilinkTarget('F:\\notes\\A.md', '   ')).toBeNull();
  });

  it('returns null when the current path has no directory separator', () => {
    expect(resolveWikilinkTarget('A.md', 'B')).toBeNull();
  });
});
