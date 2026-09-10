<script setup>
import { ref, watch, nextTick } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  headline: { type: String, default: '输入' },
  label: { type: String, default: '' },
  description: { type: String, default: '' },
  confirmText: { type: String, default: '确认' },
  cancelText: { type: String, default: '取消' },
})
const emit = defineEmits(['confirm', 'cancel'])

const dialogEl = ref(null)
const value = ref('')

watch(
  () => props.open,
  async (open) => {
    await nextTick()
    if (!dialogEl.value) return
    if (open) {
      value.value = ''
      dialogEl.value.show()
    } else {
      dialogEl.value.close()
    }
  },
)

function confirm() {
  emit('confirm', value.value.trim())
}
</script>

<template>
  <md-dialog ref="dialogEl" @closed="emit('cancel')">
    <div slot="headline">{{ headline }}</div>
    <div slot="content" class="prompt-content">
      <p v-if="description" class="ts-body supporting">{{ description }}</p>
      <md-outlined-text-field
        :label="label"
        :value="value"
        autocomplete="off"
        spellcheck="false"
        @input="value = $event.target.value"
        @keydown.enter="confirm"
      ></md-outlined-text-field>
    </div>
    <div slot="actions">
      <md-text-button @click="emit('cancel')">{{ cancelText }}</md-text-button>
      <md-filled-button @click="confirm">{{ confirmText }}</md-filled-button>
    </div>
  </md-dialog>
</template>

<style scoped>
.prompt-content {
  display: flex;
  flex-direction: column;
  gap: var(--md-sys-spacing-3);
  min-width: min(320px, 70vw);
}

.prompt-content p {
  margin: 0;
}
</style>
