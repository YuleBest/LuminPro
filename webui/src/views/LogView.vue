<script setup>
import { inject, computed, ref } from 'vue'
import { RefreshCw } from 'lucide-vue-next'
import ActionMenu from '../components/ActionMenu.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const log = inject('log')
const snackbar = inject('snackbar')

const clearOpen = ref(false)

const menuItems = [
  { key: 'copy', label: '复制当前日志' },
  { key: 'export', label: '导出到 /sdcard' },
  { key: 'clear', label: '清空日志' },
]

const filterItems = computed(() => [
  { key: '', label: '全部' },
  { key: 'INFO', label: 'INFO' },
  { key: 'WARN', label: 'WARN' },
  { key: 'ERROR', label: 'ERROR' },
  { key: 'SUCCESS', label: 'SUCCESS' },
])

function onMenuSelect(key) {
  if (key === 'copy') log.copy(snackbar)
  else if (key === 'export') log.exportTo(snackbar)
  else if (key === 'clear') clearOpen.value = true
}

const levelClass = (level) => `log-line--${(level || 'plain').toLowerCase()}`
</script>

<template>
  <section class="section">
    <div class="section-header">
      <h2 class="section-title ts-title-md">运行日志</h2>
      <md-icon-button title="刷新" @click="log.load()">
        <RefreshCw :size="20" />
      </md-icon-button>
      <ActionMenu :items="menuItems" @select="onMenuSelect" />
    </div>

    <md-chip-set class="filter-chips">
      <md-filter-chip
        v-for="item in filterItems"
        :key="item.key || 'all'"
        :label="item.label"
        :selected="log.level.value === item.key"
        @click="log.level.value = item.key"
      ></md-filter-chip>
    </md-chip-set>

    <div v-if="log.error.value" class="empty-state error">{{ log.error.value }}</div>
    <div v-else-if="log.filtered.value.length === 0" class="empty-state">
      暂无{{ log.level.value ? ` [${log.level.value}] ` : '' }}日志
    </div>
    <pre v-else class="log-output scroll-area"><code><span
        v-for="(entry, index) in log.filtered.value"
        :key="index"
        :class="levelClass(entry.level)"
        class="log-line"
      >[{{ entry.time }}] [{{ entry.tag }}] [{{ entry.level }}] {{ entry.message }}
</span></code></pre>
  </section>

  <ConfirmDialog
    :open="clearOpen"
    headline="清空日志"
    description="日志文件内容将被清空，此操作不可撤销。"
    confirm-text="清空"
    danger
    @confirm="clearOpen = false; log.clear(snackbar)"
    @cancel="clearOpen = false"
  />
</template>

<style scoped>
.filter-chips {
  --md-filter-chip-label-text-size: var(--md-sys-typescale-label-medium-size);
}

.log-output {
  margin: 0;
  padding: var(--md-sys-spacing-3);
  max-height: 58vh;
  overflow: auto;
  border-radius: var(--md-sys-shape-corner-medium);
  background-color: var(--md-sys-color-surface-container-lowest);
  color: var(--md-sys-color-on-surface);
  font-family: var(--md-sys-typescale-font-mono);
  font-size: var(--md-sys-typescale-body-small-size);
  line-height: 1.55;
}

.log-line {
  display: block;
  white-space: pre-wrap;
  word-break: break-all;
}

.log-line--warn {
  color: var(--lp-color-warning);
}

.log-line--error {
  color: var(--md-sys-color-error);
}

.log-line--success {
  color: var(--lp-color-success);
}

.log-line--info {
  color: var(--md-sys-color-on-surface-variant);
}
</style>
