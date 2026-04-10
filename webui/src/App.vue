<script setup>
import { ref, computed, provide, onMounted, onUnmounted, watch } from 'vue'
import { moduleInfo } from 'kernelsu'
import { runCmd, showToast } from './utils.js'
import { useStatus } from './composables/useStatus.js'
import { useConfig } from './composables/useConfig.js'
import { useLog } from './composables/useLog.js'
import BottomNav from './components/BottomNav.vue'
import StatusView from './views/StatusView.vue'
import ConfigView from './views/ConfigView.vue'
import AppsView from './views/AppsView.vue'
import LogView from './views/LogView.vue'
import AboutView from './views/AboutView.vue'

const NAV_ORDER = ['status', 'config', 'apps', 'log', 'about']
const currentView = ref('status')
const headerEl = ref(null)
const headerHidden = ref(false)

const trackStyle = computed(() => {
  const idx = NAV_ORDER.indexOf(currentView.value)
  return { transform: `translateX(${-idx * 100}%)` }
})
const moduleVersion = ref('')
const status = useStatus()
const config = useConfig()
const log = useLog()

// 供子组件使用
provide('showToast', showToast)
provide('status', status)
provide('config', config)
provide('log', log)

let refreshTimer = null

function startRefresh() {
  stopRefresh()
  if (!config.autoRefresh.value) return
  const interval = config.statusRefreshInterval.value
  refreshTimer = setInterval(async () => {
    try {
      await Promise.all([status.load(), log.load()])
    } catch {}
  }, interval)
}

function stopRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

function restartRefresh(enabled, interval) {
  config.autoRefresh.value = enabled
  config.statusRefreshInterval.value = interval
  startRefresh()
}
provide('restartRefresh', restartRefresh)

// 跟随系统色彩偏好变化
let _mq = null
function _onSystemTheme() {
  if (config.themeMode.value === 'system') config.applyTheme('system')
}

onMounted(async () => {
  // 应用 UI 缩放 + 主题
  config.applyZoom()
  config.applyTheme(config.themeMode.value)
  _mq = window.matchMedia('(prefers-color-scheme: light)')
  _mq.addEventListener('change', _onSystemTheme)

  // 读取模块版本
  try {
    const info = JSON.parse(moduleInfo())
    moduleVersion.value = info.version || ''
  } catch {
    moduleVersion.value = '[debug]'
  }

  window.removeEventListener('scroll', onPageScroll)

  // 测量 header 高度，用于隐藏时 viewport 补位
  if (headerEl.value) {
    const h = headerEl.value.offsetHeight
    const appEl = document.getElementById('app')
    if (appEl) appEl.style.setProperty('--header-height', h + 'px')
  }

  // 初始加载
  try {
    await Promise.all([status.load(true), config.load(), log.load()])
  } catch {}

  startRefresh()
})

onUnmounted(() => {
  stopRefresh()
  _mq?.removeEventListener('change', _onSystemTheme)
})

function onPageScroll(e) {
  // 只响应 .page-slide 的滚动，忽略内部子滚动容器（如应用列表）
  if (!e.target.classList.contains('page-slide')) return
  const topBlur = document.querySelector('.top-blur')
  const { scrollTop } = e.target
  if (topBlur) topBlur.classList.toggle('scrolled', scrollTop > 10)
  headerHidden.value = scrollTop > 0
}

function handleViewChange(view) {
  currentView.value = view
  headerHidden.value = false // 切换页面时恢复显示 header

  const idx = NAV_ORDER.indexOf(view)
  const slides = document.querySelectorAll('.page-slide')
  const slide = slides[idx]

  // 切换页面时回顶
  if (slide) slide.scrollTop = 0

  // 切换后 top-blur 跟随新页面状态（已回顶故一定为 false）
  const topBlur = document.querySelector('.top-blur')
  if (topBlur) topBlur.classList.remove('scrolled')
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <!-- 顶部状态栏渐变模糊 -->
    <div class="top-blur"></div>

    <div id="app" :class="{ 'header-hidden': headerHidden }">
      <!-- 顶部头 -->
      <header class="app-header" ref="headerEl">
        <div class="header-content">
          <div class="header-text">
            <h1>LuminPro</h1>
            <p class="header-subtitle">日用屏幕亮度强化</p>
            <p class="header-version">{{ moduleVersion || 'V2.2' }}</p>
          </div>
        </div>
        <div class="header-status-container">
          <div class="header-status" id="module-status" :class="status.statusClass.value">
            <span class="status-dot"></span>
            <span class="status-text">{{ status.statusText.value }}</span>
          </div>
          <div class="header-status-actions">
            <button
              class="btn-status-action"
              id="btn-toggle-service"
              @click="status.toggleService(showToast)"
            >
              {{ status.isPaused.value ? '启用' : '暂停' }}
            </button>
            <button
              class="btn-status-action"
              id="btn-restart-service"
              @click="status.restartService(showToast)"
            >
              重启
            </button>
          </div>
        </div>
      </header>

      <!-- 左右滑动页面区 -->
      <div class="page-viewport" @scroll.capture.passive="onPageScroll">
        <div class="page-track" :style="trackStyle">
          <div class="page-slide"><StatusView /></div>
          <div class="page-slide"><ConfigView /></div>
          <div class="page-slide"><AppsView /></div>
          <div class="page-slide"><LogView /></div>
          <div class="page-slide"><AboutView /></div>
        </div>
      </div>
    </div>

    <!-- 底栏导航 -->
    <BottomNav v-model="currentView" @update:model-value="handleViewChange" />

    <!-- Toast (保持 id="toast" 供 utils.js showToast 使用) -->
    <div class="toast" id="toast"></div>
  </div>
</template>
