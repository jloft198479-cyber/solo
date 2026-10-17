<template>
  <Transition name="mk-menu" :appear="true">
    <div
      v-show="visible"
      ref="menuRef"
      class="bubble-menu"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px`, transform: menuTransform }"
      @mousedown.prevent
      @click.stop
    >
    <!-- 主工具栏 -->
    <div class="bubble-menu-toolbar">
      <button :class="btnClass(activeMarks.bold)" title="加粗" @click="exec('bold')">
        <span class="font-bold text-lg">B</span>
      </button>
      <button :class="btnClass(activeMarks.italic)" title="斜体" @click="exec('italic')">
        <span class="italic text-lg">I</span>
      </button>
      <button :class="btnClass(activeMarks.code)" title="行内代码" @click="exec('code')">
        <Icon name="code" :size="16" />
      </button>
      <button :class="btnClass(activeMarks.dim)" title="文字变浅" @click="exec('dim')">
        <span class="dim-icon">A</span>
      </button>
      <button :class="btnClass(activeMarks.link)" title="链接" @click="toggleLinkInput">
        <Icon name="link" :size="16" />
      </button>
      <div class="bubble-menu-divider"></div>
      <button :class="btnClass(activeMarks.bulletList)" title="无序列表" @click="exec('bulletList')">
        <Icon name="bulletList" :size="16" />
      </button>
      <div class="bubble-menu-divider"></div>
      <button class="bubble-menu-heading-btn" title="标题 1" @click="exec('h1')">
        <Icon name="heading1" :size="16" />
      </button>
      <button class="bubble-menu-heading-btn" title="标题 2" @click="exec('h2')">
        <Icon name="heading2" :size="16" />
      </button>
      <div class="bubble-menu-divider"></div>
      <button class="bubble-menu-clear-btn" title="清除格式" @click="exec('clearFormat')">
        <Icon name="eraser" :size="16" />
      </button>
    </div>

    <!-- 链接输入区 -->
    <div v-if="showLinkInput" class="bubble-menu-link-section">
      <input
        ref="linkInputRef"
        v-model="linkUrl"
        type="url"
        placeholder="输入链接地址..."
        class="bubble-menu-input"
        @keydown.enter="applyLink"
        @keydown.escape.stop="cancelLink"
      />
      <button class="bubble-menu-btn-primary" @click="applyLink">
        确定
      </button>
      <button v-if="activeMarks.link" class="bubble-menu-btn-danger" @click="removeLink">
        移除
      </button>
    </div>
  </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, reactive, nextTick, computed } from 'vue';
import Icon from '../../icons/Icon';

type BubbleMenuActionData = {
  href?: string;
};

type ActiveMarks = {
  bold: boolean;
  italic: boolean;
  code: boolean;
  link: boolean;
  bulletList: boolean;
  dim: boolean;
};

const emit = defineEmits<{
  (e: 'action', type: string, data?: BubbleMenuActionData): void;
}>();

const visible = ref(false);
const menuRef = ref<HTMLElement | null>(null);
const pos = reactive({ left: 0, top: 0 });

// 顶部菜单栏高度（CustomTitlebar 48px）+ 菜单自身高度约 44px + 缓冲，低于此阈值时向下翻转
const TOP_FLIP_THRESHOLD = 100;
// 视觉左缘 = pos.left + translateX；与 menuTransform 中的 X 偏移必须同源
const MENU_OFFSET_X = 8;
// 菜单与视口左右缘的最小间距
const VIEWPORT_EDGE_MARGIN = 8;

const menuTransform = computed(() =>
  pos.top < TOP_FLIP_THRESHOLD
    ? `translate(${MENU_OFFSET_X}px, 16px)`
    : `translate(${MENU_OFFSET_X}px, -130%)`,
);

/**
 * 横向视口钳制：按菜单实测宽度（工具栏宽度随按钮数量/字体变化，估算会漏钳）
 * 把视觉左缘（pos.left + translateX）限制在 [margin, vw - margin] 内。
 * 必须在 nextTick 后调用：v-show 刚切到显示时才能量到真实宽度。
 */
function clampToViewport(anchorLeft: number) {
  const el = menuRef.value;
  if (!el || !visible.value) return;
  const width = el.offsetWidth;
  const minLeft = VIEWPORT_EDGE_MARGIN - MENU_OFFSET_X;
  const maxLeft = window.innerWidth - VIEWPORT_EDGE_MARGIN - width - MENU_OFFSET_X;
  const next = Math.min(Math.max(anchorLeft, minLeft), maxLeft);
  // 值不变不回写，选区拖动的每帧更新零额外渲染
  if (pos.left !== next) pos.left = next;
}

const activeMarks = reactive({
  bold: false,
  italic: false,
  code: false,
  link: false,
  bulletList: false,
  dim: false,
});

// 链接输入相关
const showLinkInput = ref(false);
const linkUrl = ref('');
const linkInputRef = ref<HTMLInputElement | null>(null);

const btnClass = (active: boolean) => [
  'bubble-menu-btn',
  active ? 'bubble-menu-btn--active' : '',
];

const exec = (type: string) => {
  emit('action', type);
};

// 切换链接输入区
const toggleLinkInput = () => {
  showLinkInput.value = !showLinkInput.value;
  if (showLinkInput.value) {
    nextTick(() => {
      linkInputRef.value?.focus();
    });
  }
};

// 应用链接
const applyLink = () => {
  if (linkUrl.value.trim()) {
    emit('action', 'link', { href: linkUrl.value.trim() });
  }
  showLinkInput.value = false;
  linkUrl.value = '';
};

// 移除链接
const removeLink = () => {
  emit('action', 'unlink');
  showLinkInput.value = false;
  linkUrl.value = '';
};

// 取消链接输入
const cancelLink = () => {
  showLinkInput.value = false;
  linkUrl.value = '';
};

// 暴露更新方法给插件调用
defineExpose({
  update(show: boolean, left: number, top: number, marks: Partial<ActiveMarks>, linkHref?: string) {
    visible.value = show;
    pos.left = left;
    pos.top = top;
    if (show) nextTick(() => clampToViewport(left));
    Object.assign(activeMarks, marks);

    // 如果已有链接，填充 URL
    if (linkHref) {
      linkUrl.value = linkHref;
    }

    // 关闭链接输入区（除非正在编辑链接）
    if (!marks.link) {
      showLinkInput.value = false;
      linkUrl.value = '';
    }
  },
});
</script>

<style scoped>
.bubble-menu {
  position: fixed;
  /* 编辑区浮层档：高于窗口 chrome(--z-chrome)，避免第一行编辑时被标题栏遮挡 */
  z-index: var(--z-editor-popup);
  display: flex;
  flex-direction: column;
  padding: var(--space-xs);
  background-color: var(--popover-bg);
  border: 1px solid var(--popover-border);
  border-radius: var(--radius-md);
  box-shadow: var(--popover-shadow);
  transition: opacity var(--motion-fast) ease, transform var(--motion-fast) ease;
}

.bubble-menu-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.bubble-menu-btn {
  display: flex;
  height: 32px;
  width: 32px;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-color);
  background-color: transparent;
  transition: background-color var(--motion-fast);
  cursor: pointer;
  border: none;
}

.bubble-menu-btn:hover {
  background-color: var(--hover-bg);
}

.bubble-menu-btn--active {
  background-color: var(--primary-light);
  color: var(--primary-color);
}

/* 文字变浅图标：未激活时用次要文字色（变浅语义），激活时随按钮变主色 */
.dim-icon {
  color: var(--muted-color);
}
.bubble-menu-btn--active .dim-icon {
  color: inherit;
}

.bubble-menu-divider {
  margin: 0 4px;
  height: 16px;
  width: 1px;
  background-color: var(--border-color);
}

.bubble-menu-heading-btn {
  /* 与工具栏其它按钮同尺寸：原来装的是「H1」文字（4px 8px 内边距 + 12px 字），
     2026-10-17 批 3 第 3 步换成图标后统一成 32×32 —— 否则同排按钮热区一大一小 */
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background-color: transparent;
  color: var(--text-color);
  cursor: pointer;
  border: none;
  transition: background-color var(--motion-fast);
}

.bubble-menu-heading-btn:hover {
  background-color: var(--hover-bg);
}

.bubble-menu-link-section {
  margin-top: var(--space-xs);
  padding-top: var(--space-xs);
  border-top: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.bubble-menu-input {
  width: 180px;
  padding: var(--space-xs) var(--space-md);
  font-size: 12px;
  background-color: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: var(--radius-sm);
  color: var(--text-color);
  outline: none;
}

.bubble-menu-input:focus {
  border-color: var(--input-focus-border);
  box-shadow: var(--input-focus-shadow);
}

.bubble-menu-input::placeholder {
  color: var(--input-placeholder);
}

.bubble-menu-btn-primary {
  padding: var(--space-xs) var(--space-md);
  font-size: 12px;
  background-color: var(--btn-primary-bg);
  color: var(--btn-primary-text);
  border-radius: var(--radius-sm);
  cursor: pointer;
  border: none;
  transition: background-color var(--motion-fast);
}

.bubble-menu-btn-primary:hover {
  background-color: var(--btn-primary-hover);
}

.bubble-menu-btn-danger {
  padding: var(--space-xs) var(--space-md);
  font-size: 12px;
  background-color: transparent;
  color: var(--error-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  border: none;
  transition: background-color var(--motion-fast);
}

.bubble-menu-btn-danger:hover {
  background-color: var(--error-bg);
}

.bubble-menu-clear-btn {
  display: flex;
  height: 32px;
  width: 32px;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  /* 用 --text-color 而非 --muted-color：与相邻按钮一致对比度，让按钮「看得见」 */
  color: var(--text-color);
  background-color: transparent;
  transition: background-color var(--motion-fast), color var(--motion-fast);
  cursor: pointer;
  border: none;
}

.bubble-menu-clear-btn:hover {
  background-color: var(--hover-bg);
  /* hover 切 error 色，暗示这是破坏性操作（去掉格式） */
  color: var(--error-color);
}
</style>
