<script setup>
import { ref, provide, onMounted, onUnmounted, watch } from 'vue';
import { moduleInfo } from 'kernelsu';
import { runCmd, showToast } from './utils.js';
import { useStatus } from './composables/useStatus.js';
import { useConfig } from './composables/useConfig.js';
import { useLog } from './composables/useLog.js';
import BottomNav from './components/BottomNav.vue';
import StatusView from './views/StatusView.vue';
import ConfigView from './views/ConfigView.vue';
import AppsView from './views/AppsView.vue';
import LogView from './views/LogView.vue';
import AboutView from './views/AboutView.vue';

const currentView = ref('status');
const moduleVersion = ref('');
const status = useStatus();
const config = useConfig();
const log = useLog();

// 供子组件使用
provide('showToast', showToast);
provide('status', status);
provide('config', config);
provide('log', log);

let refreshTimer = null;

function startRefresh() {
  stopRefresh();
  if (!config.autoRefresh.value) return;
  const interval = config.statusRefreshInterval.value;
  refreshTimer = setInterval(async () => {
    try {
      await Promise.all([status.load(), log.load()]);
    } catch {}
  }, interval);
}

function stopRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

function restartRefresh(enabled, interval) {
  config.autoRefresh.value = enabled;
  config.statusRefreshInterval.value = interval;
  startRefresh();
}
provide('restartRefresh', restartRefresh);

// 跟随系统色彩偏好变化
let _mq = null;
function _onSystemTheme() {
  if (config.themeMode.value === 'system') config.applyTheme('system');
}

onMounted(async () => {
  // 应用 UI 缩放 + 主题
  config.applyZoom();
  config.applyTheme(config.themeMode.value);
  _mq = window.matchMedia('(prefers-color-scheme: light)');
  _mq.addEventListener('change', _onSystemTheme);

  // 读取模块版本
  try {
    const info = JSON.parse(moduleInfo());
    moduleVersion.value = info.version || '';
  } catch {
    moduleVersion.value = '[debug]';
  }

  // 页面滚动监听
  window.addEventListener('scroll', onScroll, { passive: true });

  // 初始加载
  try {
    await Promise.all([status.load(true), config.load(), log.load()]);
  } catch {}

  startRefresh();
});

onUnmounted(() => {
  stopRefresh();
  window.removeEventListener('scroll', onScroll);
  _mq?.removeEventListener('change', _onSystemTheme);
});

function onScroll() {
  const topBlur = document.querySelector('.top-blur');
  if (topBlur) topBlur.classList.toggle('scrolled', window.scrollY > 10);
}

function handleViewChange(view) {
  currentView.value = view;
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <!-- 顶部状态栏渐变模糊 -->
    <div class="top-blur"></div>

    <div id="app">
      <!-- 顶部头 -->
      <header class="app-header">
        <div class="header-content">
          <div class="header-text">
            <h1>LuminPro</h1>
            <p class="header-subtitle">日用屏幕亮度强化</p>
            <p class="header-version">{{ moduleVersion || 'V2.2' }}</p>
          </div>
        </div>
        <div class="header-status-container">
          <div
            class="header-status"
            id="module-status"
            :class="status.statusClass.value"
          >
            <span class="status-dot"></span>
            <span class="status-text">{{ status.statusText.value }}</span>
          </div>
          <div class="header-status-actions">
            <button class="btn-status-action" id="btn-toggle-service" @click="status.toggleService(showToast)">
              {{ status.isPaused.value ? '启用' : '暂停' }}
            </button>
            <button class="btn-status-action" id="btn-restart-service" @click="status.restartService(showToast)">
              重启
            </button>
          </div>
        </div>
      </header>

      <!-- 各视图（v-show 保持 DOM 以维持状态） -->
      <StatusView v-show="currentView === 'status'" />
      <ConfigView v-show="currentView === 'config'" />
      <AppsView v-show="currentView === 'apps'" />
      <LogView v-show="currentView === 'log'" />
      <AboutView v-show="currentView === 'about'" />
    </div>

    <!-- 底栏导航 -->
    <BottomNav v-model="currentView" @update:model-value="handleViewChange" />

    <!-- Toast (保持 id="toast" 供 utils.js showToast 使用) -->
    <div class="toast" id="toast"></div>
  </div>
</template>
