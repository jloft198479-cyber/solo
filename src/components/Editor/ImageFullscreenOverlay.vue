<script setup lang="ts">
import CloseIcon from '../icons/CloseIcon.vue';

defineProps<{
  visible: boolean;
  imageUrl: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-in-viewer'): void;
}>();
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-[2000] bg-black/90 backdrop-blur-md flex items-center justify-center p-8 cursor-zoom-out"
        @click="emit('close')"
      >
        <img :src="imageUrl" class="max-w-full max-h-full object-contain" @click.stop />
        <button
          class="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          @click="emit('close')"
        >
          <CloseIcon class="w-6 h-6" />
        </button>
        <button
          class="overlay-action-btn absolute bottom-6 right-6 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs transition-colors backdrop-blur-sm"
          @click.stop="emit('open-in-viewer')"
        >
          在图片视图中打开
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--motion-base) var(--ease-out);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.overlay-action-btn {
  /* 直角语言：与项目 token 一致（替代 Tailwind rounded-lg 硬编码） */
  border-radius: var(--radius-md);
}
</style>
