<script setup lang="ts">
defineProps<{
  imageUrl: string;
}>();

const emit = defineEmits<{
  (e: 'open-fullscreen'): void;
}>();
</script>

<template>
  <div class="image-preview__overlay h-full w-full flex items-center justify-center p-12 overflow-auto">
    <div class="relative group max-w-full max-h-full">
      <img
        :src="imageUrl"
        class="image-preview__frame max-w-full max-h-full object-contain shadow-md rounded cursor-zoom-in"
        title="双击全屏预览"
        @dblclick="emit('open-fullscreen')"
      />
      <div
        class="absolute bottom-4 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 text-white text-[10px] px-3 py-1 rounded-full backdrop-blur-sm pointer-events-none"
      >
        双击全屏查看
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-preview__overlay {
  background-color: var(--bg-color);
}

.image-preview__frame {
  border: 1px solid var(--border-color);
  background-color: var(--bg-color);
}
</style>
