import { ref, reactive, computed } from 'vue'
import { listPackages, getPackagesInfo } from 'kernelsu'
import { fetchConfig, patchConfig } from '../api/luminpro.js'

/** 拼音匹配库体积较大，进入黑名单页后再按需加载 */
let PinyinMatch = null
const pinyinReady = ref(false)
async function ensurePinyin() {
  if (PinyinMatch || pinyinReady.value) return
  try {
    PinyinMatch = (await import('pinyin-match')).default
  } catch {
    PinyinMatch = null
  }
  pinyinReady.value = true
}

/** 黑名单管理：应用列表来自 KernelSU API，黑名单本身存在 config.json */
export function useApps() {
  const apps = ref([])
  const isLoading = ref(false)
  const loadError = ref('')
  const searchKeyword = ref('')
  const showingSystemApps = ref(true)
  const savedBlacklist = ref(new Set())
  const activityEntries = ref(new Set())

  /** 条目结构: { packageName, appLabel, isSystem, uid, checked, expanded } */

  async function load() {
    isLoading.value = true
    loadError.value = ''
    ensurePinyin() // 后台加载拼音库，不阻塞列表
    try {
      const cfg = await fetchConfig()
      const allSaved = Array.isArray(cfg.blacklist_apps) ? cfg.blacklist_apps : []
      savedBlacklist.value = new Set(allSaved)
      const savedPkgSet = new Set(allSaved.filter((e) => !e.includes('/')))
      activityEntries.value = new Set(allSaved.filter((e) => e.includes('/')))

      let infoList = []
      try {
        const pkgs = await listPackages()
        if (pkgs && pkgs.length > 0) infoList = await getPackagesInfo(pkgs)
        else throw new Error('no pkgs')
      } catch {
        infoList = Array.from({ length: 150 }, (_, i) => ({
          packageName: `com.mock.app${i}`,
          appLabel: i % 10 === 0 ? `测试应用 ${i} (含抖音关键字)` : `模拟应用 ${i}`,
          isSystem: i % 5 === 0,
          uid: 10000 + i,
        }))
      }

      if (!showingSystemApps.value) infoList = infoList.filter((a) => !a.isSystem)

      infoList.sort((a, b) => {
        if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1
        return (a.appLabel || '').localeCompare(b.appLabel || '')
      })

      const seenUids = new Set()
      infoList = infoList.filter((a) => {
        if (a.uid == null) return true
        if (seenUids.has(a.uid)) return false
        seenUids.add(a.uid)
        return true
      })

      apps.value = infoList.map((a) =>
        reactive({
          packageName: a.packageName,
          appLabel: a.appLabel || 'Unknown',
          isSystem: a.isSystem,
          uid: a.uid,
          checked: savedPkgSet.has(a.packageName),
          expanded: false,
        }),
      )
      reorder()
    } catch (e) {
      loadError.value = e.message || String(e)
    } finally {
      isLoading.value = false
    }
  }

  function reorder() {
    apps.value.sort((a, b) => {
      const stateA = a.checked ? 2 : hasActivity(a.packageName) ? 1 : 0
      const stateB = b.checked ? 2 : hasActivity(b.packageName) ? 1 : 0
      return stateB - stateA
    })
  }

  function hasActivity(pkg) {
    for (const entry of activityEntries.value) {
      if (entry.startsWith(pkg + '/')) return true
    }
    return false
  }

  function getActivities(pkg) {
    return [...activityEntries.value].filter((e) => e.startsWith(pkg + '/'))
  }

  function addActivity(entry) {
    activityEntries.value.add(entry)
    reorder()
  }

  function removeActivity(entry) {
    activityEntries.value.delete(entry)
    reorder()
  }

  async function save(snackbar) {
    const selected = apps.value.filter((a) => a.checked).map((a) => a.packageName)
    const all = [...selected, ...activityEntries.value]
    try {
      await patchConfig({ blacklist_apps: all })
      savedBlacklist.value = new Set(all)
      snackbar?.('黑名单已保存')
    } catch (e) {
      snackbar?.(`保存失败: ${e.message}`)
    }
  }

  function toggleSystemApps() {
    showingSystemApps.value = !showingSystemApps.value
    load()
  }

  function selectAll() {
    for (const app of apps.value) app.checked = true
    reorder()
  }

  function selectNone() {
    for (const app of apps.value) app.checked = false
    reorder()
  }

  function invertSelection() {
    for (const app of apps.value) app.checked = !app.checked
    reorder()
  }

  const smartKeywords = [
    '抖音',
    'tiktok',
    '爱奇艺',
    '优酷',
    '腾讯视频',
    '哔哩',
    'bilibili',
    'youku',
    'iqiyi',
    '芒果',
    '西瓜',
    '快手',
    'kuaishou',
    '小红书',
    'netflix',
    'youtube',
    'hulu',
    'disney',
    'prime',
    '相册',
    'gallery',
    'photos',
    'x',
  ]

  function smartSelect(snackbar) {
    let count = 0
    for (const app of apps.value) {
      const name = (app.appLabel || '').toLowerCase()
      const pkg = (app.packageName || '').toLowerCase()
      for (const keyword of smartKeywords) {
        if (keyword === 'x') {
          if (name === 'x' || name === 'x (twitter)') {
            if (!app.checked) count++
            app.checked = true
            break
          }
        } else if (name.includes(keyword) || pkg.includes(keyword)) {
          if (!app.checked) count++
          app.checked = true
          break
        }
      }
    }
    reorder()
    snackbar?.(count > 0 ? `已智能勾选 ${count} 个应用` : '没有匹配到可勾选的应用')
  }

  /** 过滤后的列表（供虚拟滚动使用） */
  function getFilteredApps() {
    const keyword = searchKeyword.value.trim().toLowerCase()
    if (!keyword) return apps.value
    return apps.value.filter((a) => {
      const pkg = a.packageName.toLowerCase()
      if (pkg.includes(keyword)) return true
      // 拼音库未就绪时退化为普通子串匹配
      if (!pinyinReady.value || !PinyinMatch) {
        return (a.appLabel || '').toLowerCase().includes(keyword)
      }
      return !!PinyinMatch.match(a.appLabel, keyword)
    })
  }

  const unsavedCount = computed(() => {
    const selected = apps.value.filter((a) => a.checked).map((a) => a.packageName)
    const all = [...selected, ...activityEntries.value]
    const saved = [...savedBlacklist.value]
    if (all.length !== saved.length) return 1
    const savedSet = new Set(saved)
    return all.some((e) => !savedSet.has(e)) ? 1 : 0
  })

  return {
    apps,
    isLoading,
    loadError,
    searchKeyword,
    showingSystemApps,
    savedBlacklist,
    activityEntries,
    unsavedCount,
    load,
    save,
    hasActivity,
    getActivities,
    addActivity,
    removeActivity,
    reorder,
    toggleSystemApps,
    selectAll,
    selectNone,
    invertSelection,
    smartSelect,
    getFilteredApps,
  }
}
