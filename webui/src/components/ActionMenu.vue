<script setup>
import { ref, watch, nextTick } from 'vue'
import { MoreVertical } from 'lucide-vue-next'

const props = defineProps({
  items: { type: Array, default: () => [] }, // [{ key, label }]
  title: { type: String, default: '更多' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['select'])

const open = ref(false)
const anchorEl = ref(null)
const menuEl = ref(null)

async function toggle() {
  open.value = !open.value
  if (open.value) {
    await nextTick()
    // MWC 菜单需要通过属性接收锚点元素（不能用 attribute 绑定）
    if (menuEl.value && anchorEl.value) menuEl.value.anchor = anchorEl.value
  }
}

function pick(item) {
  open.value = false
  setTimeout(() => emit('select', item.key), 0)
}
</script>

<template>
  <md-icon-button ref="anchorEl" :title="title" :disabled="disabled" @click="toggle">
    <MoreVertical :size="20" />
  </md-icon-button>
  <md-menu ref="menuEl" :open="open" @closed="open = false">
    <md-menu-item v-for="item in items" :key="item.key" @click="pick(item)">
      <span slot="headline">{{ item.label }}</span>
    </md-menu-item>
  </md-menu>
</template>
