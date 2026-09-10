<script setup>
import { inject, computed, ref } from 'vue'
import { SunMedium, Smartphone, Activity, Clock, Moon, Layers, Gauge, RefreshCw } from 'lucide-vue-next'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const status = inject('status')
const snackbar = inject('snackbar')

const sliderEl = ref(null)
const confirmLowOpen = ref(false)
const pendingValue = ref(0)

const DAEMON_STATES = { S: '休眠中', R: '运行中', D: '等待中', T: '已停止', Z: '异常' }

const items = computed(() => {
  const daemon = status.daemon.value
  const brightness = status.brightness.value
  return [
    { label: '当前亮度', value: brightness.current ?? '—', icon: SunMedium },
    { label: '系统最大亮度', value: brightness.max || '—', icon: Smartphone },
    { label: '守护进程 PID', value: daemon.running ? daemon.pid : '离线', icon: Activity },
    {
      label: '守护进程状态',
      value: daemon.running ? DAEMON_STATES[daemon.state] || daemon.state || '运行中' : '未运行',
      icon: Clock,
    },
    { label: '休眠状态', value: status.sleepText.value, icon: Moon },
    { label: 'HDR/SDR 比率', value: status.hdrText.value, icon: Layers },
  ]
})

const maxBrightness = computed(() => status.brightness.value.max || 255)
const currentBrightness = computed(() => status.brightness.value.current || 0)
const percent = computed(() => status.brightness.value.percent ?? 0)
const uiThreshold = computed(() => status.cfg.value.uiMaxBri ?? 0)
const thresholdPercent = computed(() =>
  Math.round((uiThreshold.value / maxBrightness.value) * 100),
)
const autoBrightness = computed(() => status.display.value?.autoBrightness ?? null)
const nodeError = computed(() => status.brightness.value.error || '')

async function refresh() {
  await status.load({ display: true })
  snackbar('已刷新')
}

async function applyBrightness(value) {
  try {
    await status.setBrightness(value)
    snackbar(`亮度已设为 ${value}`)
  } catch (e) {
    snackbar(`设置失败: ${e.message}`)
  }
}

async function onSliderChange(event) {
  const value = Number(event.target.value)
  const pct = Math.round((value / maxBrightness.value) * 100)
  if (pct < 5) {
    pendingValue.value = value
    confirmLowOpen.value = true
    return
  }
  await applyBrightness(value)
}

function cancelLow() {
  confirmLowOpen.value = false
  if (sliderEl.value) sliderEl.value.value = currentBrightness.value
}

async function confirmLow() {
  confirmLowOpen.value = false
  await applyBrightness(pendingValue.value)
}
</script>

<template>
  <section class="section">
    <div class="section-header">
      <h2 class="section-title ts-title-md">实时状态</h2>
      <span v-if="status.error.value" class="state-badge is-unsaved">读取失败</span>
      <md-icon-button title="刷新" @click="refresh">
        <RefreshCw :size="20" />
      </md-icon-button>
    </div>

    <div class="status-grid">
      <div v-for="item in items" :key="item.label" class="status-item">
        <span class="status-item__label">
          <component :is="item.icon" :size="14" aria-hidden="true" />
          {{ item.label }}
        </span>
        <span class="status-item__value tabular">{{ item.value }}</span>
      </div>
    </div>

    <p v-if="nodeError" class="ts-body-sm supporting">
      亮度节点不可用：{{ nodeError }}
    </p>
    <p v-else-if="autoBrightness" class="ts-body-sm supporting">
      系统自动亮度已开启，模块会跳过亮度提升
    </p>
  </section>

  <section class="section">
    <div class="section-header">
      <h2 class="section-title ts-title-md">亮度</h2>
      <span class="ts-title-md mono">{{ percent }}%</span>
    </div>

    <div class="slider-row">
      <Gauge :size="18" aria-hidden="true" />
      <md-slider
        ref="sliderEl"
        class="brightness-slider"
        :min="0"
        :max="maxBrightness"
        :value="currentBrightness"
        labeled
        @change="onSliderChange"
      ></md-slider>
    </div>

    <p class="ts-body-sm supporting">
      触发阈值 {{ uiThreshold }}（约 {{ thresholdPercent }}%）：亮度达到该值后模块会平滑提升到峰值。
    </p>
  </section>

  <ConfirmDialog
    :open="confirmLowOpen"
    headline="亮度低于 5%"
    description="继续可能让屏幕接近黑屏，确定要设置吗？"
    confirm-text="仍然设置"
    danger
    @confirm="confirmLow"
    @cancel="cancelLow"
  />
</template>

<style scoped>
.slider-row {
  display: flex;
  align-items: center;
  gap: var(--md-sys-spacing-3);
  color: var(--md-sys-color-on-surface-variant);
}

.brightness-slider {
  flex: 1;
  --md-slider-active-track-color: var(--md-sys-color-primary);
  --md-slider-handle-color: var(--md-sys-color-primary);
  --md-slider-inactive-track-color: var(--md-sys-color-surface-variant);
  --md-slider-label-container-color: var(--md-sys-color-primary);
}
</style>
