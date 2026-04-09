<script setup>
import { inject, ref, onMounted } from 'vue'
import Button from '@/components/ui/Button.vue'
import { RefreshCw, Copy, Download, Trash2 } from 'lucide-vue-next'

const showToast = inject('showToast')
const log = inject('log')

const logMenuOpen = ref(false)
const clearConfirming = ref(false)

let clearConfirmTimer = null
function copyLog() {
  log.copy(showToast)
  logMenuOpen.value = false
}
function exportLog() {
  log.exportLog(showToast)
  logMenuOpen.value = false
}
function handleClear() {
  if (!clearConfirming.value) {
    clearConfirming.value = true
    clearConfirmTimer = setTimeout(() => {
      clearConfirming.value = false
    }, 3000)
    return
  }
  clearTimeout(clearConfirmTimer)
  clearConfirming.value = false
  logMenuOpen.value = false
  log.clear(showToast)
}

// filter options
const filterOptions = [
  { key: '', label: '全部' },
  { key: 'INFO', label: 'INFO' },
  { key: 'WARN', label: 'WARN' },
  { key: 'ERROR', label: 'ERROR' },
]

onMounted(() => log.load())
</script>

<template>
  <section class="card" id="log-section">
    <div class="card-header" style="margin-bottom: 8px">
      <h2>运行日志</h2>
      <div class="header-actions dropdown-container">
        <Button variant="ghost" size="icon" @click="log.load">
          <RefreshCw :size="18" />
        </Button>
        <Button variant="ghost" size="icon" @click="logMenuOpen = !logMenuOpen">
          <span class="sr-only">更多操作</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="19" r="1" />
          </svg>
        </Button>
        <div class="dropdown-menu" :class="{ show: logMenuOpen }" @click.stop>
          <div class="dropdown-item" @click="copyLog"><Copy :size="18" /><span>复制日志</span></div>
          <div class="dropdown-item" @click="exportLog">
            <Download :size="18" /><span>导出日志文件</span>
          </div>
          <div
            class="dropdown-item"
            :class="{ 'dropdown-item-danger': clearConfirming }"
            @click="handleClear"
          >
            <Trash2 :size="18" />
            <span>{{ clearConfirming ? '再次点击确认清除' : '清除日志' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 过滤器 -->
    <div class="log-filter-container" style="margin-bottom: var(--spacing-s)">
      <div class="log-filter-tabs">
        <button
          v-for="opt in filterOptions"
          :key="opt.key"
          class="log-filter-tab"
          :class="{ active: log.filterLevel.value === opt.key }"
          @click="log.filterLevel.value = opt.key"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- 日志内容 -->
    <pre class="log-output" id="log-output">{{ log.filteredLog.value || '暂无日志' }}</pre>
  </section>
</template>
