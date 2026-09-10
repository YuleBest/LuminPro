<script setup>
defineProps({
  locked: { type: Boolean, default: false },
  label: { type: String, default: '正在执行后台操作' },
  seconds: { type: Number, default: 0 },
})
</script>

<template>
  <Transition name="oplock">
    <div v-if="locked" class="oplock-banner" role="status">
      <span class="oplock-banner__spinner"></span>
      <span class="oplock-banner__text">{{ label }}，已暂停刷新</span>
      <span v-if="seconds > 0" class="oplock-banner__elapsed">{{ seconds }}s</span>
    </div>
  </Transition>
</template>
