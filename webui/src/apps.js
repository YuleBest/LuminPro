// oxlint-disable no-unused-expressions
import { listPackages, getPackagesInfo } from 'kernelsu'
import { createIcons, Eye, EyeOff } from 'lucide'
import PinyinMatch from 'pinyin-match'
import { showToast, runCmd, readConfig, updateConfig } from './utils.js'

let showingSystemApps = true
let savedBlacklist = new Set()
let activityEntries = new Set() // 活动级黑名单条目（格式：pkg/ActivityClass）

export function updateUnsavedStyling() {
  const items = document.querySelectorAll('.app-list-item')
  items.forEach((item) => {
    const cb = item.querySelector('.app-checkbox')
    const custom = item.querySelector('.app-checkbox-custom')
    if (!cb || !custom) return
    const pkg = cb.dataset.pkg
    const hasActivities = pkg && [...activityEntries].some((e) => e.startsWith(pkg + '/'))
    // 部分选中：有活动条目但包名未完全选中
    if (!cb.checked && hasActivities) {
      custom.classList.add('partial')
    } else {
      custom.classList.remove('partial')
    }
    // 未保存高亮
    if (cb.checked && !savedBlacklist.has(pkg)) {
      cb.classList.add('unsaved')
    } else {
      cb.classList.remove('unsaved')
    }
    // 箭头可见性
    const chevron = item.querySelector('.app-activities-chevron')
    if (chevron) {
      chevron.style.display = hasActivities ? '' : 'none'
      if (!hasActivities) {
        const actList = item.querySelector('.app-activities-list')
        if (actList) {
          actList.classList.remove('show')
          chevron.classList.remove('expanded')
        }
      }
    }
  })
}

export function reorderDOMApps() {
  const container = document.getElementById('app-list-container')
  if (!container) return
  const items = Array.from(container.children)
  const getState = (item) => {
    const cb = item.querySelector('.app-checkbox')
    if (cb?.checked) return 2 // 完全选中
    const pkg = cb?.dataset.pkg
    if (pkg && [...activityEntries].some((e) => e.startsWith(pkg + '/'))) return 1 // 部分选中
    return 0
  }
  items.sort((a, b) => getState(b) - getState(a))
  items.forEach((item) => container.appendChild(item))
}

export function renderActivityList(pkg, container) {
  const entries = [...activityEntries].filter((e) => e.startsWith(pkg + '/'))
  container.innerHTML = ''
  entries.forEach((entry) => {
    const entryDiv = document.createElement('div')
    entryDiv.className = 'activity-entry-item'
    const actPath = document.createElement('span')
    actPath.className = 'activity-entry-path'
    actPath.textContent = entry.slice(pkg.length + 1)
    const delBtn = document.createElement('button')
    delBtn.className = 'activity-entry-delete'
    delBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      activityEntries.delete(entry)
      renderActivityList(pkg, container)
      const actItem = container.closest('.app-list-item')
      if (actItem) {
        const chevron = actItem.querySelector('.app-activities-chevron')
        const remaining = [...activityEntries].filter((e) => e.startsWith(pkg + '/'))
        if (chevron) chevron.style.display = remaining.length > 0 ? '' : 'none'
        if (remaining.length === 0) {
          container.classList.remove('show')
          if (chevron) chevron.classList.remove('expanded')
        }
      }
      updateUnsavedStyling()
      reorderDOMApps()
    })
    entryDiv.appendChild(actPath)
    entryDiv.appendChild(delBtn)
    container.appendChild(entryDiv)
  })
}

