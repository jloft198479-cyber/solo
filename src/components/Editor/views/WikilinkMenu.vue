<template>
  <Transition name="mk-menu" :appear="true">
    <div
      v-show="visible"
      ref="menuRef"
      class="mk-slash-menu mk-wikilink-menu"
      :style="menuStyle"
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
        <!-- 空态分两种：文档已存 = 目录里确实没有匹配；未存 = 互链还没有基准目录。
             后者早前是「菜单整个不弹」，用户敲 [[ 毫无反应，只能以为补全坏了。 -->
        <div v-if="items.length === 0" class="mk-slash-menu-empty">
          {{ hasDocumentPath ? '无匹配文档' : '存到文件夹后，可链接同目录文档' }}
        </div>
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
  /** 当前文档是否已存到磁盘；未存时互链没有基准目录，空态改为说明规则 */
  hasDocumentPath?: boolean;
}>();

const menuRef = ref<HTMLElement>();

const {
  visible,
  menuStyle,
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
