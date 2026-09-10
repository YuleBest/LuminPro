<script setup>
import { computed } from 'vue'
import { Pause, Play } from 'lucide-vue-next'
import ActionMenu from './ActionMenu.vue'

const props = defineProps({
  version: { type: String, default: '' },
  statusText: { type: String, default: '—' },
  statusClass: { type: String, default: 'stopped' },
  paused: { type: Boolean, default: false },
  locked: { type: Boolean, default: false },
  scrolled: { type: Boolean, default: false },
})

const emit = defineEmits(['toggle-service', 'refresh', 'restart'])

/** 通道徽标：版本号里带 -beta / -dev 即为对应通道 */
const channel = computed(() => {
  const v = props.version.toLowerCase()
  if (v.includes('-beta')) return 'Beta'
  if (v.includes('-dev')) return 'Dev'
  return ''
})

// 刷新与重启都收进「更多」：文字标签比图标更不容易混淆
const menuItems = [
  { key: 'refresh', label: '刷新状态' },
  { key: 'restart', label: '重启模块' },
]

function onMenuSelect(key) {
  if (key === 'refresh') emit('refresh')
  else if (key === 'restart') emit('restart')
}
</script>

<template>
  <header class="app-bar" :class="{ scrolled }">
    <div class="app-bar__text">
      <h1 class="app-bar__title ts-title-lg">
        LuminPro
        <span v-if="channel" class="channel-badge">{{ channel }}</span>
      </h1>
      <span class="app-bar__meta ts-body-sm">
        <span class="status-dot" :class="statusClass"></span>
        {{ statusText }}
        <template v-if="version"> · {{ version }}</template>
      </span>
    </div>

    <div class="app-bar__actions">
      <md-icon-button
        :title="paused ? '启用' : '暂停'"
        :disabled="locked"
        @click="emit('toggle-service')"
      >
        <Play v-if="paused" :size="20" />
        <Pause v-else :size="20" />
      </md-icon-button>
      <ActionMenu :items="menuItems" :disabled="locked" title="更多操作" @select="onMenuSelect" />
    </div>
  </header>
</template>