export async function loadApps() {
  const container = document.getElementById('app-list-container')
  if (!container) return
  container.innerHTML =
    '<div style="text-align:center;padding:20px;color:var(--md-sys-color-on-surface-variant);">加载中...</div>'

  try {
    // 读取已保存的黑名单（从 JSON 配置读取）
    const cfg = await readConfig()
    const allSaved = Array.isArray(cfg.blacklist_apps) ? cfg.blacklist_apps : []
    savedBlacklist = new Set(allSaved)
    const savedPkgEntries = new Set(allSaved.filter((e) => !e.includes('/')))
    activityEntries = new Set(allSaved.filter((e) => e.includes('/')))

    let infoList = []
    try {
      const pkgs = await listPackages()
      if (pkgs && pkgs.length > 0) {
        infoList = await getPackagesInfo(pkgs)
      } else {
        throw new Error('No packages found')
      }
    } catch {
      // 模拟 150 个应用包数据用于调试
      console.log('[DEBUG] 使用模拟应用列表数据')
      infoList = Array.from({ length: 150 }, (_, i) => ({
        packageName: `com.mock.app${i}`,
        appLabel: i % 10 === 0 ? `测试应用 ${i} (含抖音关键字)` : `模拟应用 ${i}`,
        isSystem: i % 5 === 0,
        uid: 10000 + i,
      }))
    }

    // 过滤系统应用
    if (!showingSystemApps) {
      infoList = infoList.filter((app) => !app.isSystem)
    }

    container.innerHTML = ''

    // 排序：非系统优先，按名称
    infoList.sort((a, b) => {
      if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1
      return (a.appLabel || '').localeCompare(b.appLabel || '')
    })

    if (infoList.length === 0) {
      infoList.push(
        {
          packageName: 'com.example.app1',
          appLabel: '示例 1',
          isSystem: false,
          uid: 10123,
        },
        {
          packageName: 'com.example.app2',
          appLabel: '示例 2',
          isSystem: false,
          uid: 10124,
        },
        {
          packageName: 'com.example.sys1',
          appLabel: '系统示例 1',
          isSystem: true,
          uid: 1000,
        },
        {
          packageName: 'com.example.sys2',
          appLabel: '系统示例 2',
          isSystem: true,
          uid: 1001,
        },
      )
      if (!showingSystemApps) {
        infoList = infoList.filter((app) => !app.isSystem)
      }
    }

    // uid 去重
    const seenUids = new Set()
    infoList = infoList.filter((app) => {
      if (app.uid === undefined || app.uid === null) return true
      if (seenUids.has(app.uid)) return false
      seenUids.add(app.uid)
      return true
    })

    infoList.forEach((app) => {
      const item = document.createElement('div')
      item.className = 'app-list-item'

      const checkboxLabel = document.createElement('label')
      checkboxLabel.className = 'app-checkbox-label'

      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.className = 'app-checkbox'
      checkbox.dataset.pkg = app.packageName

      // 依据已保存包名条目勾选（不含活动条目）
      checkbox.checked = savedPkgEntries.has(app.packageName)
      checkbox.addEventListener('change', () => {
        updateUnsavedStyling()
        reorderDOMApps()
      })

      const customCheckbox = document.createElement('span')
      customCheckbox.className = 'app-checkbox-custom'
      checkboxLabel.appendChild(checkbox)
      checkboxLabel.appendChild(customCheckbox)

      const infoDiv = document.createElement('div')
      infoDiv.className = 'app-info'

      const nameSpan = document.createElement('span')
      nameSpan.className = 'app-name'
      nameSpan.appendChild(document.createTextNode(app.appLabel || 'Unknown'))

      if (app.uid !== undefined) {
        const uidBadge = document.createElement('span')
        uidBadge.className = 'app-uid'
        uidBadge.textContent = String(app.uid)
        nameSpan.appendChild(uidBadge)
      }

      const pkgSpan = document.createElement('span')
      pkgSpan.className = 'app-pkg'
      pkgSpan.textContent = app.packageName || ''

      if (app.isSystem) {
        const sysBadge = document.createElement('span')
        sysBadge.className = 'app-badge'
        sysBadge.textContent = '系统'
        pkgSpan.appendChild(sysBadge)
      }

      infoDiv.appendChild(nameSpan)
      infoDiv.appendChild(pkgSpan)

      // 活动展开箭头
      const chevronBtn = document.createElement('button')
      chevronBtn.className = 'app-activities-chevron'
      chevronBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
      const pkgActivities = [...activityEntries].filter((e) => e.startsWith(app.packageName + '/'))
      chevronBtn.style.display = pkgActivities.length > 0 ? '' : 'none'

      const mainRow = document.createElement('div')
      mainRow.className = 'app-item-main-row'
      mainRow.appendChild(checkboxLabel)
      mainRow.appendChild(infoDiv)
      mainRow.appendChild(chevronBtn)

      // 活动列表（初始折叠）
      const actListDiv = document.createElement('div')
      actListDiv.className = 'app-activities-list'
      actListDiv.dataset.pkg = app.packageName
      renderActivityList(app.packageName, actListDiv)

      chevronBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        actListDiv.classList.toggle('show')
        chevronBtn.classList.toggle('expanded')
      })

      item.appendChild(mainRow)
      item.appendChild(actListDiv)
      container.appendChild(item)
    })

    updateUnsavedStyling()
    reorderDOMApps()

    const badge = document.getElementById('app-count-badge')
    if (badge) badge.textContent = infoList.length

    if (infoList.length === 0) {
      container.innerHTML =
        '<div style="text-align:center;padding:20px;color:var(--md-sys-color-on-surface-variant);">无应用</div>'
    }
  } catch (e) {
    container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--md-sys-color-error);">加载失败: ${e.message || String(e)}</div>`
  }
}

