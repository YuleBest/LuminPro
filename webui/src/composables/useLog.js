import { ref, computed } from 'vue'
import { runCmd, LOG_FILE } from '../utils.js'

export function useLog() {
  const fullLog = ref('')
  const filterLevel = ref('')
  const isLoading = ref(false)

  const filteredLog = computed(() => {
    if (!fullLog.value) return '暂无日志'
    if (!filterLevel.value) return fullLog.value
    const lines = fullLog.value.split('\n').filter((l) => l.includes(`[${filterLevel.value}]`))
    return lines.length > 0 ? lines.join('\n') : `暂无 [${filterLevel.value}] 等级的日志`
  })

  async function load() {
    const res = await runCmd(`tail -n 100 "${LOG_FILE}"`)
    fullLog.value =
      res.errno === 0 ? res.stdout.trim() || '暂无日志' : '无法读取日志 (可能模块尚未产生日志文件)'
  }

  async function clear(toast) {
    toast('正在清空日志...')
    const res = await runCmd(`> "${LOG_FILE}"`)
    if (res.errno === 0) {
      fullLog.value = ''
      toast('日志已清空')
    } else toast('清空失败: ' + (res.stderr || '未知错误'))
  }

  async function copy(toast) {
    const res = await runCmd(`tail -n 50 "${LOG_FILE}"`)
    if (res.errno !== 0 || !res.stdout.trim()) {
      toast('暂无日志内容')
      return
    }
    try {
      await navigator.clipboard.writeText(res.stdout.trim())
    } catch {
      const ta = document.createElement('textarea')
      ta.value = res.stdout.trim()
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    toast('已复制最新 50 条日志')
  }

  async function exportLog(toast) {
    toast('正在导出...')
    const res = await runCmd(`cp "${LOG_FILE}" "/sdcard/LuminPro_$(date '+%Y%m%d_%H%M%S').log"`)
    toast(res.errno === 0 ? '日志已导出到 /sdcard' : '导出失败: ' + (res.stderr || '未知错误'))
  }

  return { fullLog, filterLevel, filteredLog, isLoading, load, clear, copy, exportLog }
}
