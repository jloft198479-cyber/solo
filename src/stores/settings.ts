import { defineStore } from 'pinia';
import { watch, type WatchStopHandle } from 'vue';
import type { Theme as AppTheme, ThemeId } from '../themes/types';
import { applyTheme, generateThemeId, getAllPresetThemes, getTheme } from '../themes/manager';
import {
  readStoredFocusMode,
  readStoredSettings,
  writeStoredFocusMode,
  writeStoredSettings,
} from '../services/tauri/store';
import { setCurrentWindowAlwaysOnTop } from '../services/tauri/window';

export interface Settings {
  /** Current app theme ID */
  activeThemeId: ThemeId;
  /** Custom themes */
  customThemes: AppTheme[];
  /** Font size (px). null = use current theme's typography default. */
  fontSize: number | null;
  /** Font family */
  fontFamily: string;
  /** Auto save */
  autoSave: boolean;
  /** Auto save interval in seconds */
  autoSaveInterval: number;
  /** Spell check */
  spellCheck: boolean;
  /** Titlebar auto-hide (false = always visible) */
  titlebarAutoHide: boolean;
  /** Editor line height. null = use current theme's typography default. */
  lineHeight: number | null;
  /** Custom shortcuts */
  customShortcuts: Record<string, string>;
  /** Window always on top */
  alwaysOnTop: boolean;
  /** Custom image storage directory (empty = use assets/ next to document) */
  imageStoragePath: string;
  /** Windows shell integration: register .md file association and right-click "New" menu */
  shellIntegration: boolean;
  /** Auto check for updates on startup */
  enableAutoUpdateCheck: boolean;
  /** Config version */
  configVersion: number;
}
const DEFAULT_SETTINGS: Settings = {
  activeThemeId: 'scholar-light',
  customThemes: [],
  fontSize: null,
  fontFamily: 'Microsoft YaHei UI',
  autoSave: false,
  autoSaveInterval: 30,
  spellCheck: true,
  titlebarAutoHide: false,
  lineHeight: null,
  customShortcuts: {},
  alwaysOnTop: false,
  imageStoragePath: '',
  shellIntegration: false,
  enableAutoUpdateCheck: true,
  configVersion: 12,
};

const CURRENT_CONFIG_VERSION = 12;

/** v11 之前的排版默认值，迁移时用于判断用户是否主动修改过 */
const LEGACY_FONT_SIZE = 16;
const LEGACY_LINE_HEIGHT = 1.6;

/** 自动保存间隔下限（秒），防止配置异常导致过于频繁的保存 */
const MIN_AUTOSAVE_INTERVAL_SECONDS = 5;

// 非响应式内部状态（不参与渲染，避免写入 reactive 触发无谓通知）
let _saveTimeout: ReturnType<typeof setTimeout> | null = null;
let _stopSettingsWatcher: WatchStopHandle | null = null;
let _stopActiveThemeIdWatcher: WatchStopHandle | null = null;
let _stopFocusModeWatcher: WatchStopHandle | null = null;

export function normalizeSettings(storedSettings?: Partial<Settings> | null): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...storedSettings };

  // v12 迁移：排版默认值从硬编码数字改为 null（使用主题默认值）
  const storedVersion = storedSettings?.configVersion ?? 0;
  if (storedVersion < 12) {
    if (merged.fontSize === LEGACY_FONT_SIZE) {
      merged.fontSize = null;
    }
    if (merged.lineHeight === LEGACY_LINE_HEIGHT) {
      merged.lineHeight = null;
    }
  }

  return {
    ...merged,
    autoSaveInterval: Math.max(merged.autoSaveInterval, MIN_AUTOSAVE_INTERVAL_SECONDS),
    configVersion: CURRENT_CONFIG_VERSION,
  };
}

