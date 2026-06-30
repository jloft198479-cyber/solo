<template>
  <Transition name="mk-menu" :appear="true">
    <div
      v-show="visible"
      ref="menuRef"
      class="mk-slash-menu mk-emoji-menu"
      :style="{ top: position.top + 'px', left: position.left + 'px' }"
    >
    <div class="mk-slash-menu-scroll">
      <div
        v-for="(item, idx) in items"
        :key="item.emoji + item.name"
        class="mk-slash-menu-item mk-emoji-menu-item"
        :class="{ 'mk-slash-menu-item--active': idx === selectedIndex }"
        @mouseenter="selectedIndex = idx"
        @click="selectItem(idx)"
      >
        <span class="mk-emoji-menu-icon">{{ item.emoji }}</span>
        <span class="mk-emoji-menu-name">{{ item.name }}</span>
      </div>
      <div v-if="items.length === 0" class="mk-slash-menu-empty">没有匹配的表情</div>
    </div>
  </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { EmojiItem } from '../tiptap/extensions/emoji-suggest';
import { useFloatingListMenu } from '../../../composables/useFloatingListMenu';

const props = defineProps<{
  items: EmojiItem[];
  command: (item: EmojiItem) => void;
}>();

const menuRef = ref<HTMLElement>();

const {
  visible,
  position,
  selectedIndex,
  selectItem,
  onKeyDown,
  show,
  hide,
} = useFloatingListMenu<EmojiItem>({
  items: () => props.items,
  command: () => props.command,
  menuRef,
});

defineExpose({ show, hide, onKeyDown });
</script>
