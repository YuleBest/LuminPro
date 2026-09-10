<script setup>
import { computed } from 'vue'
import { RefreshCw, Pause, Play, RotateCw } from 'lucide-vue-next'

const props = defineProps({
  title: { type: String, default: 'LuminPro' },
  subtitle: { type: String, default: '' },
  version: { type: String, default: '' },
  statusText: { type: String, default: '—' },
  statusClass: { type: String, default: 'stopped' },
  paused: { type: Boolean, default: false },
  locked: { type: Boolean, default: false },
  scrolled: { type: Boolean, default: false },
})

const emit = defineEmits(['refresh', 'toggle-service', 'restart'])

/** 通道徽标：版本号里带 -beta / -dev 即为对应通道 */
const channel = computed(() => {
  const v = props.version.toLowerCase()
  if (v.includes('-beta')) return 'Beta'
  if (v.includes('-dev')) return 'Dev'
  return ''
})
</script>

<template>
  <header class="app-bar" :class="{ scrolled }">
    <div class="app-bar__text">
      <h1 class="app-bar__title ts-title-lg">
        {{ title }}
        <span v-if="channel" class="channel-badge">{{ channel }}</span>
      </h1>
      <span class="app-bar__subtitle ts-body-sm">{{ subtitle || version || '—' }}</span>
    </div>

    <span class="status-pill" :class="statusClass">
      <span class="status-pill__dot"></span>
      {{ statusText }}
    </span>

    <div class="app-bar__actions">
      <md-icon-button title="刷新" @click="emit('refresh')">
        <RefreshCw :size="20" />
      </md-icon-button>
      <md-icon-button
        :title="paused ? '启用' : '暂停'"
        :disabled="locked"
        @click="emit('toggle-service')"
      >
        <Play v-if="paused" :size="20" />
        <Pause v-else :size="20" />
      </md-icon-button>
      <md-icon-button title="重启模块" :disabled="locked" @click="emit('restart')">
        <RotateCw :size="20" />
      </md-icon-button>
    </div>
  </header>
</template>