interface SettingsStoreState {
  settings: Settings;
  isModalOpen: boolean;
  isFocusMode: boolean;
  isLoaded: boolean;
  presetThemes: AppTheme[];
  allThemes: AppTheme[];
  currentTheme: AppTheme | null;
}

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsStoreState => ({
    settings: normalizeSettings(),
    isModalOpen: false,
    isFocusMode: false,
    isLoaded: false,
    presetThemes: getAllPresetThemes(),
    allThemes: [],
    currentTheme: null,
  }),

  actions: {
    async saveSettingsToStore(newSettings: Settings) {
      if (!this.isLoaded) {
        return;
      }

      if (_saveTimeout) {
        clearTimeout(_saveTimeout);
      }

      _saveTimeout = setTimeout(async () => {
        try {
          await writeStoredSettings({
            ...newSettings,
            configVersion: CURRENT_CONFIG_VERSION,
          });
        } catch (error) {
          console.error('[Settings] 保存配置失败:', error);
        }
      }, 300);
    },

    async loadSettingsFromStore(): Promise<void> {
      let shouldPersistNormalizedState: boolean;

      try {
        const [storedSettings, storedFocusMode] = await Promise.all([
          readStoredSettings<Partial<Settings>>(),
          readStoredFocusMode(),
        ]);

        if (storedSettings) {
          this.settings = normalizeSettings(storedSettings);
          shouldPersistNormalizedState =
            (storedSettings.configVersion ?? 0) !== CURRENT_CONFIG_VERSION;
          if (storedFocusMode !== undefined) {
            this.isFocusMode = storedFocusMode;
          } else {
            this.isFocusMode = false;
            shouldPersistNormalizedState = true;
          }
        } else {
          this.settings = normalizeSettings();
          this.isFocusMode = false;
          shouldPersistNormalizedState = true;
        }

        if (shouldPersistNormalizedState) {
          await Promise.all([
            writeStoredSettings(this.settings),
            writeStoredFocusMode(this.isFocusMode),
          ]);
        }
      } catch (error) {
        console.error('[Settings] 加载配置失败:', error);
        this.settings = normalizeSettings();
        this.isFocusMode = false;
        try {
          await Promise.all([
            writeStoredSettings(this.settings),
            writeStoredFocusMode(this.isFocusMode),
          ]);
        } catch (saveError) {
          console.error('[Settings] 保存配置失败:', saveError);
        }
      }

      this.isLoaded = true;
    },

    updateAllThemes() {
      this.allThemes = [...this.presetThemes, ...this.settings.customThemes];
    },

    ensureThemeId(themeId: ThemeId): ThemeId {
      const theme = getTheme(themeId, this.settings.customThemes);
      if (theme) {
        return theme.id;
      }

      const fallbackAppearance = this.currentTheme?.appearance ?? 'light';
      const fallbackId = fallbackAppearance === 'dark' ? 'scholar-dark' : DEFAULT_SETTINGS.activeThemeId;
      return getTheme(fallbackId, this.settings.customThemes)
        ? fallbackId
        : DEFAULT_SETTINGS.activeThemeId;
    },

    applyCurrentTheme(themeId: ThemeId) {
      const resolvedThemeId = this.ensureThemeId(themeId);
      if (resolvedThemeId !== this.settings.activeThemeId) {
        this.settings.activeThemeId = resolvedThemeId;
      }

      const theme = getTheme(resolvedThemeId, this.settings.customThemes);
      if (!theme) {
        return;
      }

      this.currentTheme = theme;
      applyTheme(theme);

      // 主题排版注入后，重新应用用户自定义的字号/行高（覆盖主题默认值）
      const style = document.documentElement.style;
      if (this.settings.fontSize != null) {
        style.setProperty('--mk-font-size', `${this.settings.fontSize}px`);
      }
      if (this.settings.lineHeight != null) {
        style.setProperty('--mk-line-height', String(this.settings.lineHeight));
      }
    },

    setColorTheme(themeId: ThemeId) {
      this.settings.activeThemeId = themeId;
      this.applyCurrentTheme(themeId);
    },

    addCustomTheme(theme: AppTheme) {
      const nextTheme: AppTheme = {
        ...theme,
        id: theme.id || generateThemeId(),
        type: 'custom',
      };
      this.settings.customThemes.push(nextTheme);
      this.updateAllThemes();
      void this.saveSettingsToStore(this.settings);
    },

    removeCustomTheme(themeId: ThemeId) {
      const index = this.settings.customThemes.findIndex((theme) => theme.id === themeId);
      if (index === -1) {
        return;
      }

      this.settings.customThemes.splice(index, 1);
      this.updateAllThemes();
      void this.saveSettingsToStore(this.settings);

      if (this.settings.activeThemeId === themeId) {
        this.setColorTheme(DEFAULT_SETTINGS.activeThemeId);
      }
    },

    startWatchers() {
      if (!_stopSettingsWatcher) {
        // 精确 watch 需持久化的顶层字段（不 watch customThemes，由 action 触发持久化）
        _stopSettingsWatcher = watch(
          [
            () => this.settings.activeThemeId,
            () => this.settings.fontSize,
            () => this.settings.fontFamily,
            () => this.settings.lineHeight,
            () => this.settings.autoSave,
            () => this.settings.autoSaveInterval,
            () => this.settings.spellCheck,
            () => this.settings.titlebarAutoHide,
            () => this.settings.customShortcuts,
            () => this.settings.alwaysOnTop,
            () => this.settings.imageStoragePath,
            () => this.settings.shellIntegration,
            () => this.settings.enableAutoUpdateCheck,
          ],
          () => {
            void this.saveSettingsToStore(this.settings);
          },
        );
      }

      // customThemes 由 addCustomTheme / removeCustomTheme action 触发持久化，无需 watcher

      // 主题切换单独监听，仅 activeThemeId 变化时才重注入 CSS 变量
      if (!_stopActiveThemeIdWatcher) {
        _stopActiveThemeIdWatcher = watch(
          () => this.settings.activeThemeId,
          (themeId) => {
            this.applyCurrentTheme(themeId);
          },
        );
      }

      if (!_stopFocusModeWatcher) {
        _stopFocusModeWatcher = watch(
          () => this.isFocusMode,
          (value) => {
            if (this.isLoaded) {
              void writeStoredFocusMode(value).catch((error) => {
                console.error('[Settings] 保存 focus mode 配置失败:', error);
              });
            }
            this.applyFocusMode(value);
          },
        );
      }
    },

    applyFocusMode(enabled: boolean) {
      document.documentElement.classList.toggle('focus-mode', enabled);
    },

    toggleFocusMode() {
      this.isFocusMode = !this.isFocusMode;
    },

    async toggleAlwaysOnTop(): Promise<void> {
      const next = !this.settings.alwaysOnTop;
      try {
        await setCurrentWindowAlwaysOnTop(next);
        this.settings.alwaysOnTop = next;
      } catch (error) {
        console.error('[Settings] 切换置顶失败:', error);
      }
    },

    updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
      this.settings[key] = value;
    },

    updateSettings(newSettings: Partial<Settings>) {
      this.settings = normalizeSettings({
        ...this.settings,
        ...newSettings,
      });
    },

    resetSettings() {
      this.settings = normalizeSettings();
    },

  openModal() {
    this.isModalOpen = true;
  },

    closeModal() {
      this.isModalOpen = false;
    },

    initTheme() {
      this.updateAllThemes();
      this.applyCurrentTheme(this.settings.activeThemeId);
    },

    initFocusMode() {
      this.applyFocusMode(this.isFocusMode);
    },

    async init() {
      await this.loadSettingsFromStore();
      this.startWatchers();
      this.initTheme();
      this.initFocusMode();
      this.initAlwaysOnTop();
    },

    initAlwaysOnTop() {
      if (!this.isLoaded) return;
      setCurrentWindowAlwaysOnTop(this.settings.alwaysOnTop)
        .catch((error) => {
          console.error('[Settings] 恢复置顶状态失败:', error);
        });
    },
  },
});
