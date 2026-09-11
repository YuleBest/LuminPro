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

let lastApplied = null

/** 拖动中节流：距上次应用超过 3% 才写一次节点，避免每个像素都 exec */
const DRAG_APPLY_STEP_PERCENT = 3

/** 低亮度保护：低于该比例视为伪黑屏风险，需用户确认后才允许 */
const MIN_PERCENT = 5
/** 用户确认过本次会话的低亮度设置（确认后不再重复拦截） */
const lowConfirmed = ref(false)

/** 5% 对应的亮度值，向上取整 */
const lowFloor = computed(() => Math.ceil(((maxBrightness.value || 255) * MIN_PERCENT) / 100))

/** 把滑条与已应用值拉回安全下限 */
function snapToFloor() {
  if (sliderEl.value) sliderEl.value.value = lowFloor.value
  return lowFloor.value
}

async function applyBrightness(value, { silent = false } = {}) {
  try {
    await status.setBrightness(value)
    lastApplied = value
    // 回到安全区以上后重置确认状态：下次再往下滑会重新提醒
    // 注意用严格大于：确认后应用的就是下限值本身，等于时不应重置
    if (value > lowFloor.value) lowConfirmed.value = false
    if (!silent) snackbar(`亮度已设为 ${value}`)
  } catch (e) {
    if (!silent) snackbar(`设置失败: ${e.message}`)
  }
}

/** 拖动过程中（input 事件）：先做低亮度拦截，再按比例节流应用 */
async function onSliderInput(event) {
  const value = Number(event.target.value)
  const max = maxBrightness.value || 255

  // 低亮度保护：未确认前直接拦在安全下限，避免滑到伪黑屏
  if (!lowConfirmed.value && value < lowFloor.value) {
    const floored = snapToFloor()
    if (!confirmLowOpen.value) {
      pendingValue.value = floored
      confirmLowOpen.value = true
    }
    return
  }

  if (lastApplied === null) {
    lastApplied = currentBrightness.value
  }
  const step = (max * DRAG_APPLY_STEP_PERCENT) / 100
  if (Math.abs(value - lastApplied) < step) return
  await applyBrightness(value, { silent: true })
}

async function onSliderChange(event) {
  const value = Number(event.target.value)

  // 未确认低亮度时，松手也不允许落在安全下限之下
  if (!lowConfirmed.value && value < lowFloor.value) {
    pendingValue.value = lowFloor.value
    snapToFloor()
    confirmLowOpen.value = true
    return
  }

  await applyBrightness(value)
  lastApplied = value
}

/** 取消：保持在安全下限，不写节点 */
function cancelLow() {
  confirmLowOpen.value = false
  if (sliderEl.value) sliderEl.value.value = lowFloor.value
}

/** 确认：本次会话放开低亮度限制，并应用目标值 */
async function confirmLow() {
  confirmLowOpen.value = false
  lowConfirmed.value = true
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
        @input="onSliderInput"
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
    :description="`低于 ${MIN_PERCENT}% 可能让屏幕看起来像黑屏。\n确认后将临时放开该限制。`"
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
