<script setup lang="ts">
defineProps<{
  label: string;
}>();

const model = defineModel<boolean>({ required: true });
</script>

<template>
  <button
    type="button"
    role="switch"
    class="settings-switch"
    :class="{ 'settings-switch--on': model }"
    :aria-checked="model"
    :aria-label="label"
    @click="model = !model"
  >
    <span class="settings-switch__thumb" :class="{ 'settings-switch__thumb--on': model }" />
  </button>
</template>

<style scoped>
.settings-switch {
  position: relative;
  flex-shrink: 0;
  width: 48px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--border-color);
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.settings-switch:hover {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-light) 72%, transparent 28%);
}

.settings-switch--on {
  background: var(--primary-color);
}

.settings-switch__thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: var(--input-bg);
  box-shadow: var(--shadow-sm);
  transition: transform 0.2s ease;
}

.settings-switch__thumb--on {
  transform: translateX(20px);
}
</style>
