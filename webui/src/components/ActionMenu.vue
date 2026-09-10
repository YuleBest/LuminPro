<script setup>
import { ref } from 'vue'
import { MoreVertical } from 'lucide-vue-next'

defineProps({
  items: { type: Array, default: () => [] }, // [{ key, label }]
  title: { type: String, default: '更多' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['select'])

const open = ref(false)
const anchorEl = ref(null)
const menuEl = ref(null)

function toggle() {
  const menu = menuEl.value
  if (!menu) return
  // 注意：md-menu 的 anchor 是 idref 字符串，元素引用必须用 anchorElement；
  // 且必须在打开前设置——菜单打开时会立刻按锚点定位
  if (anchorEl.value) menu.anchorElement = anchorEl.value
  open.value = !open.value
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
