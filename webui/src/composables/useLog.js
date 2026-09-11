import { ref, computed } from 'vue'
import { fetchLog, clearLog, exportLog } from '../api/luminpro.js'

const LEVELS = ['', 'INFO', 'WARN', 'ERROR', 'SUCCESS']

/** 日志：数据来自 Go 侧 `luminpro log tail`，等级过滤在前端进行 */
export function useLog() {
  const entries = ref([])
  const level = ref('')
  const error = ref('')
  const loading = ref(false)

  const levels = LEVELS
  const filtered = computed(() =>
    level.value ? entries.value.filter((e) => e.level === level.value) : entries.value,
  )

  const asText = (list = filtered.value) =>
    list.map((e) => `[${e.time}] [${e.tag}] [${e.level}] ${e.message}`.trim()).join('\n')

  async function load() {
    loading.value = true
    try {
      const page = await fetchLog(200)
      entries.value = page.entries ?? []
      error.value = ''
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  async function clear(snackbar) {
    try {
      await clearLog()
      entries.value = []
      snackbar?.('日志已清空')
    } catch (e) {
      snackbar?.(`清空失败: ${e.message}`)
    }
  }

  async function exportTo(snackbar) {
    try {
      const res = await exportLog('/sdcard')
      snackbar?.(`已导出到 ${res.path}`)
    } catch (e) {
      snackbar?.(`导出失败: ${e.message}`)
    }
  }

  async function copy(snackbar) {
    const text = asText()
    if (!text) {
      snackbar?.('暂无日志可复制')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      snackbar?.('日志已复制到剪贴板')
    } catch {
      snackbar?.('复制失败，请手动选择文本')
    }
  }

  return { entries, filtered, level, levels, error, loading, asText, load, clear, exportTo, copy }
}
