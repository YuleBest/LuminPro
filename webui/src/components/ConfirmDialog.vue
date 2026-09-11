<script setup>
import { ref, watch, nextTick } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  headline: { type: String, default: '确认操作' },
  description: { type: String, default: '' },
  confirmText: { type: String, default: '确认' },
  cancelText: { type: String, default: '取消' },
  danger: { type: Boolean, default: false },
})
const emit = defineEmits(['confirm', 'cancel'])

const dialogEl = ref(null)

watch(
  () => props.open,
  async (open) => {
    await nextTick()
    if (!dialogEl.value) return
    if (open) dialogEl.value.show()
    else dialogEl.value.close()
  },
)

function onClosed() {
  if (props.open) emit('cancel') // 点击遮罩/ESC 关闭
}
</script>

<template>
  <md-dialog ref="dialogEl" @closed="onClosed">
    <div slot="headline">{{ headline }}</div>
    <div slot="content" class="dialog-content">{{ description }}</div>
    <div slot="actions">
      <md-text-button @click="emit('cancel')">{{ cancelText }}</md-text-button>
      <md-filled-button :class="{ danger }" @click="emit('confirm')">
        {{ confirmText }}
      </md-filled-button>
    </div>
  </md-dialog>
</template>

<style scoped>
.dialog-content {
  color: var(--md-sys-color-on-surface-variant);
  white-space: pre-line;
}

md-filled-button.danger {
  --md-filled-button-container-color: var(--md-sys-color-error);
  --md-filled-button-label-text-color: var(--md-sys-color-on-error);
}
</style>
