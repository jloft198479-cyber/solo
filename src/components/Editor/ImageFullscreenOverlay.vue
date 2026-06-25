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
          class="absolute bottom-6 right-6 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs transition-colors backdrop-blur-sm"
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
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
