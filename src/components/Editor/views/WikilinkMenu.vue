<template>
  <Transition name="mk-menu" :appear="true">
    <div
      v-show="visible"
      ref="menuRef"
      class="mk-slash-menu mk-wikilink-menu"
      :style="{ top: position.top + 'px', left: position.left + 'px' }"
    >
      <div class="mk-slash-menu-scroll">
        <div
          v-for="(item, idx) in items"
          :key="item.fileName"
          class="mk-slash-menu-item mk-wikilink-menu-item"
          :class="{ 'mk-slash-menu-item--active': idx === selectedIndex }"
          @mouseenter="selectedIndex = idx"
          @click="selectItem(idx)"
        >
          <span class="mk-wikilink-menu-name">{{ item.target }}</span>
        </div>
        <div v-if="items.length === 0" class="mk-slash-menu-empty">无匹配文档</div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { WikilinkCandidateItem } from '../tiptap/extensions/wikilink-suggest';
import { useFloatingListMenu } from '../../../composables/useFloatingListMenu';

const props = defineProps<{
  items: WikilinkCandidateItem[];
  command: (item: WikilinkCandidateItem) => void;
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
} = useFloatingListMenu<WikilinkCandidateItem>({
  items: () => props.items,
  command: () => props.command,
  menuRef,
});

defineExpose({ show, hide, onKeyDown });
</script>
