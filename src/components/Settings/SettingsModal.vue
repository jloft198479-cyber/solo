<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import { useSettingsStore, type SettingsTabKey } from '../../stores/settings';
import { confirm } from '../../services/tauri/dialog';
import AppearanceSettingsPanel from './AppearanceSettingsPanel.vue';
import CloseIcon from '../icons/CloseIcon.vue';
import EditorSettingsPanel from './EditorSettingsPanel.vue';
import SaveSettingsPanel from './SaveSettingsPanel.vue';
import SettingsSidebarNav from './SettingsSidebarNav.vue';
import ShortcutSettingsPanel from './ShortcutSettingsPanel.vue';
import AboutSettingsPanel from './AboutSettingsPanel.vue';

const settingsStore = useSettingsStore();

// 当前选中的设置分组；每次弹窗打开时按入口指定分组落地（如菜单「关于」直达 about）
const activeTab = ref<SettingsTabKey>(settingsStore.modalInitialTab);

// 关闭弹窗
function close() {
  settingsStore.closeModal();
}

const overlayRef = ref<HTMLElement | null>(null);
const dialogRef = ref<HTMLElement | null>(null);
/** 打开前的焦点位置，关闭时归还（弹窗由齿轮 / 菜单 / 快捷键等多个入口唤起） */
let lastFocused: HTMLElement | null = null;

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 弹窗内可聚焦元素；display / visibility 隐藏的（如主题导入用的 file input）不算 */
function focusableItems(): HTMLElement[] {
  const root = dialogRef.value;
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

/** 焦点是否已在更上层的浮层里（如设置打开时又唤起命令面板）—— 是则让位，不抢焦点 */
function focusInOtherLayer(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  return (
    active !== document.body && active !== overlayRef.value && !dialogRef.value?.contains(active)
  );
}

/**
 * 键盘策略（设计规范化 2026-10-17 · A1）：
 * - 捕获阶段挂在 document 上 ⇒ 不依赖焦点落在谁身上。原实现把 @keydown 挂在遮罩上，
 *   而组件从未 focus 过任何元素 ⇒ 键盘事件永远到不了遮罩，Esc 是死的。
 * - Esc 拦截后 stopPropagation：模态优先，避免同一次 Esc 顺手退掉焦点模式（全局链在 window 冒泡阶段）。
 * - 快捷键录制中（data-shortcut-capture）不接管：那里 Esc = 取消录制，与 useAppDomEvents 同一约定。
 * - 焦点在更上层浮层时让位给更上层，避免把命令面板的焦点抢回弹窗。
 */
function onKeyDown(e: KeyboardEvent) {
  if (!settingsStore.isModalOpen) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest?.('[data-shortcut-capture="true"]')) return;

  if (e.key === 'Escape') {
    if (focusInOtherLayer()) return;
    e.preventDefault();
    e.stopPropagation();
    close();
    return;
  }
  if (e.key !== 'Tab' || focusInOtherLayer()) return;

  const items = focusableItems();
  const root = dialogRef.value;
  if (!items.length || !root) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement as HTMLElement | null;
  // 焦点还在容器本身 / 漏到窗外 ⇒ 直接拉回边界
  if (!active || active === root || !root.contains(active)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
    return;
  }
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

watch(
  () => settingsStore.isModalOpen,
  async (open) => {
    if (open) {
      lastFocused = document.activeElement as HTMLElement | null;
      activeTab.value = settingsStore.modalInitialTab;
      document.addEventListener('keydown', onKeyDown, true);
      await nextTick();
      dialogRef.value?.focus();
    } else {
      document.removeEventListener('keydown', onKeyDown, true);
      const el = lastFocused;
      lastFocused = null;
      if (el?.isConnected) el.focus();
    }
  },
  { immediate: true },
);

onUnmounted(() => document.removeEventListener('keydown', onKeyDown, true));

const tabMeta = {
  appearance: {
    title: '外观与主题',
    description: '管理应用主题、字体与排版风格，让界面更贴近你的使用习惯。',
  },
  editor: {
    title: '编辑器偏好',
    description: '调整编辑器行为、显示细节和写作体验相关设置。',
  },
  shortcuts: {
    title: '快捷键',
    description: '查看并修改命令快捷键，建立更顺手的操作路径。',
  },
  save: {
    title: '保存策略',
    description: '控制自动保存与文件持久化行为。',
  },
  about: {
    title: '关于',
    description: '作者：简乐（微信：fzz198479），给儿子小柏的一个纪念。',
  },
} as const;

const activeTabMeta = computed(() => tabMeta[activeTab.value]);

// 点击遮罩关闭
function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    close();
  }
}

