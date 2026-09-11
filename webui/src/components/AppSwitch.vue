<script setup>
/** 设置行：左侧标题/说明 + 右侧 M3 开关 */
defineProps({
  modelValue: { type: Boolean, default: false },
  name: { type: String, default: '' },
  support: { type: String, default: '' },
  warning: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="row">
    <div class="row__labels">
      <span class="row__name">{{ name }}</span>
      <span v-if="support" class="row__support">{{ support }}</span>
      <span v-if="warning" class="row__support warning">{{ warning }}</span>
    </div>
    <div class="row__control">
      <md-switch
        :selected="modelValue"
        :disabled="disabled"
        @change="emit('update:modelValue', $event.target.selected)"
      ></md-switch>
    </div>
  </div>
</template>