export function setupAppsEvents() {
  // 下拉菜单控制
  const btnAppsMenu = document.getElementById('btn-apps-menu')
  const appsDropdownMenu = document.getElementById('apps-dropdown-menu')

  if (btnAppsMenu && appsDropdownMenu) {
    btnAppsMenu.addEventListener('click', (e) => {
      e.stopPropagation()
      appsDropdownMenu.classList.toggle('show')
    })
    document.addEventListener('click', (e) => {
      if (!btnAppsMenu.contains(e.target) && !appsDropdownMenu.contains(e.target)) {
        appsDropdownMenu.classList.remove('show')
      }
    })
  }

  // 切换系统应用显示
  const btnToggleSysApps = document.getElementById('btn-toggle-sys-apps')
  if (btnToggleSysApps) {
    btnToggleSysApps.addEventListener('click', () => {
      showingSystemApps = !showingSystemApps

      const textSpan = document.getElementById('sys-apps-text')
      const iconWrap = document.getElementById('sys-apps-icon')

      if (textSpan) textSpan.textContent = showingSystemApps ? '隐藏系统应用' : '显示系统应用'

      if (iconWrap) {
        const p = iconWrap.parentNode
        const newIcon = document.createElement('i')
        newIcon.setAttribute('data-lucide', showingSystemApps ? 'eye-off' : 'eye')
        newIcon.id = 'sys-apps-icon'
        p.replaceChild(newIcon, iconWrap)
        createIcons({ icons: { Eye, EyeOff }, nameAttr: 'data-lucide' })
      }

      loadApps()
      appsDropdownMenu && appsDropdownMenu.classList.remove('show')
    })
  }

  // 智能选择
  const btnSmartSelect = document.getElementById('btn-smart-select')
  if (btnSmartSelect) {
    const smartKeywords = [
      '相册',
      '抖音',
      '快手',
      '视频',
      '哔哩哔哩',
      'bili',
      'pili',
      'netflix',
      'youtube',
      'tiktok',
      'x',
    ]
    btnSmartSelect.addEventListener('click', () => {
      const items = document.querySelectorAll('.app-list-item')
      items.forEach((item) => {
        const name = item.querySelector('.app-name').textContent.toLowerCase()
        const checkbox = item.querySelector('.app-checkbox')
        let match = false
        for (const kw of smartKeywords) {
          if (kw === 'x') {
            if (name === 'x' || name === 'x (twitter)') {
              match = true
              break
            }
          } else if (name.includes(kw)) {
            match = true
            break
          }
        }
        if (match) checkbox.checked = true
      })
      updateUnsavedStyling()
      reorderDOMApps()
      appsDropdownMenu && appsDropdownMenu.classList.remove('show')
    })
  }

  // 手动添加包名
  const btnManualAdd = document.getElementById('btn-manual-add')
  if (btnManualAdd) {
    btnManualAdd.addEventListener('click', async () => {
      appsDropdownMenu && appsDropdownMenu.classList.remove('show')
      const pkg = prompt('请输入你要彻底屏蔽的完整应用包名（例如: com.example.app）：')
      if (!pkg || !pkg.trim()) return

      const realPkg = pkg.trim()
      const existing = document.querySelector(`.app-checkbox[data-pkg="${realPkg}"]`)
      if (existing) {
        existing.checked = true
        updateUnsavedStyling()
        reorderDOMApps()
        showToast('该应用已在列表中，已为你自动勾选并置顶')
        return
      }

      showToast('正在尝试获取应用信息...')
      let appData = {
        packageName: realPkg,
        appLabel: '未知 (手动添加)',
        isSystem: false,
        uid: '自定义',
      }
      try {
        const info = await getPackagesInfo([realPkg])
        if (info && info.length > 0) appData = info[0]
      } catch {
        /* ignore */
      }

      const container = document.getElementById('app-list-container')
      const item = document.createElement('div')
      item.className = 'app-list-item'

      const checkboxLabel = document.createElement('label')
      checkboxLabel.className = 'app-checkbox-label'

      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.className = 'app-checkbox'
      checkbox.dataset.pkg = realPkg
      checkbox.checked = true
      checkbox.addEventListener('change', () => {
        updateUnsavedStyling()
        reorderDOMApps()
      })

      const customCheckbox = document.createElement('span')
      customCheckbox.className = 'app-checkbox-custom'
      checkboxLabel.appendChild(checkbox)
      checkboxLabel.appendChild(customCheckbox)

      const infoDiv = document.createElement('div')
      infoDiv.className = 'app-info'

      const nameSpan = document.createElement('span')
      nameSpan.className = 'app-name'
      nameSpan.appendChild(document.createTextNode(appData.appLabel || 'Unknown'))

      if (appData.uid !== undefined) {
        const uidBadge = document.createElement('span')
        uidBadge.className = 'app-uid'
        uidBadge.textContent = String(appData.uid)
        nameSpan.appendChild(uidBadge)
      }

      const pkgSpan = document.createElement('span')
      pkgSpan.className = 'app-pkg'
      pkgSpan.textContent = realPkg

      if (appData.isSystem) {
        const sysBadge = document.createElement('span')
        sysBadge.className = 'app-badge'
        sysBadge.textContent = '系统'
        pkgSpan.appendChild(sysBadge)
      }

      infoDiv.appendChild(nameSpan)
      infoDiv.appendChild(pkgSpan)

      const chevronBtn = document.createElement('button')
      chevronBtn.className = 'app-activities-chevron'
      chevronBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
      chevronBtn.style.display = 'none'

      const mainRow = document.createElement('div')
      mainRow.className = 'app-item-main-row'
      mainRow.appendChild(checkboxLabel)
      mainRow.appendChild(infoDiv)
      mainRow.appendChild(chevronBtn)

      const actListDiv = document.createElement('div')
      actListDiv.className = 'app-activities-list'
      actListDiv.dataset.pkg = realPkg

      chevronBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        actListDiv.classList.toggle('show')
        chevronBtn.classList.toggle('expanded')
      })

      item.appendChild(mainRow)
      item.appendChild(actListDiv)
      container.appendChild(item)

      updateUnsavedStyling()
      reorderDOMApps()
      showToast('已成功添加并勾选')
    })
  }

  // 全选
  const btnSelectAll = document.getElementById('btn-select-all')
  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', () => {
      document.querySelectorAll('.app-checkbox').forEach((cb) => {
        cb.checked = true
      })
      updateUnsavedStyling()
      appsDropdownMenu && appsDropdownMenu.classList.remove('show')
    })
  }

  // 全不选
  const btnSelectNone = document.getElementById('btn-select-none')
  if (btnSelectNone) {
    btnSelectNone.addEventListener('click', () => {
      document.querySelectorAll('.app-checkbox').forEach((cb) => {
        cb.checked = false
      })
      updateUnsavedStyling()
      appsDropdownMenu && appsDropdownMenu.classList.remove('show')
    })
  }

  // 反选
  const btnInvertSelection = document.getElementById('btn-invert-selection')
  if (btnInvertSelection) {
    btnInvertSelection.addEventListener('click', () => {
      document.querySelectorAll('.app-checkbox').forEach((cb) => {
        cb.checked = !cb.checked
      })
      updateUnsavedStyling()
      appsDropdownMenu && appsDropdownMenu.classList.remove('show')
    })
  }

  // 刷新（重排）
  const btnAppsRefresh = document.getElementById('btn-apps-refresh')
  if (btnAppsRefresh) {
    btnAppsRefresh.addEventListener('click', () => {
      reorderDOMApps()
    })
  }

  // 保存黑名单
  const btnSaveBlacklist = document.getElementById('btn-save-blacklist')
  if (btnSaveBlacklist) {
    btnSaveBlacklist.addEventListener('click', async () => {
      showToast('保存中...')
      const selectedPkgs = []
      document.querySelectorAll('.app-checkbox').forEach((cb) => {
        if (cb.checked) selectedPkgs.push(cb.dataset.pkg)
      })
      const allEntries = [...selectedPkgs, ...activityEntries]
      const res = await updateConfig({ blacklist_apps: allEntries })
      if (res.errno === 0 || res.stdout?.includes('OK')) {
        showToast('黑名单保存成功')
        savedBlacklist = new Set(allEntries)
        updateUnsavedStyling()
        reorderDOMApps()
      } else {
        showToast('保存失败: ' + res.stderr)
      }
    })
  }

  // 按活动屏蔽
  const btnAddActivity = document.getElementById('btn-add-activity')
  const inputActivityEntry = document.getElementById('input-activity-entry')
  if (btnAddActivity && inputActivityEntry) {
    const doAddActivity = () => {
      const val = inputActivityEntry.value.trim()
      if (!val) return
      const parts = val.split('/')
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        showToast('格式错误，请输入 包名/完整活动类名')
        return
      }
      activityEntries.add(val)
      inputActivityEntry.value = ''
      const pkg = parts[0]
      document.querySelectorAll('.app-list-item').forEach((appItem) => {
        const cb = appItem.querySelector('.app-checkbox')
        if (cb && cb.dataset.pkg === pkg) {
          const actList = appItem.querySelector('.app-activities-list')
          const chevron = appItem.querySelector('.app-activities-chevron')
          if (actList) {
            renderActivityList(pkg, actList)
            actList.classList.add('show')
          }
          if (chevron) {
            chevron.style.display = ''
            chevron.classList.add('expanded')
          }
        }
      })
      updateUnsavedStyling()
      reorderDOMApps()
      showToast(`已添加: ${val}`)
    }
    btnAddActivity.addEventListener('click', doAddActivity)
    inputActivityEntry.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doAddActivity()
    })
  }

  // 搜索
  const inputAppSearch = document.getElementById('input-app-search')
  if (inputAppSearch) {
    inputAppSearch.addEventListener('input', (e) => {
      const keyword = e.target.value.trim().toLowerCase()
      const items = document.querySelectorAll('.app-list-item')
      let visibleCount = 0
      items.forEach((item) => {
        const name = item.querySelector('.app-name').textContent
        const pkg = item.querySelector('.app-pkg').textContent.toLowerCase()
        if (!keyword || pkg.includes(keyword) || PinyinMatch.match(name, keyword)) {
          item.style.display = 'flex'
          visibleCount++
        } else {
          item.style.display = 'none'
        }
      })
      const badge = document.getElementById('app-count-badge')
      if (badge) badge.textContent = visibleCount
    })
  }

  setupActivityPicker()
}

