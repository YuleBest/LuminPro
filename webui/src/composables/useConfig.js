import { ref, watch } from 'vue'
import {
  runCmd,
  readConfig,
  writeConfig,
  updateConfig,
  BACKUP_CONFIG_FILE,
  PID_FILE,
  FLAG_FILE,
  DEFAULT_NOW_BRI_FILE,
  DEFAULT_SYS_MAX_BRI_FILE,
} from '../utils.js'

export function useConfig() {
  // 亮度配置
  const uiMaxBri = ref('')
  const maxBri = ref('')
  const stepsNum = ref('50')
  const logMaxSize = ref('500')

  // 执行策略
  const autoBriSleep = ref(false)
  const displayHdrSleep = ref(false)
  const compatibilityMode = ref(false)
  const sleepMode = ref(false)
  const sleepStartH = ref('19')
  const sleepStartM = ref('00')
  const sleepEndH = ref('06')
  const sleepEndM = ref('00')

  // 高级设置
  const nowBriFile = ref(DEFAULT_NOW_BRI_FILE)
  const sysMaxBriFile = ref(DEFAULT_SYS_MAX_BRI_FILE)
  const inotifyEvents = ref('c')
  const debugMode = ref(false)
  const logLevel = ref('info')

  // 脸污标记
  const dirty = ref(false)
  const dirtyAdvanced = ref(false)
  let _silent = false

  // Web UI 配置 (localStorage 持久化)
  const autoRefresh = ref(localStorage.getItem('autoRefresh') !== 'false')
  const statusRefreshInterval = ref(
    Math.max(100, parseInt(localStorage.getItem('statusLogRefreshInterval') || '1000', 10)),
  )
  const uiZoom = ref(
    Math.min(150, Math.max(50, parseInt(localStorage.getItem('uiZoom') || '100', 10))),
  )
  const themeMode = ref(localStorage.getItem('themeMode') || 'system')

  // 监听主配置字段
  watch(
    [
      uiMaxBri,
      maxBri,
      stepsNum,
      logMaxSize,
      autoBriSleep,
      displayHdrSleep,
      compatibilityMode,
      sleepMode,
      sleepStartH,
      sleepStartM,
      sleepEndH,
      sleepEndM,
      logLevel,
    ],
    () => {
      if (!_silent) dirty.value = true
    },
  )
  // 监听高级设置字段
  watch([nowBriFile, sysMaxBriFile, inotifyEvents, debugMode], () => {
    if (!_silent) dirtyAdvanced.value = true
  })

  async function load() {
    _silent = true
    const cfg = await readConfig()
    if (!cfg || Object.keys(cfg).length === 0) {
      _silent = false
      return
    }

    uiMaxBri.value = cfg.ui_max_bri != null ? String(cfg.ui_max_bri) : ''
    maxBri.value = cfg.max_bri != null ? String(cfg.max_bri) : ''
    stepsNum.value = cfg.steps_num != null ? String(cfg.steps_num) : '50'
    logMaxSize.value = cfg.log_max_size != null ? String(cfg.log_max_size) : '500'
    autoBriSleep.value = cfg.auto_bri_sleep === 1
    displayHdrSleep.value = cfg.display_hdr_sleep === 1
    compatibilityMode.value = cfg.compatibility_mode === 1
    nowBriFile.value = cfg.now_bri_file || DEFAULT_NOW_BRI_FILE
    sysMaxBriFile.value = cfg.max_bri_file || DEFAULT_SYS_MAX_BRI_FILE
    inotifyEvents.value = cfg.inotify_events || 'c'
    debugMode.value = cfg.debug_mode === 1
    logLevel.value = cfg.log_level || 'info'

    const st = cfg.sleep_time || ''
    if (st && st.includes('-')) {
      sleepMode.value = true
      const [s, e] = st.split('-')
      if (s.length === 4) {
        sleepStartH.value = s.slice(0, 2)
        sleepStartM.value = s.slice(2)
      }
      if (e.length === 4) {
        sleepEndH.value = e.slice(0, 2)
        sleepEndM.value = e.slice(2)
      }
    } else {
      sleepMode.value = false
    }
    dirty.value = false
    dirtyAdvanced.value = false
    _silent = false
  }

  function getSleepTimeStr() {
    if (!sleepMode.value) return ''
    const pad = (v) => String(v).padStart(2, '0')
    return `${pad(sleepStartH.value)}${pad(sleepStartM.value)}-${pad(sleepEndH.value)}${pad(sleepEndM.value)}`
  }

  async function save(toast) {
    if (!uiMaxBri.value || !maxBri.value) {
      toast('亮度値不能为空')
      return
    }
    toast('保存中...')
    // 读取当前配置（保留 blacklist_apps 等其他字段）
    const current = await readConfig()
    await writeConfig({
      ...current,
      ui_max_bri: parseInt(uiMaxBri.value) || 0,
      max_bri: parseInt(maxBri.value) || 0,
      steps_num: parseInt(stepsNum.value) || 50,
      log_max_size: parseInt(logMaxSize.value) || 500,
      auto_bri_sleep: autoBriSleep.value ? 1 : 0,
      display_hdr_sleep: displayHdrSleep.value ? 1 : 0,
      compatibility_mode: compatibilityMode.value ? 1 : 0,
      sleep_time: getSleepTimeStr(),
      log_level: logLevel.value,
    })
    await runCmd(`rm -f "${FLAG_FILE}"`)
    const pidRes = await runCmd(`cat "${PID_FILE}"`)
    toast(
      pidRes.errno === 0 && pidRes.stdout.trim()
        ? '配置已保存 (下次重启或触发时生效)'
        : '配置已保存 (服务未运行)',
    )
    dirty.value = false
  }

  async function saveAdvanced(toast, onPathsChanged) {
    toast('保存中...')
    await updateConfig({
      now_bri_file: nowBriFile.value || DEFAULT_NOW_BRI_FILE,
      max_bri_file: sysMaxBriFile.value || DEFAULT_SYS_MAX_BRI_FILE,
      inotify_events: inotifyEvents.value || 'c',
      debug_mode: debugMode.value ? 1 : 0,
    })
    onPathsChanged?.()
    toast('高级设置已保存，需重启服务生效')
    dirtyAdvanced.value = false
  }

  async function resetToDefaults(toast) {
    toast('正在恢复默认配置...')
    const backupRes = await runCmd(`cat "${BACKUP_CONFIG_FILE}"`)
    if (backupRes.errno !== 0 || !backupRes.stdout.trim()) {
      toast('备份文件不存在，无法恢复')
      return
    }
    let backup
    try {
      backup = JSON.parse(backupRes.stdout)
    } catch {
      toast('备份文件损坏')
      return
    }

    uiMaxBri.value = backup.ui_max_bri != null ? String(backup.ui_max_bri) : ''
    maxBri.value = backup.max_bri != null ? String(backup.max_bri) : ''
    autoBriSleep.value = backup.auto_bri_sleep === 1
    displayHdrSleep.value = backup.display_hdr_sleep === 1
    compatibilityMode.value = backup.compatibility_mode === 1
    stepsNum.value = backup.steps_num != null ? String(backup.steps_num) : '50'
    logMaxSize.value = backup.log_max_size != null ? String(backup.log_max_size) : '500'
    nowBriFile.value = backup.now_bri_file || DEFAULT_NOW_BRI_FILE
    sysMaxBriFile.value = backup.max_bri_file || DEFAULT_SYS_MAX_BRI_FILE
    inotifyEvents.value = backup.inotify_events || 'c'

    const st = backup.sleep_time || ''
    if (st && st.includes('-')) {
      sleepMode.value = true
      const [s, e] = st.split('-')
      if (s.length === 4) {
        sleepStartH.value = s.slice(0, 2)
        sleepStartM.value = s.slice(2)
      }
      if (e.length === 4) {
        sleepEndH.value = e.slice(0, 2)
        sleepEndM.value = e.slice(2)
      }
    } else {
      sleepMode.value = true
      sleepStartH.value = '19'
      sleepStartM.value = '00'
      sleepEndH.value = '06'
      sleepEndM.value = '00'
    }
    await save(toast)
  }

  function saveWebUIConfig(toast, newAutoRefresh, newInterval, newZoom, newTheme, onRestart) {
    const interval = Math.max(100, parseInt(newInterval, 10) || 1000)
    const zoom = Math.min(150, Math.max(50, parseInt(newZoom, 10) || 100))
    localStorage.setItem('autoRefresh', newAutoRefresh)
    localStorage.setItem('statusLogRefreshInterval', interval)
    localStorage.setItem('uiZoom', zoom)
    localStorage.setItem('themeMode', newTheme)
    autoRefresh.value = newAutoRefresh
    statusRefreshInterval.value = interval
    uiZoom.value = zoom
    themeMode.value = newTheme
    document.documentElement.style.zoom = zoom / 100
    applyTheme(newTheme)
    onRestart?.(newAutoRefresh, interval)
    toast('Web UI 配置已保存')
  }

  function applyZoom() {
    document.documentElement.style.zoom = uiZoom.value / 100
  }

  function applyTheme(mode) {
    const html = document.documentElement
    html.classList.remove('light', 'dark')
    if (mode === 'light') html.classList.add('light')
    else if (mode === 'dark') html.classList.add('dark')
  }

  return {
    uiMaxBri,
    maxBri,
    stepsNum,
    logMaxSize,
    autoBriSleep,
    displayHdrSleep,
    compatibilityMode,
    sleepMode,
    sleepStartH,
    sleepStartM,
    sleepEndH,
    sleepEndM,
    nowBriFile,
    sysMaxBriFile,
    inotifyEvents,
    debugMode,
    logLevel,
    dirty,
    dirtyAdvanced,
    autoRefresh,
    statusRefreshInterval,
    uiZoom,
    themeMode,
    load,
    save,
    saveAdvanced,
    resetToDefaults,
    saveWebUIConfig,
    applyZoom,
    applyTheme,
  }
}
