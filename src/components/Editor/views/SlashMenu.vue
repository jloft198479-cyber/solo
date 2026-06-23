<template>
  <div
    v-show="visible"
    ref="menuRef"
    class="mk-slash-menu"
    :style="{ top: position.top + 'px', left: position.left + 'px' }"
  >
    <div class="mk-slash-menu-scroll">
      <template v-for="(group, gIdx) in groupedItems" :key="gIdx">
        <div class="mk-slash-menu-group">{{ group.category }}</div>
        <div
          v-for="(item, idx) in group.items"
          :key="item.title"
          class="mk-slash-menu-item"
          :class="{ 'mk-slash-menu-item--active': flatIndex(gIdx, idx) === selectedIndex }"
          @mouseenter="selectedIndex = flatIndex(gIdx, idx)"
          @click="selectItem(flatIndex(gIdx, idx))"
        >
          <span class="mk-slash-menu-icon">{{ item.icon }}</span>
          <div class="mk-slash-menu-text">
            <div class="mk-slash-menu-title">{{ item.title }}</div>
            <div class="mk-slash-menu-desc">{{ item.description }}</div>
          </div>
        </div>
      </template>
      <div v-if="items.length === 0" class="mk-slash-menu-empty">没有匹配的命令</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { SlashCommandItem } from '../tiptap/extensions/slash-commands';
import { useFloatingListMenu } from '../../../composables/useFloatingListMenu';

const props = defineProps<{
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}>();

const menuRef = ref<HTMLElement>();

const groupedItems = computed(() => {
  const groups: { category: string; items: SlashCommandItem[] }[] = [];
  const map = new Map<string, SlashCommandItem[]>();
  for (const item of props.items) {
    if (!map.has(item.category)) map.set(item.category, []);
    map.get(item.category)!.push(item);
  }
  for (const [category, items] of map) {
    groups.push({ category, items });
  }
  return groups;
});

function flatIndex(groupIdx: number, itemIdx: number): number {
  let count = 0;
  for (let i = 0; i < groupIdx; i++) {
    count += groupedItems.value[i].items.length;
  }
  return count + itemIdx;
}

const flatItems = computed(() => {
  const result: SlashCommandItem[] = [];
  for (const group of groupedItems.value) {
    result.push(...group.items);
  }
  return result;
});

const {
  visible,
  position,
  selectedIndex,
  selectItem,
  onKeyDown,
  show,
  hide,
} = useFloatingListMenu<SlashCommandItem>({
  items: () => flatItems.value,
  command: () => props.command,
  menuRef,
});

defineExpose({ show, hide, onKeyDown });
</script>