function setupActivityPicker() {
  const overlay = document.getElementById('activity-picker-overlay')
  if (!overlay) return

  const btnPickActivity = document.getElementById('btn-pick-activity')
  const btnPickerBack = document.getElementById('btn-picker-back')
  const step1 = document.getElementById('picker-step-1')
  const step2 = document.getElementById('picker-step-2')
  const step3 = document.getElementById('picker-step-3')
  const dots = [
    document.getElementById('picker-dot-1'),
    document.getElementById('picker-dot-2'),
    document.getElementById('picker-dot-3'),
  ]
  const btnStep1Next = document.getElementById('btn-picker-step1-next')
  const btnPickerStart = document.getElementById('btn-picker-start')
  const btnPickerRetry = document.getElementById('btn-picker-retry')
  const btnPickerConfirm = document.getElementById('btn-picker-confirm')
  const pickerStatusText = document.getElementById('picker-status-text')
  const pickerResultText = document.getElementById('picker-result-text')

  let pollingTimer = null
  let detectedActivity = null

  function showStep(n) {
    ;[step1, step2, step3].forEach((s, i) => {
      if (s) s.style.display = i + 1 === n ? 'flex' : 'none'
    })
    dots.forEach((d, i) => {
      d?.classList.toggle('active', i + 1 === n)
    })
  }

  function stopPolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer)
      pollingTimer = null
    }
  }

  function openPicker() {
    stopPolling()
    detectedActivity = null
    if (btnPickerStart) btnPickerStart.disabled = false
    if (pickerStatusText) {
      pickerStatusText.textContent = '等待中...'
      pickerStatusText.classList.remove('polling')
    }
    showStep(1)
    overlay.classList.add('show')
  }

  function closePicker() {
    stopPolling()
    overlay.classList.remove('show')
  }

  btnPickActivity?.addEventListener('click', openPicker)
  btnPickerBack?.addEventListener('click', closePicker)
  btnStep1Next?.addEventListener('click', () => showStep(2))

  btnPickerStart?.addEventListener('click', () => {
    btnPickerStart.disabled = true
    if (pickerStatusText) {
      pickerStatusText.textContent = '检测中，请切换到目标界面...'
      pickerStatusText.classList.add('polling')
    }
    stopPolling()
    pollingTimer = setInterval(async () => {
      try {
        const res = await runCmd(
          `dumpsys window 2>/dev/null | grep mCurrentFocus | sed 's/.*u[0-9][0-9]* //' | sed 's/}.*//'`,
        )
        if (res.errno !== 0) return
        const activity = res.stdout.trim()
        // 空值或仍在 WebUI 内则继续等待
        if (!activity || activity.toLowerCase().includes('webui')) return
        stopPolling()
        detectedActivity = activity
        if (pickerStatusText) pickerStatusText.classList.remove('polling')
        if (pickerResultText) pickerResultText.textContent = activity
        if (btnPickerStart) btnPickerStart.disabled = false
        showStep(3)
      } catch {
        /* 忽略，继续轮询 */
      }
    }, 600)
  })

  btnPickerRetry?.addEventListener('click', () => {
    stopPolling()
    detectedActivity = null
    if (btnPickerStart) btnPickerStart.disabled = false
    if (pickerStatusText) {
      pickerStatusText.textContent = '等待中...'
      pickerStatusText.classList.remove('polling')
    }
    showStep(2)
  })

  btnPickerConfirm?.addEventListener('click', () => {
    if (!detectedActivity) return
    activityEntries.add(detectedActivity)
    const pkg = detectedActivity.split('/')[0]
    document.querySelectorAll('.app-list-item').forEach((appItem) => {
      const cb = appItem.querySelector('.app-checkbox')
      if (cb && cb.dataset.pkg === pkg) {
        const actList = appItem.querySelector('.app-activities-list')
        const chevron = appItem.querySelector('.app-activities-chevron')
        if (actList) {
          renderActivityList(pkg, actList)
          actList.classList.add('show')
        }
        if (chevron) {
          chevron.style.display = ''
          chevron.classList.add('expanded')
        }
      }
    })
    updateUnsavedStyling()
    reorderDOMApps()
    showToast(`已添加: ${detectedActivity}`)
    closePicker()
  })
}
