import { ref, reactive, computed } from 'vue'
import { fetchConfig, patchConfig, readModuleFile } from '../api/luminpro.js'

/** 主配置卡片负责的字段 */
const MAIN_KEYS = [
  'ui_max_bri',
  'max_bri',
  'steps_num',
  'auto_bri_sleep',
  'display_hdr_sleep',
  'hdr_enter_ratio',
  'hdr_exit_ratio',
  'compatibility_mode',
  'sleep_time',
]

/** 高级设置负责的字段 */
const ADVANCED_KEYS = ['now_bri_file', 'max_bri_file', 'inotify_events', 'debug_mode', 'log_max_size', 'log_level']

const INT_KEYS = new Set([
  'ui_max_bri',
  'max_bri',
  'steps_num',
  'log_max_size',
  'auto_bri_sleep',
  'display_hdr_sleep',
  'compatibility_mode',
  'debug_mode',
])
const FLOAT_KEYS = new Set(['hdr_enter_ratio', 'hdr_exit_ratio'])

/** 配置改动的类型还原：表单里统一用字符串，写回时按字段类型转换 */
function toTyped(key, value) {
  if (INT_KEYS.has(key)) return parseInt(value, 10) || 0
  if (FLOAT_KEYS.has(key)) return parseFloat(value) || 0
  return value
}

/** 配置对象 -> 表单字符串（数组字段保持数组） */
function toForm(cfg, keys) {
  const out = {}
  for (const key of keys) {
    const value = cfg[key]
    if (Array.isArray(value)) out[key] = value
    else if (value === null || value === undefined) out[key] = ''
    else out[key] = String(value)
  }
  return out
}

export function useConfig() {
  const saved = ref({})
  const loading = ref(false)
  const error = ref('')

  const form = reactive({
    ...toForm({}, [...MAIN_KEYS, ...ADVANCED_KEYS]),
    blacklist_apps: [],
  })

  function hydrate(cfg) {
    saved.value = { ...cfg }
    Object.assign(form, toForm(cfg, [...MAIN_KEYS, ...ADVANCED_KEYS]))
    form.blacklist_apps = Array.isArray(cfg.blacklist_apps) ? [...cfg.blacklist_apps] : []
  }

  async function load() {
    loading.value = true
    try {
      hydrate(await fetchConfig())
      error.value = ''
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  /** 某组字段中相对已保存配置发生变化的项（已按类型还原） */
  function changedKeys(keys) {
    const patch = {}
    for (const key of keys) {
      const current = key === 'blacklist_apps' ? JSON.stringify(form[key]) : String(form[key])
      const original = Array.isArray(saved.value[key])
        ? JSON.stringify(saved.value[key])
        : String(saved.value[key] ?? '')
      if (current !== original) patch[key] = toTyped(key, form[key])
    }
    return patch
  }

  /** 整型开关字段（0/1）与布尔值之间的桥接：md-switch 给出的是布尔值 */
  function intBool(key) {
    return computed({
      get: () => Number(form[key]) === 1,
      set: (on) => {
        form[key] = on ? '1' : '0'
      },
    })
  }

  const autoBriSleep = intBool('auto_bri_sleep')
  const displayHdrSleep = intBool('display_hdr_sleep')
  const compatibilityMode = intBool('compatibility_mode')
  const debugMode = intBool('debug_mode')

  const diffMain = computed(() => changedKeys(MAIN_KEYS))
  const diffAdvanced = computed(() => changedKeys(ADVANCED_KEYS))
  const dirtyMain = computed(() => Object.keys(diffMain.value).length > 0)
  const dirtyAdvanced = computed(() => Object.keys(diffAdvanced.value).length > 0)

  async function save(patch, snackbar, message) {
    if (Object.keys(patch).length === 0) {
      snackbar?.('没有需要保存的改动')
      return
    }
    try {
      await patchConfig(patch)
      await load()
      snackbar?.(message)
    } catch (e) {
      snackbar?.(`保存失败: ${e.message}`)
    }
  }

  const saveMain = (snackbar) => save(diffMain.value, snackbar, '配置已保存')
  const saveAdvanced = (snackbar) => save(diffAdvanced.value, snackbar, '高级设置已保存，需重启模块生效')

  /** 从安装时备份恢复默认值（只改表单，需再点保存） */
  async function restoreBackup(snackbar) {
    const raw = await readModuleFile('config/.backup/config.json')
    if (!raw.trim()) {
      snackbar?.('备份文件不存在，无法恢复')
      return
    }
    let backup
    try {
      backup = JSON.parse(raw)
    } catch {
      snackbar?.('备份文件损坏')
      return
    }
    hydrate({ ...saved.value, ...backup })
    snackbar?.('已载入安装时的配置，点击保存生效')
  }

  // ── 定时休眠：字符串 <-> 开关 + 四个时间输入 ──────────────────────
  const sleepEnabled = computed({
    get: () => !!form.sleep_time,
    set: (on) => {
      form.sleep_time = on ? form.sleep_time || '2300-0700' : ''
    },
  })

  const sleepParts = computed(() => {
    const text = String(form.sleep_time || '')
    const match = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(text)
    if (!match) return ['23', '00', '07', '00']
    return [match[1], match[2], match[3], match[4]]
  })

  function setSleepPart(index, value) {
    const parts = [...sleepParts.value]
    parts[index] = String(value).padStart(2, '0').slice(-2)
    form.sleep_time = `${parts[0]}${parts[1]}-${parts[2]}${parts[3]}`
  }

  return {
    saved,
    form,
    loading,
    error,
    dirtyMain,
    dirtyAdvanced,
    autoBriSleep,
    displayHdrSleep,
    compatibilityMode,
    debugMode,
    load,
    saveMain,
    saveAdvanced,
    restoreBackup,
    sleepEnabled,
    sleepParts,
    setSleepPart,
  }
}