// 重置设置
async function handleReset() {
  const confirmed = await confirm('确定要恢复默认设置吗？', {
    title: '恢复默认',
    kind: 'warning',
    okLabel: '恢复',
    cancelLabel: '取消',
  });
  if (confirmed) {
    settingsStore.resetSettings();
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="settingsStore.isModalOpen"
        ref="overlayRef"
        class="settings-modal-overlay fixed inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm"
        tabindex="-1"
        @click="onOverlayClick"
      >
        <div
          ref="dialogRef"
          class="settings-modal__dialog shadow-2xl w-[1040px] max-w-[94vw] max-h-[84vh] overflow-hidden flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-modal-title"
          tabindex="-1"
          @click.stop
        >
          <!-- 头部 -->
          <div class="settings-modal-header">
            <h2 id="settings-modal-title" class="settings-modal-title">设置</h2>
            <button class="settings-close-btn" @click="close">
              <CloseIcon class="settings-close-icon" />
            </button>
          </div>

          <!-- 主体 -->
          <div class="flex flex-1 overflow-hidden settings-shell">
            <!-- 侧边导航 -->
            <SettingsSidebarNav v-model="activeTab" />

            <!-- 设置内容 -->
            <div
              class="flex-1 overflow-y-auto settings-content-area settings-modal__content"
            >
              <div class="settings-content">
                <div class="settings-page-header">
                  <div>
                    <h3 class="settings-page-title">{{ activeTabMeta.title }}</h3>
                    <p class="settings-page-desc">{{ activeTabMeta.description }}</p>
                  </div>
                </div>

                <!-- 外观设置 -->
                <AppearanceSettingsPanel
                  v-if="activeTab === 'appearance'"
                  v-model:font-family="settingsStore.settings.fontFamily"
                />

                <!-- 编辑器设置 -->
                <EditorSettingsPanel
                  v-else-if="activeTab === 'editor'"
                  v-model:spell-check="settingsStore.settings.spellCheck"
                  v-model:titlebar-auto-hide="settingsStore.settings.titlebarAutoHide"
                />

                <!-- 快捷键设置 -->
                <ShortcutSettingsPanel v-else-if="activeTab === 'shortcuts'" />

                <!-- 保存设置 -->
                <SaveSettingsPanel
                  v-else-if="activeTab === 'save'"
                  v-model:auto-save="settingsStore.settings.autoSave"
                  v-model:auto-save-interval="settingsStore.settings.autoSaveInterval"
                  v-model:image-storage-path="settingsStore.settings.imageStoragePath"
                  v-model:shell-integration="settingsStore.settings.shellIntegration"
                />

                <!-- 关于 -->
                <AboutSettingsPanel
                  v-else-if="activeTab === 'about'"
                  v-model:enable-auto-update-check="settingsStore.settings.enableAutoUpdateCheck"
                />
              </div>
            </div>
          </div>

          <!-- 底部 -->
          <div class="settings-footer">
            <button class="settings-footer-reset" @click="handleReset">恢复默认</button>
            <button class="settings-footer-done" @click="close">完成</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--motion-base) var(--ease-out);
}

.modal-enter-active > div,
.modal-leave-active > div {
  transition:
    transform var(--motion-base) var(--ease-out),
    opacity var(--motion-base) var(--ease-out);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from > div,
.modal-leave-to > div {
  transform: scale(0.95);
  opacity: 0;
}

.settings-shell {
  min-height: 0;
}

.settings-modal__dialog {
  background-color: var(--bg-color);
  color: var(--text-color);
  /* 直角语言：弹窗容器完全直角（替代原先 Tailwind rounded-lg 硬编码，与项目 token 体系一致） */
  border-radius: 0;
}

/* 模态层：必须高于标题栏（--z-titlebar: 200），否则遮罩顶部漏出 48px、标题栏按钮在"模态"里照样可点 */
.settings-modal-overlay {
  z-index: var(--z-modal);
}

/* 容器只是打开时的焦点落点，不是可操作元素 —— 不显示焦点环 */
.settings-modal__dialog:focus {
  outline: none;
}

.settings-modal__content {
  background-color: var(--bg-secondary);
}

.settings-content-area {
  min-width: 0;
}

.settings-content {
  width: min(100%, 760px);
  margin: 0 auto;
  padding: 28px 28px 32px;
}

/* ── 弹窗头部 ──────────────────────────────────── */
.settings-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 28px;
  border-bottom: 1px solid var(--border-color);
}

.settings-modal-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-color);
}

.settings-close-btn {
  padding: 4px;
  border-radius: var(--radius-md);
  color: var(--muted-color);
  transition:
    background-color var(--motion-fast),
    color var(--motion-fast);
}

.settings-close-btn:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.settings-close-icon {
  width: 20px;
  height: 20px;
}

/* ── 页面标题 ──────────────────────────────────── */
.settings-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.settings-page-title {
  margin: 0;
  color: var(--text-color);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.settings-page-desc {
  margin: 8px 0 0;
  color: var(--muted-color);
  font-size: 14px;
  line-height: 1.7;
}

/* ── 弹窗底部 ──────────────────────────────────── */
.settings-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 28px;
  border-top: 1px solid var(--border-color);
  background-color: var(--sidebar-bg);
}

.settings-footer-reset {
  padding: 8px 16px;
  font-size: 14px;
  color: var(--muted-color);
  transition: color var(--motion-fast);
}

.settings-footer-done {
  padding: 8px 24px;
  border-radius: var(--radius-lg);
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
  font-size: 14px;
  font-weight: 500;
  transition: background-color var(--motion-fast);
}

.settings-footer-done:hover {
  background: var(--btn-primary-hover);
}

@media (max-width: 960px) {
  .settings-page-header {
    flex-direction: column;
  }
}

</style>
