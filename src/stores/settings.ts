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
  /** Font size (px) */
  fontSize: number;
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
  /** Editor line height */
  lineHeight: number;
  /** Export theme */
  wechatTheme: string;
  /** Custom shortcuts */
  customShortcuts: Record<string, string>;
  /** Custom editor CSS */
  customEditorCSS: string;
  /** Window always on top */
  alwaysOnTop: boolean;
  /** Config version */
  configVersion: number;
}
const DEFAULT_SETTINGS: Settings = {
  activeThemeId: 'scholar-light',
  customThemes: [],
  fontSize: 16,
  fontFamily: 'Microsoft YaHei UI',
  autoSave: false,
  autoSaveInterval: 30,
  spellCheck: true,
  titlebarAutoHide: true,
  lineHeight: 1.6,
  wechatTheme: 'scholar',
  customShortcuts: {},
  customEditorCSS: '',
  alwaysOnTop: false,
  configVersion: 7,
};

const CURRENT_CONFIG_VERSION = 7;

/** 自动保存间隔下限（秒），防止配置异常导致过于频繁的保存 */
const MIN_AUTOSAVE_INTERVAL_SECONDS = 5;

export function normalizeSettings(storedSettings?: Partial<Settings> | null): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...storedSettings };
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
  pendingTab: string;
  // 以下为非响应式内部状态（仅用于防抖/生命周期管理，不参与渲染）
  _saveTimeout: ReturnType<typeof setTimeout> | null;
  _stopSettingsWatcher: WatchStopHandle | null;
  _stopThemeWatcher: WatchStopHandle | null;
  _stopActiveThemeIdWatcher: WatchStopHandle | null;
  _stopFocusModeWatcher: WatchStopHandle | null;
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
    pendingTab: '',
    _saveTimeout: null,
    _stopSettingsWatcher: null,
    _stopThemeWatcher: null,
    _stopActiveThemeIdWatcher: null,
    _stopFocusModeWatcher: null,
  }),

  actions: {
    async saveSettingsToStore(newSettings: Settings) {
      if (!this.isLoaded) {
        return;
      }

      if (this._saveTimeout) {
        clearTimeout(this._saveTimeout);
      }

      this._saveTimeout = setTimeout(async () => {
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
      const fallbackId = fallbackAppearance === 'dark' ? 'scholar-dark' : 'default-light';
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
    },

    updateCustomTheme(themeId: ThemeId, updatedTheme: AppTheme) {
      const index = this.settings.customThemes.findIndex((theme) => theme.id === themeId);
      if (index === -1) {
        return;
      }

      this.settings.customThemes[index] = {
        ...updatedTheme,
        id: themeId,
        type: 'custom',
      };
      this.updateAllThemes();

      if (this.settings.activeThemeId === themeId) {
        this.applyCurrentTheme(themeId);
      }
    },

    removeCustomTheme(themeId: ThemeId) {
      const index = this.settings.customThemes.findIndex((theme) => theme.id === themeId);
      if (index === -1) {
        return;
      }

      this.settings.customThemes.splice(index, 1);
      this.updateAllThemes();

      if (this.settings.activeThemeId === themeId) {
        this.setColorTheme(DEFAULT_SETTINGS.activeThemeId);
      }
    },

    startWatchers() {
      if (!this._stopSettingsWatcher) {
        // deep watch 负责持久化，不再调用 updateAllThemes
        this._stopSettingsWatcher = watch(
          () => this.settings,
          (newSettings) => {
            void this.saveSettingsToStore(newSettings);
          },
          { deep: true },
        );
      }

      // customThemes 变化时才重建主题数组
      if (!this._stopThemeWatcher) {
        this._stopThemeWatcher = watch(
          () => this.settings.customThemes,
          () => {
            this.updateAllThemes();
          },
          { deep: true },
        );
      }

      // 主题切换单独监听，仅 activeThemeId 变化时才重注入 CSS 变量
      if (!this._stopActiveThemeIdWatcher) {
        this._stopActiveThemeIdWatcher = watch(
          () => this.settings.activeThemeId,
          (themeId) => {
            this.applyCurrentTheme(themeId);
          },
        );
      }

      if (!this._stopFocusModeWatcher) {
        this._stopFocusModeWatcher = watch(
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

    openModal(tab?: string) {
      this.pendingTab = tab || '';
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
