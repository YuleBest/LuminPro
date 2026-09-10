<script setup>
import { ref, computed, provide, onMounted, onUnmounted, watch } from 'vue'
import { useStatus } from './composables/useStatus.js'
import { useConfig } from './composables/useConfig.js'
import { useLog } from './composables/useLog.js'
import { useApps } from './composables/useApps.js'
import { useSnackbar, useWebUIPrefs } from './composables/useSnackbar.js'
import { moduleVersion } from './api/ksu.js'

import AppTopBar from './components/AppTopBar.vue'
import AppBottomNav from './components/AppBottomNav.vue'
import SnackbarHost from './components/SnackbarHost.vue'
import OpLockBanner from './components/OpLockBanner.vue'

import StatusView from './views/StatusView.vue'
import ConfigView from './views/ConfigView.vue'
import AppsView from './views/AppsView.vue'
import LogView from './views/LogView.vue'
import AboutView from './views/AboutView.vue'

const NAV_ORDER = ['status', 'config', 'apps', 'log', 'about']
const currentView = ref('status')
const scrolled = ref(false)
const version = ref(moduleVersion())

const snackbar = useSnackbar()
const status = useStatus()
const config = useConfig()
const log = useLog()
const apps = useApps()
const prefs = useWebUIPrefs()

provide('snackbar', snackbar.show)
provide('status', status)
provide('config', config)
provide('log', log)
provide('apps', apps)
provide('prefs', prefs)

const trackStyle = computed(() => ({
  transform: `translateX(${-NAV_ORDER.indexOf(currentView.value) * 100}%)`,
}))
const locked = computed(() => status.oplock.value.locked)

// ── 刷新循环 ────────────────────────────────────────────────────────
// 锁定期间只轮询操作锁（轻量），解锁后按用户频率刷新状态与日志；
// dumpsys/settings 每 N 次完整刷新才读一次，避免无谓开销。
const LOCK_POLL_INTERVAL = 300
const DISPLAY_EVERY = 5
let timer = null
let stopped = false
let ticks = 0

function schedule(ms) {
  timer = setTimeout(tick, ms)
}

async function tick() {
  timer = null
  if (stopped) return

  await status.refreshOplock()
  if (status.oplock.value.locked) {
    schedule(LOCK_POLL_INTERVAL)
    return
  }

  ticks += 1
  const withDisplay = ticks % DISPLAY_EVERY === 1
  await Promise.all([status.load({ display: withDisplay }), log.load()])
  schedule(Math.max(200, prefs.refreshInterval.value))
}

function startRefresh() {
  stopRefresh()
  stopped = false
  schedule(Math.max(200, prefs.refreshInterval.value))
}

function stopRefresh() {
  stopped = true
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

async function manualRefresh() {
  await Promise.all([status.load({ display: true }), log.load()])
  snackbar.show('已刷新')
}

function onPageScroll(event) {
  if (!event.target?.classList?.contains('page-slide')) return
  scrolled.value = event.target.scrollTop > 8
}

function onViewChange(view) {
  currentView.value = view
  scrolled.value = false
  const slides = document.querySelectorAll('.page-slide')
  const slide = slides[NAV_ORDER.indexOf(view)]
  if (slide) slide.scrollTop = 0
}

// 应用列表较慢，首次进入黑名单页再加载
watch(currentView, (view) => {
  if (view === 'apps' && apps.apps.value.length === 0 && !apps.isLoading.value) apps.load()
})

onMounted(async () => {
  prefs.applyZoom()
  prefs.applyTheme(prefs.themeMode.value)
  await Promise.all([status.load({ display: true }), config.load(), log.load()])
  startRefresh()
})

onUnmounted(stopRefresh)
</script>

<template>
  <AppTopBar
    :version="version"
    :status-text="status.statusText.value"
    :status-class="status.statusClass.value"
    :paused="status.isPaused.value"
    :locked="locked"
    :scrolled="scrolled"
    @refresh="manualRefresh"
    @toggle-service="status.toggleService(snackbar.show)"
    @restart="status.restart(snackbar.show)"
  />

  <OpLockBanner
    :locked="locked"
    :label="status.oplock.value.label || '正在执行后台操作'"
    :seconds="status.oplock.value.seconds || 0"
  />

  <div class="page-viewport" @scroll.capture.passive="onPageScroll">
    <div class="page-track" :style="trackStyle">
      <div class="page-slide"><StatusView /></div>
      <div class="page-slide"><ConfigView /></div>
      <div class="page-slide"><AppsView /></div>
      <div class="page-slide"><LogView /></div>
      <div class="page-slide"><AboutView /></div>
    </div>
  </div>

  <AppBottomNav :model-value="currentView" @update:model-value="onViewChange" />

  <SnackbarHost :messages="snackbar.messages.value" />
</template>
