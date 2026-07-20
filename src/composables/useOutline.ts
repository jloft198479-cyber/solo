import { ref } from 'vue';

/**
 * 右侧大纲侧栏的 UI 状态。
 *
 * 仅管「开/关」这一类纯视图状态；大纲数据（items）来自编辑器更新，
 * 由 useAppEditorState 存储后经 props 传入 OutlinePanel。
 *
 * 设计约束（见 ui-optimization-proposal.md D1–D5）：
 * - 默认收起，用户主动唤出（沉浸式写作时落笔点最干净）
 * - 展开用 push（编辑区让位），由 App.vue 布局 + OutlinePanel 宽度动画实现
 */
export function useOutline() {
  const isOpen = ref(false);

  function toggle() {
    isOpen.value = !isOpen.value;
  }

  function open() {
    isOpen.value = true;
  }

  function close() {
    isOpen.value = false;
  }

  return {
    isOpen,
    toggle,
    open,
    close,
  };
}
