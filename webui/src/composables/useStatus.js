import { ref, computed } from 'vue'
import {
  fetchStatus,
  fetchOplock,
  setBrightness as apiSetBrightness,
  boost as apiBoost,
  restart as apiRestart,
  toggleService as apiToggleService,
} from '../api/luminpro.js'

/** 守护进程与亮度状态：数据来自 Go 侧 `luminpro status` */
export function useStatus() {
  const status = ref(null)
  const oplock = ref({ locked: false })
  const error = ref('')

  const moduleInfo = computed(() => status.value?.module ?? {})
  const daemon = computed(() => status.value?.daemon ?? {})
  const brightness = computed(() => status.value?.brightness ?? { current: 0, max: 0, percent: 0 })
  const display = computed(() => status.value?.display ?? null)
  const sleep = computed(() => status.value?.sleep ?? { window: '', active: false })
  const cfg = computed(() => status.value?.config ?? {})

  const isPaused = computed(() => !!daemon.value.paused)
  const isRunning = computed(() => !!daemon.value.running && !daemon.value.paused)
  const statusText = computed(() => (isPaused.value ? '已暂停' : isRunning.value ? '运行中' : '未运行'))
  const statusClass = computed(() =>
    isPaused.value ? 'paused' : isRunning.value ? 'running' : 'stopped',
  )
  const sleepText = computed(() => {
    if (!sleep.value.window) return '未配置'
    return sleep.value.active ? '休眠中' : '非休眠'
  })
  const hdrText = computed(() => {
    const d = display.value
    if (!d || !d.hdrKnown) return '—'
    return `${d.hdrRatio.toFixed(2)}${d.hdrStale ? '*' : ''}`
  })

  async function load({ display = true } = {}) {
    try {
      const next = await fetchStatus({ display })
      // --no-display 时后端不返回 display 字段，沿用上一次的结果避免界面闪烁
      if (!display && !next.display && status.value?.display) {
        next.display = status.value.display
      }
      status.value = next
      error.value = ''
    } catch (e) {
      error.value = e.message
    }
  }

  async function refreshOplock() {
    try {
      oplock.value = await fetchOplock()
    } catch {
      /* 忽略：下次轮询会重试 */
    }
  }

  async function setBrightness(value) {
    await apiSetBrightness(value)
    await load({ display: false })
  }

  async function toggleService(snackbar) {
    const res = await apiToggleService()
    snackbar?.(res.ok ? res.stdout.trim() || '状态已切换' : '操作失败: ' + res.stderr)
    await load({ display: false })
  }

  async function boost(snackbar) {
    const res = await apiBoost()
    snackbar?.(res.ok ? '已切换峰值亮度' : '操作失败: ' + res.stderr)
    await load({ display: false })
  }

  async function restart(snackbar) {
    const res = await apiRestart()
    snackbar?.(res.ok ? '模块已重启' : '模块重启失败: ' + res.stderr)
    setTimeout(() => load({ display: false }), 600)
  }

  return {
    status,
    oplock,
    error,
    moduleInfo,
    daemon,
    brightness,
    display,
    sleep,
    cfg,
    isRunning,
    isPaused,
    statusText,
    statusClass,
    sleepText,
    hdrText,
    load,
    refreshOplock,
    setBrightness,
    toggleService,
    boost,
    restart,
  }
}
