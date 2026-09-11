import { ref, computed } from 'vue'

/** Snackbar（M3）：底部浮层提示，自动消失 */
export function useSnackbar() {
  const messages = ref([])
  let seq = 0

  function show(text, { duration = 3000 } = {}) {
    if (!text) return
    const id = ++seq
    messages.value.push({ id, text })
    if (messages.value.length > 3) messages.value.shift()
    setTimeout(() => dismiss(id), duration)
  }

  function dismiss(id) {
    messages.value = messages.value.filter((m) => m.id !== id)
  }

  return { messages, show, dismiss }
}

/**
 * 主题 / 缩放 / 刷新频率等纯前端偏好（localStorage）。
 * 模块状态不放这里——它属于 config.json。
 */
export function useWebUIPrefs() {
  const autoRefresh = ref(localStorage.getItem('autoRefresh') !== 'false')
  const refreshInterval = ref(
    Math.max(100, parseInt(localStorage.getItem('statusLogRefreshInterval') || '1000', 10)),
  )
  const zoom = ref(Math.min(150, Math.max(50, parseInt(localStorage.getItem('uiZoom') || '100', 10))))
  const themeMode = ref(localStorage.getItem('themeMode') || 'system')

  const zoomScale = computed(() => zoom.value / 100)

  function applyZoom() {
    document.documentElement.style.zoom = String(zoomScale.value)
  }

  function applyTheme(mode) {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    if (mode === 'light' || mode === 'dark') root.classList.add(mode)
  }

  function save({ autoRefresh: ar, refreshInterval: ri, zoom: z, themeMode: tm }) {
    autoRefresh.value = ar
    refreshInterval.value = Math.max(100, parseInt(ri, 10) || 1000)
    zoom.value = Math.min(150, Math.max(50, parseInt(z, 10) || 100))
    themeMode.value = tm
    localStorage.setItem('autoRefresh', String(autoRefresh.value))
    localStorage.setItem('statusLogRefreshInterval', String(refreshInterval.value))
    localStorage.setItem('uiZoom', String(zoom.value))
    localStorage.setItem('themeMode', themeMode.value)
    applyZoom()
    applyTheme(themeMode.value)
  }

  return {
    autoRefresh,
    refreshInterval,
    zoom,
    themeMode,
    zoomScale,
    applyZoom,
    applyTheme,
    save,
  }
}
